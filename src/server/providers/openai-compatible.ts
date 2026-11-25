import { GENERIC_MODEL_PATTERN } from "@/domain/models";
import type { AuthMode, RateLimitSnapshot } from "@/domain/types";
import { validateProviderBaseUrl } from "../url-guard";
import {
  ProviderRequestError,
  type ProviderProbeResult,
  type ProviderStreamCallbacks,
  type ProviderStreamResult,
} from "./google";

interface OpenAiModelListResponse {
  data?: Array<{ id?: string }>;
  error?: { message?: string };
}

interface OpenAiSseChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: { message?: string };
}

export interface OpenAiCompatibleStreamResult extends ProviderStreamResult {
  rateLimits?: RateLimitSnapshot;
}

function parseOptionalIntHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

export function parseOpenAiRateLimitHeaders(
  headers: Headers,
): RateLimitSnapshot | undefined {
  const reqLimit = parseOptionalIntHeader(headers, "x-ratelimit-limit-requests");
  const reqRemaining = parseOptionalIntHeader(
    headers,
    "x-ratelimit-remaining-requests",
  );
  const tokLimit = parseOptionalIntHeader(headers, "x-ratelimit-limit-tokens");
  const tokRemaining = parseOptionalIntHeader(
    headers,
    "x-ratelimit-remaining-tokens",
  );

  if (reqLimit === null && tokLimit === null) {
    return undefined;
  }

  const effectiveReqLimit = reqLimit !== null && reqLimit > 0 ? reqLimit : 60;
  const effectiveTokLimit =
    tokLimit !== null && tokLimit > 0 ? tokLimit : 500_000;

  return {
    requestsLimit: effectiveReqLimit,
    requestsRemaining:
      reqRemaining !== null
        ? Math.min(effectiveReqLimit, reqRemaining)
        : effectiveReqLimit,
    requestsResetAt: headers.get("x-ratelimit-reset-requests"),
    tokensLimit: effectiveTokLimit,
    tokensRemaining:
      tokRemaining !== null
        ? Math.min(effectiveTokLimit, tokRemaining)
        : effectiveTokLimit,
    tokensResetAt: headers.get("x-ratelimit-reset-tokens"),
    source: "live_headers",
  };
}

export function parseOpenAiSseLine(line: string): {
  textDelta: string;
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
} | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const rawJson = trimmed.slice(5).trim();
  if (!rawJson || rawJson === "[DONE]") return null;

  try {
    const parsed = JSON.parse(rawJson) as OpenAiSseChunk;
    if (parsed.error?.message) {
      return { textDelta: "", errorMessage: parsed.error.message };
    }
    const delta = parsed.choices?.[0]?.delta;
    const textDelta = delta?.content ?? "";
    return {
      textDelta,
      inputTokens: parsed.usage?.prompt_tokens,
      outputTokens: parsed.usage?.completion_tokens,
    };
  } catch {
    return null;
  }
}

