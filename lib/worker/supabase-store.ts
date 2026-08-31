import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { safeErrorMessage } from "@/lib/worker/redact";
import {
  workerJobSchema,
  workerUsageSchema,
  type WorkerEvent,
  type WorkerJob,
  type WorkerResult,
  type WorkerStore,
  type WorkerUsage,
} from "@/lib/worker/types";

type RpcClient = Pick<SupabaseClient, "rpc">;

type ClaimRow = {
  run_id: string;
  organization_id: string;
  project_id: string;
  task_id: string;
  command_id: string;
  agent_id: string;
  prompt: string;
  command_type: string;
  requested_risk: "green" | "yellow" | "red";
  acceptance_criteria: unknown;
  plan: unknown;
  connection_id: string;
  repository_id: string;
  internal_installation_id: string;
  external_installation_id: number;
  app_id: number;
  external_repository_id: number;
  repository_full_name: string;
  base_branch: string;
  base_sha: string;
  lease_token: string;
  lease_expires_at: string;
  attempt_number: number;
  cancellation_requested: boolean;
  logical_agent_role: string;
  provider: string;
  model: string;
  maximum_duration_ms: number;
  maximum_turns: number;
  maximum_input_tokens: number;
  maximum_output_tokens: number;
  maximum_repair_attempts: number;
  ci_timeout_ms: number;
  owner_approval_id: string | null;
  owner_approval_expires_at: string | null;
  owner_approved_paths: unknown;
  recovery_head_branch: string | null;
  recovery_head_sha: string | null;
  recovery_pull_request_number: number | null;
  recovery_pull_request_url: string | null;
  recovery_provider_run_reference: string | null;
  recovery_usage: unknown;
  execution_admission?: unknown;
  initial_context?: unknown;
};

function databaseFailure(operation: string, error: unknown): never {
  throw new Error(`${operation} failed: ${safeErrorMessage(error)}`);
}

function singleRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value && typeof value === "object" ? value as T : null;
}

function mapUsage(value: unknown): WorkerUsage {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return workerUsageSchema.parse({
    turns: record.turns ?? 0,
    inputTokens: record.inputTokens ?? 0,
    cachedInputTokens: record.cachedInputTokens ?? 0,
    outputTokens: record.outputTokens ?? 0,
    reasoningOutputTokens: record.reasoningOutputTokens ?? 0,
  });
}

function mapClaim(row: ClaimRow): WorkerJob {
  const separator = row.repository_full_name.indexOf("/");
  if (separator <= 0 || row.repository_full_name.indexOf("/", separator + 1) >= 0) {
    throw new Error("The claimed repository full name is invalid.");
  }
  const priorUsage = mapUsage(row.recovery_usage);
  return workerJobSchema.parse({
    runId: row.run_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    commandId: row.command_id,
    taskId: row.task_id,
    agentId: row.agent_id,
    connectionId: row.connection_id,
    repositoryDatabaseId: row.repository_id,
    prompt: row.prompt,
    commandType: row.command_type,
    acceptanceCriteria: row.acceptance_criteria,
    plan: row.plan,
    agentRole: row.logical_agent_role,
    provider: row.provider,
    model: row.model,
    risk: row.requested_risk,
    repository: {
      appId: Number(row.app_id),
      installationId: Number(row.external_installation_id),
      repositoryId: Number(row.external_repository_id),
      owner: row.repository_full_name.slice(0, separator),
      name: row.repository_full_name.slice(separator + 1),
      baseBranch: row.base_branch,
      baseSha: row.base_sha,
    },
    worker: {
      leaseToken: row.lease_token,
      leaseExpiresAt: row.lease_expires_at,
    },
    budget: {
      maximumDurationMs: row.maximum_duration_ms,
      maximumTurns: row.maximum_turns,
      maximumInputTokens: row.maximum_input_tokens,
      maximumOutputTokens: row.maximum_output_tokens,
      maximumRepairAttempts: row.maximum_repair_attempts,
      ciTimeoutMs: row.ci_timeout_ms,
    },
    ownerApproval: row.owner_approval_id && row.owner_approval_expires_at
      ? {
          approvalId: row.owner_approval_id,
          expiresAt: row.owner_approval_expires_at,
          approvedPaths: row.owner_approved_paths,
        }
      : null,
    attempt: row.attempt_number,
    cancellationRequested: row.cancellation_requested,
    priorUsage,
    recovery: row.recovery_head_branch
      && row.recovery_head_sha
      ? {
          branch: row.recovery_head_branch,
          commitSha: row.recovery_head_sha,
          pullRequestNumber: row.recovery_pull_request_number === null
            ? null
            : Number(row.recovery_pull_request_number),
          pullRequestUrl: row.recovery_pull_request_url,
          providerRunReference: row.recovery_provider_run_reference,
          usage: priorUsage,
        }
      : null,
    executionAdmission: row.execution_admission ?? null,
    initialContext: row.initial_context ?? null,
  });
}

