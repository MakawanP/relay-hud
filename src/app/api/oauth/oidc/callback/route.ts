import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  isLoopbackHost,
  isRemoteAuthConfigured,
  resolvePublicOrigin,
  verifySessionToken,
} from "@/server/auth";
import {
  discoverOidcProvider,
  exchangeOidcAuthorizationCode,
  fetchOidcUserInfo,
  parseIdTokenClaims,
  safeStringEquals,
} from "@/server/oidc";
import { getJobRunner } from "@/server/runner";
import { getHudStore } from "@/server/store";
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
  if (!isLoopbackHost(hostHeader)) {
    if (!isRemoteAuthConfigured()) {
      return NextResponse.json(
        { error: "Forbidden: RelayHUD only accepts local loopback requests." },
        { status: 403 },
      );
    }
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!verifySessionToken(token)) {
      return NextResponse.json(
        { error: "Unauthorized: Passcode or SSO sign-in required." },
        { status: 401 },
      );
    }
  }

  const origin = resolvePublicOrigin(request.headers, request.nextUrl.origin);
  const isHttps = origin.startsWith("https://");
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const oauthErr = request.nextUrl.searchParams.get("error");

  const cookieState = request.cookies.get("relay_oidc_acct_state")?.value ?? "";
  const codeVerifier =
    request.cookies.get("relay_oidc_acct_verifier")?.value ?? "";
  const expectedNonce =
    request.cookies.get("relay_oidc_acct_nonce")?.value ?? "";

  const clearAndRedirect = (query: string): NextResponse => {
    const res = NextResponse.redirect(new URL(`/${query}`, origin));
    const expireOpts = {
      path: "/api/oauth/oidc",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax" as const,
      secure: isHttps,
    };
    res.cookies.set("relay_oidc_acct_state", "", expireOpts);
    res.cookies.set("relay_oidc_acct_verifier", "", expireOpts);
    res.cookies.set("relay_oidc_acct_nonce", "", expireOpts);
    return res;
  };

  if (oauthErr) {
    return clearAndRedirect("?oauth=error&reason=access_denied");
  }

  if (
    !code ||
    !state ||
    !cookieState ||
    !codeVerifier ||
    !safeStringEquals(state, cookieState)
  ) {
    return clearAndRedirect("?oauth=error&reason=invalid_state");
  }

  const accountId = state.split(":")[0] ?? "";
  const store = getHudStore();
  if (
    !accountId ||
    !store.hasAccount(accountId) ||
    store.getAccountMeta(accountId).provider !== "openai_compatible"
  ) {
    return clearAndRedirect("?oauth=error&reason=invalid_slot");
  }

  const vault = getVault();
  const sso = vault.getSsoConfig();
  if (!sso.oidcIssuer || !sso.oidcClientId || !sso.oidcClientSecret) {
    return clearAndRedirect("?oauth=missing_oidc_config");
  }

  let doc;
  try {
    doc = await discoverOidcProvider(sso.oidcIssuer);
  } catch {
    return clearAndRedirect("?oauth=error&reason=oidc_discovery_failed");
  }

  let exchanged;
  try {
    exchanged = await exchangeOidcAuthorizationCode({
      tokenEndpoint: doc.token_endpoint,
      code,
      clientId: sso.oidcClientId,
      clientSecret: sso.oidcClientSecret,
      redirectUri: `${origin}/api/oauth/oidc/callback`,
      codeVerifier,
    });
  } catch {
    return clearAndRedirect("?oauth=error&reason=token_exchange_failed");
  }

  let email: string | undefined;
  if (exchanged.idToken) {
    try {
      const claims = parseIdTokenClaims(exchanged.idToken, {
        issuer: doc.issuer,
        clientId: sso.oidcClientId,
        nonce: expectedNonce || undefined,
      });
      email = claims.email;
    } catch {
      return clearAndRedirect("?oauth=error&reason=invalid_id_token");
    }
  }
  if (!email && doc.userinfo_endpoint) {
    try {
      const info = await fetchOidcUserInfo(
        doc.userinfo_endpoint,
        exchanged.accessToken,
      );
      email = info.email;
    } catch {
      // Optional identity metadata.
    }
  }

  vault.setAccountSecret(accountId, {
    oauthAccessToken: exchanged.accessToken,
    ...(exchanged.refreshToken
      ? { oauthRefreshToken: exchanged.refreshToken }
      : {}),
    oauthExpiresAt: exchanged.expiresAt,
    ...(email ? { oauthEmail: email } : {}),
  });

  store.updateAccountMeta(accountId, {
    authMode: "oauth",
    ...(email ? { email } : {}),
  });

  await getJobRunner().testAccountConnection(accountId);

  return clearAndRedirect(
    `?oauth=connected&account=${encodeURIComponent(accountId)}`,
  );
}
