import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, revokeSessionToken } from "@/server/auth";
import { verifySameOriginRequest } from "@/server/csrf";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request, {
    allowUnauthenticatedUnlock: true,
  });
  if (csrfError) return csrfError;

  revokeSessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  const isHttps =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ===
      "https" || request.nextUrl.protocol === "https:";

  const res = NextResponse.json({ locked: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge: 0,
  });
  return res;
}
