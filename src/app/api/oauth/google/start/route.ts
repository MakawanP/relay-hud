import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolvePublicOrigin } from "@/server/auth";
import { verifySameOriginRequest } from "@/server/csrf";
import { getHudStore } from "@/server/store";
import { getVault } from "@/server/vault";

export const dynamic = "force-dynamic";

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/generative-language",
].join(" ");

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = verifySameOriginRequest(request);
  if (authError) return authError;

  const origin = resolvePublicOrigin(request.headers, request.nextUrl.origin);
  const isHttps = origin.startsWith("https://");

  const accountId = (request.nextUrl.searchParams.get("accountId") ?? "").trim();
  const store = getHudStore();
  if (
    !accountId ||
    !store.hasAccount(accountId) ||
    store.getAccountMeta(accountId).provider !== "google"
  ) {
    return NextResponse.json(
      { error: "OAuth sign-in is only valid for an existing Google account." },
      { status: 400 },
    );
  }

  const { clientId, clientSecret } = getVault().getGoogleOAuthApp();
  if (!clientId || !clientSecret) {
    const fallbackUrl = new URL("/?oauth=missing_config", origin);
    return NextResponse.redirect(fallbackUrl);
  }

  const nonce = crypto.randomBytes(24).toString("hex");
  const state = `${accountId}:${nonce}`;
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const redirectUri = `${origin}/api/oauth/google/callback`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_SCOPES);
  authUrl.searchParams.set("access_type", "offline");
  // Force Google's account chooser so unlimited Google accounts can be connected cleanly.
  authUrl.searchParams.set("prompt", "select_account consent");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/api/oauth/google",
    maxAge: 600,
    secure: isHttps,
  };

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("relay_google_oauth_state", state, cookieOpts);
  response.cookies.set("relay_google_oauth_verifier", codeVerifier, cookieOpts);
  return response;
}
