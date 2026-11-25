import { spawn } from "node:child_process";
import { GOOGLE_MODEL_PATTERN } from "@/domain/models";
import type { AuthMode } from "@/domain/types";

export interface ProviderProbeResult {
  ok: boolean;
  latencyMs: number;
  models: string[];
  email?: string | null;
  rateLimited?: boolean;
  error?: string;
}

export interface ProviderStreamCallbacks {
  onDelta: (chunk: string) => void;
  onLog: (level: "info" | "warn" | "error" | "success", text: string) => void;
}

export interface ProviderStreamResult {
  outputText: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  rateLimited?: boolean;
  httpStatus?: number;
}

export class ProviderRequestError extends Error {
  readonly httpStatus: number;
  readonly rateLimited: boolean;

  constructor(message: string, httpStatus: number, rateLimited = false) {
    super(message);
    this.name = "ProviderRequestError";
    this.httpStatus = httpStatus;
    this.rateLimited = rateLimited;
  }
}

export function buildSanitizedCliEnv(): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = { ...process.env };
  delete safe.GOOGLE_OAUTH_CLIENT_SECRET;
  delete safe.GOOGLE_OAUTH_CLIENT_ID;
  delete safe.RELAY_HUD_MASTER_KEY;
  return safe;
}

interface GoogleModelListResponse {
  models?: Array<{
    name?: string;
    supportedGenerationMethods?: string[];
  }>;
  error?: { message?: string };
}

interface GoogleSsePayload {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { message?: string; code?: number };
}

export function parseGoogleSseLine(line: string): {
  textDelta: string;
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
  errorCode?: number;
} | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const rawJson = trimmed.slice(5).trim();
  if (!rawJson || rawJson === "[DONE]") return null;

  try {
    const parsed = JSON.parse(rawJson) as GoogleSsePayload;
    if (parsed.error?.message) {
      return {
        textDelta: "",
        errorMessage: parsed.error.message,
        errorCode:
          typeof parsed.error.code === "number" ? parsed.error.code : 500,
      };
    }
    const parts = parsed.candidates?.[0]?.content?.parts ?? [];
    const textDelta = parts.map((p) => p.text ?? "").join("");
    return {
      textDelta,
      inputTokens: parsed.usageMetadata?.promptTokenCount,
      outputTokens: parsed.usageMetadata?.candidatesTokenCount,
    };
  } catch {
    return null;
  }
}

const PREFERRED_GOOGLE_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];

function extractUsableGoogleModels(data: GoogleModelListResponse): string[] {
  const discovered = (data.models ?? [])
    .filter((m) =>
      (m.supportedGenerationMethods ?? []).includes("generateContent"),
    )
    .map((m) => (m.name ?? "").replace(/^models\//, ""))
    .filter((name) => GOOGLE_MODEL_PATTERN.test(name));

  const merged = new Set<string>();
  for (const preferred of PREFERRED_GOOGLE_MODELS) {
    if (discovered.includes(preferred)) {
      merged.add(preferred);
    }
  }
  for (const name of discovered) {
    if (merged.size >= 8) break;
    merged.add(name);
  }
  return merged.size > 0 ? Array.from(merged) : [...PREFERRED_GOOGLE_MODELS];
}

export async function refreshGoogleOAuthAccessToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ accessToken: string; expiresAt: string }> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    refresh_token: params.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new ProviderRequestError(
      `Google OAuth refresh failed (${res.status}): ${errText.slice(0, 180)}`,
      res.status,
    );
  }
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new ProviderRequestError(
      "Google OAuth refresh did not return an access token.",
      500,
    );
  }
  const expiresAt = new Date(
    Date.now() + Math.max(300, (data.expires_in ?? 3600) - 60) * 1000,
  ).toISOString();
  return { accessToken: data.access_token, expiresAt };
}

