import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import {
  estimateUsageMetrics,
  isValidModelForProvider,
} from "@/domain/models";
import { selectBestAccount, selectFailoverAccount } from "@/domain/routing";
import type {
  AccountId,
  ChatGroup,
  DispatchJobInput,
  HudJob,
  JobLogEntry,
  ProtocolBadge,
} from "@/domain/types";
import { getConnector } from "./connectors/registry";
import { detectLocalCliTools } from "./host-telemetry";
import { ProviderRequestError } from "./providers/google";
import { getHudStore } from "./store";
import { getVault } from "./vault";

export type JobStreamEvent =
  | { type: "log"; jobId: string; entry: JobLogEntry }
  | { type: "delta"; jobId: string; chunk: string; outputText: string }
  | { type: "job"; jobId: string; job: HudJob };

class JobRuntimeController {
  private readonly emitter = new EventEmitter();
  private readonly aborters = new Map<string, AbortController>();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  subscribe(jobId: string, listener: (evt: JobStreamEvent) => void): () => void {
    const channel = `job:${jobId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  private emit(evt: JobStreamEvent): void {
    this.emitter.emit(`job:${evt.jobId}`, evt);
  }

  private appendLog(
    job: HudJob,
    level: JobLogEntry["level"],
    text: string,
    immediate = false,
  ): void {
    const entry: JobLogEntry = {
      id: `log_${crypto.randomBytes(4).toString("hex")}`,
      timestamp: new Date().toISOString(),
      level,
      text,
    };
    job.logs = [...job.logs.slice(-149), entry];
    job.lastCheckInAt = entry.timestamp;
    getHudStore().upsertJob(job, { immediate });
    this.emit({ type: "log", jobId: job.id, entry });
  }

  stopJob(jobId: string): boolean {
    const controller = this.aborters.get(jobId);
    const store = getHudStore();
    const job = store.getJob(jobId);
    if (!job) return false;
    if (controller) {
      controller.abort();
      this.aborters.delete(jobId);
    }
    if (job.status === "working" || job.status === "waiting") {
      job.status = "stopped";
      job.endedAt = new Date().toISOString();
      for (const sub of job.subTasks) {
        if (sub.status === "working" || sub.status === "waiting") {
          sub.status = "stopped";
        }
      }
      this.appendLog(job, "warn", "Job stopped by operator.", true);
      store.syncChatForJob(job);
      this.emit({ type: "job", jobId: job.id, job });
    }
    return true;
  }

  async testAccountConnection(accountId: AccountId): Promise<{
    ok: boolean;
    latencyMs: number;
    models: string[];
    error?: string;
  }> {
    const store = getHudStore();
    const vault = getVault();
    const meta = store.getAccountMeta(accountId);
    const secret = vault.getAccountSecret(accountId);
    const cliTools = await detectLocalCliTools(true);
    const connector = getConnector(meta.provider);

    const res = await connector.probe({ meta, secret, vault, cliTools });
    const hasConfiguredAuth =
      Boolean(secret.apiKey) ||
      Boolean(secret.oauthAccessToken) ||
      Boolean(secret.oauthRefreshToken) ||
      meta.authMode === "cli" ||
      meta.authMode === "none";

    store.updateAccountMeta(accountId, {
      status: res.ok
        ? "online"
        : res.rateLimited
          ? "rate_limited"
          : hasConfiguredAuth
            ? "error"
            : "disconnected",
      latencyMs: res.latencyMs || null,
      availableModels: res.models,
      defaultModel: res.models.includes(meta.defaultModel)
        ? meta.defaultModel
        : (res.models[0] ?? meta.defaultModel),
      ...(res.email ? { email: res.email } : {}),
      ...(res.rateLimits ? { rateLimits: res.rateLimits } : {}),
      lastCheckedAt: new Date().toISOString(),
      lastError: res.ok ? null : (res.error ?? "Connection test failed."),
    });

    return res;
  }

  async dispatch(input: DispatchJobInput): Promise<{
    jobs: HudJob[];
    chat: ChatGroup;
    routingNote: string;
  }> {
    const store = getHudStore();
    const cliTools = await detectLocalCliTools();
    const publicAccounts = store.toPublicAccounts(cliTools);
    const poolTag = input.poolTag?.trim().toLowerCase() || undefined;

    const targetIds: AccountId[] = [];
    let routingNote = "";

    if (input.target === "fanout_all") {
      const ready = publicAccounts.filter(
        (acc) =>
          acc.takesWork &&
          acc.hasCredentials &&
          acc.status !== "disconnected" &&
          acc.status !== "rate_limited" &&
          acc.quotaUsedPct < 98 &&
          (!poolTag || acc.tags.some((t) => t.toLowerCase() === poolTag)),
      );
      if (ready.length === 0) {
        throw new Error(
          poolTag
            ? `No connected accounts in pool "#${poolTag}" are ready for Fan-Out.`
            : "No connected accounts are ready for Fan-Out. Connect at least one account in Accounts first.",
        );
      }
      targetIds.push(...ready.map((a) => a.id));
      routingNote = `Parallel Fan-Out dispatched across ${ready.length} connected account(s).`;
    } else if (input.target === "arw") {
      const decision = selectBestAccount(
        publicAccounts,
        store.getRoutingPolicy(),
        [],
        poolTag,
      );
      if (!decision.selected) {
        throw new Error(decision.reason);
      }
      targetIds.push(decision.selected.id);
      routingNote = decision.reason;
    } else {
      const targetAccount = publicAccounts.find((a) => a.id === input.target);
      if (!targetAccount) {
        throw new Error(`Unknown account: ${input.target}`);
      }
      if (!targetAccount.hasCredentials) {
        throw new Error(
          `${targetAccount.name} is not connected yet. Open Accounts to configure credentials, SSO, or endpoint URL.`,
        );
      }
      targetIds.push(input.target);
      routingNote = `Direct dispatch to ${targetAccount.name}.`;
    }

    const chatId =
      input.chatSessionId || `chat_${crypto.randomBytes(4).toString("hex")}`;
    const chatTitle = input.chatTitle?.trim() || input.title.trim();
    const originNodeId = input.originNodeId ?? "local-mac";

    const createdJobs: HudJob[] = [];
    for (const accountId of targetIds) {
      const meta = store.getAccountMeta(accountId);
      const connector = getConnector(meta.provider);
      const validOverride =
        input.model && isValidModelForProvider(meta.provider, input.model);
      const model = validOverride ? input.model! : meta.defaultModel;

      const protocolBadge: ProtocolBadge =
        meta.authMode === "oauth"
          ? meta.provider === "google"
            ? "OAuth"
            : "SSO"
          : meta.authMode === "cli"
            ? "CLI"
            : "API";

      const jobId = `job_${crypto.randomBytes(4).toString("hex")}`;
      const startedAt = new Date().toISOString();
      const shortPrompt = input.prompt.replace(/\s+/g, " ").slice(0, 72);
      const commandPreview = connector.buildCommandPreview(
        meta,
        model,
        shortPrompt,
      );

      const job: HudJob = {
        id: jobId,
        chatSessionId: chatId,
        chatTitle,
        originNodeId,
        targetAccountId: accountId,
        provider: meta.provider,
        model,
        title:
          targetIds.length > 1
            ? `${input.title.trim()} (${meta.roleLabel})`
            : input.title.trim(),
        workspaceTag: input.workspaceTag?.trim() || meta.roleLabel,
        repoName: input.repoName?.trim() || "relay-hud",
        folderPath: process.cwd(),
        dispatchMode:
          input.target === "fanout_all"
            ? "fanout"
            : input.target === "arw"
              ? "arw"
              : "direct",
        protocolBadge,
        status: "working",
        startedAt,
        endedAt: null,
        lastCheckInAt: startedAt,
        latencyMs: null,
        tokensPerSec: null,
        inputTokens: 0,
        outputTokens: 0,
        weightedTokens: 0,
        estimatedCostUsd: 0,
        prompt: input.prompt,
        commandPreview,
        pidOrReqId: `req_${crypto.randomBytes(4).toString("hex")}`,
        subTasks: [
          {
            id: `sub_${crypto.randomBytes(3).toString("hex")}`,
            title: `Stream response via ${meta.name}`,
            detail: `${model} · ${protocolBadge}`,
            command: commandPreview,
            durationLabel: "running",
            metricLabel: "streaming",
            status: "working",
          },
        ],
        handoffs: [],
        logs: [
          {
            id: `log_${crypto.randomBytes(4).toString("hex")}`,
            timestamp: startedAt,
            level: "info",
            text: `${routingNote} Model: ${model}.`,
          },
        ],
        outputText: "",
        errorMessage: null,
      };

      store.upsertJob(job, { immediate: true });
      createdJobs.push(job);
    }

    const existingChat = store.listChats().find((c) => c.id === chatId);
    const chat: ChatGroup = {
      id: chatId,
      originNodeId,
      title: chatTitle,
      workspaceTag:
        input.workspaceTag?.trim() ||
        (originNodeId === "dispatch-hub" ? "DISPATCH" : "MASTER"),
      repoName: input.repoName?.trim() || "relay-hud",
      groupKind: "arw",
      status: "working",
      startedAt: existingChat?.startedAt ?? new Date().toISOString(),
      elapsedLabel: "just now",
      metricSummary: `${createdJobs.length} routed · ${input.repoName?.trim() || "relay-hud"}`,
      jobIds: [
        ...createdJobs.map((j) => j.id),
        ...(existingChat?.jobIds ?? []),
      ],
    };
    store.upsertChat(chat);

    for (const job of createdJobs) {
      const siblingIds =
        job.dispatchMode === "fanout"
          ? targetIds.filter((id) => id !== job.targetAccountId)
          : [];
      void this.executeRealJob(job, siblingIds);
    }

    return { jobs: createdJobs, chat, routingNote };
  }

  private async executeRealJob(
    job: HudJob,
    triedAccounts: AccountId[],
  ): Promise<void> {
    const controller = new AbortController();
    this.aborters.set(job.id, controller);
    const store = getHudStore();
    const vault = getVault();
    if (!store.hasAccount(job.targetAccountId)) {
      this.aborters.delete(job.id);
      return;
    }
    const meta = store.getAccountMeta(job.targetAccountId);
    const secret = vault.getAccountSecret(job.targetAccountId);
    const connector = getConnector(meta.provider);
    const start = Date.now();
    const rpmCurrent = store.recordAccountRequest(job.targetAccountId);

    try {
      const callbacks = {
        onDelta: (chunk: string) => {
          if (controller.signal.aborted) return;
          job.outputText += chunk;
          job.lastCheckInAt = new Date().toISOString();
          const approxOut = Math.max(1, Math.round(job.outputText.length / 4));
          const elapsedSec = Math.max(0.2, (Date.now() - start) / 1000);
          job.outputTokens = approxOut;
          job.tokensPerSec = Number((approxOut / elapsedSec).toFixed(1));
          store.upsertJob(job, { immediate: false });
          this.emit({
            type: "delta",
            jobId: job.id,
            chunk,
            outputText: job.outputText,
          });
        },
        onLog: (
          level: "info" | "warn" | "error" | "success",
          text: string,
        ) => {
          if (controller.signal.aborted) return;
          this.appendLog(job, level, text, false);
        },
      };

      const res = await connector.stream({
        meta,
        secret,
        vault,
        model: job.model,
        prompt: job.prompt,
        signal: controller.signal,
        callbacks,
      });

      if (res.rateLimits && store.hasAccount(job.targetAccountId)) {
        store.updateAccountMeta(job.targetAccountId, {
          rateLimits: res.rateLimits,
        });
      }

      if (controller.signal.aborted || job.status === "stopped") {
        return;
      }

      const elapsedSec = Math.max(0.2, (Date.now() - start) / 1000);
      const usage = estimateUsageMetrics(
        job.model,
        res.inputTokens,
        res.outputTokens,
      );
      job.inputTokens = res.inputTokens;
      job.outputTokens = res.outputTokens;
      job.weightedTokens = usage.weightedTokens;
      job.estimatedCostUsd = usage.estimatedCostUsd;
      job.latencyMs = res.latencyMs;
      job.tokensPerSec = Number((res.outputTokens / elapsedSec).toFixed(1));
      job.status = "done";
      job.endedAt = new Date().toISOString();
      if (job.subTasks[0]) {
        job.subTasks[0].status = "done";
        job.subTasks[0].durationLabel = `${elapsedSec.toFixed(1)}s`;
        job.subTasks[0].metricLabel = `${job.tokensPerSec} tok/s`;
      }

      if (store.hasAccount(job.targetAccountId)) {
        const currentMeta = store.getAccountMeta(job.targetAccountId);
        const nextTokens =
          currentMeta.tokensUsedToday + res.inputTokens + res.outputTokens;
        store.updateAccountMeta(job.targetAccountId, {
          status: "online",
          latencyMs: res.latencyMs,
          rpmCurrent,
          tokensUsedToday: nextTokens,
          estimatedCostUsd: Number(
            (currentMeta.estimatedCostUsd + usage.estimatedCostUsd).toFixed(4),
          ),
          totalJobs: currentMeta.totalJobs + 1,
          lastCheckedAt: new Date().toISOString(),
          lastError: null,
          rateLimits:
            currentMeta.rateLimits.source === "live_headers"
              ? currentMeta.rateLimits
              : {
                  ...currentMeta.rateLimits,
                  requestsRemaining: Math.max(
                    0,
                    currentMeta.rpmLimit - rpmCurrent,
                  ),
                  tokensRemaining: Math.max(
                    0,
                    currentMeta.tokensDailyBudget - nextTokens,
                  ),
                },
        });
      }

      this.appendLog(
        job,
        "success",
        `Completed in ${elapsedSec.toFixed(1)}s · ${res.inputTokens} in / ${res.outputTokens} out (${job.tokensPerSec} tok/s).`,
        true,
      );
      store.syncChatForJob(job);
      this.emit({ type: "job", jobId: job.id, job });
    } catch (err) {
      if (controller.signal.aborted || job.status === "stopped") {
        return;
      }
      const reqErr =
        err instanceof ProviderRequestError
          ? err
          : new ProviderRequestError(
              err instanceof Error ? err.message : "Unknown provider error",
              500,
            );

      job.status = "failed";
      job.endedAt = new Date().toISOString();
      job.errorMessage = reqErr.message;
      if (job.subTasks[0]) {
        job.subTasks[0].status = "failed";
      }

      let currentMeta = meta;
      if (store.hasAccount(job.targetAccountId)) {
        currentMeta = store.getAccountMeta(job.targetAccountId);
        store.updateAccountMeta(job.targetAccountId, {
          status: reqErr.rateLimited ? "rate_limited" : "error",
          failedJobs: currentMeta.failedJobs + 1,
          lastCheckedAt: new Date().toISOString(),
          lastError: reqErr.message,
        });
      }

      this.appendLog(job, "error", `Failed: ${reqErr.message}`, true);

      const shouldFailover =
        job.dispatchMode === "arw" &&
        currentMeta.autoFailover &&
        (reqErr.rateLimited || reqErr.httpStatus >= 500);

      if (shouldFailover) {
        const cliTools = await detectLocalCliTools();
        const accounts = store.toPublicAccounts(cliTools);
        const failover = selectFailoverAccount(
          accounts,
          job.targetAccountId,
          store.getRoutingPolicy(),
          triedAccounts,
        );
        if (failover.selected) {
          const backupAcc = failover.selected;
          const backupMeta = store.getAccountMeta(backupAcc.id);
          const backupConnector = getConnector(backupAcc.provider);
          const backupJobId = `job_${crypto.randomBytes(4).toString("hex")}`;
          const shortPrompt = job.prompt.replace(/\s+/g, " ").slice(0, 72);
          const backupCommand = backupConnector.buildCommandPreview(
            backupMeta,
            backupAcc.defaultModel,
            shortPrompt,
          );

          const backupJob: HudJob = {
            ...job,
            id: backupJobId,
            targetAccountId: backupAcc.id,
            provider: backupAcc.provider,
            model: backupAcc.defaultModel,
            workspaceTag: backupAcc.roleLabel,
            protocolBadge: "Failover",
            commandPreview: backupCommand,
            pidOrReqId: `req_${crypto.randomBytes(4).toString("hex")}`,
            status: "working",
            startedAt: new Date().toISOString(),
            endedAt: null,
            lastCheckInAt: new Date().toISOString(),
            latencyMs: null,
            tokensPerSec: null,
            inputTokens: 0,
            outputTokens: 0,
            weightedTokens: 0,
            estimatedCostUsd: 0,
            outputText: "",
            errorMessage: null,
            handoffs: [],
            logs: [
              {
                id: `log_${crypto.randomBytes(4).toString("hex")}`,
                timestamp: new Date().toISOString(),
                level: "warn",
                text: `${failover.reason} (HTTP ${reqErr.httpStatus}).`,
              },
            ],
            subTasks: [
              {
                id: `sub_${crypto.randomBytes(3).toString("hex")}`,
                title: `Failover stream via ${backupAcc.name}`,
                detail: `${backupAcc.defaultModel} · Failover`,
                command: backupCommand,
                durationLabel: "running",
                metricLabel: "failover",
                status: "working",
              },
            ],
          };

          job.handoffs = [
            ...job.handoffs,
            {
              targetAccountId: backupAcc.id,
              targetAccountLabel: backupAcc.roleLabel,
              targetJobId: backupJobId,
              title: job.title,
              reason: reqErr.rateLimited
                ? "Rate limit (429) failover"
                : "Upstream 5xx failover",
            },
          ];
          store.upsertJob(job, { immediate: true });
          store.upsertJob(backupJob, { immediate: true });
          store.syncChatForJob(backupJob);
          store.updateAccountMeta(backupAcc.id, {
            failoverCount: store.getAccountMeta(backupAcc.id).failoverCount + 1,
          });
          store.addAlert({
            severity: "warning",
            title: `Auto-failover: ${meta.name} -> ${backupAcc.name}`,
            detail: `${reqErr.message}. Job re-dispatched automatically.`,
            accountId: backupAcc.id,
            jobId: backupJobId,
          });
          this.appendLog(
            job,
            "warn",
            `Handed off to ${backupAcc.name} (${backupJobId}).`,
            true,
          );
          this.emit({ type: "job", jobId: job.id, job });
          void this.executeRealJob(backupJob, [
            ...triedAccounts,
            job.targetAccountId,
          ]);
          return;
        }
      }

      store.syncChatForJob(job);
      store.addAlert({
        severity: "critical",
        title: `Job failed on ${meta.name}: ${job.title}`,
        detail: reqErr.message,
        accountId: job.targetAccountId,
        jobId: job.id,
      });
      this.emit({ type: "job", jobId: job.id, job });
    } finally {
      this.aborters.delete(job.id);
    }
  }
}

declare global {
  var __relayHudRunner: JobRuntimeController | undefined;
}

export function getJobRunner(): JobRuntimeController {
  if (!globalThis.__relayHudRunner) {
    globalThis.__relayHudRunner = new JobRuntimeController();
  }
  return globalThis.__relayHudRunner;
}
