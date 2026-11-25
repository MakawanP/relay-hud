import crypto from "node:crypto";
import { z } from "zod";
import {
  isLoopbackHostname,
  validateDiscoveredOidcEndpoint,
  validateOidcIssuerUrl,
} from "./url-guard";

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
}

const DiscoverySchema = z.object({
  issuer: z.string().min(1),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  userinfo_endpoint: z.string().url().optional(),
});

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  expires_in: z.number().finite().positive().optional(),
  token_type: z.string().optional(),
});

const UserInfoSchema = z.object({
  sub: z.string().optional(),
  email: z.string().email().optional(),
  email_verified: z.union([z.boolean(), z.string()]).optional(),
  preferred_username: z.string().optional(),
});

interface CachedDiscovery {
  doc: OidcDiscoveryDocument;
  expiresAt: number;
}

const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;
const discoveryCache = new Map<string, CachedDiscovery>();

export function generatePkceBundle(): {
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
} {
  const nonce = crypto.randomBytes(16).toString("hex");
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { nonce, codeVerifier, codeChallenge };
}

export function safeStringEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Decodes and validates core claims of an OIDC ID token returned directly over TLS from the IdP token endpoint.
 */
export function parseIdTokenClaims(
  idToken: string,
  expected: {
    issuer?: string;
    clientId: string;
    nonce?: string;
  },
): {
  sub?: string;
  email?: string;
  emailVerified?: boolean;
} {
  const segments = idToken.split(".");
  if (segments.length < 2 || !segments[1]) {
    throw new Error("Malformed OIDC id_token.");
  }
  let payload: Record<string, unknown>;
  try {
    const decoded = Buffer.from(segments[1], "base64url").toString("utf8");
    payload = JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    throw new Error("Unable to decode OIDC id_token payload.");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp <= nowSec - 60) {
    throw new Error("OIDC id_token is expired.");
  }

  const aud = payload.aud;
  const audValid =
    aud === expected.clientId ||
    (Array.isArray(aud) && aud.includes(expected.clientId));
  if (!audValid) {
    throw new Error("OIDC id_token audience mismatch.");
  }

  if (expected.issuer && typeof payload.iss === "string") {
    const normActual = payload.iss.replace(/\/+$/, "");
    const normExpected = expected.issuer.replace(/\/+$/, "");
    if (normActual !== normExpected) {
      throw new Error("OIDC id_token issuer mismatch.");
    }
  }

  if (expected.nonce) {
    if (
      typeof payload.nonce !== "string" ||
      !safeStringEquals(payload.nonce, expected.nonce)
    ) {
      throw new Error("OIDC id_token nonce mismatch.");
    }
  }

  const rawVerified = payload.email_verified;
  const emailVerified =
    rawVerified === true || rawVerified === "true"
      ? true
      : rawVerified === false || rawVerified === "false"
        ? false
        : undefined;

  return {
    sub: typeof payload.sub === "string" ? payload.sub : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
    emailVerified,
  };
}

/**
 * Fail-closed identity allowlist check for app-level SSO unlock.
 * Rejects whenever both allowlists are empty or email is unverified.
 */
export function isSsoIdentityAllowed(opts: {
  email: string | undefined;
  emailVerified: boolean | undefined;
  requireEmailVerified: boolean;
  allowedEmails: readonly string[];
  allowedDomains: readonly string[];
}): { allowed: boolean; reason?: string; normalizedEmail?: string } {
  if (opts.allowedEmails.length === 0 && opts.allowedDomains.length === 0) {
    return {
      allowed: false,
      reason: "SSO allowlist is empty — configure at least one allowed email or domain.",
    };
  }
  const normalizedEmail = opts.email?.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return {
      allowed: false,
      reason: "Identity provider did not return an email claim.",
    };
  }
  if (opts.requireEmailVerified && opts.emailVerified !== true) {
    return {
      allowed: false,
      reason: "Identity provider reported an unverified email address.",
    };
  }
  if (opts.emailVerified === false) {
    return {
      allowed: false,
      reason: "Email address is explicitly marked unverified by the identity provider.",
    };
  }

  if (opts.allowedEmails.some((e) => e.trim().toLowerCase() === normalizedEmail)) {
    return { allowed: true, normalizedEmail };
  }

  const domain = normalizedEmail.split("@")[1] ?? "";
  if (
    domain &&
    opts.allowedDomains.some(
      (d) => d.trim().toLowerCase().replace(/^@/, "") === domain,
    )
  ) {
    return { allowed: true, normalizedEmail };
  }

  return {
    allowed: false,
    reason: `Account "${normalizedEmail}" is not in the RelayHUD SSO allowlist.`,
  };
}

