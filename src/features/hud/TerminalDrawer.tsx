"use client";

import clsx from "clsx";
import { Check, Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { HudJob } from "@/domain/types";

interface TerminalDrawerProps {
  job: HudJob | null;
  open: boolean;
  onClose: () => void;
}

export function TerminalDrawer({ job, open, onClose }: TerminalDrawerProps) {
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!follow || !open) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [follow, open, job?.logs.length, job?.outputText.length]);

  if (!open) return null;

  const copyPayload = job
    ? [
        ...job.logs.map((l) => `[${l.timestamp.slice(11, 19)}] ${l.text}`),
        ...(job.outputText ? ["", "--- STREAM OUTPUT ---", job.outputText] : []),
      ].join("\n")
    : "";

  const handleCopy = async (): Promise<void> => {
    if (!copyPayload) return;
    try {
      await navigator.clipboard.writeText(copyPayload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable in restricted contexts.
    }
  };

  return (
    <section
      aria-label="Live Job Log Terminal"
      className="flex h-[168px] shrink-0 flex-col border-t border-[#1f242e] bg-[#0d0f13]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#1b2029] bg-[#12151b] px-3.5 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[11.5px] font-semibold text-[#e6eaf0]">
            {job ? job.title : "Live Output Log"}
          </span>
          {job ? (
            <span className="hidden rounded border border-[#252b37] bg-[#171b23] px-1.5 py-[1px] font-mono text-[9px] text-[#96a0b3] sm:inline-block">
              {job.targetAccountId} · {job.model}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-pressed={follow}
            onClick={() => setFollow((prev) => !prev)}
            className={clsx(
              "inline-flex min-h-6 items-center gap-1 rounded-[5px] border px-2 py-0.5 text-[10.5px] font-medium transition-colors",
              follow
                ? "border-[#384255] bg-[#1e2430] text-[#eef2f8]"
                : "border-[#252b36] bg-[#161a22] text-[#929caf] hover:text-white",
            )}
          >
            {follow ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
            Follow
          </button>

          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={!copyPayload}
            className="inline-flex min-h-6 items-center gap-1 rounded-[5px] border border-[#252b36] bg-[#161a22] px-2 py-0.5 text-[10.5px] font-medium text-[#c0cadb] transition-colors hover:border-[#394152] hover:text-white disabled:opacity-40"
          >
            {copied ? (
              <Check className="h-3 w-3 text-[#65c977]" aria-hidden="true" />
            ) : (
              <Copy className="h-3 w-3" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close terminal drawer"
            className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-[5px] border border-[#252b36] bg-[#161a22] p-1 text-[#929caf] transition-colors hover:border-[#394152] hover:text-white"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-2.5 font-mono text-[11px] leading-[1.6] text-[#c7cfdc]"
      >
        {!job ? (
          <div className="text-[#848ea0]">
            Select any job card to inspect live streamed logs and responses.
          </div>
        ) : (
          <>
            {job.logs.map((entry) => (
              <div
                key={entry.id}
                className={clsx("whitespace-pre-wrap break-words", {
                  "text-[#9aa4b6]": entry.level === "info",
                  "text-[#e2e7f0]": entry.level === "stream",
                  "text-[#e5af6d]": entry.level === "warn",
                  "text-[#ee8684]": entry.level === "error",
                  "text-[#8dd99b]": entry.level === "success",
                })}
              >
                <span className="mr-2 select-none text-[#7f899c]">
                  {entry.timestamp.slice(11, 19)}
                </span>
                {entry.text}
              </div>
            ))}

            {job.outputText ? (
              <div className="mt-2 border-t border-[#1e232d] pt-2 whitespace-pre-wrap break-words text-[#eef2f8]">
                {job.outputText}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
