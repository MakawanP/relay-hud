import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireLocalAdmin, verifySameOriginRequest } from "@/server/csrf";
import { getVault } from "@/server/vault";

export const dynamic = "force-dynamic";

const OAuthConfigSchema = z.object({
  clientId: z.string().trim().min(10).max(256),
  clientSecret: z.string().trim().min(8).max(256),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request, { requireJson: true });
  if (csrfError) return csrfError;
  const adminError = requireLocalAdmin(request);
  if (adminError) return adminError;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = OAuthConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide both a valid Google OAuth Client ID and Client Secret." },
      { status: 400 },
    );
  }

  try {
    getVault().setGoogleOAuthApp(parsed.data.clientId, parsed.data.clientSecret);
    return NextResponse.json({ configured: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to save encrypted Google OAuth client credentials." },
      { status: 500 },
    );
  }
}
