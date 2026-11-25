import { NextRequest, NextResponse } from "next/server";
import { verifySameOriginRequest } from "@/server/csrf";
import { getJobRunner } from "@/server/runner";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request);
  if (csrfError) return csrfError;

  const { id } = await context.params;
  const stopped = getJobRunner().stopJob(id);
  if (!stopped) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  return NextResponse.json({ stopped: true, jobId: id });
}
