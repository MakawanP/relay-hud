"use client";

import clsx from "clsx";
import { computeCapacitySegments } from "@/domain/routing";

interface LedCapacityBarProps {
  quotaPct: number;
  online: boolean;
  warningText?: string;
}

export function LedCapacityBar({
  quotaPct,
  online,
  warningText,
}: LedCapacityBarProps) {
  const summary = computeCapacitySegments(quotaPct, online, warningText);

  return (
    <div className="mt-2 flex items-center justify-between gap-2 border-t border-[#1e222b] pt-2">
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="font-mono text-[9px] font-medium tracking-[0.07em] text-[#848ea0]">
          CAPACITY
        </span>
        <div
          className="flex items-center gap-[2px]"
          aria-label={online ? `Capacity ${quotaPct}%` : "Capacity offline"}
          role="img"
        >
          {summary.segmentTones.map((tone, index) => (
            <span
              key={index}
              aria-hidden="true"
              className={clsx("h-[7.5px] w-[5px] rounded-[1.5px]", {
                "bg-[#56b868]": tone === "green",
                "bg-[#c48a47]": tone === "amber",
                "bg-[#c2504e]": tone === "red",
                "bg-[#252a34]": tone === "empty",
              })}
            />
          ))}
        </div>
        <span
          className={clsx(
            "shrink-0 rounded-[4px] border px-1.5 py-[1px] font-mono text-[8px] font-medium tracking-[0.05em]",
            summary.badgeTone === "amber"
              ? "border-[#7d582c] bg-[#2a1f12] text-[#e5af6d]"
              : "border-[#272c38] bg-[#191d25] text-[#9aa4b6]",
          )}
        >
          {summary.badgeLabel}
        </span>
      </div>

      <span
        className={clsx(
          "min-w-0 truncate text-right font-mono text-[9.5px] tabular-nums",
          summary.badgeTone === "amber" ? "text-[#e5af6d]" : "text-[#8e98aa]",
        )}
        title={summary.warningText}
      >
        {summary.warningText}
      </span>
    </div>
  );
}
