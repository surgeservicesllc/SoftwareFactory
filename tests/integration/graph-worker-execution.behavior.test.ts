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
    async completeRun(graphRunId, state, hadPartialInput, _detail, usage) {
      await asServiceRole(db);
      await db.query(
        "select public.complete_graph_run_as_worker($1, $2::uuid, $3::public.graph_run_state, $4, $5, $6)",
        [workerId, graphRunId, state, hadPartialInput, usage?.tokensUsed ?? null, usage?.costMicros ?? null],
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

  async function createDiamondGraph(
    goal: string,
    requiresApproval = false,
    nodesJson: string = DIAMOND_NODES,
  ): Promise<string> {
    await asOwner(db);
    const created = await db.query<{ create_graph_from_plan: string }>(
      `select public.create_graph_from_plan(
         $1::uuid, $2::uuid, $3, 'DIAMOND'::public.graph_topology, '[]'::jsonb,
         'green'::public.risk_level, $4, $5::jsonb, $6::jsonb, '{}'::jsonb)`,
      [organizationId, projectId, goal, requiresApproval, nodesJson, DIAMOND_EDGES],
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
    await store.recordNodeState(nodeRunId, "COMPLETED");
    await expect(store.recordNodeState(nodeRunId, "FAILED", "too late")).rejects.toThrow(/terminal/);

    // PARTIAL, not FAILED: a FAILED-only history would put this graph back
    // in the claim queue, and this test is about finality, not retry.
    await store.completeRun(parsed.graph.graph_run_id, "PARTIAL", true);
    await expect(store.completeRun(parsed.graph.graph_run_id, "COMPLETED", false)).rejects.toThrow(/terminal/);

    // The silent-failure guard: incomplete inputs may not read as COMPLETED.
    const another = await createDiamondGraph("Partial cannot complete");
    const claimed = parseClaimedGraph(await claim());
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.graph.graph_id).toBe(another);
    await expect(store.completeRun(claimed.graph.graph_run_id, "COMPLETED", true)).rejects.toThrow(/partial/);
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
    await store.completeRun(first.graph.graph_run_id, "FAILED", false);

    // A failed-only graph goes back in the queue: infrastructure faults are
    // retryable without a person re-planning the graph. The re-claim is a
    // fresh run, not a resurrection of the failed one.
    const second = parseClaimedGraph(await claim());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.graph.graph_id).toBe(graphId);
    expect(second.graph.graph_run_id).not.toBe(first.graph.graph_run_id);
    await store.completeRun(second.graph.graph_run_id, "FAILED", false);

    const third = parseClaimedGraph(await claim());
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.graph.graph_id).toBe(graphId);
    await store.completeRun(third.graph.graph_run_id, "FAILED", false);

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
    await store.completeRun(second.graph.graph_run_id, "PARTIAL", true);
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
    await store.completeRun(tenth.graph.graph_run_id, "CANCELLED", true);

    expect(await claim()).toBeNull();
  });

  it("reclaims a run whose worker died, and leaves live runs alone", async () => {
    const graphId = await createDiamondGraph("Survive a dead worker");
    const abandoned = parseClaimedGraph(await claim());
    expect(abandoned.ok).toBe(true);
    if (!abandoned.ok) return;

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
        where graph_run_id = $1 group by state, blocked_reason`,
      [abandoned.graph.graph_run_id],
    );
    expect(oldNodes.rows).toEqual([
      {
        state: "CANCELLED",
        blocked_reason: "The worker running this graph stopped reporting; the run was reclaimed.",
        count: 4,
      },
    ]);

    const event = await db.query<{ count: number }>(
      `select count(*)::int as count from public.graph_events
        where graph_run_id = $1 and event_type = 'run_failed' and detail like 'Reclaimed by worker%'`,
      [abandoned.graph.graph_run_id],
    );
    expect(event.rows[0].count).toBe(1);

    // The very first test's run is genuinely in flight — recent rows — and
    // the sweep must not have touched it.
    const liveRun = await db.query<{ state: string }>(
      `select r.state from public.graph_runs r
        join public.graphs g on g.id = r.graph_id
       where g.goal = 'Audit three areas and synthesize'`,
    );
    expect(liveRun.rows).toEqual([{ state: "RUNNING" }]);

    // Close the retry with an answer so the queue ends this test empty.
    await pgliteStore(db, "graph-worker-test").completeRun(reclaimed.graph.graph_run_id, "PARTIAL", true);
    expect(await claim()).toBeNull();
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
    await pgliteStore(db, "graph-worker-test").completeRun(claimed.graph.graph_run_id, "PARTIAL", true);
  });

  it("lists graph runs to members with node truth and artifact counts", async () => {
    type ListedRun = {
      goal: string;
      state: string;
      nodes: Array<{ node_key: string; state: string; provider: string | null; error_message: string | null }>;
      artifact_counts: Record<string, number>;
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
    await pgliteStore(db, "graph-worker-test").completeRun(claimed.graph.graph_run_id, "PARTIAL", true);
  });
});
