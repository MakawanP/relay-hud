import crypto from "node:crypto";
import type { SessionUserInfo } from "@/domain/types";
import { isSsoIdentityAllowed } from "./oidc";
import { getVault } from "./vault";

export const SESSION_COOKIE_NAME = "relay_hud_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const RATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAILED_ATTEMPTS = 8;
/** Server-wide cap so rotating spoofable client keys cannot bypass the per-client limit. */
const MAX_GLOBAL_FAILED_ATTEMPTS = 40;
const MAX_TRACKED_CLIENTS = 2_000;
const GLOBAL_FAILURE_KEY = "__global__";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const LOOPBACK_IPS = new Set([
  "127.0.0.1",
  "::1",
  "[::1]",
  "::ffff:127.0.0.1",
  "localhost",
]);

/**
 * Headers that only appear when a request travelled through a proxy, tunnel or CDN.
 * Their presence means the request did not originate from a browser on this Mac,
 * even when the proxy rewrote `Host` to 127.0.0.1.
 */
const PROXY_HINT_HEADERS = [
  "forwarded",
  "x-real-ip",
  "cf-connecting-ip",
  "cf-ray",
  "cf-visitor",
  "cf-ipcountry",
  "true-client-ip",
  "x-client-ip",
  "x-cluster-client-ip",
  "fly-client-ip",
  "x-original-forwarded-for",
  "x-ngrok-forwarded",
  "ngrok-skip-browser-warning",
  "tailscale-user-login",
] as const;

declare global {
  var __relayHudEphemeralSecret: string | undefined;
  var __relayHudUnlockFailures: Map<string, number[]> | undefined;
  var __relayHudRevokedSessions: Map<string, number> | undefined;
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

function getRevokedSessions(): Map<string, number> {
  if (!globalThis.__relayHudRevokedSessions) {
    globalThis.__relayHudRevokedSessions = new Map();
  }
  return globalThis.__relayHudRevokedSessions;
}

export function extractHostname(hostHeader: string | null | undefined): string {
  const raw = (hostHeader ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    return raw.match(/^\[[^\]]+\]/)?.[0]?.toLowerCase() ?? "";
  }
  return raw.split(":")[0]?.toLowerCase() ?? "";
}

/** True when the Host header names a loopback address. Not proof of a local client on its own. */
export function isLoopbackHost(hostHeader: string | null | undefined): boolean {
  const host = extractHostname(hostHeader);
  return Boolean(host && LOOPBACK_HOSTS.has(host));
}

/**
 * When enabled together with remote auth, loopback requests are never trusted implicitly:
 * every request (including from this Mac) must carry a passcode or SSO session.
 * Use this when a reverse proxy in front of RelayHUD rewrites Host and strips forwarding headers.
 */
export function isStrictAuthMode(): boolean {
  return (
    process.env.RELAY_HUD_STRICT_AUTH?.trim().toLowerCase() === "true" &&
    isRemoteAuthConfigured()
  );
}

/**
 * Decides whether a request came from a browser on this machine and may skip sign-in.
 *
 * `Host` alone is attacker- and proxy-controlled (nginx's default `proxy_pass`, ngrok
 * `--host-header=rewrite` and cloudflared `httpHostHeader` all send `Host: 127.0.0.1`),
 * so we additionally require that no proxy/CDN forwarding headers are present.
 * Next.js fills `x-forwarded-for` / `x-forwarded-host` with the socket values when the
 * client did not send them, so those must match loopback / the Host header.
 */
export function isTrustedLocalRequest(headersLike: Pick<Headers, "get">): boolean {
  if (isStrictAuthMode()) return false;

  const hostHeader = (headersLike.get("host") ?? "").trim();
  if (!isLoopbackHost(hostHeader)) return false;

  for (const name of PROXY_HINT_HEADERS) {
    if (headersLike.get(name) !== null) return false;
  }

  const forwardedHost = headersLike.get("x-forwarded-host");
  if (
    forwardedHost !== null &&
    forwardedHost.split(",")[0]?.trim().toLowerCase() !== hostHeader.toLowerCase()
  ) {
    return false;
  }

  const xff = headersLike.get("x-forwarded-for");
  if (xff !== null) {
    const hops = xff
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    if (hops.length === 0 || hops.some((h) => !LOOPBACK_IPS.has(h))) {
      return false;
    }
  }

  return true;
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
    `relay-hud-session-v3:${passcode}:${vaultFingerprint}:${getEphemeralSecret()}`,
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
  jti: string;
}

export function createSessionToken(identity?: SessionUserInfo): string {
  if (!isRemoteAuthConfigured() && !identity) {
    throw new Error("Remote authentication is not configured.");
  }
  const payload: SessionTokenPayload = {
    exp: Date.now() + SESSION_TTL_MS,
    sub: identity?.email ?? "local-passcode",
    method: identity?.method ?? "passcode",
    jti: crypto.randomBytes(16).toString("hex"),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const sig = signPayload(encoded);
  return `${encoded}.${sig}`;
}

function decodeVerifiedToken(
  token: string | undefined | null,
): SessionTokenPayload | null {
  if (!token) return null;
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
      parsed.exp <= Date.now() ||
      typeof parsed.jti !== "string" ||
      typeof parsed.sub !== "string"
    ) {
      return null;
    }
    const method: SessionUserInfo["method"] =
      parsed.method === "google_sso" || parsed.method === "oidc_sso"
        ? parsed.method
        : "passcode";
    return { exp: parsed.exp, sub: parsed.sub, method, jti: parsed.jti };
  } catch {
    return null;
  }
}

