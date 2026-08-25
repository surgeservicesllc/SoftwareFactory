// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  tenantListResponse: vi.fn(),
}));

vi.mock("@/lib/server/tenant-list", () => ({
  tenantRpcListResponse: harness.tenantListResponse,
}));

import { GET } from "@/app/api/runs/route";

const runRow = {
  id: "run-1",
  project_id: "project-1",
  task_id: "task-1",
  agent_id: "agent-1",
  status: "succeeded",
  started_at: "2026-08-21T12:00:00.000Z",
  completed_at: "2026-08-21T12:01:00.000Z",
  created_at: "2026-08-21T11:59:00.000Z",
  task_title: "PRIVATE COMMAND PROMPT DERIVED AS TASK TITLE",
  agent_name: "Release",
  project_name: "Launchpad",
  risk_level: "yellow",
  provider: "openai",
  model: "gpt-5",
  branch_name: "feature/release",
  review_status: "approved",
  archived_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.tenantListResponse.mockImplementation(async (config: {
    rpc: string;
    shape: (rows: Array<typeof runRow>) => Record<string, unknown>;
  }) => Response.json({
    activeOrganizationId: "organization-1",
    ...config.shape([runRow]),
  }));
});

describe("runs route", () => {
  it("preserves the full default run response", async () => {
    const response = await GET(new Request("https://factory.example/api/runs?limit=1"));

    await expect(response.json()).resolves.toEqual({
      activeOrganizationId: "organization-1",
      runs: [{
        id: "run-1",
        status: "succeeded",
        startedAt: "2026-08-21T12:00:00.000Z",
        completedAt: "2026-08-21T12:01:00.000Z",
        createdAt: "2026-08-21T11:59:00.000Z",
        durationMs: 60_000,
        risk: "yellow",
        provider: "openai",
        model: "gpt-5",
        branch: "feature/release",
        reviewStatus: "approved",
        archivedAt: null,
        project: { id: "project-1", name: "Launchpad" },
        task: { id: "task-1", title: "PRIVATE COMMAND PROMPT DERIVED AS TASK TITLE" },
        agent: { id: "agent-1", name: "Release" },
      }],
    });
    expect(harness.tenantListResponse).toHaveBeenCalledWith(expect.objectContaining({
      rpc: "list_agent_runs",
    }));
  });

  it("returns only fields consumed by Factory Briefing", async () => {
    const response = await GET(new Request(
      "https://factory.example/api/runs?limit=100&view=briefing",
    ));

    const body = await response.json();
    expect(body).toEqual({
      activeOrganizationId: "organization-1",
      runs: [{
        id: "run-1",
        status: "succeeded",
        startedAt: "2026-08-21T12:00:00.000Z",
        completedAt: "2026-08-21T12:01:00.000Z",
        createdAt: "2026-08-21T11:59:00.000Z",
        project: { id: "project-1", name: "Launchpad" },
        task: { id: "task-1" },
        agent: { id: "agent-1", name: "Release" },
      }],
    });
    expect(JSON.stringify(body)).not.toContain("PRIVATE COMMAND PROMPT");
  });

  /** Both RPCs the augment reads, with whatever rows a case needs. */
  function graphRpc({
    runs = [] as unknown[],
    links = [] as unknown[],
    runsError = null as unknown,
  } = {}) {
    return vi.fn().mockImplementation(async (name: string) => (
      name === "list_graph_runs"
        ? { data: runsError ? null : runs, error: runsError }
        : { data: links, error: null }
    ));
  }

  async function augmentOf(url = "https://factory.example/api/runs?limit=10") {
    await GET(new Request(url));
    const config = harness.tenantListResponse.mock.calls[0]![0] as {
      augment?: (client: unknown, organizationId: string) => Promise<Record<string, unknown>>;
    };
    expect(config.augment).toBeTypeOf("function");
    return config.augment!;
  }

  const lifecycleRun = {
    graph_run_id: "run-050b35e5",
    tokens_used: "128450",
    cost_micros: "2407311",
    budget_action: "PREFER_CHEAPER_MODEL",
    graph_id: "graph-1",
    goal: "One request through all ten phases",
    project_id: null,
    state: "PARTIAL",
    started_at: "2026-08-25T08:31:01.000Z",
    completed_at: "2026-08-25T08:41:01.000Z",
    artifact_counts: { finding: 2 },
  };

  it("lists a graph run that no command launched", async () => {
    /*
     * The defect this covers: the list read `list_command_analysis_graphs`,
     * so a run reached Runs only through a command link. A run launched from
     * the factory, or one whose command was deleted -- ADR-132 unlinks the
     * command and keeps the run -- stayed readable on the lifecycle surface
     * while Runs showed nothing, which is how run 050b35e5 went missing.
     */
    const augment = await augmentOf();
    const rpc = graphRpc({ runs: [lifecycleRun], links: [] });

    const augmented = await augment({ rpc }, "organization-1") as {
      analysisRuns: Array<Record<string, unknown>>;
    };

    // Explicitly past the function's own default of 20.
    expect(rpc).toHaveBeenCalledWith("list_graph_runs", {
      p_organization_id: "organization-1",
      p_limit: 100,
    });
    expect(augmented.analysisRuns).toHaveLength(1);
    expect(augmented.analysisRuns[0]).toMatchObject({
      id: "analysis:run-050b35e5",
      task: { id: "graph-1", title: "One request through all ten phases" },
      analysis: {
        graphId: "graph-1",
        graphRunId: "run-050b35e5",
        commandId: null,
        artifactCount: 2,
      },
    });
  });

  it("says a partial run finished rather than claiming a worker is still on it", async () => {
    const augment = await augmentOf();
    const rpc = graphRpc({ runs: [lifecycleRun] });

    const { analysisRuns } = await augment({ rpc }, "organization-1") as {
      analysisRuns: Array<{ status: string; durationMs: number | null }>;
    };

    expect(analysisRuns[0]!.status).toBe("partial");
    expect(analysisRuns[0]!.durationMs).toBe(600_000);
  });

  it.each([
    ["COMPLETED", "succeeded"],
    ["FAILED", "failed"],
    ["CANCELLED", "cancelled"],
    ["RUNNING", "running"],
    ["PARTIAL", "partial"],
    ["BUDGET_STOPPED", "budget_stopped"],
    ["PLANNED", "queued"],
    [null, "queued"],
  ])("maps the %s graph state to %s", async (state, expected) => {
    const augment = await augmentOf();
    const rpc = graphRpc({ runs: [{ ...lifecycleRun, state }] });

    const { analysisRuns } = await augment({ rpc }, "organization-1") as {
      analysisRuns: Array<{ status: string }>;
    };

    expect(analysisRuns[0]!.status).toBe(expected);
  });

  it("carries what the run spent, parsing the bigints the driver hands back as strings", async () => {
    const augment = await augmentOf();
    const rpc = graphRpc({ runs: [lifecycleRun] });

    const { analysisRuns } = await augment({ rpc }, "organization-1") as {
      analysisRuns: Array<{ analysis: Record<string, unknown> }>;
    };

    expect(analysisRuns[0]!.analysis).toMatchObject({
      costMicros: 2_407_311,
      tokensUsed: 128_450,
      budgetAction: "PREFER_CHEAPER_MODEL",
    });
  });

  it("leaves spend null when the run recorded none, and when the column is absent", async () => {
    // Two different absences, one honest answer. A zero here would be a
    // measurement of a run nobody measured.
    const augment = await augmentOf();
    const noUsage = { ...lifecycleRun, tokens_used: null, cost_micros: null, budget_action: null };
    const olderDatabase = { ...lifecycleRun };
    delete (olderDatabase as Record<string, unknown>).tokens_used;
    delete (olderDatabase as Record<string, unknown>).cost_micros;
    delete (olderDatabase as Record<string, unknown>).budget_action;

    const { analysisRuns } = await augment(
      { rpc: graphRpc({ runs: [noUsage, { ...olderDatabase, graph_run_id: "run-older" }] }) },
      "organization-1",
    ) as { analysisRuns: Array<{ analysis: Record<string, unknown> }> };

    for (const run of analysisRuns) {
      expect(run.analysis.costMicros).toBeNull();
      expect(run.analysis.tokensUsed).toBeNull();
      expect(run.analysis.budgetAction).toBeNull();
    }
  });

  it("keeps the command a run answers, where a command launched it", async () => {
    const augment = await augmentOf();
    const rpc = graphRpc({
      runs: [lifecycleRun],
      links: [{ command_id: "command-1", graph_id: "graph-1" }],
    });

    const { analysisRuns } = await augment({ rpc }, "organization-1") as {
      analysisRuns: Array<{ analysis: { commandId: string | null } }>;
    };

    expect(analysisRuns[0]!.analysis.commandId).toBe("command-1");
  });

  it("shows each run of a graph rather than collapsing them into one", async () => {
    const augment = await augmentOf();
    const rpc = graphRpc({
      runs: [lifecycleRun, { ...lifecycleRun, graph_run_id: "run-second", state: "COMPLETED" }],
    });

    const { analysisRuns } = await augment({ rpc }, "organization-1") as {
      analysisRuns: Array<{ id: string }>;
    };

    expect(analysisRuns.map((run) => run.id))
      .toEqual(["analysis:run-050b35e5", "analysis:run-second"]);
  });

  it("reads a missing graph-run function as no graph runs, never as a failed list", async () => {
    const augment = await augmentOf();
    const rpc = graphRpc({ runsError: { code: "PGRST202", message: "missing" } });

    await expect(augment({ rpc }, "organization-1")).resolves.toEqual({});
  });

  it("does not augment the briefing view", async () => {
    await GET(new Request("https://factory.example/api/runs?view=briefing"));
    const config = harness.tenantListResponse.mock.calls[0]![0] as { augment?: unknown };
    expect(config.augment).toBeUndefined();
  });
});
