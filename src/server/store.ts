import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getConnectorPreset } from "@/domain/connectors";
import type {
  AccountConnectionStatus,
  AccountId,
  AccountPublicState,
  AuthMode,
  ChatGroup,
  HudAlert,
  HudJob,
  ProviderKind,
  RateLimitSnapshot,
  RoutingPolicy,
} from "@/domain/types";
import { getVault, maskSecret, type LocalCredentialVault } from "./vault";

export interface PersistedAccountMeta {
  id: AccountId;
  slotIndex: number;
  priority: number;
  provider: ProviderKind;
  presetId: string | null;
  name: string;
  roleLabel: string;
  email: string | null;
  baseUrl: string | null;
  tags: string[];
  authMode: AuthMode;
  status: AccountConnectionStatus;
  takesWork: boolean;
  autoFailover: boolean;
  defaultModel: string;
  availableModels: string[];
  latencyMs: number | null;
  rpmCurrent: number;
  rpmLimit: number;
  tokensUsedToday: number;
  tokensDailyBudget: number;
  estimatedCostUsd: number;
  totalJobs: number;
  failedJobs: number;
  failoverCount: number;
  lastCheckedAt: string | null;
  lastError: string | null;
  rateLimits: RateLimitSnapshot;
}

export interface PersistedHudState {
  version: 2;
  usageDateUtc: string;
  routingPolicy: RoutingPolicy;
  accountOrder: AccountId[];
  accounts: Record<string, PersistedAccountMeta>;
  chats: ChatGroup[];
  jobs: HudJob[];
  alerts: HudAlert[];
}

export interface CreateAccountInput {
  provider: ProviderKind;
  presetId?: string;
  name?: string;
  roleLabel?: string;
  email?: string | null;
  baseUrl?: string | null;
  tags?: string[];
  authMode?: AuthMode;
  defaultModel?: string;
  rpmLimit?: number;
  tokensDailyBudget?: number;
  priority?: number;
}

function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function createDefaultAccounts(): {
  accountOrder: AccountId[];
  accounts: Record<string, PersistedAccountMeta>;
} {
  const accounts: Record<string, PersistedAccountMeta> = {
    "google-1": {
      id: "google-1",
      slotIndex: 1,
      priority: 1,
      provider: "google",
      presetId: "google",
      name: "#1 Google · Primary",
      roleLabel: "GOOGLE #1",
      email: null,
      baseUrl: null,
      tags: ["google", "general"],
      authMode: "api_key",
      status: "disconnected",
      takesWork: true,
      autoFailover: true,
      defaultModel: "gemini-2.5-pro",
      availableModels: [
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
      ],
      latencyMs: null,
      rpmCurrent: 0,
      rpmLimit: 60,
      tokensUsedToday: 0,
      tokensDailyBudget: 10_000_000,
      estimatedCostUsd: 0,
      totalJobs: 0,
      failedJobs: 0,
      failoverCount: 0,
      lastCheckedAt: null,
      lastError: null,
      rateLimits: {
        requestsLimit: 60,
        requestsRemaining: 60,
        requestsResetAt: null,
        tokensLimit: 10_000_000,
        tokensRemaining: 10_000_000,
        tokensResetAt: null,
        source: "budget_tracker",
      },
    },
    "google-2": {
      id: "google-2",
      slotIndex: 2,
      priority: 2,
      provider: "google",
      presetId: "google",
      name: "#2 Google · Secondary",
      roleLabel: "GOOGLE #2",
      email: null,
      baseUrl: null,
      tags: ["google", "fast"],
      authMode: "api_key",
      status: "disconnected",
      takesWork: true,
      autoFailover: true,
      defaultModel: "gemini-2.5-flash",
      availableModels: [
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
      ],
      latencyMs: null,
      rpmCurrent: 0,
      rpmLimit: 60,
      tokensUsedToday: 0,
      tokensDailyBudget: 10_000_000,
      estimatedCostUsd: 0,
      totalJobs: 0,
      failedJobs: 0,
      failoverCount: 0,
      lastCheckedAt: null,
      lastError: null,
      rateLimits: {
        requestsLimit: 60,
        requestsRemaining: 60,
        requestsResetAt: null,
        tokensLimit: 10_000_000,
        tokensRemaining: 10_000_000,
        tokensResetAt: null,
        source: "budget_tracker",
      },
    },
    "claude-1": {
      id: "claude-1",
      slotIndex: 3,
      priority: 3,
      provider: "anthropic",
      presetId: "anthropic",
      name: "#3 Claude · Primary",
      roleLabel: "CLAUDE #1",
      email: null,
      baseUrl: null,
      tags: ["claude", "coding"],
      authMode: "api_key",
      status: "disconnected",
      takesWork: true,
      autoFailover: true,
      defaultModel: "claude-sonnet-4-6",
      availableModels: [
        "claude-sonnet-4-6",
        "claude-opus-4-6",
        "claude-haiku-4-5",
      ],
      latencyMs: null,
      rpmCurrent: 0,
      rpmLimit: 50,
      tokensUsedToday: 0,
      tokensDailyBudget: 10_000_000,
      estimatedCostUsd: 0,
      totalJobs: 0,
      failedJobs: 0,
      failoverCount: 0,
      lastCheckedAt: null,
      lastError: null,
      rateLimits: {
        requestsLimit: 50,
        requestsRemaining: 50,
        requestsResetAt: null,
        tokensLimit: 400_000,
        tokensRemaining: 400_000,
        tokensResetAt: null,
        source: "budget_tracker",
      },
    },
  };
  return {
    accountOrder: ["google-1", "google-2", "claude-1"],
    accounts,
  };
}

