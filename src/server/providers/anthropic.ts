import { spawn } from "node:child_process";
import { CLAUDE_MODEL_PATTERN } from "@/domain/models";
import type { AuthMode, RateLimitSnapshot } from "@/domain/types";
import {
  ProviderRequestError,
  buildSanitizedCliEnv,
  type ProviderProbeResult,
  type ProviderStreamCallbacks,
  type ProviderStreamResult,
} from "./google";

const PREFERRED_CLAUDE_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5",
  "claude-sonnet-4-5",
];

export interface AnthropicStreamResult extends ProviderStreamResult {
  rateLimits?: RateLimitSnapshot;
}

function parseOptionalIntHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

export function parseAnthropicRateLimitHeaders(
  headers: Headers,
): RateLimitSnapshot | undefined {
  const reqLimit = parseOptionalIntHeader(
    headers,
    "anthropic-ratelimit-requests-limit",
  );
  const reqRemaining = parseOptionalIntHeader(
    headers,
    "anthropic-ratelimit-requests-remaining",
  );
  const tokLimit = parseOptionalIntHeader(
    headers,
    "anthropic-ratelimit-tokens-limit",
  );
  const tokRemaining = parseOptionalIntHeader(
    headers,
    "anthropic-ratelimit-tokens-remaining",
  );

  // Only treat response as live header telemetry when at least one limit header is actually present.
  if (reqLimit === null && tokLimit === null) {
    return undefined;
  }

  const effectiveReqLimit = reqLimit !== null && reqLimit > 0 ? reqLimit : 50;
  const effectiveTokLimit =
    tokLimit !== null && tokLimit > 0 ? tokLimit : 400_000;

  return {
    requestsLimit: effectiveReqLimit,
    requestsRemaining:
      reqRemaining !== null
        ? Math.min(effectiveReqLimit, reqRemaining)
        : effectiveReqLimit,
    requestsResetAt: headers.get("anthropic-ratelimit-requests-reset"),
    tokensLimit: effectiveTokLimit,
    tokensRemaining:
      tokRemaining !== null
        ? Math.min(effectiveTokLimit, tokRemaining)
        : effectiveTokLimit,
    tokensResetAt: headers.get("anthropic-ratelimit-tokens-reset"),
    source: "live_headers",
  };
}

