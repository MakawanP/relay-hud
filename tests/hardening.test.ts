import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  checkUnlockRateLimit,
  createSessionToken,
  getUnlockClientKey,
  isTrustedLocalRequest,
  recordFailedUnlock,
  resetAuthStateForTests,
  revokeSessionToken,
  verifySessionToken,
} from "@/server/auth";
import {
  requireAuthenticatedRequest,
  requireLocalAdmin,
  verifySameOriginRequest,
} from "@/server/csrf";
import { middleware } from "@/middleware";
import { parseIdTokenClaims } from "@/server/oidc";
import {
  CLAUDE_CLI_DISALLOWED_TOOLS,
  buildSanitizedCliEnv,
  createCliSandbox,
} from "@/server/providers/cli-sandbox";
import { HudStateStore } from "@/server/store";
import { LocalCredentialVault } from "@/server/vault";

const PASSCODE = "ABCD-1234-EFGH-5678";
const ENV_KEYS = [
  "RELAY_HUD_REMOTE_PASSCODE",
  "RELAY_HUD_STRICT_AUTH",
  "RELAY_HUD_TEST_SECRET",
] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  delete process.env.RELAY_HUD_REMOTE_PASSCODE;
  delete process.env.RELAY_HUD_STRICT_AUTH;
  resetAuthStateForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetAuthStateForTests();
});

function req(
  url: string,
  headers: Record<string, string>,
  method = "GET",
): NextRequest {
  return new NextRequest(url, { method, headers });
}

/** What Next.js hands a route for a plain browser request on this Mac. */
const LOCAL_BROWSER_HEADERS = {
  host: "127.0.0.1:3456",
  "x-forwarded-for": "127.0.0.1",
  "x-forwarded-host": "127.0.0.1:3456",
  "x-forwarded-proto": "http",
};

describe("Local-request trust (finding #1)", () => {
  it("trusts a plain loopback browser request", () => {
    expect(isTrustedLocalRequest(new Headers(LOCAL_BROWSER_HEADERS))).toBe(true);
    expect(isTrustedLocalRequest(new Headers({ host: "localhost:3456" }))).toBe(true);
  });

  it("does not trust loopback Host when a proxy forwarded the request", () => {
    // nginx default proxy_pass + X-Forwarded-For from the real client
    expect(
      isTrustedLocalRequest(
        new Headers({ ...LOCAL_BROWSER_HEADERS, "x-forwarded-for": "203.0.113.9" }),
      ),
    ).toBe(false);
    // Proxy chain that appended a public hop
    expect(
      isTrustedLocalRequest(
        new Headers({
          ...LOCAL_BROWSER_HEADERS,
          "x-forwarded-for": "203.0.113.9, 127.0.0.1",
        }),
      ),
    ).toBe(false);
    // Proxy preserved the public host in X-Forwarded-Host while rewriting Host
    expect(
      isTrustedLocalRequest(
        new Headers({ ...LOCAL_BROWSER_HEADERS, "x-forwarded-host": "relay.example.com" }),
      ),
    ).toBe(false);
    // Tunnel / CDN markers
    for (const [name, value] of [
      ["cf-connecting-ip", "203.0.113.9"],
      ["x-real-ip", "203.0.113.9"],
      ["forwarded", "for=203.0.113.9"],
      ["cf-ray", "abc123-IAD"],
    ] as const) {
      expect(
        isTrustedLocalRequest(new Headers({ ...LOCAL_BROWSER_HEADERS, [name]: value })),
      ).toBe(false);
    }
  });

  it("requires a session for spoofed loopback Host once remote auth is on", () => {
    process.env.RELAY_HUD_REMOTE_PASSCODE = PASSCODE;
    const spoofed = req("http://127.0.0.1:3456/api/hud", {
      ...LOCAL_BROWSER_HEADERS,
      "x-forwarded-for": "198.51.100.7",
    });
    expect(verifySameOriginRequest(spoofed)?.status).toBe(401);
    expect(requireAuthenticatedRequest(spoofed)?.status).toBe(401);

    const withSession = req("http://127.0.0.1:3456/api/hud", {
      ...LOCAL_BROWSER_HEADERS,
      "x-forwarded-for": "198.51.100.7",
      cookie: `${SESSION_COOKIE_NAME}=${createSessionToken()}`,
    });
    expect(verifySameOriginRequest(withSession)).toBeNull();
  });

  it("rejects forwarded loopback requests outright when remote auth is off", () => {
    const spoofed = req("http://127.0.0.1:3456/api/hud", {
      ...LOCAL_BROWSER_HEADERS,
      "cf-connecting-ip": "198.51.100.7",
    });
    expect(verifySameOriginRequest(spoofed)?.status).toBe(403);
  });

  it("strict mode trusts nothing implicitly", () => {
    process.env.RELAY_HUD_REMOTE_PASSCODE = PASSCODE;
    process.env.RELAY_HUD_STRICT_AUTH = "true";
    expect(isTrustedLocalRequest(new Headers(LOCAL_BROWSER_HEADERS))).toBe(false);
    expect(
      verifySameOriginRequest(req("http://127.0.0.1:3456/api/hud", LOCAL_BROWSER_HEADERS))
        ?.status,
    ).toBe(401);
  });
});

