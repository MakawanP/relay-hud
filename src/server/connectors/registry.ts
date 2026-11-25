import { getConnectorPreset } from "@/domain/connectors";
import type {
  AuthMode,
  ProviderKind,
  RateLimitSnapshot,
} from "@/domain/types";
import { refreshOidcAccessToken } from "../oidc";
import {
  probeAnthropicAccount,
  streamAnthropicJob,
} from "../providers/anthropic";
import {
  probeGoogleAccount,
  refreshGoogleOAuthAccessToken,
  streamGoogleJob,
  type ProviderProbeResult,
  type ProviderStreamCallbacks,
  type ProviderStreamResult,
} from "../providers/google";
import {
  probeOpenAiCompatibleAccount,
  streamOpenAiCompatibleJob,
} from "../providers/openai-compatible";
import type { PersistedAccountMeta } from "../store";
import type { AccountSecretRecord, LocalCredentialVault } from "../vault";

export interface ConnectorProbeOutput extends ProviderProbeResult {
  rateLimits?: RateLimitSnapshot;
}

export interface ConnectorStreamOutput extends ProviderStreamResult {
  rateLimits?: RateLimitSnapshot;
}

export interface ProviderConnector {
  readonly id: ProviderKind;
  readonly displayName: string;
  readonly supportedAuthModes: readonly AuthMode[];
  buildCommandPreview(
    meta: PersistedAccountMeta,
    model: string,
    shortPrompt: string,
  ): string;
  probe(ctx: {
    meta: PersistedAccountMeta;
    secret: AccountSecretRecord;
    vault: LocalCredentialVault;
    cliTools: { claude: boolean; gemini: boolean };
  }): Promise<ConnectorProbeOutput>;
  stream(ctx: {
    meta: PersistedAccountMeta;
    secret: AccountSecretRecord;
    vault: LocalCredentialVault;
    model: string;
    prompt: string;
    signal: AbortSignal;
    callbacks: ProviderStreamCallbacks;
  }): Promise<ConnectorStreamOutput>;
}

async function resolveGoogleAccessToken(
  meta: PersistedAccountMeta,
  secret: AccountSecretRecord,
  vault: LocalCredentialVault,
): Promise<string | undefined> {
  let accessToken = secret.oauthAccessToken;
  if (
    meta.authMode === "oauth" &&
    secret.oauthRefreshToken &&
    (!accessToken ||
      (secret.oauthExpiresAt &&
        new Date(secret.oauthExpiresAt).getTime() <= Date.now() + 60_000))
  ) {
    const oauthApp = vault.getGoogleOAuthApp();
    if (oauthApp.clientId && oauthApp.clientSecret) {
      const refreshed = await refreshGoogleOAuthAccessToken({
        clientId: oauthApp.clientId,
        clientSecret: oauthApp.clientSecret,
        refreshToken: secret.oauthRefreshToken,
      });
      accessToken = refreshed.accessToken;
      vault.setAccountSecret(meta.id, {
        oauthAccessToken: refreshed.accessToken,
        oauthExpiresAt: refreshed.expiresAt,
      });
    }
  }
  return accessToken;
}

async function resolveOidcAccessToken(
  meta: PersistedAccountMeta,
  secret: AccountSecretRecord,
  vault: LocalCredentialVault,
): Promise<string | undefined> {
  let accessToken = secret.oauthAccessToken;
  if (
    meta.authMode === "oauth" &&
    secret.oauthRefreshToken &&
    (!accessToken ||
      (secret.oauthExpiresAt &&
        new Date(secret.oauthExpiresAt).getTime() <= Date.now() + 60_000))
  ) {
    const sso = vault.getSsoConfig();
    if (sso.oidcIssuer && sso.oidcClientId && sso.oidcClientSecret) {
      const refreshed = await refreshOidcAccessToken({
        issuerUrl: sso.oidcIssuer,
        clientId: sso.oidcClientId,
        clientSecret: sso.oidcClientSecret,
        refreshToken: secret.oauthRefreshToken,
      });
      accessToken = refreshed.accessToken;
      vault.setAccountSecret(meta.id, {
        oauthAccessToken: refreshed.accessToken,
        ...(refreshed.refreshToken
          ? { oauthRefreshToken: refreshed.refreshToken }
          : {}),
        oauthExpiresAt: refreshed.expiresAt,
      });
    }
  }
  return accessToken;
}

