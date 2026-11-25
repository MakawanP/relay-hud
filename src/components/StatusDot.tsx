"use client";

import clsx from "clsx";
import type { AccountConnectionStatus, JobStatus } from "@/domain/types";

export function AccountStatusPill({
  status,
}: {
  status: AccountConnectionStatus;
}) {
  const config: Record<
    AccountConnectionStatus,
    { label: string; dot: string; text: string }
  > = {
    online: { label: "Online", dot: "bg-[#56b868]", text: "text-[#8dd99b]" },
    rate_limited: {
      label: "Rate Limited",
      dot: "bg-[#c48a47]",
      text: "text-[#e5af6d]",
    },
    error: { label: "Error", dot: "bg-[#c2504e]", text: "text-[#ee8684]" },
    disconnected: {
      label: "Disconnected",
      dot: "bg-[#747e91]",
      text: "text-[#929caf]",
    },
  };
  const cfg = config[status];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 text-[10.5px] font-medium",
        cfg.text,
      )}
    >
      <span
        aria-hidden="true"
        className={clsx("h-[6px] w-[6px] rounded-full", cfg.dot)}
      />
      {cfg.label}
    </span>
  );
}

export function JobStatusIndicator({ status }: { status: JobStatus }) {
  const map: Record<
    JobStatus,
    { label: string; dot: string; text: string }
  > = {
    working: {
      label: "Working",
      dot: "bg-[#56b868]",
      text: "text-[#8dd99b]",
    },
    waiting: {
      label: "Waiting",
      dot: "border border-[#c48a47] bg-transparent",
      text: "text-[#e5af6d]",
    },
    done: { label: "Done", dot: "bg-[#4d94d6]", text: "text-[#85bef2]" },
    failed: { label: "Failed", dot: "bg-[#c2504e]", text: "text-[#ee8684]" },
    idle: {
      label: "Idle",
      dot: "border border-[#96836a] bg-transparent",
      text: "text-[#a49a8d]",
    },
    stopped: {
      label: "Stopped",
      dot: "bg-[#7f8899]",
      text: "text-[#9aa3b2]",
    },
  };
  const cfg = map[status];
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center gap-1.5 text-[10.5px] font-medium",
        cfg.text,
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "h-[6px] w-[6px] rounded-full",
          cfg.dot,
          status === "working" && "animate-pulse motion-reduce:animate-none",
        )}
      />
      {cfg.label}
    </span>
  );
}
