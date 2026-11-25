"use client";

import clsx from "clsx";
import {
  Activity,
  BarChart3,
  Bell,
  Clock,
  Cpu,
  Lock,
  MessageSquare,
  Play,
  Plug,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import type { HudSnapshot, SessionUserInfo } from "@/domain/types";

export type ToolbarModalId =
  | "accounts"
  | "sso"
  | "dispatch"
  | "limits"
  | "analytics"
  | "chats"
  | "health"
  | "alerts"
  | null;

interface TopToolbarProps {
  snapshot: HudSnapshot;
  isRefreshing: boolean;
  activeModal: ToolbarModalId;
  terminalOpen: boolean;
  isRemoteSession?: boolean;
  sessionUser?: SessionUserInfo | null;
  onRefresh: () => void;
  onOpenModal: (modal: ToolbarModalId) => void;
  onToggleTerminal: () => void;
  onLockSession?: () => void;
}

export function TopToolbar({
  snapshot,
  isRefreshing,
  activeModal,
  terminalOpen,
  isRemoteSession = false,
  sessionUser = null,
  onRefresh,
  onOpenModal,
  onToggleTerminal,
  onLockSession,
}: TopToolbarProps) {
  const onlineAccounts = snapshot.accounts.filter(
    (a) => a.status === "online",
  ).length;
  const totalAccounts = snapshot.accounts.length;
  const activeJobs = snapshot.jobs.filter((j) => j.status === "working").length;
  const arwJobs = snapshot.jobs.filter(
    (j) => j.dispatchMode === "arw" || j.dispatchMode === "fanout",
  ).length;
  const localProcCount = snapshot.host.activeLocalProcesses;
  const unreadAlerts = snapshot.alerts.filter((a) => !a.acknowledged).length;
  const ssoActive =
    snapshot.ssoConfig.googleAppLoginEnabled ||
    snapshot.ssoConfig.oidcAppLoginEnabled;

  return (
    <header className="flex shrink-0 flex-col gap-2 border-b border-[#1f242e] bg-[#13161c] px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
      <a
        href="#hud-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-[#192b1e] focus:px-3 focus:py-1.5 focus:text-xs focus:font-semibold focus:text-white"
      >
        Skip to topology workspace
      </a>

      {/* Left live telemetry summary strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
        <div className="flex items-center gap-2 pr-1">
          <span
            aria-hidden="true"
            className={clsx(
              "h-[7px] w-[7px] rounded-full",
              onlineAccounts > 0
                ? "bg-[#56b868] shadow-[0_0_8px_rgba(86,184,104,0.7)]"
                : "bg-[#56b868]/70",
            )}
          />
          <h1 className="text-[12.5px] font-semibold tracking-[-0.01em] text-[#eef2f8]">
            RelayHUD
          </h1>
          <span className="rounded-[4px] border border-[#2b4d32] bg-[#142619] px-1.5 py-[1px] font-mono text-[9.5px] font-medium uppercase tracking-[0.06em] text-[#8dd99b]">
            Live
          </span>
        </div>

        <span
          aria-hidden="true"
          className="hidden h-3.5 w-[1px] bg-[#262b36] sm:inline-block"
        />

        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tabular-nums text-[#96a0b3]">
          <span className="text-[#dce2ec]">
            <strong className="font-semibold text-white">{onlineAccounts}</strong>{" "}
            of {totalAccounts} Accounts Online
          </span>
          <span className="inline-flex items-center gap-1">
            <Activity
              className="h-3 w-3 text-[#8a96aa]"
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <span className="text-[#d4dce8]">{activeJobs}</span> Active
          </span>
          <span className="inline-flex items-center gap-1">
            <Sparkles
              className="h-3 w-3 text-[#d99d55]"
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <span className="text-[#e5af6d]">{arwJobs}</span> ARW
          </span>
          <span className="hidden items-center gap-1 md:inline-flex">
            <span className="text-[#8dd99b]">{localProcCount}</span> Local
          </span>
        </div>
      </div>

      {/* Right toolbar pill controls */}
      <nav
        aria-label="HUD Controls"
        className="flex flex-nowrap items-center gap-1 overflow-x-auto pb-0.5 xl:overflow-visible xl:pb-0"
      >
        <ToolbarPill
          icon={
            <RefreshCw
              className={clsx(
                "h-3 w-3",
                isRefreshing && "animate-spin motion-reduce:animate-none",
              )}
              strokeWidth={1.6}
              aria-hidden="true"
            />
          }
          label="Refresh"
          onClick={onRefresh}
        />

        <ToolbarPill
          icon={
            <Plug
              className="h-3 w-3 text-[#85bef2]"
              strokeWidth={1.6}
              aria-hidden="true"
            />
          }
          label={`Accounts (${onlineAccounts}/${totalAccounts})`}
          active={activeModal === "accounts"}
          isDialog
          onClick={() => onOpenModal("accounts")}
        />

        <ToolbarPill
          icon={
            <ShieldCheck
              className={clsx(
                "h-3 w-3",
                ssoActive ? "text-[#8dd99b]" : "text-[#9ea8ba]",
              )}
              strokeWidth={1.6}
              aria-hidden="true"
            />
          }
          label={ssoActive ? "SSO On" : "SSO"}
          active={activeModal === "sso"}
          isDialog
          onClick={() => onOpenModal("sso")}
        />

        <ToolbarPill
          icon={
            <Play
              className="h-3 w-3 text-[#65c977]"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          }
          label="New Job"
          accent="green"
          active={activeModal === "dispatch"}
          isDialog
          onClick={() => onOpenModal("dispatch")}
        />

        <ToolbarPill
          icon={<Clock className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />}
          label="Usage Limits"
          active={activeModal === "limits"}
          isDialog
          onClick={() => onOpenModal("limits")}
        />

        <ToolbarPill
          icon={
            <BarChart3 className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />
          }
          label="Analytics"
          active={activeModal === "analytics"}
          isDialog
          onClick={() => onOpenModal("analytics")}
        />

        <ToolbarPill
          icon={
            <MessageSquare
              className="h-3 w-3"
              strokeWidth={1.6}
              aria-hidden="true"
            />
          }
          label="Jobs by Chat"
          active={activeModal === "chats"}
          isDialog
          onClick={() => onOpenModal("chats")}
        />

        <ToolbarPill
          icon={<Cpu className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />}
          label="Host Health"
          active={activeModal === "health"}
          isDialog
          onClick={() => onOpenModal("health")}
        />

        <ToolbarPill
          icon={<Bell className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />}
          label="Alerts"
          badgeCount={unreadAlerts}
          active={activeModal === "alerts"}
          isDialog
          onClick={() => onOpenModal("alerts")}
        />

        <ToolbarPill
          icon={
            <Terminal className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />
          }
          label="Logs"
          active={terminalOpen}
          pressed={terminalOpen}
          onClick={onToggleTerminal}
        />

        {isRemoteSession && onLockSession ? (
          <ToolbarPill
            icon={
              <Lock
                className="h-3 w-3 text-[#e5af6d]"
                strokeWidth={1.6}
                aria-hidden="true"
              />
            }
            label={
              sessionUser && sessionUser.method !== "passcode"
                ? `Lock (${sessionUser.email.split("@")[0]})`
                : "Lock"
            }
            onClick={onLockSession}
          />
        ) : null}
      </nav>
    </header>
  );
}

function ToolbarPill({
  icon,
  label,
  active = false,
  accent,
  badgeCount = 0,
  isDialog = false,
  pressed,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  accent?: "green";
  badgeCount?: number;
  isDialog?: boolean;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup={isDialog ? "dialog" : undefined}
      aria-expanded={isDialog ? active : undefined}
      aria-pressed={pressed}
      className={clsx(
        "inline-flex min-h-7 shrink-0 items-center gap-1 rounded-[6px] border px-2 py-1 text-[10.5px] font-medium transition-colors",
        active
          ? "border-[#4b8a57] bg-[#1a291e] text-[#eef2f8]"
          : accent === "green"
            ? "border-[#2f5737] bg-[#162219] text-[#d9f3de] hover:border-[#498755] hover:bg-[#1b2d1f]"
            : "border-[#262c37] bg-[#191d25] text-[#c7cfdc] hover:border-[#373f4e] hover:bg-[#202530] hover:text-white",
      )}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
      {badgeCount > 0 ? (
        <span className="ml-0.5 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#c2504e] px-1 font-mono text-[9.5px] font-semibold text-white tabular-nums">
          {badgeCount}
        </span>
      ) : null}
    </button>
  );
}