describe("Middleware default-deny", () => {
  it("blocks unauthenticated API calls but leaves the sign-in flow reachable", () => {
    process.env.RELAY_HUD_REMOTE_PASSCODE = PASSCODE;
    const remote = { host: "relay.example.com", "x-forwarded-for": "198.51.100.7" };

    expect(middleware(req("http://relay.example.com/api/accounts", remote)).status).toBe(401);
    expect(
      middleware(req("http://relay.example.com/api/new-route-nobody-guarded", remote)).status,
    ).toBe(401);

    for (const open of [
      "/api/auth/unlock",
      "/api/auth/logout",
      "/api/auth/sso/google/start",
      "/api/auth/sso/oidc/callback",
    ]) {
      const res = middleware(req(`http://relay.example.com${open}`, remote));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });
});

describe("Owner-only settings (finding #2)", () => {
  it("lets this Mac change SSO settings but not a remote session", () => {
    process.env.RELAY_HUD_REMOTE_PASSCODE = PASSCODE;
    expect(
      requireLocalAdmin(req("http://127.0.0.1:3456/api/auth/sso/config", LOCAL_BROWSER_HEADERS)),
    ).toBeNull();

    const remoteWithSession = req("https://relay.example.com/api/auth/sso/config", {
      host: "relay.example.com",
      "cf-connecting-ip": "198.51.100.7",
      cookie: `${SESSION_COOKIE_NAME}=${createSessionToken()}`,
    });
    expect(requireAuthenticatedRequest(remoteWithSession)).toBeNull();
    expect(requireLocalAdmin(remoteWithSession)?.status).toBe(403);
  });

  it("in strict mode allows a passcode session on a loopback Host only", () => {
    process.env.RELAY_HUD_REMOTE_PASSCODE = PASSCODE;
    process.env.RELAY_HUD_STRICT_AUTH = "true";
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken()}`;
    expect(
      requireLocalAdmin(
        req("http://127.0.0.1:3456/api/auth/sso/config", { ...LOCAL_BROWSER_HEADERS, cookie }),
      ),
    ).toBeNull();
    expect(
      requireLocalAdmin(
        req("http://127.0.0.1:3456/api/auth/sso/config", LOCAL_BROWSER_HEADERS),
      )?.status,
    ).toBe(403);
  });
});

describe("Unlock rate limiting (finding #5)", () => {
  it("caps failures server-wide so rotating spoofed client keys does not help", () => {
    for (let i = 0; i < 40; i += 1) {
      const key = getUnlockClientKey(
        new Headers({ "x-forwarded-for": `198.51.100.${i}` }),
      );
      expect(checkUnlockRateLimit(key).allowed).toBe(true);
      recordFailedUnlock(key);
    }
    const fresh = getUnlockClientKey(new Headers({ "x-forwarded-for": "192.0.2.1" }));
    const verdict = checkUnlockRateLimit(fresh);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSec).toBeGreaterThan(0);
  });

  it("prefers CF-Connecting-IP and namespaces keys", () => {
    expect(
      getUnlockClientKey(
        new Headers({ "cf-connecting-ip": "203.0.113.5", "x-forwarded-for": "1.1.1.1" }),
      ),
    ).toBe("cf:203.0.113.5");
    expect(getUnlockClientKey(new Headers())).toBe("unknown");
  });
});

describe("Session revocation (finding #7)", () => {
  it("logout revokes that token without affecting others", () => {
    process.env.RELAY_HUD_REMOTE_PASSCODE = PASSCODE;
    const a = createSessionToken();
    const b = createSessionToken();
    revokeSessionToken(a);
    expect(verifySessionToken(a)).toBe(false);
    expect(verifySessionToken(b)).toBe(true);
    // Garbage input is ignored.
    expect(() => revokeSessionToken("not-a-token")).not.toThrow();
  });
});

function makeJwt(payload: Record<string, unknown>): string {
  const enc = (v: unknown): string =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${enc({ alg: "RS256" })}.${enc(payload)}.sig`;
}

describe("OIDC id_token claims (finding #6)", () => {
  const exp = Math.floor(Date.now() / 1000) + 600;

  it("rejects a missing or mismatched issuer when one is expected", () => {
    expect(() =>
      parseIdTokenClaims(makeJwt({ aud: "c1", exp }), { issuer: "https://idp", clientId: "c1" }),
    ).toThrow(/issuer/i);
    expect(() =>
      parseIdTokenClaims(makeJwt({ iss: "https://evil", aud: "c1", exp }), {
        issuer: "https://idp",
        clientId: "c1",
      }),
    ).toThrow(/issuer/i);
  });

  it("accepts both Google issuer spellings and rejects tokens without exp", () => {
    const issuers = ["https://accounts.google.com", "accounts.google.com"];
    for (const iss of issuers) {
      expect(() =>
        parseIdTokenClaims(makeJwt({ iss, aud: "c1", exp }), { issuer: issuers, clientId: "c1" }),
      ).not.toThrow();
    }
    expect(() =>
      parseIdTokenClaims(makeJwt({ iss: issuers[0], aud: "c1" }), {
        issuer: issuers,
        clientId: "c1",
      }),
    ).toThrow(/exp/i);
  });
});

describe("CLI sandbox (finding #3)", () => {
  it("runs CLIs from an empty private temp dir and cleans it up", () => {
    const sandbox = createCliSandbox();
    expect(fs.readdirSync(sandbox.cwd)).toEqual([]);
    expect(sandbox.cwd.startsWith(os.tmpdir())).toBe(true);
    expect(fs.statSync(sandbox.cwd).mode & 0o777).toBe(0o700);
    sandbox.cleanup();
    expect(fs.existsSync(sandbox.cwd)).toBe(false);
  });

  it("strips RelayHUD secrets from the child environment and denies file tools", () => {
    process.env.RELAY_HUD_TEST_SECRET = "s3cret";
    const env = buildSanitizedCliEnv();
    expect(Object.keys(env).some((k) => k.startsWith("RELAY_HUD_"))).toBe(false);
    expect(env.PATH).toBe(process.env.PATH);
    expect(CLAUDE_CLI_DISALLOWED_TOOLS).toEqual(
      expect.arrayContaining(["Read", "Bash", "Glob", "Grep", "WebFetch"]),
    );
  });
});

describe("Encrypted state.json (finding #4)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("writes job prompts encrypted and migrates legacy plaintext state", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-hud-hardening-"));
    dirs.push(dir);
    const vault = new LocalCredentialVault(dir);
    const statePath = path.join(dir, "state.json");

    // Legacy plaintext file from an older RelayHUD version.
    const legacy = new HudStateStore(dir, vault);
    legacy.setRoutingPolicy("claude_first");
    const decrypted = vault.decryptEnvelope(JSON.parse(fs.readFileSync(statePath, "utf8")));
    fs.writeFileSync(statePath, decrypted);
    expect(fs.readFileSync(statePath, "utf8")).toContain("claude_first");

    const migrated = new HudStateStore(dir, vault);
    expect(migrated.getRoutingPolicy()).toBe("claude_first");
    migrated.setRoutingPolicy("google_first");

    const onDisk = fs.readFileSync(statePath, "utf8");
    expect(onDisk).not.toContain("google_first");
    expect(LocalCredentialVault.isEncryptedEnvelope(JSON.parse(onDisk))).toBe(true);
    expect(new HudStateStore(dir, vault).getRoutingPolicy()).toBe("google_first");
  });
});
