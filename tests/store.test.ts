import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HudStateStore } from "@/server/store";
import { LocalCredentialVault } from "@/server/vault";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-hud-store-"));
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

describe("HudStateStore", () => {
  it("initializes 3 account slots (2 Google + 1 Claude) and exposes only masked credentials", () => {
    const dir = createTempDir();
    const vault = new LocalCredentialVault(dir);
    vault.setAccountSecret("google-1", { apiKey: "AIzaSyRealKeyNeverExposed8899" });

    const store = new HudStateStore(dir, vault);
    store.updateAccountMeta("google-1", {
      status: "online",
      tokensUsedToday: 2_500_000,
      tokensDailyBudget: 10_000_000,
    });

    const accounts = store.toPublicAccounts({ claude: false, gemini: false });
    expect(accounts.map((a) => a.id)).toEqual([
      "google-1",
      "google-2",
      "claude-1",
    ]);

    const g1 = accounts[0];
    expect(g1?.hasCredentials).toBe(true);
    expect(g1?.maskedCredential).toBe("AIza••••8899");
    expect(g1?.quotaUsedPct).toBe(25);
    expect(JSON.stringify(accounts)).not.toContain("AIzaSyRealKeyNeverExposed8899");
  });

  it("persists routing toggles and reconciles orphaned working jobs on restart", () => {
    const dir = createTempDir();
    const vault = new LocalCredentialVault(dir);
    const store = new HudStateStore(dir, vault);

    store.updateAccountMeta("claude-1", { takesWork: false, autoFailover: false });
    store.upsertJob({
      id: "job_orphan_1",
      chatSessionId: "chat_1",
      chatTitle: "Orphan Test",
      originNodeId: "local-mac",
      targetAccountId: "claude-1",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      title: "Interrupted Stream",
      workspaceTag: "CLAUDE #1",
      repoName: "relay-hud",
      folderPath: "/tmp",
      dispatchMode: "direct",
      protocolBadge: "API",
      status: "working",
      startedAt: new Date().toISOString(),
      endedAt: null,
      lastCheckInAt: null,
      latencyMs: null,
      tokensPerSec: null,
      inputTokens: 0,
      outputTokens: 0,
      weightedTokens: 0,
      estimatedCostUsd: 0,
      prompt: "test",
      commandPreview: "claude -p test",
      pidOrReqId: "req_1",
      subTasks: [],
      handoffs: [],
      logs: [],
      outputText: "",
      errorMessage: null,
    });

    const reloaded = new HudStateStore(dir, vault);
    expect(reloaded.getAccountMeta("claude-1").takesWork).toBe(false);
    expect(reloaded.getJob("job_orphan_1")?.status).toBe("stopped");
  });

  it("marks chat group failed when a fan-out has partial failures", () => {
    const dir = createTempDir();
    const vault = new LocalCredentialVault(dir);
    const store = new HudStateStore(dir, vault);

    const baseJob = {
      chatSessionId: "chat_mix",
      chatTitle: "Fanout Mix",
      originNodeId: "local-mac" as const,
      provider: "google" as const,
      model: "gemini-2.5-pro",
      title: "Mix Job",
      workspaceTag: "GOOGLE #1",
      repoName: "relay-hud",
      folderPath: "/tmp",
      dispatchMode: "fanout" as const,
      protocolBadge: "API" as const,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      lastCheckInAt: null,
      latencyMs: 200,
      tokensPerSec: 50,
      inputTokens: 100,
      outputTokens: 50,
      weightedTokens: 250,
      estimatedCostUsd: 0.01,
      prompt: "test",
      commandPreview: "gemini -m gemini-2.5-pro",
      pidOrReqId: "req_1",
      subTasks: [],
      handoffs: [],
      logs: [],
      outputText: "ok",
      errorMessage: null,
    };

    store.upsertChat({
      id: "chat_mix",
      originNodeId: "local-mac",
      title: "Fanout Mix",
      workspaceTag: "MASTER",
      repoName: "relay-hud",
      groupKind: "arw",
      status: "working",
      startedAt: new Date().toISOString(),
      elapsedLabel: "1s",
      metricSummary: "2 routed",
      jobIds: ["j_done", "j_fail"],
    });
    store.upsertJob({ ...baseJob, id: "j_done", targetAccountId: "google-1", status: "done" });
    store.upsertJob({ ...baseJob, id: "j_fail", targetAccountId: "google-2", status: "failed", errorMessage: "503" });
    store.syncChatForJob(store.getJob("j_fail")!);

    expect(store.listChats().find((c) => c.id === "chat_mix")?.status).toBe("failed");
  });

  it("supports dynamic unlimited accounts: create, reorder, delete, and vault cleanup", () => {
    const dir = createTempDir();
    const vault = new LocalCredentialVault(dir);
    const store = new HudStateStore(dir, vault);

    const openai = store.createAccount({
      provider: "openai_compatible",
      presetId: "openai",
      name: "Work OpenAI",
      baseUrl: "https://api.openai.com/v1",
      tags: ["coding", "work"],
    });
    const ollama = store.createAccount({
      provider: "openai_compatible",
      presetId: "ollama",
      name: "Local Ollama",
      authMode: "none",
      baseUrl: "http://127.0.0.1:11434/v1",
      tags: ["local"],
    });
    vault.setAccountSecret(openai.id, { apiKey: "sk-proj-testsecret9988" });

    expect(store.listAccountIds()).toHaveLength(5);

    // Reorder puts Local Ollama first
    store.reorderAccounts([ollama.id, openai.id, "google-1", "google-2", "claude-1"]);
    const reordered = store.toPublicAccounts({ claude: false, gemini: false });
    expect(reordered[0]?.id).toBe(ollama.id);
    expect(reordered[0]?.slotIndex).toBe(1);
    expect(reordered[0]?.hasCredentials).toBe(true); // authMode="none" with baseUrl
    expect(reordered[1]?.id).toBe(openai.id);
    expect(reordered[1]?.maskedCredential).toBe("sk-p••••9988");

    // Delete wipes both store entry and encrypted vault secret
    expect(store.deleteAccount(openai.id)).toBe(true);
    expect(store.hasAccount(openai.id)).toBe(false);
    expect(vault.getAccountSecret(openai.id)).toEqual({});

    const reloaded = new HudStateStore(dir, vault);
    expect(reloaded.listAccountIds()).toHaveLength(4);
    expect(reloaded.listAccountIds()[0]).toBe(ollama.id);
  });
});
