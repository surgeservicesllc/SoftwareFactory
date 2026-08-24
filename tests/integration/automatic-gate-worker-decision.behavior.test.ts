// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { budgetForTemplate, findTemplate } from "@/lib/graph/templates";

/**
 * Anchored automatic gates decide themselves — and nothing else does.
 *
 * The first live lifecycle (graph 91959362, run 6ac300ae) deadlocked at an
 * automatic gate because no caller in the system could ever decide one: the
 * anchored-evidence rule refused approval with zero anchors, and no worker
 * path decided gates at all. `decide_automatic_gate_as_worker` is the missing
 * decider, and these cases pin its whole authority envelope against a real
 * PostgreSQL running the full migration chain:
 *
 *   - zero anchors is refused, exactly as it is for a person;
 *   - a HUMAN gate is refused unconditionally — a worker approving one would
 *     be an automated system approving its own guardrail;
 *   - anchored approval works, records no human decider, and makes the halted
 *     lifecycle claimable again (the decision lands after the run's close, so
 *     the claim's reopen rule sees it);
 *   - a gate a person already decided is returned as they left it.
 */

const migrationsRoot = resolve(import.meta.dirname, "../../supabase/migrations");
const WORKER = "graph-worker-auto-gate";
const EXECUTORS = ["MODEL", "DETERMINISTIC", "ANCHOR"];

const ownerId = "00000000-0000-4000-8000-0000000009b1";
const organizationId = "10000000-0000-4000-8000-0000000009b1";
const projectId = "40000000-0000-4000-8000-0000000009b1";

let db: PGlite;
let graphId: string;

async function asUser(client: PGlite, userId: string) {
  await client.exec("reset role");
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function asWorker(client: PGlite) {
  await client.exec("reset role");
  await client.query("select set_config('request.jwt.claim.sub', '', false)");
  await client.exec("set role service_role");
}

async function nodeId(client: PGlite, key: string): Promise<string> {
  await client.exec("reset role");
  const result = await client.query<{ id: string }>(
    `select id from public.graph_nodes where graph_id = $1 and node_key = $2`,
    [graphId, key],
  );
  return result.rows[0].id;
}

async function claim(client: PGlite): Promise<{ graph_run_id: string } | null> {
  await asWorker(client);
  const result = await client.query<{ c: { graph_run_id: string } | null }>(
    `select public.claim_planned_graph($1, $2) as c`,
    [WORKER, EXECUTORS],
  );
  return result.rows[0].c;
}

async function closeRunAsPartial(client: PGlite, graphRunId: string) {
  await asWorker(client);
  await client.query(
    `select public.complete_graph_run_as_worker($1, $2, 'PARTIAL', true)`,
    [WORKER, graphRunId],
  );
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
    insert into auth.users (id) values ('${ownerId}');
    insert into public.organizations (id, name, slug, created_by)
    values ('${organizationId}', 'Auto Gate Tenant', 'auto-gate-tenant', '${ownerId}');
    insert into public.projects (id, organization_id, name, status, created_by)
    values ('${projectId}', '${organizationId}', 'Auto Gate Project', 'active', '${ownerId}');
  `);

  const template = findTemplate("full_lifecycle")!;
  const built = buildLaunchPlan(template, budgetForTemplate(template, DEFAULT_GRAPH_BUDGET));
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
}, 240_000);

afterAll(async () => {
  await db?.close();
});

describe("decide_automatic_gate_as_worker", () => {
  it("refuses an automatic gate that holds no anchored evidence", async () => {
    const run = await claim(db);
    expect(run).not.toBeNull();

    // The TEST anchor's gate, opened with zero anchors — the state the first
    // live run left behind at its model-node gates.
    const testNode = await nodeId(db, "test");
    await asWorker(db);
    await db.query(`select public.open_node_gate_as_worker($1, $2::uuid, $3::uuid, 0)`,
      [WORKER, testNode, run!.graph_run_id]);

    await expect(
      db.query(`select public.decide_automatic_gate_as_worker($1, $2::uuid)`, [WORKER, testNode]),
    ).rejects.toThrow(/anchored evidence/);
  });

  it("never decides a human gate, whatever evidence exists", async () => {
    const architectureNode = await nodeId(db, "architecture");
    const runId = await (async () => {
      await db.exec("reset role");
      const r = await db.query<{ id: string }>(
        `select id from public.graph_runs where graph_id = $1 order by started_at desc limit 1`,
        [graphId],
      );
      return r.rows[0].id;
    })();
    await asWorker(db);
    await db.query(`select public.open_node_gate_as_worker($1, $2::uuid, $3::uuid, 3)`,
      [WORKER, architectureNode, runId]);

    await expect(
      db.query(`select public.decide_automatic_gate_as_worker($1, $2::uuid)`,
        [WORKER, architectureNode]),
    ).rejects.toThrow(/never decide a human gate/);
  });

  it("approves an anchored automatic gate after the run closes, and the graph is claimable again", async () => {
    // Give the test gate its anchors the honest way: re-open is idempotent,
    // so raise the recorded evidence by updating through the worker's own
    // opener path is impossible — instead the gate row's anchor_count was
    // set at open time. Rebuild the state: reject nothing, just record the
    // evidence a real anchor run would have carried.
    await db.exec("reset role");
    const testNode = await nodeId(db, "test");
    // The gate exists with zero anchors from the first case. A real run
    // records anchors at open; the gate opener refuses to reopen a decided
    // gate but tolerates an update of an undecided one only through SQL —
    // this mirrors what the next run's open call cannot do, so the update
    // here stands in for a run whose anchor genuinely reported.
    await db.query(`update public.graph_gates set anchor_count = 1 where node_id = $1`, [testNode]);

    // Close the claimed run first: the decision must land after the close
    // for the reopen rule to see it.
    const runId = await (async () => {
      const r = await db.query<{ id: string }>(
        `select id from public.graph_runs where graph_id = $1 and state = 'RUNNING' limit 1`,
        [graphId],
      );
      return r.rows[0]?.id;
    })();
    if (runId) await closeRunAsPartial(db, runId);

    await asWorker(db);
    const decided = await db.query<{ state: string; decided_by: string | null; reason: string }>(
      `select (d).state::text as state, (d).decided_by, (d).reason
         from (select public.decide_automatic_gate_as_worker($1, $2::uuid) as d) s`,
      [WORKER, testNode],
    );
    expect(decided.rows[0].state).toBe("APPROVED");
    expect(decided.rows[0].decided_by).toBeNull();
    expect(decided.rows[0].reason).toContain("anchored evidence");

    const reclaimed = await claim(db);
    expect(reclaimed, "the approval must make the halted lifecycle claimable").not.toBeNull();
    await closeRunAsPartial(db, reclaimed!.graph_run_id);
  });

  it("returns a decided gate as it stands instead of re-deciding it", async () => {
    const testNode = await nodeId(db, "test");
    await asWorker(db);
    const second = await db.query<{ state: string }>(
      `select (d).state::text as state
         from (select public.decide_automatic_gate_as_worker($1, $2::uuid) as d) s`,
      [WORKER, testNode],
    );
    // Approved in the previous case; the second call changes nothing.
    expect(second.rows[0].state).toBe("APPROVED");
  });
});
