"use client";

import clsx from "clsx";
import { CheckCircle2, Copy, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { ModalShell } from "@/components/ModalShell";
import type { SsoPublicConfig } from "@/domain/types";

interface SsoSettingsModalProps {
  open: boolean;
  ssoConfig: SsoPublicConfig;
  onClose: () => void;
  onRefreshSnapshot: () => Promise<void>;
}

export function SsoSettingsModal({
  open,
  ssoConfig,
  onClose,
  onRefreshSnapshot,
}: SsoSettingsModalProps) {
  const [allowedEmailsText, setAllowedEmailsText] = useState("");
  const [allowedDomainsText, setAllowedDomainsText] = useState("");
  const [googleAppLoginEnabled, setGoogleAppLoginEnabled] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");

  const [oidcAppLoginEnabled, setOidcAppLoginEnabled] = useState(false);
  const [oidcLabel, setOidcLabel] = useState("Enterprise OIDC");
  const [oidcIssuer, setOidcIssuer] = useState("");
  const [oidcClientId, setOidcClientId] = useState("");
  const [oidcClientSecret, setOidcClientSecret] = useState("");
  const [oidcScopes, setOidcScopes] = useState("openid email profile");

  const [busy, setBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setAllowedEmailsText(ssoConfig.allowedEmails.join(", "));
    setAllowedDomainsText(ssoConfig.allowedDomains.join(", "));
    setGoogleAppLoginEnabled(ssoConfig.googleAppLoginEnabled);
    setOidcAppLoginEnabled(ssoConfig.oidcAppLoginEnabled);
    setOidcLabel(ssoConfig.oidcLabel || "Enterprise OIDC");
    setOidcIssuer(ssoConfig.oidcIssuer ?? "");
    setOidcScopes(ssoConfig.oidcScopes || "openid email profile");
    setGoogleClientId("");
    setGoogleClientSecret("");
    setOidcClientId("");
    setOidcClientSecret("");
    setFeedback(null);
  }, [open, ssoConfig]);

  const copyText = async (key: string, value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      setFeedback({
        tone: "error",
        text: "Clipboard access denied — copy the redirect URI manually.",
      });
    }
  };

  const handleSaveGoogleClient = async (): Promise<void> => {
    if (!googleClientId.trim() || !googleClientSecret.trim()) {
      setFeedback({
        tone: "error",
        text: "Enter both Google OAuth Client ID and Client Secret.",
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/oauth/google/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: googleClientId.trim(),
          clientSecret: googleClientSecret.trim(),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback({
          tone: "error",
          text: data.error ?? "Failed to save Google OAuth app credentials.",
        });
        return;
      }
      setGoogleClientId("");
      setGoogleClientSecret("");
      await onRefreshSnapshot();
      setFeedback({
        tone: "success",
        text: "Google OAuth app credentials encrypted locally. Works for both Google SSO Unlock and unlimited Google accounts.",
      });
    } catch {
      setFeedback({
        tone: "error",
        text: "Network error saving Google OAuth credentials.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSso = async (testDiscovery: boolean): Promise<void> => {
    setBusy(true);
    setFeedback(null);
    try {
      const allowedEmails = allowedEmailsText
        .split(/[\n,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const allowedDomains = allowedDomainsText
        .split(/[\n,]+/)
        .map((s) => s.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean);

      const payload: Record<string, unknown> = {
        googleAppLoginEnabled,
        oidcAppLoginEnabled,
        oidcLabel: oidcLabel.trim() || "Enterprise OIDC",
        oidcIssuer: oidcIssuer.trim(),
        oidcScopes: oidcScopes.trim() || "openid email profile",
        allowedEmails,
        allowedDomains,
        testDiscovery,
      };
      if (oidcClientId.trim()) {
        payload.oidcClientId = oidcClientId.trim();
      }
      if (oidcClientSecret.trim()) {
        payload.oidcClientSecret = oidcClientSecret.trim();
      }

      const res = await fetch("/api/auth/sso/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: string;
        discovery?: { ok: boolean; error: string | null } | null;
      };
      if (!res.ok) {
        setFeedback({
          tone: "error",
          text: data.error ?? "Failed to save SSO settings.",
        });
        return;
      }
      setOidcClientId("");
      setOidcClientSecret("");
      await onRefreshSnapshot();

      if (data.discovery && !data.discovery.ok) {
        setFeedback({
          tone: "error",
          text: `Settings saved, but OIDC discovery failed: ${data.discovery.error ?? "Check issuer URL."}`,
        });
      } else if (data.discovery?.ok) {
        setFeedback({
          tone: "success",
          text: "SSO configuration saved and OIDC discovery verified (.well-known/openid-configuration).",
        });
      } else {
        setFeedback({
          tone: "success",
          text: "SSO settings encrypted locally in .data/vault.enc.",
        });
      }
    } catch {
      setFeedback({
        tone: "error",
        text: "Network error saving SSO configuration.",
      });
    } finally {
      setBusy(false);
    }
  };

  const hasAllowlist =
    allowedEmailsText.trim().length > 0 || allowedDomainsText.trim().length > 0;

  return (
    <ModalShell
      open={open}
      title="SSO & Identity Providers (Google + Enterprise OIDC)"
      subtitle="Unlock RelayHUD remotely with Google Sign-In or OIDC (Okta, Entra ID, Auth0, Keycloak) and reuse OAuth/OIDC for unlimited AI accounts."
      maxWidthClass="max-w-3xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* Identity Allowlist */}
        <section className="rounded-lg border border-[#242a36] bg-[#101318] p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-[12.5px] font-semibold text-white">
                1. Fail-Closed Identity Allowlist (Required for App Unlock SSO)
              </h3>
              <p className="mt-0.5 text-[11px] text-[#8d97aa]">
                Only users matching at least one email or domain below can unlock
                your Mac HUD via SSO.
              </p>
            </div>
            <span
              className={clsx(
                "rounded border px-2 py-0.5 font-mono text-[9.5px]",
                hasAllowlist
                  ? "border-[#2f5b38] bg-[#132317] text-[#9ce2a9]"
                  : "border-[#6e4e2a] bg-[#241b11] text-[#e5af6d]",
              )}
            >
              {hasAllowlist ? "ALLOWLIST SET" : "REQUIRED"}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                Allowed Emails (comma-separated)
              </span>
              <input
                type="text"
                value={allowedEmailsText}
                onChange={(e) => setAllowedEmailsText(e.target.value)}
                placeholder="you@gmail.com, work@company.com"
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11.5px] text-white placeholder:text-[#7f899c] focus:border-[#56b868]"
              />
            </label>
            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                Allowed Email Domains (optional)
              </span>
              <input
                type="text"
                value={allowedDomainsText}
                onChange={(e) => setAllowedDomainsText(e.target.value)}
                placeholder="company.com"
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11.5px] text-white placeholder:text-[#7f899c] focus:border-[#56b868]"
              />
            </label>
          </div>
        </section>

        {/* Google SSO + OAuth */}
        <section className="rounded-lg border border-[#242a36] bg-[#101318] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck
                className="h-4 w-4 text-[#85bef2]"
                aria-hidden="true"
              />
              <div>
                <h3 className="text-[12.5px] font-semibold text-white">
                  2. Google Sign-In SSO & Unlimited Google Account OAuth
                </h3>
                <p className="text-[10.5px] text-[#8d97aa]">
                  {ssoConfig.googleAppConfigured
                    ? "Google OAuth Client credentials are stored in your encrypted vault."
                    : "Add your Google Cloud OAuth 2.0 Client ID & Secret once."}
                </p>
              </div>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-medium text-[#dce2ec]">
              <input
                type="checkbox"
                checked={googleAppLoginEnabled}
                onChange={(e) => setGoogleAppLoginEnabled(e.target.checked)}
                className="h-4 w-4 accent-[#56b868]"
              />
              Enable Google SSO Unlock
            </label>
          </div>

          <div className="mt-3 space-y-1.5">
            <CopyableUriRow
              label="App Unlock Callback"
              uri={ssoConfig.googleSsoRedirectUri}
              copied={copiedKey === "google-sso"}
              onCopy={() => void copyText("google-sso", ssoConfig.googleSsoRedirectUri)}
            />
            <CopyableUriRow
              label="Account OAuth Callback"
              uri={ssoConfig.googleAccountRedirectUri}
              copied={copiedKey === "google-acct"}
              onCopy={() =>
                void copyText("google-acct", ssoConfig.googleAccountRedirectUri)
              }
            />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                Google Client ID
              </span>
              <input
                type="text"
                value={googleClientId}
                onChange={(e) => setGoogleClientId(e.target.value)}
                placeholder={
                  ssoConfig.googleAppConfigured
                    ? "Configured (leave blank to keep)"
                    : "*.apps.googleusercontent.com"
                }
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11px] text-white placeholder:text-[#7f899c] focus:border-[#56b868]"
              />
            </label>
            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                Google Client Secret
              </span>
              <input
                type="password"
                autoComplete="off"
                value={googleClientSecret}
                onChange={(e) => setGoogleClientSecret(e.target.value)}
                placeholder={
                  ssoConfig.googleAppConfigured
                    ? "Stored in vault (leave blank to keep)"
                    : "GOCSPX-..."
                }
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11px] text-white placeholder:text-[#7f899c] focus:border-[#56b868]"
              />
            </label>
            <button
              type="button"
              disabled={
                busy || !googleClientId.trim() || !googleClientSecret.trim()
              }
              onClick={() => void handleSaveGoogleClient()}
              className="min-h-8 rounded-md border border-[#325175] bg-[#15202e] px-3 py-1.5 text-[11px] font-medium text-[#cfe6ff] hover:bg-[#1a293b] disabled:opacity-40"
            >
              Save Google Keys
            </button>
          </div>
        </section>

        {/* Generic Enterprise OIDC */}
        <section className="rounded-lg border border-[#242a36] bg-[#101318] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#7dd3fc]" aria-hidden="true" />
              <div>
                <h3 className="text-[12.5px] font-semibold text-white">
                  3. Generic OIDC / Enterprise SSO (Okta, Entra ID, Auth0, Keycloak)
                </h3>
                <p className="text-[10.5px] text-[#8d97aa]">
                  Uses OIDC Discovery + PKCE S256 for both HUD Unlock and OIDC
                  Bearer AI Gateways.
                </p>
              </div>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-medium text-[#dce2ec]">
              <input
                type="checkbox"
                checked={oidcAppLoginEnabled}
                onChange={(e) => setOidcAppLoginEnabled(e.target.checked)}
                className="h-4 w-4 accent-[#56b868]"
              />
              Enable OIDC SSO Unlock
            </label>
          </div>

          <div className="mt-3 space-y-1.5">
            <CopyableUriRow
              label="OIDC Unlock Callback"
              uri={ssoConfig.oidcSsoRedirectUri}
              copied={copiedKey === "oidc-sso"}
              onCopy={() => void copyText("oidc-sso", ssoConfig.oidcSsoRedirectUri)}
            />
            <CopyableUriRow
              label="Gateway Account Callback"
              uri={ssoConfig.oidcAccountRedirectUri}
              copied={copiedKey === "oidc-acct"}
              onCopy={() =>
                void copyText("oidc-acct", ssoConfig.oidcAccountRedirectUri)
              }
            />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                OIDC Issuer Discovery URL
              </span>
              <input
                type="url"
                value={oidcIssuer}
                onChange={(e) => setOidcIssuer(e.target.value)}
                placeholder="https://dev-xxxx.us.auth0.com"
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11px] text-white placeholder:text-[#7f899c] focus:border-[#56b868]"
              />
            </label>
            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                Provider Button Label
              </span>
              <input
                type="text"
                value={oidcLabel}
                onChange={(e) => setOidcLabel(e.target.value)}
                placeholder="Okta / Auth0 / Entra ID"
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 text-[11.5px] text-white placeholder:text-[#7f899c] focus:border-[#56b868]"
              />
            </label>
            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                OIDC Client ID
              </span>
              <input
                type="text"
                value={oidcClientId}
                onChange={(e) => setOidcClientId(e.target.value)}
                placeholder={
                  ssoConfig.oidcConfigured
                    ? "Configured (leave blank to keep)"
                    : "Client ID"
                }
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11px] text-white placeholder:text-[#7f899c] focus:border-[#56b868]"
              />
            </label>
            <label className="block">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                OIDC Client Secret
              </span>
              <input
                type="password"
                autoComplete="off"
                value={oidcClientSecret}
                onChange={(e) => setOidcClientSecret(e.target.value)}
                placeholder={
                  ssoConfig.oidcConfigured
                    ? "Stored in vault (leave blank to keep)"
                    : "Client Secret"
                }
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11px] text-white placeholder:text-[#7f899c] focus:border-[#56b868]"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="font-mono text-[10px] text-[#96a0b3]">
                Scopes
              </span>
              <input
                type="text"
                value={oidcScopes}
                onChange={(e) => setOidcScopes(e.target.value)}
                placeholder="openid email profile offline_access"
                className="mt-1 w-full rounded-md border border-[#282e3b] bg-[#14171d] px-2.5 py-1.5 font-mono text-[11px] text-white placeholder:text-[#7f899c] focus:border-[#56b868]"
              />
            </label>
          </div>
        </section>

        {feedback ? (
          <div
            role={feedback.tone === "error" ? "alert" : "status"}
            className={clsx(
              "rounded-md border px-3 py-2 text-[11.5px]",
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

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1f242e] pt-3">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] text-[#848ea0]">
            <Lock className="h-3 w-3" aria-hidden="true" />
            {ssoConfig.googleAppLoginEnabled || ssoConfig.oidcAppLoginEnabled ? (
              <span className="inline-flex items-center gap-1 text-[#8dd99b]">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                SSO Active on Unlock Screen
              </span>
            ) : (
              "Passcode fallback remains active when set"
            )}
          </span>

          <div className="flex flex-wrap items-center gap-2">
            {oidcIssuer.trim() ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSaveSso(true)}
                className="min-h-8 rounded-md border border-[#325175] bg-[#15202e] px-3 py-1.5 text-[11.5px] font-medium text-[#cfe6ff] hover:bg-[#1a293b] disabled:opacity-45"
              >
                {busy ? "Testing..." : "Save & Test OIDC Discovery"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSaveSso(false)}
              className="min-h-8 rounded-md border border-[#448050] bg-[#1d3623] px-4 py-1.5 text-[11.5px] font-semibold text-[#e6f9ea] hover:bg-[#25452c] disabled:opacity-45"
            >
              {busy ? "Saving..." : "Save SSO Settings"}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function CopyableUriRow({
  label,
  uri,
  copied,
  onCopy,
}: {
  label: string;
  uri: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-[#232a36] bg-[#0d1015] px-2.5 py-1.5 font-mono text-[10px] text-[#a6b1c4]">
      <span className="truncate">
        <span className="text-[#7f899c]">{label}:</span> {uri}
      </span>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex min-h-6 shrink-0 items-center gap-1 text-[#85bef2] hover:underline"
      >
        <Copy className="h-3 w-3" aria-hidden="true" />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