export class SupabaseWorkerStore implements WorkerStore {
  constructor(
    private readonly client: RpcClient,
    private readonly provider: string,
    private readonly model: string,
    private readonly leaseSeconds = 120,
    private readonly targetCommandId: string | null = null,
  ) {}

  static create(input: {
    url: string;
    serviceRoleKey: string;
    provider: string;
    model: string;
    leaseSeconds?: number;
    targetCommandId?: string | null;
  }) {
    const client = createClient(input.url, input.serviceRoleKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    return new SupabaseWorkerStore(
      client,
      input.provider,
      input.model,
      input.leaseSeconds,
      input.targetCommandId ?? null,
    );
  }

  async register(workerId: string, version: string) {
    const { error } = await this.client.rpc("register_phase1c_worker", {
      p_worker_id: workerId,
      p_version: version,
      p_capabilities: {
        providers: [this.provider],
        models: [this.model],
        sandbox: "workspace-write",
        network: "disabled",
        draftPullRequestsOnly: true,
      },
    });
    if (error) databaseFailure("Worker registration", error);
  }

  async workerHeartbeat(workerId: string, currentRunId: string | null) {
    const { error } = await this.client.rpc("heartbeat_phase1c_worker", {
      p_worker_id: workerId,
      p_current_run_id: currentRunId,
    });
    if (error) databaseFailure("Worker heartbeat", error);
  }

  async finish(workerId: string, status: "idle" | "disabled" | "error" = "idle") {
    const { error } = await this.client.rpc("finish_phase1c_worker", {
      p_worker_id: workerId,
      p_status: status,
    });
    if (error) databaseFailure("Worker shutdown", error);
  }

  async claim(workerId: string): Promise<WorkerJob | null> {
    const claimRequest = {
      p_worker_id: workerId,
      p_provider: this.provider,
      p_model: this.model,
      p_lease_seconds: this.leaseSeconds,
      p_protocol_version: 3,
    };
    const { data, error } = this.targetCommandId
      ? await this.client.rpc("claim_phase1c_run_by_command_v3", {
        ...claimRequest,
        p_target_command_id: this.targetCommandId,
      })
      : await this.client.rpc("claim_phase1c_run_v3", claimRequest);
    if (error) databaseFailure("Run claim", error);
    const row = singleRow<ClaimRow>(data);
    if (!row) return null;

    const job = mapClaim(row);
    /*
     * A graph-launched command is attached to its bridge before dispatch. The
     * claimed run is the first boundary that owns all three exact runtime
     * identities (command, task, run), so bind it before returning the job and
     * before any workspace, model, or GitHub action can begin. The RPC is a
     * no-op for ordinary Phase 1C commands and idempotent for an exact replay;
     * it never infers a bridge from project or prompt content.
     */
    const { error: bridgeError } = await this.client.rpc(
      "bind_graph_phase1c_run_by_command_as_worker",
      {
        p_command_id: job.commandId,
        p_task_id: job.taskId,
        p_agent_run_id: job.runId,
      },
    );
    if (bridgeError) databaseFailure("Graph Phase 1C run binding", bridgeError);
    return job;
  }

  async heartbeat(job: WorkerJob, workerId: string) {
    const { data, error } = await this.client.rpc("heartbeat_phase1c_run", {
      p_worker_id: workerId,
      p_run_id: job.runId,
      p_lease_token: job.worker.leaseToken,
      p_lease_seconds: this.leaseSeconds,
    });
    if (error) databaseFailure("Run heartbeat", error);
    const row = singleRow<{ cancellation_requested: boolean }>(data);
    if (!row) throw new Error("Run heartbeat returned no lease evidence.");
    return { cancelRequested: row.cancellation_requested };
  }

  async event(job: WorkerJob, workerId: string, event: WorkerEvent) {
    const { error } = await this.client.rpc("append_phase1c_run_event", {
      p_worker_id: workerId,
      p_run_id: job.runId,
      p_lease_token: job.worker.leaseToken,
      p_event_type: event.kind,
      p_message: event.message,
      p_details: event.details ?? {},
    });
    if (error) databaseFailure("Run event", error);
  }

  async validation(
    job: WorkerJob,
    workerId: string,
    validationRound: number,
    validation: WorkerResult["validation"][number],
  ) {
    const { error } = await this.client.rpc("record_phase1c_validation", {
      p_worker_id: workerId,
      p_run_id: job.runId,
      p_lease_token: job.worker.leaseToken,
      p_validation_round: validationRound,
      p_name: validation.name,
      p_command: validation.command,
      p_status: validation.status,
      p_duration_ms: validation.durationMs,
      p_output: validation.output,
    });
    if (error) databaseFailure("Validation evidence", error);
  }

  async artifact(
    job: WorkerJob,
    workerId: string,
    artifact: {
      type: "branch" | "commit" | "pull_request" | "pull_request_head";
      reference: string;
      externalNumber?: number | null;
      metadata?: Record<string, string | number | boolean | null>;
    },
  ) {
    const { error } = await this.client.rpc("record_phase1c_run_artifact", {
      p_worker_id: workerId,
      p_run_id: job.runId,
      p_lease_token: job.worker.leaseToken,
      p_artifact_type: artifact.type,
      p_reference: artifact.reference,
      p_external_number: artifact.externalNumber ?? null,
      p_metadata: artifact.metadata ?? {},
    });
    if (error) databaseFailure("Run artifact", error);
  }

  async complete(job: WorkerJob, workerId: string, result: WorkerResult) {
    /*
     * This wrapper preserves ordinary completion and, when this exact command
     * is attached to a graph, records the PR head and advances its bridge in
     * the same database transaction. A separate post-completion call would be
     * unrecoverable if the run became terminal before the bridge write failed.
     */
    const { error } = await this.client.rpc("complete_phase1c_run_with_graph_bridge_as_worker", {
      p_worker_id: workerId,
      p_run_id: job.runId,
      p_lease_token: job.worker.leaseToken,
      p_outcome: "succeeded",
      p_summary: result.summary,
      p_provider_run_reference: result.threadId,
      p_usage: {
        turns: result.usage.turns,
        inputTokens: result.usage.inputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        outputTokens: result.usage.outputTokens,
        reasoningOutputTokens: result.usage.reasoningOutputTokens,
      },
      p_changed_files: result.changedFiles,
      p_checks: result.checks,
      p_error_code: null,
      p_error_message: null,
      p_retryable: false,
    });
    if (error) databaseFailure("Run completion", error);
  }

  async fail(
    job: WorkerJob,
    workerId: string,
    failure: {
      code: string;
      message: string;
      retryable: boolean;
      providerRunReference?: string | null;
      usage?: WorkerResult["usage"];
      checks?: WorkerResult["checks"];
      changedFiles?: WorkerResult["changedFiles"];
    },
  ) {
    const { error } = await this.client.rpc("complete_phase1c_run_with_graph_bridge_as_worker", {
      p_worker_id: workerId,
      p_run_id: job.runId,
      p_lease_token: job.worker.leaseToken,
      p_outcome: "failed",
      p_summary: null,
      p_provider_run_reference: failure.providerRunReference ?? null,
      p_usage: failure.usage ?? job.priorUsage,
      p_changed_files: failure.changedFiles ?? [],
      p_checks: failure.checks ?? [],
      p_error_code: failure.code,
      p_error_message: failure.message,
      p_retryable: failure.retryable,
    });
    if (error) databaseFailure("Run failure", error);
  }

  async replan(job: WorkerJob, workerId: string, baseSha: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("replan_phase1c_run", {
      p_worker_id: workerId,
      p_run_id: job.runId,
      p_lease_token: job.worker.leaseToken,
      p_base_sha: baseSha,
    });
    if (error) databaseFailure("Run replan", error);
    return data === true;
  }

  async cancel(job: WorkerJob, workerId: string, reason: string, usage: WorkerUsage = job.priorUsage) {
    const { error } = await this.client.rpc("complete_phase1c_run_with_graph_bridge_as_worker", {
      p_worker_id: workerId,
      p_run_id: job.runId,
      p_lease_token: job.worker.leaseToken,
      p_outcome: "cancelled",
      p_summary: reason,
      p_provider_run_reference: null,
      p_usage: usage,
      p_changed_files: [],
      p_checks: [],
      p_error_code: "cancelled",
      p_error_message: reason,
      p_retryable: false,
    });
    if (error) databaseFailure("Run cancellation", error);
  }
}
