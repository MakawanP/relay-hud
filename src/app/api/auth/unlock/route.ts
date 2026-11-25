import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE_NAME,
  checkUnlockRateLimit,
  clearFailedUnlock,
  createSessionToken,
  getRemotePasscode,
  recordFailedUnlock,
  verifyPasscode,
} from "@/server/auth";
import { verifySameOriginRequest } from "@/server/csrf";

export const dynamic = "force-dynamic";

const UnlockSchema = z.object({
  passcode: z.string().trim().min(1).max(128),
});

function getClientKey(request: NextRequest): string {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "remote";
  return request.headers.get("host") || "local";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request, {
    requireJson: true,
    allowUnauthenticatedUnlock: true,
  });
  if (csrfError) return csrfError;

  if (!getRemotePasscode()) {
    return NextResponse.json(
      { error: "Remote tunnel passcode is not enabled on this server." },
      { status: 403 },
    );
  }

  const clientKey = getClientKey(request);
  const limit = checkUnlockRateLimit(clientKey);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Too many failed attempts. Try again in ${limit.retryAfterSec ?? 60}s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec ?? 60) },
      },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = UnlockSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter the RelayHUD remote passcode." },
      { status: 400 },
    );
  }

  if (!verifyPasscode(parsed.data.passcode)) {
    recordFailedUnlock(clientKey);
    return NextResponse.json(
      { error: "Invalid passcode." },
      { status: 401 },
    );
  }

  clearFailedUnlock(clientKey);
  const token = createSessionToken();
  const isHttps =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ===
      "https" || request.nextUrl.protocol === "https:";

  const res = NextResponse.json({ unlocked: true });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return res;
}
