import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GENERIC_MODEL_PATTERN } from "@/domain/models";
import { verifySameOriginRequest } from "@/server/csrf";
import { getJobRunner } from "@/server/runner";

export const dynamic = "force-dynamic";

const CreateJobSchema = z.object({
  title: z.string().trim().min(2).max(120),
  prompt: z.string().trim().min(2).max(16_000),
  target: z.string().trim().min(1).max(64),
  model: z
    .string()
    .trim()
    .refine((val) => GENERIC_MODEL_PATTERN.test(val), "Invalid model identifier.")
    .optional(),
  poolTag: z.string().trim().max(24).optional(),
  workspaceTag: z.string().trim().max(32).optional(),
  repoName: z.string().trim().max(48).optional(),
  chatSessionId: z.string().trim().max(64).optional(),
  chatTitle: z.string().trim().max(100).optional(),
  originNodeId: z.enum(["dispatch-hub", "local-mac"]).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request, { requireJson: true });
  if (csrfError) return csrfError;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = CreateJobSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid job dispatch request.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await getJobRunner().dispatch(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unable to dispatch job.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
