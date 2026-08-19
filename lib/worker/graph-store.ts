import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { GraphRunStore } from "@/lib/worker/graph-run";

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
    });
    if (error) throw new Error(`Claiming a planned graph failed: ${error.message ?? "unknown error"}`);
    return data ?? null;
  }

  async recordNodeState(
    nodeRunId: string,
    state: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "SKIPPED",
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
