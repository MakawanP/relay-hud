import type {
  AccountId,
  AccountPublicState,
  RoutingPolicy,
} from "./types";

export interface RouteDecision {
  selected: AccountPublicState | null;
  reason: string;
  fallbackChain: AccountId[];
}

export interface CapacitySummary {
  filledCount: number;
  segmentTones: Array<"green" | "amber" | "red" | "empty">;
  badgeLabel: "ROOM FOR MORE" | "HIGH LOAD" | "QUOTA SATURATED" | "OFFLINE";
  badgeTone: "muted" | "amber" | "red";
  warningText: string;
}

function isAccountEligible(
  account: AccountPublicState,
  excludeIds: ReadonlySet<AccountId>,
  requireFailoverFlag: boolean,
  poolTag?: string,
): boolean {
  if (excludeIds.has(account.id)) return false;
  if (!account.takesWork) return false;
  if (requireFailoverFlag && !account.autoFailover) return false;
  if (account.status === "disconnected" || account.status === "rate_limited") {
    return false;
  }
  if (
    !account.hasCredentials &&
    account.authMode !== "cli" &&
    account.authMode !== "none"
  ) {
    return false;
  }
  if (account.authMode === "cli" && !account.cliAvailable) return false;
  if (account.quotaUsedPct >= 98) return false;
  if (poolTag) {
    const normalized = poolTag.trim().toLowerCase();
    if (
      normalized &&
      !account.tags.some((t) => t.toLowerCase() === normalized)
    ) {
      return false;
    }
  }
  return true;
}

function scoreAccount(
  account: AccountPublicState,
  policy: RoutingPolicy,
): number {
  const latencyScore = (account.latencyMs ?? 450) / 20;
  const loadScore = account.quotaUsedPct * 1.4 + account.activeJobs * 18;
  const errorPenalty = account.status === "error" ? 120 : 0;

  switch (policy) {
    case "priority_order": {
      return (
        account.priority * 100 +
        account.slotIndex * 4 +
        account.quotaUsedPct * 0.25 +
        errorPenalty * 2
      );
    }
    case "google_first": {
      const providerBonus = account.provider === "google" ? -100 : 0;
      const slotTie = account.slotIndex * 4;
      return providerBonus + loadScore + slotTie + errorPenalty;
    }
    case "claude_first": {
      const providerBonus = account.provider === "anthropic" ? -100 : 0;
      const slotTie = account.slotIndex * 4;
      return providerBonus + loadScore + slotTie + errorPenalty;
    }
    case "lowest_latency": {
      const effectiveLatency = account.latencyMs ?? 900;
      return (
        effectiveLatency +
        account.quotaUsedPct * 0.4 +
        account.activeJobs * 15 +
        errorPenalty * 4
      );
    }
    case "auto_balance":
    default: {
      return loadScore + latencyScore * 0.4 + errorPenalty;
    }
  }
}

export function selectBestAccount(
  accounts: readonly AccountPublicState[],
  policy: RoutingPolicy,
  excludeIds: readonly AccountId[] = [],
  poolTag?: string,
): RouteDecision {
  const excluded = new Set<AccountId>(excludeIds);
  const eligible = accounts
    .filter((acc) => isAccountEligible(acc, excluded, false, poolTag))
    .sort((a, b) => scoreAccount(a, policy) - scoreAccount(b, policy));

  const primary = eligible[0] ?? null;
  if (!primary) {
    return {
      selected: null,
      reason: poolTag
        ? `No connected accounts in pool "#${poolTag}" are currently accepting work.`
        : "No connected accounts are currently accepting work with available quota headroom.",
      fallbackChain: [],
    };
  }

  const fallbackChain = eligible
    .slice(1)
    .filter((acc) => acc.autoFailover)
    .map((acc) => acc.id);

  const policyLabel: Record<RoutingPolicy, string> = {
    auto_balance: "Auto-Balance",
    priority_order: "Priority Order",
    google_first: "Google-First",
    claude_first: "Claude-First",
    lowest_latency: "Lowest Latency",
  };

  return {
    selected: primary,
    reason: `Selected ${primary.name} via ${policyLabel[policy]} (${primary.quotaUsedPct}% quota, ${primary.activeJobs} active)`,
    fallbackChain,
  };
}

export function selectFailoverAccount(
  accounts: readonly AccountPublicState[],
  failedAccountId: AccountId,
  policy: RoutingPolicy,
  alreadyTried: readonly AccountId[] = [],
): RouteDecision {
  const excluded = new Set<AccountId>([failedAccountId, ...alreadyTried]);
  const eligible = accounts
    .filter((acc) => isAccountEligible(acc, excluded, true))
    .sort((a, b) => scoreAccount(a, policy) - scoreAccount(b, policy));

  const backup = eligible[0] ?? null;
  if (!backup) {
    return {
      selected: null,
      reason: `No failover account available after ${failedAccountId} failed.`,
      fallbackChain: [],
    };
  }

  return {
    selected: backup,
    reason: `Automatic failover from ${failedAccountId} to ${backup.name} (${backup.quotaUsedPct}% quota)`,
    fallbackChain: eligible.slice(1).map((acc) => acc.id),
  };
}

export function computeCapacitySegments(
  quotaPct: number,
  online: boolean,
  statusText?: string,
): CapacitySummary {
  if (!online) {
    return {
      filledCount: 0,
      segmentTones: Array.from({ length: 10 }, () => "empty"),
      badgeLabel: "OFFLINE",
      badgeTone: "muted",
      warningText: statusText ?? "Account not connected",
    };
  }

  const clamped = Math.max(0, Math.min(100, Math.round(quotaPct)));
  const filledCount = Math.min(
    10,
    Math.max(clamped > 0 ? 1 : 0, Math.round(clamped / 10)),
  );

  const segmentTones: Array<"green" | "amber" | "red" | "empty"> = [];
  for (let i = 0; i < 10; i += 1) {
    if (i >= filledCount) {
      segmentTones.push("empty");
    } else if (i < 5) {
      segmentTones.push("green");
    } else if (i < 8) {
      segmentTones.push("amber");
    } else {
      segmentTones.push("red");
    }
  }

  if (clamped >= 85) {
    return {
      filledCount,
      segmentTones,
      badgeLabel: "QUOTA SATURATED",
      badgeTone: "amber",
      warningText: statusText ?? `Quota ${clamped}% of 90%`,
    };
  }

  if (clamped >= 65) {
    return {
      filledCount,
      segmentTones,
      badgeLabel: "HIGH LOAD",
      badgeTone: "amber",
      warningText: statusText ?? `Quota Headroom ${100 - clamped}%`,
    };
  }

  return {
    filledCount,
    segmentTones,
    badgeLabel: "ROOM FOR MORE",
    badgeTone: "muted",
    warningText: statusText ?? `Quota Headroom ${100 - clamped}%`,
  };
}
