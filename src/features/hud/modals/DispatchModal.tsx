"use client";

import clsx from "clsx";
import { Layers, Play, Sparkles } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { ModalShell } from "@/components/ModalShell";
import { ProviderGlyph } from "@/components/ProviderGlyph";
import type {
  AccountId,
  AccountPublicState,
  DispatchTarget,
  HudJob,
} from "@/domain/types";

interface DispatchModalProps {
  open: boolean;
  initialTarget: DispatchTarget;
  accounts: AccountPublicState[];
  onClose: () => void;
  onDispatched: (jobs: HudJob[]) => Promise<void>;
  onOpenAccounts: (accountId: AccountId | null) => void;
}

const STARTER_BRIEFS = [
  {
    label: "Compare All Models",
    title: "Multi-Model Architecture Trade-off",
    target: "fanout_all" as DispatchTarget,
    prompt:
      "Compare SQLite vs Postgres for a local-first macOS developer telemetry HUD that syncs optionally to cloud. Give 3 concise bullet trade-offs and a clear recommendation.",
  },
  {
    label: "Security Audit",
    title: "API Auth & Token Boundary Audit",
    target: "arw" as DispatchTarget,
    prompt:
      "List the top 5 security invariants to enforce when storing OAuth refresh tokens and API keys in a local Node.js server.",
  },
  {
    label: "Auto-Route Brief",
    title: "Summarize Service Telemetry",
    target: "arw" as DispatchTarget,
    prompt:
      "Draft a concise incident checklist for diagnosing HTTP 429 rate-limit spikes across multiple LLM provider accounts with automatic failover.",
  },
];

