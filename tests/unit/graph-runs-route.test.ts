// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  in: vi.fn(),
}));

vi.mock("@/lib/supabase/tenant", () => ({
  SupabaseTenantError: class SupabaseTenantError extends Error {},
  requireActiveOrganization: harness.requireActiveOrganization,
}));

import { GET } from "@/app/api/graphs/runs/route";

const organizationId = "11111111-1111-4111-8111-111111111111";
const graphId = "22222222-2222-4222-8222-222222222222";
const graphRunRow = {
  graph_run_id: "graph-run-1",
  graph_id: graphId,
  goal: "Ship a reviewed change",
  topology: "review_loop",
  risk_level: "yellow",
  project_id: "project-1",
  state: "completed",
  had_partial_input: false,
  closure_note: "Nine of eleven nodes reported. 2 halted at an open lifecycle gate.",
  started_at: "2026-08-21T12:00:00.000Z",
  completed_at: "2026-08-21T12:05:00.000Z",
  nodes: [{ id: "node-1", error: "Internal node detail" }],
  artifact_counts: { patch: 1 },
  verifications: [
    { verdict: "PASS", summary: "Internal verification detail" },
    { malformed: true },
  ],
  is_lifecycle: true,
  iteration: 2,
  max_iterations: 5,
};

/** The same row, as a database that has recorded spend returns it. */
const spentRow = {
  ...graphRunRow,
  tokens_used: "128450",
  cost_micros: "2407311",
  budget_action: "PREFER_CHEAPER_MODEL",
  discovery_rounds: 3,
};

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.rpc.mockResolvedValue({ data: [graphRunRow], error: null });
  harness.in.mockResolvedValue({
    data: [{ id: graphId, template_key: "full_lifecycle", template_version: 2 }],
    error: null,
  });
  harness.eq.mockReturnValue({ in: harness.in });
  harness.select.mockReturnValue({ eq: harness.eq });
  harness.from.mockReturnValue({ select: harness.select });
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    client: { from: harness.from, rpc: harness.rpc },
  });
});

