import { afterEach, describe, expect, it } from "vitest";
import { createSessionToken, getSessionInfo } from "@/server/auth";
import { isSsoIdentityAllowed, parseIdTokenClaims } from "@/server/oidc";
import {
  validateOidcIssuerUrl,
  validateProviderBaseUrl,
} from "@/server/url-guard";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}

describe("SSO, OIDC & SSRF URL Guards", () => {
  const origPasscode = process.env.RELAY_HUD_REMOTE_PASSCODE;

  afterEach(() => {
    if (origPasscode === undefined) {
      delete process.env.RELAY_HUD_REMOTE_PASSCODE;
    } else {
      process.env.RELAY_HUD_REMOTE_PASSCODE = origPasscode;
    }
  });

  it("enforces fail-closed identity allowlists for Google & OIDC SSO", () => {
    // Empty allowlist must always fail closed
    expect(
      isSsoIdentityAllowed({
        email: "alice@gmail.com",
        emailVerified: true,
        requireEmailVerified: true,
        allowedEmails: [],
        allowedDomains: [],
      }).allowed,
    ).toBe(false);

    // Unverified Google email must be rejected
    expect(
      isSsoIdentityAllowed({
        email: "alice@gmail.com",
        emailVerified: false,
        requireEmailVerified: true,
        allowedEmails: ["alice@gmail.com"],
        allowedDomains: [],
      }).allowed,
    ).toBe(false);

    // Exact email match (case-insensitive)
    const exact = isSsoIdentityAllowed({
      email: "Alice@Gmail.com",
      emailVerified: true,
      requireEmailVerified: true,
      allowedEmails: ["alice@gmail.com"],
      allowedDomains: [],
    });
    expect(exact.allowed).toBe(true);
    expect(exact.normalizedEmail).toBe("alice@gmail.com");

    // Domain match
    const domain = isSsoIdentityAllowed({
      email: "eng@acme.dev",
      emailVerified: true,
      requireEmailVerified: false,
      allowedEmails: [],
      allowedDomains: ["@acme.dev"],
    });
    expect(domain.allowed).toBe(true);

    // Non-matching email rejected
    expect(
      isSsoIdentityAllowed({
        email: "intruder@evil.org",
        emailVerified: true,
        requireEmailVerified: true,
        allowedEmails: ["alice@gmail.com"],
        allowedDomains: ["acme.dev"],
      }).allowed,
    ).toBe(false);
  });

  it("validates OIDC ID token audience, issuer, nonce, and expiry", () => {
    const valid = makeJwt({
      iss: "https://accounts.google.com",
      aud: "client-123",
      nonce: "nonce-xyz",
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: "owner@gmail.com",
      email_verified: true,
    });
    const claims = parseIdTokenClaims(valid, {
      issuer: "https://accounts.google.com",
      clientId: "client-123",
      nonce: "nonce-xyz",
    });
    expect(claims.email).toBe("owner@gmail.com");
    expect(claims.emailVerified).toBe(true);

    // Wrong audience
    expect(() =>
      parseIdTokenClaims(valid, {
        issuer: "https://accounts.google.com",
        clientId: "wrong-client",
        nonce: "nonce-xyz",
      }),
    ).toThrow(/audience/i);

    // Wrong nonce
    expect(() =>
      parseIdTokenClaims(valid, {
        issuer: "https://accounts.google.com",
        clientId: "client-123",
        nonce: "wrong-nonce",
      }),
    ).toThrow(/nonce/i);

    // Expired token
    const expired = makeJwt({
      iss: "https://accounts.google.com",
      aud: "client-123",
      exp: Math.floor(Date.now() / 1000) - 600,
    });
    expect(() =>
      parseIdTokenClaims(expired, {
        issuer: "https://accounts.google.com",
        clientId: "client-123",
      }),
    ).toThrow(/expired/i);
  });

  it("preserves authenticated email and SSO method inside signed session cookies", () => {
    process.env.RELAY_HUD_REMOTE_PASSCODE = "TEST-PASS-1234-5678";
    const token = createSessionToken({
      email: "owner@company.com",
      method: "oidc_sso",
    });
    expect(getSessionInfo(token)).toEqual({
      email: "owner@company.com",
      method: "oidc_sso",
    });
  });

  it("blocks cloud metadata and insecure remote URLs while allowing HTTPS and local Ollama", () => {
    expect(validateProviderBaseUrl("https://api.openai.com/v1/")).toBe(
      "https://api.openai.com/v1",
    );
    expect(validateProviderBaseUrl("http://127.0.0.1:11434/v1")).toBe(
      "http://127.0.0.1:11434/v1",
    );
    expect(validateProviderBaseUrl("http://192.168.1.50:1234/v1")).toBe(
      "http://192.168.1.50:1234/v1",
    );
    expect(() =>
      validateProviderBaseUrl("http://169.254.169.254/latest/meta-data"),
    ).toThrow(/blocked/i);
    expect(() =>
      validateProviderBaseUrl("http://api.openai.com/v1"),
    ).toThrow(/https/i);
    expect(() =>
      validateProviderBaseUrl("file:///etc/passwd"),
    ).toThrow();

    expect(validateOidcIssuerUrl("https://dev.us.auth0.com/")).toBe(
      "https://dev.us.auth0.com",
    );
    expect(validateOidcIssuerUrl("http://localhost:8080/realms/demo")).toBe(
      "http://localhost:8080/realms/demo",
    );
    expect(() =>
      validateOidcIssuerUrl("http://metadata.google.internal"),
    ).toThrow(/blocked/i);
    expect(() =>
      validateOidcIssuerUrl("http://auth.example.com"),
    ).toThrow(/https/i);
  });
});
