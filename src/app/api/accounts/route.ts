import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CONNECTOR_PRESETS, getConnectorPreset } from "@/domain/connectors";
import { isValidModelForProvider } from "@/domain/models";
import { getConnector } from "@/server/connectors/registry";
import { verifySameOriginRequest } from "@/server/csrf";
import { detectLocalCliTools } from "@/server/host-telemetry";
import { getJobRunner } from "@/server/runner";
import { getHudStore } from "@/server/store";
import { validateProviderBaseUrl } from "@/server/url-guard";
import { getVault } from "@/server/vault";

export const dynamic = "force-dynamic";

const CreateAccountSchema = z.object({
  provider: z.enum(["google", "anthropic", "openai_compatible"]),
  presetId: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(60).optional(),
  roleLabel: z.string().trim().min(1).max(24).optional(),
  email: z.string().trim().max(120).nullable().optional(),
  baseUrl: z.string().trim().max(300).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(10).optional(),
  authMode: z.enum(["api_key", "oauth", "cli", "none"]).optional(),
  apiKey: z.string().trim().min(4).max(256).optional(),
  defaultModel: z.string().trim().min(1).max(128).optional(),
  rpmLimit: z.number().int().min(1).max(10_000).optional(),
  tokensDailyBudget: z.number().int().min(10_000).max(500_000_000).optional(),
  testOnSave: z.boolean().optional(),
});

const ReorderAccountsSchema = z.object({
  orderedIds: z.array(z.string().trim().min(1).max(64)).min(1).max(100),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request);
  if (csrfError) return csrfError;

  const store = getHudStore();
  const cliTools = await detectLocalCliTools();
  return NextResponse.json({
    accounts: store.toPublicAccounts(cliTools),
    presets: CONNECTOR_PRESETS,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request, { requireJson: true });
  if (csrfError) return csrfError;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = CreateAccountSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const preset = getConnectorPreset(input.presetId ?? input.provider);
  const connector = getConnector(input.provider);
  const authMode = input.authMode ?? preset.defaultAuthMode;

  if (!connector.supportedAuthModes.includes(authMode)) {
    return NextResponse.json(
      {
        error: `Auth mode "${authMode}" is not supported by ${connector.displayName}.`,
      },
      { status: 400 },
    );
  }

  let validatedBaseUrl: string | null = null;
  if (input.provider === "openai_compatible") {
    const rawBase = input.baseUrl ?? preset.defaultBaseUrl ?? "";
    try {
      validatedBaseUrl = validateProviderBaseUrl(rawBase);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid Base URL." },
        { status: 400 },
      );
    }
  }

  const defaultModel = input.defaultModel ?? preset.defaultModel;
  if (!isValidModelForProvider(input.provider, defaultModel)) {
    return NextResponse.json(
      {
        error: `Model "${defaultModel}" is not valid for ${connector.displayName}.`,
      },
      { status: 400 },
    );
  }

  const store = getHudStore();
  const created = store.createAccount({
    provider: input.provider,
    presetId: preset.id,
    name: input.name,
    roleLabel: input.roleLabel,
    email: input.email ?? null,
    baseUrl: validatedBaseUrl,
    tags: input.tags,
    authMode,
    defaultModel,
    rpmLimit: input.rpmLimit,
    tokensDailyBudget: input.tokensDailyBudget,
  });

  if (input.apiKey) {
    getVault().setAccountSecret(created.id, { apiKey: input.apiKey });
  }

  let probe = null;
  if (input.testOnSave && (input.apiKey || authMode === "none" || authMode === "cli")) {
    probe = await getJobRunner().testAccountConnection(created.id);
  }

  const cliTools = await detectLocalCliTools();
  const account = store
    .toPublicAccounts(cliTools)
    .find((a) => a.id === created.id);

  return NextResponse.json({ account, probe }, { status: 201 });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request, { requireJson: true });
  if (csrfError) return csrfError;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = ReorderAccountsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid account order.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const store = getHudStore();
  store.reorderAccounts(parsed.data.orderedIds);
  const cliTools = await detectLocalCliTools();
  return NextResponse.json({
    accounts: store.toPublicAccounts(cliTools),
  });
}
