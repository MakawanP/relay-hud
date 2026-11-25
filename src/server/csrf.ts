import { NextRequest, NextResponse } from "next/server";
import type { SessionUserInfo } from "@/domain/types";
import {
  SESSION_COOKIE_NAME,
  getSessionInfo,
  isLoopbackHost,
  isRemoteAuthConfigured,
  isStrictAuthMode,
  isTrustedLocalRequest,
  resolvePublicOrigin,
} from "./auth";

function resolveExpectedOrigin(request: NextRequest, hostHeader: string): string {
  const fallback = `${request.nextUrl.protocol}//${hostHeader}`;
  return resolvePublicOrigin(request.headers, fallback);
}

/**
 * Authentication gate shared by every route: trusted local requests pass, everything
 * else needs a valid passcode / SSO session cookie. Returns null when allowed.
 */
export function requireAuthenticatedRequest(
  request: NextRequest,
): NextResponse | null {
  const hostHeader = (request.headers.get("host") ?? "").trim();
  if (!hostHeader) {
    return NextResponse.json(
      { error: "Forbidden: Missing Host header." },
      { status: 403 },
    );
  }
  if (isTrustedLocalRequest(request.headers)) return null;

  if (!isRemoteAuthConfigured()) {
    return NextResponse.json(
      { error: "Forbidden: RelayHUD only accepts local loopback requests." },
      { status: 403 },
    );
  }
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!getSessionInfo(token)) {
    return NextResponse.json(
      { error: "Unauthorized: Passcode or SSO sign-in required." },
      { status: 401 },
    );
  }
  return null;
}

export function getRequestSession(request: NextRequest): SessionUserInfo | null {
  return getSessionInfo(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

/**
 * Gate for owner-only settings (SSO allowlist / identity providers / OAuth client).
 * A remote session must never be able to widen who can sign in, otherwise a single
 * stolen 12h cookie becomes permanent access.
 *
 * Allowed: trusted local requests, or — in strict mode, where nothing is implicitly
 * local — a passcode session on a loopback Host.
 */
export function requireLocalAdmin(request: NextRequest): NextResponse | null {
  if (isTrustedLocalRequest(request.headers)) return null;
  if (
    isStrictAuthMode() &&
    isLoopbackHost(request.headers.get("host")) &&
    getRequestSession(request)?.method === "passcode"
  ) {
    return null;
  }
  return NextResponse.json(
    {
      error:
        "Forbidden: SSO and OAuth client settings can only be changed from this Mac (http://127.0.0.1:3456).",
    },
    { status: 403 },
  );
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

  const trustedLocal = isTrustedLocalRequest(request.headers);

  if (!trustedLocal) {
    if (!isRemoteAuthConfigured()) {
      return NextResponse.json(
        { error: "Forbidden: RelayHUD only accepts local loopback requests." },
        { status: 403 },
      );
    }
    if (!options.allowUnauthenticatedUnlock) {
      const authError = requireAuthenticatedRequest(request);
      if (authError) return authError;
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
      if (isLoopbackHost(hostHeader)) {
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