export async function probeGoogleAccount(params: {
  authMode: AuthMode;
  apiKey?: string;
  oauthAccessToken?: string;
  cliAvailable: boolean;
}): Promise<ProviderProbeResult> {
  const start = Date.now();

  if (params.authMode === "cli") {
    return {
      ok: params.cliAvailable,
      latencyMs: Date.now() - start,
      models: [...PREFERRED_GOOGLE_MODELS],
      error: params.cliAvailable
        ? undefined
        : "Local `gemini` CLI binary was not found in PATH.",
    };
  }

  const headers: Record<string, string> = {};
  if (params.authMode === "api_key") {
    if (!params.apiKey) {
      return {
        ok: false,
        latencyMs: 0,
        models: [...PREFERRED_GOOGLE_MODELS],
        error: "No Gemini API key saved for this Google slot.",
      };
    }
    headers["x-goog-api-key"] = params.apiKey;
  } else {
    if (!params.oauthAccessToken) {
      return {
        ok: false,
        latencyMs: 0,
        models: [...PREFERRED_GOOGLE_MODELS],
        error: "Google OAuth session is not connected yet.",
      };
    }
    headers.Authorization = `Bearer ${params.oauthAccessToken}`;
  }

  try {
    let email: string | null = null;
    if (params.authMode === "oauth" && params.oauthAccessToken) {
      const infoRes = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        {
          headers: { Authorization: `Bearer ${params.oauthAccessToken}` },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (infoRes.ok) {
        const info = (await infoRes.json()) as { email?: string };
        email = info.email ?? null;
      }
    }

    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=40",
      {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10_000),
      },
    );
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      let msg = `Google API returned HTTP ${res.status}`;
      try {
        const errJson = (await res.json()) as GoogleModelListResponse;
        if (errJson.error?.message) {
          msg = errJson.error.message;
        }
      } catch {
        // Keep generic HTTP error when body is non-JSON.
      }
      return {
        ok: false,
        latencyMs,
        models: [...PREFERRED_GOOGLE_MODELS],
        email,
        rateLimited: res.status === 429,
        error: msg,
      };
    }

    const data = (await res.json()) as GoogleModelListResponse;
    return {
      ok: true,
      latencyMs,
      models: extractUsableGoogleModels(data),
      email,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      models: [...PREFERRED_GOOGLE_MODELS],
      error:
        err instanceof Error
          ? `Network check failed: ${err.message}`
          : "Unable to reach Google Gemini API.",
    };
  }
}

async function runGoogleCliJob(
  prompt: string,
  model: string,
  signal: AbortSignal,
  callbacks: ProviderStreamCallbacks,
): Promise<ProviderStreamResult> {
  if (signal.aborted) {
    throw new ProviderRequestError("Job stopped before process launch.", 499);
  }
  if (!GOOGLE_MODEL_PATTERN.test(model)) {
    throw new ProviderRequestError(`Invalid Gemini model identifier: ${model}`, 400);
  }

  const start = Date.now();
  return new Promise<ProviderStreamResult>((resolve, reject) => {
    // Pass prompt over stdin so prompts starting with '-' can never be parsed as CLI flags.
    const child = spawn("gemini", ["-m", model], {
      stdio: ["pipe", "pipe", "pipe"],
      env: buildSanitizedCliEnv(),
    });
    let outputText = "";
    let stderrText = "";
    let killEscalation: NodeJS.Timeout | null = null;

    const cleanupTimers = (): void => {
      if (killEscalation) {
        clearTimeout(killEscalation);
        killEscalation = null;
      }
    };

    const onAbort = (): void => {
      child.kill("SIGTERM");
      killEscalation = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2000);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    child.stdin.on("error", () => {
      // Ignore EPIPE if child exits before consuming stdin.
    });
    child.stdin.end(prompt);

    child.stdout.on("data", (buf: Buffer) => {
      if (signal.aborted) return;
      const chunk = buf.toString("utf8");
      outputText += chunk;
      callbacks.onDelta(chunk);
    });
    child.stderr.on("data", (buf: Buffer) => {
      stderrText += buf.toString("utf8");
    });
    child.on("error", (err) => {
      cleanupTimers();
      signal.removeEventListener("abort", onAbort);
      reject(new ProviderRequestError(`gemini CLI error: ${err.message}`, 500));
    });
    child.on("close", (code) => {
      cleanupTimers();
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        reject(new ProviderRequestError("Job stopped by user.", 499));
        return;
      }
      if (code !== 0) {
        reject(
          new ProviderRequestError(
            stderrText.trim() || `gemini CLI exited with code ${String(code)}`,
            500,
          ),
        );
        return;
      }
      const approxIn = Math.max(12, Math.round(prompt.length / 4));
      const approxOut = Math.max(8, Math.round(outputText.length / 4));
      resolve({
        outputText,
        inputTokens: approxIn,
        outputTokens: approxOut,
        latencyMs: Date.now() - start,
      });
    });
  });
}