function normalizePersistedAccount(
  id: string,
  raw: Partial<PersistedAccountMeta>,
  fallbackIndex: number,
): PersistedAccountMeta {
  const provider: ProviderKind =
    raw.provider === "anthropic" || raw.provider === "openai_compatible"
      ? raw.provider
      : "google";
  const preset = getConnectorPreset(raw.presetId ?? provider);
  const rpmLimit =
    typeof raw.rpmLimit === "number" && raw.rpmLimit > 0
      ? raw.rpmLimit
      : preset.defaultRpmLimit;
  const tokensDailyBudget =
    typeof raw.tokensDailyBudget === "number" && raw.tokensDailyBudget > 0
      ? raw.tokensDailyBudget
      : preset.defaultDailyBudget;

  return {
    id,
    slotIndex: fallbackIndex,
    priority:
      typeof raw.priority === "number" && Number.isFinite(raw.priority)
        ? raw.priority
        : fallbackIndex,
    provider,
    presetId: raw.presetId ?? preset.id,
    name: raw.name?.trim() || `#${fallbackIndex} ${preset.label}`,
    roleLabel: raw.roleLabel?.trim() || `${preset.shortLabel} #${fallbackIndex}`,
    email: raw.email ?? null,
    baseUrl: raw.baseUrl ?? preset.defaultBaseUrl,
    tags: Array.isArray(raw.tags)
      ? raw.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
      : [preset.id],
    authMode:
      raw.authMode === "oauth" ||
      raw.authMode === "cli" ||
      raw.authMode === "none"
        ? raw.authMode
        : "api_key",
    status: raw.status ?? "disconnected",
    takesWork: raw.takesWork ?? true,
    autoFailover: raw.autoFailover ?? true,
    defaultModel: raw.defaultModel?.trim() || preset.defaultModel,
    availableModels:
      Array.isArray(raw.availableModels) && raw.availableModels.length > 0
        ? raw.availableModels
        : [...preset.suggestedModels],
    latencyMs: raw.latencyMs ?? null,
    rpmCurrent: raw.rpmCurrent ?? 0,
    rpmLimit,
    tokensUsedToday: raw.tokensUsedToday ?? 0,
    tokensDailyBudget,
    estimatedCostUsd: raw.estimatedCostUsd ?? 0,
    totalJobs: raw.totalJobs ?? 0,
    failedJobs: raw.failedJobs ?? 0,
    failoverCount: raw.failoverCount ?? 0,
    lastCheckedAt: raw.lastCheckedAt ?? null,
    lastError: raw.lastError ?? null,
    rateLimits: raw.rateLimits ?? {
      requestsLimit: rpmLimit,
      requestsRemaining: rpmLimit,
      requestsResetAt: null,
      tokensLimit: tokensDailyBudget,
      tokensRemaining: tokensDailyBudget,
      tokensResetAt: null,
      source: "budget_tracker",
    },
  };
}

