"use client";

import { WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AccountId,
  DispatchTarget,
  HudJob,
  HudSnapshot,
  JobLogEntry,
  RoutingPolicy,
  SessionUserInfo,
} from "@/domain/types";
import { InspectorPanel } from "./InspectorPanel";
import { TerminalDrawer } from "./TerminalDrawer";
import { TopToolbar, type ToolbarModalId } from "./TopToolbar";
import { TopologyCanvas } from "./TopologyCanvas";
import { AccountsModal } from "./modals/AccountsModal";
import { DispatchModal } from "./modals/DispatchModal";
import { SsoSettingsModal } from "./modals/SsoSettingsModal";
import {
  AlertsModal,
  AnalyticsModal,
  HostHealthModal,
  JobsByChatModal,
  UsageLimitsModal,
} from "./modals/TelemetryModals";

interface RelayHudShellProps {
  initialSnapshot: HudSnapshot;
  isRemoteSession?: boolean;
  sessionUser?: SessionUserInfo | null;
}

const OAUTH_REASON_LABELS: Record<string, string> = {
  access_denied: "OAuth/SSO sign-in was cancelled.",
  invalid_state: "OAuth state check failed — please retry.",
  invalid_slot: "Target account slot was not found.",
  oidc_discovery_failed: "Failed to reach the OIDC discovery endpoint.",
  invalid_id_token: "Identity provider returned an invalid ID token.",
  token_exchange_failed: "Token exchange failed — check Client ID & Secret.",
  missing_access_token: "Identity provider did not return an access token.",
  network_error: "Network error contacting OAuth servers.",
};

