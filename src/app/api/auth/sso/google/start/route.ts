import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolvePublicOrigin } from "@/server/auth";
import { generatePkceBundle } from "@/server/oidc";
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
  const sso = getVault().getSsoConfig();

  if (
    !sso.googleAppLoginEnabled ||
    !sso.googleClientId ||
    !sso.googleClientSecret
  ) {
    return NextResponse.redirect(
      new URL("/?sso_error=google_not_enabled", origin),
    );
  }

  const { nonce, codeVerifier, codeChallenge } = generatePkceBundle();
  const state = crypto.randomBytes(24).toString("hex");
  const redirectUri = `${origin}/api/auth/sso/google/callback`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", sso.googleClientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("prompt", "select_account");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/api/auth/sso/google",
    maxAge: 600,
    secure: isHttps,
  };

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("relay_sso_google_state", state, cookieOpts);
  res.cookies.set("relay_sso_google_verifier", codeVerifier, cookieOpts);
  res.cookies.set("relay_sso_google_nonce", nonce, cookieOpts);
  return res;
}