export async function discoverOidcProvider(
  issuerUrl: string,
): Promise<OidcDiscoveryDocument> {
  const normalizedIssuer = validateOidcIssuerUrl(issuerUrl);
  const cached = discoveryCache.get(normalizedIssuer);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.doc;
  }

  const parsedIssuer = new URL(normalizedIssuer);
  const allowLoopbackHttp =
    parsedIssuer.protocol === "http:" &&
    isLoopbackHostname(parsedIssuer.hostname);

  const wellKnownUrl = `${normalizedIssuer}/.well-known/openid-configuration`;
  const res = await fetch(wellKnownUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(
      `OIDC discovery failed at ${wellKnownUrl} (HTTP ${res.status}).`,
    );
  }

  const parsed = DiscoverySchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("OIDC discovery document is missing required endpoints.");
  }

  const doc: OidcDiscoveryDocument = {
    issuer: parsed.data.issuer,
    authorization_endpoint: validateDiscoveredOidcEndpoint(
      parsed.data.authorization_endpoint,
      allowLoopbackHttp,
    ),
    token_endpoint: validateDiscoveredOidcEndpoint(
      parsed.data.token_endpoint,
      allowLoopbackHttp,
    ),
    userinfo_endpoint: parsed.data.userinfo_endpoint
      ? validateDiscoveredOidcEndpoint(
          parsed.data.userinfo_endpoint,
          allowLoopbackHttp,
        )
      : undefined,
  };

  discoveryCache.set(normalizedIssuer, {
    doc,
    expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
  });
  return doc;
}

export async function exchangeOidcAuthorizationCode(opts: {
  tokenEndpoint: string;
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: string;
}> {
  const res = await fetch(opts.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.codeVerifier,
    }).toString(),
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    throw new Error(`OIDC token exchange failed (HTTP ${res.status}).`);
  }

  const parsed = TokenResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("OIDC token response did not include an access_token.");
  }

  const expiresAt = new Date(
    Date.now() + Math.max(300, (parsed.data.expires_in ?? 3600) - 60) * 1000,
  ).toISOString();

  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    idToken: parsed.data.id_token,
    expiresAt,
  };
}

export async function refreshOidcAccessToken(opts: {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ accessToken: string; refreshToken?: string; expiresAt: string }> {
  const doc = await discoverOidcProvider(opts.issuerUrl);
  const res = await fetch(doc.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    }).toString(),
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    throw new Error(`OIDC refresh token exchange failed (HTTP ${res.status}).`);
  }

  const parsed = TokenResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("OIDC refresh response did not include an access_token.");
  }

  const expiresAt = new Date(
    Date.now() + Math.max(300, (parsed.data.expires_in ?? 3600) - 60) * 1000,
  ).toISOString();

  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresAt,
  };
}

export async function fetchOidcUserInfo(
  userinfoEndpoint: string,
  accessToken: string,
): Promise<{ email?: string; emailVerified?: boolean; sub?: string }> {
  const res = await fetch(userinfoEndpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    return {};
  }
  const parsed = UserInfoSchema.safeParse(await res.json().catch(() => ({})));
  if (!parsed.success) return {};
  const rawVerified = parsed.data.email_verified;
  const emailVerified =
    rawVerified === true || rawVerified === "true"
      ? true
      : rawVerified === false || rawVerified === "false"
        ? false
        : undefined;
  return {
    sub: parsed.data.sub,
    email: parsed.data.email,
    emailVerified,
  };
}
