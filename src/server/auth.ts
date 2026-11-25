import crypto from "node:crypto";
import type { SessionUserInfo } from "@/domain/types";
import { getVault } from "./vault";

export const SESSION_COOKIE_NAME = "relay_hud_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const RATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAILED_ATTEMPTS = 8;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

declare global {
  var __relayHudEphemeralSecret: string | undefined;
  var __relayHudUnlockFailures: Map<string, number[]> | undefined;
}

function getEphemeralSecret(): string {
  if (!globalThis.__relayHudEphemeralSecret) {
    globalThis.__relayHudEphemeralSecret = crypto
      .randomBytes(32)
      .toString("hex");
  }
  return globalThis.__relayHudEphemeralSecret;
}

function getFailureStore(): Map<string, number[]> {
  if (!globalThis.__relayHudUnlockFailures) {
    globalThis.__relayHudUnlockFailures = new Map();
  }
  return globalThis.__relayHudUnlockFailures;
}

export function extractHostname(hostHeader: string | null | undefined): string {
  const raw = (hostHeader ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    return raw.match(/^\[[^\]]+\]/)?.[0]?.toLowerCase() ?? "";
  }
  return raw.split(":")[0]?.toLowerCase() ?? "";
}

export function isLoopbackHost(hostHeader: string | null | undefined): boolean {
  const host = extractHostname(hostHeader);
  return Boolean(host && LOOPBACK_HOSTS.has(host));
}

export function resolvePublicOrigin(
  headersLike: Pick<Headers, "get">,
  fallbackOrigin = "http://127.0.0.1:3456",
): string {
  const hostHeader = (headersLike.get("host") ?? "").trim();
  if (!hostHeader) return fallbackOrigin;

  const forwardedProto = headersLike
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();

  let proto: "http" | "https" | null =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : null;

  if (!proto) {
    const cfVisitor = headersLike.get("cf-visitor") ?? "";
    if (cfVisitor.includes('"https"')) {
      proto = "https";
    }
  }

  if (!proto) {
    try {
      const parsed = new URL(fallbackOrigin);
      proto = parsed.protocol === "https:" ? "https" : "http";
    } catch {
      proto = "http";
    }
  }

  return `${proto}://${hostHeader}`;
}

export function getRemotePasscode(): string | null {
  const val = process.env.RELAY_HUD_REMOTE_PASSCODE?.trim();
  return val && val.length >= 8 ? val : null;
}

export function isAnySsoLoginEnabled(): boolean {
  try {
    const sso = getVault().getSsoConfig();
    return sso.googleAppLoginEnabled || sso.oidcAppLoginEnabled;
  } catch {
    return false;
  }
}

export function isRemoteAuthConfigured(): boolean {
  return Boolean(getRemotePasscode() || isAnySsoLoginEnabled());
}

function sha256(value: string): Buffer {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

export function verifyPasscode(candidate: string): boolean {
  const expected = getRemotePasscode();
  if (!expected) return false;
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  return crypto.timingSafeEqual(sha256(trimmed), sha256(expected));
}

function getSessionSigningKey(): Buffer {
  const passcode = getRemotePasscode() ?? "";
  let vaultFingerprint = "";
  try {
    vaultFingerprint = getVault().getMasterKeyFingerprint();
  } catch {
    vaultFingerprint = "fallback";
  }
  return sha256(
    `relay-hud-session-v2:${passcode}:${vaultFingerprint}:${getEphemeralSecret()}`,
  );
}

function signPayload(encodedPayload: string): string {
  return crypto
    .createHmac("sha256", getSessionSigningKey())
    .update(encodedPayload, "utf8")
    .digest("hex");
}

interface SessionTokenPayload {
  exp: number;
  sub: string;
  method: SessionUserInfo["method"];
}

export function createSessionToken(identity?: SessionUserInfo): string {
  if (!isRemoteAuthConfigured() && !identity) {
    throw new Error("Remote authentication is not configured.");
  }
  const payload: SessionTokenPayload = {
    exp: Date.now() + SESSION_TTL_MS,
    sub: identity?.email ?? "local-passcode",
    method: identity?.method ?? "passcode",
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const sig = signPayload(encoded);
  return `${encoded}.${sig}`;
}

export function getSessionInfo(
  token: string | undefined | null,
): SessionUserInfo | null {
  if (!token || !isRemoteAuthConfigured()) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig || !/^[0-9a-f]{64}$/i.test(providedSig)) {
    return null;
  }

  const expectedSig = signPayload(encoded);
  const sigValid = crypto.timingSafeEqual(
    Buffer.from(providedSig, "hex"),
    Buffer.from(expectedSig, "hex"),
  );
  if (!sigValid) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<SessionTokenPayload>;
    if (
      typeof parsed.exp !== "number" ||
      !Number.isFinite(parsed.exp) ||
      parsed.exp <= Date.now()
    ) {
      return null;
    }
    const method: SessionUserInfo["method"] =
      parsed.method === "google_sso" || parsed.method === "oidc_sso"
        ? parsed.method
        : "passcode";
    return {
      email: typeof parsed.sub === "string" ? parsed.sub : "local-passcode",
      method,
    };
  } catch {
    return null;
  }
}

export function verifySessionToken(token: string | undefined | null): boolean {
  return getSessionInfo(token) !== null;
}

export function checkUnlockRateLimit(clientKey: string): {
  allowed: boolean;
  retryAfterSec?: number;
} {
  const store = getFailureStore();
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const recent = (store.get(clientKey) ?? []).filter((ts) => ts >= cutoff);
  store.set(clientKey, recent);

  if (recent.length >= MAX_FAILED_ATTEMPTS) {
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000),
    );
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true };
}

export function recordFailedUnlock(clientKey: string): void {
  const store = getFailureStore();
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const recent = (store.get(clientKey) ?? []).filter((ts) => ts >= cutoff);
  recent.push(now);
  store.set(clientKey, recent);
}

export function clearFailedUnlock(clientKey: string): void {
  getFailureStore().delete(clientKey);
}
