// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

vi.mock("server-only", () => ({}));

import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { budgetForTemplate, findTemplate } from "@/lib/graph/templates";
import { ANALYSIS_TEMPLATE_BY_COMMAND_TYPE } from "@/lib/orchestration/analysis-launch";
import {
  createFactoryCommandExecutionIntent,
  createPhase1CExecutionPlan,
} from "@/lib/orchestration/plan";

/**
 * The 20260823000100 doorway, against real PostgreSQL semantics.
 *
 * A record-only Claude command may launch exactly one analysis graph whose
 * goal is the command's own stored prompt. The launch is idempotent through
 * a unique link, refuses every identity it does not serve, and the read
 * reports the latest run state without inventing one.
 */


const ownerId = "00000000-0000-4000-8000-00000000d001";
const outsiderId = "00000000-0000-4000-8000-00000000d002";
const organizationId = "10000000-0000-4000-8000-00000000d001";
const otherOrganizationId = "10000000-0000-4000-8000-00000000d002";
const projectId = "40000000-0000-4000-8000-00000000d001";

let db: PGlite;

async function asUser(userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1::text, false)", [userId]);
  await db.query(
    "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)",
    [userId],
  );
}

/** The record-only Claude parameter shape, from the application's own builders. */
function recordOnlyParameters(commandType: "fix_bug" | "other") {
  const phase1CPlan = createPhase1CExecutionPlan(commandType, {});
  const intent = createFactoryCommandExecutionIntent({
    model: "claude-opus-5",
    phase1CPlan,
    provider: "anthropic",
  });
  if (!intent || intent.executionMode !== "record_only") {
    throw new Error("The fixture expected the Claude identity to classify record-only.");
  }
  return {
    acceptanceCriteria: ["The finding list is recorded"],
    agentRole: phase1CPlan.agentRole,
    budget: phase1CPlan.budget,
    commandType,
    dependencyTaskIds: [],
    executionMode: intent.executionMode,
    model: intent.model,
    plan: intent.plan,
    provider: intent.provider,
    repositoryBinding: {
      appId: 4582606,
      baseBranch: "main",
      baseSha: "0123456789abcdef0123456789abcdef01234567",
      connectionId: "60000000-0000-4000-8000-00000000d001",
      externalInstallationId: 12345678,
      externalRepositoryId: 87654321,
      installationId: "60000000-0000-4000-8000-00000000d002",
      repositoryId: "60000000-0000-4000-8000-00000000d003",
    },
    riskAssessment: { factors: [], reasons: [], requestedRisk: "yellow" },
  };
}

async function makeCommand(commandType: "fix_bug" | "other", prompt: string): Promise<string> {
  await db.exec("reset role");
  const result = await db.query<{ id: string }>(
    `insert into public.commands (organization_id, project_id, submitted_by, prompt, status, parameters)
     values ($1, $2, $3, $4, 'queued'::public.command_status, $5::jsonb) returning id`,
    [organizationId, projectId, ownerId, prompt, JSON.stringify(recordOnlyParameters(commandType))],
  );
  return result.rows[0].id;
}

async function makeManualCommand(prompt: string): Promise<string> {
  const phase1CPlan = createPhase1CExecutionPlan("audit", {});
  await db.exec("reset role");
  const parameters = {
    ...recordOnlyParameters("other"),
    agentRole: phase1CPlan.agentRole,
    commandType: "audit",
    executionMode: "manual",
    model: phase1CPlan.model,
    plan: phase1CPlan.plan,
    provider: phase1CPlan.provider,
  };
  const result = await db.query<{ id: string }>(
    `insert into public.commands (organization_id, project_id, submitted_by, prompt, status, parameters)
     values ($1, $2, $3, $4, 'queued'::public.command_status, $5::jsonb) returning id`,
    [organizationId, projectId, ownerId, prompt, JSON.stringify(parameters)],
  );
  return result.rows[0].id;
}

