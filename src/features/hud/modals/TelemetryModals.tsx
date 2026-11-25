"use client";

import clsx from "clsx";
import { Check, RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { LedCapacityBar } from "@/components/LedCapacityBar";
import { MiniMeter } from "@/components/MiniMeter";
import { ModalShell } from "@/components/ModalShell";
import { ProviderGlyph } from "@/components/ProviderGlyph";
import { AccountStatusPill, JobStatusIndicator } from "@/components/StatusDot";
import { getProviderAccentHex } from "@/domain/connectors";
import {
  formatCostUsd,
  formatDurationMs,
  formatTokenCount,
} from "@/domain/models";
import type { AccountId, HudJob, HudSnapshot } from "@/domain/types";

export function UsageLimitsModal({
  open,
  snapshot,
  onClose,
  onUpdateLimit,
}: {
  open: boolean;
  snapshot: HudSnapshot;
  onClose: () => void;
  onUpdateLimit: (
    accountId: AccountId,
    rpmLimit: number,
    tokensDailyBudget: number,
  ) => Promise<void>;
}) {
  const [savingId, setSavingId] = useState<AccountId | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { rpm: string; budgetM: string }>
  >({});

  return (
    <ModalShell
      open={open}
      title="Usage Limits & Rate Quotas"
      subtitle={`Live token ceilings, requests/minute windows, and provider rate-limit headers across all ${snapshot.accounts.length} connectors.`}
      onClose={onClose}
    >
      <div className="space-y-3">
        {snapshot.accounts.map((acc) => {
          const draft = drafts[acc.id] ?? {
            rpm: String(acc.rpmLimit),
            budgetM: String(Math.round(acc.tokensDailyBudget / 1_000_000)),
          };
          return (
            <div
              key={acc.id}
              className="rounded-lg border border-[#242a36] bg-[#101318] p-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ProviderGlyph
                    provider={acc.provider}
                    slotIndex={acc.slotIndex}
                    presetId={acc.presetId}
                    size={16}
                  />
                  <span className="text-[12.5px] font-semibold text-white">
                    {acc.name}
                  </span>
                  <span className="rounded border border-[#282e3b] bg-[#181c24] px-1.5 py-[1px] font-mono text-[9px] text-[#a0abbe]">
                    {acc.rateLimits.source === "live_headers"
                      ? "LIVE HEADERS"
                      : "LOCAL BUDGET"}
                  </span>
                </div>
                <AccountStatusPill status={acc.status} />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <MiniMeter
                  label="QUOTA"
                  valueText={`${acc.quotaUsedPct}%`}
                  percent={acc.quotaUsedPct}
                />
                <MiniMeter
                  label="REQ REMAINING"
                  valueText={`${acc.rateLimits.requestsRemaining} / ${acc.rateLimits.requestsLimit}`}
                  percent={
                    acc.rateLimits.requestsLimit > 0
                      ? ((acc.rateLimits.requestsLimit -
                          acc.rateLimits.requestsRemaining) /
                          acc.rateLimits.requestsLimit) *
                        100
                      : 0
                  }
                />
                <MiniMeter
                  label="TOKENS TODAY"
                  valueText={`${formatTokenCount(acc.tokensUsedToday)} / ${formatTokenCount(acc.tokensDailyBudget)}`}
                  percent={
                    acc.tokensDailyBudget > 0
                      ? (acc.tokensUsedToday / acc.tokensDailyBudget) * 100
                      : 0
                  }
                />
              </div>

              <LedCapacityBar
                quotaPct={acc.quotaUsedPct}
                online={acc.status === "online"}
                warningText={`Est. spend ${formatCostUsd(acc.estimatedCostUsd)}`}
              />

              <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-t border-[#1e232c] pt-2.5">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-[10.5px] text-[#96a0b3]">
                    RPM Cap
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={draft.rpm}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [acc.id]: { ...draft, rpm: e.target.value },
                        }))
                      }
                      className="ml-1.5 w-20 rounded border border-[#282e3b] bg-[#151820] px-2 py-1 font-mono text-[11px] text-white"
                    />
                  </label>
                  <label className="text-[10.5px] text-[#96a0b3]">
                    Daily Budget (M tok)
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={draft.budgetM}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [acc.id]: { ...draft, budgetM: e.target.value },
                        }))
                      }
                      className="ml-1.5 w-20 rounded border border-[#282e3b] bg-[#151820] px-2 py-1 font-mono text-[11px] text-white"
                    />
                  </label>
                </div>

                <button
                  type="button"
                  disabled={savingId === acc.id}
                  onClick={async () => {
                    setSavingId(acc.id);
                    try {
                      await onUpdateLimit(
                        acc.id,
                        Math.max(1, Number(draft.rpm) || acc.rpmLimit),
                        Math.max(1, Number(draft.budgetM) || 10) * 1_000_000,
                      );
                    } finally {
                      setSavingId(null);
                    }
                  }}
                  className="min-h-7 rounded border border-[#3a6b44] bg-[#18291d] px-2.5 py-1 text-[10.5px] font-medium text-[#9ce2a9] hover:bg-[#223928] disabled:opacity-50"
                >
                  {savingId === acc.id ? "Saving..." : "Update Limits"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
}

