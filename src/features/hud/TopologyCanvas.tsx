"use client";

import clsx from "clsx";
import {
  ChevronDown,
  ChevronRight,
  Cpu,
  Laptop,
  Maximize2,
  Plug,
  Plus,
  Search,
  Server,
  Sparkles,
  Terminal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LedCapacityBar } from "@/components/LedCapacityBar";
import { MiniMeter } from "@/components/MiniMeter";
import { ProviderGlyph } from "@/components/ProviderGlyph";
import { AccountStatusPill, JobStatusIndicator } from "@/components/StatusDot";
import { ToggleSwitch } from "@/components/ToggleSwitch";
import { formatDurationMs, formatTokenCount } from "@/domain/models";
import type {
  AccountId,
  AccountPublicState,
  ChatGroup,
  HudJob,
  HudSnapshot,
  LocalProcessInfo,
  ProtocolBadge,
  ProviderKind,
  RoutingPolicy,
} from "@/domain/types";

const POLICY_LABELS: Record<RoutingPolicy, string> = {
  auto_balance: "auto-bal",
  priority_order: "priority",
  google_first: "google-1st",
  claude_first: "claude-1st",
  lowest_latency: "fast-ms",
};

interface WireEdge {
  id: string;
  jobId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  badge: ProtocolBadge;
  selected: boolean;
  failed: boolean;
}

interface BusAnchor {
  accountId: AccountId;
  provider: ProviderKind;
  x: number;
  y: number;
  online: boolean;
  autoFailover: boolean;
}

interface TopologyCanvasProps {
  snapshot: HudSnapshot;
  selectedJobId: string | null;
  selectedAccountId: AccountId | null;
  pendingToggleKey: string | null;
  onSelectJob: (jobId: string) => void;
  onSelectAccount: (accountId: AccountId) => void;
  onToggleAccountFlag: (
    accountId: AccountId,
    field: "takesWork" | "autoFailover",
    value: boolean,
  ) => void;
  onOpenConnectAccount: (accountId: AccountId) => void;
  onOpenAddAccount: () => void;
  onOpenDispatch: (target?: AccountId | "arw" | "fanout_all") => void;
}

