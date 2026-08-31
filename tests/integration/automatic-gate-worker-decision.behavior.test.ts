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
 *   - positive anchors cannot be decided before their exact opener run closes;
 *   - anchored approval works, records no human decider, and makes the halted
 *     lifecycle claimable again (the decision lands after the run's close, so
 *     the claim's reopen rule sees it);
 *   - exact retries return the decision without duplicating its audit event;
 *   - stale opener evidence is discarded when the gate rebinds to a fresh run.
 */

const migrationsRoot = resolve(import.meta.dirname, "../../supabase/migrations");
const WORKER = "graph-worker-auto-gate";
const EXECUTORS = ["MODEL", "DETERMINISTIC", "ANCHOR"];
const CLAIM_REPOSITORY = "factory/auto-gate";
const CLAIM_REQUIRED_CHECKS = ["CI"];

const ownerId = "00000000-0000-4000-8000-0000000009b1";
const organizationId = "10000000-0000-4000-8000-0000000009b1";
const projectId = "40000000-0000-4000-8000-0000000009b1";

let db: PGlite;
let graphId: string;
let approvedAutomaticGraphId: string;

async function asUser(client: PGlite, userId: string) {
  await client.exec("reset role");
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function asWorker(client: PGlite) {
  await client.exec("reset role");
  await client.query("select set_config('request.jwt.claim.sub', '', false)");
  await client.exec("set role service_role");
}

async function nodeId(client: PGlite, targetGraphId: string, key: string): Promise<string> {
  await client.exec("reset role");
  const result = await client.query<{ id: string }>(
    `select id from public.graph_nodes where graph_id = $1 and node_key = $2`,
    [targetGraphId, key],
  );
  return result.rows[0].id;
}

async function prepareGateNode(
  client: PGlite,
  targetGraphId: string,
  graphRunId: string,
  key: string,
  anchorCount = 0,
  finalState: "VERIFYING" | "COMPLETED" = "VERIFYING",
): Promise<{ nodeId: string; nodeRunId: string }> {
  await client.exec("reset role");
  const result = await client.query<{ executor: string; node_id: string; node_run_id: string }>(
    `select node.id as node_id, node_run.id as node_run_id,
            node.executor::text as executor
       from public.graph_runs run
       join public.graph_nodes node
         on node.graph_id = run.graph_id
        and node.graph_id = $2
        and node.node_key = $3
       join public.node_runs node_run
         on node_run.graph_run_id = run.id
        and node_run.node_id = node.id
        and node_run.organization_id = run.organization_id
      where run.id = $1 and run.state = 'RUNNING'`,
    [graphRunId, targetGraphId, key],
  );
  expect(result.rows, `${key} must belong to the exact live run`).toHaveLength(1);

  await asWorker(client);
  await client.query(
    `select public.record_node_state_as_worker($1, $2::uuid, 'RUNNING'::public.graph_node_state, $3)`,
    [WORKER, result.rows[0].node_run_id, `${key} anchor executing`],
  );
  // One node owns one durable product slot. An ANCHOR product is an array,
  // including the empty array that truthfully represents zero observations.
  const isAnchor = result.rows[0].executor === "ANCHOR";
  await client.query(
    `select public.record_graph_artifact_as_worker(
      $1, $2::uuid, $3::public.graph_artifact_kind, $4::jsonb, $5::uuid
    )`,
    [
      WORKER,
      graphRunId,
      isAnchor ? "ANCHOR" : "RAW",
      JSON.stringify(isAnchor
        ? Array.from({ length: anchorCount }, (_, index) => ({
          check: `${key}-${index + 1}`,
          exitCode: 0,
        }))
        : { fixture: `${key} evidence` }),
      result.rows[0].node_run_id,
    ],
  );
  await client.query(
    `select public.record_node_state_as_worker(
      $1, $2::uuid, $3::public.graph_node_state, $4
    )`,
    [
      WORKER,
      result.rows[0].node_run_id,
      finalState,
      finalState === "COMPLETED" ? `${key} completed with exact evidence` : `${key} evidence ready for gate`,
    ],
  );
  return { nodeId: result.rows[0].node_id, nodeRunId: result.rows[0].node_run_id };
}

async function claim(client: PGlite): Promise<{ graph_run_id: string } | null> {
  await asWorker(client);
  const result = await client.query<{ c: { graph_run_id: string } | null }>(
    `select public.claim_planned_graph_v3($1, $2, $3, $4::jsonb, 3) as c`,
    [WORKER, EXECUTORS, CLAIM_REPOSITORY, JSON.stringify(CLAIM_REQUIRED_CHECKS)],
  );
  return result.rows[0].c;
}

async function skipUnstartedNodes(client: PGlite, graphRunId: string) {
  await client.exec("reset role");
  const nodes = await client.query<{ id: string; state: string }>(
    `select id, state::text as state from public.node_runs
      where graph_run_id = $1
        and state in ('PENDING', 'READY', 'BLOCKED', 'RUNNING')`,
    [graphRunId],
  );
  for (const node of nodes.rows) {
    await asWorker(client);
    await client.query(
      `select public.record_node_state_as_worker(
        $1, $2::uuid, 'SKIPPED'::public.graph_node_state,
        'gate fixture intentionally did not execute this node'
      )`,
      [WORKER, node.id],
    );
  }
}

async function closeRunAsPartial(client: PGlite, graphRunId: string) {
  await skipUnstartedNodes(client, graphRunId);
  await asWorker(client);
  await client.query(
    `select public.complete_graph_run_with_phase1c_bridge_as_worker($1, $2, 'PARTIAL', true)`,
    [WORKER, graphRunId],
  );
}

async function closeRunAsFailed(client: PGlite, graphRunId: string) {
  await skipUnstartedNodes(client, graphRunId);
  await asWorker(client);
  await client.query(
    `select public.complete_graph_run_with_phase1c_bridge_as_worker($1, $2, 'FAILED', true)`,
    [WORKER, graphRunId],
  );
}

async function closeRunAsCompleted(client: PGlite, graphRunId: string) {
  // This helper constructs a genuinely successful opener. The suite is about
  // the gate decision, so unrelated lifecycle nodes are authoritative fixture
  // state, but they still traverse RUNNING before COMPLETED.
  await client.exec("reset role");
  await client.query(
    `update public.node_runs
        set state = 'RUNNING', started_at = coalesce(started_at, now())
      where graph_run_id = $1 and state in ('PENDING', 'READY', 'BLOCKED')`,
    [graphRunId],
  );
  await client.query(
    `update public.node_runs
        set state = 'COMPLETED', completed_at = coalesce(completed_at, now())
      where graph_run_id = $1 and state = 'RUNNING'`,
    [graphRunId],
  );
  await asWorker(client);
  await client.query(
    `select public.complete_graph_run_with_phase1c_bridge_as_worker($1, $2, 'COMPLETED', false)`,
    [WORKER, graphRunId],
  );
}

async function approvalAuditCount(client: PGlite, gateId: string): Promise<number> {
  await client.exec("reset role");
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count
       from public.activity_events
      where entity_type = 'graph_gate'
        and entity_id = $1
        and event_type = 'lifecycle.gate_approved'`,
    [gateId],
  );
  return Number(result.rows[0].count);
}

async function createLifecycleGraph(client: PGlite, fixtureName: string): Promise<string> {
  // Exercise the automatic-gate boundary on the legacy Agentic SDLC
  // lifecycle, whose ANCHOR-backed TEST gate is intentionally AUTOMATIC.
  // Full Lifecycle v2 keeps TEST as an evidence-bound HUMAN release gate and
  // must never be weakened just to make this worker-authority fixture pass.
  const template = findTemplate("agentic_sdlc")!;
  const built = buildLaunchPlan(template, budgetForTemplate(template, DEFAULT_GRAPH_BUDGET));
  if (!built.ok) throw new Error(`agentic_sdlc did not compile: ${built.errors.join("; ")}`);

  await asUser(client, ownerId);
  const created = await client.query<{ id: string }>(
    `select public.create_graph_from_plan($1, $2, $3, $4::public.graph_topology, $5::jsonb,
              $6::public.risk_level, $7, $8::jsonb, $9::jsonb, $10::jsonb) as id`,
    [
      organizationId, projectId, `${built.plan.goal} [${fixtureName}]`, built.plan.topology,
      JSON.stringify(built.plan.topologyReasons), built.plan.riskLevel,
      built.plan.requiresOwnerApproval,
      JSON.stringify(built.plan.nodes), JSON.stringify(built.plan.edges),
      JSON.stringify(built.plan.budget),
    ],
  );
  return created.rows[0].id;
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
    insert into public.projects (
      id, organization_id, name, status, github_repository, created_by
    ) values (
      '${projectId}', '${organizationId}', 'Auto Gate Project', 'active',
      '${CLAIM_REPOSITORY}', '${ownerId}'
    );
    insert into public.connections (
      id, organization_id, name, provider, status, secret_reference, created_by
    ) values (
      '30000000-0000-4000-8000-0000000009b1', '${organizationId}',
      'GitHub', 'github', 'connected', 'env://GITHUB_APP', '${ownerId}'
    );
    insert into public.github_installations (
      id, organization_id, connection_id, external_installation_id, app_id,
      app_slug, account_id, account_login, account_type, target_type,
      repository_selection, status, installed_at, created_by
    ) values (
      '50000000-0000-4000-8000-0000000009b1', '${organizationId}',
      '30000000-0000-4000-8000-0000000009b1', 930001, 930002,
      'auto-gate-app', 930003, 'factory', 'Organization', 'Organization',
      'selected', 'active', now(), '${ownerId}'
    );
    insert into public.github_repositories (
      id, organization_id, installation_id, external_repository_id,
      owner_login, name, full_name, default_branch, html_url, private,
      visibility, selected, github_updated_at
    ) values (
      '60000000-0000-4000-8000-0000000009b1', '${organizationId}',
      '50000000-0000-4000-8000-0000000009b1', 930004,
      'factory', 'auto-gate', '${CLAIM_REPOSITORY}', 'main',
      'https://github.com/${CLAIM_REPOSITORY}', true, 'private', true, now()
    );
    insert into public.project_connections (
      organization_id, project_id, connection_id, github_repository_id,
      is_primary, created_by
    ) values (
      '${organizationId}', '${projectId}',
      '30000000-0000-4000-8000-0000000009b1',
      '60000000-0000-4000-8000-0000000009b1', true, '${ownerId}'
    );
  `);

  graphId = await createLifecycleGraph(db, "zero-anchor gate");
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
    const testNode = await prepareGateNode(db, graphId, run!.graph_run_id, "test");
    await asWorker(db);
    await db.query(`select public.open_node_gate_as_worker($1, $2::uuid, $3::uuid, 0)`,
      [WORKER, testNode.nodeId, run!.graph_run_id]);

    await closeRunAsPartial(db, run!.graph_run_id);
    await asWorker(db);
    await expect(
      db.query(`select public.decide_automatic_gate_as_worker($1, $2::uuid)`, [WORKER, testNode.nodeId]),
    ).rejects.toThrow(/anchored evidence/);
  });

  it("never decides a human gate, whatever evidence exists", async () => {
    const humanGraphId = await createLifecycleGraph(db, "human gate boundary");
    const run = await claim(db);
    expect(run).not.toBeNull();
    const architectureNode = await prepareGateNode(
      db, humanGraphId, run!.graph_run_id, "architecture",
    );
    await asWorker(db);
    await db.query(`select public.open_node_gate_as_worker($1, $2::uuid, $3::uuid, 0)`,
      [WORKER, architectureNode.nodeId, run!.graph_run_id]);

    await expect(
      db.query(`select public.decide_automatic_gate_as_worker($1, $2::uuid)`,
        [WORKER, architectureNode.nodeId]),
    ).rejects.toThrow(/never decide a human gate/);
    await closeRunAsPartial(db, run!.graph_run_id);
  });

  it("approves an anchored automatic gate after the run closes, and the graph is claimable again", async () => {
    approvedAutomaticGraphId = await createLifecycleGraph(db, "anchored automatic gate");
    const run = await claim(db);
    expect(run).not.toBeNull();
    const testNode = await prepareGateNode(
      db, approvedAutomaticGraphId, run!.graph_run_id, "test", 1,
    );
    await asWorker(db);
    const opened = await db.query<{ id: string }>(
      `select (public.open_node_gate_as_worker($1, $2::uuid, $3::uuid, 1)).id as id`,
      [WORKER, testNode.nodeId, run!.graph_run_id]);

    await expect(
      db.query(`select public.decide_automatic_gate_as_worker($1, $2::uuid)`,
        [WORKER, testNode.nodeId]),
    ).rejects.toThrow(/opener run.*terminal/i);
    await db.exec("reset role");
    const stillOpen = await db.query<{ state: string; opened_by_run_id: string }>(
      `select state::text as state, opened_by_run_id from public.graph_gates where id = $1`,
      [opened.rows[0].id],
    );
    expect(stillOpen.rows[0]).toEqual({
      state: "OPEN",
      opened_by_run_id: run!.graph_run_id,
    });
    expect(await approvalAuditCount(db, opened.rows[0].id)).toBe(0);

    // The decision lands after the worker has atomically closed the run, so a
    // later claim can prove the approval is newer than the halted execution.
    await closeRunAsPartial(db, run!.graph_run_id);

    await asWorker(db);
    const decided = await db.query<{ state: string; decided_by: string | null; reason: string }>(
      `select (d).state::text as state, (d).decided_by, (d).reason
         from (select public.decide_automatic_gate_as_worker($1, $2::uuid) as d) s`,
      [WORKER, testNode.nodeId],
    );
    expect(decided.rows[0].state).toBe("APPROVED");
    expect(decided.rows[0].decided_by).toBeNull();
    expect(decided.rows[0].reason).toContain("anchored evidence");
    expect(await approvalAuditCount(db, opened.rows[0].id)).toBe(1);

    const reclaimed = await claim(db);
    expect(reclaimed, "the approval must make the halted lifecycle claimable").not.toBeNull();
    await closeRunAsPartial(db, reclaimed!.graph_run_id);
  });

  it("approves anchored evidence from its exact COMPLETED opener run", async () => {
    const completedGraphId = await createLifecycleGraph(db, "completed automatic gate");
    const run = await claim(db);
    expect(run).not.toBeNull();
    const testNode = await prepareGateNode(
      db,
      completedGraphId,
      run!.graph_run_id,
      "test",
      1,
      "COMPLETED",
    );
    await asWorker(db);
    const opened = await db.query<{ id: string }>(
      `select (public.open_node_gate_as_worker($1, $2::uuid, $3::uuid, 1)).id as id`,
      [WORKER, testNode.nodeId, run!.graph_run_id],
    );
    await closeRunAsCompleted(db, run!.graph_run_id);

    await asWorker(db);
    const decided = await db.query<{ state: string; opened_by_run_id: string }>(
      `select (gate).state::text as state, (gate).opened_by_run_id
         from (select public.decide_automatic_gate_as_worker($1, $2::uuid) as gate) decided`,
      [WORKER, testNode.nodeId],
    );
    expect(decided.rows[0]).toEqual({
      state: "APPROVED",
      opened_by_run_id: run!.graph_run_id,
    });
    expect(await approvalAuditCount(db, opened.rows[0].id)).toBe(1);

    // Consume the approval-triggered lifecycle retry so this fixture cannot
    // compete with the stale-rebind graph created by the later case.
    const reclaimed = await claim(db);
    expect(reclaimed).not.toBeNull();
    await closeRunAsPartial(db, reclaimed!.graph_run_id);
  });

  it("returns a decided gate as it stands instead of re-deciding it", async () => {
    const testNode = await nodeId(db, approvedAutomaticGraphId, "test");
    await db.exec("reset role");
    const gate = await db.query<{ id: string }>(
      `select id from public.graph_gates where node_id = $1`,
      [testNode],
    );
    await asWorker(db);
    const second = await db.query<{ state: string }>(
      `select (d).state::text as state
         from (select public.decide_automatic_gate_as_worker($1, $2::uuid) as d) s`,
      [WORKER, testNode],
    );
    // Approved in the previous case; the second call changes nothing.
    expect(second.rows[0].state).toBe("APPROVED");
    expect(await approvalAuditCount(db, gate.rows[0].id)).toBe(1);
  });

  it("rebinds an undecided gate only after its prior opener run has failed", async () => {
    const reboundGraphId = await createLifecycleGraph(db, "stale opener rebind");
    const staleRun = await claim(db);
    expect(staleRun).not.toBeNull();
    const staleNode = await prepareGateNode(
      db,
      reboundGraphId,
      staleRun!.graph_run_id,
      "test",
      1,
      "COMPLETED",
    );
    await asWorker(db);
    const opened = await db.query<{ id: string; opened_by_run_id: string }>(
      `select (gate).id, (gate).opened_by_run_id
         from (select public.open_node_gate_as_worker($1, $2::uuid, $3::uuid, 1) as gate) opened`,
      [WORKER, staleNode.nodeId, staleRun!.graph_run_id],
    );
    expect(opened.rows[0].opened_by_run_id).toBe(staleRun!.graph_run_id);
    await closeRunAsFailed(db, staleRun!.graph_run_id);

    const freshRun = await claim(db);
    expect(freshRun).not.toBeNull();
    const freshNode = await prepareGateNode(db, reboundGraphId, freshRun!.graph_run_id, "test");
    await asWorker(db);
    const rebound = await db.query<{ id: string; opened_by_run_id: string; anchor_count: number }>(
      `select (gate).id, (gate).opened_by_run_id, (gate).anchor_count
         from (select public.open_node_gate_as_worker($1, $2::uuid, $3::uuid, 0) as gate) opened`,
      [WORKER, freshNode.nodeId, freshRun!.graph_run_id],
    );
    expect(rebound.rows[0]).toMatchObject({
      id: opened.rows[0].id,
      opened_by_run_id: freshRun!.graph_run_id,
      anchor_count: 0,
    });

    await closeRunAsPartial(db, freshRun!.graph_run_id);
    expect(await approvalAuditCount(db, opened.rows[0].id)).toBe(0);

    await asUser(db, ownerId);
    await expect(
      db.query(`select public.decide_node_gate($1, true, 'approve stale evidence')`,
        [opened.rows[0].id]),
    ).rejects.toThrow(/automatic gate approval is worker-only and evidence-bound/);

    await asWorker(db);
    await expect(
      db.query(`select public.decide_automatic_gate_as_worker($1, $2::uuid)`,
        [WORKER, freshNode.nodeId]),
    ).rejects.toThrow(/anchored evidence/);

    await db.exec("reset role");
    const preserved = await db.query<{
      state: string;
      opened_by_run_id: string;
      anchor_count: number;
    }>(
      `select state::text as state, opened_by_run_id, anchor_count
         from public.graph_gates where id = $1`,
      [opened.rows[0].id],
    );
    expect(preserved.rows[0]).toEqual({
      state: "OPEN",
      opened_by_run_id: freshRun!.graph_run_id,
      anchor_count: 0,
    });
    expect(await approvalAuditCount(db, opened.rows[0].id)).toBe(0);

    await db.exec("reset role");
    const events = await db.query<{ count: string }>(
      `select count(*)::text as count
         from public.graph_events
        where graph_run_id = $1 and event_type = 'gate_rebound'`,
      [freshRun!.graph_run_id],
    );
    expect(Number(events.rows[0].count)).toBe(1);
  });
});
