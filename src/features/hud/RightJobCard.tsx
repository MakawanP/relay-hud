"use client";

import clsx from "clsx";
import {
  Search,
} from "lucide-react";
import { ProviderGlyph } from "@/components/ProviderGlyph";
import { JobStatusIndicator } from "@/components/StatusDot";
import { formatDurationMs } from "@/domain/models";
import type {
  AccountPublicState,
  HudJob,
} from "@/domain/types";

export function RightJobCard({
  job,
  account,
  referenceNowMs,
  selected,
  anchorRef,
  onSelect,
}: {
  job: HudJob;
  account: AccountPublicState;
  referenceNowMs: number;
  selected: boolean;
  anchorRef: (el: HTMLElement | null) => void;
  onSelect: () => void;
}) {
  const durationMs =
    (job.endedAt ? new Date(job.endedAt).getTime() : referenceNowMs) -
    new Date(job.startedAt).getTime();

  return (
    <div className="flex flex-col">
      <div className="mb-1 flex min-w-0 items-center justify-end gap-1.5 pr-1 font-mono text-[9.5px]">
        <span className="min-w-0 truncate text-[#e5af6d]">
          ▸ {job.chatTitle}
        </span>
        <span className="shrink-0 text-[#848ea0]">
          {job.originNodeId === "dispatch-hub" ? "Dispatch Hub" : "Master"}
        </span>
      </div>

      <button
        ref={anchorRef}
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={clsx(
          "w-full cursor-pointer rounded-[8px] border p-2.5 text-left transition-colors",
          selected
            ? "border-[#56b868] bg-[#162119] shadow-[0_0_0_1px_rgba(86,184,104,0.28)]"
            : job.status === "failed"
              ? "border-[#5f2a2c] bg-[#191316] hover:border-[#82393b]"
              : job.status === "done"
                ? "border-[#2a3b4e] bg-[#141920] hover:border-[#3c5673]"
                : "border-[#2a3b30] bg-[#14181a] hover:border-[#3f6149]",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <div className="mt-0.5 flex flex-col items-center gap-1">
              <ProviderGlyph
                provider={account.provider}
                slotIndex={account.slotIndex}
                presetId={account.presetId}
                size={15}
              />
              <span
                className={clsx(
                  "rounded px-1 py-[0.5px] font-mono text-[7.5px] font-semibold",
                  job.status === "failed"
                    ? "bg-[#381a1b] text-[#ee8684]"
                    : selected || job.status === "working"
                      ? "bg-[#1a3320] text-[#8dd99b]"
                      : "bg-[#222733] text-[#9aa4b6]",
                )}
              >
                {job.dispatchMode.toUpperCase()}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="max-w-full truncate text-[11.5px] font-semibold text-[#eef2f8]">
                  {job.title}
                </span>
                <span className="shrink-0 rounded border border-[#2a3140] bg-[#1b202a] px-1 py-[0.5px] font-mono text-[8px] text-[#9ea8ba]">
                  {job.workspaceTag}
                </span>
              </div>

              <p className="mt-0.5 truncate font-mono text-[9.5px] tabular-nums text-[#8e98aa]">
                {job.tokensPerSec !== null && job.tokensPerSec > 0
                  ? `${job.tokensPerSec} tok/s · `
                  : ""}
                {formatDurationMs(durationMs)} · {job.model} · {job.repoName}
              </p>
            </div>
          </div>

          <JobStatusIndicator status={job.status} />
        </div>

        {job.subTasks.length > 0 ? (
          <div className="mt-2 space-y-1 border-t border-[#222926] pt-1.5 font-mono text-[9.5px]">
            {job.subTasks.map((sub) => (
              <div
                key={sub.id}
                className="flex items-center justify-between gap-2 text-[#aeb8ca]"
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  <Search
                    className="h-2.5 w-2.5 shrink-0 text-[#848ea0]"
                    aria-hidden="true"
                  />
                  <span className="truncate">{sub.title}</span>
                </span>
                <span className="shrink-0 tabular-nums text-[#8f99ad]">
                  {sub.metricLabel}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {job.status === "failed" && job.errorMessage ? (
          <p className="mt-1.5 truncate font-mono text-[9.5px] text-[#ee8684]">
            {job.errorMessage}
          </p>
        ) : null}
      </button>
    </div>
  );
}
