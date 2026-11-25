import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalCredentialVault, maskSecret } from "@/server/vault";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-hud-vault-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("LocalCredentialVault", () => {
  it("encrypts credentials with AES-256-GCM and never writes plaintext to disk", () => {
    const dir = createTempDir();
    const vault = new LocalCredentialVault(dir);

    vault.setAccountSecret("google-1", { apiKey: "AIzaSySecretKeyGoogleOne1234" });
    vault.setAccountSecret("google-2", {
      oauthAccessToken: "ya29.secret_access_token",
      oauthRefreshToken: "1//secret_refresh_token",
      oauthEmail: "work@studio.dev",
    });
    vault.setAccountSecret("claude-1", {
      apiKey: "sk-ant-api03-SuperSecretClaudeKey9999",
    });

    const rawDisk = fs.readFileSync(path.join(dir, "vault.enc"), "utf8");
    expect(rawDisk).not.toContain("AIzaSySecretKeyGoogleOne1234");
    expect(rawDisk).not.toContain("ya29.secret_access_token");
    expect(rawDisk).not.toContain("sk-ant-api03-SuperSecretClaudeKey9999");

    const mode = fs.statSync(path.join(dir, "vault.enc")).mode & 0o777;
    expect(mode).toBe(0o600);

    // Re-open with fresh instance to verify cold-start decryption
    const reloaded = new LocalCredentialVault(dir);
    expect(reloaded.getAccountSecret("google-1").apiKey).toBe(
      "AIzaSySecretKeyGoogleOne1234",
    );
    expect(reloaded.getAccountSecret("google-2").oauthEmail).toBe(
      "work@studio.dev",
    );
    expect(reloaded.getAccountSecret("claude-1").apiKey).toBe(
      "sk-ant-api03-SuperSecretClaudeKey9999",
    );
  });

  it("detects ciphertext tampering via GCM auth tag", () => {
    const dir = createTempDir();
    const vault = new LocalCredentialVault(dir);
    vault.setAccountSecret("claude-1", { apiKey: "sk-ant-api03-IntegrityCheck123" });

    const vaultFile = path.join(dir, "vault.enc");
    const parsed = JSON.parse(fs.readFileSync(vaultFile, "utf8")) as {
      alg: string;
      iv: string;
      tag: string;
      ciphertext: string;
    };
    const tamperedFirstByte = parsed.ciphertext.startsWith("00") ? "ff" : "00";
    parsed.ciphertext = tamperedFirstByte + parsed.ciphertext.slice(2);
    fs.writeFileSync(vaultFile, JSON.stringify(parsed));

    expect(() => vault.readAll()).toThrow();
  });

  it("rejects truncated GCM auth tags or invalid IV lengths", () => {
    const dir = createTempDir();
    const vault = new LocalCredentialVault(dir);
    vault.setAccountSecret("claude-1", { apiKey: "sk-ant-api03-TagLengthCheck123" });

    const vaultFile = path.join(dir, "vault.enc");
    const parsed = JSON.parse(fs.readFileSync(vaultFile, "utf8")) as {
      alg: string;
      iv: string;
      tag: string;
      ciphertext: string;
    };
    parsed.tag = parsed.tag.slice(0, 16); // 8-byte truncated tag
    fs.writeFileSync(vaultFile, JSON.stringify(parsed));

    expect(() => vault.readAll()).toThrow(/invalid IV or GCM auth tag/i);
  });

  it("masks secrets cleanly without exposing full keys or short-key overlaps", () => {
    expect(maskSecret("AIzaSyTest1234567890abcd")).toBe("AIza••••abcd");
    expect(maskSecret("sk-ant-api03-998877665544wxyz")).toBe("sk-ant-••••wxyz");
    expect(maskSecret("sk-ant-1234")).toBe("••••••••");
    expect(maskSecret("1234567890")).toBe("••••••••");
    expect(maskSecret(null)).toBeNull();
  });
});
