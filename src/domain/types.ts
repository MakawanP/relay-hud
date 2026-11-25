export type AccountId = string;

export type ProviderKind = "google" | "anthropic" | "openai_compatible";

export type AuthMode = "api_key" | "oauth" | "cli" | "none";

export type AccountConnectionStatus =
  | "online"
  | "rate_limited"
  | "error"
  | "disconnected";

export type RoutingPolicy =
  | "auto_balance"
  | "priority_order"
  | "google_first"
  | "claude_first"
  | "lowest_latency";

export type JobStatus =
  | "working"
  | "waiting"
  | "done"
  | "failed"
  | "idle"
  | "stopped";

export type DispatchMode = "arw" | "direct" | "fanout" | "local";

export type ProtocolBadge = "API" | "OAuth" | "SSO" | "CLI" | "Failover";

export interface RateLimitSnapshot {
  requestsLimit: number;
  requestsRemaining: number;
  requestsResetAt: string | null;
  tokensLimit: number;
  tokensRemaining: number;
  tokensResetAt: string | null;
  source: "live_headers" | "budget_tracker";
}

export interface AccountPublicState {
  id: AccountId;
  slotIndex: number;
  priority: number;
  provider: ProviderKind;
  presetId: string | null;
  name: string;
  roleLabel: string;
  email: string | null;
  baseUrl: string | null;
  tags: string[];
  authMode: AuthMode;
  status: AccountConnectionStatus;
  hasCredentials: boolean;
  maskedCredential: string | null;
  oauthConnected: boolean;
  cliAvailable: boolean;
  takesWork: boolean;
  autoFailover: boolean;
  defaultModel: string;
  availableModels: string[];
  latencyMs: number | null;
  quotaUsedPct: number;
  rpmCurrent: number;
  rpmLimit: number;
  tokensUsedToday: number;
  tokensDailyBudget: number;
  estimatedCostUsd: number;
  activeJobs: number;
  totalJobs: number;
  failedJobs: number;
  failoverCount: number;
  lastCheckedAt: string | null;
  lastError: string | null;
  rateLimits: RateLimitSnapshot;
}

export interface JobSubTask {
  id: string;
  title: string;
  detail: string;
  command: string;
  durationLabel: string;
  metricLabel: string;
  status: JobStatus;
}

export interface JobHandoff {
  targetAccountId: AccountId;
  targetAccountLabel: string;
  targetJobId: string;
  title: string;
  reason: string;
}

export interface JobLogEntry {
  id: string;
  timestamp: string;
  level: "info" | "stream" | "warn" | "error" | "success";
  text: string;
}

export interface HudJob {
  id: string;
  chatSessionId: string;
  chatTitle: string;
  originNodeId: "dispatch-hub" | "local-mac";
  targetAccountId: AccountId;
  provider: ProviderKind;
  model: string;
  title: string;
  workspaceTag: string;
  repoName: string;
  folderPath: string;
  dispatchMode: DispatchMode;
  protocolBadge: ProtocolBadge;
  status: JobStatus;
  startedAt: string;
  endedAt: string | null;
  lastCheckInAt: string | null;
  latencyMs: number | null;
  tokensPerSec: number | null;
  inputTokens: number;
  outputTokens: number;
  weightedTokens: number;
  estimatedCostUsd: number;
  prompt: string;
  commandPreview: string;
  pidOrReqId: string;
  subTasks: JobSubTask[];
  handoffs: JobHandoff[];
  logs: JobLogEntry[];
  outputText: string;
  errorMessage: string | null;
}

export interface LocalProcessInfo {
  pid: number;
  name: string;
  label: string;
  cpuPct: number;
  memoryMb: number;
  elapsed: string;
  category: "agent" | "runtime" | "build";
}

export interface ChatGroup {
  id: string;
  originNodeId: "dispatch-hub" | "local-mac";
  title: string;
  workspaceTag: string;
  repoName: string;
  groupKind: "arw" | "local";
  status: JobStatus;
  startedAt: string;
  elapsedLabel: string;
  metricSummary: string;
  jobIds: string[];
}

export interface HostTelemetry {
  hostname: string;
  chipModel: string;
  platform: string;
  cpuUsagePct: number;
  gpuEstimatePct: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  memoryPressure: "normal" | "warning" | "critical";
  loadAvg: [number, number, number];
  uptimeSec: number;
  activeLocalProcesses: number;
  localProcesses: LocalProcessInfo[];
  cliTools: {
    claude: boolean;
    gemini: boolean;
  };
  capturedAt: string;
}

export interface HudAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  accountId?: AccountId;
  jobId?: string;
  createdAt: string;
  acknowledged: boolean;
}

export interface SsoPublicConfig {
  googleAppConfigured: boolean;
  googleAppLoginEnabled: boolean;
  oidcConfigured: boolean;
  oidcAppLoginEnabled: boolean;
  oidcLabel: string;
  oidcIssuer: string | null;
  oidcScopes: string;
  allowedEmails: string[];
  allowedDomains: string[];
  passcodeEnabled: boolean;
  googleAccountRedirectUri: string;
  googleSsoRedirectUri: string;
  oidcSsoRedirectUri: string;
  oidcAccountRedirectUri: string;
}

export interface SessionUserInfo {
  email: string;
  method: "passcode" | "google_sso" | "oidc_sso";
}

export interface HudSnapshot {
  routingPolicy: RoutingPolicy;
  host: HostTelemetry;
  accounts: AccountPublicState[];
  chats: ChatGroup[];
  jobs: HudJob[];
  alerts: HudAlert[];
  oauthConfig: {
    googleConfigured: boolean;
    redirectUri: string;
  };
  ssoConfig: SsoPublicConfig;
  updatedAt: string;
}

export type DispatchTarget = AccountId | "arw" | "fanout_all";

export interface DispatchJobInput {
  title: string;
  prompt: string;
  target: DispatchTarget;
  model?: string;
  poolTag?: string;
  workspaceTag?: string;
  repoName?: string;
  chatSessionId?: string;
  chatTitle?: string;
  originNodeId?: "dispatch-hub" | "local-mac";
}
