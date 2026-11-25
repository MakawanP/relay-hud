import { NextRequest, NextResponse } from "next/server";
import { verifySameOriginRequest } from "@/server/csrf";
import { getHudStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request);
  if (csrfError) return csrfError;

  const { id } = await context.params;
  const ok = getHudStore().acknowledgeAlert(id);
  if (!ok) {
    return NextResponse.json({ error: "Alert not found." }, { status: 404 });
  }
  return NextResponse.json({ acknowledged: true });
}
