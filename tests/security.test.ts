import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { resolveMiniMeterTone } from "@/components/MiniMeter";
import { verifySameOriginRequest } from "@/server/csrf";

describe("Localhost CSRF & UI Threshold Regressions", () => {
  it("blocks cross-origin POST and non-JSON text/plain payloads", () => {
    const evilOriginReq = new NextRequest("http://localhost:3456/api/jobs", {
      method: "POST",
      headers: {
        host: "localhost:3456",
        origin: "https://evil.example",
        "content-type": "application/json",
      },
    });
    expect(verifySameOriginRequest(evilOriginReq, { requireJson: true })?.status).toBe(403);

    const crossSiteReq = new NextRequest("http://localhost:3456/api/jobs", {
      method: "POST",
      headers: {
        host: "localhost:3456",
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
      },
    });
    expect(verifySameOriginRequest(crossSiteReq, { requireJson: true })?.status).toBe(403);

    const textPlainReq = new NextRequest("http://localhost:3456/api/jobs", {
      method: "POST",
      headers: {
        host: "localhost:3456",
        origin: "http://localhost:3456",
        "content-type": "text/plain",
      },
    });
    expect(verifySameOriginRequest(textPlainReq, { requireJson: true })?.status).toBe(415);

    const validLocalReq = new NextRequest("http://localhost:3456/api/jobs", {
      method: "POST",
      headers: {
        host: "localhost:3456",
        origin: "http://localhost:3456",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
    });
    expect(verifySameOriginRequest(validLocalReq, { requireJson: true })).toBeNull();

    // Regression: missing/empty Host header must be rejected with 403.
    const missingHostReq = new NextRequest("http://localhost:3456/api/jobs", {
      method: "GET",
    });
    expect(verifySameOriginRequest(missingHostReq)?.status).toBe(403);

    // IPv6 loopback host should be accepted.
    const ipv6Req = new NextRequest("http://[::1]:3456/api/hud", {
      method: "GET",
      headers: { host: "[::1]:3456" },
    });
    expect(verifySameOriginRequest(ipv6Req)).toBeNull();
  });

  it("maps MiniMeter >= 95% to red and 85-94% to amber", () => {
    expect(resolveMiniMeterTone(96)).toBe("red");
    expect(resolveMiniMeterTone(95)).toBe("red");
    expect(resolveMiniMeterTone(90)).toBe("amber");
    expect(resolveMiniMeterTone(85)).toBe("amber");
    expect(resolveMiniMeterTone(40)).toBe("default");
    expect(resolveMiniMeterTone(40, "green")).toBe("green");
  });
});
