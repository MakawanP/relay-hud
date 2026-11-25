"use client";

import clsx from "clsx";
import {
  Sparkles,
  Terminal,
} from "lucide-react";
import { JobStatusIndicator } from "@/components/StatusDot";
import type {
  AccountId,
  AccountPublicState,
  ChatGroup,
  HudJob,
  LocalProcessInfo,
} from "@/domain/types";

export function LeftChatStack({
  chats,
  localProcesses = [],
  jobsById,
  accountsById,
  selectedJobId,
  registerAnchor,
  onSelectJob,
}: {
  chats: ChatGroup[];
  localProcesses?: LocalProcessInfo[];
  jobsById: Map<string, HudJob>;
  accountsById: Map<AccountId, AccountPublicState>;
  selectedJobId: string | null;
  registerAnchor: (key: string) => (el: HTMLElement | null) => void;
  onSelectJob: (jobId: string) => void;
}) {
  const arwChats = chats.filter((c) => c.groupKind === "arw");
  const localChats = chats.filter((c) => c.groupKind === "local");

  if (chats.length === 0 && localProcesses.length === 0) {
    return (
      <div className="mt-2 rounded-lg border border-dashed border-[#242a35] bg-[#12151a] px-3 py-2.5 text-[11px] text-[#8a94a8]">
        No routed sessions yet. Click{" "}
        <span className="text-[#8dd99b]">New Job</span> to dispatch across your
        account pool.
      </div>
    );
  }

  return (
    <div className="mt-2.5 space-y-2.5 border-l border-[#1f242e] pl-3">
      {arwChats.length > 0 ? (
        <div className="space-y-2">
          <div className="font-mono text-[9.5px] tracking-[0.06em] text-[#e5af6d]">
            ▸ ARW {arwChats.length}
          </div>
          {arwChats.map((chat) => {
            const childJobs = chat.jobIds
              .map((id) => jobsById.get(id))
              .filter((j): j is HudJob => Boolean(j));
            const hasSelected = childJobs.some((j) => j.id === selectedJobId);
            const isWorking = childJobs.some((j) => j.status === "working");
            return (
              <article
                key={chat.id}
                ref={registerAnchor(`chat:${chat.id}`)}
                className={clsx(
                  "rounded-[8px] border bg-[#14171c] p-2.5 transition-colors",
                  hasSelected
                    ? "border-[#c48a47] bg-[#1c1813]"
                    : isWorking
                      ? "border-[#2e5236] hover:border-[#447d51]"
                      : "border-[#543c22]/70 hover:border-[#805c34]",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    disabled={childJobs.length === 0}
                    onClick={() => {
                      if (childJobs[0]) onSelectJob(childJobs[0].id);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded text-left disabled:cursor-default"
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#423222] bg-[#1f1913]"
                    >
                      <Sparkles className="h-2.5 w-2.5 text-[#d99d55]" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[11.5px] font-semibold text-[#e6eaf0]">
                          {chat.title}
                        </span>
                        <span className="shrink-0 rounded border border-[#2a3140] bg-[#1a1f29] px-1 py-[0.5px] font-mono text-[8px] text-[#9aa4b6]">
                          {chat.workspaceTag}
                        </span>
                      </div>
                      <p className="truncate font-mono text-[9.5px] text-[#848ea0]">
                        {chat.elapsedLabel} · {chat.metricSummary}
                      </p>
                    </div>
                  </button>
                  <JobStatusIndicator status={chat.status} />
                </div>

                {childJobs.length > 0 ? (
                  <div className="mt-2 space-y-1 border-t border-[#1e222b] pt-1.5">
                    {childJobs.map((cj) => (
                      <button
                        key={cj.id}
                        type="button"
                        aria-pressed={cj.id === selectedJobId}
                        onClick={() => onSelectJob(cj.id)}
                        className={clsx(
                          "flex min-h-6 w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left text-[10.5px] transition-colors hover:bg-[#1e232d]",
                          cj.id === selectedJobId
                            ? "text-[#f2d0a4]"
                            : "text-[#aeb8ca]",
                        )}
                      >
                        <span className="min-w-0 truncate">
                          <span className="mr-1 font-mono text-[#e5af6d]">
                            ▸ #
                            {accountsById.get(cj.targetAccountId)?.slotIndex ??
                              "?"}
                          </span>
                          {cj.title}
                        </span>
                        <JobStatusIndicator status={cj.status} />
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {localChats.length > 0 || localProcesses.length > 0 ? (
        <div className="space-y-2 pt-1">
          <div className="font-mono text-[9.5px] tracking-[0.06em] text-[#848ea0]">
            ···· LOCAL {localChats.length + localProcesses.length}
          </div>
          {localProcesses.map((proc) => (
            <div
              key={proc.pid}
              className="rounded-[8px] border border-[#222630] bg-[#13161b] p-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Terminal
                    className="h-3.5 w-3.5 shrink-0 text-[#8a94a8]"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[11.5px] font-medium text-[#d4dce8]">
                        {proc.label}
                      </span>
                      <span className="shrink-0 rounded border border-[#262c38] bg-[#191d25] px-1 py-[0.5px] font-mono text-[8px] uppercase text-[#929caf]">
                        {proc.category}
                      </span>
                    </div>
                    <p className="truncate font-mono text-[9.5px] tabular-nums text-[#848ea0]">
                      PID {proc.pid} · {proc.cpuPct}% CPU · {proc.memoryMb} MB ·{" "}
                      {proc.elapsed}
                    </p>
                  </div>
                </div>
                <JobStatusIndicator
                  status={proc.cpuPct >= 1 ? "working" : "idle"}
                />
              </div>
            </div>
          ))}
          {localChats.map((chat) => (
            <div
              key={chat.id}
              className="rounded-[8px] border border-[#222630] bg-[#13161b] p-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Terminal
                    className="h-3.5 w-3.5 shrink-0 text-[#8a94a8]"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[11.5px] font-medium text-[#d4dce8]">
                        {chat.title}
                      </span>
                      <span className="shrink-0 rounded border border-[#262c38] bg-[#191d25] px-1 py-[0.5px] font-mono text-[8px] text-[#929caf]">
                        {chat.workspaceTag}
                      </span>
                    </div>
                    <p className="truncate font-mono text-[9.5px] text-[#848ea0]">
                      {chat.elapsedLabel} · {chat.metricSummary}
                    </p>
                  </div>
                </div>
                <JobStatusIndicator status={chat.status} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
