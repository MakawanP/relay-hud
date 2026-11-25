import type { AuthMode, ProviderKind } from "./types";

export interface ConnectorPreset {
  id: string;
  provider: ProviderKind;
  label: string;
  shortLabel: string;
  description: string;
  accentHex: string;
  defaultAuthMode: AuthMode;
  supportedAuthModes: readonly AuthMode[];
  defaultBaseUrl: string | null;
  defaultModel: string;
  suggestedModels: readonly string[];
  defaultRpmLimit: number;
  defaultDailyBudget: number;
  apiKeyPlaceholder: string;
  emailPlaceholder: string;
}

export const CONNECTOR_PRESETS: readonly ConnectorPreset[] = [
  {
    id: "google",
    provider: "google",
    label: "Google Gemini",
    shortLabel: "GOOGLE",
    description: "Gemini API Key, Google OAuth 2.0, or local gemini CLI",
    accentHex: "#4d94d6",
    defaultAuthMode: "api_key",
    supportedAuthModes: ["api_key", "oauth", "cli"],
    defaultBaseUrl: null,
    defaultModel: "gemini-2.5-pro",
    suggestedModels: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.0-flash",
    ],
    defaultRpmLimit: 60,
    defaultDailyBudget: 10_000_000,
    apiKeyPlaceholder: "AIzaSy...",
    emailPlaceholder: "you@gmail.com",
  },
  {
    id: "anthropic",
    provider: "anthropic",
    label: "Anthropic Claude",
    shortLabel: "CLAUDE",
    description: "Claude Messages API (live rate-limit headers) or Claude Code CLI",
    accentHex: "#d97757",
    defaultAuthMode: "api_key",
    supportedAuthModes: ["api_key", "cli"],
    defaultBaseUrl: null,
    defaultModel: "claude-sonnet-4-6",
    suggestedModels: [
      "claude-sonnet-4-6",
      "claude-opus-4-6",
      "claude-haiku-4-5",
      "claude-sonnet-4-5",
    ],
    defaultRpmLimit: 50,
    defaultDailyBudget: 10_000_000,
    apiKeyPlaceholder: "sk-ant-api03-...",
    emailPlaceholder: "anthropic-org",
  },
  {
    id: "openai",
    provider: "openai_compatible",
    label: "OpenAI",
    shortLabel: "OPENAI",
    description: "Official OpenAI API (GPT-4.1, o3, o4-mini)",
    accentHex: "#10a37f",
    defaultAuthMode: "api_key",
    supportedAuthModes: ["api_key", "oauth"],
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1",
    suggestedModels: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "o4-mini"],
    defaultRpmLimit: 60,
    defaultDailyBudget: 10_000_000,
    apiKeyPlaceholder: "sk-proj-...",
    emailPlaceholder: "openai-org",
  },
  {
    id: "openrouter",
    provider: "openai_compatible",
    label: "OpenRouter",
    shortLabel: "OPENROUTER",
    description: "Unified router for 300+ models via OpenAI-compatible API",
    accentHex: "#9b7df2",
    defaultAuthMode: "api_key",
    supportedAuthModes: ["api_key", "oauth"],
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4",
    suggestedModels: [
      "anthropic/claude-sonnet-4",
      "google/gemini-2.5-pro",
      "openai/gpt-4.1",
      "deepseek/deepseek-r1",
    ],
    defaultRpmLimit: 60,
    defaultDailyBudget: 10_000_000,
    apiKeyPlaceholder: "sk-or-v1-...",
    emailPlaceholder: "openrouter-account",
  },
  {
    id: "groq",
    provider: "openai_compatible",
    label: "Groq",
    shortLabel: "GROQ",
    description: "Ultra-low-latency LPU inference (Llama, Qwen, DeepSeek)",
    accentHex: "#f59e0b",
    defaultAuthMode: "api_key",
    supportedAuthModes: ["api_key"],
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    suggestedModels: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "qwen-qwq-32b",
    ],
    defaultRpmLimit: 30,
    defaultDailyBudget: 5_000_000,
    apiKeyPlaceholder: "gsk_...",
    emailPlaceholder: "groq-workspace",
  },
  {
    id: "ollama",
    provider: "openai_compatible",
    label: "Local Ollama / LM Studio",
    shortLabel: "LOCAL LLM",
    description: "Local Apple Silicon inference with zero API key required",
    accentHex: "#56b868",
    defaultAuthMode: "none",
    supportedAuthModes: ["none", "api_key"],
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "qwen2.5-coder:14b",
    suggestedModels: [
      "qwen2.5-coder:14b",
      "llama3.3:latest",
      "deepseek-r1:14b",
      "gemma3:12b",
    ],
    defaultRpmLimit: 120,
    defaultDailyBudget: 50_000_000,
    apiKeyPlaceholder: "Optional bearer token",
    emailPlaceholder: "localhost:11434",
  },
  {
    id: "enterprise_gateway",
    provider: "openai_compatible",
    label: "Custom / Enterprise SSO Gateway",
    shortLabel: "GATEWAY",
    description: "LiteLLM, Cloudflare AI Gateway, DeepSeek, vLLM, or OIDC-protected endpoint",
    accentHex: "#38bdf8",
    defaultAuthMode: "oauth",
    supportedAuthModes: ["oauth", "api_key", "none"],
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    suggestedModels: ["deepseek-chat", "deepseek-reasoner", "gpt-4.1"],
    defaultRpmLimit: 60,
    defaultDailyBudget: 10_000_000,
    apiKeyPlaceholder: "Bearer API key (if not using OIDC SSO)",
    emailPlaceholder: "corp-gateway",
  },
] as const;

export function getConnectorPreset(presetOrProvider: string): ConnectorPreset {
  return (
    CONNECTOR_PRESETS.find((p) => p.id === presetOrProvider) ??
    CONNECTOR_PRESETS.find((p) => p.provider === presetOrProvider) ??
    CONNECTOR_PRESETS[CONNECTOR_PRESETS.length - 1]!
  );
}

export function getProviderDisplayName(
  provider: ProviderKind,
  presetId?: string | null,
): string {
  if (presetId) {
    const preset = CONNECTOR_PRESETS.find((p) => p.id === presetId);
    if (preset) return preset.label;
  }
  switch (provider) {
    case "google":
      return "Google Gemini";
    case "anthropic":
      return "Anthropic Claude";
    case "openai_compatible":
      return "OpenAI-Compatible";
  }
}

export function getProviderAccentHex(
  provider: ProviderKind,
  slotIndex = 1,
  presetId?: string | null,
): string {
  if (provider === "google") {
    return slotIndex % 2 === 0 ? "#7aa7e8" : "#4d94d6";
  }
  if (provider === "anthropic") {
    return slotIndex % 2 === 0 ? "#e89578" : "#d97757";
  }
  if (presetId) {
    const preset = CONNECTOR_PRESETS.find((p) => p.id === presetId);
    if (preset) return preset.accentHex;
  }
  return "#10a37f";
}
