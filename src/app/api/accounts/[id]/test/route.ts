import { NextRequest, NextResponse } from "next/server";
import { verifySameOriginRequest } from "@/server/csrf";
import { detectLocalCliTools } from "@/server/host-telemetry";
import { getJobRunner } from "@/server/runner";
import { getHudStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request);
  if (csrfError) return csrfError;

  const { id } = await context.params;
  const store = getHudStore();
  if (!store.hasAccount(id)) {
    return NextResponse.json(
      { error: `Unknown account "${id}".` },
      { status: 404 },
    );
  }

  const probe = await getJobRunner().testAccountConnection(id);
  const cliTools = await detectLocalCliTools();
  const account = store
    .toPublicAccounts(cliTools)
    .find((acc) => acc.id === id);

  return NextResponse.json({ probe, account });
}
