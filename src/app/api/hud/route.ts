import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePublicOrigin } from "@/server/auth";
import { verifySameOriginRequest } from "@/server/csrf";
import { buildHudSnapshot } from "@/server/snapshot";
import { getHudStore } from "@/server/store";

export const dynamic = "force-dynamic";

const UpdatePolicySchema = z.object({
  routingPolicy: z.enum([
    "auto_balance",
    "priority_order",
    "google_first",
    "claude_first",
    "lowest_latency",
  ]),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request);
  if (csrfError) return csrfError;

  const origin = resolvePublicOrigin(request.headers, request.nextUrl.origin);
  const snapshot = await buildHudSnapshot(origin);
  return NextResponse.json(snapshot);
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const csrfError = verifySameOriginRequest(request, { requireJson: true });
  if (csrfError) return csrfError;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Malformed JSON request body." },
      { status: 400 },
    );
  }

  const parsed = UpdatePolicySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid routing policy.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const store = getHudStore();
    store.setRoutingPolicy(parsed.data.routingPolicy);
    return NextResponse.json({ routingPolicy: store.getRoutingPolicy() });
  } catch {
    return NextResponse.json(
      { error: "Failed to persist routing policy." },
      { status: 500 },
    );
  }
}
