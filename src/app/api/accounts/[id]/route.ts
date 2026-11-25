import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidModelForProvider } from "@/domain/models";
import { getConnector } from "@/server/connectors/registry";
import { verifySameOriginRequest } from "@/server/csrf";
import { detectLocalCliTools } from "@/server/host-telemetry";
import { getJobRunner } from "@/server/runner";
import { getHudStore } from "@/server/store";
import { validateProviderBaseUrl } from "@/server/url-guard";
import { getVault } from "@/server/vault";

export const dynamic = "force-dynamic";

const PatchAccountSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  roleLabel: z.string().trim().min(1).max(24).optional(),
  email: z.string().trim().max(120).nullable().optional(),
  baseUrl: z.string().trim().max(300).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(10).optional(),
  priority: z.number().int().min(1).max(1000).optional(),
  authMode: z.enum(["api_key", "oauth", "cli", "none"]).optional(),
  apiKey: z.string().trim().min(4).max(256).optional(),
  clearCredentials: z.boolean().optional(),
  takesWork: z.boolean().optional(),
  autoFailover: z.boolean().optional(),
  defaultModel: z.string().trim().min(1).max(128).optional(),
  rpmLimit: z.number().int().min(1).max(10_000).optional(),
  tokensDailyBudget: z.number().int().min(10_000).max(500_000_000).optional(),
  testOnSave: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request, { requireJson: true });
  if (csrfError) return csrfError;

  const { id } = await context.params;
  const store = getHudStore();
  if (!store.hasAccount(id)) {
    return NextResponse.json(
      { error: `Unknown account "${id}".` },
      { status: 404 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = PatchAccountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const vault = getVault();
  const meta = store.getAccountMeta(id);
  const connector = getConnector(meta.provider);
  const input = parsed.data;

  if (
    input.authMode !== undefined &&
    !connector.supportedAuthModes.includes(input.authMode)
  ) {
    return NextResponse.json(
      {
        error: `Auth mode "${input.authMode}" is not supported by ${connector.displayName}.`,
      },
      { status: 400 },
    );
  }

  let validatedBaseUrl: string | null | undefined;
  if (input.baseUrl !== undefined && meta.provider === "openai_compatible") {
    if (!input.baseUrl) {
      return NextResponse.json(
        { error: "Base URL is required for OpenAI-compatible connectors." },
        { status: 400 },
      );
    }
    try {
      validatedBaseUrl = validateProviderBaseUrl(input.baseUrl);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid Base URL." },
        { status: 400 },
      );
    }
  }

  if (input.defaultModel !== undefined) {
    if (!isValidModelForProvider(meta.provider, input.defaultModel)) {
      return NextResponse.json(
        {
          error: `Model "${input.defaultModel}" is not a valid ${connector.displayName} model identifier.`,
        },
        { status: 400 },
      );
    }
  }

  if (input.clearCredentials) {
    vault.clearAccountSecret(id);
    store.updateAccountMeta(id, {
      status: "disconnected",
      latencyMs: null,
      lastError: null,
      email: null,
    });
  } else if (input.apiKey) {
    vault.setAccountSecret(id, { apiKey: input.apiKey });
  }

  const latestMeta = store.getAccountMeta(id);
  const nextRpmLimit = input.rpmLimit ?? latestMeta.rpmLimit;
  const nextDailyBudget =
    input.tokensDailyBudget ?? latestMeta.tokensDailyBudget;
  const nextRateLimits = input.clearCredentials
    ? {
        requestsLimit: nextRpmLimit,
        requestsRemaining: nextRpmLimit,
        requestsResetAt: null,
        tokensLimit: nextDailyBudget,
        tokensRemaining: nextDailyBudget,
        tokensResetAt: null,
        source: "budget_tracker" as const,
      }
    : {
        ...latestMeta.rateLimits,
        ...(input.rpmLimit !== undefined
          ? {
              requestsLimit: nextRpmLimit,
              requestsRemaining: Math.min(
                latestMeta.rateLimits.requestsRemaining,
                nextRpmLimit,
              ),
            }
          : {}),
        ...(input.tokensDailyBudget !== undefined &&
        latestMeta.rateLimits.source !== "live_headers"
          ? {
              tokensLimit: nextDailyBudget,
              tokensRemaining: Math.max(
                0,
                nextDailyBudget - latestMeta.tokensUsedToday,
              ),
            }
          : {}),
      };

  const nextAvailableModels =
    input.defaultModel && !latestMeta.availableModels.includes(input.defaultModel)
      ? [input.defaultModel, ...latestMeta.availableModels]
      : latestMeta.availableModels;

  store.updateAccountMeta(id, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.roleLabel !== undefined ? { roleLabel: input.roleLabel } : {}),
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(validatedBaseUrl !== undefined ? { baseUrl: validatedBaseUrl } : {}),
    ...(input.tags !== undefined
      ? {
          tags: Array.from(
            new Set(
              input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
            ),
          ),
        }
      : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.authMode !== undefined ? { authMode: input.authMode } : {}),
    ...(input.takesWork !== undefined ? { takesWork: input.takesWork } : {}),
    ...(input.autoFailover !== undefined
      ? { autoFailover: input.autoFailover }
      : {}),
    ...(input.defaultModel !== undefined
      ? {
          defaultModel: input.defaultModel,
          availableModels: nextAvailableModels,
        }
      : {}),
    ...(input.clearCredentials ? { rpmCurrent: 0 } : {}),
    rpmLimit: nextRpmLimit,
    tokensDailyBudget: nextDailyBudget,
    rateLimits: nextRateLimits,
  });

  let probeResult = null;
  if (input.testOnSave && !input.clearCredentials) {
    probeResult = await getJobRunner().testAccountConnection(id);
  }

  const cliTools = await detectLocalCliTools();
  const updated = store
    .toPublicAccounts(cliTools)
    .find((acc) => acc.id === id);

  return NextResponse.json({
    account: updated,
    probe: probeResult,
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request);
  if (csrfError) return csrfError;

  const { id } = await context.params;
  const store = getHudStore();
  if (!store.deleteAccount(id)) {
    return NextResponse.json(
      { error: `Unknown account "${id}".` },
      { status: 404 },
    );
  }

  const cliTools = await detectLocalCliTools();
  return NextResponse.json({
    deleted: id,
    accounts: store.toPublicAccounts(cliTools),
  });
}