describe("graph runs route", () => {
  it("preserves the full default graph-run response", async () => {
    const response = await GET(new Request("https://factory.example/api/graphs/runs?limit=20"));

    await expect(response.json()).resolves.toEqual({
      activeOrganizationId: organizationId,
      runs: [{
        graphRunId: "graph-run-1",
        graphId,
        goal: "Ship a reviewed change",
        topology: "review_loop",
        riskLevel: "yellow",
        projectId: "project-1",
        state: "completed",
        hadPartialInput: false,
        closureNote: "Nine of eleven nodes reported. 2 halted at an open lifecycle gate.",
        startedAt: "2026-08-21T12:00:00.000Z",
        completedAt: "2026-08-21T12:05:00.000Z",
        // The row this case feeds carries no spend, and the projection says so
        // rather than reporting a run that cost nothing.
        tokensUsed: null,
        costMicros: null,
        budgetAction: null,
        discoveryRounds: null,
        nodes: [{ id: "node-1", error: "Internal node detail" }],
        artifactCounts: { patch: 1 },
        verifications: [
          { verdict: "PASS", summary: "Internal verification detail" },
          { malformed: true },
        ],
        isLifecycle: true,
        templateKey: "full_lifecycle",
        templateVersion: 2,
        pausedAt: null,
        withdrawnAt: null,
        iteration: 2,
        maxIterations: 5,
      }],
    });
    expect(harness.from).toHaveBeenCalledExactlyOnceWith("graphs");
    expect(harness.select).toHaveBeenCalledExactlyOnceWith(
      "id,template_key,template_version,withdrawn_at,pause_requested_at",
    );
    expect(harness.eq).toHaveBeenCalledExactlyOnceWith("organization_id", organizationId);
    expect(harness.in).toHaveBeenCalledExactlyOnceWith("id", [graphId]);
    expectNoStore(response);
  });

  it("reports legacy lifecycle identity as absent instead of inferring v2 from its stages", async () => {
    harness.in.mockResolvedValue({
      data: [{ id: graphId, template_key: null, template_version: null }],
      error: null,
    });

    const response = await GET(new Request("https://factory.example/api/graphs/runs"));
    const body = await response.json() as { runs: Array<Record<string, unknown>> };

    expect(body.runs[0]).toMatchObject({
      graphId,
      isLifecycle: true,
      templateKey: null,
      templateVersion: null,
    });
  });

  it("projects the graph's recorded run controls, so paused reads as paused", async () => {
    harness.in.mockResolvedValue({
      data: [{
        id: graphId,
        template_key: "full_lifecycle",
        template_version: 2,
        withdrawn_at: null,
        pause_requested_at: "2026-08-30T08:00:00.000Z",
      }],
      error: null,
    });

    const response = await GET(new Request("https://factory.example/api/graphs/runs"));
    const body = await response.json() as { runs: Array<Record<string, unknown>> };

    expect(body.runs[0]).toMatchObject({
      pausedAt: "2026-08-30T08:00:00.000Z",
      withdrawnAt: null,
    });
  });

  it("answers through the deploy window: a database without the control columns still lists runs", async () => {
    // 42703 is "undefined column" — the exact shape of a build deployed
    // before its hosted apply. The listing must not go dark for that window.
    harness.in
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column graphs.pause_requested_at does not exist" } })
      .mockResolvedValueOnce({
        data: [{ id: graphId, template_key: "full_lifecycle", template_version: 2 }],
        error: null,
      });

    const response = await GET(new Request("https://factory.example/api/graphs/runs"));
    expect(response.status).toBe(200);
    const body = await response.json() as { runs: Array<Record<string, unknown>> };
    expect(body.runs[0]).toMatchObject({ pausedAt: null, withdrawnAt: null });
    expect(harness.select).toHaveBeenNthCalledWith(
      1, "id,template_key,template_version,withdrawn_at,pause_requested_at",
    );
    expect(harness.select).toHaveBeenNthCalledWith(2, "id,template_key,template_version");
  });

  it("fails closed when an RLS-scoped graph identity is missing", async () => {
    harness.in.mockResolvedValue({ data: [], error: null });

    const response = await GET(new Request("https://factory.example/api/graphs/runs"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "graph_runs_unavailable",
        message: "Graph runs could not be loaded.",
      },
    });
    expectNoStore(response);
  });

  it("reports what the run spent, parsing the bigints as numbers", async () => {
    // The worker has written these four since 20260819000100; nothing read
    // them until 20260825000200. postgrest hands bigints back as strings.
    harness.rpc.mockResolvedValue({ data: [spentRow], error: null });

    const response = await GET(new Request("https://factory.example/api/graphs/runs"));
    const body = await response.json() as { runs: Array<Record<string, unknown>> };

    expect(body.runs[0]).toMatchObject({
      tokensUsed: 128_450,
      costMicros: 2_407_311,
      budgetAction: "PREFER_CHEAPER_MODEL",
      discoveryRounds: 3,
    });
  });

  it("returns only summary fields and verification verdicts for Factory Briefing", async () => {
    harness.rpc.mockResolvedValue({
      data: [{
        ...graphRunRow,
        verifications: [{ verdict: "PASS", summary: "Internal verification detail" }],
      }],
      error: null,
    });
    const response = await GET(new Request(
      "https://factory.example/api/graphs/runs?limit=100&view=briefing",
    ));

    await expect(response.json()).resolves.toEqual({
      activeOrganizationId: organizationId,
      runs: [{
        graphRunId: "graph-run-1",
        goal: "Ship a reviewed change",
        topology: "review_loop",
        state: "completed",
        startedAt: "2026-08-21T12:00:00.000Z",
        completedAt: "2026-08-21T12:05:00.000Z",
        verifications: [{ verdict: "PASS" }],
      }],
    });
    expect(harness.rpc).toHaveBeenCalledExactlyOnceWith("list_graph_runs", {
      p_organization_id: organizationId,
      p_limit: 100,
    });
    expect(harness.from).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it.each([
    ["a non-array value", null],
    ["a mixed malformed array", [{ verdict: "PASS" }, { malformed: true }]],
  ])("fails the briefing closed for %s instead of hiding missing verification evidence", async (_label, verifications) => {
    harness.rpc.mockResolvedValue({ data: [{ ...graphRunRow, verifications }], error: null });

    const response = await GET(new Request(
      "https://factory.example/api/graphs/runs?limit=100&view=briefing",
    ));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "graph_runs_unavailable",
        message: "Graph runs could not be loaded.",
      },
    });
    expectNoStore(response);
  });
});
