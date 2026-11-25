import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolvePublicOrigin } from "@/server/auth";
import { discoverOidcProvider, generatePkceBundle } from "@/server/oidc";
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
    !sso.oidcAppLoginEnabled ||
    !sso.oidcIssuer ||
    !sso.oidcClientId ||
    !sso.oidcClientSecret
  ) {
    return NextResponse.redirect(
      new URL("/?sso_error=oidc_not_enabled", origin),
    );
  }

  let doc;
  try {
    doc = await discoverOidcProvider(sso.oidcIssuer);
  } catch {
    return NextResponse.redirect(
      new URL("/?sso_error=oidc_discovery_failed", origin),
    );
  }

  const { nonce, codeVerifier, codeChallenge } = generatePkceBundle();
  const state = crypto.randomBytes(24).toString("hex");
  const redirectUri = `${origin}/api/auth/sso/oidc/callback`;

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
    path: "/api/auth/sso/oidc",
    maxAge: 600,
    secure: isHttps,
  };

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("relay_sso_oidc_state", state, cookieOpts);
  res.cookies.set("relay_sso_oidc_verifier", codeVerifier, cookieOpts);
  res.cookies.set("relay_sso_oidc_nonce", nonce, cookieOpts);
  return res;
}
