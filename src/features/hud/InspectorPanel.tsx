"use client";

import { useEffect } from "react";
import {
  ArrowRight,
  Plug,
  RefreshCw,
  RotateCcw,
  Square,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { ProviderGlyph } from "@/components/ProviderGlyph";
import { AccountStatusPill, JobStatusIndicator } from "@/components/StatusDot";
import { getProviderDisplayName } from "@/domain/connectors";
import {
  formatCostUsd,
  formatDurationMs,
  formatTokenCount,
} from "@/domain/models";
import type { AccountId, AccountPublicState, HudJob } from "@/domain/types";

interface InspectorPanelProps {
  job: HudJob | null;
  account: AccountPublicState | null;
  allAccounts: AccountPublicState[];
  referenceNowIso: string;
  mobileOpen: boolean;
  isJobActionBusy: boolean;
  onClose: () => void;
  onShowLog: () => void;
  onStopJob: (jobId: string) => void;
  onFailoverRetry: (job: HudJob) => void;
  onSelectJob: (jobId: string) => void;
  onOpenConnectAccount: (accountId: AccountId) => void;
  onTestAccount: (accountId: AccountId) => void;
  isTestingAccount: boolean;
}

export function InspectorPanel({
  job,
  account,
  allAccounts,
  referenceNowIso,
  mobileOpen,
  isJobActionBusy,
  onClose,
  onShowLog,
  onStopJob,
  onFailoverRetry,
  onSelectJob,
  onOpenConnectAccount,
  onTestAccount,
  isTestingAccount,
}: InspectorPanelProps) {
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, onClose]);

  const responsiveFrame = mobileOpen
    ? "fixed inset-0 z-40 flex w-full flex-col overflow-y-auto bg-[#15181d] p-4 shadow-2xl lg:static lg:z-auto lg:w-[306px] lg:shrink-0 lg:border-l lg:border-[#1f242e] lg:shadow-none"
    : "hidden w-[306px] shrink-0 flex-col overflow-y-auto border-l border-[#1f242e] bg-[#15181d] p-4 lg:flex";

  if (!job && !account) {
    return (
      <aside className="hidden w-[306px] shrink-0 flex-col border-l border-[#1f242e] bg-[#15181d] p-4 lg:flex">
        <div className="text-[12px] font-semibold text-[#cfd6e2]">Inspector</div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-[#8d96a8]">
          Select any job card or connected account node to inspect live tokens,
          latency, command invocations, sub-tasks, and failover traces.
        </p>
      </aside>
    );
  }

  if (job) {
    const targetAcc = allAccounts.find((a) => a.id === job.targetAccountId);
    const startedDate = new Date(job.startedAt);
    const referenceNowMs = new Date(referenceNowIso).getTime();
    const elapsedMs =
      (job.endedAt ? new Date(job.endedAt).getTime() : referenceNowMs) -
      startedDate.getTime();
    const totalTokens = job.inputTokens + job.outputTokens;
    const checkInLabel = job.lastCheckInAt
      ? `${formatDurationMs(referenceNowMs - new Date(job.lastCheckInAt).getTime())} ago`
      : "None Yet";

    return (
      <aside
        aria-label="Job Inspector"
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen ? true : undefined}
        className={responsiveFrame}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#2c3342] bg-[#1a1f28]">
              <ProviderGlyph
                provider={job.provider}
                slotIndex={targetAcc?.slotIndex}
                presetId={targetAcc?.presetId}
                size={18}
              />
            </div>
            <div className="min-w-0">
              <h2 className="break-words text-[13.5px] font-semibold leading-snug text-[#eef2f8]">
                {job.title}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded border border-[#2b3241] bg-[#1b202a] px-1.5 py-[1px] font-mono text-[8.5px] text-[#a0abbe]">
                  JOB
                </span>
                <span className="rounded border border-[#2b3241] bg-[#1b202a] px-1.5 py-[1px] font-mono text-[8.5px] text-[#a0abbe]">
                  {job.workspaceTag}
                </span>
                <span className="rounded border border-[#5f4324] bg-[#241b11] px-1.5 py-[1px] font-mono text-[8.5px] text-[#e5af6d]">
                  ▸ {job.dispatchMode.toUpperCase()}
                </span>
                <JobStatusIndicator status={job.status} />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="inline-flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded p-1.5 text-[#8f99ad] hover:bg-[#1f242e] hover:text-white"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onShowLog}
            className="inline-flex min-h-7 items-center gap-1.5 rounded-[6px] border border-[#2c3342] bg-[#1d222c] px-2.5 py-1 text-[11px] font-medium text-[#dce2ec] transition-colors hover:border-[#3e485d] hover:text-white"
          >
            <Terminal className="h-3 w-3" aria-hidden="true" />
            Show Log
          </button>

          {job.status === "working" || job.status === "waiting" ? (
            <button
              type="button"
              disabled={isJobActionBusy}
              onClick={() => onStopJob(job.id)}
              className="inline-flex min-h-7 items-center gap-1.5 rounded-[6px] border border-[#592c2e] bg-[#241618] px-2.5 py-1 text-[11px] font-medium text-[#ee9694] transition-colors hover:border-[#7d3b3d] hover:text-white disabled:opacity-50"
            >
              <Square className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
              {isJobActionBusy ? "Stopping..." : "Stop Job"}
            </button>
          ) : (
            <button
              type="button"
              disabled={isJobActionBusy}
              onClick={() => onFailoverRetry(job)}
              className="inline-flex min-h-7 items-center gap-1.5 rounded-[6px] border border-[#5f4324] bg-[#241b11] px-2.5 py-1 text-[11px] font-medium text-[#e5af6d] transition-colors hover:border-[#8a6134] hover:text-white disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              {isJobActionBusy
                ? "Dispatching..."
                : job.status === "failed"
                  ? "Failover Retry"
                  : "Re-run via ARW"}
            </button>
          )}
        </div>

        <div className="mt-4 space-y-4 text-[11px]">
          <InspectorSection title="CHECK-IN">
            <KeyValRow label="Last" value={checkInLabel} />
          </InspectorSection>

          <InspectorSection title="WHERE">
            <KeyValRow
              label="Account"
              value={targetAcc?.name ?? job.targetAccountId}
            />
            <KeyValRow label="Model" value={job.model} mono />
            <KeyValRow
              label="Sent From"
              value={`${job.originNodeId === "dispatch-hub" ? "Dispatch Hub" : "Local Master"}, ${job.chatTitle}`}
              accent="amber"
            />
            <KeyValRow label="Repo" value={job.repoName} mono />
            <KeyValRow label="Folder" value={job.folderPath} mono />
          </InspectorSection>

          <InspectorSection title="WHEN">
            <KeyValRow
              label="Started"
              value={
                startedDate.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  second: "2-digit",
                  timeZone: "UTC",
                }) + " UTC"
              }
            />
            <KeyValRow
              label="In UTC"
              value={
                startedDate.toISOString().replace("T", " ").slice(0, 19) + " UTC"
              }
              mono
            />
          </InspectorSection>

          <InspectorSection title="USAGE">
            <KeyValRow
              label="Speed"
              value={
                job.tokensPerSec !== null ? `${job.tokensPerSec} tok/s` : "—"
              }
              mono
            />
            <KeyValRow
              label="Latency"
              value={job.latencyMs !== null ? `${job.latencyMs} ms TTFT` : "—"}
              mono
            />
            <KeyValRow
              label="Running For"
              value={formatDurationMs(elapsedMs)}
              mono
            />
            <KeyValRow label="Request" value={job.pidOrReqId} mono />
            <KeyValRow label="Job" value={job.id} mono />
          </InspectorSection>

          <InspectorSection title="TOKENS">
            <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-[10.5px] tabular-nums">
              <span className="text-[#96a0b3]">
                {getProviderDisplayName(job.provider, targetAcc?.presetId)}
              </span>
              <span className="text-[#dce2ec]">
                {formatTokenCount(totalTokens)} ·{" "}
                {formatTokenCount(job.weightedTokens)} Weighted ·{" "}
                <span className="text-[#8dd99b]">
                  {formatCostUsd(job.estimatedCostUsd)}
                </span>
              </span>
            </div>
          </InspectorSection>

          <InspectorSection title="COMMAND">
            <pre className="overflow-x-auto rounded-[6px] border border-[#242935] bg-[#0e1014] p-2.5 font-mono text-[10px] leading-relaxed text-[#cfd6e2] whitespace-pre-wrap break-words">
              {job.commandPreview}
            </pre>
          </InspectorSection>

          {job.subTasks.length > 0 ? (
            <InspectorSection title="STARTED BY THIS">
              <div className="space-y-2.5">
                {job.subTasks.map((sub) => (
                  <div key={sub.id} className="space-y-1">
                    <div className="flex items-center gap-1.5 font-medium text-[#e2e7f0]">
                      <Wrench
                        className="h-3 w-3 shrink-0 text-[#8a94a8]"
                        aria-hidden="true"
                      />
                      <span className="truncate">{sub.title}</span>
                    </div>
                    <div className="font-mono text-[9.5px] text-[#8d97aa] tabular-nums">
                      {sub.detail} · {sub.durationLabel}
                    </div>
                    <pre className="overflow-x-auto rounded-[5px] border border-[#222733] bg-[#0e1014] px-2 py-1.5 font-mono text-[9.5px] text-[#b8c2d4] whitespace-pre-wrap break-words">
                      {sub.command}
                    </pre>
                  </div>
                ))}
              </div>
            </InspectorSection>
          ) : null}

          {job.handoffs.length > 0 ? (
            <InspectorSection title="SENT ELSEWHERE">
              <div className="space-y-1.5">
                {job.handoffs.map((handoff) => (
                  <button
                    key={`${handoff.targetJobId}-${handoff.targetAccountId}`}
                    type="button"
                    onClick={() => onSelectJob(handoff.targetJobId)}
                    className="flex min-h-7 w-full items-center gap-1.5 rounded border border-[#262d3a] bg-[#181c24] px-2 py-1.5 text-left text-[10.5px] text-[#c3cbd8] transition-colors hover:border-[#4b8a57] hover:text-white"
                  >
                    <ArrowRight
                      className="h-3 w-3 shrink-0 text-[#d99d55]"
                      aria-hidden="true"
                    />
                    <span className="shrink-0 font-mono text-[#e5af6d]">
                      {handoff.targetAccountLabel}
                    </span>
                    <span className="truncate">{handoff.title}</span>
                  </button>
                ))}
              </div>
            </InspectorSection>
          ) : null}
        </div>
      </aside>
    );
  }

  if (!account) return null;

  return (
    <aside
      aria-label="Account Inspector"
      role={mobileOpen ? "dialog" : undefined}
      aria-modal={mobileOpen ? true : undefined}
      className={responsiveFrame}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#2c3342] bg-[#1a1f28]">
            <ProviderGlyph
              provider={account.provider}
              slotIndex={account.slotIndex}
              presetId={account.presetId}
              size={18}
            />
          </div>
          <div className="min-w-0">
            <h2 className="break-words text-[13.5px] font-semibold text-[#eef2f8]">
              {account.name}
            </h2>
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded border border-[#2b3241] bg-[#1b202a] px-1.5 py-[1px] font-mono text-[8.5px] text-[#a0abbe]">
                {account.roleLabel}
              </span>
              <AccountStatusPill status={account.status} />
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="inline-flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded p-1.5 text-[#8f99ad] hover:bg-[#1f242e] hover:text-white"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onOpenConnectAccount(account.id)}
          className="inline-flex min-h-7 items-center gap-1.5 rounded-[6px] border border-[#3a6b44] bg-[#18291d] px-2.5 py-1 text-[11px] font-medium text-[#9ce2a9] hover:bg-[#203626]"
        >
          <Plug className="h-3 w-3" aria-hidden="true" />
          {account.hasCredentials ? "Edit Connection" : "Connect Account"}
        </button>
        <button
          type="button"
          disabled={isTestingAccount}
          onClick={() => onTestAccount(account.id)}
          className="inline-flex min-h-7 items-center gap-1.5 rounded-[6px] border border-[#2c3342] bg-[#1d222c] px-2.5 py-1 text-[11px] font-medium text-[#dce2ec] hover:border-[#3e485d] disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3 w-3 ${isTestingAccount ? "animate-spin motion-reduce:animate-none" : ""}`}
            aria-hidden="true"
          />
          Test Probe
        </button>
      </div>

      <div className="mt-4 space-y-4 text-[11px]">
        <InspectorSection title="CONNECTION">
          <KeyValRow
            label="Provider"
            value={getProviderDisplayName(account.provider, account.presetId)}
          />
          {account.baseUrl ? (
            <KeyValRow label="Endpoint" value={account.baseUrl} mono />
          ) : null}
          <KeyValRow label="Priority" value={`#${account.priority}`} mono />
          <KeyValRow
            label="Pool Tags"
            value={
              account.tags.length > 0
                ? account.tags.map((t) => `#${t}`).join(" ")
                : "—"
            }
            mono
          />
          <KeyValRow label="Auth Mode" value={account.authMode} mono />
          <KeyValRow
            label="Credential"
            value={account.maskedCredential ?? "Not set"}
            mono
          />
          <KeyValRow label="Identity" value={account.email ?? "Unlabeled"} />
          <KeyValRow
            label="Latency"
            value={
              account.latencyMs !== null ? `${account.latencyMs} ms` : "Not probed"
            }
            mono
          />
        </InspectorSection>

        <InspectorSection title="QUOTA & ROUTING">
          <KeyValRow
            label="Quota Used"
            value={`${account.quotaUsedPct}%`}
            mono
          />
          <KeyValRow
            label="RPM"
            value={`${account.rpmCurrent} / ${account.rpmLimit}`}
            mono
          />
          <KeyValRow
            label="Tokens Today"
            value={`${formatTokenCount(account.tokensUsedToday)} / ${formatTokenCount(account.tokensDailyBudget)}`}
            mono
          />
          <KeyValRow
            label="Est. Cost"
            value={formatCostUsd(account.estimatedCostUsd)}
            mono
          />
          <KeyValRow
            label="Rate Source"
            value={
              account.rateLimits.source === "live_headers"
                ? "Provider Live Headers"
                : "Local Budget Tracker"
            }
          />
        </InspectorSection>

        <InspectorSection title="AVAILABLE MODELS">
          <div className="flex flex-wrap gap-1.5">
            {account.availableModels.map((model) => (
              <span
                key={model}
                className="rounded border border-[#262c38] bg-[#11141a] px-2 py-0.5 font-mono text-[9.5px] text-[#c0cadb]"
              >
                {model}
              </span>
            ))}
          </div>
        </InspectorSection>

        {account.lastError ? (
          <InspectorSection title="LAST ERROR">
            <div
              role="alert"
              className="break-words rounded border border-[#612c2e] bg-[#1e1214] p-2.5 font-mono text-[10px] text-[#ee9694]"
            >
              {account.lastError}
            </div>
          </InspectorSection>
        ) : null}
      </div>
    </aside>
  );
}

function InspectorSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5 border-t border-[#1e232c] pt-3 first:border-t-0 first:pt-0">
      <h3 className="font-mono text-[9.5px] font-semibold tracking-[0.09em] text-[#848ea0]">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function KeyValRow({
  label,
  value,
  mono = false,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: "amber";
}) {
  return (
    <div className="grid grid-cols-[78px_1fr] items-baseline gap-2">
      <span className="text-right text-[10.5px] text-[#8a94a8]">{label}</span>
      <span
        className={`min-w-0 break-words text-[10.5px] tabular-nums ${
          mono ? "font-mono" : ""
        } ${accent === "amber" ? "text-[#e5af6d]" : "text-[#dce2ec]"}`}
      >
        {value}
      </span>
    </div>
  );
}
