// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import type { NodeExecutionResult } from "@/lib/graph/runner";
import { budgetForTemplate, findTemplate } from "@/lib/graph/templates";
import { SDLC_STAGES } from "@/lib/sdlc/lifecycle";
import { WORKER_SUPPORTED_EXECUTORS } from "@/lib/worker/executor-support";
import {
  compileClaimedGraph,
  parseClaimedGraph,
  runClaimedGraph,
  type GraphRunStore,
} from "@/lib/worker/graph-run";

/**
 * One request, all ten steps, consecutively, to a completed run.
 *
 * The other lifecycle suites each pin one join of the machine — the template's
 * shape, a gate's refusals, the resume read, the automatic decision. This one
 * drives the whole flow the way production does, end to end: the owner plants
 * the `full_lifecycle` template through `create_graph_from_plan` (the exact
 * write behind the factory pages' launch control), and a worker claims and
 * executes window after window — halting at the ARCHITECTURE human gate, at
 * the TEST anchor's automatic gate, and at the DEPLOYMENT human gate — with
 * the owner approving the human gates and the anchored evidence deciding the
 * automatic one, until the run closes COMPLETED.
 *
 * What the walk must prove, because the ten factory pages read exactly this:
 *
 *   - Step N's recorded result is the persisted state step N+1 consumes: no
 *     node executes twice across the windows (gate-halted and completed work
 *     is reused, never re-paid).
 *   - Every one of the eleven stages holds a COMPLETED node at the end, with
 *     an artifact recorded for each — full lineage from the request to the
 *     monitoring probe.
 *   - The gates land as policy places them and their decisions are audited.
 *   - `list_graph_runs` — the one projection every factory page renders —
 *     reports the finished truth, identically on a second read (refresh), and
 *     reports nothing at all to a signed-in outsider.
 */

const migrationsRoot = resolve(import.meta.dirname, "../../supabase/migrations");

const WORKER = "ten-step-walk-worker";
const ownerId = "00000000-0000-4000-8000-00000000e2e1";
const outsiderId = "00000000-0000-4000-8000-00000000e2e2";
const organizationId = "10000000-0000-4000-8000-00000000e2e1";
const projectId = "20000000-0000-4000-8000-00000000e2e1";

let db: PGlite;
let graphId: string;

async function asUser(client: PGlite, userId: string) {
  await client.exec("reset role");
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await client.exec("set role authenticated");
}

async function asServiceRole(client: PGlite) {
  await client.exec("reset role");
  await client.query("select set_config('request.jwt.claim.sub', '', false)");
  await client.exec("set role service_role");
}

async function reset(client: PGlite) {
  await client.exec("reset role");
}

/** The production store's shape, over PGlite instead of supabase-js. */
function pgliteStore(client: PGlite): GraphRunStore {
  return {
    async recordNodeState(nodeRunId, state, detail, execution) {
      await asServiceRole(client);
      await client.query(
        "select public.record_node_state_as_worker($1, $2::uuid, $3::public.graph_node_state, $4, $5, $6, $7)",
        [WORKER, nodeRunId, state, detail ?? null, execution?.provider ?? null, execution?.model ?? null, execution?.latencyMs ?? null],
      );
      await reset(client);
    },
    async recordArtifact(graphRunId, kind, payload, nodeRunId) {
      await asServiceRole(client);
      await client.query(
        "select public.record_graph_artifact_as_worker($1, $2::uuid, $3::public.graph_artifact_kind, $4::jsonb, $5::uuid)",
        [WORKER, graphRunId, kind, JSON.stringify(payload ?? {}), nodeRunId ?? null],
      );
      await reset(client);
    },
    async readPriorNodeResults(priorGraphId) {
      await asServiceRole(client);
      const result = await client.query<{ node_key: string; payload: unknown }>(
        "select node_key, payload from public.read_prior_node_results_as_worker($1, $2::uuid)",
        [WORKER, priorGraphId],
      );
      await reset(client);
      return new Map(result.rows.map((row) => [row.node_key, row.payload]));
    },
    async openGate(nodeId, graphRunId, anchorCount) {
      await asServiceRole(client);
      await client.query(
        "select public.open_node_gate_as_worker($1, $2::uuid, $3::uuid, $4)",
        [WORKER, nodeId, graphRunId, anchorCount],
      );
      await reset(client);
    },
    async recordVerification(subjectNodeRunId, lens, verdict, evidence, verifierProvider) {
      await asServiceRole(client);
      await client.query(
        "select public.record_verification_as_worker($1, $2::uuid, $3::public.verification_lens, $4::public.verification_verdict, $5::jsonb, null, $6, false)",
        [WORKER, subjectNodeRunId, lens, verdict, JSON.stringify(evidence), verifierProvider],
      );
      await reset(client);
    },
    async completeRun(graphRunId, state, hadPartialInput, _detail, usage) {
      await asServiceRole(client);
      await client.query(
        "select public.complete_graph_run_as_worker($1, $2::uuid, $3::public.graph_run_state, $4, $5, $6)",
        [WORKER, graphRunId, state, hadPartialInput, usage?.tokensUsed ?? null, usage?.costMicros ?? null],
      );
      await reset(client);
    },
  };
}

