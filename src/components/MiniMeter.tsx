"use client";

import clsx from "clsx";

interface MiniMeterProps {
  label: string;
  valueText: string;
  percent: number;
  tone?: "default" | "amber" | "red" | "green";
}

export function resolveMiniMeterTone(
  percent: number,
  explicitTone: "default" | "amber" | "red" | "green" = "default",
): "default" | "amber" | "red" | "green" {
  if (explicitTone !== "default") return explicitTone;
  if (percent >= 95) return "red";
  if (percent >= 85) return "amber";
  return "default";
}

export function MiniMeter({
  label,
  valueText,
  percent,
  tone = "default",
}: MiniMeterProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const resolvedTone = resolveMiniMeterTone(clamped, tone);

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-baseline justify-between gap-1">
        <span className="font-mono text-[9px] font-medium tracking-[0.07em] text-[#848ea0]">
          {label}
        </span>
        <span
          className={clsx(
            "truncate font-mono text-[10px] tabular-nums",
            resolvedTone === "amber"
              ? "text-[#e5af6d]"
              : resolvedTone === "red"
                ? "text-[#ee7e7c]"
                : "text-[#cfd7e3]",
          )}
        >
          {valueText}
        </span>
      </div>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-[#242934]">
        <div
          className={clsx("h-full rounded-full transition-[width] duration-300", {
            "bg-[#8b96a8]": resolvedTone === "default",
            "bg-[#c48a47]": resolvedTone === "amber",
            "bg-[#c2504e]": resolvedTone === "red",
            "bg-[#56b868]": resolvedTone === "green",
          })}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
