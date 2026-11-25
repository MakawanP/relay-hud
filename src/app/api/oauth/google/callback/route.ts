import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE_NAME,
  isLoopbackHost,
  isRemoteAuthConfigured,
  resolvePublicOrigin,
  verifySessionToken,
} from "@/server/auth";
import { safeStringEquals } from "@/server/oidc";
import { getJobRunner } from "@/server/runner";
import { getHudStore } from "@/server/store";
import { getVault } from "@/server/vault";

export const dynamic = "force-dynamic";

const GoogleTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().finite().positive().optional(),
});

const GoogleUserInfoSchema = z.object({
  email: z.string().email().optional(),
});

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
  const cookieState =
    request.cookies.get("relay_google_oauth_state")?.value ?? "";
  const codeVerifier =
    request.cookies.get("relay_google_oauth_verifier")?.value ?? "";

  const clearAndRedirect = (query: string): NextResponse => {
    const res = NextResponse.redirect(new URL(`/${query}`, origin));
    const expireOpts = {
      path: "/api/oauth/google",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax" as const,
      secure: isHttps,
    };
    res.cookies.set("relay_google_oauth_state", "", expireOpts);
    res.cookies.set("relay_google_oauth_verifier", "", expireOpts);
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
    store.getAccountMeta(accountId).provider !== "google"
  ) {
    return clearAndRedirect("?oauth=error&reason=invalid_slot");
  }

  const vault = getVault();
  const { clientId, clientSecret } = vault.getGoogleOAuthApp();
  if (!clientId || !clientSecret) {
    return clearAndRedirect("?oauth=missing_config");
  }

  const redirectUri = `${origin}/api/oauth/google/callback`;
  let tokenRes: Response;
  try {
    tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }).toString(),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return clearAndRedirect("?oauth=error&reason=network_error");
  }

  if (!tokenRes.ok) {
    return clearAndRedirect("?oauth=error&reason=token_exchange_failed");
  }

  let tokenJson: unknown;
  try {
    tokenJson = await tokenRes.json();
  } catch {
    return clearAndRedirect("?oauth=error&reason=token_exchange_failed");
  }

  const parsedToken = GoogleTokenResponseSchema.safeParse(tokenJson);
  if (!parsedToken.success) {
    return clearAndRedirect("?oauth=error&reason=missing_access_token");
  }
  const tokenData = parsedToken.data;

  let email: string | undefined;
  try {
    const userRes = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (userRes.ok) {
      const parsedProfile = GoogleUserInfoSchema.safeParse(await userRes.json());
      if (parsedProfile.success) {
        email = parsedProfile.data.email;
      }
    }
  } catch {
    // Email lookup is optional metadata; token remains valid.
  }

  const expiresAt = new Date(
    Date.now() + Math.max(300, (tokenData.expires_in ?? 3600) - 60) * 1000,
  ).toISOString();

  vault.setAccountSecret(accountId, {
    oauthAccessToken: tokenData.access_token,
    ...(tokenData.refresh_token
      ? { oauthRefreshToken: tokenData.refresh_token }
      : {}),
    oauthExpiresAt: expiresAt,
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
