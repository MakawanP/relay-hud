import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  checkUnlockRateLimit,
  clearFailedUnlock,
  createSessionToken,
  recordFailedUnlock,
  resolvePublicOrigin,
  verifyPasscode,
  verifySessionToken,
} from "@/server/auth";
import { verifySameOriginRequest } from "@/server/csrf";

describe("Protected Tunnel Auth & CSRF Gate", () => {
  const originalPasscode = process.env.RELAY_HUD_REMOTE_PASSCODE;

  beforeEach(() => {
    delete process.env.RELAY_HUD_REMOTE_PASSCODE;
  });

  afterEach(() => {
    if (originalPasscode === undefined) {
      delete process.env.RELAY_HUD_REMOTE_PASSCODE;
    } else {
      process.env.RELAY_HUD_REMOTE_PASSCODE = originalPasscode;
    }
    clearFailedUnlock("test-client-ip");
  });

  it("verifies passcodes in constant time and rejects short or unset env", () => {
    expect(verifyPasscode("ABCD-1234-EFGH-5678")).toBe(false);

    process.env.RELAY_HUD_REMOTE_PASSCODE = "short";
    expect(verifyPasscode("short")).toBe(false);

    process.env.RELAY_HUD_REMOTE_PASSCODE = "ABCD-1234-EFGH-5678";
    expect(verifyPasscode("ABCD-1234-EFGH-5678")).toBe(true);
    expect(verifyPasscode("  ABCD-1234-EFGH-5678  ")).toBe(true);
    expect(verifyPasscode("ABCD-1234-EFGH-5679")).toBe(false);
    expect(verifyPasscode("")).toBe(false);
  });

  it("issues HMAC session tokens that fail on tamper, expiry, or passcode rotation", () => {
    process.env.RELAY_HUD_REMOTE_PASSCODE = "ABCD-1234-EFGH-5678";
    const token = createSessionToken();
    expect(verifySessionToken(token)).toBe(true);

    const [exp, sig] = token.split(".");
    expect(exp).toBeTruthy();
    expect(sig).toBeTruthy();

    // Tampered signature
    const flipped = `${sig?.[0] === "a" ? "b" : "a"}${sig?.slice(1) ?? ""}`;
    expect(verifySessionToken(`${exp}.${flipped}`)).toBe(false);

    // Expired payload with forged signature
    const expiredPayload = Buffer.from(
      JSON.stringify({ exp: Date.now() - 10_000, sub: "a@b.com", method: "passcode" }),
      "utf8",
    ).toString("base64url");
    expect(verifySessionToken(`${expiredPayload}.${sig}`)).toBe(false);

    // Rotating passcode invalidates previously signed sessions
    process.env.RELAY_HUD_REMOTE_PASSCODE = "WXYZ-9999-MNOP-8888";
    expect(verifySessionToken(token)).toBe(false);
  });

  it("rate-limits repeated failed unlock attempts per client key", () => {
    const key = "test-client-ip";
    for (let i = 0; i < 8; i += 1) {
      expect(checkUnlockRateLimit(key).allowed).toBe(true);
      recordFailedUnlock(key);
    }
    const blocked = checkUnlockRateLimit(key);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);

    clearFailedUnlock(key);
    expect(checkUnlockRateLimit(key).allowed).toBe(true);
  });

  it("resolves public HTTPS origin behind Cloudflare tunnel headers", () => {
    const h1 = new Headers({
      host: "relay-test.trycloudflare.com",
      "x-forwarded-proto": "https",
    });
    expect(resolvePublicOrigin(h1, "http://127.0.0.1:3456")).toBe(
      "https://relay-test.trycloudflare.com",
    );

    const h2 = new Headers({
      host: "relay-test.trycloudflare.com",
      "cf-visitor": '{"scheme":"https"}',
    });
    expect(resolvePublicOrigin(h2, "http://127.0.0.1:3456")).toBe(
      "https://relay-test.trycloudflare.com",
    );
  });

  it("enforces remote tunnel auth and HTTPS origin matching in verifySameOriginRequest", () => {
    const remoteHost = "relay-demo.trycloudflare.com";

    // Without RELAY_HUD_REMOTE_PASSCODE, remote hosts are rejected with 403
    const disabledReq = new NextRequest("http://127.0.0.1:3456/api/hud", {
      method: "GET",
      headers: {
        host: remoteHost,
        "x-forwarded-proto": "https",
      },
    });
    expect(verifySameOriginRequest(disabledReq)?.status).toBe(403);

    process.env.RELAY_HUD_REMOTE_PASSCODE = "ABCD-1234-EFGH-5678";

    // Without session cookie -> 401 Unauthorized
    const unauthReq = new NextRequest("http://127.0.0.1:3456/api/hud", {
      method: "GET",
      headers: {
        host: remoteHost,
        "x-forwarded-proto": "https",
      },
    });
    expect(verifySameOriginRequest(unauthReq)?.status).toBe(401);

    // Unlock endpoint allows unauthenticated POST with matching HTTPS Origin + JSON
    const unlockReq = new NextRequest("http://127.0.0.1:3456/api/auth/unlock", {
      method: "POST",
      headers: {
        host: remoteHost,
        "x-forwarded-proto": "https",
        origin: `https://${remoteHost}`,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
    });
    expect(
      verifySameOriginRequest(unlockReq, {
        requireJson: true,
        allowUnauthenticatedUnlock: true,
      }),
    ).toBeNull();

    // Valid session cookie + matching HTTPS origin -> allowed
    const token = createSessionToken();
    const authedReq = new NextRequest("http://127.0.0.1:3456/api/jobs", {
      method: "POST",
      headers: {
        host: remoteHost,
        "x-forwarded-proto": "https",
        origin: `https://${remoteHost}`,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });
    expect(verifySameOriginRequest(authedReq, { requireJson: true })).toBeNull();

    // Valid session cookie + cross-origin -> still blocked with 403
    const evilRemoteReq = new NextRequest("http://127.0.0.1:3456/api/jobs", {
      method: "POST",
      headers: {
        host: remoteHost,
        "x-forwarded-proto": "https",
        origin: "https://attacker.example",
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });
    expect(
      verifySameOriginRequest(evilRemoteReq, { requireJson: true })?.status,
    ).toBe(403);
  });
});