export function TopologyCanvas({
  snapshot,
  selectedJobId,
  selectedAccountId,
  pendingToggleKey,
  onSelectJob,
  onSelectAccount,
  onToggleAccountFlag,
  onOpenConnectAccount,
  onOpenAddAccount,
  onOpenDispatch,
}: TopologyCanvasProps) {
  const [zoom, setZoom] = useState(1);
  const [providerFilter, setProviderFilter] = useState<"all" | ProviderKind>(
    "all",
  );
  const userAdjustedZoomRef = useRef(false);
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const anchorRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [wires, setWires] = useState<WireEdge[]>([]);
  const [busAnchors, setBusAnchors] = useState<BusAnchor[]>([]);
  const [stageBounds, setStageBounds] = useState({ width: 960, height: 760 });

  const computeFitZoom = useCallback((): number => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return 0.78;
    if (typeof window !== "undefined" && window.innerWidth < 1024) return 1;
    const width = scroller.clientWidth;
    const fitted = (width - 28) / 940;
    return Number(Math.min(0.86, Math.max(0.62, fitted)).toFixed(2));
  }, []);

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;
    const applyAutoZoom = (): void => {
      if (userAdjustedZoomRef.current) return;
      setZoom(computeFitZoom());
    };
    applyAutoZoom();
    const ro = new ResizeObserver(applyAutoZoom);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [computeFitZoom]);

  const registerAnchor = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) {
        anchorRefs.current.set(key, el);
      } else {
        anchorRefs.current.delete(key);
      }
    },
    [],
  );

  const toggleCollapse = useCallback((nodeKey: string) => {
    setCollapsedNodes((prev) => ({ ...prev, [nodeKey]: !prev[nodeKey] }));
  }, []);

  const jobsById = useMemo(() => {
    const map = new Map<string, HudJob>();
    for (const j of snapshot.jobs) map.set(j.id, j);
    return map;
  }, [snapshot.jobs]);

  const accountsById = useMemo(() => {
    const map = new Map<AccountId, AccountPublicState>();
    for (const acc of snapshot.accounts) map.set(acc.id, acc);
    return map;
  }, [snapshot.accounts]);

  const visibleAccounts = useMemo(
    () =>
      providerFilter === "all"
        ? snapshot.accounts
        : snapshot.accounts.filter((a) => a.provider === providerFilter),
    [snapshot.accounts, providerFilter],
  );

  const dispatchHubChats = useMemo(
    () => snapshot.chats.filter((c) => c.originNodeId === "dispatch-hub"),
    [snapshot.chats],
  );
  const localMacChats = useMemo(
    () => snapshot.chats.filter((c) => c.originNodeId === "local-mac"),
    [snapshot.chats],
  );

  const latestDataRef = useRef({
    accounts: visibleAccounts,
    jobs: snapshot.jobs,
    selectedJobId,
    selectedAccountId,
    zoom,
  });
  latestDataRef.current = {
    accounts: visibleAccounts,
    jobs: snapshot.jobs,
    selectedJobId,
    selectedAccountId,
    zoom,
  };

  // Structural signature avoids DOM getBoundingClientRect() thrashing on 5s telemetry-only polls.
  const layoutSignature = useMemo(() => {
    const accSig = visibleAccounts
      .map((a) => `${a.id}:${a.status}:${a.authMode}:${a.autoFailover ? 1 : 0}`)
      .join(",");
    const jobSig = snapshot.jobs
      .map(
        (j) =>
          `${j.id}:${j.chatSessionId}:${j.targetAccountId}:${j.status}:${j.protocolBadge}:${j.subTasks.length}`,
      )
      .join(",");
    const collapsedSig = Object.entries(collapsedNodes)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .sort()
      .join(",");
    return `${providerFilter}|${accSig}|${jobSig}|${selectedJobId ?? ""}|${selectedAccountId ?? ""}|${zoom}|${collapsedSig}`;
  }, [
    providerFilter,
    visibleAccounts,
    snapshot.jobs,
    selectedJobId,
    selectedAccountId,
    zoom,
    collapsedNodes,
  ]);

  const recomputeGeometry = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const {
      accounts,
      jobs,
      selectedJobId: activeJobId,
      selectedAccountId: activeAccountId,
      zoom: currentZoom,
    } = latestDataRef.current;
    const stageRect = stage.getBoundingClientRect();
    const scale = currentZoom || 1;

    setStageBounds({
      width: Math.max(820, stage.scrollWidth),
      height: Math.max(640, stage.scrollHeight),
    });

    const getBox = (key: string) => {
      const el = anchorRefs.current.get(key);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        left: (rect.left - stageRect.left) / scale,
        right: (rect.right - stageRect.left) / scale,
        top: (rect.top - stageRect.top) / scale,
        bottom: (rect.bottom - stageRect.top) / scale,
        midY: (rect.top + rect.height / 2 - stageRect.top) / scale,
      };
    };

    const nextWires: WireEdge[] = [];
    for (const job of jobs) {
      const targetBox =
        getBox(`job:${job.id}`) ?? getBox(`account:${job.targetAccountId}`);
      if (!targetBox) continue;

      const sourceBox =
        getBox(`chat:${job.chatSessionId}`) ??
        getBox(`origin:${job.originNodeId}`);
      if (!sourceBox) continue;

      nextWires.push({
        id: `${job.chatSessionId}->${job.id}`,
        jobId: job.id,
        x1: sourceBox.right,
        y1: sourceBox.midY,
        x2: targetBox.left,
        y2: targetBox.midY,
        badge: job.protocolBadge,
        selected: job.id === activeJobId,
        failed: job.status === "failed",
      });
    }

    if (nextWires.length === 0) {
      const masterBox =
        getBox("origin:local-mac") ?? getBox("origin:dispatch-hub");
      if (masterBox) {
        for (const acc of accounts) {
          const accBox = getBox(`account:${acc.id}`);
          if (!accBox) continue;
          nextWires.push({
            id: `backbone->${acc.id}`,
            jobId: "",
            x1: masterBox.right,
            y1: masterBox.midY,
            x2: accBox.left,
            y2: accBox.midY,
          badge:
            acc.authMode === "oauth"
              ? acc.provider === "google"
                ? "OAuth"
                : "SSO"
              : acc.authMode === "cli"
                ? "CLI"
                : "API",
          selected: acc.id === activeAccountId,
          failed: acc.status === "error",
        });
      }
    }
  }

  const nextBus: BusAnchor[] = [];
  for (const acc of accounts) {
    const accBox = getBox(`account:${acc.id}`);
    if (!accBox) continue;
    nextBus.push({
      accountId: acc.id,
      provider: acc.provider,
      x: accBox.right,
      y: accBox.midY,
      online: acc.status === "online",
      autoFailover: acc.autoFailover,
    });
  }

    setWires(nextWires);
    setBusAnchors(nextBus);
  }, []);

  useLayoutEffect(() => {
    recomputeGeometry();
  }, [recomputeGeometry, layoutSignature]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => {
      recomputeGeometry();
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
    };
  }, [recomputeGeometry]);

  const totalAccounts = snapshot.accounts.length;
  const onlineCount = snapshot.accounts.filter(
    (a) => a.status === "online",
  ).length;
  const connectedCount = snapshot.accounts.filter((a) => a.hasCredentials).length;
  const disconnectedAccounts = snapshot.accounts.filter((a) => !a.hasCredentials);
  const providerCounts = useMemo(() => {
    const counts: Record<ProviderKind, number> = {
      google: 0,
      anthropic: 0,
      openai_compatible: 0,
    };
    for (const acc of snapshot.accounts) {
      counts[acc.provider] += 1;
    }
    return counts;
  }, [snapshot.accounts]);
  const poolSummaryText = useMemo(() => {
    const parts: string[] = [];
    if (providerCounts.google > 0) parts.push(`${providerCounts.google} Google`);
    if (providerCounts.anthropic > 0)
      parts.push(`${providerCounts.anthropic} Claude`);
    if (providerCounts.openai_compatible > 0)
      parts.push(`${providerCounts.openai_compatible} OpenAI/Compat`);
    return parts.length > 0 ? parts.join(" + ") : "No connectors";
  }, [providerCounts]);
  const hostMemPct = Math.round(
    (snapshot.host.memoryUsedGb / Math.max(1, snapshot.host.memoryTotalGb)) *
      100,
  );
  const avgPoolQuota = Math.round(
    snapshot.accounts.reduce((acc, a) => acc + a.quotaUsedPct, 0) /
      Math.max(1, snapshot.accounts.length),
  );
  const referenceNowMs = new Date(snapshot.updatedAt).getTime();

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[#101115]">
      {disconnectedAccounts.length > 0 ? (
        <div className="z-20 flex flex-wrap items-center justify-between gap-2 border-b border-[#252c38] bg-[#141820]/95 px-4 py-2 text-[11.5px]">
          <div className="flex items-center gap-2 text-[#c0cadb]">
            <Plug
              className="h-3.5 w-3.5 shrink-0 text-[#85bef2]"
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <span>
              <strong className="font-medium text-white">
                {connectedCount} of {totalAccounts} accounts connected:
              </strong>{" "}
              Link your accounts or add any Google, Claude, OpenAI, OpenRouter,
              Ollama, or SSO gateway connector.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {disconnectedAccounts.slice(0, 4).map((acc) => (
              <button
                key={acc.id}
                type="button"
                onClick={() => onOpenConnectAccount(acc.id)}
                className="min-h-7 rounded-md border border-[#3a6b44] bg-[#192b1e] px-2.5 py-1 font-mono text-[10.5px] font-medium text-[#9ce2a9] transition-colors hover:bg-[#223928]"
              >
                + Connect {acc.roleLabel}
              </button>
            ))}
            <button
              type="button"
              onClick={onOpenAddAccount}
              className="min-h-7 rounded-md border border-[#2c3445] bg-[#191f2a] px-2.5 py-1 font-mono text-[10.5px] font-medium text-[#cfd6e2] transition-colors hover:border-[#4b8a57] hover:text-white"
            >
              + Add Connector
            </button>
          </div>
        </div>
      ) : null}

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto p-3 lg:p-4"
      >
        <div
          ref={stageRef}
          className="relative mx-auto origin-top-left"
          style={{
            transform: `scale(${zoom})`,
            width: zoom < 1 ? `${Math.round(100 / zoom)}%` : "100%",
          }}
        >
          {/* Dynamic SVG Bezier wire layer + right-edge orthogonal cluster bus */}
          <svg
            width={stageBounds.width}
            height={stageBounds.height}
            className="pointer-events-none absolute inset-0 hidden lg:block"
            aria-hidden="true"
          >
            {wires
              .filter((w) => !w.selected)
              .map((wire) => {
                const dx = Math.max(54, Math.abs(wire.x2 - wire.x1) * 0.48);
                const d = `M ${wire.x1} ${wire.y1} C ${wire.x1 + dx} ${wire.y1}, ${wire.x2 - dx} ${wire.y2}, ${wire.x2} ${wire.y2}`;
                return (
                  <g key={wire.id}>
                    <path
                      d={d}
                      fill="none"
                      stroke={wire.failed ? "#6b3132" : "#2f3644"}
                      strokeWidth={1.2}
                      strokeOpacity={0.85}
                    />
                  </g>
                );
              })}

            {wires.slice(0, 5).map((wire, idx) => {
              const mx = (wire.x1 + wire.x2) / 2;
              const my = (wire.y1 + wire.y2) / 2 + (idx % 2 === 0 ? -4 : 6);
              if (wire.selected) return null;
              return (
                <g key={`pill-${wire.id}`} transform={`translate(${mx}, ${my})`}>
                  <rect
                    x={-18}
                    y={-8}
                    width={36}
                    height={16}
                    rx={8}
                    fill="#141820"
                    stroke="#323948"
                    strokeWidth={1}
                  />
                  <text
                    x={0}
                    y={3}
                    textAnchor="middle"
                    fill="#96a0b3"
                    fontSize={8}
                    fontFamily="var(--font-geist-mono), monospace"
                  >
                    {wire.badge}
                  </text>
                </g>
              );
            })}

            {wires
              .filter((w) => w.selected)
              .map((wire) => {
                const dx = Math.max(56, Math.abs(wire.x2 - wire.x1) * 0.48);
                const d = `M ${wire.x1} ${wire.y1} C ${wire.x1 + dx} ${wire.y1}, ${wire.x2 - dx} ${wire.y2}, ${wire.x2} ${wire.y2}`;
                const mx = (wire.x1 + wire.x2) / 2;
                const my = (wire.y1 + wire.y2) / 2;
                return (
                  <g key={`sel-${wire.id}`}>
                    <path
                      d={d}
                      fill="none"
                      stroke="#c48a47"
                      strokeWidth={1.8}
                      strokeDasharray="5 4"
                      className="wire-selected-animated"
                    />
                    <circle cx={wire.x1} cy={wire.y1} r={3} fill="#c48a47" />
                    <circle cx={wire.x2} cy={wire.y2} r={3.2} fill="#56b868" />
                    <g transform={`translate(${mx}, ${my})`}>
                      <rect
                        x={-21}
                        y={-9}
                        width={42}
                        height={18}
                        rx={9}
                        fill="#22190f"
                        stroke="#c48a47"
                        strokeWidth={1}
                      />
                      <text
                        x={0}
                        y={3}
                        textAnchor="middle"
                        fill="#e5b06e"
                        fontSize={8.5}
                        fontWeight={600}
                        fontFamily="var(--font-geist-mono), monospace"
                      >
                        {wire.badge}
                      </text>
                    </g>
                  </g>
                );
              })}

            {/* Scalable N-account right-edge Failover Trunk Spine + dynamic provider sub-rails */}
            {busAnchors.length >= 2
              ? (() => {
                  const baseX = Math.max(...busAnchors.map((b) => b.x));
                  const subRailX = baseX + 14;
                  const trunkX = baseX + 34;
                  const failoverNodes = busAnchors.filter((b) => b.autoFailover);
                  const trunkNodes =
                    failoverNodes.length >= 2 ? failoverNodes : busAnchors;
                  const minY = Math.min(...trunkNodes.map((b) => b.y));
                  const maxY = Math.max(...trunkNodes.map((b) => b.y));
                  const midY = (minY + maxY) / 2;
                  const poolActive =
                    trunkNodes.filter((b) => b.online).length >= 2;

                  // Group by provider for same-provider inner failover sub-rails
                  const byProvider = new Map<ProviderKind, BusAnchor[]>();
                  for (const anchor of busAnchors) {
                    const list = byProvider.get(anchor.provider) ?? [];
                    list.push(anchor);
                    byProvider.set(anchor.provider, list);
                  }
                  const providerRails = Array.from(byProvider.entries()).filter(
                    ([, list]) => list.length >= 2,
                  );

                  const nodeDot = (active: boolean) =>
                    active ? "#56b868" : "#444d5e";

                  return (
                    <g>
                      {/* Inner provider sub-rails for multi-account same-provider groups */}
                      {providerRails.map(([prov, group]) => {
                        const gMinY = Math.min(...group.map((a) => a.y)) - 5;
                        const gMaxY = Math.max(...group.map((a) => a.y)) - 5;
                        const gActive =
                          group.filter((a) => a.online).length >= 2;
                        const stroke = gActive ? "#4e9c5d" : "#2d3442";
                        return (
                          <g key={`subrail-${prov}`}>
                            <line
                              x1={subRailX}
                              y1={gMinY}
                              x2={subRailX}
                              y2={gMaxY}
                              stroke={stroke}
                              strokeWidth={1.3}
                            />
                            {group.map((a) => (
                              <g key={`subtap-${a.accountId}`}>
                                <line
                                  x1={a.x}
                                  y1={a.y - 5}
                                  x2={subRailX}
                                  y2={a.y - 5}
                                  stroke={stroke}
                                  strokeWidth={1.3}
                                />
                                <circle
                                  cx={a.x}
                                  cy={a.y - 5}
                                  r={2.4}
                                  fill={nodeDot(a.online)}
                                />
                              </g>
                            ))}
                          </g>
                        );
                      })}

                      {/* Outer shared Failover Trunk Spine for all N accounts */}
                      <line
                        x1={trunkX}
                        y1={minY + 5}
                        x2={trunkX}
                        y2={maxY + 5}
                        stroke={poolActive ? "#4e9c5d" : "#282e3b"}
                        strokeWidth={1.4}
                      />
                      {trunkNodes.map((a) => (
                        <g key={`trunk-${a.accountId}`}>
                          <line
                            x1={a.x}
                            y1={a.y + 5}
                            x2={trunkX}
                            y2={a.y + 5}
                            stroke={
                              a.online && poolActive ? "#4e9c5d" : "#2b3240"
                            }
                            strokeWidth={1.25}
                          />
                          <circle
                            cx={a.x}
                            cy={a.y + 5}
                            r={2.4}
                            fill={nodeDot(a.online)}
                          />
                        </g>
                      ))}

                      <g transform={`translate(${trunkX}, ${midY}) rotate(90)`}>
                        <rect
                          x={-58}
                          y={-7.5}
                          width={116}
                          height={15}
                          rx={3}
                          fill={poolActive ? "#101a13" : "#14171d"}
                          stroke={poolActive ? "#35663e" : "#2a3140"}
                          strokeWidth={0.9}
                        />
                        <text
                          x={0}
                          y={3}
                          textAnchor="middle"
                          fill={poolActive ? "#7fd18e" : "#848ea0"}
                          fontSize={7.5}
                          fontFamily="var(--font-geist-mono), monospace"
                        >
                          {`FAILOVER BUS · ${onlineCount}/${totalAccounts}`}
                        </text>
                      </g>
                    </g>
                  );
                })()
              : null}
          </svg>

          {/* Two-column topology layout */}
          <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-center lg:gap-[116px] lg:pr-[68px]">
            {/* LEFT COLUMN: Dispatch Hub + Local Mac Master Node */}
            <div className="flex w-full flex-col gap-4 lg:w-[346px] lg:shrink-0">
              <article>
                <div
                  ref={registerAnchor("origin:dispatch-hub")}
                  className="rounded-[9px] border border-[#242a35] bg-[#14171c] p-3 shadow-[0_2px_12px_rgba(0,0,0,0.28)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Laptop
                        className="h-3.5 w-3.5 shrink-0 text-[#60a5fa]"
                        strokeWidth={1.7}
                        aria-hidden="true"
                      />
                      <span className="truncate text-[12.5px] font-semibold text-[#eef2f8]">
                        Dispatch Router Hub
                      </span>
                      <span className="rounded border border-[#2a3140] bg-[#1a1f29] px-1.5 py-[1px] font-mono text-[8.5px] text-[#9ea8ba]">
                        ROUTER
                      </span>
                      <span className="rounded border border-[#5f4324] bg-[#241b11] px-1.5 py-[1px] font-mono text-[8.5px] text-[#e5af6d]">
                        ARW{" "}
                        {dispatchHubChats.filter((c) => c.groupKind === "arw").length}
                      </span>
                    </div>
                    <AccountStatusPill
                      status={onlineCount > 0 ? "online" : "disconnected"}
                    />
                  </div>

                  <div className="mt-2.5 flex items-center gap-3">
                    <MiniMeter
                      label="POLICY"
                      valueText={POLICY_LABELS[snapshot.routingPolicy]}
                      percent={onlineCount > 0 ? 64 : 0}
                      tone={onlineCount > 0 ? "green" : "default"}
                    />
                    <MiniMeter
                      label="POOL"
                      valueText={`${onlineCount}/${totalAccounts} live`}
                      percent={
                        totalAccounts > 0
                          ? (onlineCount / totalAccounts) * 100
                          : 0
                      }
                      tone={onlineCount > 0 ? "green" : "default"}
                    />
                    <MiniMeter
                      label="ACTIVE"
                      valueText={`${snapshot.jobs.filter((j) => j.status === "working").length} live`}
                      percent={Math.min(
                        100,
                        snapshot.jobs.filter((j) => j.status === "working")
                          .length * 22,
                      )}
                    />
                  </div>

                  <div className="mt-2.5 flex items-center justify-between text-[10.5px] text-[#8f99ad]">
                    <span className="inline-flex items-center gap-1.5">
                      <Sparkles
                        className="h-3 w-3 text-[#d99d55]"
                        strokeWidth={1.6}
                        aria-hidden="true"
                      />
                      Auto-Failover Pool: {poolSummaryText}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenDispatch("arw")}
                      className="min-h-6 rounded px-1.5 font-mono text-[10px] text-[#8dd99b] hover:bg-[#1a291e] hover:underline"
                    >
                      + Dispatch
                    </button>
                  </div>

                  <LedCapacityBar
                    quotaPct={avgPoolQuota}
                    online={onlineCount > 0}
                    warningText={
                      onlineCount > 0
                        ? `Pool avg ${avgPoolQuota}%`
                        : "Connect accounts to route"
                    }
                  />

                  <div className="mt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => toggleCollapse("dispatch-hub")}
                      aria-expanded={!collapsedNodes["dispatch-hub"]}
                      aria-label="Toggle Dispatch Hub sessions"
                      className="inline-flex min-h-6 min-w-6 items-center justify-center rounded text-[#848ea0] hover:bg-[#1e232d] hover:text-white"
                    >
                      {collapsedNodes["dispatch-hub"] ? (
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                {!collapsedNodes["dispatch-hub"] ? (
                  <LeftChatStack
                    chats={dispatchHubChats}
                    jobsById={jobsById}
                    accountsById={accountsById}
                    selectedJobId={selectedJobId}
                    registerAnchor={registerAnchor}
                    onSelectJob={onSelectJob}
                  />
                ) : null}
              </article>

              {/* Node 2: Local Host Mac Master Node */}
              <article>
                <div
                  ref={registerAnchor("origin:local-mac")}
                  className="rounded-[9px] border border-[#242a35] bg-[#14171c] p-3 shadow-[0_2px_12px_rgba(0,0,0,0.28)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Server
                        className="h-3.5 w-3.5 shrink-0 text-[#60a5fa]"
                        strokeWidth={1.7}
                        aria-hidden="true"
                      />
                      <span
                        className="truncate text-[12.5px] font-semibold text-[#eef2f8]"
                        title={`${snapshot.host.hostname} · ${snapshot.host.chipModel}`}
                      >
                        {snapshot.host.hostname}
                      </span>
                      <span className="rounded border border-[#5f4324] bg-[#241b11] px-1.5 py-[1px] font-mono text-[8.5px] text-[#e5af6d]">
                        MASTER
                      </span>
                      <span className="rounded border border-[#5f4324] bg-[#241b11] px-1.5 py-[1px] font-mono text-[8.5px] text-[#e5af6d]">
                        ARW{" "}
                        {localMacChats.filter((c) => c.groupKind === "arw").length}
                      </span>
                    </div>
                    <AccountStatusPill status="online" />
                  </div>

                  <div className="mt-2.5 flex items-center gap-3">
                    <MiniMeter
                      label="CPU"
                      valueText={`${snapshot.host.cpuUsagePct}%`}
                      percent={snapshot.host.cpuUsagePct}
                    />
                    <MiniMeter
                      label="GPU"
                      valueText={`${snapshot.host.gpuEstimatePct}%`}
                      percent={snapshot.host.gpuEstimatePct}
                    />
                    <MiniMeter
                      label="MEM"
                      valueText={`${snapshot.host.memoryUsedGb}/${snapshot.host.memoryTotalGb} GB`}
                      percent={hostMemPct}
                    />
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2 text-[10.5px] text-[#929caf]">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5 truncate">
                        <Cpu
                          className="h-3 w-3 shrink-0 text-[#848ea0]"
                          aria-hidden="true"
                        />
                        <span className="truncate font-mono text-[10px]">
                          {snapshot.host.chipModel}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[10px] text-[#848ea0]">
                        <span>
                          CLI: claude {snapshot.host.cliTools.claude ? "✓" : "–"}{" "}
                          · gemini {snapshot.host.cliTools.gemini ? "✓" : "–"}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[10px] text-[#96a0b3] tabular-nums">
                      Load {snapshot.host.loadAvg[0].toFixed(2)}
                    </div>
                  </div>

                  <LedCapacityBar
                    quotaPct={hostMemPct}
                    online={true}
                    warningText={`${snapshot.host.memoryUsedGb} / ${snapshot.host.memoryTotalGb} GB`}
                  />

                  <div className="mt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => toggleCollapse("local-mac")}
                      aria-expanded={!collapsedNodes["local-mac"]}
                      aria-label="Toggle local Mac sessions"
                      className="inline-flex min-h-6 min-w-6 items-center justify-center rounded text-[#848ea0] hover:bg-[#1e232d] hover:text-white"
                    >
                      {collapsedNodes["local-mac"] ? (
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                {!collapsedNodes["local-mac"] ? (
                  <LeftChatStack
                    chats={localMacChats}
                    localProcesses={snapshot.host.localProcesses}
                    jobsById={jobsById}
                    accountsById={accountsById}
                    selectedJobId={selectedJobId}
                    registerAnchor={registerAnchor}
                    onSelectJob={onSelectJob}
                  />
                ) : null}
              </article>
            </div>

            {/* RIGHT COLUMN: Dynamic Account Pool (unlimited connectors) + Routed Jobs */}
            <div className="flex w-full flex-col gap-4 lg:w-[394px] lg:shrink-0">
              <div className="-mb-2 flex flex-wrap items-center justify-between gap-2 px-1 font-mono text-[9.5px] tracking-[0.08em] text-[#e5af6d]">
                <span>
                  ACCOUNT POOL · {poolSummaryText.toUpperCase()}
                </span>
                <button
                  type="button"
                  onClick={onOpenAddAccount}
                  className="inline-flex min-h-6 items-center gap-1 rounded border border-[#2f5737] bg-[#142318] px-2 py-0.5 font-mono text-[9.5px] tracking-normal text-[#9ce2a9] hover:border-[#4b8a57] hover:text-white"
                >
                  <Plus className="h-2.5 w-2.5" aria-hidden="true" />
                  Add Account
                </button>
              </div>

              {totalAccounts > 3 ? (
                <div className="-mb-1.5 flex flex-wrap items-center gap-1 px-1">
                  {(
                    [
                      { id: "all", label: `All (${totalAccounts})` },
                      ...(providerCounts.google > 0
                        ? [{ id: "google" as const, label: `Google (${providerCounts.google})` }]
                        : []),
                      ...(providerCounts.anthropic > 0
                        ? [{ id: "anthropic" as const, label: `Claude (${providerCounts.anthropic})` }]
                        : []),
                      ...(providerCounts.openai_compatible > 0
                        ? [
                            {
                              id: "openai_compatible" as const,
                              label: `OpenAI/Compat (${providerCounts.openai_compatible})`,
                            },
                          ]
                        : []),
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      aria-pressed={providerFilter === tab.id}
                      onClick={() => setProviderFilter(tab.id)}
                      className={clsx(
                        "min-h-6 rounded border px-2 py-0.5 font-mono text-[9.5px] transition-colors",
                        providerFilter === tab.id
                          ? "border-[#56b868] bg-[#162219] text-[#9ce2a9]"
                          : "border-[#252b37] bg-[#14171c] text-[#96a0b3] hover:text-white",
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {visibleAccounts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#2b3241] bg-[#13161c] p-6 text-center text-[12px] text-[#8d97aa]">
                  <p>No connectors configured yet.</p>
                  <button
                    type="button"
                    onClick={onOpenAddAccount}
                    className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#448050] bg-[#1d3623] px-3 py-1.5 font-mono text-[11px] font-semibold text-[#e6f9ea] hover:bg-[#25452c]"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add Your First Account
                  </button>
                </div>
              ) : null}

              {visibleAccounts.map((account) => {
                const accountJobs = snapshot.jobs.filter(
                  (j) => j.targetAccountId === account.id,
                );
                const isAccountSelected = selectedAccountId === account.id;
                const isCollapsed = Boolean(collapsedNodes[account.id]);

                return (
                  <div key={account.id} className="flex flex-col">
                    {/* Semantic article container (NO nested interactive role="button"!) */}
                    <article
                      ref={registerAnchor(`account:${account.id}`)}
                      className={clsx(
                        "rounded-[9px] border bg-[#14171c] p-3 text-left transition-colors",
                        isAccountSelected
                          ? "border-[#56b868] bg-[#161e1a]"
                          : account.status === "rate_limited"
                            ? "border-[#7d582c] hover:border-[#a27136]"
                            : account.status === "error"
                              ? "border-[#6b3132] hover:border-[#8f4143]"
                              : "border-[#252b37] hover:border-[#363f51]",
                      )}
                    >
                      {/* Accessible header button selects account inspector without wrapping sibling controls */}
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectAccount(account.id)}
                          aria-pressed={isAccountSelected}
                          className="flex min-h-6 min-w-0 flex-1 items-center gap-2 rounded text-left hover:text-white"
                        >
                          <ProviderGlyph
                            provider={account.provider}
                            slotIndex={account.slotIndex}
                            presetId={account.presetId}
                            size={16}
                          />
                          <span className="truncate text-[12.5px] font-semibold text-[#eef2f8]">
                            {account.name}
                          </span>
                          <span className="shrink-0 rounded border border-[#2b3241] bg-[#1a1f29] px-1.5 py-[1px] font-mono text-[8.5px] text-[#9ea8ba]">
                            WORKER
                          </span>
                          {accountJobs.length > 0 ? (
                            <span className="shrink-0 rounded border border-[#5f4324] bg-[#241b11] px-1.5 py-[1px] font-mono text-[8.5px] text-[#e5af6d]">
                              ARW {accountJobs.length}
                            </span>
                          ) : null}
                        </button>

                        <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] tabular-nums text-[#96a0b3]">
                          {account.latencyMs !== null ? (
                            <span>{account.latencyMs} ms</span>
                          ) : null}
                          <AccountStatusPill status={account.status} />
                        </div>
                      </div>

                      <div className="mt-2.5 flex items-center gap-3">
                        <MiniMeter
                          label="QUOTA"
                          valueText={`${account.quotaUsedPct}%`}
                          percent={account.quotaUsedPct}
                        />
                        <MiniMeter
                          label="RPM"
                          valueText={`${account.rpmCurrent}/${account.rpmLimit}`}
                          percent={
                            account.rpmLimit > 0
                              ? (account.rpmCurrent / account.rpmLimit) * 100
                              : 0
                          }
                        />
                        <MiniMeter
                          label="TOKENS"
                          valueText={`${formatTokenCount(account.tokensUsedToday)}/${formatTokenCount(account.tokensDailyBudget)}`}
                          percent={
                            account.tokensDailyBudget > 0
                              ? (account.tokensUsedToday /
                                  account.tokensDailyBudget) *
                                100
                              : 0
                          }
                        />
                      </div>

                      <div className="mt-2.5 flex items-center justify-between gap-3">
                        <div className="min-w-0 space-y-1 text-[10.5px] text-[#929caf]">
                          <div className="truncate font-mono text-[10px] text-[#c0cadb]">
                            {account.defaultModel}
                            {account.email ? ` · ${account.email}` : ""}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 rounded border border-[#262c38] bg-[#191d25] px-1.5 py-[1px] font-mono text-[9px] text-[#9aa4b6]">
                              {account.authMode === "oauth"
                                ? account.provider === "google"
                                  ? "OAuth 2.0"
                                  : "OIDC SSO"
                                : account.authMode === "cli"
                                  ? "Local CLI"
                                  : account.authMode === "none"
                                    ? "No Auth"
                                    : "API Key"}
                            </span>
                            <span className="truncate font-mono text-[9.5px] text-[#848ea0]">
                              {account.maskedCredential ?? "Not configured"}
                            </span>
                          </div>
                          {account.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {account.tags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded bg-[#1a1f29] px-1 py-[0.5px] font-mono text-[8.5px] text-[#8d97aa]"
                                >
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <ToggleSwitch
                            label="Takes Work"
                            checked={account.takesWork}
                            disabled={
                              pendingToggleKey === `${account.id}:takesWork`
                            }
                            onChange={(next) =>
                              onToggleAccountFlag(account.id, "takesWork", next)
                            }
                          />
                          <ToggleSwitch
                            label="Auto Failover"
                            checked={account.autoFailover}
                            disabled={
                              pendingToggleKey === `${account.id}:autoFailover`
                            }
                            onChange={(next) =>
                              onToggleAccountFlag(
                                account.id,
                                "autoFailover",
                                next,
                              )
                            }
                          />
                        </div>
                      </div>

                      <LedCapacityBar
                        quotaPct={account.quotaUsedPct}
                        online={account.status === "online"}
                        warningText={
                          account.status === "disconnected"
                            ? "Click Connect to link account"
                            : account.lastError
                              ? account.lastError
                              : account.quotaUsedPct >= 85
                                ? `Quota ${account.quotaUsedPct}% of 90%`
                                : `Headroom ${100 - account.quotaUsedPct}%`
                        }
                      />

                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenConnectAccount(account.id)}
                            className={clsx(
                              "min-h-6 rounded border px-2 py-0.5 font-mono text-[9.5px] transition-colors",
                              account.hasCredentials
                                ? "border-[#2a3140] bg-[#191d26] text-[#aeb8ca] hover:border-[#3c4559] hover:text-white"
                                : "border-[#3c6f46] bg-[#17281c] text-[#9ce2a9] hover:bg-[#1f3626]",
                            )}
                          >
                            {account.hasCredentials
                              ? "Configure"
                              : "Connect Account"}
                          </button>
                          {account.hasCredentials ? (
                            <button
                              type="button"
                              onClick={() => onOpenDispatch(account.id)}
                              className="min-h-6 rounded border border-[#262c38] bg-[#181c24] px-2 py-0.5 font-mono text-[9.5px] text-[#aeb8ca] transition-colors hover:border-[#3c4559] hover:text-white"
                            >
                              + Run Job
                            </button>
                          ) : null}
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleCollapse(account.id)}
                          aria-expanded={!isCollapsed}
                          aria-label={`Toggle jobs for ${account.name}`}
                          className="inline-flex min-h-6 min-w-6 items-center justify-center rounded text-[#848ea0] hover:bg-[#1e232d] hover:text-white"
                        >
                          {isCollapsed ? (
                            <ChevronRight
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          ) : (
                            <ChevronDown
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      </div>
                    </article>

                    {!isCollapsed && accountJobs.length > 0 ? (
                      <div className="mt-2.5 space-y-2.5 pl-1">
                        <div className="flex items-center justify-end font-mono text-[9.5px] text-[#e5af6d]">
                          <span>▸ ARW {accountJobs.length}</span>
                        </div>
                        {accountJobs.map((job) => (
                          <RightJobCard
                            key={job.id}
                            job={job}
                            account={account}
                            referenceNowMs={referenceNowMs}
                            selected={job.id === selectedJobId}
                            anchorRef={registerAnchor(`job:${job.id}`)}
                            onSelect={() => onSelectJob(job.id)}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom-right floating Zoom & Fit pill */}
      <div className="pointer-events-auto absolute right-4 bottom-3 z-20 hidden items-center gap-1.5 rounded-full border border-[#282e3b] bg-[#151820]/95 px-2.5 py-1 shadow-[0_6px_24px_rgba(0,0,0,0.45)] backdrop-blur-md lg:flex">
        <button
          type="button"
          onClick={() => {
            userAdjustedZoomRef.current = false;
            setZoom(computeFitZoom());
          }}
          aria-label="Reset zoom"
          title="Fit view"
          className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full text-[#96a0b3] transition-colors hover:bg-[#222733] hover:text-white"
        >
          <Maximize2 className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            userAdjustedZoomRef.current = true;
            setZoom((z) => Math.max(0.55, Number((z - 0.08).toFixed(2))));
          }}
          aria-label="Zoom out"
          className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full text-[#96a0b3] transition-colors hover:bg-[#222733] hover:text-white"
        >
          <ZoomOut className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
        </button>
        <input
          type="range"
          min={55}
          max={125}
          step={5}
          value={Math.round(zoom * 100)}
          aria-label="Canvas zoom percentage"
          onChange={(e) => {
            userAdjustedZoomRef.current = true;
            setZoom(Number(e.target.value) / 100);
          }}
          className="h-1 w-20 cursor-pointer accent-[#cfd6e2]"
        />
        <button
          type="button"
          onClick={() => {
            userAdjustedZoomRef.current = true;
            setZoom((z) => Math.min(1.25, Number((z + 0.08).toFixed(2))));
          }}
          aria-label="Zoom in"
          className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full text-[#96a0b3] transition-colors hover:bg-[#222733] hover:text-white"
        >
          <ZoomIn className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
        </button>
        <span className="min-w-[34px] text-right font-mono text-[10px] tabular-nums text-[#b8c2d4]">
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  );
}

function LeftChatStack({
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

function RightJobCard({
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
