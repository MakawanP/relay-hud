import { NextRequest } from "next/server";
import type { JobStatus } from "@/domain/types";
import { verifySameOriginRequest } from "@/server/csrf";
import { getJobRunner } from "@/server/runner";
import { getHudStore } from "@/server/store";

export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = new Set<JobStatus>(["done", "failed", "stopped"]);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const csrfError = verifySameOriginRequest(request);
  if (csrfError) return csrfError;

  const { id } = await context.params;
  const store = getHudStore();
  const initialJob = store.getJob(id);

  if (!initialJob) {
    return new Response(JSON.stringify({ error: "Job not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let cleanupFn: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeat: NodeJS.Timeout | null = null;

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        try {
          controller.close();
        } catch {
          // Stream may already be closed by client disconnect.
        }
      };
      cleanupFn = cleanup;

      if (request.signal.aborted) {
        cleanup();
        return;
      }

      const send = (payload: unknown): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
          return true;
        } catch {
          cleanup();
          return false;
        }
      };

      if (!send({ type: "job", jobId: id, job: initialJob })) {
        return;
      }

      if (TERMINAL_STATUSES.has(initialJob.status)) {
        cleanup();
        return;
      }

      unsubscribe = getJobRunner().subscribe(id, (evt) => {
        if (!send(evt)) return;
        if (evt.type === "job" && TERMINAL_STATUSES.has(evt.job.status)) {
          cleanup();
        }
      });

      heartbeat = setInterval(() => {
        if (closed) {
          cleanup();
          return;
        }
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000);

      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      cleanupFn?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