export function AnalyticsModal({
  open,
  snapshot,
  onClose,
}: {
  open: boolean;
  snapshot: HudSnapshot;
  onClose: () => void;
}) {
  const totalTokens = snapshot.accounts.reduce(
    (sum, a) => sum + a.tokensUsedToday,
    0,
  );
  const totalCost = snapshot.accounts.reduce(
    (sum, a) => sum + a.estimatedCostUsd,
    0,
  );
  const totalJobs = snapshot.accounts.reduce((sum, a) => sum + a.totalJobs, 0);
  const totalFailovers = snapshot.accounts.reduce(
    (sum, a) => sum + a.failoverCount,
    0,
  );
  const maxAccountTokens = Math.max(
    1,
    ...snapshot.accounts.map((a) => a.tokensUsedToday),
  );

  return (
    <ModalShell
      open={open}
      title="Pool Analytics & Token Distribution"
      subtitle={`Throughput, spend, and failover resilience across your ${snapshot.accounts.length}-account pool.`}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="TOKENS TODAY" value={formatTokenCount(totalTokens)} />
        <MetricCard
          label="EST. SPEND"
          value={formatCostUsd(totalCost)}
          accent="green"
        />
        <MetricCard label="TOTAL JOBS" value={String(totalJobs)} />
        <MetricCard
          label="AUTO-FAILOVERS"
          value={String(totalFailovers)}
          accent="amber"
        />
      </div>

      <div className="mt-4 rounded-lg border border-[#242a36] bg-[#101318] p-4">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#8d97aa]">
          Token Share by Connected Account
        </h3>
        <div className="mt-3 space-y-3">
          {snapshot.accounts.map((acc) => {
            const pct = Math.round((acc.tokensUsedToday / maxAccountTokens) * 100);
            return (
              <div key={acc.id} className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
                  <span className="flex items-center gap-2 font-medium text-[#e6eaf0]">
                    <ProviderGlyph
                      provider={acc.provider}
                      slotIndex={acc.slotIndex}
                      presetId={acc.presetId}
                      size={14}
                    />
                    {acc.name}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-[#b8c2d4]">
                    {formatTokenCount(acc.tokensUsedToday)} ·{" "}
                    {formatCostUsd(acc.estimatedCostUsd)} ·{" "}
                    {acc.latencyMs !== null ? `${acc.latencyMs}ms` : "—"}
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#1d222c]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(pct, acc.tokensUsedToday > 0 ? 4 : 0)}%`,
                      backgroundColor: getProviderAccentHex(
                        acc.provider,
                        acc.slotIndex,
                        acc.presetId,
                      ),
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ModalShell>
  );
}

export function JobsByChatModal({
  open,
  snapshot,
  onClose,
  onSelectJob,
}: {
  open: boolean;
  snapshot: HudSnapshot;
  onClose: () => void;
  onSelectJob: (jobId: string) => void;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const filteredJobs = snapshot.jobs.filter((j) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      j.title.toLowerCase().includes(q) ||
      j.chatTitle.toLowerCase().includes(q) ||
      j.model.toLowerCase().includes(q) ||
      j.targetAccountId.toLowerCase().includes(q)
    );
  });

  return (
    <ModalShell
      open={open}
      title="Jobs by Chat Session"
      subtitle={`Search and jump directly to any routed job across your ${snapshot.accounts.length} accounts.`}
      onClose={onClose}
    >
      <label htmlFor={searchId} className="sr-only">
        Filter jobs by chat, title, model, or account
      </label>
      <input
        id={searchId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by chat, job title, model, or account..."
        className="w-full rounded-md border border-[#282e3b] bg-[#101318] px-3 py-2 text-[12px] text-white placeholder:text-[#7f899c] focus:border-[#56b868]"
      />

      <div className="mt-3 space-y-2">
        {filteredJobs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#262c38] p-6 text-center text-[12px] text-[#8d97aa]">
            {query
              ? "No jobs match your filter."
              : "No jobs dispatched yet. Use New Job to stream your first task."}
          </div>
        ) : (
          filteredJobs.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => {
                onSelectJob(job.id);
                onClose();
              }}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-[#242a36] bg-[#101318] px-3.5 py-2.5 text-left transition-colors hover:border-[#4b8a57]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[12px] font-semibold text-white">
                    {job.title}
                  </span>
                  <span className="shrink-0 truncate rounded border border-[#29303f] bg-[#181c24] px-1.5 py-[1px] font-mono text-[9px] text-[#a0abbe]">
                    {job.chatTitle}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-mono text-[10px] text-[#8d97aa]">
                  {job.targetAccountId} · {job.model} ·{" "}
                  {formatTokenCount(job.inputTokens + job.outputTokens)} tok ·{" "}
                  {formatCostUsd(job.estimatedCostUsd)}
                </p>
              </div>
              <JobStatusIndicator status={job.status} />
            </button>
          ))
        )}
      </div>
    </ModalShell>
  );
}

export function HostHealthModal({
  open,
  snapshot,
  onClose,
}: {
  open: boolean;
  snapshot: HudSnapshot;
  onClose: () => void;
}) {
  const { host } = snapshot;
  const memPct = Math.round(
    (host.memoryUsedGb / Math.max(1, host.memoryTotalGb)) * 100,
  );
  return (
    <ModalShell
      open={open}
      title={`Local Host Telemetry — ${host.hostname}`}
      subtitle="Live hardware metrics collected directly from this Mac via Node os / sysctl / vm_stat."
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="CPU USAGE" value={`${host.cpuUsagePct}%`} />
        <MetricCard
          label="MEMORY"
          value={`${host.memoryUsedGb}/${host.memoryTotalGb} GB`}
          accent={host.memoryPressure === "normal" ? "green" : "amber"}
        />
        <MetricCard label="LOAD AVG (1M)" value={host.loadAvg[0].toFixed(2)} />
        <MetricCard
          label="UPTIME"
          value={formatDurationMs(host.uptimeSec * 1000)}
        />
      </div>

      <div className="mt-4 space-y-2 rounded-lg border border-[#242a36] bg-[#101318] p-4 font-mono text-[11px] text-[#c0cadb]">
        <div className="flex justify-between gap-3">
          <span className="shrink-0 text-[#8d97aa]">Silicon / CPU</span>
          <span className="min-w-0 truncate text-right">{host.chipModel}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="shrink-0 text-[#8d97aa]">Platform</span>
          <span className="text-right">{host.platform}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="shrink-0 text-[#8d97aa]">Memory Pressure</span>
          <span className="text-right uppercase">
            {host.memoryPressure} ({memPct}%)
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="shrink-0 text-[#8d97aa]">Load Averages (1m / 5m / 15m)</span>
          <span className="text-right">{host.loadAvg.join(" / ")}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="shrink-0 text-[#8d97aa]">Local CLI Tools</span>
          <span className="text-right">
            claude: {host.cliTools.claude ? "installed" : "not found"} · gemini:{" "}
            {host.cliTools.gemini ? "installed" : "not found"}
          </span>
        </div>
      </div>
    </ModalShell>
  );
}

export function AlertsModal({
  open,
  snapshot,
  onClose,
  onAcknowledge,
  onFailoverRetry,
}: {
  open: boolean;
  snapshot: HudSnapshot;
  onClose: () => void;
  onAcknowledge: (alertId: string) => Promise<void>;
  onFailoverRetry: (job: HudJob) => Promise<void>;
}) {
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);

  return (
    <ModalShell
      open={open}
      title="Alerts & Failover Events"
      subtitle={`Quota warnings, rate-limit failovers, and job failures across your ${snapshot.accounts.length} connectors.`}
      onClose={onClose}
    >
      {snapshot.alerts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#262c38] p-6 text-center text-[12px] text-[#8d97aa]">
          All quiet — zero active alerts across your {snapshot.accounts.length}{" "}
          configured accounts.
        </div>
      ) : (
        <div className="space-y-2.5">
          {snapshot.alerts.map((alert) => {
            const linkedJob = alert.jobId
              ? snapshot.jobs.find((j) => j.id === alert.jobId)
              : undefined;
            const isBusy = busyAlertId === alert.id;
            return (
              <div
                key={alert.id}
                className={clsx(
                  "rounded-lg border p-3.5",
                  alert.acknowledged
                    ? "border-[#222732] bg-[#111419] opacity-65"
                    : alert.severity === "critical"
                      ? "border-[#6b3132] bg-[#1c1214]"
                      : "border-[#6e4e2a] bg-[#1e1810]",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-[12px] font-semibold text-white">
                      {alert.title}
                    </div>
                    <p className="mt-1 break-words text-[11px] leading-relaxed text-[#b8c2d4]">
                      {alert.detail}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {linkedJob && linkedJob.status === "failed" ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          setBusyAlertId(alert.id);
                          try {
                            await onFailoverRetry(linkedJob);
                            onClose();
                          } finally {
                            setBusyAlertId(null);
                          }
                        }}
                        className="inline-flex min-h-7 items-center gap-1 rounded border border-[#6e4e2a] bg-[#2a1f12] px-2 py-1 text-[10.5px] font-medium text-[#e5af6d] hover:text-white disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden="true" />
                        Failover Retry
                      </button>
                    ) : null}
                    {!alert.acknowledged ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          setBusyAlertId(alert.id);
                          try {
                            await onAcknowledge(alert.id);
                          } finally {
                            setBusyAlertId(null);
                          }
                        }}
                        className="inline-flex min-h-7 items-center gap-1 rounded border border-[#2d3442] bg-[#1a1f28] px-2 py-1 text-[10.5px] text-[#c7cfdc] hover:text-white disabled:opacity-50"
                      >
                        <Check className="h-3 w-3" aria-hidden="true" />
                        Ack
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ModalShell>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "green" | "amber";
}) {
  return (
    <div className="rounded-lg border border-[#242a36] bg-[#101318] p-3">
      <div className="font-mono text-[9.5px] tracking-[0.08em] text-[#848ea0]">
        {label}
      </div>
      <div
        className={clsx(
          "mt-1 font-mono text-[17px] font-semibold tabular-nums",
          accent === "green"
            ? "text-[#8dd99b]"
            : accent === "amber"
              ? "text-[#e5af6d]"
              : "text-white",
        )}
      >
        {value}
      </div>
    </div>
  );
}
