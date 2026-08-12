import { jsonNoStore } from "@/lib/server/http";
import {
  WorkerAuthorizationError,
  WorkerNotConfiguredError,
  isAuthorizedWorkerRequest,
  isWorkerTickConfigured,
  runWorkerTick,
} from "@/lib/worker/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Durable worker tick.
 *
 * Authenticated by a dedicated server-only bearer secret, never by a browser
 * session, and driven by a scheduler. Each call leases a small number of runs
 * and advances each by a bounded number of steps. Missing a tick delays work;
 * it never loses it, because all run state lives in Postgres.
 */
async function handleTick(request: Request) {
  try {
    if (!isAuthorizedWorkerRequest(request)) {
      throw new WorkerAuthorizationError();
    }

    const result = await runWorkerTick();
    return jsonNoStore({
      claimed: result.claimed,
      runs: result.runs,
      workerId: result.workerId,
    });
  } catch (error) {
    if (error instanceof WorkerAuthorizationError || error instanceof WorkerNotConfiguredError) {
      return jsonNoStore(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return jsonNoStore(
      { error: { code: "worker_tick_failed", message: "The worker tick failed safely." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handleTick(request);
}

/**
 * Vercel Cron invokes scheduled paths with GET and an `Authorization: Bearer`
 * header, so an authorized GET runs a tick. An unauthorized GET returns only
 * whether the worker is configured, which reveals nothing about the credential.
 */
export async function GET(request: Request) {
  const configured = isWorkerTickConfigured();
  if (configured && request.headers.get("authorization")) {
    return handleTick(request);
  }

  return jsonNoStore({
    worker: {
      configured,
      status: configured ? "Configured" : "Not Connected",
      detail: configured
        ? "A worker tick credential is present. Configured does not prove a run has executed."
        : "Set a server-only WORKER_TICK_SECRET (or CRON_SECRET) so a scheduler can drive the durable worker.",
    },
  });
}
