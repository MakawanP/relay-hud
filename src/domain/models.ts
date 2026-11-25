import type { ProviderKind } from "./types";

export const GOOGLE_MODEL_PATTERN = /^gemini-[a-z0-9._-]{1,64}$/i;
export const CLAUDE_MODEL_PATTERN = /^claude-[a-z0-9._-]{1,64}$/i;
export const GENERIC_MODEL_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,127}$/i;

export function isValidModelForProvider(
  provider: ProviderKind,
  model: string,
): boolean {
  const trimmed = model.trim();
  if (!trimmed) return false;
  if (provider === "google") return GOOGLE_MODEL_PATTERN.test(trimmed);
  if (provider === "anthropic") return CLAUDE_MODEL_PATTERN.test(trimmed);
  return GENERIC_MODEL_PATTERN.test(trimmed);
}

export interface ModelSpec {
  id: string;
  label: string;
  provider: ProviderKind;
  inputPer1MUsd: number;
  outputPer1MUsd: number;
  weightMultiplier: number;
  contextWindow: number;
}

export const MODEL_CATALOG: readonly ModelSpec[] = [
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "google",
    inputPer1MUsd: 1.25,
    outputPer1MUsd: 10.0,
    weightMultiplier: 1.5,
    contextWindow: 1_048_576,
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "google",
    inputPer1MUsd: 0.3,
    outputPer1MUsd: 2.5,
    weightMultiplier: 1.0,
    contextWindow: 1_048_576,
  },
  {
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    provider: "google",
    inputPer1MUsd: 0.1,
    outputPer1MUsd: 0.4,
    weightMultiplier: 0.5,
    contextWindow: 1_048_576,
  },
  {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    provider: "google",
    inputPer1MUsd: 0.1,
    outputPer1MUsd: 0.4,
    weightMultiplier: 0.5,
    contextWindow: 1_048_576,
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    inputPer1MUsd: 3.0,
    outputPer1MUsd: 15.0,
    weightMultiplier: 3.0,
    contextWindow: 200_000,
  },
  {
    id: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    provider: "anthropic",
    inputPer1MUsd: 15.0,
    outputPer1MUsd: 75.0,
    weightMultiplier: 5.0,
    contextWindow: 200_000,
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    inputPer1MUsd: 0.8,
    outputPer1MUsd: 4.0,
    weightMultiplier: 1.0,
    contextWindow: 200_000,
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    provider: "openai_compatible",
    inputPer1MUsd: 2.0,
    outputPer1MUsd: 8.0,
    weightMultiplier: 2.0,
    contextWindow: 1_047_576,
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 Mini",
    provider: "openai_compatible",
    inputPer1MUsd: 0.4,
    outputPer1MUsd: 1.6,
    weightMultiplier: 1.0,
    contextWindow: 1_047_576,
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai_compatible",
    inputPer1MUsd: 2.5,
    outputPer1MUsd: 10.0,
    weightMultiplier: 2.0,
    contextWindow: 128_000,
  },
  {
    id: "o4-mini",
    label: "o4-mini",
    provider: "openai_compatible",
    inputPer1MUsd: 1.1,
    outputPer1MUsd: 4.4,
    weightMultiplier: 1.5,
    contextWindow: 200_000,
  },
  {
    id: "deepseek-chat",
    label: "DeepSeek Chat",
    provider: "openai_compatible",
    inputPer1MUsd: 0.27,
    outputPer1MUsd: 1.1,
    weightMultiplier: 0.75,
    contextWindow: 128_000,
  },
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    provider: "openai_compatible",
    inputPer1MUsd: 0.59,
    outputPer1MUsd: 0.79,
    weightMultiplier: 0.75,
    contextWindow: 128_000,
  },
] as const;

export function getModelsForProvider(provider: ProviderKind): ModelSpec[] {
  return MODEL_CATALOG.filter((spec) => spec.provider === provider);
}

export function findModelSpec(modelId: string): ModelSpec | undefined {
  return MODEL_CATALOG.find(
    (spec) => spec.id === modelId || modelId.startsWith(`${spec.id}-`),
  );
}

export function estimateUsageMetrics(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): { weightedTokens: number; estimatedCostUsd: number } {
  const spec = findModelSpec(modelId);
  const inputRate = spec?.inputPer1MUsd ?? 1.5;
  const outputRate = spec?.outputPer1MUsd ?? 6.0;
  const weight = spec?.weightMultiplier ?? 1.0;

  const estimatedCostUsd =
    (inputTokens / 1_000_000) * inputRate +
    (outputTokens / 1_000_000) * outputRate;
  const weightedTokens = Math.round((inputTokens + outputTokens * 3) * weight);

  return {
    weightedTokens,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(5)),
  };
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return String(count);
}

export function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) {
    return `${totalSec}s`;
  }
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) {
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

export function formatCostUsd(usd: number): string {
  if (usd < 0.01 && usd > 0) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}
