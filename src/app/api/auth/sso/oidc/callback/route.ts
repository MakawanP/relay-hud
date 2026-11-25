import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  resolvePublicOrigin,
} from "@/server/auth";
import {
  discoverOidcProvider,
  exchangeOidcAuthorizationCode,
  fetchOidcUserInfo,
  isSsoIdentityAllowed,
  parseIdTokenClaims,
  safeStringEquals,
} from "@/server/oidc";
import { getVault } from "@/server/vault";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const hostHeader = (request.headers.get("host") ?? "").trim();
  if (!hostHeader) {
    return NextResponse.json(
      { error: "Forbidden: Missing Host header." },
      { status: 403 },
    );
  }

  const origin = resolvePublicOrigin(request.headers, request.nextUrl.origin);
  const isHttps = origin.startsWith("https://");
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const errParam = request.nextUrl.searchParams.get("error");

  const cookieState = request.cookies.get("relay_sso_oidc_state")?.value ?? "";
  const codeVerifier =
    request.cookies.get("relay_sso_oidc_verifier")?.value ?? "";
  const expectedNonce =
    request.cookies.get("relay_sso_oidc_nonce")?.value ?? "";

  const clearTempCookies = (res: NextResponse): NextResponse => {
    const expireOpts = {
      path: "/api/auth/sso/oidc",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax" as const,
      secure: isHttps,
    };
    res.cookies.set("relay_sso_oidc_state", "", expireOpts);
    res.cookies.set("relay_sso_oidc_verifier", "", expireOpts);
    res.cookies.set("relay_sso_oidc_nonce", "", expireOpts);
    return res;
  };

  const fail = (reason: string): NextResponse =>
    clearTempCookies(
      NextResponse.redirect(
        new URL(`/?sso_error=${encodeURIComponent(reason)}`, origin),
      ),
    );

  if (errParam) return fail("access_denied");
  if (
    !code ||
    !state ||
    !cookieState ||
    !codeVerifier ||
    !expectedNonce ||
    !safeStringEquals(state, cookieState)
  ) {
    return fail("invalid_state");
  }

  const sso = getVault().getSsoConfig();
  if (
    !sso.oidcAppLoginEnabled ||
    !sso.oidcIssuer ||
    !sso.oidcClientId ||
    !sso.oidcClientSecret
  ) {
    return fail("oidc_not_enabled");
  }

  let doc;
  try {
    doc = await discoverOidcProvider(sso.oidcIssuer);
  } catch {
    return fail("oidc_discovery_failed");
  }

  let exchanged;
  try {
    exchanged = await exchangeOidcAuthorizationCode({
      tokenEndpoint: doc.token_endpoint,
      code,
      clientId: sso.oidcClientId,
      clientSecret: sso.oidcClientSecret,
      redirectUri: `${origin}/api/auth/sso/oidc/callback`,
      codeVerifier,
    });
  } catch {
    return fail("token_exchange_failed");
  }

  let email: string | undefined;
  let emailVerified: boolean | undefined;

  if (exchanged.idToken) {
    try {
      const claims = parseIdTokenClaims(exchanged.idToken, {
        issuer: doc.issuer,
        clientId: sso.oidcClientId,
        nonce: expectedNonce,
      });
      email = claims.email;
      emailVerified = claims.emailVerified;
    } catch {
      return fail("invalid_id_token");
    }
  }

  if (!email && doc.userinfo_endpoint) {
    const info = await fetchOidcUserInfo(
      doc.userinfo_endpoint,
      exchanged.accessToken,
    );
    email = info.email;
    emailVerified = emailVerified ?? info.emailVerified;
  }

  const check = isSsoIdentityAllowed({
    email,
    emailVerified,
    requireEmailVerified: false,
    allowedEmails: sso.allowedEmails,
    allowedDomains: sso.allowedDomains,
  });

  if (!check.allowed || !check.normalizedEmail) {
    return fail("not_allowed");
  }

  const sessionToken = createSessionToken({
    email: check.normalizedEmail,
    method: "oidc_sso",
  });

  const res = clearTempCookies(NextResponse.redirect(new URL("/", origin)));
  res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return res;
}