function pruneRevoked(now: number): void {
  const revoked = getRevokedSessions();
  for (const [jti, exp] of revoked) {
    if (exp <= now) revoked.delete(jti);
  }
}

/**
 * Re-checks an SSO session against the *current* SSO configuration, so that removing an
 * email/domain from the allowlist or disabling a provider takes effect immediately.
 */
function isSsoSessionStillAllowed(payload: SessionTokenPayload): boolean {
  if (payload.method === "passcode") {
    return getRemotePasscode() !== null;
  }
  let sso;
  try {
    sso = getVault().getSsoConfig();
  } catch {
    return false;
  }
  if (payload.method === "google_sso" && !sso.googleAppLoginEnabled) return false;
  if (payload.method === "oidc_sso" && !sso.oidcAppLoginEnabled) return false;
  return isSsoIdentityAllowed({
    email: payload.sub,
    emailVerified: true,
    requireEmailVerified: false,
    allowedEmails: sso.allowedEmails,
    allowedDomains: sso.allowedDomains,
  }).allowed;
}

export function getSessionInfo(
  token: string | undefined | null,
): SessionUserInfo | null {
  if (!token || !isRemoteAuthConfigured()) return null;
  const payload = decodeVerifiedToken(token);
  if (!payload) return null;
  const now = Date.now();
  pruneRevoked(now);
  if (getRevokedSessions().has(payload.jti)) return null;
  if (!isSsoSessionStillAllowed(payload)) return null;
  return { email: payload.sub, method: payload.method };
}

export function verifySessionToken(token: string | undefined | null): boolean {
  return getSessionInfo(token) !== null;
}

/** Revokes a single session token (used by logout). Safe to call with invalid tokens. */
export function revokeSessionToken(token: string | undefined | null): void {
  const payload = decodeVerifiedToken(token);
  if (!payload) return;
  getRevokedSessions().set(payload.jti, payload.exp);
}

/**
 * Picks a rate-limit key. CF-Connecting-IP is only meaningful behind Cloudflare; every
 * other header is client-controlled, which is why a server-wide cap backs this up.
 */
export function getUnlockClientKey(headersLike: Pick<Headers, "get">): string {
  const cfIp = headersLike.get("cf-connecting-ip")?.trim();
  if (cfIp) return `cf:${cfIp.slice(0, 64)}`;
  const xff = headersLike.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return `xff:${xff.slice(0, 64)}`;
  return "unknown";
}

function recentFailures(key: string, now: number): number[] {
  const cutoff = now - RATE_WINDOW_MS;
  return (getFailureStore().get(key) ?? []).filter((ts) => ts >= cutoff);
}

function evictIfFull(store: Map<string, number[]>): void {
  if (store.size <= MAX_TRACKED_CLIENTS) return;
  const now = Date.now();
  for (const [key, timestamps] of store) {
    if (key === GLOBAL_FAILURE_KEY) continue;
    if (timestamps.every((ts) => ts < now - RATE_WINDOW_MS)) store.delete(key);
  }
  // Still full: drop oldest-inserted entries (Map preserves insertion order).
  for (const key of store.keys()) {
    if (store.size <= MAX_TRACKED_CLIENTS) break;
    if (key !== GLOBAL_FAILURE_KEY) store.delete(key);
  }
}

export function checkUnlockRateLimit(clientKey: string): {
  allowed: boolean;
  retryAfterSec?: number;
} {
  const store = getFailureStore();
  const now = Date.now();

  const check = (key: string, max: number): number | null => {
    const recent = recentFailures(key, now);
    if (recent.length === 0) store.delete(key);
    else store.set(key, recent);
    if (recent.length >= max) {
      const oldest = recent[recent.length - max] ?? now;
      return Math.max(1, Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000));
    }
    return null;
  };

  const globalRetry = check(GLOBAL_FAILURE_KEY, MAX_GLOBAL_FAILED_ATTEMPTS);
  if (globalRetry !== null) return { allowed: false, retryAfterSec: globalRetry };
  const clientRetry = check(clientKey, MAX_FAILED_ATTEMPTS);
  if (clientRetry !== null) return { allowed: false, retryAfterSec: clientRetry };
  return { allowed: true };
}

export function recordFailedUnlock(clientKey: string): void {
  const store = getFailureStore();
  const now = Date.now();
  for (const key of [clientKey, GLOBAL_FAILURE_KEY]) {
    const recent = recentFailures(key, now);
    recent.push(now);
    store.set(key, recent);
  }
  evictIfFull(store);
}

export function clearFailedUnlock(clientKey: string): void {
  getFailureStore().delete(clientKey);
}

/** Test helper: resets all in-memory auth state. */
export function resetAuthStateForTests(): void {
  getFailureStore().clear();
  getRevokedSessions().clear();
}