export function RelayHudShell({
  initialSnapshot,
  isRemoteSession = false,
  sessionUser = null,
}: RelayHudShellProps) {
  const [snapshot, setSnapshot] = useState<HudSnapshot>(initialSnapshot);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(
    initialSnapshot.jobs[0]?.id ?? null,
  );
  const [selectedAccountId, setSelectedAccountId] = useState<AccountId | null>(
    initialSnapshot.jobs.length === 0
      ? (initialSnapshot.accounts[0]?.id ?? null)
      : null,
  );
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<ToolbarModalId>(null);
  const [connectTargetId, setConnectTargetId] = useState<AccountId | null>(
    initialSnapshot.accounts[0]?.id ?? null,
  );
  const [openAccountsInAddMode, setOpenAccountsInAddMode] = useState(false);
  const [dispatchTarget, setDispatchTarget] = useState<DispatchTarget>("arw");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTestingAccount, setIsTestingAccount] = useState(false);
  const [isJobActionBusy, setIsJobActionBusy] = useState(false);
  const [pendingToggleKey, setPendingToggleKey] = useState<string | null>(null);
  const [offlineBanner, setOfflineBanner] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    tone: "info" | "error";
    text: string;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback(
    (text: string, tone: "info" | "error" = "info") => {
      setToast({ text, tone });
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
      }, 3800);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (window.innerWidth < 1024) {
      setTerminalOpen(false);
    }
  }, []);

  const fetchSnapshot = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/hud", { cache: "no-store" });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const next = (await res.json()) as HudSnapshot;
      setSnapshot(next);
      setOfflineBanner(null);
    } catch {
      setOfflineBanner(
        "Lost connection to RelayHUD server — showing last known state and retrying automatically.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const handleLockSession = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Reload regardless so client returns to UnlockScreen.
    } finally {
      window.location.reload();
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthState = params.get("oauth");
    if (!oauthState) return;

    if (oauthState === "connected") {
      const accountParam = params.get("account") ?? "";
      showToast(
        accountParam
          ? `OAuth / SSO connected for ${accountParam}.`
          : "OAuth / SSO account connected.",
      );
      window.history.replaceState({}, "", "/");
    } else if (
      oauthState === "missing_config" ||
      oauthState === "missing_oidc_config"
    ) {
      showToast(
        oauthState === "missing_oidc_config"
          ? "Configure OIDC Issuer, Client ID, and Client Secret in SSO Settings first."
          : "Configure Google OAuth Client ID and Secret in SSO Settings first.",
        "error",
      );
      setActiveModal("sso");
      window.history.replaceState({}, "", "/");
    } else if (oauthState === "error") {
      const reason = params.get("reason") ?? "";
      showToast(
        OAUTH_REASON_LABELS[reason] ?? "OAuth/SSO sign-in did not complete.",
        "error",
      );
      window.history.replaceState({}, "", "/");
    }
  }, [showToast]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchSnapshot();
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [fetchSnapshot]);

  const selectedJob =
    snapshot.jobs.find((j) => j.id === selectedJobId) ?? null;
  const selectedAccount =
    selectedAccountId && !selectedJob
      ? (snapshot.accounts.find((a) => a.id === selectedAccountId) ?? null)
      : null;

  const selectedJobStatus = selectedJob?.status;
  useEffect(() => {
    if (!selectedJobId || selectedJobStatus !== "working") return;

    const es = new EventSource(
      `/api/jobs/${encodeURIComponent(selectedJobId)}/stream`,
    );
    es.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data) as {
          type: string;
          job?: HudJob;
          entry?: JobLogEntry;
          outputText?: string;
        };
        if (parsed.type === "job" && parsed.job) {
          const updatedJob = parsed.job;
          setSnapshot((prev) => ({
            ...prev,
            jobs: prev.jobs.map((j) =>
              j.id === updatedJob.id ? updatedJob : j,
            ),
          }));
        } else if (
          parsed.type === "delta" &&
          typeof parsed.outputText === "string"
        ) {
          const nextText = parsed.outputText;
          setSnapshot((prev) => ({
            ...prev,
            jobs: prev.jobs.map((j) =>
              j.id === selectedJobId ? { ...j, outputText: nextText } : j,
            ),
          }));
        } else if (parsed.type === "log" && parsed.entry) {
          const nextEntry = parsed.entry;
          setSnapshot((prev) => ({
            ...prev,
            jobs: prev.jobs.map((j) =>
              j.id === selectedJobId
                ? {
                    ...j,
                    lastCheckInAt: nextEntry.timestamp,
                    logs: j.logs.some((l) => l.id === nextEntry.id)
                      ? j.logs
                      : [...j.logs.slice(-149), nextEntry],
                  }
                : j,
            ),
          }));
        }
      } catch {
        // Ignore keepalive or malformed frame.
      }
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        void fetchSnapshot();
      }
    };
    return () => {
      es.close();
    };
  }, [selectedJobId, selectedJobStatus, fetchSnapshot]);

  const handleToggleAccountFlag = async (
    accountId: AccountId,
    field: "takesWork" | "autoFailover",
    value: boolean,
  ): Promise<void> => {
    const key = `${accountId}:${field}`;
    const prevValue = snapshot.accounts.find((a) => a.id === accountId)?.[field];

    setSnapshot((prev) => ({
      ...prev,
      accounts: prev.accounts.map((a) =>
        a.id === accountId ? { ...a, [field]: value } : a,
      ),
    }));

    setPendingToggleKey(key);
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      }
      await fetchSnapshot();
    } catch (err) {
      if (prevValue !== undefined) {
        setSnapshot((prev) => ({
          ...prev,
          accounts: prev.accounts.map((a) =>
            a.id === accountId ? { ...a, [field]: prevValue } : a,
          ),
        }));
      }
      showToast(
        err instanceof Error
          ? `Failed to update ${field}: ${err.message}`
          : `Failed to update ${field}.`,
        "error",
      );
    } finally {
      setPendingToggleKey(null);
    }
  };

  const handleTestAccount = async (accountId: AccountId): Promise<void> => {
    setIsTestingAccount(true);
    try {
      const res = await fetch(
        `/api/accounts/${encodeURIComponent(accountId)}/test`,
        { method: "POST" },
      );
      const data = (await res.json()) as {
        error?: string;
        probe?: { ok: boolean; latencyMs: number; error?: string };
      };
      if (!res.ok) {
        showToast(data.error ?? `Probe rejected (${res.status}).`, "error");
        return;
      }
      await fetchSnapshot();
      showToast(
        data.probe?.ok
          ? `${accountId} verified (${data.probe.latencyMs}ms).`
          : (data.probe?.error ?? `Probe failed for ${accountId}.`),
        data.probe?.ok ? "info" : "error",
      );
    } catch {
      showToast(`Network error probing ${accountId}.`, "error");
    } finally {
      setIsTestingAccount(false);
    }
  };

  const handleStopJob = async (jobId: string): Promise<void> => {
    setIsJobActionBusy(true);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/stop`, {
        method: "POST",
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        showToast(errData.error ?? "Unable to stop job.", "error");
        return;
      }
      await fetchSnapshot();
      showToast("Stop signal delivered.");
    } catch {
      showToast("Network error delivering stop signal.", "error");
    } finally {
      setIsJobActionBusy(false);
    }
  };

  const handleFailoverRetry = async (job: HudJob): Promise<void> => {
    setIsJobActionBusy(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${job.title} (Retry)`,
          prompt: job.prompt,
          target: "arw",
          repoName: job.repoName,
          chatSessionId: job.chatSessionId,
          chatTitle: job.chatTitle,
        }),
      });
      const data = (await res.json()) as { jobs?: HudJob[]; error?: string };
      if (!res.ok || !data.jobs?.[0]) {
        showToast(data.error ?? "Failover retry failed.", "error");
        return;
      }
      await fetchSnapshot();
      setSelectedJobId(data.jobs[0].id);
      setSelectedAccountId(null);
      setMobileInspectorOpen(false);
      setTerminalOpen(true);
      showToast(`Re-dispatched via ARW -> ${data.jobs[0].targetAccountId}.`);
    } catch {
      showToast("Network error dispatching failover retry.", "error");
    } finally {
      setIsJobActionBusy(false);
    }
  };

  const handleChangeRoutingPolicy = async (
    policy: RoutingPolicy,
  ): Promise<void> => {
    try {
      const res = await fetch("/api/hud", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routingPolicy: policy }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        showToast(errData.error ?? "Failed to update routing policy.", "error");
        return;
      }
      await fetchSnapshot();
      showToast(`Routing policy switched to ${policy.replace("_", " ")}.`);
    } catch {
      showToast("Network error updating routing policy.", "error");
    }
  };

  const handleUpdateLimit = async (
    accountId: AccountId,
    rpmLimit: number,
    tokensDailyBudget: number,
  ): Promise<void> => {
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rpmLimit, tokensDailyBudget }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        showToast(errData.error ?? "Failed to update limits.", "error");
        return;
      }
      await fetchSnapshot();
      showToast(`Updated limits for ${accountId}.`);
    } catch {
      showToast("Network error updating usage limits.", "error");
    }
  };

  const handleAcknowledgeAlert = async (alertId: string): Promise<void> => {
    try {
      const res = await fetch(
        `/api/alerts/${encodeURIComponent(alertId)}/ack`,
        { method: "POST" },
      );
      if (!res.ok) {
        showToast("Failed to acknowledge alert.", "error");
        return;
      }
      await fetchSnapshot();
    } catch {
      showToast("Network error acknowledging alert.", "error");
    }
  };

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#101115] text-[#e6eaf0]">
      <TopToolbar
        snapshot={snapshot}
        isRefreshing={isRefreshing}
        activeModal={activeModal}
        terminalOpen={terminalOpen}
        isRemoteSession={isRemoteSession}
        sessionUser={sessionUser}
        onRefresh={() => void fetchSnapshot()}
        onOpenModal={(m) => {
          if (m === "accounts") setOpenAccountsInAddMode(false);
          setActiveModal(m);
        }}
        onToggleTerminal={() => setTerminalOpen((prev) => !prev)}
        onLockSession={() => void handleLockSession()}
      />

      {offlineBanner ? (
        <div
          role="alert"
          className="flex items-center gap-2 border-b border-[#6e4e2a] bg-[#241b11] px-4 py-1.5 text-[11px] text-[#e5af6d]"
        >
          <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{offlineBanner}</span>
        </div>
      ) : null}

      <main
        id="hud-main"
        className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row"
      >
        <TopologyCanvas
          snapshot={snapshot}
          selectedJobId={selectedJobId}
          selectedAccountId={selectedAccountId}
          pendingToggleKey={pendingToggleKey}
          onSelectJob={(jobId) => {
            setSelectedJobId(jobId);
            setSelectedAccountId(null);
            setMobileInspectorOpen(true);
          }}
          onSelectAccount={(accountId) => {
            setSelectedAccountId(accountId);
            setSelectedJobId(null);
            setMobileInspectorOpen(true);
          }}
          onToggleAccountFlag={(id, field, val) =>
            void handleToggleAccountFlag(id, field, val)
          }
          onOpenConnectAccount={(id) => {
            setOpenAccountsInAddMode(false);
            setConnectTargetId(id);
            setActiveModal("accounts");
          }}
          onOpenAddAccount={() => {
            setOpenAccountsInAddMode(true);
            setActiveModal("accounts");
          }}
          onOpenDispatch={(target) => {
            setDispatchTarget(target ?? "arw");
            setActiveModal("dispatch");
          }}
        />

        <InspectorPanel
          job={selectedJob}
          account={selectedAccount}
          allAccounts={snapshot.accounts}
          referenceNowIso={snapshot.updatedAt}
          mobileOpen={mobileInspectorOpen}
          isJobActionBusy={isJobActionBusy}
          onClose={() => {
            setMobileInspectorOpen(false);
            if (window.innerWidth >= 1024) {
              setSelectedJobId(null);
              setSelectedAccountId(null);
            }
          }}
          onShowLog={() => {
            if (window.innerWidth < 1024) {
              setMobileInspectorOpen(false);
            }
            setTerminalOpen(true);
          }}
          onStopJob={(id) => void handleStopJob(id)}
          onFailoverRetry={(j) => void handleFailoverRetry(j)}
          onSelectJob={(id) => {
            setSelectedJobId(id);
            setSelectedAccountId(null);
          }}
          onOpenConnectAccount={(id) => {
            setMobileInspectorOpen(false);
            setOpenAccountsInAddMode(false);
            setConnectTargetId(id);
            setActiveModal("accounts");
          }}
          onTestAccount={(id) => void handleTestAccount(id)}
          isTestingAccount={isTestingAccount}
        />
      </main>

      <TerminalDrawer
        job={selectedJob}
        open={terminalOpen}
        onClose={() => setTerminalOpen(false)}
      />

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2"
      >
        {toast ? (
          <div
            className={`max-w-[calc(100vw-2rem)] truncate rounded-full border px-4 py-1.5 font-mono text-[11px] shadow-[0_12px_36px_rgba(0,0,0,0.5)] ${
              toast.tone === "error"
                ? "border-[#7d3b3d] bg-[#241315]/95 text-[#f29e9c]"
                : "border-[#3a6b44] bg-[#142318]/95 text-[#9ce2a9]"
            }`}
          >
            {toast.text}
          </div>
        ) : null}
      </div>

      <AccountsModal
        open={activeModal === "accounts"}
        initialAccountId={connectTargetId}
        initialAddMode={openAccountsInAddMode}
        accounts={snapshot.accounts}
        routingPolicy={snapshot.routingPolicy}
        ssoConfig={snapshot.ssoConfig}
        onClose={() => {
          setOpenAccountsInAddMode(false);
          setActiveModal(null);
        }}
        onRefreshSnapshot={fetchSnapshot}
        onChangeRoutingPolicy={handleChangeRoutingPolicy}
        onOpenSsoSettings={() => setActiveModal("sso")}
      />

      <SsoSettingsModal
        open={activeModal === "sso"}
        ssoConfig={snapshot.ssoConfig}
        onClose={() => setActiveModal(null)}
        onRefreshSnapshot={fetchSnapshot}
        readOnly={isRemoteSession}
      />

      <DispatchModal
        open={activeModal === "dispatch"}
        initialTarget={dispatchTarget}
        accounts={snapshot.accounts}
        onClose={() => setActiveModal(null)}
        onDispatched={async (jobs) => {
          await fetchSnapshot();
          if (jobs[0]) {
            setSelectedJobId(jobs[0].id);
            setSelectedAccountId(null);
            setMobileInspectorOpen(false);
            setTerminalOpen(true);
            showToast(`Dispatched ${jobs.length} live job(s).`);
          }
        }}
        onOpenAccounts={(id) => {
          setOpenAccountsInAddMode(false);
          setConnectTargetId(id);
          setActiveModal("accounts");
        }}
      />

      <UsageLimitsModal
        open={activeModal === "limits"}
        snapshot={snapshot}
        onClose={() => setActiveModal(null)}
        onUpdateLimit={handleUpdateLimit}
      />

      <AnalyticsModal
        open={activeModal === "analytics"}
        snapshot={snapshot}
        onClose={() => setActiveModal(null)}
      />

      <JobsByChatModal
        open={activeModal === "chats"}
        snapshot={snapshot}
        onClose={() => setActiveModal(null)}
        onSelectJob={(id) => {
          setSelectedJobId(id);
          setSelectedAccountId(null);
          if (window.innerWidth < 1024) {
            setMobileInspectorOpen(true);
          } else {
            setTerminalOpen(true);
          }
        }}
      />

      <HostHealthModal
        open={activeModal === "health"}
        snapshot={snapshot}
        onClose={() => setActiveModal(null)}
      />

      <AlertsModal
        open={activeModal === "alerts"}
        snapshot={snapshot}
        onClose={() => setActiveModal(null)}
        onAcknowledge={handleAcknowledgeAlert}
        onFailoverRetry={handleFailoverRetry}
      />
    </div>
  );
}
