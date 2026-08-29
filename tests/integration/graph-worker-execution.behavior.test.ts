// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { NodeExecutionResult } from "@/lib/graph/runner";
import { WORKER_SUPPORTED_EXECUTORS } from "@/lib/worker/executor-support";
import {
  compileClaimedGraph,
  parseClaimedGraph,
  runClaimedGraph,
  type GraphRunStore,
  type NodeInputs,
} from "@/lib/worker/graph-run";

/**
 * The graph executor's whole path, against the real migrated schema.
 *
 * A member records a diamond graph through `create_graph_from_plan` — the
 * exact write the console performs — and the worker boundary from migration
 * 20260819000100 claims it, executes it with an injected node executor, and
 * persists every transition through the same `*_as_worker` functions the
 * production worker calls. What these tests defend:
 *
 *   - The claim is atomic and complete: run + node_runs + projection in one
 *     call, second claimer finds nothing, approval-gated graphs wait.
 *   - Independent nodes genuinely run together (the diamond's three
 *     inspectors dispatch in one wave).
 *   - One failed branch is contained: its dependents are SKIPPED, its
 *     siblings COMPLETE, and the run closes PARTIAL — never COMPLETED.
 *   - Terminal states are final on both nodes and runs.
 *   - A graph whose only runs FAILED is re-claimable (infrastructure faults
 *     retry without re-planning), bounded at three failed attempts; runs that
 *     reached an answer — COMPLETED, PARTIAL — keep their graph closed.
 *   - Edges carry data: a fan-in node receives its upstreams' actual outputs.
 *   - A run refused entirely by provider capacity closes CANCELLED — void,
 *     not a spent chance — and a hard ceiling on total runs still converges.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000000d1";
const organizationId = "10000000-0000-4000-8000-0000000000d1";
const projectId = "20000000-0000-4000-8000-0000000000d1";
const connectionId = "30000000-0000-4000-8000-0000000000d1";
const installationId = "40000000-0000-4000-8000-0000000000d1";
const repositoryId = "50000000-0000-4000-8000-0000000000d1";
const repositoryFullName = "factory/graph-worker";
const projectProductionUrl = "https://factory.example.test";
const requiredCheckNames = ["CI"] as const;

async function asOwner(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  await db.exec("set role authenticated");
}

async function asServiceRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec("set role service_role");
}

async function reset(db: PGlite) {
  await db.exec("reset role");
}

/** The production store's shape, over PGlite instead of supabase-js. */
function pgliteStore(db: PGlite, workerId: string): GraphRunStore {
  return {
    async recordNodeState(nodeRunId, state, detail, execution) {
      await asServiceRole(db);
      try {
        await db.query(
          "select public.record_node_state_as_worker($1, $2::uuid, $3::public.graph_node_state, $4, $5, $6, $7)",
          [workerId, nodeRunId, state, detail ?? null, execution?.provider ?? null, execution?.model ?? null, execution?.latencyMs ?? null],
        );
      } finally {
        await reset(db);
      }
    },
    async recordArtifact(graphRunId, kind, payload, nodeRunId) {
      await asServiceRole(db);
      try {
        await db.query(
          "select public.record_graph_artifact_as_worker($1, $2::uuid, $3::public.graph_artifact_kind, $4::jsonb, $5::uuid)",
          [workerId, graphRunId, kind, JSON.stringify(payload ?? {}), nodeRunId ?? null],
        );
      } finally {
        await reset(db);
      }
    },
    async readPriorNodeResults(graphId) {
      await asServiceRole(db);
      try {
        const result = await db.query<{
          model: string | null;
          node_key: string;
          payload: unknown;
          provider: string | null;
        }>(
          `select node_key, payload, provider, model
             from public.read_prior_node_results_as_worker_v2($1, $2::uuid, 2)`,
          [workerId, graphId],
        );
        return new Map(result.rows.map((row) => [row.node_key, {
          output: row.payload,
          provider: row.provider ?? undefined,
          model: row.model ?? undefined,
        }]));
      } finally {
        await reset(db);
      }
    },
    async openGate(nodeId, graphRunId, anchorCount) {
      await asServiceRole(db);
      try {
        await db.query(
          "select public.open_node_gate_as_worker($1, $2::uuid, $3::uuid, $4)",
          [workerId, nodeId, graphRunId, anchorCount],
        );
      } finally {
        await reset(db);
      }
    },
    async completeReviewerWithVerifications(verifierNodeRunId, artifactPayload, execution, verifications) {
      await asServiceRole(db);
      try {
        await db.query(
          `select public.complete_reviewer_with_verifications_as_worker(
             $1, $2::uuid, $3::jsonb, $4, $5, $6, $7::jsonb
           )`,
          [workerId, verifierNodeRunId, JSON.stringify(artifactPayload),
            execution.provider, execution.model, execution.latencyMs,
            JSON.stringify(verifications)],
        );
      } finally {
        await reset(db);
      }
    },
    async completeRun(graphRunId, state, hadPartialInput, detail, usage) {
      await asServiceRole(db);
      try {
        await db.query(
          "select public.complete_graph_run_with_phase1c_bridge_as_worker($1, $2::uuid, $3::public.graph_run_state, $4, $5, $6, null, $7)",
          [
            workerId, graphRunId, state, hadPartialInput,
            usage?.tokensUsed ?? null, usage?.costMicros ?? null, detail ?? null,
          ],
        );
      } finally {
        await reset(db);
      }
    },
  };
}

const DIAMOND_NODES = JSON.stringify([
  { node_key: "inspect_a", job: "Inspect area A", executor: "MODEL", capability: "extraction", max_attempts: 1 },
  { node_key: "inspect_b", job: "Inspect area B", executor: "MODEL", capability: "extraction", max_attempts: 1 },
  { node_key: "inspect_c", job: "Inspect area C", executor: "MODEL", capability: "extraction", max_attempts: 1 },
  { node_key: "synthesize", job: "Synthesize the three inspections", executor: "MODEL", capability: "synthesis", max_attempts: 1 },
]);

const DIAMOND_EDGES = JSON.stringify([
  { from_node_key: "inspect_a", to_node_key: "synthesize", reason: "DATA", detail: "synthesis consumes inspection A" },
  { from_node_key: "inspect_b", to_node_key: "synthesize", reason: "DATA", detail: "synthesis consumes inspection B" },
  { from_node_key: "inspect_c", to_node_key: "synthesize", reason: "DATA", detail: "synthesis consumes inspection C" },
]);

// These persistence/state-machine tests intentionally return several output
// shapes. They still declare a real contract so the production worker's
// fail-closed rehydration is exercised; shape-specific rejection lives in the
// focused graph-worker-output-contract suite.
const TEST_OUTPUT_SCHEMA = {
  anyOf: [
    { type: "object" },
    { type: "array" },
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
  ],
};

function withTestContracts(nodesJson: string): string {
  const nodes = JSON.parse(nodesJson) as Array<Record<string, unknown>>;
  return JSON.stringify(nodes.map((node) => ({
    ...node,
    input_schema: node.input_schema ?? {},
    output_schema: node.output_schema ?? TEST_OUTPUT_SCHEMA,
  })));
}

