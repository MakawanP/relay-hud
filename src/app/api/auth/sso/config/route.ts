import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePublicOrigin } from "@/server/auth";
import { verifySameOriginRequest } from "@/server/csrf";
import { discoverOidcProvider } from "@/server/oidc";
import { buildPublicSsoConfig } from "@/server/snapshot";
import { validateOidcIssuerUrl } from "@/server/url-guard";
import { getVault } from "@/server/vault";

export const dynamic = "force-dynamic";

const UpdateSsoSchema = z.object({
  googleAppLoginEnabled: z.boolean().optional(),
  oidcAppLoginEnabled: z.boolean().optional(),
  oidcLabel: z.string().trim().min(1).max(48).optional(),
  oidcIssuer: z.string().trim().max(300).optional(),
  oidcClientId: z.string().trim().max(200).optional(),
  oidcClientSecret: z.string().trim().max(300).optional(),
  oidcScopes: z.string().trim().min(1).max(200).optional(),
  allowedEmails: z.array(z.string().trim().max(120)).max(50).optional(),
  allowedDomains: z.array(z.string().trim().max(120)).max(25).optional(),
  testDiscovery: z.boolean().optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request);
  if (csrfError) return csrfError;

  const origin = resolvePublicOrigin(request.headers, request.nextUrl.origin);
  return NextResponse.json({ ssoConfig: buildPublicSsoConfig(origin) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request, { requireJson: true });
  if (csrfError) return csrfError;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = UpdateSsoSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;
  let validatedIssuer: string | undefined;
  if (input.oidcIssuer !== undefined) {
    if (input.oidcIssuer === "") {
      validatedIssuer = "";
    } else {
      try {
        validatedIssuer = validateOidcIssuerUrl(input.oidcIssuer);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Invalid OIDC issuer URL." },
          { status: 400 },
        );
      }
    }
  }

  let discoveryOk: boolean | null = null;
  let discoveryError: string | null = null;
  if (input.testDiscovery && validatedIssuer) {
    try {
      await discoverOidcProvider(validatedIssuer);
      discoveryOk = true;
    } catch (err) {
      discoveryOk = false;
      discoveryError =
        err instanceof Error ? err.message : "OIDC discovery check failed.";
    }
  }

  const vault = getVault();
  vault.setSsoConfig({
    ...(input.googleAppLoginEnabled !== undefined
      ? { googleAppLoginEnabled: input.googleAppLoginEnabled }
      : {}),
    ...(input.oidcAppLoginEnabled !== undefined
      ? { oidcAppLoginEnabled: input.oidcAppLoginEnabled }
      : {}),
    ...(input.oidcLabel !== undefined ? { oidcLabel: input.oidcLabel } : {}),
    ...(validatedIssuer !== undefined ? { oidcIssuer: validatedIssuer } : {}),
    ...(input.oidcClientId !== undefined
      ? { oidcClientId: input.oidcClientId }
      : {}),
    ...(input.oidcClientSecret !== undefined
      ? { oidcClientSecret: input.oidcClientSecret }
      : {}),
    ...(input.oidcScopes !== undefined ? { oidcScopes: input.oidcScopes } : {}),
    ...(input.allowedEmails !== undefined
      ? { allowedEmails: input.allowedEmails }
      : {}),
    ...(input.allowedDomains !== undefined
      ? { allowedDomains: input.allowedDomains }
      : {}),
  });

  const origin = resolvePublicOrigin(request.headers, request.nextUrl.origin);
  return NextResponse.json({
    ssoConfig: buildPublicSsoConfig(origin),
    discovery:
      discoveryOk !== null
        ? { ok: discoveryOk, error: discoveryError }
        : null,
  });
}