export class HudStateStore {
  private readonly statePath: string;
  private readonly vault: LocalCredentialVault;
  private state: PersistedHudState;
  private pendingFlushTimer: NodeJS.Timeout | null = null;
  private readonly recentRequestTimestamps = new Map<AccountId, number[]>();

  constructor(
    dataDir: string = path.join(process.cwd(), ".data"),
    vault: LocalCredentialVault = getVault(),
  ) {
    this.statePath = path.join(dataDir, "state.json");
    this.vault = vault;
    this.state = this.loadFromDisk();
  }

  private loadFromDisk(): PersistedHudState {
    if (!fs.existsSync(this.statePath)) {
      const defaults = createDefaultAccounts();
      return {
        version: 2,
        usageDateUtc: currentUtcDate(),
        routingPolicy: "auto_balance",
        accountOrder: defaults.accountOrder,
        accounts: defaults.accounts,
        chats: [],
        jobs: [],
        alerts: [],
      };
    }

    try {
      const raw = fs.readFileSync(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedHudState> & {
        version?: number;
      };
      const rawAccounts = parsed.accounts ?? {};
      const parsedKeys = Object.keys(rawAccounts);

      let order: AccountId[];
      let accounts: Record<string, PersistedAccountMeta>;

      if (parsedKeys.length === 0 && parsed.version !== 2) {
        const defaults = createDefaultAccounts();
        order = defaults.accountOrder;
        accounts = defaults.accounts;
      } else {
        const baseOrder = Array.isArray(parsed.accountOrder)
          ? parsed.accountOrder.filter((id) => Boolean(rawAccounts[id]))
          : [];
        const remaining = parsedKeys.filter((id) => !baseOrder.includes(id));
        order = [...baseOrder, ...remaining];
        accounts = {};
        order.forEach((id, idx) => {
          accounts[id] = normalizePersistedAccount(
            id,
            rawAccounts[id] ?? {},
            idx + 1,
          );
        });
      }

      const jobs = (parsed.jobs ?? []).map((job) =>
        job.status === "working"
          ? {
              ...job,
              status: "stopped" as const,
              endedAt: job.endedAt ?? new Date().toISOString(),
            }
          : job,
      );

      return {
        version: 2,
        usageDateUtc: parsed.usageDateUtc ?? currentUtcDate(),
        routingPolicy: parsed.routingPolicy ?? "auto_balance",
        accountOrder: order,
        accounts,
        chats: parsed.chats ?? [],
        jobs,
        alerts: parsed.alerts ?? [],
      };
    } catch {
      try {
        const backupPath = `${this.statePath}.corrupt.${Date.now()}`;
        fs.renameSync(this.statePath, backupPath);
      } catch {
        // Ignore backup rename failure if file vanished.
      }
      const defaults = createDefaultAccounts();
      return {
        version: 2,
        usageDateUtc: currentUtcDate(),
        routingPolicy: "auto_balance",
        accountOrder: defaults.accountOrder,
        accounts: defaults.accounts,
        chats: [],
        jobs: [],
        alerts: [],
      };
    }
  }

  private reindexSlots(): void {
    this.state.accountOrder = this.state.accountOrder.filter((id) =>
      Boolean(this.state.accounts[id]),
    );
    this.state.accountOrder.forEach((id, idx) => {
      const acc = this.state.accounts[id];
      if (acc) {
        acc.slotIndex = idx + 1;
      }
    });
  }

  private rolloverDailyBudgetsIfNeeded(): void {
    const today = currentUtcDate();
    if (this.state.usageDateUtc === today) return;
    this.state.usageDateUtc = today;
    for (const id of this.state.accountOrder) {
      const acc = this.state.accounts[id];
      if (!acc) continue;
      acc.tokensUsedToday = 0;
      acc.estimatedCostUsd = 0;
      acc.rpmCurrent = 0;
      if (acc.rateLimits.source === "budget_tracker") {
        acc.rateLimits.tokensRemaining = acc.tokensDailyBudget;
        acc.rateLimits.requestsRemaining = acc.rpmLimit;
      }
    }
    this.flushSave();
  }

  private flushSave(): void {
    if (this.pendingFlushTimer) {
      clearTimeout(this.pendingFlushTimer);
      this.pendingFlushTimer = null;
    }
    const dir = path.dirname(this.statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const tmp = `${this.statePath}.${crypto.randomBytes(5).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.statePath);
  }

  private scheduleSave(): void {
    if (this.pendingFlushTimer) return;
    this.pendingFlushTimer = setTimeout(() => {
      this.pendingFlushTimer = null;
      this.flushSave();
    }, 750);
  }

  recordAccountRequest(id: AccountId): number {
    const now = Date.now();
    const cutoff = now - 60_000;
    const recent = (this.recentRequestTimestamps.get(id) ?? []).filter(
      (ts) => ts >= cutoff,
    );
    recent.push(now);
    this.recentRequestTimestamps.set(id, recent);
    return recent.length;
  }

  private getCurrentRpm(id: AccountId): number {
    const cutoff = Date.now() - 60_000;
    const recent = (this.recentRequestTimestamps.get(id) ?? []).filter(
      (ts) => ts >= cutoff,
    );
    this.recentRequestTimestamps.set(id, recent);
    return recent.length;
  }

  getRoutingPolicy(): RoutingPolicy {
    return this.state.routingPolicy;
  }

  setRoutingPolicy(policy: RoutingPolicy): void {
    this.state.routingPolicy = policy;
    this.flushSave();
  }

  listAccountIds(): AccountId[] {
    return [...this.state.accountOrder];
  }

  hasAccount(id: AccountId): boolean {
    return Boolean(this.state.accounts[id]);
  }

  getAccountMeta(id: AccountId): PersistedAccountMeta {
    this.rolloverDailyBudgetsIfNeeded();
    const found = this.state.accounts[id];
    if (!found) {
      throw new Error(`Account "${id}" does not exist.`);
    }
    return found;
  }

  createAccount(input: CreateAccountInput): PersistedAccountMeta {
    this.rolloverDailyBudgetsIfNeeded();
    const preset = getConnectorPreset(input.presetId ?? input.provider);
    const samePresetCount = this.state.accountOrder.filter((id) => {
      const a = this.state.accounts[id];
      return a && (a.presetId === preset.id || a.provider === input.provider);
    }).length;
    const nextSlot = this.state.accountOrder.length + 1;
    const prefix = preset.id.replace(/[^a-z0-9]/gi, "").toLowerCase() || "acc";
    const id = `${prefix}-${crypto.randomBytes(3).toString("hex")}`;
    const rpmLimit = input.rpmLimit ?? preset.defaultRpmLimit;
    const tokensDailyBudget =
      input.tokensDailyBudget ?? preset.defaultDailyBudget;
    const defaultModel = input.defaultModel?.trim() || preset.defaultModel;
    const availableModels = Array.from(
      new Set([defaultModel, ...preset.suggestedModels]),
    );

    const meta: PersistedAccountMeta = {
      id,
      slotIndex: nextSlot,
      priority: input.priority ?? nextSlot,
      provider: input.provider,
      presetId: preset.id,
      name:
        input.name?.trim() ||
        `#${nextSlot} ${preset.label} · ${samePresetCount + 1}`,
      roleLabel:
        input.roleLabel?.trim() ||
        `${preset.shortLabel} #${samePresetCount + 1}`,
      email: input.email ?? null,
      baseUrl:
        input.baseUrl !== undefined ? input.baseUrl : preset.defaultBaseUrl,
      tags:
        input.tags && input.tags.length > 0
          ? Array.from(
              new Set(
                input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
              ),
            )
          : [preset.id],
      authMode: input.authMode ?? preset.defaultAuthMode,
      status: "disconnected",
      takesWork: true,
      autoFailover: true,
      defaultModel,
      availableModels,
      latencyMs: null,
      rpmCurrent: 0,
      rpmLimit,
      tokensUsedToday: 0,
      tokensDailyBudget,
      estimatedCostUsd: 0,
      totalJobs: 0,
      failedJobs: 0,
      failoverCount: 0,
      lastCheckedAt: null,
      lastError: null,
      rateLimits: {
        requestsLimit: rpmLimit,
        requestsRemaining: rpmLimit,
        requestsResetAt: null,
        tokensLimit: tokensDailyBudget,
        tokensRemaining: tokensDailyBudget,
        tokensResetAt: null,
        source: "budget_tracker",
      },
    };

    this.state.accounts[id] = meta;
    this.state.accountOrder.push(id);
    this.reindexSlots();
    this.flushSave();
    return meta;
  }

  deleteAccount(id: AccountId): boolean {
    if (!this.state.accounts[id]) return false;
    delete this.state.accounts[id];
    this.state.accountOrder = this.state.accountOrder.filter((x) => x !== id);
    this.recentRequestTimestamps.delete(id);
    this.vault.clearAccountSecret(id);
    this.reindexSlots();
    this.flushSave();
    return true;
  }

  reorderAccounts(orderedIds: AccountId[]): void {
    const valid = orderedIds.filter((id) => Boolean(this.state.accounts[id]));
    const remaining = this.state.accountOrder.filter(
      (id) => !valid.includes(id),
    );
    this.state.accountOrder = [...valid, ...remaining];
    this.state.accountOrder.forEach((id, idx) => {
      const acc = this.state.accounts[id];
      if (acc) {
        acc.slotIndex = idx + 1;
        acc.priority = idx + 1;
      }
    });
    this.flushSave();
  }

  updateAccountMeta(
    id: AccountId,
    patch: Partial<PersistedAccountMeta>,
  ): PersistedAccountMeta {
    this.rolloverDailyBudgetsIfNeeded();
    const existing = this.state.accounts[id];
    if (!existing) {
      throw new Error(`Account "${id}" does not exist.`);
    }
    const next: PersistedAccountMeta = {
      ...existing,
      ...patch,
      id,
    };
    this.state.accounts[id] = next;
    this.flushSave();
    return next;
  }

  toPublicAccounts(cliTools: {
    claude: boolean;
    gemini: boolean;
  }): AccountPublicState[] {
    this.rolloverDailyBudgetsIfNeeded();
    const vaultAll = this.vault.readAll();

    return this.state.accountOrder
      .map((id) => this.state.accounts[id])
      .filter((meta): meta is PersistedAccountMeta => Boolean(meta))
      .map((meta) => {
        const secret = vaultAll.accounts[meta.id] ?? {};
        const cliAvailable =
          meta.provider === "google"
            ? cliTools.gemini
            : meta.provider === "anthropic"
              ? cliTools.claude
              : false;
        const oauthConnected = Boolean(
          secret.oauthRefreshToken || secret.oauthAccessToken,
        );

        let hasCredentials = false;
        let maskedCredential: string | null = null;
        if (meta.authMode === "api_key") {
          hasCredentials = Boolean(secret.apiKey);
          maskedCredential = maskSecret(secret.apiKey);
        } else if (meta.authMode === "oauth") {
          hasCredentials = oauthConnected;
          maskedCredential = oauthConnected
            ? `${meta.provider === "google" ? "OAuth" : "SSO"} · ${secret.oauthEmail ?? meta.email ?? "Connected"}`
            : null;
        } else if (meta.authMode === "none") {
          hasCredentials = Boolean(meta.baseUrl);
          maskedCredential = meta.baseUrl ? `No-Auth · ${meta.baseUrl}` : null;
        } else {
          hasCredentials = cliAvailable;
          maskedCredential = cliAvailable
            ? `Local ${meta.provider === "google" ? "gemini" : "claude"} CLI`
            : null;
        }

        const activeJobs = this.state.jobs.filter(
          (j) => j.targetAccountId === meta.id && j.status === "working",
        ).length;

        const rpmCurrent = this.getCurrentRpm(meta.id);

        let quotaUsedPct = 0;
        if (
          meta.rateLimits.source === "live_headers" &&
          meta.rateLimits.tokensLimit > 0
        ) {
          const used = Math.max(
            0,
            meta.rateLimits.tokensLimit - meta.rateLimits.tokensRemaining,
          );
          quotaUsedPct = Math.round((used / meta.rateLimits.tokensLimit) * 100);
        } else if (meta.tokensDailyBudget > 0) {
          quotaUsedPct = Math.round(
            (meta.tokensUsedToday / meta.tokensDailyBudget) * 100,
          );
        }
        quotaUsedPct = Math.max(0, Math.min(100, quotaUsedPct));

        return {
          ...meta,
          rpmCurrent,
          email: secret.oauthEmail ?? meta.email,
          hasCredentials,
          maskedCredential,
          oauthConnected,
          cliAvailable,
          activeJobs,
          quotaUsedPct,
        };
      });
  }

  listJobs(): HudJob[] {
    return this.state.jobs;
  }

  listChats(): ChatGroup[] {
    return this.state.chats;
  }

  listAlerts(): HudAlert[] {
    return this.state.alerts;
  }

  getJob(jobId: string): HudJob | undefined {
    return this.state.jobs.find((j) => j.id === jobId);
  }

  upsertJob(job: HudJob, options: { immediate?: boolean } = {}): void {
    const idx = this.state.jobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) {
      this.state.jobs[idx] = job;
    } else {
      this.state.jobs.unshift(job);
      if (this.state.jobs.length > 60) {
        this.state.jobs = this.state.jobs.slice(0, 60);
      }
    }
    if (options.immediate === false) {
      this.scheduleSave();
    } else {
      this.flushSave();
    }
  }

