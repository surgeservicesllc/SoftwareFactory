import "server-only";

import { randomUUID, timingSafeEqual } from "node:crypto";

import { createSupabaseServiceRoleClient } from "@/lib/server/service-role";
import { RunExecutor, type RunRow, type StepOutcome, type TaskRow } from "@/lib/worker/runner";

/**
 * The durable worker tick.
 *
 * A tick is a short, authenticated, idempotent unit of progress: lease a few
 * runs, advance each by a bounded number of steps, release the lease. It is
 * driven by a scheduler, never by the browser. Missing a tick delays work; it
 * never loses it, because all state lives in Postgres.
 */

export class WorkerAuthorizationError extends Error {
  readonly status = 401;
  readonly code = "worker_unauthorized";

  constructor() {
    super("The worker tick credential is missing or invalid.");
    this.name = "WorkerAuthorizationError";
  }
}

export class WorkerNotConfiguredError extends Error {
  readonly status = 503;
  readonly code = "worker_not_configured";

  constructor() {
    super("The durable worker is Not Connected because WORKER_TICK_SECRET is not configured.");
    this.name = "WorkerNotConfiguredError";
  }
}

const MIN_SECRET_BYTES = 32;

/**
 * Constant-time bearer comparison. A length mismatch is reported without
 * comparing, since the length itself is not the secret.
 */
export function isAuthorizedWorkerRequest(request: Request): boolean {
  const configured = process.env.WORKER_TICK_SECRET?.trim();
  if (!configured) throw new WorkerNotConfiguredError();
  if (Buffer.byteLength(configured, "utf8") < MIN_SECRET_BYTES) {
    throw new WorkerNotConfiguredError();
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!presented) return false;

  const expectedBuffer = Buffer.from(configured, "utf8");
  const presentedBuffer = Buffer.from(presented, "utf8");
  if (expectedBuffer.length !== presentedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, presentedBuffer);
}

export type TickRunOutcome = {
  readonly runId: string;
  readonly outcome: StepOutcome["kind"];
  readonly step: string | null;
  readonly failureKind: string | null;
};

export type TickResult = {
  readonly workerId: string;
  readonly claimed: number;
  readonly runs: readonly TickRunOutcome[];
};

const DEFAULT_LEASE_SECONDS = 300;

export async function runWorkerTick(options: {
  maxRuns?: number;
  maxStepsPerRun?: number;
} = {}): Promise<TickResult> {
  const client = createSupabaseServiceRoleClient();
  const workerId = `tick-${randomUUID()}`;
  const maxRuns = Math.max(1, Math.min(5, options.maxRuns ?? 2));

  const { data: claimed, error: claimError } = await client.rpc("claim_agent_runs", {
    p_worker_id: workerId,
    p_limit: maxRuns,
    p_lease_seconds: DEFAULT_LEASE_SECONDS,
  });
  if (claimError) throw claimError;

  const runs = (claimed ?? []) as RunRow[];
  const outcomes: TickRunOutcome[] = [];

  for (const run of runs) {
    const { data: task, error: taskError } = await client
      .from("tasks")
      .select("id,title,description,acceptance_criteria,risk_level,input")
      .eq("id", run.task_id)
      .maybeSingle();

    if (taskError || !task) {
      await client.rpc("finish_agent_run", {
        p_run_id: run.id,
        p_worker_id: workerId,
        p_status: "failed",
        p_failure_kind: "invalid_command",
        p_error_message: "The run's task could not be loaded.",
        p_retry_after_seconds: null,
      });
      outcomes.push({ runId: run.id, outcome: "failed", step: run.step, failureKind: "invalid_command" });
      continue;
    }

    const executor = new RunExecutor(
      { client, workerId, now: () => new Date() },
      run,
      task as TaskRow,
    );

    let outcome: StepOutcome;
    try {
      outcome = await executor.advance(options.maxStepsPerRun ?? 4);
    } catch (error) {
      outcome = {
        kind: "failed",
        failureKind: "internal",
        message: error instanceof Error ? error.message.slice(0, 300) : "The tick failed.",
      };
    }

    await applyOutcome(client, workerId, run, outcome);
    outcomes.push({
      runId: run.id,
      outcome: outcome.kind,
      step: outcome.kind === "wait" || outcome.kind === "continue" ? outcome.step : run.step,
      failureKind: outcome.kind === "failed" ? outcome.failureKind : null,
    });
  }

  return { workerId, claimed: runs.length, runs: outcomes };
}

async function applyOutcome(
  client: ReturnType<typeof createSupabaseServiceRoleClient>,
  workerId: string,
  run: RunRow,
  outcome: StepOutcome,
) {
  switch (outcome.kind) {
    case "done": {
      const { error } = await client.rpc("finish_agent_run", {
        p_run_id: run.id,
        p_worker_id: workerId,
        p_status: "succeeded",
        p_failure_kind: null,
        p_error_message: null,
        p_retry_after_seconds: null,
      });
      if (error) throw error;
      return;
    }
    case "awaiting_review": {
      const { error } = await client.rpc("finish_agent_run", {
        p_run_id: run.id,
        p_worker_id: workerId,
        p_status: "awaiting_review",
        p_failure_kind: null,
        p_error_message: outcome.reason,
        p_retry_after_seconds: null,
      });
      if (error) throw error;
      return;
    }
    case "failed": {
      const { error } = await client.rpc("finish_agent_run", {
        p_run_id: run.id,
        p_worker_id: workerId,
        p_status: outcome.failureKind === "cancelled" ? "cancelled" : "failed",
        p_failure_kind: outcome.failureKind,
        p_error_message: outcome.message,
        p_retry_after_seconds: 60,
      });
      if (error) throw error;
      return;
    }
    case "wait":
    case "continue": {
      // Release the lease and schedule the next tick. The run keeps its status
      // and step, so the next tick resumes exactly where this one stopped.
      const { error } = await client
        .from("agent_runs")
        .update({
          step: outcome.kind === "wait" ? outcome.step : run.step,
          lease_owner: null,
          lease_expires_at: null,
          status: "queued",
          next_attempt_at: new Date(
            Date.now() + (outcome.kind === "wait" ? outcome.retryAfterSeconds : 15) * 1000,
          ).toISOString(),
        })
        .eq("id", run.id)
        .eq("lease_owner", workerId);
      if (error) throw error;
    }
  }
}