function analysisPlanArguments() {
  const template = findTemplate(ANALYSIS_TEMPLATE_BY_COMMAND_TYPE.fix_bug);
  if (!template) throw new Error("The bug_sweep analysis template is not registered.");
  const built = buildLaunchPlan(template, budgetForTemplate(template));
  if (!built.ok) throw new Error("The bug_sweep template did not compile.");
  return built.plan;
}

async function launch(commandId: string): Promise<string> {
  const plan = analysisPlanArguments();
  const result = await db.query<{ launch_command_analysis_graph: string }>(
    `select public.launch_command_analysis_graph(
       $1::uuid, $2::uuid, $3::uuid, $4::public.graph_topology, $5::jsonb,
       $6::public.risk_level, $7::boolean, $8::jsonb, $9::jsonb, $10::jsonb
     ) as launch_command_analysis_graph`,
    [
      organizationId, projectId, commandId,
      plan.topology, JSON.stringify(plan.topologyReasons), plan.riskLevel,
      plan.requiresOwnerApproval, JSON.stringify(plan.nodes),
      JSON.stringify(plan.edges), JSON.stringify(plan.budget),
    ],
  );
  return result.rows[0].launch_command_analysis_graph;
}

beforeAll(async () => {
  // The chain, restored from a snapshot rather than replayed; the
  // helper keys its cache on the CONTENT of every migration, and
  // asserts coverage of the whole directory.
  db = await createMigratedDatabase();

  await db.exec(`
    insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');
    insert into public.organizations (id, name, slug, created_by) values
      ('${organizationId}', 'Analysis Co', 'analysis-co', '${ownerId}'),
      ('${otherOrganizationId}', 'Outsider Co', 'outsider-co', '${outsiderId}');
    insert into public.projects (id, organization_id, name, status, created_by) values
      ('${projectId}', '${organizationId}', 'Analysis Project', 'active', '${ownerId}');
    insert into public.organization_members (organization_id, user_id, role) values
      ('${organizationId}', '${ownerId}', 'owner'),
      ('${otherOrganizationId}', '${outsiderId}', 'owner')
    on conflict (organization_id, user_id) do update set role = excluded.role;
  `);
}, 180_000);

beforeEach(async () => {
  await db.exec("reset role");
  await db.exec(`
    delete from public.command_analysis_graphs;
    delete from public.graph_events;
    delete from public.graph_artifacts;
    delete from public.node_runs;
    delete from public.graph_runs;
    delete from public.graph_edges;
    delete from public.graph_nodes;
    delete from public.graph_budgets;
    delete from public.graphs;
    delete from public.tasks;
    delete from public.commands;
  `);
});

afterAll(async () => {
  await db?.close();
});