function buildAuthHeaders(opts: {
  authMode: AuthMode;
  apiKey?: string;
  oauthAccessToken?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (opts.authMode === "oauth" && opts.oauthAccessToken) {
    headers.Authorization = `Bearer ${opts.oauthAccessToken}`;
  } else if (opts.authMode === "api_key" && opts.apiKey) {
    headers.Authorization = `Bearer ${opts.apiKey}`;
  } else if (opts.apiKey) {
    headers.Authorization = `Bearer ${opts.apiKey}`;
  }
  return headers;
}

export async function probeOpenAiCompatibleAccount(opts: {
  baseUrl: string;
  authMode: AuthMode;
  apiKey?: string;
  oauthAccessToken?: string;
  fallbackModels: string[];
}): Promise<ProviderProbeResult & { rateLimits?: RateLimitSnapshot }> {
  let cleanBase: string;
  try {
    cleanBase = validateProviderBaseUrl(opts.baseUrl);
  } catch (err) {
    return {
      ok: false,
      latencyMs: 0,
      models: opts.fallbackModels,
      error: err instanceof Error ? err.message : "Invalid Base URL.",
    };
  }

  if (opts.authMode === "api_key" && !opts.apiKey) {
    return {
      ok: false,
      latencyMs: 0,
      models: opts.fallbackModels,
      error: "No API key stored for this connector.",
    };
  }
  if (opts.authMode === "oauth" && !opts.oauthAccessToken) {
    return {
      ok: false,
      latencyMs: 0,
      models: opts.fallbackModels,
      error: "Sign in via OIDC SSO to obtain a bearer token for this gateway.",
    };
  }

  const start = Date.now();
  try {
    const res = await fetch(`${cleanBase}/models`, {
      method: "GET",
      headers: {
        ...buildAuthHeaders(opts),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });

    const latencyMs = Date.now() - start;
    const rateLimits = parseOpenAiRateLimitHeaders(res.headers);
    const body = (await res.json().catch(() => ({}))) as OpenAiModelListResponse;

    if (!res.ok) {
      return {
        ok: false,
        latencyMs,
        models: opts.fallbackModels,
        rateLimited: res.status === 429,
        rateLimits,
        error:
          body.error?.message ??
          `Endpoint returned HTTP ${res.status} on GET /models.`,
      };
    }

    const discovered = (body.data ?? [])
      .map((item) => item.id?.trim() ?? "")
      .filter((id) => Boolean(id) && GENERIC_MODEL_PATTERN.test(id))
      .slice(0, 24);

    const models =
      discovered.length > 0
        ? Array.from(new Set([...opts.fallbackModels.filter((m) => discovered.includes(m)), ...discovered]))
        : opts.fallbackModels;

    return {
      ok: true,
      latencyMs,
      models,
      rateLimits,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      models: opts.fallbackModels,
      error:
        err instanceof Error
          ? err.message
          : "Network error contacting OpenAI-compatible endpoint.",
    };
  }
}

export async function streamOpenAiCompatibleJob(opts: {
  baseUrl: string;
  authMode: AuthMode;
  apiKey?: string;
  oauthAccessToken?: string;
  model: string;
  prompt: string;
  signal: AbortSignal;
  callbacks: ProviderStreamCallbacks;
}): Promise<OpenAiCompatibleStreamResult> {
  const cleanBase = validateProviderBaseUrl(opts.baseUrl);
  if (opts.authMode === "api_key" && !opts.apiKey) {
    throw new ProviderRequestError("API key is not configured.", 401);
  }
  if (opts.authMode === "oauth" && !opts.oauthAccessToken) {
    throw new ProviderRequestError("OIDC SSO token is not connected.", 401);
  }

  const start = Date.now();
  opts.callbacks.onLog(
    "info",
    `POST ${cleanBase}/chat/completions (${opts.model})`,
  );

  const res = await fetch(`${cleanBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(opts),
    },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: opts.prompt }],
    }),
    signal: opts.signal,
  });

  const rateLimits = parseOpenAiRateLimitHeaders(res.headers);
  if (!res.ok) {
    const errJson = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new ProviderRequestError(
      errJson.error?.message ?? `Upstream endpoint returned HTTP ${res.status}`,
      res.status,
      res.status === 429,
    );
  }

  if (!res.body) {
    throw new ProviderRequestError("Upstream response body was empty.", 502);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputText = "";
  let inputTokens = Math.max(1, Math.round(opts.prompt.length / 4));
  let outputTokens = 0;
  let firstChunkMs: number | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const parsed = parseOpenAiSseLine(line);
        if (!parsed) continue;
        if (parsed.errorMessage) {
          throw new ProviderRequestError(parsed.errorMessage, 502);
        }
        if (parsed.textDelta) {
          if (firstChunkMs === null) {
            firstChunkMs = Date.now() - start;
          }
          outputText += parsed.textDelta;
          opts.callbacks.onDelta(parsed.textDelta);
        }
        if (typeof parsed.inputTokens === "number") {
          inputTokens = parsed.inputTokens;
        }
        if (typeof parsed.outputTokens === "number") {
          outputTokens = parsed.outputTokens;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (outputTokens === 0 && outputText.length > 0) {
    outputTokens = Math.max(1, Math.round(outputText.length / 4));
  }

  return {
    outputText,
    inputTokens,
    outputTokens,
    latencyMs: firstChunkMs ?? Date.now() - start,
    rateLimits,
  };
}
