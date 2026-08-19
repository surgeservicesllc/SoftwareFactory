// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { NodeExecutionResult } from "@/lib/graph/runner";
import {
  compileClaimedGraph,
  parseClaimedGraph,
  runClaimedGraph,
  type GraphRunStore,
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
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000000d1";
const organizationId = "10000000-0000-4000-8000-0000000000d1";
const projectId = "20000000-0000-4000-8000-0000000000d1";

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
      await db.query(
        "select public.record_node_state_as_worker($1, $2::uuid, $3::public.graph_node_state, $4, $5, $6, $7)",
        [workerId, nodeRunId, state, detail ?? null, execution?.provider ?? null, execution?.model ?? null, execution?.latencyMs ?? null],
      );
      await reset(db);
    },
    async recordArtifact(graphRunId, kind, payload, nodeRunId) {
      await asServiceRole(db);
      await db.query(
        "select public.record_graph_artifact_as_worker($1, $2::uuid, $3::public.graph_artifact_kind, $4::jsonb, $5::uuid)",
        [workerId, graphRunId, kind, JSON.stringify(payload ?? {}), nodeRunId ?? null],
      );
      await reset(db);
    },
    async completeRun(graphRunId, state, hadPartialInput) {
      await asServiceRole(db);
      await db.query(
        "select public.complete_graph_run_as_worker($1, $2::uuid, $3::public.graph_run_state, $4)",
        [workerId, graphRunId, state, hadPartialInput],
      );
      await reset(db);
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

describe("the graph executor boundary", { timeout: 180_000 }, () => {
  let db: PGlite;

  async function createDiamondGraph(goal: string, requiresApproval = false): Promise<string> {
    await asOwner(db);
    const created = await db.query<{ create_graph_from_plan: string }>(
      `select public.create_graph_from_plan(
         $1::uuid, $2::uuid, $3, 'DIAMOND'::public.graph_topology, '[]'::jsonb,
         'green'::public.risk_level, $4, $5::jsonb, $6::jsonb, '{}'::jsonb)`,
      [organizationId, projectId, goal, requiresApproval, DIAMOND_NODES, DIAMOND_EDGES],
    );
    await reset(db);
    return created.rows[0].create_graph_from_plan;
  }

  async function claim(workerId = "graph-worker-test"): Promise<unknown> {
    await asServiceRole(db);
    const claimed = await db.query<{ claim_planned_graph: unknown }>(
      "select public.claim_planned_graph($1)",
      [workerId],
    );
    await reset(db);
    return claimed.rows[0].claim_planned_graph;
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
      insert into public.projects (id, organization_id, name, status, default_branch, created_by)
      values ('${projectId}', '${organizationId}', 'Graph Project', 'active', 'main', '${ownerId}');
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
    const executor = async (node: { nodeKey: string }): Promise<NodeExecutionResult> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      executed.push(node.nodeKey);
      await new Promise((tick) => setTimeout(tick, 15));
      inFlight -= 1;
      return { status: "SUCCEEDED", output: { node: node.nodeKey }, provider: "anthropic", model: "claude-opus-5" };
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

    const nodeStates = await db.query<{ state: string; count: number }>(
      `select nr.state, count(*)::int as count from public.node_runs nr
        join public.graph_runs gr on gr.id = nr.graph_run_id
       where gr.graph_id = $1 group by nr.state`, [graphId],
    );
    expect(nodeStates.rows).toEqual([{ state: "COMPLETED", count: 4 }]);

    const run = await db.query<{ state: string; had_partial_input: boolean }>(
      "select state, had_partial_input from public.graph_runs where graph_id = $1", [graphId],
    );
    expect(run.rows[0]).toEqual({ state: "COMPLETED", had_partial_input: false });

    const artifacts = await db.query<{ count: number }>(
      `select count(*)::int as count from public.graph_artifacts a
        join public.graph_runs gr on gr.id = a.graph_run_id
       where gr.graph_id = $1 and a.kind = 'RAW'`, [graphId],
    );
    expect(artifacts.rows[0].count).toBe(4);
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

  it("keeps terminal states final on both nodes and runs", async () => {
    await createDiamondGraph("Terminal protection");
    const parsed = parseClaimedGraph(await claim());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const nodeRunId = parsed.graph.nodes[0].node_run_id;
    const store = pgliteStore(db, "graph-worker-test");
    await store.recordNodeState(nodeRunId, "COMPLETED");
    await expect(store.recordNodeState(nodeRunId, "FAILED", "too late")).rejects.toThrow(/terminal/);

    await store.completeRun(parsed.graph.graph_run_id, "FAILED", false);
    await expect(store.completeRun(parsed.graph.graph_run_id, "COMPLETED", false)).rejects.toThrow(/terminal/);

    // The silent-failure guard: incomplete inputs may not read as COMPLETED.
    const another = await createDiamondGraph("Partial cannot complete");
    const claimed = parseClaimedGraph(await claim());
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.graph.graph_id).toBe(another);
    await expect(store.completeRun(claimed.graph.graph_run_id, "COMPLETED", true)).rejects.toThrow(/partial/);
  });
});
