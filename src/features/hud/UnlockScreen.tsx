"use client";

import { Eye, EyeOff, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

const SSO_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "SSO sign-in was cancelled.",
  invalid_state: "SSO session state mismatch — please try signing in again.",
  google_not_enabled: "Google SSO is not enabled on this RelayHUD instance.",
  oidc_not_enabled: "Enterprise OIDC SSO is not enabled on this RelayHUD instance.",
  oidc_discovery_failed: "Unable to reach the configured OIDC discovery endpoint.",
  token_exchange_failed: "Identity provider token exchange failed — verify client credentials and redirect URI.",
  invalid_id_token: "Identity provider returned an invalid ID token.",
  not_allowed: "Your signed-in email is not in the RelayHUD SSO allowlist.",
};

interface UnlockScreenProps {
  host: string;
  passcodeEnabled: boolean;
  googleSsoEnabled: boolean;
  oidcSsoEnabled: boolean;
  oidcLabel: string;
}

export function UnlockScreen({
  host,
  passcodeEnabled,
  googleSsoEnabled,
  oidcSsoEnabled,
  oidcLabel,
}: UnlockScreenProps) {
  const [passcode, setPasscode] = useState("");
  const [showPasscode, setShowPasscode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoErr = params.get("sso_error");
    if (ssoErr) {
      setError(
        SSO_ERROR_MESSAGES[ssoErr] ??
          "SSO sign-in could not be completed. Please try again.",
      );
      window.history.replaceState({}, "", "/");
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!passcode.trim()) {
      setError("Enter your tunnel passcode.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: passcode.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        unlocked?: boolean;
        error?: string;
      };
      if (!res.ok || !data.unlocked) {
        setError(data.error ?? "Invalid passcode.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Network error contacting RelayHUD.");
    } finally {
      setBusy(false);
    }
  };

  const hasAnySso = googleSsoEnabled || oidcSsoEnabled;

  return (
    <main className="flex min-h-[100dvh] w-full items-center justify-center bg-[#101115] p-4 text-[#e6eaf0]">
      <div className="w-full max-w-sm rounded-xl border border-[#262c38] bg-[#14171d] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.65)]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#2d4f34] bg-[#142318]">
            <Lock className="h-4 w-4 text-[#8dd99b]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold text-white">
              RelayHUD Protected Tunnel
            </h1>
            <p className="truncate font-mono text-[10.5px] text-[#8d97aa]">
              {host}
            </p>
          </div>
        </div>

        <p className="mt-4 text-[12px] leading-relaxed text-[#a2acc0]">
          Authenticate to unlock your local Mac HUD and manage your connected AI
          account pool.
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[#6b3132] bg-[#211315] px-3 py-2 text-[11.5px] text-[#f29e9c]"
          >
            {error}
          </div>
        ) : null}

        {hasAnySso ? (
          <div className="mt-4 space-y-2.5">
            {googleSsoEnabled ? (
              <a
                href="/api/auth/sso/google/start"
                className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-[#325175] bg-[#15202e] px-4 py-2 text-[12.5px] font-semibold text-[#dbeeff] transition-colors hover:border-[#4d94d6] hover:bg-[#1a293b]"
              >
                <ShieldCheck
                  className="h-4 w-4 text-[#85bef2]"
                  aria-hidden="true"
                />
                Continue with Google SSO
              </a>
            ) : null}

            {oidcSsoEnabled ? (
              <a
                href="/api/auth/sso/oidc/start"
                className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-[#375266] bg-[#142029] px-4 py-2 text-[12.5px] font-semibold text-[#d7f1ff] transition-colors hover:border-[#38bdf8] hover:bg-[#192935]"
              >
                <KeyRound
                  className="h-4 w-4 text-[#7dd3fc]"
                  aria-hidden="true"
                />
                Continue with {oidcLabel}
              </a>
            ) : null}
          </div>
        ) : null}

        {hasAnySso && passcodeEnabled ? (
          <div className="my-4 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.08em] text-[#7f899c]">
            <span className="h-[1px] flex-1 bg-[#252b37]" />
            <span>or passcode</span>
            <span className="h-[1px] flex-1 bg-[#252b37]" />
          </div>
        ) : null}

        {passcodeEnabled ? (
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className={hasAnySso ? "space-y-3" : "mt-4 space-y-3"}
          >
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#8d97aa]">
                Remote Passcode
              </span>
              <div className="relative mt-1.5">
                <input
                  type={showPasscode ? "text" : "password"}
                  autoComplete="current-password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus={!hasAnySso}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="Paste passcode..."
                  className="w-full rounded-md border border-[#282e3b] bg-[#0e1014] py-2.5 pr-10 pl-3 font-mono text-[13px] text-white placeholder:text-[#7f899c] focus:border-[#56b868]"
                />
                <button
                  type="button"
                  aria-label={showPasscode ? "Hide passcode" : "Show passcode"}
                  onClick={() => setShowPasscode((prev) => !prev)}
                  className="absolute inset-y-0 right-1 flex w-8 items-center justify-center rounded text-[#8d97aa] hover:text-white"
                >
                  {showPasscode ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-[#448050] bg-[#1d3623] px-4 py-2 text-[12.5px] font-semibold text-[#e6f9ea] transition-colors hover:bg-[#25452c] disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              {busy ? "Verifying..." : "Unlock RelayHUD"}
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
