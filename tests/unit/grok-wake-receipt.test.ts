// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { recordGrokWakeDispatch } from "@/lib/grok/wake-dispatch";
import {
  acknowledgeGrokGraphWake,
  assertNoGrokWakePayloadRequired,
} from "@/lib/worker/grok-wake-receipt";

const organizationId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000002";
const sessionId = "30000000-0000-4000-8000-000000000003";
const graphId = "40000000-0000-4000-8000-000000000004";
const graphRunId = "50000000-0000-4000-8000-000000000005";
const wakeIntentId = "60000000-0000-4000-8000-000000000006";
const receiptId = "70000000-0000-4000-8000-000000000007";
const attemptId = "80000000-0000-4000-8000-000000000008";
const workerId = "graph-worker-101-1";
const controlRevision = 17;

describe("Grok initial Resume wake evidence", () => {
  it("records only exact dispatch acceptance through the service boundary", async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: attemptId,
        organization_id: organizationId,
        project_id: projectId,
        session_id: sessionId,
        graph_id: graphId,
        wake_intent_id: wakeIntentId,
        control_revision: controlRevision,
        attempt_number: 1,
        idempotency_key: "wake-dispatch:test-0001",
        outcome: "accepted",
        failure_code: null,
        created_at: "2026-08-31T12:00:00.000Z",
      },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ single });

    await expect(recordGrokWakeDispatch({
      organizationId,
      projectId,
      sessionId,
      graphId,
      wakeIntentId,
      controlRevision,
      outcome: "accepted",
      failureCode: null,
      idempotencyKey: "wake-dispatch:test-0001",
    }, { rpc })).resolves.toMatchObject({ outcome: "accepted", wake_intent_id: wakeIntentId });
    expect(rpc).toHaveBeenCalledWith("record_grok_graph_wake_dispatch_as_server", {
      p_organization_id: organizationId,
      p_wake_intent_id: wakeIntentId,
      p_control_revision: controlRevision,
      p_outcome: "accepted",
      p_failure_code: null,
      p_idempotency_key: "wake-dispatch:test-0001",
    });
  });

  it("rejects mismatched dispatch evidence rather than inferring acceptance", async () => {
    const rpc = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          id: attemptId, organization_id: organizationId, project_id: projectId,
          session_id: sessionId, graph_id: graphId, wake_intent_id: wakeIntentId,
          control_revision: controlRevision + 1, attempt_number: 1,
          idempotency_key: "wake-dispatch:test-0001", outcome: "accepted",
          failure_code: null, created_at: "2026-08-31T12:00:00.000Z",
        },
        error: null,
      }),
    });
    await expect(recordGrokWakeDispatch({
      organizationId, projectId, sessionId, graphId, wakeIntentId,
      controlRevision, outcome: "accepted", failureCode: null,
      idempotencyKey: "wake-dispatch:test-0001",
    }, { rpc })).rejects.toThrow(/mismatched evidence/i);
  });

  it("receipts the exact post-claim graph before provider work", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: receiptId,
        organization_id: organizationId,
        project_id: projectId,
        session_id: sessionId,
        graph_id: graphId,
        graph_run_id: graphRunId,
        wake_intent_id: wakeIntentId,
        control_revision: controlRevision,
        worker_id: workerId,
        protocol_version: 1,
        capability_version: 1,
        acknowledged_at: "2026-08-31T12:01:00.000Z",
      },
      error: null,
    });

    await expect(acknowledgeGrokGraphWake({ rpc } as never, {
      workerId, graphId, graphRunId, wakeIntentId, controlRevision,
    })).resolves.toMatchObject({ worker_id: workerId, protocol_version: 1 });
    expect(rpc).toHaveBeenCalledWith("acknowledge_grok_graph_wake_as_worker", {
      p_worker_id: workerId,
      p_wake_intent_id: wakeIntentId,
      p_control_revision: controlRevision,
      p_graph_id: graphId,
      p_graph_run_id: graphRunId,
      p_protocol_version: 1,
      p_capability_version: 1,
    });
  });

  it("fails closed on a stale or mismatched receipt projection", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: receiptId, organization_id: organizationId, project_id: projectId,
        session_id: sessionId, graph_id: graphId, graph_run_id: graphRunId,
        wake_intent_id: wakeIntentId, control_revision: controlRevision,
        worker_id: "different-worker", protocol_version: 1, capability_version: 1,
        acknowledged_at: "2026-08-31T12:01:00.000Z",
      },
      error: null,
    });
    await expect(acknowledgeGrokGraphWake({ rpc } as never, {
      workerId, graphId, graphRunId, wakeIntentId, controlRevision,
    })).rejects.toThrow(/malformed or mismatched/i);
  });

  it("uses a non-resolving absence guard when no opaque wake payload arrived", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await expect(assertNoGrokWakePayloadRequired({ rpc } as never, {
      workerId, graphId, graphRunId,
    })).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      "assert_no_grok_graph_wake_payload_required_as_worker",
      {
        p_worker_id: workerId,
        p_graph_id: graphId,
        p_graph_run_id: graphRunId,
        p_protocol_version: 1,
        p_capability_version: 1,
      },
    );
  });
});
