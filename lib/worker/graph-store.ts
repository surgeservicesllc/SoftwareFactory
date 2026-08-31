import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { WORKER_SUPPORTED_EXECUTORS } from "@/lib/worker/executor-support";
import type { GraphRunStore } from "@/lib/worker/graph-run";
import { explainEmptyQueue, type QueueGraphRow } from "@/lib/worker/queue-diagnosis";
import {
  acknowledgeGrokGraphWake,
  assertNoGrokWakePayloadRequired,
} from "@/lib/worker/grok-wake-receipt";

function rpcFailureMessage(failure: unknown): string {
  if (failure && typeof failure === "object" && "message" in failure
    && typeof failure.message === "string") return failure.message;
  return failure instanceof Error ? failure.message : "unknown error";
}

/** A lost response may follow a committed abort, so only ambiguous/transient
 * failures receive one byte-for-byte-identical retry. The SQL request digest
 * makes that replay safe; validation/authorization errors fail immediately. */
function isAmbiguousAbortFailure(failure: unknown): boolean {
  const code = failure && typeof failure === "object" && "code" in failure
    && typeof failure.code === "string" ? failure.code : "";
  if (code.startsWith("08") || code.startsWith("PGRST0")
    || ["40001", "40P01", "53300", "57P01", "57P02", "57P03"].includes(code)) return true;
  return /\b(?:fetch|network|timeout|timed out|connection|socket|econn|aborted)\b/i
    .test(rpcFailureMessage(failure));
}

/**
 * The worker's half of the graph write boundary, over the service-role
 * client. Every call is one of the `*_as_worker` definer functions from
 * migration 20260819000100: claim, node transition, artifact, closure. The
 * store holds no state of its own — the database is the state, which is what
 * lets a worker die mid-run and leave an honest trail instead of a mystery.
 */
export class SupabaseGraphStore implements GraphRunStore {
  private constructor(
    private readonly client: SupabaseClient,
    private readonly workerId: string,
    private readonly repositoryFullName: string,
    private readonly requiredCheckNames: readonly string[],
    private readonly targetGraphId: string | null,
  ) {}

