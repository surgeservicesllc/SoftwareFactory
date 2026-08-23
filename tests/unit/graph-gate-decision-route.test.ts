// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  dispatchGraphWorker: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));
vi.mock("@/lib/orchestration/dispatch", () => ({
  dispatchGraphWorker: harness.dispatchGraphWorker,
}));

import { POST } from "@/app/api/graph-gates/[gateId]/decide/route";

const gateId = "a0000000-0000-4000-8000-000000000001";

function request(body: unknown, origin = "https://factory.example") {
  return new Request(`https://factory.example/api/graph-gates/${gateId}/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ gateId }) };

const graphId = "b0000000-0000-4000-8000-000000000002";
const projectId = "c0000000-0000-4000-8000-000000000003";

const targetRow = {
  app_id: 7,
  external_installation_id: 1234,
  external_repository_id: 5678,
  repository_full_name: "owner/repository",
};

/** A read chain: .select().eq().single() resolving to the given row. */
function tableRead(row: unknown) {
  return {
    select: () => ({ eq: () => ({ single: async () => ({ data: row, error: null }) }) }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: "10000000-0000-4000-8000-000000000001", role: "owner" },
    client: { rpc: harness.rpc, from: harness.from },
  });
  harness.rpc.mockImplementation((functionName: string) => {
    if (functionName === "resolve_phase1c_command_target") {
      return { single: async () => ({ data: targetRow, error: null }) };
    }
    return Promise.resolve({
      data: { id: gateId, state: "APPROVED", stage: "ARCHITECTURE", kind: "HUMAN", reason: null },
      error: null,
    });
  });
  harness.from.mockImplementation((table: string) =>
    table === "graph_gates" ? tableRead({ graph_id: graphId }) : tableRead({ project_id: projectId }),
  );
  harness.dispatchGraphWorker.mockResolvedValue(undefined);
});

describe("deciding a lifecycle gate", () => {
  it("records an approval and wakes the worker to continue the gate's own graph", async () => {
    const response = await POST(request({ approved: true }), params);
    const body = (await response.json()) as {
      gate: { state: string }; workerWoken: boolean; note: string;
    };

    expect(response.status).toBe(200);
    expect(harness.rpc).toHaveBeenCalledWith("decide_node_gate", {
      p_gate_id: gateId,
      p_approved: true,
      p_reason: null,
    });
    expect(body.gate.state).toBe("APPROVED");
    expect(body.workerWoken).toBe(true);
    expect(body.note).toContain("woken");
    expect(harness.dispatchGraphWorker).toHaveBeenCalledWith(
      {
        appId: targetRow.app_id,
        externalInstallationId: targetRow.external_installation_id,
        externalRepositoryId: targetRow.external_repository_id,
        repositoryFullName: targetRow.repository_full_name,
      },
      graphId,
    );
  });

  it("keeps the decision's answer independent of a wake that cannot happen", async () => {
    // No verified binding resolves: the decision is still recorded, and the
    // note says plainly that nothing runs until the next dispatch.
    harness.from.mockImplementation(() => tableRead(null));

    const response = await POST(request({ approved: true }), params);
    const body = (await response.json()) as { gate: { state: string }; workerWoken: boolean; note: string };

    expect(response.status).toBe(200);
    expect(body.gate.state).toBe("APPROVED");
    expect(body.workerWoken).toBe(false);
    expect(body.note).toContain("next scheduled or manual dispatch");
    expect(harness.dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("treats a rejection as a decision, not a failure, and wakes nothing", async () => {
    harness.rpc.mockImplementation((functionName: string) => {
      if (functionName === "resolve_phase1c_command_target") {
        return { single: async () => ({ data: targetRow, error: null }) };
      }
      return Promise.resolve({
        data: { id: gateId, state: "REJECTED", stage: "TEST", kind: "AUTOMATIC", reason: "no evidence" },
        error: null,
      });
    });

    const response = await POST(request({ approved: false, reason: "no evidence" }), params);
    const body = (await response.json()) as { gate: { state: string; reason: string } };

    expect(response.status).toBe(200);
    expect(body.gate).toMatchObject({ state: "REJECTED", reason: "no evidence" });
    // The stage staying blocked IS the outcome; there is nothing to continue.
    expect(harness.dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("passes the database's own refusal through on a human gate", async () => {
    // The sentence this repository wrote, not a generic 403. A caller who is
    // told only "forbidden" cannot tell an authority refusal from a bug.
    harness.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "owner or admin role is required to decide a human gate" },
    });

    const response = await POST(request({ approved: true }), params);
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(403);
    expect(body.error.message).toContain("owner or admin role is required");
  });

  it("passes the evidence refusal through on an automatic gate", async () => {
    harness.rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "an automatic gate cannot approve without anchored evidence" },
    });

    const response = await POST(request({ approved: true }), params);
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("anchored evidence");
  });

  it("refuses a request that did not come from this origin", async () => {
    const response = await POST(request({ approved: true }, "https://evil.example"), params);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("refuses a body that does not say what was decided", async () => {
    const response = await POST(request({ reason: "looks fine" }), params);

    expect(response.status).toBe(400);
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("refuses a gate identifier that is not a uuid", async () => {
    const response = await POST(request({ approved: true }), {
      params: Promise.resolve({ gateId: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    expect(harness.rpc).not.toHaveBeenCalled();
  });
});
