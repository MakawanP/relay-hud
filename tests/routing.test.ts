import { describe, expect, it } from "vitest";
import {
  computeCapacitySegments,
  selectBestAccount,
  selectFailoverAccount,
} from "@/domain/routing";
import type { AccountPublicState } from "@/domain/types";

function makeAccount(
  overrides: Partial<AccountPublicState> & Pick<AccountPublicState, "id" | "slotIndex" | "provider">,
): AccountPublicState {
  return {
    priority: overrides.slotIndex,
    presetId: overrides.provider,
    name: overrides.id,
    roleLabel: overrides.id.toUpperCase(),
    email: null,
    baseUrl: null,
    tags: [overrides.provider],
    authMode: "api_key",
    status: "online",
    hasCredentials: true,
    maskedCredential: "key••••1234",
    oauthConnected: false,
    cliAvailable: false,
    takesWork: true,
    autoFailover: true,
    defaultModel: overrides.provider === "google" ? "gemini-2.5-pro" : "claude-sonnet-4-6",
    availableModels: [],
    latencyMs: 250,
    quotaUsedPct: 30,
    rpmCurrent: 4,
    rpmLimit: 60,
    tokensUsedToday: 1_000_000,
    tokensDailyBudget: 10_000_000,
    estimatedCostUsd: 1.0,
    activeJobs: 0,
    totalJobs: 3,
    failedJobs: 0,
    failoverCount: 0,
    lastCheckedAt: null,
    lastError: null,
    rateLimits: {
      requestsLimit: 60,
      requestsRemaining: 56,
      requestsResetAt: null,
      tokensLimit: 10_000_000,
      tokensRemaining: 9_000_000,
      tokensResetAt: null,
      source: "budget_tracker",
    },
    ...overrides,
  };
}

describe("ARW Routing & Failover Engine", () => {
  const pool: AccountPublicState[] = [
    makeAccount({
      id: "google-1",
      slotIndex: 1,
      provider: "google",
      quotaUsedPct: 72,
      latencyMs: 210,
      activeJobs: 2,
    }),
    makeAccount({
      id: "google-2",
      slotIndex: 2,
      provider: "google",
      quotaUsedPct: 24,
      latencyMs: 280,
      activeJobs: 0,
    }),
    makeAccount({
      id: "claude-1",
      slotIndex: 3,
      provider: "anthropic",
      quotaUsedPct: 45,
      latencyMs: 190,
      activeJobs: 0,
    }),
  ];

  it("picks lowest-load account under auto_balance", () => {
    const decision = selectBestAccount(pool, "auto_balance");
    expect(decision.selected?.id).toBe("google-2");
    expect(decision.fallbackChain).toEqual(["claude-1", "google-1"]);
  });

  it("prefers Claude under claude_first policy", () => {
    const decision = selectBestAccount(pool, "claude_first");
    expect(decision.selected?.id).toBe("claude-1");
  });

  it("prefers fastest account under lowest_latency policy", () => {
    const decision = selectBestAccount(pool, "lowest_latency");
    expect(decision.selected?.id).toBe("claude-1");
  });

  it("excludes accounts with takesWork=false, disconnected, or rate_limited", () => {
    const restricted = pool.map((a) =>
      a.id === "google-2"
        ? { ...a, takesWork: false }
        : a.id === "claude-1"
          ? { ...a, status: "rate_limited" as const }
          : a,
    );
    const decision = selectBestAccount(restricted, "auto_balance");
    expect(decision.selected?.id).toBe("google-1");
  });

  it("selects failover backup respecting autoFailover and tried accounts", () => {
    const failover1 = selectFailoverAccount(pool, "google-2", "auto_balance");
    expect(failover1.selected?.id).toBe("claude-1");

    const failover2 = selectFailoverAccount(pool, "claude-1", "auto_balance", [
      "google-2",
    ]);
    expect(failover2.selected?.id).toBe("google-1");

    const exhausted = selectFailoverAccount(pool, "google-1", "auto_balance", [
      "google-2",
      "claude-1",
    ]);
    expect(exhausted.selected).toBeNull();
  });

  it("computes 10 LED capacity segments accurately", () => {
    const healthy = computeCapacitySegments(40, true);
    expect(healthy.badgeLabel).toBe("ROOM FOR MORE");
    expect(healthy.segmentTones.filter((t) => t === "green")).toHaveLength(4);

    const saturated = computeCapacitySegments(88, true);
    expect(saturated.badgeLabel).toBe("QUOTA SATURATED");
    expect(saturated.segmentTones[8]).toBe("red");

    const offline = computeCapacitySegments(50, false);
    expect(offline.badgeLabel).toBe("OFFLINE");
    expect(offline.filledCount).toBe(0);
  });

  it("supports priority_order policy and poolTag filtering across N accounts", () => {
    const extendedPool: AccountPublicState[] = [
      ...pool,
      makeAccount({
        id: "ollama-local",
        slotIndex: 4,
        priority: 1,
        provider: "openai_compatible",
        presetId: "ollama",
        authMode: "none",
        baseUrl: "http://127.0.0.1:11434/v1",
        tags: ["local", "coding"],
        quotaUsedPct: 10,
        latencyMs: 45,
      }),
    ];

    const byTag = selectBestAccount(
      extendedPool,
      "auto_balance",
      [],
      "coding",
    );
    expect(byTag.selected?.id).toBe("ollama-local");

    const byPriority = selectBestAccount(
      extendedPool.map((a) =>
        a.id === "claude-1" ? { ...a, priority: 0 } : a,
      ),
      "priority_order",
    );
    expect(byPriority.selected?.id).toBe("claude-1");
  });
});
