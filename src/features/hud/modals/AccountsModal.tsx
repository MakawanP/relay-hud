"use client";

import clsx from "clsx";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Globe,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ModalShell } from "@/components/ModalShell";
import { ProviderGlyph } from "@/components/ProviderGlyph";
import { AccountStatusPill } from "@/components/StatusDot";
import {
  CONNECTOR_PRESETS,
  getConnectorPreset,
  getProviderDisplayName,
} from "@/domain/connectors";
import type {
  AccountId,
  AccountPublicState,
  AuthMode,
  RoutingPolicy,
  SsoPublicConfig,
} from "@/domain/types";

interface AccountsModalProps {
  open: boolean;
  initialAccountId: AccountId | null;
  initialAddMode?: boolean;
  accounts: AccountPublicState[];
  routingPolicy: RoutingPolicy;
  ssoConfig: SsoPublicConfig;
  onClose: () => void;
  onRefreshSnapshot: () => Promise<void>;
  onChangeRoutingPolicy: (policy: RoutingPolicy) => Promise<void>;
  onOpenSsoSettings: () => void;
}

export function AccountsModal({
  open,
  initialAccountId,
  initialAddMode = false,
  accounts,
  routingPolicy,
  ssoConfig,
  onClose,
  onRefreshSnapshot,
  onChangeRoutingPolicy,
  onOpenSsoSettings,
}: AccountsModalProps) {
  const modelListId = useId();
  const [activeId, setActiveId] = useState<AccountId | null>(initialAccountId);
  const [addingNew, setAddingNew] = useState(initialAddMode);
  const [selectedPresetId, setSelectedPresetId] = useState("openai");
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("https://api.openai.com/v1");
  const [newModel, setNewModel] = useState("gpt-4.1");
  const [newAuthMode, setNewAuthMode] = useState<AuthMode>("api_key");
  const [newApiKey, setNewApiKey] = useState("");
  const [newTags, setNewTags] = useState("openai");

  const activeAccount =
    accounts.find((a) => a.id === activeId) ?? accounts[0] ?? null;

  const [name, setName] = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const [email, setEmail] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("api_key");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const lastHydratedSlotRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setActiveId(initialAccountId ?? accounts[0]?.id ?? null);
    setAddingNew(initialAddMode || accounts.length === 0);
  }, [initialAccountId, initialAddMode, open, accounts]);

  useEffect(() => {
    if (!open) {
      lastHydratedSlotRef.current = null;
      setApiKey("");
      setNewApiKey("");
      setConfirmClear(false);
      setConfirmDelete(false);
      return;
    }
    if (!activeAccount || addingNew) return;
    if (lastHydratedSlotRef.current === activeAccount.id) return;
    lastHydratedSlotRef.current = activeAccount.id;

    setName(activeAccount.name);
    setRoleLabel(activeAccount.roleLabel);
    setEmail(activeAccount.email ?? "");
    setBaseUrl(activeAccount.baseUrl ?? "");
    setTagsText(activeAccount.tags.join(", "));
    setAuthMode(activeAccount.authMode);
    setDefaultModel(activeAccount.defaultModel);
    setApiKey("");
    setConfirmClear(false);
    setConfirmDelete(false);
    setFeedback(null);
  }, [activeAccount, open, addingNew]);

  const applyPresetToNewForm = (presetId: string): void => {
    const preset = getConnectorPreset(presetId);
    setSelectedPresetId(preset.id);
    setNewName("");
    setNewBaseUrl(preset.defaultBaseUrl ?? "");
    setNewModel(preset.defaultModel);
    setNewAuthMode(preset.defaultAuthMode);
    setNewApiKey("");
    setNewTags(preset.id);
    setFeedback(null);
  };

  const handleCreateAccount = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const preset = getConnectorPreset(selectedPresetId);
    setBusy(true);
    setFeedback(null);
    try {
      const parsedTags = newTags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const payload: Record<string, unknown> = {
        provider: preset.provider,
        presetId: preset.id,
        authMode: newAuthMode,
        defaultModel: newModel.trim() || preset.defaultModel,
        tags: parsedTags.length > 0 ? parsedTags : [preset.id],
        testOnSave: Boolean(
          newApiKey.trim() || newAuthMode === "none" || newAuthMode === "cli",
        ),
      };
      if (newName.trim()) payload.name = newName.trim();
      if (preset.provider === "openai_compatible") {
        payload.baseUrl = newBaseUrl.trim() || preset.defaultBaseUrl;
      }
      if (newAuthMode === "api_key" && newApiKey.trim()) {
        payload.apiKey = newApiKey.trim();
      }

      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: string;
        account?: AccountPublicState;
        probe?: { ok: boolean; latencyMs: number; error?: string } | null;
      };
      if (!res.ok || !data.account) {
        setFeedback({
          tone: "error",
          text: data.error ?? "Failed to create account.",
        });
        return;
      }

      setNewApiKey("");
      await onRefreshSnapshot();
      setAddingNew(false);
      lastHydratedSlotRef.current = null;
      setActiveId(data.account.id);
      setFeedback({
        tone: data.probe && !data.probe.ok ? "info" : "success",
        text: data.probe?.ok
          ? `Added ${data.account.name} & verified live in ${data.probe.latencyMs}ms.`
          : data.probe?.error
            ? `Added ${data.account.name}, but live probe failed: ${data.probe.error}`
            : `Added ${data.account.name}. Add credentials or sign in via SSO below.`,
      });
    } catch {
      setFeedback({
        tone: "error",
        text: "Network error creating account connector.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAndVerify = async (): Promise<void> => {
    if (!activeAccount) return;
    setBusy(true);
    setFeedback(null);
    try {
      const tags = tagsText
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const payload: Record<string, unknown> = {
        name: name.trim() || activeAccount.name,
        roleLabel: roleLabel.trim() || activeAccount.roleLabel,
        email: email.trim() || null,
        authMode,
        defaultModel: defaultModel.trim() || activeAccount.defaultModel,
        tags,
        testOnSave: true,
      };
      if (activeAccount.provider === "openai_compatible") {
        payload.baseUrl = baseUrl.trim();
      }
      if (authMode === "api_key" && apiKey.trim().length > 0) {
        payload.apiKey = apiKey.trim();
      }

      const res = await fetch(
        `/api/accounts/${encodeURIComponent(activeAccount.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        probe?: { ok: boolean; latencyMs: number; models: string[]; error?: string };
      };
      if (!res.ok) {
        setFeedback({
          tone: "error",
          text: data.error ?? "Failed to save account configuration.",
        });
        return;
      }

      setApiKey("");
      await onRefreshSnapshot();

      if (data.probe?.ok) {
        setFeedback({
          tone: "success",
          text: `Connected & verified in ${data.probe.latencyMs}ms (${data.probe.models.length} models ready). Encrypted in local AES-256-GCM vault.`,
        });
      } else {
        setFeedback({
          tone: "error",
          text:
            data.probe?.error ??
            "Settings saved, but the live connection probe did not succeed.",
        });
      }
    } catch {
      setFeedback({
        tone: "error",
        text: "Network error reaching RelayHUD server.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleTestOnly = async (): Promise<void> => {
    if (!activeAccount) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/accounts/${encodeURIComponent(activeAccount.id)}/test`,
        { method: "POST" },
      );
      const data = (await res.json()) as {
        error?: string;
        probe?: { ok: boolean; latencyMs: number; models: string[]; error?: string };
      };
      if (!res.ok) {
        setFeedback({
          tone: "error",
          text: data.error ?? "Connection test rejected.",
        });
        return;
      }
      await onRefreshSnapshot();
      if (data.probe?.ok) {
        setFeedback({
          tone: "success",
          text: `Probe succeeded in ${data.probe.latencyMs}ms — ${data.probe.models.length} models available.`,
        });
      } else {
        setFeedback({
          tone: "error",
          text: data.probe?.error ?? "Connection test failed.",
        });
      }
    } catch {
      setFeedback({ tone: "error", text: "Unable to run connection probe." });
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    if (!activeAccount) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/accounts/${encodeURIComponent(activeAccount.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clearCredentials: true }),
        },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback({
          tone: "error",
          text: data.error ?? "Failed to clear stored credentials.",
        });
        return;
      }
      setEmail("");
      setApiKey("");
      setConfirmClear(false);
      await onRefreshSnapshot();
      setFeedback({
        tone: "info",
        text: `Cleared stored credentials for ${activeAccount.name}.`,
      });
    } catch {
      setFeedback({
        tone: "error",
        text: "Network error while clearing stored credentials.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAccount = async (): Promise<void> => {
    if (!activeAccount) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/accounts/${encodeURIComponent(activeAccount.id)}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as {
        error?: string;
        accounts?: AccountPublicState[];
      };
      if (!res.ok) {
        setFeedback({
          tone: "error",
          text: data.error ?? "Failed to remove account.",
        });
        return;
      }
      setConfirmDelete(false);
      lastHydratedSlotRef.current = null;
      await onRefreshSnapshot();
      const nextFirst = data.accounts?.[0]?.id ?? null;
      setActiveId(nextFirst);
      if (!nextFirst) setAddingNew(true);
      setFeedback({
        tone: "info",
        text: `Removed ${activeAccount.name} and wiped its vault credentials.`,
      });
    } catch {
      setFeedback({ tone: "error", text: "Network error removing account." });
    } finally {
      setBusy(false);
    }
  };

  const handleMovePriority = async (
    accountId: AccountId,
    direction: -1 | 1,
  ): Promise<void> => {
    const idx = accounts.findIndex((a) => a.id === accountId);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= accounts.length) return;
    const nextOrder = accounts.map((a) => a.id);
    const [moved] = nextOrder.splice(idx, 1);
    if (!moved) return;
    nextOrder.splice(targetIdx, 0, moved);

    setBusy(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: nextOrder }),
      });
      if (res.ok) {
        await onRefreshSnapshot();
      }
    } finally {
      setBusy(false);
    }
  };

  const newPreset = getConnectorPreset(selectedPresetId);

  const authOptionsForAccount = (
    acc: AccountPublicState,
  ): Array<{ id: AuthMode; label: string; hint: string }> => {
    if (acc.provider === "google") {
      return [
        {
          id: "api_key",
          label: "Gemini API Key",
          hint: "Google AI Studio key",
        },
        {
          id: "oauth",
          label: "Google OAuth 2.0",
          hint: "Unlimited Google sign-ins",
        },
        {
          id: "cli",
          label: "Local gemini CLI",
          hint: acc.cliAvailable ? "`gemini` ready" : "Not found in PATH",
        },
      ];
    }
    if (acc.provider === "anthropic") {
      return [
        {
          id: "api_key",
          label: "Anthropic API Key",
          hint: "Live rate-limit headers",
        },
        {
          id: "cli",
          label: "Local Claude CLI",
          hint: acc.cliAvailable ? "`claude` ready" : "Not found in PATH",
        },
      ];
    }
    return [
      {
        id: "api_key",
        label: "Bearer API Key",
        hint: "OpenAI / OpenRouter / Groq",
      },
      {
        id: "oauth",
        label: "OIDC SSO Bearer",
        hint: "Enterprise SSO gateway token",
      },
      {
        id: "none",
        label: "No Auth (Local)",
        hint: "Ollama / LM Studio / LAN",
      },
    ];
  };

  const activeIndex = activeAccount
    ? accounts.findIndex((a) => a.id === activeAccount.id)
    : -1;

  return (
    <ModalShell
      open={open}
      title={`Connected Accounts (${accounts.length} Configured)`}
      subtitle="Add unlimited Google, Claude, OpenAI, OpenRouter, Groq, Ollama, or OIDC SSO gateway connectors. Secrets are encrypted locally with AES-256-GCM."
      maxWidthClass="max-w-4xl"
      onClose={onClose}
    >
      {/* Dynamic account grid + Add Account button */}
      <div className="grid max-h-[210px] grid-cols-1 gap-2 overflow-y-auto pr-0.5 sm:grid-cols-3">
        {accounts.map((acc) => (
          <button
            key={acc.id}
            type="button"
            aria-pressed={!addingNew && acc.id === activeAccount?.id}
            onClick={() => {
              setAddingNew(false);
              lastHydratedSlotRef.current = null;
              setActiveId(acc.id);
            }}
            className={clsx(
              "flex flex-col rounded-lg border p-2.5 text-left transition-colors",
              !addingNew && acc.id === activeAccount?.id
                ? "border-[#56b868] bg-[#162119]"
                : "border-[#252b37] bg-[#11141a] hover:border-[#374052]",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <ProviderGlyph
                  provider={acc.provider}
                  slotIndex={acc.slotIndex}
                  presetId={acc.presetId}
                  size={15}
                />
                <span className="truncate text-[11.5px] font-semibold text-[#eef2f8]">
                  {acc.name}
                </span>
              </div>
              <AccountStatusPill status={acc.status} />
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[9.5px] text-[#8d97aa]">
              <span className="truncate">
                #{acc.slotIndex} · {acc.maskedCredential ?? "Not connected"}
              </span>
              <span>{acc.latencyMs !== null ? `${acc.latencyMs}ms` : "—"}</span>
            </div>
          </button>
        ))}

        <button
          type="button"
          aria-pressed={addingNew}
          onClick={() => {
            setAddingNew(true);
            setFeedback(null);
          }}
          className={clsx(
            "flex min-h-[60px] items-center justify-center gap-2 rounded-lg border border-dashed p-2.5 text-[12px] font-semibold transition-colors",
            addingNew
              ? "border-[#56b868] bg-[#162319] text-[#9ce2a9]"
              : "border-[#354052] bg-[#101319] text-[#aeb8ca] hover:border-[#56b868] hover:text-white",
          )}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Connector
        </button>
      </div>

      {/* ADD NEW CONNECTOR FORM */}
      {addingNew ? (
        <form
          onSubmit={(e) => void handleCreateAccount(e)}
          className="mt-4 rounded-lg border border-[#2c4a34] bg-[#101417] p-4"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[#1f242e] pb-2.5">
            <div>
              <h3 className="text-[13px] font-semibold text-white">
                Add New Account Connector
              </h3>
              <p className="text-[10.5px] text-[#8d97aa]">
                Pick any provider preset—each instance gets its own credentials,
                quota, priority, and failover bus tap-in.
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CONNECTOR_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={selectedPresetId === preset.id}
                onClick={() => applyPresetToNewForm(preset.id)}
                className={clsx(
                  "flex flex-col items-start rounded-md border p-2 text-left transition-colors",
                  selectedPresetId === preset.id
                    ? "border-[#56b868] bg-[#162219]"
                    : "border-[#252b37] bg-[#14171e] hover:border-[#394254]",
                )}
              >
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white">
                  <ProviderGlyph
                    provider={preset.provider}
                    presetId={preset.id}
                    size={14}
                  />
                  <span className="truncate">{preset.label}</span>
                </div>
                <span className="mt-0.5 line-clamp-2 text-[9.5px] leading-snug text-[#8d97aa]">
                  {preset.description}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                Display Label (optional)
              </span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={`#${accounts.length + 1} ${newPreset.label}`}
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 text-[12px] text-white placeholder:text-[#7f899c] focus:border-[#56b868]"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                Default Model
              </span>
              <input
                type="text"
                list={`${modelListId}-new`}
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11.5px] text-white focus:border-[#56b868]"
              />
              <datalist id={`${modelListId}-new`}>
                {newPreset.suggestedModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>

            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                Auth Mode
              </span>
              <select
                value={newAuthMode}
                onChange={(e) => setNewAuthMode(e.target.value as AuthMode)}
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11.5px] text-white focus:border-[#56b868]"
              >
                {newPreset.supportedAuthModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode === "api_key"
                      ? "API Key"
                      : mode === "oauth"
                        ? newPreset.provider === "google"
                          ? "Google OAuth 2.0"
                          : "OIDC SSO Bearer"
                        : mode === "cli"
                          ? "Local CLI"
                          : "No Auth (Local)"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {newPreset.provider === "openai_compatible" ? (
              <label className="block">
                <span className="font-mono text-[10px] text-[#96a0b3]">
                  OpenAI-Compatible Base URL
                </span>
                <input
                  type="url"
                  required
                  value={newBaseUrl}
                  onChange={(e) => setNewBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11.5px] text-white focus:border-[#56b868]"
                />
              </label>
            ) : null}

            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                Pool Tags (comma-separated)
              </span>
              <input
                type="text"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                placeholder="coding, fast, work"
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11.5px] text-white placeholder:text-[#7f899c] focus:border-[#56b868]"
              />
            </label>

            {newAuthMode === "api_key" ? (
              <label className="block sm:col-span-2">
                <span className="font-mono text-[10px] text-[#96a0b3]">
                  API Key (optional now — can add later)
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder={newPreset.apiKeyPlaceholder}
                  className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-3 py-1.5 font-mono text-[12px] text-white placeholder:text-[#7f899c] focus:border-[#56b868]"
                />
              </label>
            ) : null}
          </div>

          {feedback ? (
            <div
              role={feedback.tone === "error" ? "alert" : "status"}
              className="mt-3 rounded-md border border-[#6b3132] bg-[#211315] px-3 py-2 text-[11.5px] text-[#f29e9c]"
            >
              {feedback.text}
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-[#1f242e] pt-3">
            {accounts.length > 0 ? (
              <button
                type="button"
                onClick={() => setAddingNew(false)}
                className="min-h-8 rounded-md border border-[#282e3b] bg-[#181c24] px-3 py-1.5 text-[11.5px] text-[#b8c2d4] hover:text-white"
              >
                Cancel
              </button>
            ) : null}
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#448050] bg-[#1d3623] px-4 py-1.5 text-[11.5px] font-semibold text-[#e6f9ea] hover:bg-[#25452c] disabled:opacity-45"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {busy ? "Adding..." : `Create ${newPreset.label} Connector`}
            </button>
          </div>
        </form>
      ) : activeAccount ? (
        /* EXISTING ACCOUNT CONFIGURATION */
        <div className="mt-4 rounded-lg border border-[#242a36] bg-[#101318] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f242e] pb-3">
            <div className="flex items-center gap-2">
              <ProviderGlyph
                provider={activeAccount.provider}
                slotIndex={activeAccount.slotIndex}
                presetId={activeAccount.presetId}
                size={18}
              />
              <div>
                <h3 className="text-[13px] font-semibold text-white">
                  {activeAccount.name}
                </h3>
                <p className="font-mono text-[10px] text-[#8d97aa]">
                  Priority #{activeAccount.slotIndex} of {accounts.length} ·{" "}
                  {getProviderDisplayName(
                    activeAccount.provider,
                    activeAccount.presetId,
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={busy || activeIndex <= 0}
                aria-label="Move priority up"
                title="Higher failover priority"
                onClick={() => void handleMovePriority(activeAccount.id, -1)}
                className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-md border border-[#2a3140] bg-[#181c24] text-[#cfd6e2] hover:border-[#3c465a] disabled:opacity-35"
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={
                  busy || activeIndex < 0 || activeIndex >= accounts.length - 1
                }
                aria-label="Move priority down"
                title="Lower failover priority"
                onClick={() => void handleMovePriority(activeAccount.id, 1)}
                className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-md border border-[#2a3140] bg-[#181c24] text-[#cfd6e2] hover:border-[#3c465a] disabled:opacity-35"
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleTestOnly()}
                className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[#2a3140] bg-[#181c24] px-2.5 py-1 text-[11px] font-medium text-[#cfd6e2] hover:border-[#3c465a] disabled:opacity-45"
              >
                <RefreshCw
                  className={`h-3 w-3 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
                  aria-hidden="true"
                />
                Test
              </button>

              {activeAccount.hasCredentials && activeAccount.authMode !== "none" ? (
                confirmClear ? (
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDisconnect()}
                      className="min-h-7 rounded-md border border-[#8e3d3f] bg-[#361719] px-2 py-1 text-[10.5px] font-semibold text-[#ffd6d5]"
                    >
                      Clear Key
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClear(false)}
                      className="min-h-7 rounded-md border border-[#2a3140] bg-[#181c24] px-2 py-1 text-[10.5px] text-[#aeb8ca]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setConfirmDelete(false);
                      setConfirmClear(true);
                    }}
                    className="min-h-7 rounded-md border border-[#4a3726] bg-[#211a14] px-2 py-1 text-[10.5px] text-[#e5af6d] hover:border-[#6e4e2a]"
                  >
                    Clear Creds
                  </button>
                )
              ) : null}

              {confirmDelete ? (
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleDeleteAccount()}
                    className="min-h-7 rounded-md border border-[#8e3d3f] bg-[#361719] px-2.5 py-1 text-[10.5px] font-semibold text-[#ffd6d5]"
                  >
                    Delete Account
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="min-h-7 rounded-md border border-[#2a3140] bg-[#181c24] px-2 py-1 text-[10.5px] text-[#aeb8ca]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setConfirmClear(false);
                    setConfirmDelete(true);
                  }}
                  className="inline-flex min-h-7 items-center gap-1 rounded-md border border-[#592c2e] bg-[#221517] px-2 py-1 text-[10.5px] font-medium text-[#ee9694] hover:border-[#7c3b3d] disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  Remove
                </button>
              )}
            </div>
          </div>

          {/* Auth Mode Picker */}
          <div className="mt-3.5">
            <span className="block font-mono text-[10px] uppercase tracking-[0.08em] text-[#8d97aa]">
              Authentication Method
            </span>
            <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {authOptionsForAccount(activeAccount).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={authMode === opt.id}
                  onClick={() => setAuthMode(opt.id)}
                  className={clsx(
                    "rounded-md border p-2.5 text-left transition-colors",
                    authMode === opt.id
                      ? "border-[#4d94d6] bg-[#131e2b]"
                      : "border-[#252b37] bg-[#151820] hover:border-[#363e4f]",
                  )}
                >
                  <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#eef2f8]">
                    {opt.id === "api_key" ? (
                      <KeyRound
                        className="h-3.5 w-3.5 text-[#85bef2]"
                        aria-hidden="true"
                      />
                    ) : opt.id === "oauth" ? (
                      <ShieldCheck
                        className="h-3.5 w-3.5 text-[#8dd99b]"
                        aria-hidden="true"
                      />
                    ) : opt.id === "none" ? (
                      <Globe
                        className="h-3.5 w-3.5 text-[#8dd99b]"
                        aria-hidden="true"
                      />
                    ) : (
                      <Terminal
                        className="h-3.5 w-3.5 text-[#e5af6d]"
                        aria-hidden="true"
                      />
                    )}
                    {opt.label}
                  </div>
                  <p className="mt-0.5 text-[10px] text-[#8d97aa]">{opt.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Fields */}
          <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                Display Label
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 text-[12px] text-[#eef2f8] focus:border-[#56b868]"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                Short Badge / Role
              </span>
              <input
                type="text"
                value={roleLabel}
                onChange={(e) => setRoleLabel(e.target.value)}
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11.5px] text-[#eef2f8] focus:border-[#56b868]"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                Default Model (type any ID)
              </span>
              <input
                type="text"
                list={modelListId}
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11.5px] text-[#eef2f8] focus:border-[#56b868]"
              />
              <datalist id={modelListId}>
                {activeAccount.availableModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>

            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                Account Email / Org (optional)
              </span>
              <input
                type="text"
                value={email}
                placeholder={
                  getConnectorPreset(
                    activeAccount.presetId ?? activeAccount.provider,
                  ).emailPlaceholder
                }
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 text-[12px] text-[#eef2f8] placeholder:text-[#7f899c] focus:border-[#56b868]"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                Pool Tags (comma-separated)
              </span>
              <input
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="coding, fast, work"
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11.5px] text-[#eef2f8] placeholder:text-[#7f899c] focus:border-[#56b868]"
              />
            </label>

            {activeAccount.provider === "openai_compatible" ? (
              <label className="block">
                <span className="font-mono text-[10px] text-[#96a0b3]">
                  Endpoint Base URL
                </span>
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11px] text-[#eef2f8] focus:border-[#56b868]"
                />
              </label>
            ) : null}
          </div>

          {/* Auth-mode specific input */}
          {authMode === "api_key" ? (
            <div className="mt-3.5">
              <label className="block">
                <span className="flex items-center justify-between font-mono text-[10px] text-[#96a0b3]">
                  <span>
                    {getProviderDisplayName(
                      activeAccount.provider,
                      activeAccount.presetId,
                    )}{" "}
                    API Key
                  </span>
                  {activeAccount.maskedCredential ? (
                    <span className="text-[#8dd99b]">
                      Stored: {activeAccount.maskedCredential}
                    </span>
                  ) : null}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={`${getConnectorPreset(activeAccount.presetId ?? activeAccount.provider).apiKeyPlaceholder} (leave blank to keep existing)`}
                  className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-3 py-2 font-mono text-[12px] text-[#eef2f8] placeholder:text-[#7f899c] focus:border-[#56b868]"
                />
              </label>
            </div>
          ) : null}

          {authMode === "oauth" && activeAccount.provider === "google" ? (
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#263242] bg-[#121821] p-3">
              <div className="text-[11.5px] text-[#c5d0e0]">
                {ssoConfig.googleAppConfigured ? (
                  <span className="inline-flex items-center gap-1.5 text-[#8dd99b]">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Google OAuth ready — sign in to link{" "}
                    <strong>{activeAccount.name}</strong>.
                  </span>
                ) : (
                  <span>
                    Configure your Google OAuth Client ID & Secret in SSO
                    Settings once to link unlimited Google accounts.
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenSsoSettings}
                  className="min-h-7 rounded border border-[#2c3445] bg-[#1a202b] px-2.5 py-1 text-[11px] text-[#c7cfdc] hover:text-white"
                >
                  Open SSO Settings
                </button>
                {ssoConfig.googleAppConfigured ? (
                  <a
                    href={`/api/oauth/google/start?accountId=${encodeURIComponent(activeAccount.id)}`}
                    className="inline-flex min-h-7 items-center gap-1.5 rounded border border-[#3a6b44] bg-[#18291d] px-3 py-1 text-[11px] font-medium text-[#9ce2a9] hover:bg-[#203626]"
                  >
                    Sign in with Google ({activeAccount.roleLabel})
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          {authMode === "oauth" &&
          activeAccount.provider === "openai_compatible" ? (
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#263844] bg-[#111920] p-3">
              <div className="text-[11.5px] text-[#c5d0e0]">
                {ssoConfig.oidcConfigured ? (
                  <span className="inline-flex items-center gap-1.5 text-[#7dd3fc]">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    OIDC SSO ({ssoConfig.oidcLabel}) ready — obtain a live Bearer
                    token for this gateway.
                  </span>
                ) : (
                  <span>
                    Configure your OIDC Issuer & Client in SSO Settings first to
                    authenticate AI gateways via Enterprise SSO.
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenSsoSettings}
                  className="min-h-7 rounded border border-[#2c3445] bg-[#1a202b] px-2.5 py-1 text-[11px] text-[#c7cfdc] hover:text-white"
                >
                  Open SSO Settings
                </button>
                {ssoConfig.oidcConfigured ? (
                  <a
                    href={`/api/oauth/oidc/start?accountId=${encodeURIComponent(activeAccount.id)}`}
                    className="inline-flex min-h-7 items-center gap-1.5 rounded border border-[#325975] bg-[#152430] px-3 py-1 text-[11px] font-medium text-[#bae6fd] hover:bg-[#1a2d3d]"
                  >
                    Sign in via {ssoConfig.oidcLabel}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          {authMode === "cli" ? (
            <div className="mt-3.5 rounded-md border border-[#252b37] bg-[#131720] p-3 font-mono text-[11px] text-[#a2acc0]">
              {activeAccount.cliAvailable ? (
                <span className="text-[#8dd99b]">
                  Local `{activeAccount.provider === "google" ? "gemini" : "claude"}` CLI is installed and ready.
                </span>
              ) : (
                <span className="text-[#e5af6d]">
                  Local `{activeAccount.provider === "google" ? "gemini" : "claude"}` binary was not detected in PATH.
                </span>
              )}
            </div>
          ) : null}

          {feedback ? (
            <div
              role={feedback.tone === "error" ? "alert" : "status"}
              className={clsx(
                "mt-3.5 rounded-md border px-3 py-2 text-[11.5px]",
                feedback.tone === "success"
                  ? "border-[#2f5b38] bg-[#132317] text-[#9ce2a9]"
                  : feedback.tone === "error"
                    ? "border-[#6b3132] bg-[#211315] text-[#f29e9c]"
                    : "border-[#2b3445] bg-[#151a24] text-[#c0cadb]",
              )}
            >
              {feedback.text}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#1f242e] pt-3">
            <span className="inline-flex items-center gap-1.5 text-[10.5px] text-[#848ea0]">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Encrypted locally in .data/vault.enc (AES-256-GCM)
            </span>

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSaveAndVerify()}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#448050] bg-[#1d3623] px-4 py-1.5 text-[11.5px] font-semibold text-[#e6f9ea] transition-colors hover:bg-[#25452c] disabled:opacity-45"
            >
              {busy ? "Verifying..." : "Save & Verify Live"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Global ARW Routing Policy bar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#232834] bg-[#11141a] px-3.5 py-2.5">
        <div>
          <div className="text-[11.5px] font-semibold text-[#dce2ec]">
            ARW Auto-Routing Policy
          </div>
          <p className="text-[10.5px] text-[#8d97aa]">
            Controls how Auto-Routed jobs pick across all {accounts.length}{" "}
            configured connectors.
          </p>
        </div>
        <select
          aria-label="ARW Routing Policy"
          disabled={policyBusy}
          value={routingPolicy}
          onChange={async (e) => {
            setPolicyBusy(true);
            try {
              await onChangeRoutingPolicy(e.target.value as RoutingPolicy);
            } finally {
              setPolicyBusy(false);
            }
          }}
          className="rounded-md border border-[#2a3140] bg-[#171b23] px-2.5 py-1.5 font-mono text-[11px] text-[#eef2f8] disabled:opacity-50"
        >
          <option value="auto_balance">Auto-Balance (Quota + Latency)</option>
          <option value="priority_order">Priority Order (#1 -&gt; #2 -&gt; ...)</option>
          <option value="google_first">Google-First</option>
          <option value="claude_first">Claude-First</option>
          <option value="lowest_latency">Lowest Measured Latency</option>
        </select>
      </div>
    </ModalShell>
  );
}
