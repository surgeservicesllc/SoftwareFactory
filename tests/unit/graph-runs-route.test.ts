// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/tenant", () => ({
  SupabaseTenantError: class SupabaseTenantError extends Error {},
  requireActiveOrganization: harness.requireActiveOrganization,
}));

import { GET } from "@/app/api/graphs/runs/route";

const organizationId = "11111111-1111-4111-8111-111111111111";
const graphRunRow = {
  graph_run_id: "graph-run-1",
  graph_id: "graph-1",
  goal: "Ship a reviewed change",
  topology: "review_loop",
  risk_level: "yellow",
  project_id: "project-1",
  state: "completed",
  had_partial_input: false,
  started_at: "2026-08-21T12:00:00.000Z",
  completed_at: "2026-08-21T12:05:00.000Z",
  nodes: [{ id: "node-1", error: "Internal node detail" }],
  // 20260823000200 widened list_graph_runs with the graph's shape. The stage
  // pages read it, and every graph table revokes SELECT from `authenticated`,
  // so this projection is the only way a browser can see which node waits on
  // which.
  edges: [
    { from_node_key: "review", to_node_key: "test", reason: "VERIFICATION",
      detail: "Tests run against a reviewed change.", is_feedback: false },
  ],
  artifact_counts: { patch: 1 },
  verifications: [
    { verdict: "PASS", summary: "Internal verification detail" },
    { malformed: true },
  ],
  is_lifecycle: true,
  iteration: 2,
  max_iterations: 5,
};

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.rpc.mockResolvedValue({ data: [graphRunRow], error: null });
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    client: { rpc: harness.rpc },
  });
});

describe("graph runs route", () => {
  it("preserves the full default graph-run response", async () => {
    const response = await GET(new Request("https://factory.example/api/graphs/runs?limit=20"));

    await expect(response.json()).resolves.toEqual({
      activeOrganizationId: organizationId,
      runs: [{
        graphRunId: "graph-run-1",
        graphId: "graph-1",
        goal: "Ship a reviewed change",
        topology: "review_loop",
        riskLevel: "yellow",
        projectId: "project-1",
        state: "completed",
        hadPartialInput: false,
        startedAt: "2026-08-21T12:00:00.000Z",
        completedAt: "2026-08-21T12:05:00.000Z",
        nodes: [{ id: "node-1", error: "Internal node detail" }],
        edges: [
          { from_node_key: "review", to_node_key: "test", reason: "VERIFICATION",
            detail: "Tests run against a reviewed change.", is_feedback: false },
        ],
        artifactCounts: { patch: 1 },
        verifications: [
          { verdict: "PASS", summary: "Internal verification detail" },
          { malformed: true },
        ],
        isLifecycle: true,
        iteration: 2,
        maxIterations: 5,
      }],
    });
    expectNoStore(response);
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
    expectNoStore(response);
  });

  it("keeps the graph's shape out of the briefing projection", async () => {
    /*
     * The briefing is a deliberately minimised view — it exists so the
     * dashboard can read eight sources without pulling every run's full
     * detail. `edges` is exactly the kind of field that gets added to the
     * default response and then leaks into the minimised one by being spread
     * rather than named, so this asserts the boundary rather than trusting it.
     *
     * The default row's verifications are deliberately malformed — that is the
     * subject of the test below — and the briefing fails closed on those, so
     * this one supplies a well-formed set to reach the projection at all.
     */
    harness.rpc.mockResolvedValue({
      data: [{ ...graphRunRow, verifications: [{ verdict: "PASS" }] }],
      error: null,
    });
    const response = await GET(new Request(
      "https://factory.example/api/graphs/runs?limit=100&view=briefing",
    ));

    const body = (await response.json()) as { runs: Record<string, unknown>[] };
    expect(body.runs[0]).not.toHaveProperty("edges");
    expect(body.runs[0]).not.toHaveProperty("nodes");
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