describe("the graph executor boundary", { timeout: 180_000 }, () => {
  let db: PGlite;

  async function createDiamondGraph(
    goal: string,
    requiresApproval = false,
    nodesJson: string = DIAMOND_NODES,
    edgesJson: string = DIAMOND_EDGES,
  ): Promise<string> {
    await asOwner(db);
    const created = await db.query<{ create_graph_from_plan: string }>(
      `select public.create_graph_from_plan(
         $1::uuid, $2::uuid, $3, 'DIAMOND'::public.graph_topology, '[]'::jsonb,
         'green'::public.risk_level, $4, $5::jsonb, $6::jsonb, '{}'::jsonb)`,
      [organizationId, projectId, goal, requiresApproval, withTestContracts(nodesJson), edgesJson],
    );
    await reset(db);
    return created.rows[0].create_graph_from_plan;
  }

  async function claim(
    workerId = "graph-worker-test",
    supported: readonly string[] = WORKER_SUPPORTED_EXECUTORS,
  ): Promise<unknown> {
    await asServiceRole(db);
    const claimed = await db.query<{ claim_planned_graph_v2: unknown }>(
      "select public.claim_planned_graph_v2($1, $2::text[], $3, $4::jsonb, 2)",
      [workerId, supported, repositoryFullName, JSON.stringify(requiredCheckNames)],
    );
    await reset(db);
    return claimed.rows[0].claim_planned_graph_v2;
  }

  async function skipFreshClaimNodes(
    store: GraphRunStore,
    nodes: readonly { readonly node_run_id: string }[],
  ): Promise<void> {
    for (const node of nodes) {
      await store.recordNodeState(
        node.node_run_id,
        "SKIPPED",
        "test fixture intentionally did not execute this node",
      );
    }
  }

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);

    const files = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Factory', 'factory-graph-worker', '${ownerId}');
      insert into public.projects (
        id, organization_id, name, status, github_repository, default_branch,
        production_url, created_by
      ) values (
        '${projectId}', '${organizationId}', 'Graph Project', 'active',
        '${repositoryFullName}', 'main', '${projectProductionUrl}', '${ownerId}'
      );
      insert into public.connections (
        id, organization_id, name, provider, status, secret_reference, created_by
      ) values (
        '${connectionId}', '${organizationId}', 'GitHub', 'github', 'connected',
        'env://GITHUB_APP', '${ownerId}'
      );
      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id,
        app_slug, account_id, account_login, account_type, target_type,
        repository_selection, status, installed_at, created_by
      ) values (
        '${installationId}', '${organizationId}', '${connectionId}', 910001, 910002,
        'graph-worker-app', 910003, 'factory', 'Organization', 'Organization',
        'selected', 'active', now(), '${ownerId}'
      );
      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id,
        owner_login, name, full_name, default_branch, html_url, private,
        visibility, selected, github_updated_at
      ) values (
        '${repositoryId}', '${organizationId}', '${installationId}', 910004,
        'factory', 'graph-worker', '${repositoryFullName}', 'main',
        'https://github.com/${repositoryFullName}', true, 'private', true, now()
      );
      insert into public.project_connections (
        organization_id, project_id, connection_id, github_repository_id,
        is_primary, created_by
      ) values (
        '${organizationId}', '${projectId}', '${connectionId}', '${repositoryId}',
        true, '${ownerId}'
      );
    `);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("claims the oldest runnable graph atomically, with the whole projection", async () => {
    const graphId = await createDiamondGraph("Audit three areas and synthesize");

    const claimed = await claim();
    const parsed = parseClaimedGraph(claimed);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.graph.graph_id).toBe(graphId);
    expect(parsed.graph.nodes).toHaveLength(4);
    expect(parsed.graph.edges).toHaveLength(3);
    expect(parsed.graph.budget?.max_concurrent_nodes).toBe(8);
    // The project's repository travels with the claim, so the worker can
    // refuse to analyse a tree that is not the one this project is bound to.
    expect(parsed.graph.project_repository).toBe(repositoryFullName);
    // Public health validation is available to scheduled/global claims too;
    // it remains distinct from exact provider deployment lineage.
    expect(parsed.graph.project_production_url).toBe(projectProductionUrl);

    // The claim is the run: RUNNING with every node PENDING, evented.
    const runs = await db.query<{ state: string }>(
      "select state from public.graph_runs where graph_id = $1", [graphId],
    );
    expect(runs.rows).toEqual([{ state: "RUNNING" }]);
    const nodes = await db.query<{ count: number }>(
      `select count(*)::int as count from public.node_runs nr
        join public.graph_runs gr on gr.id = nr.graph_run_id
       where gr.graph_id = $1 and nr.state = 'PENDING'`, [graphId],
    );
    expect(nodes.rows[0].count).toBe(4);

    // A second claimer finds nothing: the queue is empty, not double-run.
    expect(await claim("graph-worker-test-2")).toBeNull();
  });

  it("does not claim a graph that waits on owner approval", async () => {
    await createDiamondGraph("A red-path graph", true);
    expect(await claim()).toBeNull();
  });

  it("executes the diamond with real persistence: parallel fan-out, honest close", async () => {
    const graphId = await createDiamondGraph("Run the diamond to completion");
    const parsed = parseClaimedGraph(await claim());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const compiled = compileClaimedGraph(parsed.graph);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.graph.maxParallelism).toBeGreaterThanOrEqual(3);

    // The executor records concurrency so the fan-out is measured, not assumed.
    let inFlight = 0;
    let maxInFlight = 0;
    const executed: string[] = [];
    const seenInputs = new Map<string, NodeInputs>();
    const executor = async (node: { nodeKey: string }, _attempt: number, inputs: NodeInputs): Promise<NodeExecutionResult> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      executed.push(node.nodeKey);
      seenInputs.set(node.nodeKey, inputs);
      await new Promise((tick) => setTimeout(tick, 15));
      inFlight -= 1;
      // inspect_a reports as a deterministic execution: the provider check
      // must admit the worker's honest attribution for reduce-style nodes.
      if (node.nodeKey === "inspect_a") {
        return { status: "SUCCEEDED", output: { node: node.nodeKey }, provider: "deterministic" };
      }
      return { status: "SUCCEEDED", output: { node: node.nodeKey }, provider: "anthropic", model: "claude-opus-5", tokensUsed: 150 };
    };

    const summary = await runClaimedGraph(
      parsed.graph, compiled.graph, pgliteStore(db, "graph-worker-test"), executor,
    );

    expect(summary.finalState).toBe("COMPLETED");
    expect(summary.nodesSucceeded).toBe(4);
    // The three inspectors are independent: they must dispatch together.
    expect(maxInFlight).toBeGreaterThanOrEqual(3);
    // Synthesis runs only after its inputs: it is the last execution.
    expect(executed[executed.length - 1]).toBe("synthesize");
    // Edges carry data: the fan-in received its upstreams' actual outputs.
    expect(seenInputs.get("synthesize")).toEqual({
      outputs: {
        inspect_a: { node: "inspect_a" },
        inspect_b: { node: "inspect_b" },
        inspect_c: { node: "inspect_c" },
      },
      missing: [],
    });
    expect(seenInputs.get("inspect_a")).toEqual({ outputs: {}, missing: [] });

    const nodeStates = await db.query<{ state: string; count: number }>(
      `select nr.state, count(*)::int as count from public.node_runs nr
        join public.graph_runs gr on gr.id = nr.graph_run_id
       where gr.graph_id = $1 group by nr.state`, [graphId],
    );
    expect(nodeStates.rows).toEqual([{ state: "COMPLETED", count: 4 }]);

    const run = await db.query<{ state: string; had_partial_input: boolean; tokens_used: number | string | null }>(
      "select state, had_partial_input, tokens_used from public.graph_runs where graph_id = $1", [graphId],
    );
    expect(run.rows[0].state).toBe("COMPLETED");
    expect(run.rows[0].had_partial_input).toBe(false);
    // Three model nodes reported 150 tokens each; the run's stored usage is
    // their sum, so the token budget has something real to bind against.
    expect(Number(run.rows[0].tokens_used)).toBe(450);

    // Artifacts are labelled by what they are, not all RAW: the three
    // inspectors produce evidence, the synthesis produces a derived view.
    // A reviewer auditing this run can tell the two apart.
    const artifacts = await db.query<{ kind: string; count: number }>(
      `select a.kind::text as kind, count(*)::int as count from public.graph_artifacts a
        join public.graph_runs gr on gr.id = a.graph_run_id
       where gr.graph_id = $1 group by a.kind order by a.kind`, [graphId],
    );
    expect(artifacts.rows).toEqual([
      { kind: "RAW", count: 3 },
      { kind: "SYNTHESIS", count: 1 },
    ]);
  });

  it("contains a failed branch: siblings finish, dependents are skipped, the run is PARTIAL", async () => {
    const graphId = await createDiamondGraph("Survive one failed inspector");
    const parsed = parseClaimedGraph(await claim());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const compiled = compileClaimedGraph(parsed.graph);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const executor = async (node: { nodeKey: string }): Promise<NodeExecutionResult> => {
      if (node.nodeKey === "inspect_b") {
        return { status: "FAILED", error: "The area could not be read.", retryable: false };
      }
      return { status: "SUCCEEDED", output: { node: node.nodeKey } };
    };

    const summary = await runClaimedGraph(
      parsed.graph, compiled.graph, pgliteStore(db, "graph-worker-test"), executor,
    );

    expect(summary.finalState).not.toBe("COMPLETED");
    expect(summary.nodesFailed).toBe(1);
    expect(summary.nodesSucceeded).toBe(2);

    const states = await db.query<{ node_key: string; state: string }>(
      `select n.node_key, nr.state from public.node_runs nr
        join public.graph_runs gr on gr.id = nr.graph_run_id
        join public.graph_nodes n on n.id = nr.node_id
       where gr.graph_id = $1 order by n.node_key`, [graphId],
    );
    expect(states.rows).toEqual([
      { node_key: "inspect_a", state: "COMPLETED" },
      { node_key: "inspect_b", state: "FAILED" },
      { node_key: "inspect_c", state: "COMPLETED" },
      { node_key: "synthesize", state: "SKIPPED" },
    ]);

    const run = await db.query<{ state: string; had_partial_input: boolean }>(
      "select state, had_partial_input from public.graph_runs where graph_id = $1", [graphId],
    );
    expect(run.rows[0].state).not.toBe("COMPLETED");
    expect(run.rows[0].had_partial_input).toBe(true);
  });

  it("runs a tolerant fan-in with the surviving inputs, stated as partial", async () => {
    // The same diamond, but synthesize declares tolerance: one failed
    // inspector must not cost the synthesis of the other two.
    const tolerantNodes = JSON.stringify(
      (JSON.parse(DIAMOND_NODES) as Array<Record<string, unknown>>).map((node) =>
        node.node_key === "synthesize" ? { ...node, tolerates_partial_inputs: true } : node,
      ),
    );
    const graphId = await createDiamondGraph("Synthesize what survives", false, tolerantNodes);

    const parsed = parseClaimedGraph(await claim());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // The declaration survives the whole persistence round trip.
    expect(parsed.graph.nodes.find((n) => n.node_key === "synthesize")?.tolerates_partial_inputs).toBe(true);
    const compiled = compileClaimedGraph(parsed.graph);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    let synthesisInputs: NodeInputs | undefined;
    const executor = async (node: { nodeKey: string }, _attempt: number, inputs: NodeInputs): Promise<NodeExecutionResult> => {
      if (node.nodeKey === "inspect_b") {
        return { status: "FAILED", error: "The area could not be read.", retryable: false };
      }
      if (node.nodeKey === "synthesize") synthesisInputs = inputs;
      return { status: "SUCCEEDED", output: { node: node.nodeKey } };
    };

    const summary = await runClaimedGraph(
      parsed.graph, compiled.graph, pgliteStore(db, "graph-worker-test"), executor,
    );

    // The synthesis ran on what arrived, and knew exactly what was missing.
    expect(synthesisInputs).toEqual({
      outputs: {
        inspect_a: { node: "inspect_a" },
        inspect_c: { node: "inspect_c" },
      },
      missing: ["inspect_b"],
    });
    expect(summary.nodesSucceeded).toBe(3);
    expect(summary.nodesFailed).toBe(1);
    // Run-level honesty is untouched: an input failed, so the run is
    // PARTIAL — a partial view stated as partial, never COMPLETED.
    expect(summary.finalState).toBe("PARTIAL");

    const states = await db.query<{ node_key: string; state: string }>(
      `select n.node_key, nr.state from public.node_runs nr
        join public.graph_runs gr on gr.id = nr.graph_run_id
        join public.graph_nodes n on n.id = nr.node_id
       where gr.graph_id = $1 order by n.node_key`, [graphId],
    );
    expect(states.rows).toEqual([
      { node_key: "inspect_a", state: "COMPLETED" },
      { node_key: "inspect_b", state: "FAILED" },
      { node_key: "inspect_c", state: "COMPLETED" },
      { node_key: "synthesize", state: "COMPLETED" },
    ]);
    const run = await db.query<{ state: string; had_partial_input: boolean }>(
      "select state, had_partial_input from public.graph_runs where graph_id = $1", [graphId],
    );
    expect(run.rows[0]).toEqual({ state: "PARTIAL", had_partial_input: true });
  });

  it("keeps terminal states final on both nodes and runs", async () => {
    await createDiamondGraph("Terminal protection");
    const parsed = parseClaimedGraph(await claim());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const nodeRunId = parsed.graph.nodes[0].node_run_id;
    const store = pgliteStore(db, "graph-worker-test");
    await store.recordNodeState(nodeRunId, "RUNNING", "terminal fixture started");
    await store.recordNodeState(nodeRunId, "COMPLETED");
    await expect(store.recordNodeState(nodeRunId, "FAILED", "too late"))
      .rejects.toThrow(/invalid_worker_node_state_transition/);

    // PARTIAL, not FAILED: a FAILED-only history would put this graph back
    // in the claim queue, and this test is about finality, not retry.
    await skipFreshClaimNodes(store, parsed.graph.nodes.slice(1));
    await store.completeRun(parsed.graph.graph_run_id, "PARTIAL", true);
    await expect(store.completeRun(parsed.graph.graph_run_id, "COMPLETED", true)).rejects.toThrow(/terminal/);

    // The silent-failure guard: incomplete inputs may not read as COMPLETED.
    const another = await createDiamondGraph("Partial cannot complete");
    const claimed = parseClaimedGraph(await claim());
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.graph.graph_id).toBe(another);
    await skipFreshClaimNodes(store, claimed.graph.nodes);
    await expect(store.completeRun(claimed.graph.graph_run_id, "COMPLETED", true))
      .rejects.toThrow(/requires every child to be terminal and successful/);
  });

  it("re-claims a graph whose only runs failed, and stops at three attempts", async () => {
    const graphId = await createDiamondGraph("Retry an infrastructure failure");
    const store = pgliteStore(db, "graph-worker-test");

    // First attempt fails the way a missing CLI does: the run closes FAILED
    // without any node reaching an answer.
    const first = parseClaimedGraph(await claim());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.graph.graph_id).toBe(graphId);
    await skipFreshClaimNodes(store, first.graph.nodes);
    await store.completeRun(first.graph.graph_run_id, "FAILED", true);

    // A failed-only graph goes back in the queue: infrastructure faults are
    // retryable without a person re-planning the graph. The re-claim is a
    // fresh run, not a resurrection of the failed one.
    const second = parseClaimedGraph(await claim());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.graph.graph_id).toBe(graphId);
    expect(second.graph.graph_run_id).not.toBe(first.graph.graph_run_id);
    await skipFreshClaimNodes(store, second.graph.nodes);
    await store.completeRun(second.graph.graph_run_id, "FAILED", true);

    const third = parseClaimedGraph(await claim());
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.graph.graph_id).toBe(graphId);
    await skipFreshClaimNodes(store, third.graph.nodes);
    await store.completeRun(third.graph.graph_run_id, "FAILED", true);

    // Three failed runs is the convergence bound: the graph leaves the queue
    // for good. This claim also proves the earlier COMPLETED, PARTIAL, and
    // in-flight graphs never re-entered it — FAILED-only is the sole way back.
    expect(await claim()).toBeNull();
  });

  it("voids a capacity-refused run as CANCELLED without spending a chance", async () => {
    // max_attempts 3 on purpose: a capacity refusal is non-retryable on its
    // first attempt, and the node_run must still be recorded FAILED right
    // then — not stranded RUNNING until an attempt counter it will never
    // reach.
    const retryCapableNodes = JSON.stringify(
      (JSON.parse(DIAMOND_NODES) as Array<Record<string, unknown>>)
        .map((node) => ({ ...node, max_attempts: 3 })),
    );
    const graphId = await createDiamondGraph("Survive a provider session limit", false, retryCapableNodes);
    const store = pgliteStore(db, "graph-worker-test");

    const first = parseClaimedGraph(await claim());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const compiled = compileClaimedGraph(first.graph);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    // Every attempt is refused the way a session limit refuses: nothing ran,
    // nothing can run, and retrying seconds later would not change that.
    const refused = async (): Promise<NodeExecutionResult> => ({
      status: "FAILED",
      error: "Claude Code returned an error result: You've hit your session limit",
      retryable: false,
      capacityWithheld: true,
    });

    const summary = await runClaimedGraph(first.graph, compiled.graph, store, refused);
    expect(summary.finalState).toBe("CANCELLED");
    expect(summary.capacityWithheld).toBe(true);
    expect(summary.nodesSucceeded).toBe(0);

    // Node truth is preserved — the refused attempts are FAILED node_runs —
    // while the run itself records that it never truly executed.
    const run = await db.query<{ state: string }>(
      "select state from public.graph_runs where id = $1", [first.graph.graph_run_id],
    );
    expect(run.rows[0].state).toBe("CANCELLED");
    const nodeStates = await db.query<{ state: string; count: number }>(
      `select nr.state, count(*)::int as count from public.node_runs nr
        where nr.graph_run_id = $1 group by nr.state order by nr.state`,
      [first.graph.graph_run_id],
    );
    expect(nodeStates.rows).toEqual([
      { state: "FAILED", count: 3 },
      { state: "SKIPPED", count: 1 },
    ]);

    // A CANCELLED run is not a spent chance: the graph is claimable again.
    const second = parseClaimedGraph(await claim());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.graph.graph_id).toBe(graphId);

    // Close the retry with a real answer so the queue ends this test empty.
    await skipFreshClaimNodes(store, second.graph.nodes);
    await store.completeRun(second.graph.graph_run_id, "PARTIAL", true);
    expect(await claim()).toBeNull();
  });

  it("voids a lifecycle run stopped by capacity even when earlier stages succeeded", async () => {
    /*
     * The first live lifecycle (graph 10fe2b0d) proved the gap: eight stages
     * succeeded, the architecture node hit the subscription's session limit,
     * and the PARTIAL close stranded the graph forever — a partial run counts
     * as an answer, so nothing could ever claim it again. A lifecycle's
     * product is the shipped change, not its intermediate packages, so a run
     * stopped by fuel answers nothing: it closes CANCELLED and the graph
     * keeps its chances for a dispatch after the limit resets.
     */
    const graphId = await createDiamondGraph("Ship the change across a session limit", false);
    await reset(db);
    await db.query(`update public.graphs set is_lifecycle = true where id = $1`, [graphId]);
    const store = pgliteStore(db, "graph-worker-test");

    const first = parseClaimedGraph(await claim());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.graph.graph_id).toBe(graphId);
    const compiled = compileClaimedGraph(first.graph);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    // The first node succeeds; everything after is refused the way a session
    // limit refuses.
    let executed = 0;
    const summary = await runClaimedGraph(first.graph, compiled.graph, store, async (): Promise<NodeExecutionResult> => {
      executed += 1;
      if (executed === 1) {
        return { status: "SUCCEEDED", output: { note: "stage one is real" }, tokensUsed: 10 };
      }
      return {
        status: "FAILED",
        error: "Claude Code returned an error result: You've hit your session limit",
        retryable: false,
        capacityWithheld: true,
      };
    });

    expect(summary.nodesSucceeded).toBeGreaterThan(0);
    expect(summary.finalState).toBe("CANCELLED");
    expect(summary.capacityWithheld).toBe(true);

    // The record of what ran survives; the graph does not leave the queue.
    const second = parseClaimedGraph(await claim());
    expect(second.ok, "a capacity-voided lifecycle must stay claimable").toBe(true);
    if (!second.ok) return;
    expect(second.graph.graph_id).toBe(graphId);
    await skipFreshClaimNodes(store, second.graph.nodes);
    await store.completeRun(second.graph.graph_run_id, "PARTIAL", true);
    expect(await claim()).toBeNull();
  });

  it("resumes a lifecycle from its own recorded results instead of re-proving them", async () => {
    /*
     * Three consecutive live windows spent their whole provider budget
     * re-executing stages the graph had already completed, and capped before
     * reaching new ground (runs 2469db25, 6a8d5121). A re-claimed lifecycle
     * now reuses the results it recorded in its earlier non-answering runs:
     * the reused node is not re-executed, costs nothing, and is named in the
     * summary so nothing reads as fresher than it is. Analysis graphs are
     * deliberately excluded by the database read — their value is fresh
     * findings — which the lifecycle-only join enforces below.
     */
    const graphId = await createDiamondGraph("Resume across a session limit", false);
    await reset(db);
    await db.query(`update public.graphs set is_lifecycle = true where id = $1`, [graphId]);
    const store = pgliteStore(db, "graph-worker-test");

    // First window: the first node completes and records its artifact; the
    // rest are refused the way a session limit refuses.
    const first = parseClaimedGraph(await claim());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const compiledFirst = compileClaimedGraph(first.graph);
    expect(compiledFirst.ok).toBe(true);
    if (!compiledFirst.ok) return;
    let firstWindowCalls = 0;
    const firstSummary = await runClaimedGraph(first.graph, compiledFirst.graph, store, async (node): Promise<NodeExecutionResult> => {
      firstWindowCalls += 1;
      if (firstWindowCalls === 1) {
        return {
          status: "SUCCEEDED",
          output: { stage: "one", verdict: "recorded", from: node.nodeKey },
          provider: "openai",
          model: "gpt-5.3-codex",
          latencyMs: 31,
          tokensUsed: 25,
        };
      }
      return {
        status: "FAILED",
        error: "Claude Code returned an error result: You've hit your session limit",
        retryable: false,
        capacityWithheld: true,
      };
    });
    expect(firstSummary.finalState).toBe("CANCELLED");
    expect(firstSummary.nodesSucceeded).toBe(1);
    expect(firstSummary.reusedNodes).toEqual([]);

    // Next window: the completed node's result is reused — its executor is
    // never called again — and the rest run fresh to a full completion.
    const second = parseClaimedGraph(await claim());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const compiledSecond = compileClaimedGraph(second.graph);
    expect(compiledSecond.ok).toBe(true);
    if (!compiledSecond.ok) return;
    const executedInSecondWindow: string[] = [];
    const secondSummary = await runClaimedGraph(second.graph, compiledSecond.graph, store, async (node): Promise<NodeExecutionResult> => {
      executedInSecondWindow.push(node.nodeKey);
      return { status: "SUCCEEDED", output: { stage: "two", from: node.nodeKey }, tokensUsed: 25 };
    });

    expect(secondSummary.finalState).toBe("COMPLETED");
    expect(secondSummary.reusedNodes).toHaveLength(1);
    const [reusedKey] = secondSummary.reusedNodes;
    expect(executedInSecondWindow).not.toContain(reusedKey);
    expect(executedInSecondWindow).toHaveLength(compiledSecond.graph.nodes.length - 1);

    // The reused node's stored artifact in the NEW run carries the original
    // result — recorded work restated, not fabricated.
    await reset(db);
    const carried = await db.query<{
      latency_ms: number | null;
      model: string | null;
      payload: { stage?: string; verdict?: string };
      provider: string | null;
    }>(
      `select a.payload, nr.provider, nr.model, nr.latency_ms
         from public.graph_artifacts a
         join public.node_runs nr on nr.id = a.node_run_id
         join public.graph_nodes n on n.id = nr.node_id
        where a.graph_run_id = $1 and n.node_key = $2`,
      [second.graph.graph_run_id, reusedKey],
    );
    expect(carried.rows[0].payload).toMatchObject({ stage: "one", verdict: "recorded" });
    expect(carried.rows[0]).toMatchObject({
      provider: "openai",
      model: "gpt-5.3-codex",
      latency_ms: 0,
    });

    // A COMPLETED run ends the story: the graph leaves the queue for good.
    expect(await claim()).toBeNull();
  });

  it("reuses gate-halted work after the gate is approved, instead of paying for it twice", async () => {
    /*
     * Found live within hours of the resume shipping. Run 6152cee2 executed
     * its architecture node for real and halted at the ARCHITECTURE human
     * gate; the gate was approved; and the next claim re-executed the node
     * from scratch, spending the rest of the provider window on work the
     * database already held (run e3c4b582). A gate-halted node is recorded
     * VERIFYING — work done, decision pending — and the resume read offered
     * only COMPLETED runs. This pins the repaired contract: the recorded
     * result is reused, the executor is never called for it again, and the
     * approved gate passes the reused result through to COMPLETED.
     */
    const gatedNodes = JSON.stringify([
      { node_key: "inspect_a", job: "Design the change", executor: "MODEL", capability: "architecture", max_attempts: 1, lifecycle_stage: "ARCHITECTURE", gate_kind: "HUMAN" },
      { node_key: "inspect_b", job: "Inspect area B", executor: "MODEL", capability: "extraction", max_attempts: 1, lifecycle_stage: "DISCOVERY" },
      { node_key: "inspect_c", job: "Inspect area C", executor: "MODEL", capability: "extraction", max_attempts: 1, lifecycle_stage: "DISCOVERY" },
      { node_key: "synthesize", job: "Build on the approved design", executor: "MODEL", capability: "implementation", max_attempts: 1, lifecycle_stage: "IMPLEMENTATION" },
    ]);
    const graphId = await createDiamondGraph("Approved work is never re-paid", false, gatedNodes);
    await reset(db);
    await db.query(`update public.graphs set is_lifecycle = true where id = $1`, [graphId]);
    const store = pgliteStore(db, "graph-worker-test");

    // Window one: every node the engine offers succeeds, and the gated node
    // halts at its gate with its work recorded.
    const first = parseClaimedGraph(await claim());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const compiledFirst = compileClaimedGraph(first.graph);
    expect(compiledFirst.ok).toBe(true);
    if (!compiledFirst.ok) return;
    const firstSummary = await runClaimedGraph(first.graph, compiledFirst.graph, store, async (node): Promise<NodeExecutionResult> => (
      { status: "SUCCEEDED", output: { designed: node.nodeKey }, tokensUsed: 25 }
    ));
    expect(firstSummary.awaitingGate).toContain("inspect_a");
    expect(firstSummary.finalState).toBe("PARTIAL");

    // The gate stands OPEN on the node; a person approves it.
    await reset(db);
    const gateRow = await db.query<{ id: string; state: string }>(
      `select gate.id, gate.state::text from public.graph_gates gate
         join public.graph_nodes node on node.id = gate.node_id
        where node.graph_id = $1 and node.node_key = 'inspect_a'`,
      [graphId],
    );
    expect(gateRow.rows[0]?.state).toBe("OPEN");
    await asOwner(db);
    await db.query("select public.decide_node_gate($1::uuid, true, 'Design approved.')", [gateRow.rows[0].id]);
    await reset(db);

    // Window two: the gate-halted node's recorded result is reused — its
    // executor is never called — and the approved gate passes it through, so
    // only the one genuinely new node costs anything.
    const second = parseClaimedGraph(await claim());
    expect(second.ok, "an approved gate must reopen the halted lifecycle").toBe(true);
    if (!second.ok) return;
    const compiledSecond = compileClaimedGraph(second.graph);
    expect(compiledSecond.ok).toBe(true);
    if (!compiledSecond.ok) return;
    const executedInSecondWindow: string[] = [];
    const secondSummary = await runClaimedGraph(second.graph, compiledSecond.graph, store, async (node): Promise<NodeExecutionResult> => {
      executedInSecondWindow.push(node.nodeKey);
      return { status: "SUCCEEDED", output: { built: node.nodeKey }, tokensUsed: 25 };
    });

    expect(secondSummary.finalState).toBe("COMPLETED");
    expect(secondSummary.reusedNodes).toContain("inspect_a");
    expect(executedInSecondWindow).not.toContain("inspect_a");
    expect(executedInSecondWindow).toEqual(["synthesize"]);
    expect(await claim()).toBeNull();
  });

  it("contains a sensitive-shaped output: the node fails, the drain survives", async () => {
    /*
     * The sixth live defect's second half (worker 32821441484, graph
     * 0dafc3b9): a node's output tripped the artifact table's sensitive-data
     * constraint — the guard doing its job — and the raw throw killed the
     * whole drain for every organization's graphs. A refused output fails
     * exactly its node with a message that never restates the payload;
     * siblings finish, dependents skip, and the run closes as the partial
     * answer it is.
     */
    const graphId = await createDiamondGraph("Contain the refused output", false);
    const store = pgliteStore(db, "graph-worker-test");

    const claimed = parseClaimedGraph(await claim());
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.graph.graph_id).toBe(graphId);
    const compiled = compileClaimedGraph(claimed.graph);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const summary = await runClaimedGraph(claimed.graph, compiled.graph, store, async (node): Promise<NodeExecutionResult> => {
      if (node.nodeKey === "inspect_b") {
        // A finding that quotes a secret-shaped string, as a real scan of a
        // repository can: the guard must refuse it and nothing else may die.
        return {
          status: "SUCCEEDED",
          output: { note: "found sk-abcdefghijklmnopqrstuvwxyz012345 in the config" },
          tokensUsed: 5,
        };
      }
      return { status: "SUCCEEDED", output: { from: node.nodeKey }, tokensUsed: 5 };
    });

    expect(summary.finalState).toBe("PARTIAL");
    expect(summary.nodesFailed).toBeGreaterThan(0);

    await reset(db);
    const rows = await db.query<{ node_key: string; state: string; error_message: string | null }>(
      `select n.node_key, nr.state::text as state, nr.error_message
         from public.node_runs nr join public.graph_nodes n on n.id = nr.node_id
        where n.graph_id = $1 order by n.node_key`,
      [graphId],
    );
    const byKey = new Map(rows.rows.map((row) => [row.node_key, row]));
    expect(byKey.get("inspect_b")?.state).toBe("FAILED");
    expect(byKey.get("inspect_b")?.error_message).toContain("artifact safety boundary");
    expect(byKey.get("inspect_b")?.error_message).not.toContain("sk-");
    expect(byKey.get("inspect_a")?.state).toBe("COMPLETED");
    expect(byKey.get("inspect_c")?.state).toBe("COMPLETED");

    // A PARTIAL is an answer; the graph leaves the queue for the next case.
    expect(await claim()).toBeNull();
  });

  it("keeps a gate approval fresh across a capacity-voided run", async () => {
    /*
     * The fifth live defect, found the same night the fourth shipped. Graph
     * d7241cf4 halted at its ARCHITECTURE gate (PARTIAL), the owner approved
     * it, and the next claim's run was voided by a session limit (CANCELLED).
     * The reopen rule then compared the approval against the last run's
     * close — the void's — and read it as stale: the lifecycle stranded with
     * its question answered. An approval is consumed by an ANSWER, not by a
     * run that answered nothing.
     */
    const gatedNodes = JSON.stringify([
      { node_key: "inspect_a", job: "Design the change", executor: "MODEL", capability: "architecture", max_attempts: 1, lifecycle_stage: "ARCHITECTURE", gate_kind: "HUMAN" },
      { node_key: "inspect_b", job: "Inspect area B", executor: "MODEL", capability: "extraction", max_attempts: 1, lifecycle_stage: "DISCOVERY" },
      { node_key: "inspect_c", job: "Inspect area C", executor: "MODEL", capability: "extraction", max_attempts: 1, lifecycle_stage: "DISCOVERY" },
      { node_key: "synthesize", job: "Build on the approved design", executor: "MODEL", capability: "implementation", max_attempts: 1, lifecycle_stage: "IMPLEMENTATION" },
    ]);
    const graphId = await createDiamondGraph("An approval outlives a voided run", false, gatedNodes);
    await reset(db);
    await db.query(`update public.graphs set is_lifecycle = true where id = $1`, [graphId]);
    const store = pgliteStore(db, "graph-worker-test");

    // Window one: work succeeds, the gated node halts. PARTIAL.
    const first = parseClaimedGraph(await claim());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const compiledFirst = compileClaimedGraph(first.graph);
    expect(compiledFirst.ok).toBe(true);
    if (!compiledFirst.ok) return;
    const firstSummary = await runClaimedGraph(first.graph, compiledFirst.graph, store, async (node): Promise<NodeExecutionResult> => (
      { status: "SUCCEEDED", output: { designed: node.nodeKey }, tokensUsed: 25 }
    ));
    expect(firstSummary.finalState).toBe("PARTIAL");

    // The owner approves the gate.
    await reset(db);
    const gateRow = await db.query<{ id: string }>(
      `select gate.id from public.graph_gates gate
         join public.graph_nodes node on node.id = gate.node_id
        where node.graph_id = $1 and node.node_key = 'inspect_a'`,
      [graphId],
    );
    await asOwner(db);
    await db.query("select public.decide_node_gate($1::uuid, true, 'Design approved.')", [gateRow.rows[0].id]);
    await reset(db);

    // Window two: the provider withholds capacity. The run voids CANCELLED.
    const second = parseClaimedGraph(await claim());
    expect(second.ok, "the approval must reopen the halted lifecycle").toBe(true);
    if (!second.ok) return;
    const compiledSecond = compileClaimedGraph(second.graph);
    expect(compiledSecond.ok).toBe(true);
    if (!compiledSecond.ok) return;
    const secondSummary = await runClaimedGraph(second.graph, compiledSecond.graph, store, async (): Promise<NodeExecutionResult> => ({
      status: "FAILED",
      error: "Claude Code returned an error result: You've hit your session limit",
      retryable: false,
      capacityWithheld: true,
    }));
    expect(secondSummary.finalState).toBe("CANCELLED");

    // Window three: the void must not have consumed the approval — the graph
    // is still claimable, and this time it finishes.
    const third = parseClaimedGraph(await claim());
    expect(third.ok, "a voided run must not stale the gate approval").toBe(true);
    if (!third.ok) return;
    const compiledThird = compileClaimedGraph(third.graph);
    expect(compiledThird.ok).toBe(true);
    if (!compiledThird.ok) return;
    const thirdSummary = await runClaimedGraph(third.graph, compiledThird.graph, store, async (node): Promise<NodeExecutionResult> => (
      { status: "SUCCEEDED", output: { built: node.nodeKey }, tokensUsed: 25 }
    ));
    expect(thirdSummary.finalState).toBe("COMPLETED");
    expect(thirdSummary.reusedNodes).toContain("inspect_a");
    expect(await claim()).toBeNull();
  });

  it("offers no prior results for a non-lifecycle graph, whatever it recorded", async () => {
    // The analysis twin of the case above: same shape, is_lifecycle stays
    // false, so the database read returns nothing and every node re-executes.
    const graphId = await createDiamondGraph("Fresh findings every run", false);
    const store = pgliteStore(db, "graph-worker-test");

    const first = parseClaimedGraph(await claim());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.graph.graph_id).toBe(graphId);
    const compiled = compileClaimedGraph(first.graph);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    let calls = 0;
    await runClaimedGraph(first.graph, compiled.graph, store, async (node): Promise<NodeExecutionResult> => {
      calls += 1;
      if (calls === 1) return { status: "SUCCEEDED", output: { from: node.nodeKey }, tokensUsed: 5 };
      return {
        status: "FAILED",
        error: "You've hit your session limit",
        retryable: false,
        capacityWithheld: true,
      };
    });

    const results = await store.readPriorNodeResults!(graphId);
    expect(results.size).toBe(0);

    // For a non-lifecycle, a run with any success is a PARTIAL answer — the
    // graph leaves the queue, which also leaves this test's queue empty.
    expect(await claim()).toBeNull();
  });

  it("stops re-claiming at the total-run ceiling even when every run was CANCELLED", async () => {
    const graphId = await createDiamondGraph("A very long capacity outage");
    const store = pgliteStore(db, "graph-worker-test");

    // Nine voided runs, as a long outage under a scheduled worker would
    // accumulate them. Written as the schema owner: the worker role itself
    // holds no table DML at all — its only doorway is the definer functions,
    // which the previous test's permission behavior already relies on.
    await reset(db);
    await db.query(
      `insert into public.graph_runs (organization_id, graph_id, state, started_at, completed_at, created_by)
       select $1::uuid, $2::uuid, 'CANCELLED', now(), now(), $3::uuid
         from generate_series(1, 9)`,
      [organizationId, graphId, ownerId],
    );

    // Run ten exists once this claim succeeds; the ceiling then holds.
    const tenth = parseClaimedGraph(await claim());
    expect(tenth.ok).toBe(true);
    if (!tenth.ok) return;
    expect(tenth.graph.graph_id).toBe(graphId);
    await skipFreshClaimNodes(store, tenth.graph.nodes);
    await store.completeRun(tenth.graph.graph_run_id, "CANCELLED", true);

    expect(await claim()).toBeNull();
  });

  it("reclaims a dead run, blocks its stale verifier, and leaves live runs alone", async () => {
    const verifierNodes = JSON.stringify(
      (JSON.parse(DIAMOND_NODES) as Array<Record<string, unknown>>).map((node) => (
        node.node_key === "synthesize" ? { ...node, capability: "review" } : node
      )),
    );
    const graphId = await createDiamondGraph("Survive a dead worker", false, verifierNodes);
    const abandoned = parseClaimedGraph(await claim());
    expect(abandoned.ok).toBe(true);
    if (!abandoned.ok) return;

    const store = pgliteStore(db, "graph-worker-test");
    const subjectNodeRunIds = abandoned.graph.nodes
      .filter((node) => node.node_key.startsWith("inspect_"))
      .map((node) => node.node_run_id);
    const subjectNodeRunId = subjectNodeRunIds[0];
    const verifierNodeRunId = abandoned.graph.nodes.find(
      (node) => node.node_key === "synthesize",
    )!.node_run_id;
    const reviewerArtifact = { findings: ["exact verifier output"] };

    await store.recordNodeState(verifierNodeRunId, "RUNNING", "review started", {
      provider: "anthropic", model: "claude-sonnet",
    });

    // Atomic completion refuses a non-terminal subject and leaves both the
    // reviewer and its evidence untouched.
    await expect(store.completeReviewerWithVerifications!(
      verifierNodeRunId,
      reviewerArtifact,
      { provider: "anthropic", model: "claude-sonnet", latencyMs: 11 },
      [{ subjectNodeRunId, verdict: "PASS", evidence: ["premature"] }],
    )).rejects.toThrow(/exactly match completed incoming subjects/i);

    for (const [index, nodeRunId] of subjectNodeRunIds.entries()) {
      await store.recordNodeState(nodeRunId, "RUNNING", `subject ${index} started`, {
        provider: "openai", model: "gpt-5.3-codex",
      });
      await store.recordNodeState(nodeRunId, "COMPLETED", `subject ${index} finished`, {
        provider: "openai", model: "gpt-5.3-codex",
      });
    }
    await db.query(
      "update public.graph_runs set updated_at = now() - interval '1 hour' where id = $1",
      [abandoned.graph.graph_run_id],
    );
    const beforeHeartbeat = await db.query<{ updated_at: string }>(
      "select updated_at from public.graph_runs where id = $1",
      [abandoned.graph.graph_run_id],
    );
    await store.completeReviewerWithVerifications!(
      verifierNodeRunId,
      reviewerArtifact,
      { provider: "anthropic", model: "claude-sonnet", latencyMs: 11 },
      subjectNodeRunIds.map((completedSubjectNodeRunId) => ({
        subjectNodeRunId: completedSubjectNodeRunId,
        verdict: "PASS" as const,
        evidence: ["completed subject under exact live parent"],
      })),
    );
    const afterHeartbeat = await db.query<{ updated_at: string }>(
      "select updated_at from public.graph_runs where id = $1",
      [abandoned.graph.graph_run_id],
    );
    expect(new Date(afterHeartbeat.rows[0].updated_at).getTime())
      .toBeGreaterThan(new Date(beforeHeartbeat.rows[0].updated_at).getTime());

    const acceptedEvidence = await db.query<{ verifications: number; events: number }>(
      `select
         (select count(*)::int from public.graph_verifications
           where graph_run_id = $1) as verifications,
         (select count(*)::int from public.graph_events
           where graph_run_id = $1 and event_type = 'verification_recorded') as events`,
      [abandoned.graph.graph_run_id],
    );
    expect(acceptedEvidence.rows[0]).toEqual({ verifications: 3, events: 3 });

    // The worker dies here: nothing ever reports again. Backdate every row
    // past the two-hour silence threshold.
    await reset(db);
    await db.query(
      "update public.graph_runs set updated_at = now() - interval '3 hours' where id = $1",
      [abandoned.graph.graph_run_id],
    );
    await db.query(
      "update public.node_runs set updated_at = now() - interval '3 hours' where graph_run_id = $1",
      [abandoned.graph.graph_run_id],
    );

    // The next claim sweeps the abandoned run and then claims the graph
    // again — the reclaim closed it FAILED, which is a retryable history.
    const reclaimed = parseClaimedGraph(await claim());
    expect(reclaimed.ok).toBe(true);
    if (!reclaimed.ok) return;
    expect(reclaimed.graph.graph_id).toBe(graphId);
    expect(reclaimed.graph.graph_run_id).not.toBe(abandoned.graph.graph_run_id);

    const oldRun = await db.query<{ state: string; completed_at: string | null }>(
      "select state, completed_at from public.graph_runs where id = $1",
      [abandoned.graph.graph_run_id],
    );
    expect(oldRun.rows[0].state).toBe("FAILED");
    expect(oldRun.rows[0].completed_at).not.toBeNull();

    const oldNodes = await db.query<{ state: string; blocked_reason: string | null; count: number }>(
      `select state, blocked_reason, count(*)::int as count from public.node_runs
        where graph_run_id = $1 group by state, blocked_reason order by state`,
      [abandoned.graph.graph_run_id],
    );
    expect(oldNodes.rows).toEqual([
      { state: "COMPLETED", blocked_reason: null, count: 4 },
    ]);

    const event = await db.query<{ count: number }>(
      `select count(*)::int as count from public.graph_events
        where graph_run_id = $1 and event_type = 'run_failed' and detail like 'Reclaimed by worker%'`,
      [abandoned.graph.graph_run_id],
    );
    expect(event.rows[0].count).toBe(1);

    // The losing worker cannot append after reclaim. Capture both durable
    // tables after the reclaim event, then prove the rejected RPC changes
    // neither one.
    const beforeRejectedWrite = await db.query<{ verifications: number; events: number }>(
      `select
         (select count(*)::int from public.graph_verifications
           where graph_run_id = $1) as verifications,
         (select count(*)::int from public.graph_events
           where graph_run_id = $1) as events`,
      [abandoned.graph.graph_run_id],
    );
    await expect(store.completeReviewerWithVerifications!(
      verifierNodeRunId,
      reviewerArtifact,
      { provider: "anthropic", model: "claude-sonnet", latencyMs: 11 },
      subjectNodeRunIds.map((completedSubjectNodeRunId) => ({
        subjectNodeRunId: completedSubjectNodeRunId,
        verdict: "PASS" as const,
        evidence: ["completed subject under exact live parent"],
      })),
    )).rejects.toThrow(/parent_graph_run_not_running/);
    const afterRejectedWrite = await db.query<{ verifications: number; events: number }>(
      `select
         (select count(*)::int from public.graph_verifications
           where graph_run_id = $1) as verifications,
         (select count(*)::int from public.graph_events
           where graph_run_id = $1) as events`,
      [abandoned.graph.graph_run_id],
    );
    expect(afterRejectedWrite.rows[0]).toEqual(beforeRejectedWrite.rows[0]);

    // Close the retry with an answer so the queue ends this test empty.
    for (const node of reclaimed.graph.nodes) {
      await store.recordNodeState(node.node_run_id, "SKIPPED", "stale-run regression cleanup");
    }
    await pgliteStore(db, "graph-worker-test").completeRun(reclaimed.graph.graph_run_id, "PARTIAL", true);
    expect(await claim()).toBeNull();
  });

  it("rejects malformed, oversized, and secret-shaped worker evidence without writes", async () => {
    const verifierNodes = JSON.stringify(
      (JSON.parse(DIAMOND_NODES) as Array<Record<string, unknown>>).map((node) => (
        node.node_key === "synthesize" ? { ...node, capability: "review" } : node
      )),
    );
    const graphId = await createDiamondGraph(
      "Reject unsafe worker evidence",
      false,
      verifierNodes,
    );
    const claimed = parseClaimedGraph(await claim());
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    const store = pgliteStore(db, "graph-worker-test");
    const subjectNodeRunIds = claimed.graph.nodes
      .filter((node) => node.node_key.startsWith("inspect_"))
      .map((node) => node.node_run_id);
    const subjectNodeRunId = subjectNodeRunIds[0]!;
    const verifierNodeRunId = claimed.graph.nodes.find(
      (node) => node.node_key === "synthesize",
    )!.node_run_id;
    for (const [index, nodeRunId] of subjectNodeRunIds.entries()) {
      await store.recordNodeState(nodeRunId, "RUNNING", `safe subject ${index} started`, {
        provider: "openai", model: "gpt-5.3-codex",
      });
      await store.recordNodeState(nodeRunId, "COMPLETED", `safe subject ${index} finished`, {
        provider: "openai", model: "gpt-5.3-codex",
      });
    }
    await store.recordNodeState(verifierNodeRunId, "RUNNING", "safe review started", {
      provider: "anthropic", model: "claude-sonnet",
    });

    await expect(store.recordNodeState(
      verifierNodeRunId,
      "COMPLETED",
      "split reviewer completion",
      { provider: "anthropic", model: "claude-sonnet", latencyMs: 9 },
    )).rejects.toThrow(/reviewer_completion_requires_atomic_verifications/i);

    await reset(db);
    const beforeEvidence = await db.query<{ events: number; verifications: number }>(
      `select
         (select count(*)::integer from public.graph_verifications
          where graph_run_id = $1) as verifications,
         (select count(*)::integer from public.graph_events
          where graph_run_id = $1 and event_type = 'verification_recorded') as events`,
      [claimed.graph.graph_run_id],
    );

    const rejectedBatches: unknown[] = [
      { not: "an array" },
      [{
        subjectNodeRunId,
        verdict: "PASS",
        evidence: ["x".repeat(33_000)],
      }],
      [{
        subjectNodeRunId,
        verdict: "PASS",
        evidence: [`observed sk-${"b".repeat(28)}`],
      }],
      [{
        subjectNodeRunId,
        verdict: "PASS",
        evidence: ["safe"],
        unexpected: true,
      }],
    ];
    await asServiceRole(db);
    for (const batch of rejectedBatches) {
      await expect(db.query(
        `select public.complete_reviewer_with_verifications_as_worker(
           $1, $2::uuid, $3::jsonb, 'anthropic', 'claude-sonnet', 9, $4::jsonb
         )`,
        ["graph-worker-test", verifierNodeRunId,
          JSON.stringify({ findings: ["safe reviewer output"] }), JSON.stringify(batch)],
      )).rejects.toThrow(/batch is invalid or oversized|item is unsafe|invalid shape/i);
    }
    await reset(db);
    expect((await db.query<{ events: number; verifications: number }>(
      `select
         (select count(*)::integer from public.graph_verifications
          where graph_run_id = $1) as verifications,
         (select count(*)::integer from public.graph_events
          where graph_run_id = $1 and event_type = 'verification_recorded') as events`,
      [claimed.graph.graph_run_id],
    )).rows).toEqual(beforeEvidence.rows);

    const beforeNode = await db.query<{
      blocked_reason: string | null;
      error_message: string | null;
      latency_ms: number | null;
      model: string | null;
      provider: string | null;
      state: string;
    }>(
      `select state::text, blocked_reason, error_message, provider, model, latency_ms
       from public.node_runs where id = $1`,
      [verifierNodeRunId],
    );
    const beforeNodeEvents = await db.query<{ count: number }>(
      "select count(*)::integer as count from public.graph_events where node_run_id = $1",
      [verifierNodeRunId],
    );
    await asServiceRole(db);
    await expect(db.query(
      `select public.record_node_state_as_worker(
         $1, $2::uuid, 'FAILED', $3, 'anthropic', 'claude', 12
       )`,
      ["graph-worker-test", verifierNodeRunId, `failure exposed sk-${"c".repeat(28)}`],
    )).rejects.toThrow(/node transition detail contains secret-shaped material/i);
    await reset(db);
    expect((await db.query<{
      blocked_reason: string | null;
      error_message: string | null;
      latency_ms: number | null;
      model: string | null;
      provider: string | null;
      state: string;
    }>(
      `select state::text, blocked_reason, error_message, provider, model, latency_ms
       from public.node_runs where id = $1`,
      [verifierNodeRunId],
    )).rows).toEqual(beforeNode.rows);
    expect((await db.query<{ count: number }>(
      "select count(*)::integer as count from public.graph_events where node_run_id = $1",
      [verifierNodeRunId],
    )).rows).toEqual(beforeNodeEvents.rows);

    await store.recordNodeState(verifierNodeRunId, "FAILED", "unsafe evidence refused", {
      provider: "anthropic", model: "claude-sonnet", latencyMs: 9,
    });
    await store.completeRun(claimed.graph.graph_run_id, "PARTIAL", true);
    expect(await claim()).toBeNull();
    expect(graphId).toBe(claimed.graph.graph_id);
  });

  it("binds each verification to an exact completed verifier node and exact replay", async () => {
    const subjectAgentId = "70000000-0000-4000-8000-000000000a01";
    const reviewAgentId = "70000000-0000-4000-8000-000000000a02";
    const securityAgentId = "70000000-0000-4000-8000-000000000a03";
    const qaAgentId = "70000000-0000-4000-8000-000000000a04";
    await reset(db);
    await db.query(
      `insert into public.agents (id, organization_id, name, role, status, created_by)
       values
         ($1, $5, 'Subject', 'backend', 'idle', $6),
         ($2, $5, 'Reviewer', 'product', 'idle', $6),
         ($3, $5, 'Security reviewer', 'security', 'idle', $6),
         ($4, $5, 'QA verifier', 'qa', 'idle', $6)`,
      [subjectAgentId, reviewAgentId, securityAgentId, qaAgentId, organizationId, ownerId],
    );

    const identityNodes = JSON.stringify(
      (JSON.parse(DIAMOND_NODES) as Array<Record<string, unknown>>).map((node) => {
        if (node.node_key === "inspect_b") return { ...node, capability: "review" };
        if (node.node_key === "inspect_c") return { ...node, capability: "security_review" };
        if (node.node_key === "synthesize") return { ...node, capability: "qa" };
        return node;
      }),
    );
    const identityEdges = JSON.stringify([
      { from_node_key: "inspect_a", to_node_key: "inspect_b", reason: "DATA", detail: "review subject" },
      { from_node_key: "inspect_a", to_node_key: "inspect_c", reason: "DATA", detail: "security subject" },
      { from_node_key: "inspect_a", to_node_key: "synthesize", reason: "DATA", detail: "QA subject" },
    ]);
    const graphId = await createDiamondGraph(
      "Bind verifier identity to its exact node run",
      false,
      identityNodes,
      identityEdges,
    );
    await reset(db);
    await db.query(
      `update public.graph_nodes
       set agent_id = case node_key
         when 'inspect_a' then $2::uuid
         when 'inspect_b' then $3::uuid
         when 'inspect_c' then $4::uuid
         when 'synthesize' then $5::uuid
       end
       where graph_id = $1`,
      [graphId, subjectAgentId, reviewAgentId, securityAgentId, qaAgentId],
    );

    const claimed = parseClaimedGraph(await claim());
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    const nodeRuns = new Map(claimed.graph.nodes.map((node) => [node.node_key, node.node_run_id]));
    const subjectNodeRunId = nodeRuns.get("inspect_a")!;
    const reviewNodeRunId = nodeRuns.get("inspect_b")!;
    const securityNodeRunId = nodeRuns.get("inspect_c")!;
    const qaNodeRunId = nodeRuns.get("synthesize")!;
    const store = pgliteStore(db, "graph-worker-test");

    await store.recordNodeState(subjectNodeRunId, "RUNNING", "subject started", {
      provider: "openai", model: "gpt-5.3-codex",
    });
    await store.recordNodeState(subjectNodeRunId, "COMPLETED", "subject finished", {
      provider: "openai", model: "gpt-5.3-codex",
    });
    await store.recordNodeState(reviewNodeRunId, "RUNNING", "review started", {
      provider: "anthropic", model: "claude-sonnet",
    });
    await store.recordNodeState(securityNodeRunId, "RUNNING", "security review started", {
      provider: "openai", model: "gpt-5.3-codex",
    });
    await store.recordNodeState(qaNodeRunId, "RUNNING", "QA started", {
      provider: "anthropic", model: "claude-sonnet",
    });

    // A reviewer cannot cross the old split-state boundary. Its terminal
    // state and exact verdict set must be committed by the one atomic RPC.
    await expect(store.recordNodeState(reviewNodeRunId, "COMPLETED", "split completion", {
      provider: "anthropic", model: "claude-sonnet", latencyMs: 21,
    })).rejects.toThrow(/reviewer_completion_requires_atomic_verifications/i);
    await expect(store.completeReviewerWithVerifications!(
      reviewNodeRunId,
      { findings: ["self-referential review"] },
      { provider: "anthropic", model: "claude-sonnet", latencyMs: 21 },
      [{ subjectNodeRunId: reviewNodeRunId, verdict: "PASS", evidence: ["self"] }],
    )).rejects.toThrow(/unsafe or self-referential/i);

    const otherGraphId = await createDiamondGraph(
      "Reject a verifier from another graph run",
      false,
      identityNodes,
      identityEdges,
    );
    const otherClaim = parseClaimedGraph(await claim());
    expect(otherClaim.ok).toBe(true);
    if (!otherClaim.ok) return;
    const otherSubjectNodeRunId = otherClaim.graph.nodes.find(
      (node) => node.node_key === "inspect_a",
    )!.node_run_id;
    await expect(store.completeReviewerWithVerifications!(
      reviewNodeRunId,
      { findings: ["cross-run review"] },
      { provider: "anthropic", model: "claude-sonnet", latencyMs: 21 },
      [{ subjectNodeRunId: otherSubjectNodeRunId, verdict: "PASS", evidence: ["other run"] }],
    )).rejects.toThrow(/exactly match completed incoming subjects/i);

    const reviewBatch = [{
      subjectNodeRunId,
      verdict: "PASS" as const,
      evidence: ["exact reviewer evidence"],
    }];
    const reviewArtifact = { findings: ["exact reviewer output"] };
    await store.completeReviewerWithVerifications!(
      reviewNodeRunId,
      reviewArtifact,
      { provider: "anthropic", model: "claude-sonnet", latencyMs: 21 },
      reviewBatch,
    );
    await store.completeReviewerWithVerifications!(
      securityNodeRunId,
      { findings: ["exact security reviewer output"] },
      { provider: "openai", model: "gpt-5.3-codex", latencyMs: 22 },
      [{ subjectNodeRunId, verdict: "PASS", evidence: ["security evidence"] }],
    );
    await store.completeReviewerWithVerifications!(
      qaNodeRunId,
      { findings: ["exact QA reviewer output"] },
      { provider: "anthropic", model: "claude-sonnet", latencyMs: 23 },
      [{ subjectNodeRunId, verdict: "PASS", evidence: ["QA evidence"] }],
    );

    // An exact retry is idempotent. Changed execution identity or evidence is
    // a conflicting rewrite and cannot add a second audit row.
    await store.completeReviewerWithVerifications!(
      reviewNodeRunId,
      reviewArtifact,
      { provider: "anthropic", model: "claude-sonnet", latencyMs: 21 },
      reviewBatch,
    );
    await expect(store.completeReviewerWithVerifications!(
      reviewNodeRunId,
      reviewArtifact,
      { provider: "openai", model: "gpt-5.3-codex", latencyMs: 21 },
      reviewBatch,
    )).rejects.toThrow(/completion replay does not match durable evidence/i);
    await expect(store.completeReviewerWithVerifications!(
      reviewNodeRunId,
      reviewArtifact,
      { provider: "anthropic", model: "claude-sonnet", latencyMs: 99 },
      reviewBatch,
    )).rejects.toThrow(/completion replay does not match durable evidence/i);
    await expect(store.completeReviewerWithVerifications!(
      reviewNodeRunId,
      reviewArtifact,
      { provider: "anthropic", model: "claude-sonnet", latencyMs: 21 },
      [{ subjectNodeRunId, verdict: "WARN", evidence: ["changed"] }],
    )).rejects.toThrow(/verification replay does not match the durable exact set/i);

    const persisted = await db.query<{
      event_count: number;
      lens: string;
      shared_worker_context: boolean;
      verifier_agent_id: string;
      verifier_node_run_id: string;
      verifier_provider: string;
    }>(
      `select verification.lens::text,
              verification.verifier_node_run_id,
              verification.verifier_agent_id,
              verification.verifier_provider,
              verification.shared_worker_context,
              (select count(*)::integer from public.graph_events event
                where event.graph_run_id = verification.graph_run_id
                  and event.event_type = 'verification_recorded'
                  and event.payload ->> 'verifier_node_run_id' =
                    verification.verifier_node_run_id::text) as event_count
       from public.graph_verifications verification
       where verification.graph_run_id = $1
       order by verification.lens`,
      [claimed.graph.graph_run_id],
    );
    expect(persisted.rows).toEqual([
      {
        event_count: 1,
        lens: "correctness",
        shared_worker_context: false,
        verifier_agent_id: reviewAgentId,
        verifier_node_run_id: reviewNodeRunId,
        verifier_provider: "anthropic",
      },
      {
        event_count: 1,
        lens: "security",
        shared_worker_context: false,
        verifier_agent_id: securityAgentId,
        verifier_node_run_id: securityNodeRunId,
        verifier_provider: "openai",
      },
      {
        event_count: 1,
        lens: "acceptance_criteria",
        shared_worker_context: false,
        verifier_agent_id: qaAgentId,
        verifier_node_run_id: qaNodeRunId,
        verifier_provider: "anthropic",
      },
    ]);

    await store.completeRun(claimed.graph.graph_run_id, "COMPLETED", false);
    for (const node of otherClaim.graph.nodes) {
      await store.recordNodeState(node.node_run_id, "SKIPPED", "cross-run regression cleanup");
    }
    await store.completeRun(otherClaim.graph.graph_run_id, "PARTIAL", true);
    expect(otherGraphId).toBe(otherClaim.graph.graph_id);
    expect(await claim()).toBeNull();
  });

  it("keeps the internal verification writer private and exposes only atomic reviewer completion", async () => {
    await reset(db);
    const signature = "public.record_graph_verification_internal(text,uuid,uuid,public.verification_lens,public.verification_verdict,jsonb)";
    const privileges = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(
      `select
         pg_catalog.has_function_privilege('anon', $1, 'EXECUTE') as anon,
         pg_catalog.has_function_privilege('authenticated', $1, 'EXECUTE') as authenticated,
         pg_catalog.has_function_privilege('service_role', $1, 'EXECUTE') as service_role`,
      [signature],
    );
    expect(privileges.rows[0]).toEqual({
      anon: false,
      authenticated: false,
      service_role: false,
    });

    const legacySignature = "public.record_verification_as_worker(text,uuid,public.verification_lens,public.verification_verdict,jsonb,uuid,text,boolean)";
    const legacyPrivileges = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(
      `select
         pg_catalog.has_function_privilege('anon', $1, 'EXECUTE') as anon,
         pg_catalog.has_function_privilege('authenticated', $1, 'EXECUTE') as authenticated,
         pg_catalog.has_function_privilege('service_role', $1, 'EXECUTE') as service_role`,
      [legacySignature],
    );
    expect(legacyPrivileges.rows[0]).toEqual({
      anon: false,
      authenticated: false,
      service_role: false,
    });

    const atomicSignature = "public.complete_reviewer_with_verifications_as_worker(text,uuid,jsonb,text,text,integer,jsonb)";
    const atomicPrivileges = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(
      `select
         pg_catalog.has_function_privilege('anon', $1, 'EXECUTE') as anon,
         pg_catalog.has_function_privilege('authenticated', $1, 'EXECUTE') as authenticated,
         pg_catalog.has_function_privilege('service_role', $1, 'EXECUTE') as service_role`,
      [atomicSignature],
    );
    expect(atomicPrivileges.rows[0]).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
    });
  });

  it("re-plants one exhausted graph, exactly once, through the seed migration", async () => {
    // The chain in beforeAll already ran this file against an empty database
    // (a no-op). Re-running it now — the hosted apply's own replay shape —
    // finds the graph the re-claim test retired with three FAILED runs and
    // copies it as one fresh, claimable graph with a fixed id.
    const replantedId = "ad0e5f2c-9b1d-4e3a-8c47-51b06f7d3e91";
    const seedFile = "20260819000200_replant_exhausted_graph.sql";
    const seedSql = await readFile(resolve(migrationsDirectory, seedFile), "utf8");

    await reset(db);
    await db.exec(seedSql);

    const copy = await db.query<{ goal: string; created_by: string; requires_owner_approval: boolean }>(
      "select goal, created_by, requires_owner_approval from public.graphs where id = $1",
      [replantedId],
    );
    expect(copy.rows).toHaveLength(1);
    expect(copy.rows[0].goal).toBe("Retry an infrastructure failure");
    expect(copy.rows[0].created_by).toBe(ownerId);
    expect(copy.rows[0].requires_owner_approval).toBe(false);

    const shape = await db.query<{ nodes: number; edges: number; budgets: number; runs: number }>(
      `select
         (select count(*)::int from public.graph_nodes where graph_id = $1) as nodes,
         (select count(*)::int from public.graph_edges where graph_id = $1) as edges,
         (select count(*)::int from public.graph_budgets where graph_id = $1) as budgets,
         (select count(*)::int from public.graph_runs where graph_id = $1) as runs`,
      [replantedId],
    );
    expect(shape.rows[0]).toEqual({ nodes: 4, edges: 3, budgets: 1, runs: 0 });

    // Replay: the fixed id is the guard, so a second application changes
    // nothing — no second copy, ever.
    await db.exec(seedSql);
    const graphsWithGoal = await db.query<{ count: number }>(
      "select count(*)::int as count from public.graphs where goal = 'Retry an infrastructure failure'",
    );
    expect(graphsWithGoal.rows[0].count).toBe(2); // the retired original + one copy

    // The copy is genuinely claimable, and the projection is whole.
    const claimed = parseClaimedGraph(await claim());
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.graph.graph_id).toBe(replantedId);
    expect(claimed.graph.nodes).toHaveLength(4);
    expect(claimed.graph.edges).toHaveLength(3);
    const store = pgliteStore(db, "graph-worker-test");
    await skipFreshClaimNodes(store, claimed.graph.nodes);
    await store.completeRun(claimed.graph.graph_run_id, "PARTIAL", true);
  });

  it("lists graph runs to members with node truth and artifact counts", async () => {
    type ListedRun = {
      goal: string;
      state: string;
      nodes: Array<{ node_key: string; state: string; provider: string | null; error_message: string | null }>;
      artifact_counts: Record<string, number>;
      verifications: Array<{ subject_node_key: string; lens: string; verdict: string; shared_worker_context: boolean }>;
    };

    await asOwner(db);
    const listed = await db.query<ListedRun>(
      "select * from public.list_graph_runs($1::uuid, 50)",
      [organizationId],
    );
    await reset(db);

    // Every run this suite created is visible; the completed diamond carries
    // exactly what the worker recorded — including the deterministic
    // attribution the widened provider check now admits, and the artifacts.
    const diamond = listed.rows.find((row) => row.goal === "Run the diamond to completion");
    expect(diamond).toBeDefined();
    expect(diamond?.state).toBe("COMPLETED");
    expect(diamond?.nodes).toHaveLength(4);
    expect(diamond?.nodes.find((n) => n.node_key === "inspect_a")?.provider).toBe("deterministic");
    expect(diamond?.artifact_counts).toEqual({ RAW: 3, SYNTHESIS: 1 });
    // A run with no reviewing node reports an empty list, not a missing key.
    expect(diamond?.verifications).toEqual([]);

    // A failed node's error travels verbatim.
    const contained = listed.rows.find((row) => row.goal === "Survive one failed inspector");
    expect(contained?.nodes.find((n) => n.node_key === "inspect_b")?.error_message)
      .toBe("The area could not be read.");

    // The read is for members and nobody else: the worker role is revoked,
    // and a stranger's session is refused by the membership check.
    await asServiceRole(db);
    await expect(
      db.query("select * from public.list_graph_runs($1::uuid, 5)", [organizationId]),
    ).rejects.toThrow(/permission denied/);
    await reset(db);

    await db.exec("insert into auth.users (id) values ('99999999-0000-4000-8000-0000000000d1')");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", ["99999999-0000-4000-8000-0000000000d1"]);
    await db.exec("set role authenticated");
    await expect(
      db.query("select * from public.list_graph_runs($1::uuid, 5)", [organizationId]),
    ).rejects.toThrow(/membership/);
    await reset(db);
  });

  it("records a reviewing node's verdict against every subject it consumed", async () => {
    // A graph whose fan-in is a REVIEW node: its answer is a judgement of the
    // inspectors' work, and that judgement has to become a durable, auditable
    // row rather than just another artifact.
    const reviewNodes = JSON.stringify(
      (JSON.parse(DIAMOND_NODES) as Array<Record<string, unknown>>).map((node) =>
        node.node_key === "synthesize"
          ? { ...node, capability: "review", tolerates_partial_inputs: true }
          : node,
      ),
    );
    const graphId = await createDiamondGraph("Review what the inspectors found", false, reviewNodes);

    const parsed = parseClaimedGraph(await claim());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const compiled = compileClaimedGraph(parsed.graph);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const executor = async (node: { nodeKey: string }): Promise<NodeExecutionResult> => {
      if (node.nodeKey === "inspect_c") {
        return { status: "FAILED", error: "The area could not be read.", retryable: false };
      }
      if (node.nodeKey === "synthesize") {
        return {
          status: "SUCCEEDED",
          provider: "anthropic",
          model: "claude-sonnet",
          latencyMs: 17,
          output: {
            blocked: false,
            findings: [{ title: "Unbounded query", severity: "high", detail: "d" }],
          },
        };
      }
      return { status: "SUCCEEDED", output: { node: node.nodeKey }, provider: "anthropic" };
    };

    await runClaimedGraph(parsed.graph, compiled.graph, pgliteStore(db, "graph-worker-test"), executor);

    const verifications = await db.query<{
      evidence: unknown;
      lens: string;
      node_key: string;
      shared: boolean;
      verdict: string;
      verifier_node_key: string;
      verifier_provider: string;
    }>(
      `select n.node_key, verifier_node.node_key as verifier_node_key,
              v.verifier_provider, v.lens::text as lens,
              v.verdict::text as verdict, v.evidence,
              v.shared_worker_context as shared
         from public.graph_verifications v
         join public.node_runs nr on nr.id = v.subject_node_run_id
         join public.graph_nodes n on n.id = nr.node_id
         join public.node_runs verifier_run on verifier_run.id = v.verifier_node_run_id
         join public.graph_nodes verifier_node on verifier_node.id = verifier_run.node_id
         join public.graph_runs gr on gr.id = v.graph_run_id
        where gr.graph_id = $1 order by n.node_key`, [graphId],
    );

    // Two subjects completed and were judged; the third failed and was not —
    // a dependency that never answered was not reviewed, and saying it was
    // would be the invention this derivation exists to avoid.
    expect(verifications.rows.map((row) => row.node_key)).toEqual(["inspect_a", "inspect_b"]);
    for (const row of verifications.rows) {
      expect(row.lens).toBe("correctness");
      expect(row.verdict).toBe("REJECT");
      expect(row.evidence).toEqual(["high: Unbounded query"]);
      expect(row.verifier_node_key).toBe("synthesize");
      expect(row.verifier_provider).toBe("anthropic");
      // Each node is a fresh session holding only its declared inputs.
      expect(row.shared).toBe(false);
    }

    const events = await db.query<{ count: number }>(
      `select count(*)::int as count from public.graph_events e
         join public.graph_runs gr on gr.id = e.graph_run_id
        where gr.graph_id = $1 and e.event_type = 'verification_recorded'`, [graphId],
    );
    expect(events.rows[0].count).toBe(2);

    // And a member can actually see them: evidence nobody can read is the
    // same as evidence nobody stored.
    await asOwner(db);
    const listed = await db.query<{ goal: string; verifications: Array<{
      lens: string;
      shared_worker_context: boolean;
      subject_node_key: string;
      verdict: string;
    }> }>(
      "select goal, verifications from public.list_graph_runs($1::uuid, 50)",
      [organizationId],
    );
    await reset(db);
    const reviewed = listed.rows.find((row) => row.goal === "Review what the inspectors found");
    expect(reviewed?.verifications).toHaveLength(2);
    expect(reviewed?.verifications.map((v) => v.subject_node_key)).toEqual(["inspect_a", "inspect_b"]);
    expect(reviewed?.verifications[0]).toMatchObject({
      lens: "correctness",
      verdict: "REJECT",
      shared_worker_context: false,
    });
  });

  it("refuses an atomic reviewer completion whose verifier does not exist", async () => {
    await asServiceRole(db);
    await expect(
      db.query(
        `select public.complete_reviewer_with_verifications_as_worker(
           $1, $2::uuid, '{}'::jsonb, 'anthropic', 'claude-sonnet', 1,
           pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
             'subjectNodeRunId', $3::text, 'verdict', 'PASS', 'evidence', '[]'::jsonb
           ))
         )`,
        [
          "graph-worker-test",
          "00000000-0000-4000-8000-00000000de01",
          "00000000-0000-4000-8000-00000000dead",
        ],
      ),
    ).rejects.toThrow(/node_run_not_found/);
    await reset(db);
  });

  it("fails closed on stale project metadata, then reports the exact active binding", async () => {
    await reset(db);
    await db.query(
      "update public.projects set github_repository = $2 where id = $1",
      [projectId, "surgeservicesllc/SoftwareFactory"],
    );
    const graphId = await createDiamondGraph("Analyse the bound repository");

    expect(await claim()).toBeNull();
    await reset(db);
    await db.query(
      "update public.projects set github_repository = $2 where id = $1",
      [projectId, repositoryFullName],
    );
    const parsed = parseClaimedGraph(await claim());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.graph.graph_id).toBe(graphId);
    expect(parsed.graph.project_name).toBe("Graph Project");
    expect(parsed.graph.project_repository).toBe(repositoryFullName);
    expect(parsed.graph.project_default_branch).toBe("main");

    const store = pgliteStore(db, "graph-worker-test");
    await skipFreshClaimNodes(store, parsed.graph.nodes);
    await store.completeRun(parsed.graph.graph_run_id, "PARTIAL", true);
    await reset(db);
    await db.query(
      "update public.projects set github_repository = $2 where id = $1",
      [projectId, repositoryFullName],
    );
  });

  it("re-plants a second copy with the measured envelope, exactly once", async () => {
    // The second seed migration: same exhausted source, a new fixed id, and
    // the one deliberate difference — MODEL nodes carry the eight-minute
    // timeout the first live drain proved necessary.
    const replantedId = "b7e2a9d4-3c61-4f8e-9a05-2d84c1f6b730";
    const seedFile = "20260819000500_replant_with_room_to_work.sql";
    const seedSql = await readFile(resolve(migrationsDirectory, seedFile), "utf8");

    await reset(db);
    await db.exec(seedSql);

    const nodes = await db.query<{ node_key: string; executor: string; timeout_ms: number }>(
      "select node_key, executor::text as executor, timeout_ms from public.graph_nodes where graph_id = $1 order by node_key",
      [replantedId],
    );
    expect(nodes.rows).toHaveLength(4);
    for (const row of nodes.rows) {
      expect(row.timeout_ms).toBe(row.executor === "MODEL" ? 480_000 : 180_000);
    }

    // Replay: no second copy, ever.
    await db.exec(seedSql);
    const copies = await db.query<{ count: number }>(
      "select count(*)::int as count from public.graphs where id = $1", [replantedId],
    );
    expect(copies.rows[0].count).toBe(1);

    // The follow-up migration applies the template default — aggregating
    // capabilities with real dependencies tolerate partial inputs — to this
    // copy, whose rows were cloned from pre-tolerance plans. Keyed by
    // capability and incoming edges, not node names, so it holds for any
    // planted shape. Entry nodes stay strict; replays find nothing to change.
    const toleranceFile = "20260819000600_tolerant_fan_ins_for_planted_copy.sql";
    await db.exec(await readFile(resolve(migrationsDirectory, toleranceFile), "utf8"));
    const tolerance = await db.query<{ node_key: string; tolerates_partial_inputs: boolean }>(
      "select node_key, tolerates_partial_inputs from public.graph_nodes where graph_id = $1 order by node_key",
      [replantedId],
    );
    expect(tolerance.rows).toEqual([
      { node_key: "inspect_a", tolerates_partial_inputs: false },
      { node_key: "inspect_b", tolerates_partial_inputs: false },
      { node_key: "inspect_c", tolerates_partial_inputs: false },
      { node_key: "synthesize", tolerates_partial_inputs: true },
    ]);

    // Claimable, and the projection carries the raised envelope.
    const claimed = parseClaimedGraph(await claim());
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.graph.graph_id).toBe(replantedId);
    expect(claimed.graph.nodes.find((n) => n.node_key === "inspect_a")?.timeout_ms).toBe(480_000);
    expect(claimed.graph.nodes.find((n) => n.node_key === "synthesize")?.tolerates_partial_inputs).toBe(true);
    const store = pgliteStore(db, "graph-worker-test");
    await skipFreshClaimNodes(store, claimed.graph.nodes);
    await store.completeRun(claimed.graph.graph_run_id, "PARTIAL", true);
  });

  it("re-plants a third copy from the PARTIAL-retired second, exactly once", async () => {
    // Production run 4d3f44a7 closed the second copy PARTIAL with six of
    // seven nodes succeeded — an answer, which retires the graph — while the
    // one failure was the report node refused capacity. The third seed clones
    // that copy by its known id (a PARTIAL source is deliberately outside the
    // exhausted-source criteria the earlier seeds use), verbatim envelopes.
    const sourceId = "b7e2a9d4-3c61-4f8e-9a05-2d84c1f6b730";
    const replantedId = "c9d4f1e8-7a52-4b3c-9e16-4f8a2d5c7b91";
    const seedFile = "20260819001200_replant_for_the_complete_run.sql";
    const seedSql = await readFile(resolve(migrationsDirectory, seedFile), "utf8");

    // The previous test closed the source's run PARTIAL, so it is retired
    // and this seed's guard (runs exist, none open) is satisfied.
    await reset(db);
    await db.exec(seedSql);

    const nodes = await db.query<{ node_key: string; timeout_ms: number; tolerates_partial_inputs: boolean }>(
      "select node_key, timeout_ms, tolerates_partial_inputs from public.graph_nodes where graph_id = $1 order by node_key",
      [replantedId],
    );
    expect(nodes.rows).toHaveLength(4);
    // Envelopes copy verbatim from the tuned source: measured timeouts and
    // the tolerant fan-in both survive the clone.
    expect(nodes.rows.find((n) => n.node_key === "inspect_a")?.timeout_ms).toBe(480_000);
    expect(nodes.rows.find((n) => n.node_key === "synthesize")?.tolerates_partial_inputs).toBe(true);

    // Replay: no second copy, ever.
    await db.exec(seedSql);
    const copies = await db.query<{ count: number }>(
      "select count(*)::int as count from public.graphs where id = $1", [replantedId],
    );
    expect(copies.rows[0].count).toBe(1);

    // Claimable by the analysis worker, and cleanly retired for later tests.
    const claimed = parseClaimedGraph(await claim());
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.graph.graph_id).toBe(replantedId);
    const store = pgliteStore(db, "graph-worker-test");
    await skipFreshClaimNodes(store, claimed.graph.nodes);
    await store.completeRun(claimed.graph.graph_run_id, "PARTIAL", true);

    // The source stays retired: cloning must not have reopened it.
    const sourceRuns = await db.query<{ state: string }>(
      "select state::text as state from public.graph_runs r join public.graphs g on g.id = r.graph_id where g.id = $1",
      [sourceId],
    );
    expect(sourceRuns.rows.every((row) => ["PARTIAL", "FAILED", "CANCELLED", "COMPLETED"].includes(row.state))).toBe(true);
  });
  it("leaves a graph alone when it needs an executor this worker does not provide", async () => {
    // The claim's matching contract: a worker that does not declare an
    // executor never receives a graph containing one. The shipped worker now
    // declares ANCHOR (observation anchors need no workspace), so the narrow
    // worker here is explicit — the rule it proves is what protected the
    // queue before that, and what protects it from any future executor kind:
    // before matching, a worker claimed such a graph anyway, failed the
    // anchor, blocked everything below it, and spent one of the graph's three
    // chances to say something it already knew before claiming.
    const anchorNodes = JSON.stringify([
      { node_key: "integrate", job: "Integrate the branches", executor: "DETERMINISTIC", capability: "extraction", max_attempts: 1 },
      { node_key: "verify", job: "Run the tests and record the result", executor: "ANCHOR", capability: "qa", max_attempts: 1 },
    ]);
    const anchorEdges = JSON.stringify([
      { from_node_key: "integrate", to_node_key: "verify", reason: "DATA", detail: "verification runs on the integrated tree" },
    ]);
    const anchorGraphId = await createDiamondGraph("Build it and prove it with tests", false, anchorNodes, anchorEdges);

    // Drain everything else this suite left claimable, so the queue is empty
    // except for the anchor graph. Each claim is closed PARTIAL, which retires
    // it. The drain also proves the anchor graph is never among them.
    const claimedIds: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const parsed = parseClaimedGraph(await claim("no-anchor-worker", ["MODEL", "DETERMINISTIC"]));
      if (!parsed.ok) break;
      claimedIds.push(parsed.graph.graph_id);
      const store = pgliteStore(db, "no-anchor-worker");
      await skipFreshClaimNodes(store, parsed.graph.nodes);
      await store.completeRun(parsed.graph.graph_run_id, "PARTIAL", true);
    }
    expect(claimedIds).not.toContain(anchorGraphId);

    // The queue is empty now, and the anchor graph is the only thing left in
    // it — so a null claim is a refusal of this graph, not an empty queue.
    const waiting = await db.query<{ id: string }>(
      `select g.id from public.graphs g
        where g.requires_owner_approval = false
          and not exists (select 1 from public.graph_runs r
                where r.graph_id = g.id and r.state not in ('FAILED', 'CANCELLED'))
          and (select count(*) from public.graph_runs r
                where r.graph_id = g.id and r.state = 'FAILED') < 3
          and (select count(*) from public.graph_runs r where r.graph_id = g.id) < 10`,
      [],
    );
    expect(waiting.rows.map((row) => row.id)).toEqual([anchorGraphId]);

    expect(await claim("no-anchor-worker", ["MODEL", "DETERMINISTIC"])).toBeNull();

    // No run was created, so the graph did not spend a chance and nothing is
    // recorded as a failure that never executed.
    const runs = await db.query<{ count: number }>(
      "select count(*)::int as count from public.graph_runs where graph_id = $1",
      [anchorGraphId],
    );
    expect(runs.rows[0].count).toBe(0);

    // A worker that can run anchors gets it — the graph was waiting, not lost.
    const claimed = parseClaimedGraph(await claim("anchor-capable-worker", ["MODEL", "DETERMINISTIC", "ANCHOR"]));
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.graph.graph_id).toBe(anchorGraphId);
    const store = pgliteStore(db, "anchor-capable-worker");
    await skipFreshClaimNodes(store, claimed.graph.nodes);
    await store.completeRun(claimed.graph.graph_run_id, "PARTIAL", true);
  });

  it("refuses missing, empty, or unknown worker executor declarations without creating a run", async () => {
    // An empty set would match every graph under `<> all (...)`, which is the
    // opposite of the intent: a worker that declares nothing must claim
    // nothing, and saying so loudly beats claiming everything quietly.
    await reset(db);
    const before = await db.query<{ count: number }>(
      "select count(*)::integer as count from public.graph_runs",
    );
    await asServiceRole(db);
    for (const executors of [null, [], ["MODEL", "UNKNOWN"]]) {
      await expect(
        db.query(
          "select public.claim_planned_graph_v2($1, $2::text[], $3, $4::jsonb, 2)",
          ["graph-worker-test", executors, repositoryFullName, JSON.stringify(requiredCheckNames)],
        ),
      ).rejects.toThrow(/unique, bounded set of supported executors/i);
    }
    await reset(db);
    const after = await db.query<{ count: number }>(
      "select count(*)::integer as count from public.graph_runs",
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("fails closed for stale or unsupported graph-worker claim protocols", async () => {
    await reset(db);
    const before = await db.query<{ count: number }>(
      "select count(*)::integer as count from public.graph_runs",
    );

    await asServiceRole(db);
    await expect(
      db.query(
        "select public.claim_planned_graph_v2($1, $2::text[], $3, $4::jsonb, $5)",
        ["graph-worker-test", WORKER_SUPPORTED_EXECUTORS, repositoryFullName,
          JSON.stringify(requiredCheckNames), 1],
      ),
    ).rejects.toThrow(/graph worker protocol version 2 is required/i);
    await expect(
      db.query(
        "select public.claim_planned_graph_internal($1, $2::text[], $3, $4::jsonb)",
        ["graph-worker-test", WORKER_SUPPORTED_EXECUTORS, repositoryFullName,
          JSON.stringify(requiredCheckNames)],
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.query(
        "select * from public.read_prior_node_results_as_worker_v2($1, $2::uuid, 1)",
        ["graph-worker-test", "00000000-0000-4000-8000-000000000001"],
      ),
    ).rejects.toThrow(/graph worker protocol version 2 is required/i);
    await expect(
      db.query(
        "select * from public.read_prior_node_results_as_worker($1, $2::uuid)",
        ["graph-worker-test", "00000000-0000-4000-8000-000000000001"],
      ),
    ).rejects.toThrow(/permission denied/i);

    await reset(db);
    const after = await db.query<{ count: number }>(
      "select count(*)::integer as count from public.graph_runs",
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("keeps the run's own account of why it ended, and reads it back", async () => {
    // The engine composed this sentence on every close and threw it away:
    // `completeRun`'s parameter was named `_detail` because the RPC had no
    // parameter to carry it and `graph_runs` had no column to hold it. Ten
    // CANCELLED runs in the live queue state no reason at all.
    //
    // Keyed by run id rather than by goal: this suite shares one database and
    // a claim returns whatever is oldest and PLANNED, which is not necessarily
    // the graph this case just created.
    await createDiamondGraph("Explain why this run ended");
    const claimed = parseClaimedGraph(await claim());
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    const note = "The provider withheld capacity (session or rate limit) for "
      + "every attempt; the run is void. 2 of the nodes counted above did not "
      + "fail: they halted at an open lifecycle gate (architecture).";
    const firstStore = pgliteStore(db, "graph-worker-test");
    await skipFreshClaimNodes(firstStore, claimed.graph.nodes);
    await firstStore.completeRun(claimed.graph.graph_run_id, "CANCELLED", true, note);

    const read = async (graphRunId: string): Promise<string | null> => {
      await asOwner(db);
      const listed = await db.query<{ graph_run_id: string; closure_note: string | null }>(
        "select graph_run_id, closure_note from public.list_graph_runs($1::uuid, 100)",
        [organizationId],
      );
      await reset(db);
      const row = listed.rows.find((candidate) => candidate.graph_run_id === graphRunId);
      expect(row, "the run is missing from the projection").toBeDefined();
      return row?.closure_note ?? null;
    };

    expect(await read(claimed.graph.graph_run_id)).toBe(note);

    // A run closed with nothing to explain carries no note, rather than an
    // empty string that reads as "a reason was recorded and it was blank".
    await createDiamondGraph("Nothing to explain");
    const second = parseClaimedGraph(await claim());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const secondStore = pgliteStore(db, "graph-worker-test");
    await skipFreshClaimNodes(secondStore, second.graph.nodes);
    await secondStore.completeRun(second.graph.graph_run_id, "PARTIAL", true, "   ");

    expect(await read(second.graph.graph_run_id)).toBeNull();
  });
});
