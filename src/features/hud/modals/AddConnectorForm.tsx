"use client";

import clsx from "clsx";
import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { ProviderGlyph } from "@/components/ProviderGlyph";
import { CONNECTOR_PRESETS, getConnectorPreset } from "@/domain/connectors";
import type { AccountPublicState, AuthMode } from "@/domain/types";

export interface AccountsFeedback {
  tone: "success" | "error" | "info";
  text: string;
}

interface AddConnectorFormProps {
  existingCount: number;
  /** Omitted when there are no accounts yet (the form is the only thing to show). */
  onCancel?: () => void;
  onRefreshSnapshot: () => Promise<void>;
  onCreated: (account: AccountPublicState, message: AccountsFeedback) => void;
}

/** "Add New Account Connector" form, split out of AccountsModal. Owns its own draft state. */
export function AddConnectorForm({
  existingCount,
  onCancel,
  onRefreshSnapshot,
  onCreated,
}: AddConnectorFormProps) {
  const modelListId = useId();
  const [selectedPresetId, setSelectedPresetId] = useState("openai");
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("https://api.openai.com/v1");
  const [newModel, setNewModel] = useState("gpt-4.1");
  const [newAuthMode, setNewAuthMode] = useState<AuthMode>("api_key");
  const [newApiKey, setNewApiKey] = useState("");
  const [newTags, setNewTags] = useState("openai");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyPresetToNewForm = (presetId: string): void => {
    const preset = getConnectorPreset(presetId);
    setSelectedPresetId(preset.id);
    setNewName("");
    setNewBaseUrl(preset.defaultBaseUrl ?? "");
    setNewModel(preset.defaultModel);
    setNewAuthMode(preset.defaultAuthMode);
    setNewApiKey("");
    setNewTags(preset.id);
    setError(null);
  };

  const handleCreateAccount = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const preset = getConnectorPreset(selectedPresetId);
    setBusy(true);
    setError(null);
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
        setError(data.error ?? "Failed to create account.");
        return;
      }

      setNewApiKey("");
      await onRefreshSnapshot();
      onCreated(data.account, {
        tone: data.probe && !data.probe.ok ? "info" : "success",
        text: data.probe?.ok
          ? `Added ${data.account.name} & verified live in ${data.probe.latencyMs}ms.`
          : data.probe?.error
            ? `Added ${data.account.name}, but live probe failed: ${data.probe.error}`
            : `Added ${data.account.name}. Add credentials or sign in via SSO below.`,
      });
    } catch {
      setError("Network error creating account connector.");
    } finally {
      setBusy(false);
    }
  };

  const newPreset = getConnectorPreset(selectedPresetId);

  return (
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
              placeholder={`#${existingCount + 1} ${newPreset.label}`}
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

        {error ? (
          <div
            role="alert"
            className="mt-3 rounded-md border border-[#6b3132] bg-[#211315] px-3 py-2 text-[11.5px] text-[#f29e9c]"
          >
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-[#1f242e] pt-3">
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
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
  );
}
