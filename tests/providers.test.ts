import { describe, expect, it } from "vitest";
import { estimateUsageMetrics, formatTokenCount } from "@/domain/models";
import {
  parseAnthropicRateLimitHeaders,
  parseAnthropicSseLine,
} from "@/server/providers/anthropic";
import { parseGoogleSseLine } from "@/server/providers/google";
import {
  parseOpenAiRateLimitHeaders,
  parseOpenAiSseLine,
} from "@/server/providers/openai-compatible";

describe("Provider SSE & Header Parsers", () => {
  it("parses Google Gemini SSE chunks and usageMetadata", () => {
    const line =
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello "},{"text":"world"}]}}],"usageMetadata":{"promptTokenCount":120,"candidatesTokenCount":45}}';
    const parsed = parseGoogleSseLine(line);
    expect(parsed).toEqual({
      textDelta: "Hello world",
      inputTokens: 120,
      outputTokens: 45,
    });
    expect(parseGoogleSseLine("data: [DONE]")).toBeNull();
    expect(parseGoogleSseLine("event: ping")).toBeNull();

    // Regression: Gemini mid-stream error payloads must surface errorMessage & code.
    const errLine =
      'data: {"error":{"code":429,"message":"Resource has been exhausted"}}';
    expect(parseGoogleSseLine(errLine)).toEqual({
      textDelta: "",
      errorMessage: "Resource has been exhausted",
      errorCode: 429,
    });
  });

  it("parses Anthropic Claude SSE events cleanly", () => {
    const startLine =
      'data: {"type":"message_start","message":{"usage":{"input_tokens":310,"output_tokens":4}}}';
    expect(parseAnthropicSseLine(startLine)).toEqual({
      textDelta: "",
      inputTokens: 310,
      outputTokens: 4,
    });

    const deltaLine =
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Verified!"}}';
    expect(parseAnthropicSseLine(deltaLine)).toEqual({
      textDelta: "Verified!",
    });

    const endLine =
      'data: {"type":"message_delta","usage":{"output_tokens":88}}';
    expect(parseAnthropicSseLine(endLine)).toEqual({
      textDelta: "",
      outputTokens: 88,
    });

    const errLine =
      'data: {"type":"error","error":{"message":"overloaded_error"}}';
    expect(parseAnthropicSseLine(errLine)).toEqual({
      textDelta: "",
      errorMessage: "overloaded_error",
    });
  });

  it("extracts Anthropic live rate-limit HTTP headers", () => {
    const headers = new Headers({
      "anthropic-ratelimit-requests-limit": "50",
      "anthropic-ratelimit-requests-remaining": "42",
      "anthropic-ratelimit-requests-reset": "2026-11-24T16:15:00Z",
      "anthropic-ratelimit-tokens-limit": "400000",
      "anthropic-ratelimit-tokens-remaining": "312000",
      "anthropic-ratelimit-tokens-reset": "2026-11-24T16:15:00Z",
    });

    const snapshot = parseAnthropicRateLimitHeaders(headers);
    expect(snapshot).toEqual({
      requestsLimit: 50,
      requestsRemaining: 42,
      requestsResetAt: "2026-11-24T16:15:00Z",
      tokensLimit: 400_000,
      tokensRemaining: 312_000,
      tokensResetAt: "2026-11-24T16:15:00Z",
      source: "live_headers",
    });

    // Regression: absent headers (e.g. GET /v1/models) must return undefined, NEVER coerce null -> 0.
    expect(parseAnthropicRateLimitHeaders(new Headers())).toBeUndefined();

    // Regression: partial headers default remaining to limit (never 0).
    const partial = parseAnthropicRateLimitHeaders(
      new Headers({ "anthropic-ratelimit-requests-limit": "100" }),
    );
    expect(partial?.requestsLimit).toBe(100);
    expect(partial?.requestsRemaining).toBe(100);
    expect(partial?.tokensRemaining).toBe(400_000);
  });

  it("estimates cost and formats token counts consistently", () => {
    const metrics = estimateUsageMetrics("claude-sonnet-4-6", 1_000_000, 100_000);
    expect(metrics.estimatedCostUsd).toBe(4.5);
    expect(formatTokenCount(1_250_000)).toBe("1.3M");
    expect(formatTokenCount(42_600)).toBe("42.6K");
  });

  it("parses OpenAI-compatible SSE streams and rate-limit headers", () => {
    const chunkLine =
      'data: {"choices":[{"delta":{"content":"Hello OpenAI"}}],"usage":{"prompt_tokens":42,"completion_tokens":18}}';
    expect(parseOpenAiSseLine(chunkLine)).toEqual({
      textDelta: "Hello OpenAI",
      inputTokens: 42,
      outputTokens: 18,
    });
    expect(parseOpenAiSseLine("data: [DONE]")).toBeNull();

    const headers = new Headers({
      "x-ratelimit-limit-requests": "100",
      "x-ratelimit-remaining-requests": "94",
      "x-ratelimit-limit-tokens": "200000",
      "x-ratelimit-remaining-tokens": "195000",
    });
    const rl = parseOpenAiRateLimitHeaders(headers);
    expect(rl?.requestsLimit).toBe(100);
    expect(rl?.requestsRemaining).toBe(94);
    expect(rl?.tokensLimit).toBe(200_000);
    expect(rl?.source).toBe("live_headers");
    expect(parseOpenAiRateLimitHeaders(new Headers())).toBeUndefined();
  });
});
