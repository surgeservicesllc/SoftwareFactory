import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { WORKER_SUPPORTED_EXECUTORS } from "@/lib/worker/executor-support";
import type { GraphRunStore } from "@/lib/worker/graph-run";
import { explainEmptyQueue, type QueueGraphRow } from "@/lib/worker/queue-diagnosis";

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
  ) {}

  static create(options: { url: string; serviceRoleKey: string; workerId: string }) {
    const client = createClient(options.url, options.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return new SupabaseGraphStore(client, options.workerId);
  }

  /** Null when no runnable graph exists — an idle answer, not a fault. */
  async claimPlannedGraph(): Promise<unknown | null> {
    const { data, error } = await this.client.rpc("claim_planned_graph", {
      p_worker_id: this.workerId,
      // Declared, not defaulted: the claim skips graphs whose nodes need an
      // executor this worker does not provide, so those graphs keep their
      // budget for a worker that can run them.
      p_supported_executors: [...WORKER_SUPPORTED_EXECUTORS],
    });
    if (error) throw new Error(`Claiming a planned graph failed: ${error.message ?? "unknown error"}`);
    return data ?? null;
  }

  /**
   * One line per graph saying which claim filter excludes it, for the log a
   * person reads after "nothing ran". Read-only over the same rows the claim
   * consults; ids, states, counts and executor names only — never goal text.
   */
  async explainEmptyQueue(): Promise<readonly string[]> {
    const { data, error } = await this.client
      .from("graphs")
      .select(
        "id, requires_owner_approval, is_lifecycle, created_at, "
        + "graph_nodes(executor), graph_runs(state, completed_at), "
        + "graph_gates(state, opened_at, decided_at)",
      )
      .order("created_at", { ascending: true })
      .limit(25);
    if (error) {
      return [`Queue diagnosis unavailable: ${error.message ?? "the read failed"}.`];
    }
    return explainEmptyQueue((data ?? []) as unknown as QueueGraphRow[], WORKER_SUPPORTED_EXECUTORS);
  }

  async recordNodeState(
    nodeRunId: string,
    state: "RUNNING" | "COMPLETED" | "VERIFYING" | "FAILED" | "CANCELLED" | "SKIPPED",
    detail?: string | null,
    execution?: { provider?: string; model?: string; latencyMs?: number },
  ): Promise<void> {
    const { error } = await this.client.rpc("record_node_state_as_worker", {
      p_worker_id: this.workerId,
      p_node_run_id: nodeRunId,
      p_state: state,
      p_detail: detail ?? null,
      p_provider: execution?.provider ?? null,
      p_model: execution?.model ?? null,
      p_latency_ms: execution?.latencyMs ?? null,
    });
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

  async recordVerification(
    subjectNodeRunId: string,
    lens: string,
    verdict: string,
    evidence: readonly string[],
    verifierProvider: string | null,
  ): Promise<void> {
    const { error } = await this.client.rpc("record_verification_as_worker", {
      p_worker_id: this.workerId,
      p_subject_node_run_id: subjectNodeRunId,
      p_lens: lens,
      p_verdict: verdict,
      p_evidence: evidence,
      p_verifier_provider: verifierProvider,
      // Every node is a fresh session that received only its declared
      // inputs, so the verifier genuinely shares no context with the subject.
      // Recording it as true would be a lie that weakens every row here.
      p_shared_worker_context: false,
    });
    if (error) throw new Error(`Recording a verification failed: ${error.message ?? "unknown error"}`);
  }

  async completeRun(
    graphRunId: string,
    state: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED" | "BUDGET_STOPPED",
    hadPartialInput: boolean,
    _detail?: string | null,
    usage?: { readonly tokensUsed?: number; readonly costMicros?: number },
  ): Promise<void> {
    const { error } = await this.client.rpc("complete_graph_run_as_worker", {
      p_worker_id: this.workerId,
      p_graph_run_id: graphRunId,
      p_state: state,
      p_had_partial_input: hadPartialInput,
      p_tokens_used: usage?.tokensUsed ?? null,
      p_cost_micros: usage?.costMicros ?? null,
      p_budget_action: state === "BUDGET_STOPPED" ? "STOP_GRACEFULLY" : null,
    });
    if (error) throw new Error(`Closing the graph run failed: ${error.message ?? "unknown error"}`);
  }
}