  static create(options: {
    url: string;
    serviceRoleKey: string;
    workerId: string;
    repositoryFullName: string;
    requiredCheckNames: readonly string[];
    targetGraphId?: string | null;
  }) {
    const client = createClient(options.url, options.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return new SupabaseGraphStore(
      client,
      options.workerId,
      options.repositoryFullName,
      options.requiredCheckNames,
      options.targetGraphId ?? null,
    );
  }

  /** Null when no runnable graph exists — an idle answer, not a fault. */
  async claimPlannedGraph(): Promise<unknown | null> {
    const claimRequest = {
      p_worker_id: this.workerId,
      // Declared, not defaulted: the claim skips graphs whose nodes need an
      // executor this worker does not provide, so those graphs keep their
      // budget for a worker that can run them.
      p_supported_executors: [...WORKER_SUPPORTED_EXECUTORS],
      p_repository_full_name: this.repositoryFullName,
      p_required_check_names: [...this.requiredCheckNames],
      p_protocol_version: 3,
    };
    const { data, error } = this.targetGraphId
      ? await this.client.rpc("claim_planned_graph_by_id_v3", {
        ...claimRequest,
        p_target_graph_id: this.targetGraphId,
      })
      : await this.client.rpc("claim_planned_graph_v3", claimRequest);
    if (error) throw new Error(`Claiming a planned graph failed: ${error.message ?? "unknown error"}`);
    return data ?? null;
  }

  async acknowledgeGrokWake(input: Readonly<{
    wakeIntentId: string;
    controlRevision: number;
    graphId: string;
    graphRunId: string;
  }>) {
    return acknowledgeGrokGraphWake(this.client, {
      workerId: this.workerId,
      ...input,
    });
  }

  async assertNoGrokWakePayloadRequired(input: Readonly<{
    graphId: string;
    graphRunId: string;
  }>) {
    return assertNoGrokWakePayloadRequired(this.client, {
      workerId: this.workerId,
      ...input,
    });
  }

  /**
   * One line per graph saying which claim filter excludes it, for the log a
   * person reads after "nothing ran". The bounded worker RPC exposes only ids,
   * states, timestamps and executor names — never goal text or direct table
   * authority.
   */
  async explainEmptyQueue(): Promise<readonly string[]> {
    const { data, error } = await this.client.rpc("diagnose_graph_queue_as_worker_v2", {
      p_worker_id: this.workerId,
      p_repository_full_name: this.repositoryFullName,
      p_required_check_names: [...this.requiredCheckNames],
      p_target_graph_id: this.targetGraphId,
      p_protocol_version: 2,
    });
    if (error) {
      return [`Queue diagnosis unavailable: ${error.message ?? "the read failed"}.`];
    }
    return explainEmptyQueue(
      (data ?? []) as unknown as QueueGraphRow[],
      WORKER_SUPPORTED_EXECUTORS,
      this.targetGraphId,
    );
  }

  async recordNodeState(
    nodeRunId: string,
    state: "RUNNING" | "COMPLETED" | "VERIFYING" | "FAILED" | "CANCELLED" | "SKIPPED",
    detail?: string | null,
    execution?: { provider?: string; model?: string; latencyMs?: number },
    attempt?: number,
  ): Promise<void> {
    const request = {
      p_worker_id: this.workerId,
      p_node_run_id: nodeRunId,
      p_state: state,
      p_detail: detail ?? null,
      p_provider: execution?.provider ?? null,
      p_model: execution?.model ?? null,
      p_latency_ms: execution?.latencyMs ?? null,
    };
    let { error } = await this.client.rpc("record_node_state_as_worker",
      attempt !== undefined ? { ...request, p_attempt: attempt } : request);
    // A database that predates 20260830000100 cannot resolve p_attempt
    // (PGRST202) — exactly the window between app deploy and hosted apply.
    // The transition itself must still land, so retry without the attempt:
    // the counter goes unpersisted for that call, the run stays honest.
    if (error && error.code === "PGRST202" && attempt !== undefined) {
      ({ error } = await this.client.rpc("record_node_state_as_worker", request));
    }
    if (error) throw new Error(`Recording a node transition failed: ${error.message ?? "unknown error"}`);
  }

  /**
   * Open the gate a finished node waits at.
   *
   * Keyed on the graph node, not the node run: the run id changes on every
   * claim and the node id does not, so a decision made on one run is still
   * there for the next. The function is idempotent on that key, which is what
   * lets a re-claim find an existing approval instead of manufacturing a
   * second, undecided gate.
   */
  async openGate(nodeId: string, graphRunId: string, anchorCount: number): Promise<void> {
    const { error } = await this.client.rpc("open_node_gate_as_worker", {
      p_worker_id: this.workerId,
      p_node_id: nodeId,
      p_graph_run_id: graphRunId,
      p_anchor_count: anchorCount,
    });
    if (error) throw new Error(`Opening a lifecycle gate failed: ${error.message ?? "unknown error"}`);
  }

  /**
   * The most recently completed recorded result per node from this graph's
   * earlier runs. The database scopes the read to lifecycle graphs and to
   * runs that never delivered an answer (CANCELLED, PARTIAL, FAILED), so an
   * analysis graph's findings stay fresh and a COMPLETED run is never
   * cannibalized.
   */
  async readPriorNodeResults(graphId: string): Promise<ReadonlyMap<string, {
    output: unknown;
    provider?: string;
    model?: string;
  }>> {
    const { data, error } = await this.client.rpc("read_prior_node_results_as_worker_v2", {
      p_worker_id: this.workerId,
      p_graph_id: graphId,
      p_protocol_version: 2,
    });
    if (error) {
      // A missing function (hosted not yet applied) or a transient read must
      // not fail the run: no reuse simply means the fresh-execution path.
      return new Map();
    }
    const rows = (data ?? []) as Array<{
      node_key?: string;
      payload?: unknown;
      provider?: string | null;
      model?: string | null;
    }>;
    return new Map(
      rows
        .filter((row) => typeof row.node_key === "string")
        .map((row) => [row.node_key as string, {
          output: row.payload,
          provider: row.provider ?? undefined,
          model: row.model ?? undefined,
        }]),
    );
  }

  /**
   * Whether a person has asked this run's graph to pause. Polled by the
   * engine at wave boundaries. A read that fails — a database from before
   * 20260830000400 (PGRST202), or a transient fault — answers false rather
   * than throwing: killing every organization's drain over a pause poll
   * would cost far more than one wave of work the person wanted held, and
   * the claim selector's own pause predicate still stops the next run.
   */
  async readPauseRequested(graphRunId: string): Promise<boolean> {
    try {
      const { data, error } = await this.client.rpc("read_graph_pause_as_worker", {
        p_worker_id: this.workerId,
        p_graph_run_id: graphRunId,
      });
      if (error) return false;
      return data === true;
    } catch {
      return false;
    }
  }

  /**
   * Approve an anchored AUTOMATIC gate after its run has closed.
   *
   * The database refuses everything the rule refuses — human gates, zero
   * anchors, gates a person already decided — so this call is safe to make
   * for every gate the run halted at; the refusal text is the answer when it
   * refuses. Called after `completeRun` deliberately: the claim's reopen rule
   * requires the decision to be newer than the run's close.
   */
  async decideAutomaticGate(nodeId: string): Promise<{ approved: boolean; detail: string }> {
    const { data, error } = await this.client.rpc("decide_automatic_gate_as_worker", {
      p_worker_id: this.workerId,
      p_node_id: nodeId,
    });
    if (error) return { approved: false, detail: error.message ?? "the decision was refused" };
    const state = (data as { state?: string } | null)?.state;
    return {
      approved: state === "APPROVED",
      detail: state === "APPROVED"
        ? "approved on anchored evidence"
        : `gate is ${state ?? "in an unknown state"}`,
    };
  }

  async recordArtifact(
    graphRunId: string,
    kind: "RAW" | "REDUCED" | "SYNTHESIS" | "ANCHOR",
    payload: unknown,
    nodeRunId?: string | null,
  ): Promise<void> {
    const { error } = await this.client.rpc("record_graph_artifact_as_worker", {
      p_worker_id: this.workerId,
      p_graph_run_id: graphRunId,
      p_kind: kind,
      p_payload: payload ?? {},
      p_node_run_id: nodeRunId ?? null,
    });
    if (error) throw new Error(`Recording a graph artifact failed: ${error.message ?? "unknown error"}`);
  }

  async completeReviewerWithVerifications(
    verifierNodeRunId: string,
    artifactPayload: unknown,
    execution: { provider: string; model: string; latencyMs: number },
    verifications: readonly {
      readonly subjectNodeRunId: string;
      readonly verdict: string;
      readonly evidence: readonly string[];
    }[],
  ): Promise<void> {
    const { error } = await this.client.rpc("complete_reviewer_with_verifications_as_worker", {
      p_worker_id: this.workerId,
      p_verifier_node_run_id: verifierNodeRunId,
      p_artifact_payload: artifactPayload ?? {},
      p_provider: execution.provider,
      p_model: execution.model,
      p_latency_ms: execution.latencyMs,
      p_verifications: verifications,
    });
    if (error) {
      throw new Error(`Completing a reviewer with its evidence failed: ${error.message ?? "unknown error"}`);
    }
  }

  async completeRun(
    graphRunId: string,
    state: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED" | "BUDGET_STOPPED",
    hadPartialInput: boolean,
    detail?: string | null,
    usage?: { readonly tokensUsed?: number; readonly costMicros?: number },
  ): Promise<void> {
    /*
     * The wrapper is identical for ordinary and non-completed graph runs. For
     * an exact completed Full Lifecycle v2, it also consumes the already
     * stored MONITOR anchor artifact and advances the same bridge through its
     * monitor and final validation evidence in this transaction. Closing the
     * graph first and adding lineage later would make a lost response an
     * unrecoverable terminal split.
     */
    const { error } = await this.client.rpc("complete_graph_run_with_validated_release_as_worker", {
      p_worker_id: this.workerId,
      p_graph_run_id: graphRunId,
      p_state: state,
      p_had_partial_input: hadPartialInput,
      p_tokens_used: usage?.tokensUsed ?? null,
      p_cost_micros: usage?.costMicros ?? null,
      p_budget_action: state === "BUDGET_STOPPED" ? "STOP_GRACEFULLY" : null,
      // The engine's own assessment of why this run ended as it did. It was
      // computed on every close and discarded on every close: this parameter
      // was named `_detail` because nothing read it.
      p_closure_note: detail ?? null,
    });
    if (error) throw new Error(`Closing the graph run failed: ${error.message ?? "unknown error"}`);
  }

  /**
   * Contain a claim whose returned projection cannot safely enter execution.
   * The database cancels the still-unstarted child set and closes the parent in
   * one transaction, so a parse, repository, or compile refusal cannot strand
   * a RUNNING run behind its already-created PENDING children.
   */
  async abortRun(
    graphRunId: string,
    state: "FAILED" | "CANCELLED",
    detail: string,
  ): Promise<void> {
    const request = {
      p_worker_id: this.workerId,
      p_graph_run_id: graphRunId,
      p_state: state,
      p_detail: detail,
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let error: unknown = null;
      try {
        ({ error } = await this.client.rpc("abort_graph_run_as_worker", request));
      } catch (caught) {
        error = caught;
      }
      if (!error) return;
      if (attempt === 0 && isAmbiguousAbortFailure(error)) continue;
      throw new Error(`Aborting the claimed graph failed: ${rpcFailureMessage(error)}`);
    }
  }
}