describe("launch_command_analysis_graph", () => {
  it("launches one graph whose goal is exactly the command's stored prompt", async () => {
    const commandId = await makeCommand("fix_bug", "Fix high-priority bugs");
    await asUser(ownerId);
    const graphId = await launch(commandId);

    await db.exec("reset role");
    const graph = await db.query<{ goal: string; node_count: number }>(
      `select graph.goal,
              (select count(*)::int from public.graph_nodes node where node.graph_id = graph.id) as node_count
         from public.graphs graph where graph.id = $1`,
      [graphId],
    );
    expect(graph.rows[0].goal).toBe("Fix high-priority bugs");
    expect(graph.rows[0].node_count).toBeGreaterThan(0);

    const link = await db.query<{ command_id: string; graph_id: string }>(
      "select command_id, graph_id from public.command_analysis_graphs",
    );
    expect(link.rows).toEqual([{ command_id: commandId, graph_id: graphId }]);

    const event = await db.query<{ count: number }>(
      `select count(*)::int as count from public.activity_events
        where event_type = 'lifecycle.graph_created' and entity_id = $1
          and metadata ->> 'command_id' = $2`,
      [graphId, commandId],
    );
    expect(event.rows[0].count).toBe(1);
  });

  it("is idempotent: a second launch returns the same graph and creates nothing new", async () => {
    const commandId = await makeCommand("fix_bug", "Fix high-priority bugs");
    await asUser(ownerId);
    const first = await launch(commandId);
    const second = await launch(commandId);
    expect(second).toBe(first);

    await db.exec("reset role");
    const counts = await db.query<{ graphs: number; links: number }>(
      `select (select count(*)::int from public.graphs) as graphs,
              (select count(*)::int from public.command_analysis_graphs) as links`,
    );
    expect(counts.rows[0]).toEqual({ graphs: 1, links: 1 });
  });

  it("refuses a manual Codex command and a non-member caller", async () => {
    const manualId = await makeManualCommand("Audit the factory");
    await asUser(ownerId);
    await expect(launch(manualId)).rejects.toThrow(/record-only Claude command/);

    const recordOnlyId = await makeCommand("other", "Summarize project state");
    await asUser(outsiderId);
    await expect(launch(recordOnlyId)).rejects.toThrow(/not_a_member/);
  });

  it("reports the link with no invented run state before a worker claims", async () => {
    const commandId = await makeCommand("fix_bug", "Fix high-priority bugs");
    await asUser(ownerId);
    const graphId = await launch(commandId);

    const listed = await db.query<{
      command_id: string;
      graph_id: string;
      goal: string;
      latest_run_state: string | null;
      artifact_count: number;
    }>(
      "select command_id, graph_id, goal, latest_run_state, artifact_count from public.list_command_analysis_graphs($1::uuid)",
      [organizationId],
    );
    expect(listed.rows).toEqual([{
      command_id: commandId,
      graph_id: graphId,
      goal: "Fix high-priority bugs",
      latest_run_state: null,
      artifact_count: 0,
    }]);

    // A non-member reads zero rows rather than an error.
    await asUser(outsiderId);
    const outsiderRead = await db.query<{ command_id: string }>(
      "select command_id from public.list_command_analysis_graphs($1::uuid)",
      [organizationId],
    );
    expect(outsiderRead.rows).toEqual([]);
  });

  /**
   * Why a run can be readable at /solutions/lifecycle/run/... and absent from
   * /solutions/runs, measured against the real schema rather than argued.
   *
   * The link table answers "which graph did this command launch", so a graph
   * run that no live command points at is not in it -- by design. It is in
   * `list_graph_runs`, which is why the Runs list reads that instead.
   */
  it("does not carry a graph run no live command points at, which list_graph_runs does", async () => {
    const commandId = await makeCommand("fix_bug", "Fix high-priority bugs");
    await asUser(ownerId);
    const graphId = await launch(commandId);

    await db.exec("reset role");
    const run = await db.query<{ id: string }>(
      `insert into public.graph_runs (organization_id, graph_id, created_by, state, started_at)
       values ($1::uuid, $2::uuid, $3::uuid, 'PARTIAL'::public.graph_run_state, now()) returning id`,
      [organizationId, graphId, ownerId],
    );
    const graphRunId = run.rows[0].id;

    // ADR-132: deleting a command unlinks it and keeps the graph, its run and
    // its artifacts. This is that state.
    await db.query("delete from public.command_analysis_graphs where graph_id = $1::uuid", [graphId]);

    await asUser(ownerId);
    const linked = await db.query(
      "select graph_id from public.list_command_analysis_graphs($1::uuid)",
      [organizationId],
    );
    expect(linked.rows).toEqual([]);

    const runs = await db.query<{ graph_run_id: string; state: string }>(
      "select graph_run_id, state from public.list_graph_runs($1::uuid)",
      [organizationId],
    );
    expect(runs.rows).toEqual([{ graph_run_id: graphRunId, state: "PARTIAL" }]);
  });
});