const googleConnector: ProviderConnector = {
  id: "google",
  displayName: "Google Gemini",
  supportedAuthModes: ["api_key", "oauth", "cli"],
  buildCommandPreview(_meta, model, shortPrompt) {
    return `gemini -m ${model} <<< "${shortPrompt}"`;
  },
  async probe({ meta, secret, vault, cliTools }) {
    let accessToken: string | undefined;
    try {
      accessToken = await resolveGoogleAccessToken(meta, secret, vault);
    } catch (err) {
      return {
        ok: false,
        latencyMs: 0,
        models: meta.availableModels,
        error: err instanceof Error ? err.message : "OAuth token refresh failed.",
      };
    }

    const res = await probeGoogleAccount({
      authMode: meta.authMode,
      apiKey: secret.apiKey,
      oauthAccessToken: accessToken,
      cliAvailable: cliTools.gemini,
    });
    if (res.email) {
      vault.setAccountSecret(meta.id, { oauthEmail: res.email });
    }
    return res;
  },
  async stream({ meta, secret, vault, model, prompt, signal, callbacks }) {
    const accessToken = await resolveGoogleAccessToken(meta, secret, vault);
    return streamGoogleJob({
      authMode: meta.authMode,
      apiKey: secret.apiKey,
      oauthAccessToken: accessToken,
      model,
      prompt,
      signal,
      callbacks,
    });
  },
};

const anthropicConnector: ProviderConnector = {
  id: "anthropic",
  displayName: "Anthropic Claude",
  supportedAuthModes: ["api_key", "cli"],
  buildCommandPreview(_meta, model, shortPrompt) {
    return `claude -p --model ${model} <<< "${shortPrompt}"`;
  },
  async probe({ meta, secret, cliTools }) {
    return probeAnthropicAccount({
      authMode: meta.authMode,
      apiKey: secret.apiKey,
      cliAvailable: cliTools.claude,
    });
  },
  async stream({ meta, secret, model, prompt, signal, callbacks }) {
    return streamAnthropicJob({
      authMode: meta.authMode,
      apiKey: secret.apiKey,
      model,
      prompt,
      signal,
      callbacks,
    });
  },
};

const openAiCompatibleConnector: ProviderConnector = {
  id: "openai_compatible",
  displayName: "OpenAI-Compatible",
  supportedAuthModes: ["api_key", "oauth", "none"],
  buildCommandPreview(meta, model, shortPrompt) {
    const base =
      meta.baseUrl ||
      getConnectorPreset(meta.presetId ?? "openai").defaultBaseUrl ||
      "https://api.openai.com/v1";
    return `curl ${base}/chat/completions -d '{"model":"${model}","prompt":"${shortPrompt}"}'`;
  },
  async probe({ meta, secret, vault }) {
    const baseUrl =
      meta.baseUrl ||
      getConnectorPreset(meta.presetId ?? "openai").defaultBaseUrl ||
      "https://api.openai.com/v1";
    let accessToken: string | undefined;
    try {
      accessToken = await resolveOidcAccessToken(meta, secret, vault);
    } catch (err) {
      return {
        ok: false,
        latencyMs: 0,
        models: meta.availableModels,
        error: err instanceof Error ? err.message : "OIDC token refresh failed.",
      };
    }

    return probeOpenAiCompatibleAccount({
      baseUrl,
      authMode: meta.authMode,
      apiKey: secret.apiKey,
      oauthAccessToken: accessToken,
      fallbackModels: meta.availableModels,
    });
  },
  async stream({ meta, secret, vault, model, prompt, signal, callbacks }) {
    const baseUrl =
      meta.baseUrl ||
      getConnectorPreset(meta.presetId ?? "openai").defaultBaseUrl ||
      "https://api.openai.com/v1";
    const accessToken = await resolveOidcAccessToken(meta, secret, vault);
    return streamOpenAiCompatibleJob({
      baseUrl,
      authMode: meta.authMode,
      apiKey: secret.apiKey,
      oauthAccessToken: accessToken,
      model,
      prompt,
      signal,
      callbacks,
    });
  },
};

const CONNECTOR_REGISTRY: Record<ProviderKind, ProviderConnector> = {
  google: googleConnector,
  anthropic: anthropicConnector,
  openai_compatible: openAiCompatibleConnector,
};

export function getConnector(provider: ProviderKind): ProviderConnector {
  return CONNECTOR_REGISTRY[provider];
}

export function listConnectors(): ProviderConnector[] {
  return Object.values(CONNECTOR_REGISTRY);
}