async function claim(): Promise<unknown> {
  await asServiceRole(db);
  const claimed = await db.query<{ claim_planned_graph: unknown }>(
    "select public.claim_planned_graph($1, $2::text[])",
    [WORKER, WORKER_SUPPORTED_EXECUTORS],
  );
  await reset(db);
  return claimed.rows[0].claim_planned_graph;
}

async function listRunsAs(userId: string): Promise<Array<Record<string, unknown>>> {
  await asUser(db, userId);
  const result = await db.query<Record<string, unknown>>(
    "select * from public.list_graph_runs($1::uuid, 20)",
    [organizationId],
  );
  await reset(db);
  return result.rows;
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create or replace function auth.uid()
    returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create or replace function auth.jwt()
    returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);
  for (const file of (await readdir(migrationsRoot)).filter((n) => /^\d+.*\.sql$/.test(n)).sort()) {
    await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');
    insert into public.organizations (id, name, slug, created_by)
    values ('${organizationId}', 'Ten Step Tenant', 'ten-step-tenant', '${ownerId}');
    insert into public.projects (id, organization_id, name, status, created_by)
    values ('${projectId}', '${organizationId}', 'Ten Step Project', 'active', '${ownerId}');
  `);

  const template = findTemplate("full_lifecycle");
  const built = buildLaunchPlan(template!, budgetForTemplate(template!, DEFAULT_GRAPH_BUDGET));
  if (!built.ok) throw new Error(`full_lifecycle did not compile: ${built.errors.join("; ")}`);

  await asUser(db, ownerId);
  const created = await db.query<{ id: string }>(
    `select public.create_graph_from_plan($1, $2, $3, $4::public.graph_topology, $5::jsonb,
              $6::public.risk_level, $7, $8::jsonb, $9::jsonb, $10::jsonb) as id`,
    [
      organizationId, projectId, built.plan.goal, built.plan.topology,
      JSON.stringify(built.plan.topologyReasons), built.plan.riskLevel,
      built.plan.requiresOwnerApproval,
      JSON.stringify(built.plan.nodes), JSON.stringify(built.plan.edges),
      JSON.stringify(built.plan.budget),
    ],
  );
  graphId = created.rows[0].id;
  await reset(db);
}, 240_000);

afterAll(async () => {
  await db?.close();
});

describe("the ten steps, walked consecutively", { timeout: 240_000 }, () => {
  /** Every executor call across every window, counted per node. */
  const executions = new Map<string, number>();
  let windows = 0;
  let finalState: string | null = null;

  it("drains the lifecycle to COMPLETED across gate-halted windows", async () => {
    const store = pgliteStore(db);

    for (let window = 1; window <= 8; window += 1) {
      const claimed = parseClaimedGraph(await claim());
      if (claimed === null || !claimed.ok) break;
      expect(claimed.graph.graph_id).toBe(graphId);
      windows += 1;

      const compiled = compileClaimedGraph(claimed.graph);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;

      const summary = await runClaimedGraph(claimed.graph, compiled.graph, store, async (node): Promise<NodeExecutionResult> => {
        executions.set(node.nodeKey, (executions.get(node.nodeKey) ?? 0) + 1);
        if (node.executor === "ANCHOR") {
          // A non-model observation, as the anchor executor records one.
          return {
            status: "SUCCEEDED",
            output: { kind: "test_observation", subject: node.nodeKey, verdict: "green" },
            tokensUsed: 0,
          };
        }
        return {
          status: "SUCCEEDED",
          output: { stage_product: node.nodeKey, produced: true },
          tokensUsed: 10,
        };
      });
      finalState = summary.finalState;
      if (summary.finalState === "COMPLETED") break;

      // Between windows the worker's drain decides what it may and a person
      // decides what only a person may — exactly as production does.
      await reset(db);
      const open = await db.query<{ id: string; kind: string; node_id: string; node_key: string }>(
        `select gate.id, gate.kind::text as kind, node.id as node_id, node.node_key
           from public.graph_gates gate
           join public.graph_nodes node on node.id = gate.node_id
          where gate.graph_id = $1 and gate.state = 'OPEN'`,
        [graphId],
      );
      for (const gate of open.rows) {
        if (gate.kind === "HUMAN") {
          await asUser(db, ownerId);
          await db.query(
            "select public.decide_node_gate($1::uuid, true, 'Approved by the owner in the ten-step walk.')",
            [gate.id],
          );
          await reset(db);
        } else {
          await asServiceRole(db);
          await db.query(
            "select public.decide_automatic_gate_as_worker($1, $2::uuid)",
            [WORKER, gate.node_id],
          );
          await reset(db);
        }
      }
    }

    expect(finalState, "the drain must end in a completed run").toBe("COMPLETED");
    expect(windows, "the gates must have split the work into more than one window").toBeGreaterThan(1);
    expect(await claim(), "a completed lifecycle must leave the queue").toBeNull();
  });

  it("paid for each step exactly once: recorded work is reused, never re-executed", async () => {
    expect(executions.size).toBeGreaterThan(0);
    const rerun = [...executions.entries()].filter(([, count]) => count !== 1);
    expect(rerun, "no node may execute twice across the windows").toEqual([]);
  });

  it("closed every one of the eleven stages with a completed node and its artifact", async () => {
    await reset(db);
    const stages = await db.query<{ stage: string; completed: number; artifacts: number }>(
      `select node.lifecycle_stage::text as stage,
              count(*) filter (where nr.state = 'COMPLETED')::int as completed,
              count(a.id)::int as artifacts
         from public.graph_nodes node
         join public.node_runs nr on nr.node_id = node.id
         left join public.graph_artifacts a on a.node_run_id = nr.id
        where node.graph_id = $1 and node.lifecycle_stage is not null
        group by node.lifecycle_stage`,
      [graphId],
    );
    const byStage = new Map(stages.rows.map((row) => [row.stage, row]));
    for (const stage of SDLC_STAGES) {
      const slice = byStage.get(stage);
      expect(slice, `stage ${stage} must hold at least one node run`).toBeDefined();
      expect(slice!.completed, `stage ${stage} must complete`).toBeGreaterThan(0);
      expect(slice!.artifacts, `stage ${stage} must record its product`).toBeGreaterThan(0);
    }
  });

  it("decided the gates as policy places them, and audited every decision", async () => {
    await reset(db);
    const gates = await db.query<{ stage: string; kind: string; state: string; decided_by: string | null; anchor_count: number }>(
      `select stage::text as stage, kind::text as kind, state::text as state, decided_by, anchor_count
         from public.graph_gates where graph_id = $1 order by stage`,
      [graphId],
    );
    const human = gates.rows.filter((row) => row.kind === "HUMAN");
    const automatic = gates.rows.filter((row) => row.kind === "AUTOMATIC");
    expect(human.map((row) => row.stage).sort()).toEqual(["ARCHITECTURE", "DEPLOYMENT"]);
    for (const gate of human) {
      expect(gate.state).toBe("APPROVED");
      expect(gate.decided_by).toBe(ownerId);
    }
    expect(automatic.length).toBeGreaterThan(0);
    for (const gate of automatic) {
      expect(gate.state).toBe("APPROVED");
      expect(gate.decided_by, "no person decides an automatic gate").toBeNull();
      expect(gate.anchor_count, "an automatic approval needs anchored evidence").toBeGreaterThan(0);
    }

    const events = await db.query<{ event_type: string; n: number }>(
      `select event_type::text as event_type, count(*)::int as n
         from public.activity_events
        where organization_id = $1 and event_type::text in ('lifecycle.gate_opened', 'lifecycle.gate_approved')
        group by event_type`,
      [organizationId],
    );
    const byType = new Map(events.rows.map((row) => [row.event_type, row.n]));
    expect(byType.get("lifecycle.gate_opened") ?? 0).toBeGreaterThanOrEqual(gates.rows.length);
    expect(byType.get("lifecycle.gate_approved") ?? 0).toBeGreaterThanOrEqual(gates.rows.length);
  });

  it("reports the finished truth through list_graph_runs, identically on refresh", async () => {
    const first = await listRunsAs(ownerId);
    const run = first.find((row) => row.graph_id === graphId && row.state === "COMPLETED");
    expect(run, "the completed lifecycle must appear in the projection").toBeDefined();
    expect(run!.is_lifecycle).toBe(true);

    const nodes = run!.nodes as Array<{ lifecycle_stage: string | null; state: string }>;
    const completedStages = new Set(
      nodes.filter((node) => node.state === "COMPLETED" && node.lifecycle_stage).map((node) => node.lifecycle_stage),
    );
    for (const stage of SDLC_STAGES) {
      expect(completedStages.has(stage), `the projection must show ${stage} complete`).toBe(true);
    }

    // A refresh performs the same read; the persisted truth does not shift.
    const second = await listRunsAs(ownerId);
    const again = second.find((row) => row.graph_run_id === run!.graph_run_id);
    expect(again).toEqual(run);
  });

  it("refuses a signed-in outsider outright", async () => {
    await expect(listRunsAs(outsiderId)).rejects.toThrow(/organization membership is required/);
    await reset(db);
  });
});
