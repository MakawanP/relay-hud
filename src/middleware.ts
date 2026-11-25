import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedRequest } from "@/server/csrf";

/**
 * Defense in depth: every API route already calls verifySameOriginRequest, but this
 * gate makes authentication the default so a newly added route cannot forget it.
 * Only the sign-in flow itself is reachable without a session.
 */
const PUBLIC_API_PATHS: readonly RegExp[] = [
  /^\/api\/auth\/unlock$/,
  /^\/api\/auth\/logout$/,
  /^\/api\/auth\/sso\/(google|oidc)\/(start|callback)$/,
];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (PUBLIC_API_PATHS.some((re) => re.test(pathname))) {
    return NextResponse.next();
  }
  return requireAuthenticatedRequest(request) ?? NextResponse.next();
}

export const config = {
  runtime: "nodejs",
  matcher: ["/api/:path*"],
};
