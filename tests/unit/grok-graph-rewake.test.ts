import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deliverPendingGrokGraphRewake,
  type GraphRewakeRpcClient,
} from "@/lib/worker/graph-rewake";

const commandId = "11111111-1111-4111-8111-111111111111";
const graphId = "22222222-2222-4222-8222-222222222222";
const claim = Object.freeze({
  app_id: 4582606,
  base_branch: "main",
  bridge_id: "33333333-3333-4333-8333-333333333333",
  command_id: commandId,
  connection_id: "44444444-4444-4444-8444-444444444444",
  external_installation_id: 153479019,
  external_repository_id: 1332327462,
  github_repository_id: "55555555-5555-4555-8555-555555555555",
  graph_id: graphId,
  head_sha: "a".repeat(40),
  intent_id: "66666666-6666-4666-8666-666666666666",
  internal_installation_id: "77777777-7777-4777-8777-777777777777",
  lease_token: "88888888-8888-4888-8888-888888888888",
  organization_id: "99999999-9999-4999-8999-999999999999",
  phase1c_run_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  repository_full_name: "surgeservicesllc/SoftwareFactory",
});

describe("admitted Grok Phase 1C graph re-wake", () => {
  const rpc = vi.fn();
  const dispatch = vi.fn();
  const client = { rpc } as GraphRewakeRpcClient;

  beforeEach(() => {
    rpc.mockReset();
    dispatch.mockReset();
  });

  it("does not lease or dispatch while the independent graph worker gate is off", async () => {
    await expect(deliverPendingGrokGraphRewake({
      client,
      workerId: "github-actions-123-1",
      commandId,
      graphWorkerEnabled: false,
      dispatch,
    })).resolves.toEqual({ state: "worker_disabled", graphId: null });
    expect(rpc).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches only the claimed exact graph and acknowledges every identity", async () => {
    rpc
      .mockResolvedValueOnce({ data: [claim], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    dispatch.mockResolvedValue({ dispatched: true, reason: "dispatched" });

    await expect(deliverPendingGrokGraphRewake({
      client,
      workerId: "github-actions-123-1",
      commandId,
      graphWorkerEnabled: true,
      dispatch,
    })).resolves.toEqual({ state: "dispatched", graphId });

    expect(rpc).toHaveBeenNthCalledWith(1, "claim_grok_graph_rewake_as_worker", {
      p_worker_id: "github-actions-123-1",
      p_command_id: commandId,
      p_lease_seconds: 120,
    });
    expect(dispatch).toHaveBeenCalledWith({
      appId: claim.app_id,
      externalInstallationId: claim.external_installation_id,
      externalRepositoryId: claim.external_repository_id,
      repositoryFullName: claim.repository_full_name,
    }, graphId);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "record_grok_graph_rewake_delivery_as_worker",
      {
        p_worker_id: "github-actions-123-1",
        p_intent_id: claim.intent_id,
        p_lease_token: claim.lease_token,
        p_graph_id: claim.graph_id,
        p_bridge_id: claim.bridge_id,
        p_phase1c_run_id: claim.phase1c_run_id,
        p_command_id: claim.command_id,
        p_accepted: true,
        p_failure_code: null,
      },
    );
  });

  it("treats an already delivered or non-Grok command as an idempotent no-op", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });

    await expect(deliverPendingGrokGraphRewake({
      client,
      workerId: "github-actions-123-1",
      commandId,
      graphWorkerEnabled: true,
      dispatch,
    })).resolves.toEqual({ state: "not_pending", graphId: null });
    expect(dispatch).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses a mismatched or malformed claim before any provider access", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ ...claim, command_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }],
      error: null,
    });

    await expect(deliverPendingGrokGraphRewake({
      client,
      workerId: "github-actions-123-1",
      commandId,
      graphWorkerEnabled: true,
      dispatch,
    })).rejects.toThrow(/exact command identity/i);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("records a failed dispatch as retryable evidence and leaves no false success", async () => {
    rpc
      .mockResolvedValueOnce({ data: claim, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    dispatch.mockRejectedValue(new Error("provider unavailable"));

    await expect(deliverPendingGrokGraphRewake({
      client,
      workerId: "github-actions-123-1",
      commandId,
      graphWorkerEnabled: true,
      dispatch,
    })).rejects.toThrow(/exact graph wake failed/i);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "record_grok_graph_rewake_delivery_as_worker",
      expect.objectContaining({
        p_accepted: false,
        p_failure_code: "dispatch_failed",
        p_graph_id: graphId,
      }),
    );
  });

  it("records a worker-disabled race without claiming that a wake landed", async () => {
    rpc
      .mockResolvedValueOnce({ data: claim, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    dispatch.mockResolvedValue({ dispatched: false, reason: "worker_disabled" });

    await expect(deliverPendingGrokGraphRewake({
      client,
      workerId: "github-actions-123-1",
      commandId,
      graphWorkerEnabled: true,
      dispatch,
    })).resolves.toEqual({ state: "worker_disabled", graphId });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "record_grok_graph_rewake_delivery_as_worker",
      expect.objectContaining({
        p_accepted: false,
        p_failure_code: "worker_disabled",
      }),
    );
  });
});
