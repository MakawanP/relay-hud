import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE_NAME,
  checkUnlockRateLimit,
  clearFailedUnlock,
  createSessionToken,
  getRemotePasscode,
  getUnlockClientKey,
  SESSION_TTL_MS,
  recordFailedUnlock,
  verifyPasscode,
} from "@/server/auth";
import { verifySameOriginRequest } from "@/server/csrf";

export const dynamic = "force-dynamic";

const UnlockSchema = z.object({
  passcode: z.string().trim().min(1).max(128),
});

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

  const clientKey = getUnlockClientKey(request.headers);
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
    maxAge: SESSION_TTL_MS / 1000,
  });
  return res;
}
