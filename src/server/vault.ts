import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AccountId } from "@/domain/types";

export interface AccountSecretRecord {
  apiKey?: string;
  oauthAccessToken?: string;
  oauthRefreshToken?: string;
  oauthExpiresAt?: string;
  oauthEmail?: string;
}

export interface SsoVaultConfig {
  googleAppLoginEnabled?: boolean;
  oidcAppLoginEnabled?: boolean;
  oidcLabel?: string;
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcScopes?: string;
  allowedEmails?: string[];
  allowedDomains?: string[];
}

export interface VaultPayload {
  version: 1;
  accounts: Record<string, AccountSecretRecord>;
  oauthApp?: {
    googleClientId?: string;
    googleClientSecret?: string;
  };
  sso?: SsoVaultConfig;
}

export interface ResolvedSsoConfig {
  googleClientId: string | null;
  googleClientSecret: string | null;
  googleAppLoginEnabled: boolean;
  oidcAppLoginEnabled: boolean;
  oidcLabel: string;
  oidcIssuer: string | null;
  oidcClientId: string | null;
  oidcClientSecret: string | null;
  oidcScopes: string;
  allowedEmails: string[];
  allowedDomains: string[];
}

interface EncryptedEnvelope {
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

/** RelayHUD's data folder: RELAY_HUD_DATA_DIR when set, otherwise `.data/` in the working directory. */
export function resolveDataDir(): string {
  const fromEnv = process.env.RELAY_HUD_DATA_DIR?.trim();
  return fromEnv ? path.resolve(fromEnv) : path.join(process.cwd(), ".data");
}
const HEX_PATTERN = /^[0-9a-f]+$/i;

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

function writeFileSecure(filePath: string, content: string | Buffer): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmpPath, content, { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  fs.chmodSync(filePath, 0o600);
}

function parseCsvEnv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function maskSecret(secret: string | undefined | null): string | null {
  if (!secret) return null;
  const trimmed = secret.trim();
  const prefix = trimmed.startsWith("sk-ant-")
    ? trimmed.slice(0, 7)
    : trimmed.slice(0, 4);
  if (trimmed.length <= prefix.length + 8) {
    return "••••••••";
  }
  const suffix = trimmed.slice(-4);
  return `${prefix}••••${suffix}`;
}

export type MasterKeyStore = "file" | "keychain";

/**
 * Picks where the vault master key lives. On macOS it defaults to the login Keychain so the
 * key is not sitting in the same folder as the ciphertext it protects. Set
 * RELAY_HUD_KEYCHAIN=off to keep the legacy `.data/master.key` file.
 */
export function resolveDefaultKeyStore(): MasterKeyStore {
  if (process.env.RELAY_HUD_KEYCHAIN?.trim().toLowerCase() === "off") return "file";
  return process.platform === "darwin" ? "keychain" : "file";
}

const KEYCHAIN_ACCOUNT = "vault-master-key";
const KEYCHAIN_ITEM_NOT_FOUND = 44;

function keychainServiceFor(dataDir: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(path.resolve(dataDir))
    .digest("hex")
    .slice(0, 12);
  return `relay-hud:${digest}`;
}

function readKeychainKey(service: string): string | null {
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", service, "-a", KEYCHAIN_ACCOUNT, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 },
    ).trim();
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === KEYCHAIN_ITEM_NOT_FOUND) return null;
    throw new Error(
      `Unable to read the RelayHUD vault key from macOS Keychain: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function writeKeychainKey(service: string, hex: string): void {
  execFileSync(
    "security",
    [
      "add-generic-password",
      "-s",
      service,
      "-a",
      KEYCHAIN_ACCOUNT,
      "-l",
      "RelayHUD vault master key",
      "-w",
      hex,
      "-U",
    ],
    { stdio: ["ignore", "ignore", "pipe"], timeout: 5000 },
  );
}

export class LocalCredentialVault {
  private readonly dataDir: string;
  private readonly keyPath: string;
  private readonly vaultPath: string;
  private readonly keyStore: MasterKeyStore;
  private masterKey: Buffer | null = null;
  private cachedPayload: VaultPayload | null = null;
  private cachedMtimeMs: number | null = null;

  constructor(
    dataDir: string = resolveDataDir(),
    options: { keyStore?: MasterKeyStore } = {},
  ) {
    this.dataDir = dataDir;
    this.keyPath = path.join(dataDir, "master.key");
    this.vaultPath = path.join(dataDir, "vault.enc");
    this.keyStore = options.keyStore ?? "file";
  }

  private getOrCreateMasterKey(): Buffer {
    if (!this.masterKey) {
      this.masterKey =
        this.keyStore === "keychain"
          ? this.getOrCreateKeychainKey()
          : this.getOrCreateFileKey();
    }
    return this.masterKey;
  }

  private parseHexKey(hex: string, source: string): Buffer {
    if (!HEX_PATTERN.test(hex) || hex.length !== 64) {
      throw new Error(`Vault master key in ${source} is corrupted (invalid length).`);
    }
    return Buffer.from(hex, "hex");
  }

  private getOrCreateKeychainKey(): Buffer {
    const service = keychainServiceFor(this.dataDir);
    const existing = readKeychainKey(service);
    if (existing) return this.parseHexKey(existing, "macOS Keychain");

    // First run on Keychain: migrate a legacy master.key file if one exists.
    const legacyHex = fs.existsSync(this.keyPath)
      ? fs.readFileSync(this.keyPath, "utf8").trim()
      : null;
    const key = legacyHex
      ? this.parseHexKey(legacyHex, this.keyPath)
      : crypto.randomBytes(32);

    try {
      writeKeychainKey(service, key.toString("hex"));
    } catch (err) {
      console.warn(
        `[relay-hud] macOS Keychain unavailable (${err instanceof Error ? err.message : String(err)}); falling back to ${this.keyPath}.`,
      );
      return this.getOrCreateFileKey();
    }

    const readBack = readKeychainKey(service);
    if (readBack !== key.toString("hex")) {
      throw new Error("macOS Keychain did not return the vault key that was just stored.");
    }
    if (legacyHex) {
      fs.unlinkSync(this.keyPath);
    }
    return key;
  }

  private getOrCreateFileKey(): Buffer {
    const readKey = (): Buffer =>
      this.parseHexKey(fs.readFileSync(this.keyPath, "utf8").trim(), this.keyPath);

    if (fs.existsSync(this.keyPath)) {
      return readKey();
    }

    ensureDir(path.dirname(this.keyPath));
    const key = crypto.randomBytes(32);
    try {
      fs.writeFileSync(this.keyPath, key.toString("hex"), {
        flag: "wx",
        mode: 0o600,
      });
      fs.chmodSync(this.keyPath, 0o600);
      return key;
    } catch (err) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "EEXIST"
      ) {
        return readKey();
      }
      throw err;
    }
  }

  getMasterKeyFingerprint(): string {
    return crypto
      .createHash("sha256")
      .update(this.getOrCreateMasterKey())
      .digest("hex")
      .slice(0, 32);
  }

  /** Encrypts arbitrary UTF-8 text into the vault's AES-256-GCM JSON envelope. */
  encryptText(plaintext: string): string {
    const key = this.getOrCreateMasterKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
      authTagLength: 16,
    });
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const envelope: EncryptedEnvelope = {
      alg: "aes-256-gcm",
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      ciphertext: ciphertext.toString("hex"),
    };
    return JSON.stringify(envelope, null, 2);
  }

  /** Returns true when `raw` looks like an envelope produced by encryptText. */
  static isEncryptedEnvelope(raw: unknown): boolean {
    return (
      typeof raw === "object" &&
      raw !== null &&
      (raw as Partial<EncryptedEnvelope>).alg === "aes-256-gcm" &&
      typeof (raw as Partial<EncryptedEnvelope>).ciphertext === "string"
    );
  }

  /** Decrypts an envelope (already JSON-parsed) produced by encryptText. */
  decryptEnvelope(envelope: Partial<EncryptedEnvelope>): string {
    if (
      envelope.alg !== "aes-256-gcm" ||
      typeof envelope.iv !== "string" ||
      typeof envelope.tag !== "string" ||
      typeof envelope.ciphertext !== "string"
    ) {
      throw new Error(
        "Vault envelope is malformed or uses an unsupported algorithm.",
      );
    }
    if (
      !HEX_PATTERN.test(envelope.iv) ||
      !HEX_PATTERN.test(envelope.tag) ||
      !HEX_PATTERN.test(envelope.ciphertext)
    ) {
      throw new Error("Vault envelope contains non-hex fields.");
    }

    const ivBuf = Buffer.from(envelope.iv, "hex");
    const tagBuf = Buffer.from(envelope.tag, "hex");
    if (ivBuf.length !== 12 || tagBuf.length !== 16) {
      throw new Error("Vault envelope has invalid IV or GCM auth tag length.");
    }

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.getOrCreateMasterKey(),
      ivBuf,
      { authTagLength: 16 },
    );
    decipher.setAuthTag(tagBuf);
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "hex")),
      decipher.final(),
    ]).toString("utf8");
  }

  readAll(): VaultPayload {
    if (!fs.existsSync(this.vaultPath)) {
      this.cachedPayload = null;
      this.cachedMtimeMs = null;
      return { version: 1, accounts: {} };
    }
    const stat = fs.statSync(this.vaultPath);
    if (this.cachedPayload && this.cachedMtimeMs === stat.mtimeMs) {
      return structuredClone(this.cachedPayload);
    }
    const raw = fs.readFileSync(this.vaultPath, "utf8");
    const plaintext = this.decryptEnvelope(
      JSON.parse(raw) as Partial<EncryptedEnvelope>,
    );
    const parsed = JSON.parse(plaintext) as VaultPayload;
    const normalized: VaultPayload = {
      version: 1,
      accounts: parsed.accounts ?? {},
      oauthApp: parsed.oauthApp,
      sso: parsed.sso,
    };
    this.cachedPayload = structuredClone(normalized);
    this.cachedMtimeMs = stat.mtimeMs;
    return normalized;
  }

  writeAll(payload: VaultPayload): void {
    writeFileSecure(this.vaultPath, this.encryptText(JSON.stringify(payload)));
    this.cachedPayload = structuredClone(payload);
    this.cachedMtimeMs = fs.statSync(this.vaultPath).mtimeMs;
  }

  getAccountSecret(accountId: AccountId): AccountSecretRecord {
    const all = this.readAll();
    return all.accounts[accountId] ?? {};
  }

  setAccountSecret(
    accountId: AccountId,
    patch: Partial<AccountSecretRecord>,
  ): AccountSecretRecord {
    const all = this.readAll();
    const current = all.accounts[accountId] ?? {};
    const next: AccountSecretRecord = { ...current, ...patch };
    all.accounts[accountId] = next;
    this.writeAll(all);
    return next;
  }

  clearAccountSecret(accountId: AccountId): void {
    const all = this.readAll();
    delete all.accounts[accountId];
    this.writeAll(all);
  }

  getGoogleOAuthApp(): { clientId: string | null; clientSecret: string | null } {
    const all = this.readAll();
    const clientId =
      all.oauthApp?.googleClientId || process.env.GOOGLE_OAUTH_CLIENT_ID || null;
    const clientSecret =
      all.oauthApp?.googleClientSecret ||
      process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
      null;
    return { clientId, clientSecret };
  }

  setGoogleOAuthApp(clientId: string, clientSecret: string): void {
    const all = this.readAll();
    all.oauthApp = {
      googleClientId: clientId.trim(),
      googleClientSecret: clientSecret.trim(),
    };
    this.writeAll(all);
  }

  getSsoConfig(): ResolvedSsoConfig {
    const all = this.readAll();
    const sso = all.sso ?? {};
    const googleApp = this.getGoogleOAuthApp();

    const envEmails = parseCsvEnv(process.env.RELAY_HUD_SSO_ALLOWED_EMAILS);
    const envDomains = parseCsvEnv(process.env.RELAY_HUD_SSO_ALLOWED_DOMAINS);
    const allowedEmails = Array.from(
      new Set([
        ...(sso.allowedEmails ?? []).map((e) => e.trim().toLowerCase()),
        ...envEmails,
      ]),
    ).filter(Boolean);
    const allowedDomains = Array.from(
      new Set([
        ...(sso.allowedDomains ?? []).map((d) =>
          d.trim().toLowerCase().replace(/^@/, ""),
        ),
        ...envDomains.map((d) => d.replace(/^@/, "")),
      ]),
    ).filter(Boolean);

    const oidcIssuer =
      sso.oidcIssuer?.trim() || process.env.RELAY_HUD_OIDC_ISSUER?.trim() || null;
    const oidcClientId =
      sso.oidcClientId?.trim() ||
      process.env.RELAY_HUD_OIDC_CLIENT_ID?.trim() ||
      null;
    const oidcClientSecret =
      sso.oidcClientSecret?.trim() ||
      process.env.RELAY_HUD_OIDC_CLIENT_SECRET?.trim() ||
      null;
    const oidcLabel =
      sso.oidcLabel?.trim() ||
      process.env.RELAY_HUD_OIDC_LABEL?.trim() ||
      "Enterprise OIDC";
    const oidcScopes =
      sso.oidcScopes?.trim() ||
      process.env.RELAY_HUD_OIDC_SCOPES?.trim() ||
      "openid email profile";

    const hasAllowlist = allowedEmails.length > 0 || allowedDomains.length > 0;
    const googleConfigured = Boolean(
      googleApp.clientId && googleApp.clientSecret,
    );
    const oidcConfigured = Boolean(oidcIssuer && oidcClientId && oidcClientSecret);

    const googleAppLoginEnabled =
      googleConfigured &&
      hasAllowlist &&
      (sso.googleAppLoginEnabled ??
        process.env.RELAY_HUD_GOOGLE_SSO_ENABLED === "true");

    const oidcAppLoginEnabled =
      oidcConfigured &&
      hasAllowlist &&
      (sso.oidcAppLoginEnabled ??
        process.env.RELAY_HUD_OIDC_SSO_ENABLED === "true");

    return {
      googleClientId: googleApp.clientId,
      googleClientSecret: googleApp.clientSecret,
      googleAppLoginEnabled,
      oidcAppLoginEnabled,
      oidcLabel,
      oidcIssuer,
      oidcClientId,
      oidcClientSecret,
      oidcScopes,
      allowedEmails,
      allowedDomains,
    };
  }

  setSsoConfig(patch: Partial<SsoVaultConfig>): ResolvedSsoConfig {
    const all = this.readAll();
    const prev = all.sso ?? {};
    const next: SsoVaultConfig = {
      ...prev,
      ...patch,
      ...(patch.allowedEmails !== undefined
        ? {
            allowedEmails: Array.from(
              new Set(
                patch.allowedEmails
                  .map((e) => e.trim().toLowerCase())
                  .filter(Boolean),
              ),
            ),
          }
        : {}),
      ...(patch.allowedDomains !== undefined
        ? {
            allowedDomains: Array.from(
              new Set(
                patch.allowedDomains
                  .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
                  .filter(Boolean),
              ),
            ),
          }
        : {}),
    };
    if (patch.oidcClientSecret === "") {
      // Preserve existing secret when the user updates issuer/allowlist without retyping secret.
      next.oidcClientSecret = prev.oidcClientSecret;
    }
    all.sso = next;
    this.writeAll(all);
    return this.getSsoConfig();
  }
}

declare global {
  var __relayHudVault: LocalCredentialVault | undefined;
}

export function getVault(): LocalCredentialVault {
  if (!globalThis.__relayHudVault) {
    globalThis.__relayHudVault = new LocalCredentialVault(resolveDataDir(), {
      keyStore: resolveDefaultKeyStore(),
    });
  }
  return globalThis.__relayHudVault;
}
