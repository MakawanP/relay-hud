import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolvePublicOrigin } from "@/server/auth";
import { verifySameOriginRequest } from "@/server/csrf";
import { discoverOidcProvider, generatePkceBundle } from "@/server/oidc";
import { getHudStore } from "@/server/store";
import { getVault } from "@/server/vault";

export const dynamic = "force-dynamic";

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
    store.getAccountMeta(accountId).provider !== "openai_compatible"
  ) {
    return NextResponse.json(
      {
        error:
          "OIDC account sign-in is only valid for an existing OpenAI-compatible gateway account.",
      },
      { status: 400 },
    );
  }

  const sso = getVault().getSsoConfig();
  if (!sso.oidcIssuer || !sso.oidcClientId || !sso.oidcClientSecret) {
    return NextResponse.redirect(new URL("/?oauth=missing_oidc_config", origin));
  }

  let doc;
  try {
    doc = await discoverOidcProvider(sso.oidcIssuer);
  } catch {
    return NextResponse.redirect(
      new URL("/?oauth=error&reason=oidc_discovery_failed", origin),
    );
  }

  const { nonce, codeVerifier, codeChallenge } = generatePkceBundle();
  const state = `${accountId}:${crypto.randomBytes(24).toString("hex")}`;
  const redirectUri = `${origin}/api/oauth/oidc/callback`;

  const authUrl = new URL(doc.authorization_endpoint);
  authUrl.searchParams.set("client_id", sso.oidcClientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", sso.oidcScopes);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/api/oauth/oidc",
    maxAge: 600,
    secure: isHttps,
  };

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("relay_oidc_acct_state", state, cookieOpts);
  res.cookies.set("relay_oidc_acct_verifier", codeVerifier, cookieOpts);
  res.cookies.set("relay_oidc_acct_nonce", nonce, cookieOpts);
  return res;
}
