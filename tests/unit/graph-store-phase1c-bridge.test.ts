import { describe, expect, it, vi } from "vitest";

import { SupabaseGraphStore } from "@/lib/worker/graph-store";

function storeWith(rpc: ReturnType<typeof vi.fn>) {
  const store = Object.create(SupabaseGraphStore.prototype) as SupabaseGraphStore;
  Object.assign(store, {
    client: { rpc },
    workerId: "graph-worker-test",
    repositoryFullName: "owner/repository",
    requiredCheckNames: ["CI"],
    targetGraphId: "10000000-0000-4000-8000-000000000099",
  });
  return store;
}

const completion = {
  graphRunId: "10000000-0000-4000-8000-000000000001",
  state: "COMPLETED" as const,
  hadPartialInput: false,
  detail: null,
  usage: { tokensUsed: 21, costMicros: 0 },
};

describe("SupabaseGraphStore Full Lifecycle terminal boundary", () => {
  it("claims graphs only through protocol v2", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const store = storeWith(rpc);

    await expect(store.claimPlannedGraph()).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith("claim_planned_graph_v2", {
      p_worker_id: "graph-worker-test",
      p_supported_executors: ["DETERMINISTIC", "MODEL", "ANCHOR"],
      p_repository_full_name: "owner/repository",
      p_required_check_names: ["CI"],
      p_protocol_version: 2,
    });
    expect(rpc).not.toHaveBeenCalledWith("claim_planned_graph", expect.anything());
  });

  it("atomically completes a reviewer with its exact verification batch", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const store = storeWith(rpc);

    await store.completeReviewerWithVerifications(
      "20000000-0000-4000-8000-000000000001",
      { findings: ["review completed"] },
      { provider: "anthropic", model: "claude-sonnet", latencyMs: 27 },
      [{
        subjectNodeRunId: "20000000-0000-4000-8000-000000000002",
        verdict: "PASS",
        evidence: ["exact security evidence"],
      }],
    );

    expect(rpc).toHaveBeenCalledWith("complete_reviewer_with_verifications_as_worker", {
      p_worker_id: "graph-worker-test",
      p_verifier_node_run_id: "20000000-0000-4000-8000-000000000001",
      p_artifact_payload: { findings: ["review completed"] },
      p_provider: "anthropic",
      p_model: "claude-sonnet",
      p_latency_ms: 27,
      p_verifications: [{
        subjectNodeRunId: "20000000-0000-4000-8000-000000000002",
        verdict: "PASS",
        evidence: ["exact security evidence"],
      }],
    });
    expect(rpc).not.toHaveBeenCalledWith("record_verification_as_worker", expect.anything());
  });

  it("reads reusable outputs only through protocol v2 with execution identity", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        node_key: "review",
        payload: { blocked: false },
        provider: "openai",
        model: "gpt-5.3-codex",
      }],
      error: null,
    });
    const store = storeWith(rpc);

    await expect(store.readPriorNodeResults(
      "10000000-0000-4000-8000-000000000001",
    )).resolves.toEqual(new Map([
      ["review", {
        output: { blocked: false },
        provider: "openai",
        model: "gpt-5.3-codex",
      }],
    ]));
    expect(rpc).toHaveBeenCalledWith("read_prior_node_results_as_worker_v2", {
      p_worker_id: "graph-worker-test",
      p_graph_id: "10000000-0000-4000-8000-000000000001",
      p_protocol_version: 2,
    });
    expect(rpc).not.toHaveBeenCalledWith(
      "read_prior_node_results_as_worker",
      expect.anything(),
    );
  });

  it("diagnoses an empty queue through the bounded worker RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const store = storeWith(rpc);

    const lines = await store.explainEmptyQueue();

    expect(rpc).toHaveBeenCalledWith("diagnose_graph_queue_as_worker_v2", {
      p_worker_id: "graph-worker-test",
      p_repository_full_name: "owner/repository",
      p_required_check_names: ["CI"],
      p_target_graph_id: "10000000-0000-4000-8000-000000000099",
      p_protocol_version: 2,
    });
    expect(lines[0]).toContain(
      "target graph 10000000-0000-4000-8000-000000000099 was not found in this repository scope",
    );
    expect(rpc).not.toHaveBeenCalledWith("diagnose_graph_queue_as_worker", expect.anything());
  });

  it("uses the crash-atomic graph/monitor/validation completion RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const store = storeWith(rpc);

    await store.completeRun(
      completion.graphRunId,
      completion.state,
      completion.hadPartialInput,
      completion.detail,
      completion.usage,
    );

    expect(rpc).toHaveBeenCalledWith("complete_graph_run_with_phase1c_bridge_as_worker", {
      p_worker_id: "graph-worker-test",
      p_graph_run_id: completion.graphRunId,
      p_state: "COMPLETED",
      p_had_partial_input: false,
      p_tokens_used: 21,
      p_cost_micros: 0,
      p_budget_action: null,
      p_closure_note: null,
    });
    expect(rpc).not.toHaveBeenCalledWith("complete_graph_run_as_worker", expect.anything());
  });

  it("uses the atomic abort RPC for an unusable pre-execution claim", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const store = storeWith(rpc);
    const detail = "The returned claim projection did not compile.";

    await store.abortRun(completion.graphRunId, "FAILED", detail);
    await store.abortRun(completion.graphRunId, "FAILED", detail);

    expect(rpc).toHaveBeenCalledWith("abort_graph_run_as_worker", {
      p_worker_id: "graph-worker-test",
      p_graph_run_id: completion.graphRunId,
      p_state: "FAILED",
      p_detail: detail,
    });
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc).not.toHaveBeenCalledWith(
      "complete_graph_run_with_phase1c_bridge_as_worker",
      expect.anything(),
    );
  });

  it("retries one identical abort after an ambiguous lost response", async () => {
    const rpc = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed after the response was lost"))
      .mockResolvedValueOnce({ data: {}, error: null });
    const store = storeWith(rpc);
    const detail = "The claimed graph projection failed protocol-v2 validation.";

    await expect(store.abortRun(completion.graphRunId, "FAILED", detail)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  });

  it("does not retry a deterministic abort refusal", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "22023", message: "graph abort request does not match terminal replay" },
    });
    const store = storeWith(rpc);

    await expect(store.abortRun(
      completion.graphRunId,
      "FAILED",
      "A conflicting request.",
    )).rejects.toThrow("does not match terminal replay");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("propagates a bridge mismatch instead of closing through the legacy fallback", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "monitor deployment identity mismatch" },
    });
    const store = storeWith(rpc);

    await expect(store.completeRun(
      completion.graphRunId,
      completion.state,
      completion.hadPartialInput,
      completion.detail,
      completion.usage,
    )).rejects.toThrow("monitor deployment identity mismatch");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("replays the same terminal identity without changing any input", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const store = storeWith(rpc);

    await store.completeRun(
      completion.graphRunId,
      completion.state,
      completion.hadPartialInput,
      completion.detail,
      completion.usage,
    );
    await store.completeRun(
      completion.graphRunId,
      completion.state,
      completion.hadPartialInput,
      completion.detail,
      completion.usage,
    );

    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  });
});