export function DispatchModal({
  open,
  initialTarget,
  accounts,
  onClose,
  onDispatched,
  onOpenAccounts,
}: DispatchModalProps) {
  const errorId = useId();
  const [target, setTarget] = useState<DispatchTarget>(initialTarget);
  const [poolTag, setPoolTag] = useState("");
  const [title, setTitle] = useState("");
  const [repoName, setRepoName] = useState("relay-hud");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const acc of accounts) {
      for (const tag of acc.tags) set.add(tag);
    }
    return Array.from(set).sort();
  }, [accounts]);

  useEffect(() => {
    setTarget(initialTarget);
    setPoolTag("");
    setError(null);
  }, [initialTarget, open]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!title.trim() || !prompt.trim()) {
      setError("Enter both a short job title and a prompt brief.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          prompt: prompt.trim(),
          target,
          ...(poolTag && (target === "arw" || target === "fanout_all")
            ? { poolTag }
            : {}),
          repoName: repoName.trim() || "relay-hud",
        }),
      });
      const data = (await res.json()) as { jobs?: HudJob[]; error?: string };
      if (!res.ok || !data.jobs) {
        setError(data.error ?? "Failed to dispatch job.");
        return;
      }
      setTitle("");
      setPrompt("");
      await onDispatched(data.jobs);
      onClose();
    } catch {
      setError("Could not reach the RelayHUD dispatch endpoint.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open={open}
      title="Dispatch Live Job"
      subtitle={`Route automatically via ARW, pin any of your ${accounts.length} connectors, or Fan-Out in parallel across connected accounts.`}
      maxWidthClass="max-w-2xl"
      onClose={onClose}
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] text-[#8d97aa]">Presets:</span>
          {STARTER_BRIEFS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                setTitle(preset.title);
                setTarget(preset.target);
                setPrompt(preset.prompt);
                setError(null);
              }}
              className="min-h-7 rounded-md border border-[#272d3a] bg-[#171b23] px-2.5 py-1 text-[10.5px] text-[#c0cadb] transition-colors hover:border-[#3e485c] hover:text-white"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div>
          <span className="block font-mono text-[10px] uppercase tracking-[0.08em] text-[#8d97aa]">
            Routing Target
          </span>
          <div className="mt-1.5 grid max-h-[168px] grid-cols-2 gap-2 overflow-y-auto pr-0.5 sm:grid-cols-4">
            <TargetTile
              active={target === "arw"}
              label="Auto (ARW)"
              sub="Best eligible"
              icon={
                <Sparkles
                  className="h-3.5 w-3.5 text-[#e5af6d]"
                  aria-hidden="true"
                />
              }
              onClick={() => setTarget("arw")}
            />
            <TargetTile
              active={target === "fanout_all"}
              label={`Fan-Out (${accounts.length})`}
              sub="All parallel"
              icon={
                <Layers
                  className="h-3.5 w-3.5 text-[#8dd99b]"
                  aria-hidden="true"
                />
              }
              onClick={() => setTarget("fanout_all")}
            />
            {accounts.map((acc) => (
              <TargetTile
                key={acc.id}
                active={target === acc.id}
                label={acc.roleLabel}
                sub={
                  acc.status === "online"
                    ? `${acc.quotaUsedPct}% quota`
                    : acc.status
                }
                icon={
                  <ProviderGlyph
                    provider={acc.provider}
                    slotIndex={acc.slotIndex}
                    presetId={acc.presetId}
                    size={14}
                  />
                }
                onClick={() => setTarget(acc.id)}
              />
            ))}
          </div>
        </div>

        {(target === "arw" || target === "fanout_all") &&
        availableTags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] text-[#8d97aa]">
              Pool Tag Filter:
            </span>
            <button
              type="button"
              aria-pressed={poolTag === ""}
              onClick={() => setPoolTag("")}
              className={clsx(
                "min-h-6 rounded border px-2 py-0.5 font-mono text-[10px]",
                poolTag === ""
                  ? "border-[#56b868] bg-[#162219] text-[#9ce2a9]"
                  : "border-[#252b37] bg-[#14171d] text-[#96a0b3] hover:text-white",
              )}
            >
              all
            </button>
            {availableTags.map((tag) => (
              <button
                key={tag}
                type="button"
                aria-pressed={poolTag === tag}
                onClick={() => setPoolTag(tag)}
                className={clsx(
                  "min-h-6 rounded border px-2 py-0.5 font-mono text-[10px]",
                  poolTag === tag
                    ? "border-[#56b868] bg-[#162219] text-[#9ce2a9]"
                    : "border-[#252b37] bg-[#14171d] text-[#96a0b3] hover:text-white",
                )}
              >
                #{tag}
              </button>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
          <label className="block">
            <span className="font-mono text-[10px] text-[#96a0b3]">
              Job Title
            </span>
            <input
              type="text"
              value={title}
              aria-invalid={Boolean(error && !title.trim())}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Audit Checkout Retry Idempotency"
              className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#101318] px-3 py-1.5 text-[12px] text-white placeholder:text-[#7f899c] focus:border-[#56b868]"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] text-[#96a0b3]">
              Repo / Workspace
            </span>
            <input
              type="text"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#101318] px-3 py-1.5 font-mono text-[11.5px] text-white focus:border-[#56b868]"
            />
          </label>
        </div>

        <label className="block">
          <span className="font-mono text-[10px] text-[#96a0b3]">
            Prompt / Agent Brief
          </span>
          <textarea
            rows={5}
            value={prompt}
            aria-invalid={Boolean(error && !prompt.trim())}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Write the prompt to stream across your connected AI connectors..."
            className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#101318] p-3 font-mono text-[11.5px] leading-relaxed text-[#e6eaf0] placeholder:text-[#7f899c] focus:border-[#56b868]"
          />
        </label>

        {error ? (
          <div
            id={errorId}
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#6b3132] bg-[#211315] px-3 py-2 text-[11.5px] text-[#f29e9c]"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenAccounts(accounts[0]?.id ?? null);
              }}
              className="min-h-6 rounded border border-[#448050] bg-[#18291d] px-2 py-0.5 text-[10.5px] font-medium text-[#9ce2a9]"
            >
              Open Accounts
            </button>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-[#1f242e] pt-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-8 rounded-md border border-[#282e3b] bg-[#181c24] px-3 py-1.5 text-[11.5px] text-[#b8c2d4] hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#448050] bg-[#1d3623] px-4 py-1.5 text-[11.5px] font-semibold text-[#e6f9ea] transition-colors hover:bg-[#25452c] disabled:opacity-50"
          >
            <Play className="h-3 w-3 fill-current" aria-hidden="true" />
            {busy ? "Dispatching..." : "Dispatch & Stream"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function TargetTile({
  active,
  label,
  sub,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  sub: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        "flex flex-col items-start rounded-md border p-2 text-left transition-colors",
        active
          ? "border-[#56b868] bg-[#162219]"
          : "border-[#252b37] bg-[#12151c] hover:border-[#394254]",
      )}
    >
      <div className="flex w-full items-center gap-1.5 text-[11px] font-semibold text-[#eef2f8]">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <span className="mt-0.5 max-w-full truncate font-mono text-[9.5px] text-[#8d97aa]">
        {sub}
      </span>
    </button>
  );
}