export async function streamGoogleJob(params: {
  authMode: AuthMode;
  apiKey?: string;
  oauthAccessToken?: string;
  model: string;
  prompt: string;
  signal: AbortSignal;
  callbacks: ProviderStreamCallbacks;
}): Promise<ProviderStreamResult> {
  if (!GOOGLE_MODEL_PATTERN.test(params.model)) {
    throw new ProviderRequestError(`Invalid Gemini model: ${params.model}`, 400);
  }
  if (params.authMode === "cli") {
    params.callbacks.onLog("info", `Spawning local gemini CLI (${params.model})...`);
    return runGoogleCliJob(
      params.prompt,
      params.model,
      params.signal,
      params.callbacks,
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (params.authMode === "api_key") {
    if (!params.apiKey) {
      throw new ProviderRequestError("Missing Gemini API key.", 401);
    }
    headers["x-goog-api-key"] = params.apiKey;
  } else {
    if (!params.oauthAccessToken) {
      throw new ProviderRequestError("Missing Google OAuth token.", 401);
    }
    headers.Authorization = `Bearer ${params.oauthAccessToken}`;
  }

  const start = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:streamGenerateContent?alt=sse`;
  params.callbacks.onLog(
    "info",
    `POST generativelanguage.googleapis.com/v1beta/models/${params.model}:streamGenerateContent`,
  );

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: params.prompt }] }],
    }),
    signal: params.signal,
  });

  if (!res.ok) {
    let detail = `Google Gemini API returned HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as GoogleSsePayload;
      if (errBody.error?.message) {
        detail = errBody.error.message;
      }
    } catch {
      // Preserve HTTP status detail if body is non-JSON.
    }
    throw new ProviderRequestError(detail, res.status, res.status === 429);
  }

  const ttftMs = Date.now() - start;
  params.callbacks.onLog("info", `Stream connected (${ttftMs}ms TTFT)`);

  if (!res.body) {
    throw new ProviderRequestError("Google Gemini response body was empty.", 502);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputText = "";
  let inputTokens = Math.max(10, Math.round(params.prompt.length / 4));
  let outputTokens = 0;

  const processLine = (line: string): void => {
    const parsed = parseGoogleSseLine(line);
    if (!parsed) return;
    if (parsed.errorMessage) {
      const code = parsed.errorCode ?? 500;
      throw new ProviderRequestError(parsed.errorMessage, code, code === 429);
    }
    if (parsed.textDelta) {
      outputText += parsed.textDelta;
      params.callbacks.onDelta(parsed.textDelta);
    }
    if (typeof parsed.inputTokens === "number") {
      inputTokens = parsed.inputTokens;
    }
    if (typeof parsed.outputTokens === "number") {
      outputTokens = parsed.outputTokens;
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      for (const line of buffer.split("\n")) {
        processLine(line);
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
    latencyMs: ttftMs,
    httpStatus: res.status,
  };
}
