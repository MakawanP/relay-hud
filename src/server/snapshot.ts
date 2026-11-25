import type { HudSnapshot, SsoPublicConfig } from "@/domain/types";
import { getRemotePasscode } from "./auth";
import { collectHostTelemetry } from "./host-telemetry";
import { getHudStore } from "./store";
import { getVault } from "./vault";

export function buildPublicSsoConfig(origin: string): SsoPublicConfig {
  const vault = getVault();
  const sso = vault.getSsoConfig();
  const cleanOrigin = origin.replace(/\/$/, "");

  return {
    googleAppConfigured: Boolean(sso.googleClientId && sso.googleClientSecret),
    googleAppLoginEnabled: sso.googleAppLoginEnabled,
    oidcConfigured: Boolean(
      sso.oidcIssuer && sso.oidcClientId && sso.oidcClientSecret,
    ),
    oidcAppLoginEnabled: sso.oidcAppLoginEnabled,
    oidcLabel: sso.oidcLabel,
    oidcIssuer: sso.oidcIssuer,
    oidcScopes: sso.oidcScopes,
    allowedEmails: sso.allowedEmails,
    allowedDomains: sso.allowedDomains,
    passcodeEnabled: Boolean(getRemotePasscode()),
    googleAccountRedirectUri: `${cleanOrigin}/api/oauth/google/callback`,
    googleSsoRedirectUri: `${cleanOrigin}/api/auth/sso/google/callback`,
    oidcSsoRedirectUri: `${cleanOrigin}/api/auth/sso/oidc/callback`,
    oidcAccountRedirectUri: `${cleanOrigin}/api/oauth/oidc/callback`,
  };
}

export async function buildHudSnapshot(origin: string): Promise<HudSnapshot> {
  const store = getHudStore();
  const liveJobs = store.listJobs();
  const activeCount = liveJobs.filter((j) => j.status === "working").length;
  const host = await collectHostTelemetry(activeCount);
  const ssoConfig = buildPublicSsoConfig(origin);

  return {
    routingPolicy: store.getRoutingPolicy(),
    host,
    accounts: store.toPublicAccounts(host.cliTools),
    chats: store.listChats(),
    jobs: liveJobs,
    alerts: store.listAlerts(),
    oauthConfig: {
      googleConfigured: ssoConfig.googleAppConfigured,
      redirectUri: ssoConfig.googleAccountRedirectUri,
    },
    ssoConfig,
    updatedAt: new Date().toISOString(),
  };
}