interface AnthropicSseEvent {
  type?: string;
  delta?: {
    type?: string;
    text?: string;
  };
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  usage?: {
    output_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

export function parseAnthropicSseLine(line: string): {
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
    const evt = JSON.parse(rawJson) as AnthropicSseEvent;
    if (evt.type === "content_block_delta" && evt.delta?.text) {
      return { textDelta: evt.delta.text };
    }
    if (evt.type === "message_start" && evt.message?.usage) {
      return {
        textDelta: "",
        inputTokens: evt.message.usage.input_tokens,
        outputTokens: evt.message.usage.output_tokens,
      };
    }
    if (evt.type === "message_delta" && evt.usage) {
      return {
        textDelta: "",
        outputTokens: evt.usage.output_tokens,
      };
    }
    if (evt.type === "error" && evt.error?.message) {
      return { textDelta: "", errorMessage: evt.error.message };
    }
    return null;
  } catch {
    return null;
  }
}

export async function probeAnthropicAccount(params: {
  authMode: AuthMode;
  apiKey?: string;
  cliAvailable: boolean;
}): Promise<ProviderProbeResult & { rateLimits?: RateLimitSnapshot }> {
  const start = Date.now();

  if (params.authMode === "cli") {
    return {
      ok: params.cliAvailable,
      latencyMs: Date.now() - start,
      models: [...PREFERRED_CLAUDE_MODELS],
      error: params.cliAvailable
        ? undefined
        : "Local `claude` CLI binary was not found in PATH. Install Claude Code CLI or switch to API Key mode.",
    };
  }

  if (!params.apiKey) {
    return {
      ok: false,
      latencyMs: 0,
      models: [...PREFERRED_CLAUDE_MODELS],
      error: "No Anthropic API key saved for Claude #1.",
    };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - start;
    const rateLimits = parseAnthropicRateLimitHeaders(res.headers);

    if (!res.ok) {
      let msg = `Anthropic API returned HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body.error?.message) {
          msg = body.error.message;
        }
      } catch {
        // Keep HTTP status fallback.
      }
      return {
        ok: false,
        latencyMs,
        models: [...PREFERRED_CLAUDE_MODELS],
        rateLimited: res.status === 429,
        rateLimits,
        error: msg,
      };
    }

    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    const discovered = (body.data ?? [])
      .map((item) => item.id ?? "")
      .filter((id) => CLAUDE_MODEL_PATTERN.test(id));

    const merged = new Set<string>();
    for (const model of PREFERRED_CLAUDE_MODELS) {
      if (discovered.includes(model)) merged.add(model);
    }
    for (const model of discovered) {
      if (merged.size >= 8) break;
      merged.add(model);
    }

    return {
      ok: true,
      latencyMs,
      models: merged.size > 0 ? Array.from(merged) : [...PREFERRED_CLAUDE_MODELS],
      rateLimits,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      models: [...PREFERRED_CLAUDE_MODELS],
      error:
        err instanceof Error
          ? `Network check failed: ${err.message}`
          : "Unable to reach Anthropic API.",
    };
  }
}

async function runClaudeCliJob(
  prompt: string,
  model: string,
  signal: AbortSignal,
  callbacks: ProviderStreamCallbacks,
): Promise<AnthropicStreamResult> {
  if (signal.aborted) {
    throw new ProviderRequestError("Job stopped before process launch.", 499);
  }
  if (!CLAUDE_MODEL_PATTERN.test(model)) {
    throw new ProviderRequestError(`Invalid Claude model identifier: ${model}`, 400);
  }

  const start = Date.now();
  return new Promise<AnthropicStreamResult>((resolve, reject) => {
    // Pass prompt over stdin (`-p` reads stdin) so leading '-' prompts cannot inject flags.
    const child = spawn("claude", ["-p", "--model", model], {
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
      // Ignore EPIPE if child exits before reading stdin.
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
      reject(new ProviderRequestError(`claude CLI error: ${err.message}`, 500));
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
            stderrText.trim() || `claude CLI exited with code ${String(code)}`,
            500,
          ),
        );
        return;
      }
      resolve({
        outputText,
        inputTokens: Math.max(12, Math.round(prompt.length / 4)),
        outputTokens: Math.max(8, Math.round(outputText.length / 4)),
        latencyMs: Date.now() - start,
      });
    });
  });
}

export async function streamAnthropicJob(params: {
  authMode: AuthMode;
  apiKey?: string;
  model: string;
  prompt: string;
  signal: AbortSignal;
  callbacks: ProviderStreamCallbacks;
}): Promise<AnthropicStreamResult> {
  if (!CLAUDE_MODEL_PATTERN.test(params.model)) {
    throw new ProviderRequestError(`Invalid Claude model: ${params.model}`, 400);
  }
  if (params.authMode === "cli") {
    params.callbacks.onLog("info", `Spawning local claude -p (${params.model})...`);
    return runClaudeCliJob(
      params.prompt,
      params.model,
      params.signal,
      params.callbacks,
    );
  }

  if (!params.apiKey) {
    throw new ProviderRequestError("Missing Anthropic API key.", 401);
  }

  const start = Date.now();
  params.callbacks.onLog(
    "info",
    `POST api.anthropic.com/v1/messages (${params.model}, stream=true)`,
  );

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 2048,
      stream: true,
      messages: [{ role: "user", content: params.prompt }],
    }),
    signal: params.signal,
  });

  const rateLimits = parseAnthropicRateLimitHeaders(res.headers);

  if (!res.ok) {
    let detail = `Anthropic API returned HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as { error?: { message?: string } };
      if (errBody.error?.message) {
        detail = errBody.error.message;
      }
    } catch {
      // Preserve HTTP status fallback.
    }
    throw new ProviderRequestError(detail, res.status, res.status === 429);
  }

  const ttftMs = Date.now() - start;
  params.callbacks.onLog("info", `Anthropic stream active (${ttftMs}ms TTFT)`);

  if (!res.body) {
    throw new ProviderRequestError("Anthropic response stream was empty.", 502);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputText = "";
  let inputTokens = Math.max(10, Math.round(params.prompt.length / 4));
  let outputTokens = 0;

  const processLine = (line: string): void => {
    const parsed = parseAnthropicSseLine(line);
    if (!parsed) return;
    if (parsed.errorMessage) {
      throw new ProviderRequestError(parsed.errorMessage, 500);
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
    rateLimits,
  };
}