  upsertChat(chat: ChatGroup): void {
    const idx = this.state.chats.findIndex((c) => c.id === chat.id);
    if (idx >= 0) {
      this.state.chats[idx] = chat;
    } else {
      this.state.chats.unshift(chat);
      if (this.state.chats.length > 30) {
        this.state.chats = this.state.chats.slice(0, 30);
      }
    }
    this.flushSave();
  }

  syncChatForJob(job: HudJob): void {
    const chat = this.state.chats.find((c) => c.id === job.chatSessionId);
    if (!chat) return;

    if (!chat.jobIds.includes(job.id)) {
      chat.jobIds = [job.id, ...chat.jobIds];
    }

    const linkedJobs = chat.jobIds
      .map((id) => this.state.jobs.find((j) => j.id === id))
      .filter((j): j is HudJob => Boolean(j));

    if (linkedJobs.some((j) => j.status === "working")) {
      chat.status = "working";
    } else if (linkedJobs.some((j) => j.status === "waiting")) {
      chat.status = "waiting";
    } else if (linkedJobs.some((j) => j.status === "failed")) {
      chat.status = "failed";
    } else if (
      linkedJobs.length > 0 &&
      linkedJobs.every((j) => j.status === "stopped")
    ) {
      chat.status = "stopped";
    } else if (linkedJobs.length > 0) {
      chat.status = "done";
    }

    this.flushSave();
  }

  addAlert(alert: Omit<HudAlert, "id" | "createdAt" | "acknowledged">): HudAlert {
    const entry: HudAlert = {
      ...alert,
      id: `alert_${crypto.randomBytes(4).toString("hex")}`,
      createdAt: new Date().toISOString(),
      acknowledged: false,
    };
    this.state.alerts.unshift(entry);
    if (this.state.alerts.length > 40) {
      this.state.alerts = this.state.alerts.slice(0, 40);
    }
    this.flushSave();
    return entry;
  }

  acknowledgeAlert(alertId: string): boolean {
    const target = this.state.alerts.find((a) => a.id === alertId);
    if (!target) return false;
    target.acknowledged = true;
    this.flushSave();
    return true;
  }
}

declare global {
  var __relayHudStore: HudStateStore | undefined;
}

export function getHudStore(): HudStateStore {
  if (!globalThis.__relayHudStore) {
    globalThis.__relayHudStore = new HudStateStore();
  }
  return globalThis.__relayHudStore;
}
