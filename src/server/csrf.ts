import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  isLoopbackHost,
  isRemoteAuthConfigured,
  resolvePublicOrigin,
  verifySessionToken,
} from "./auth";

function resolveExpectedOrigin(request: NextRequest, hostHeader: string): string {
  const fallback = `${request.nextUrl.protocol}//${hostHeader}`;
  return resolvePublicOrigin(request.headers, fallback);
}

export function verifySameOriginRequest(
  request: NextRequest,
  options: { requireJson?: boolean; allowUnauthenticatedUnlock?: boolean } = {},
): NextResponse | null {
  const hostHeader = (request.headers.get("host") ?? "").trim();
  if (!hostHeader) {
    return NextResponse.json(
      { error: "Forbidden: Missing Host header." },
      { status: 403 },
    );
  }

  const loopback = isLoopbackHost(hostHeader);

  if (!loopback) {
    if (!isRemoteAuthConfigured()) {
      return NextResponse.json(
        { error: "Forbidden: RelayHUD only accepts local loopback requests." },
        { status: 403 },
      );
    }
    if (!options.allowUnauthenticatedUnlock) {
      const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
      if (!verifySessionToken(token)) {
        return NextResponse.json(
          { error: "Unauthorized: Passcode or SSO sign-in required." },
          { status: 401 },
        );
      }
    }
  }

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (
    secFetchSite &&
    secFetchSite !== "same-origin" &&
    secFetchSite !== "none"
  ) {
    return NextResponse.json(
      { error: "Forbidden: Cross-site request blocked." },
      { status: 403 },
    );
  }

  const origin = request.headers.get("origin");
  if (origin) {
    const expectedOrigin = resolveExpectedOrigin(request, hostHeader);
    if (origin !== expectedOrigin) {
      if (loopback) {
        try {
          const originUrl = new URL(origin);
          const targetUrl = new URL(expectedOrigin);
          const samePort = originUrl.port === targetUrl.port;
          if (!samePort || !isLoopbackHost(originUrl.host)) {
            return NextResponse.json(
              { error: "Forbidden: Cross-origin request blocked." },
              { status: 403 },
            );
          }
        } catch {
          return NextResponse.json(
            { error: "Forbidden: Malformed Origin header." },
            { status: 403 },
          );
        }
      } else {
        return NextResponse.json(
          { error: "Forbidden: Cross-origin request blocked." },
          { status: 403 },
        );
      }
    }
  }

  if (options.requireJson) {
    const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      return NextResponse.json(
        { error: "Unsupported Media Type: Expected application/json." },
        { status: 415 },
      );
    }
  }

  return null;
}
