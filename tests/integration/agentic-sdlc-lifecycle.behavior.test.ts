// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import type { NodeExecutionResult } from "@/lib/graph/runner";
import {
  compileClaimedGraph,
  parseClaimedGraph,
  runClaimedGraph,
  type GraphRunStore,
} from "@/lib/worker/graph-run";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { findTemplate } from "@/lib/graph/templates";

/**
 * The lifecycle against real PostgreSQL, on the worker that already runs graphs.
 *
 * PGlite runs as a superuser, which bypasses row level security — so nothing
 * here is evidence that a policy holds. What it *is* evidence for is everything
 * a policy cannot express: that the migration applies, that the gate functions
 * refuse what they claim to, that the claim projects what the worker needs, and
 * above all that an approval survives the run that asked for it. The RLS
 * assertions are the ones reading `pg_class` and `information_schema` directly,
 * which a superuser cannot make lie.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");
const WORKER = "graph-worker-lifecycle";
const EXECUTORS = ["MODEL", "DETERMINISTIC", "ANCHOR"];
const CLAIM_REPOSITORY = "factory/lifecycle";
const CLAIM_REQUIRED_CHECKS = ["CI"];

const ownerId = "00000000-0000-4000-8000-0000000007a1";
const memberId = "00000000-0000-4000-8000-0000000007a2";
const organizationId = "10000000-0000-4000-8000-0000000007a1";
const projectId = "40000000-0000-4000-8000-0000000007a1";

const NODE_OUTPUT_SCHEMA = {
  type: "object",
  properties: { node: { type: "string" } },
  required: ["node"],
  additionalProperties: false,
} as const;

function inboundNodeSchema(dependency: string) {
  return {
    type: "object",
    properties: {
      outputs: {
        type: "object",
        properties: { [dependency]: NODE_OUTPUT_SCHEMA },
        additionalProperties: false,
      },
      missing: {
        type: "array",
        items: { type: "string", enum: [dependency] },
        maxItems: 1,
      },
    },
    required: ["outputs", "missing"],
    additionalProperties: false,
  } as const;
}

type ClaimedNode = {
  node_key: string;
  node_id: string;
  node_run_id: string;
  lifecycle_stage: string | null;
  gate_kind: string | null;
  gate_state: string | null;
};
type Claim = {
  graph_run_id: string;
  is_lifecycle: boolean;
  iteration: number;
  max_iterations: number;
  nodes: ClaimedNode[];
  edges: { from_node_key: string; to_node_key: string }[];
};

async function asUser(db: PGlite, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function asWorker(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec("set role service_role");
}

async function skipUnstartedNodes(db: PGlite, graphRunId: string) {
  await db.exec("reset role");
  const nodes = await db.query<{ id: string }>(
    `select id from public.node_runs
      where graph_run_id = $1
        and state in ('PENDING', 'READY', 'BLOCKED', 'RUNNING')`,
    [graphRunId],
  );
  for (const node of nodes.rows) {
    await asWorker(db);
    await db.query(
      `select public.record_node_state_as_worker(
        $1, $2::uuid, 'SKIPPED'::public.graph_node_state,
        'lifecycle fixture intentionally did not execute this node'
      )`,
      [WORKER, node.id],
    );
  }
}

/**
 * Close the current run the way the worker does when it halts at a gate.
 *
 * The claim predicate requires that nothing is in flight, which is correct: a
 * second worker must not pick up a graph the first is still running. So a test
 * that wants to observe the *next* claim has to close the current run first,
 * exactly as the worker would.
 */
async function closeRunAsPartial(db: PGlite, graphRunId: string) {
  await skipUnstartedNodes(db, graphRunId);
  await asWorker(db);
  await db.query(
    `select public.complete_graph_run_with_phase1c_bridge_as_worker($1, $2, 'PARTIAL', true)`,
    [WORKER, graphRunId],
  );
}

/**
 * The most recent run of the graph, read as nobody in particular.
 *
 * `service_role` bypasses row level security but holds no table grants at all —
 * every worker write goes through a SECURITY DEFINER function — so a direct
 * select while that role is set is a permission error, not a tenancy one.
 */
async function latestRunId(db: PGlite, graphId: string): Promise<string> {
  await db.exec("reset role");
  const result = await db.query<{ id: string }>(
    `select id from public.graph_runs where graph_id = $1 order by started_at desc limit 1`,
    [graphId],
  );
  return result.rows[0].id;
}

async function prepareGateNode(
  db: PGlite,
  graphRunId: string,
  nodeKey: string,
  finalState: "VERIFYING" | "COMPLETED" = "VERIFYING",
): Promise<{ nodeId: string; nodeRunId: string }> {
  await db.exec("reset role");
  const result = await db.query<{
    capability: string;
    executor: string;
    node_id: string;
    node_run_id: string;
  }>(
    `select node.id as node_id, node_run.id as node_run_id,
            node.executor::text as executor, node.capability
       from public.graph_runs run
       join public.graph_nodes node on node.graph_id = run.graph_id
       join public.node_runs node_run
         on node_run.graph_run_id = run.id
        and node_run.node_id = node.id
        and node_run.organization_id = run.organization_id
      where run.id = $1 and run.state = 'RUNNING' and node.node_key = $2`,
    [graphRunId, nodeKey],
  );
  expect(result.rows, `${nodeKey} must have an exact node run on the live graph run`).toHaveLength(1);

  await asWorker(db);
  await db.query(
    `select public.record_node_state_as_worker($1, $2::uuid, 'RUNNING'::public.graph_node_state, $3)`,
    [WORKER, result.rows[0].node_run_id, `${nodeKey} evidence collection started`],
  );
  const artifactKind = result.rows[0].executor === "ANCHOR"
    ? "ANCHOR"
    : ["synthesis", "reporting"].includes(result.rows[0].capability)
      ? "SYNTHESIS"
      : result.rows[0].executor === "DETERMINISTIC" && result.rows[0].capability === "extraction"
        ? "REDUCED"
        : "RAW";
  await db.query(
    `select public.record_graph_artifact_as_worker(
      $1, $2::uuid, $3::public.graph_artifact_kind, $4::jsonb, $5::uuid
    )`,
    [
      WORKER,
      graphRunId,
      artifactKind,
      JSON.stringify(artifactKind === "ANCHOR" ? [] : { fixture: `${nodeKey} evidence` }),
      result.rows[0].node_run_id,
    ],
  );
  await db.query(
    `select public.record_node_state_as_worker($1, $2::uuid, $3::public.graph_node_state, $4)`,
    [
      WORKER,
      result.rows[0].node_run_id,
      finalState,
      finalState === "COMPLETED"
        ? `${nodeKey} completed with exact evidence`
        : `${nodeKey} evidence ready for gate`,
    ],
  );
  return { nodeId: result.rows[0].node_id, nodeRunId: result.rows[0].node_run_id };
}

/**
 * The real worker's persistence, against this database.
 *
 * Every write goes through the same SECURITY DEFINER function the deployed
 * worker calls, so a test that passes here exercises the actual boundary rather
 * than a mock of it — including the gate opener, which is the part under test.
 */
function workerStore(db: PGlite): GraphRunStore {
  return {
    async recordNodeState(nodeRunId, state, detail, execution) {
      await asWorker(db);
      await db.query(
        `select public.record_node_state_as_worker($1, $2::uuid, $3::public.graph_node_state, $4, $5, $6, $7)`,
        [WORKER, nodeRunId, state, detail ?? null,
         execution?.provider ?? null, execution?.model ?? null, execution?.latencyMs ?? null],
      );
      await db.exec("reset role");
    },
    async recordArtifact(graphRunId, kind, payload, nodeRunId) {
      await asWorker(db);
      await db.query(
        `select public.record_graph_artifact_as_worker($1, $2::uuid, $3::public.graph_artifact_kind, $4::jsonb, $5::uuid)`,
        [WORKER, graphRunId, kind, JSON.stringify(payload ?? {}), nodeRunId ?? null],
      );
      await db.exec("reset role");
    },
    async completeReviewerWithVerifications(verifierNodeRunId, artifactPayload, execution, verifications) {
      await asWorker(db);
      await db.query(
        `select public.complete_reviewer_with_verifications_as_worker(
          $1, $2::uuid, $3::jsonb, $4, $5, $6, $7::jsonb
        )`,
        [WORKER, verifierNodeRunId, JSON.stringify(artifactPayload),
          execution.provider, execution.model, execution.latencyMs,
          JSON.stringify(verifications)],
      );
      await db.exec("reset role");
    },
    async openGate(nodeId, graphRunId, anchorCount) {
      await asWorker(db);
      await db.query(`select public.open_node_gate_as_worker($1, $2::uuid, $3::uuid, $4)`,
        [WORKER, nodeId, graphRunId, anchorCount]);
      await db.exec("reset role");
    },
    async completeRun(graphRunId, state, hadPartialInput, detail, usage) {
      await asWorker(db);
      await db.query(
        `select public.complete_graph_run_with_phase1c_bridge_as_worker($1, $2::uuid, $3::public.graph_run_state, $4, $5, $6, null, $7)`,
        [
          WORKER, graphRunId, state, hadPartialInput,
          usage?.tokensUsed ?? null, usage?.costMicros ?? null, detail ?? null,
        ],
      );
      await db.exec("reset role");
    },
  };
}

async function claim(db: PGlite): Promise<Claim | null> {
  await asWorker(db);
  const result = await db.query<{ c: Claim | null }>(
    `select public.claim_planned_graph_v2($1, $2, $3, $4::jsonb, 2) as c`,
    [WORKER, EXECUTORS, CLAIM_REPOSITORY, JSON.stringify(CLAIM_REQUIRED_CHECKS)],
  );
  return result.rows[0].c;
}

describe("the Agentic SDLC on the graph worker", () => {
  let db: PGlite;
  let graphId: string;

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
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Lifecycle Factory', 'lifecycle-factory', '${ownerId}');
      insert into public.projects (
        id, organization_id, name, status, github_repository, created_by
      ) values (
        '${projectId}', '${organizationId}', 'Lifecycle Project', 'active',
        '${CLAIM_REPOSITORY}', '${ownerId}'
      );
      insert into public.connections (
        id, organization_id, name, provider, status, secret_reference, created_by
      ) values (
        '30000000-0000-4000-8000-0000000007a1', '${organizationId}',
        'GitHub', 'github', 'connected', 'env://GITHUB_APP', '${ownerId}'
      );
      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id,
        app_slug, account_id, account_login, account_type, target_type,
        repository_selection, status, installed_at, created_by
      ) values (
        '50000000-0000-4000-8000-0000000007a1', '${organizationId}',
        '30000000-0000-4000-8000-0000000007a1', 920001, 920002,
        'lifecycle-app', 920003, 'factory', 'Organization', 'Organization',
        'selected', 'active', now(), '${ownerId}'
      );
      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id,
        owner_login, name, full_name, default_branch, html_url, private,
        visibility, selected, github_updated_at
      ) values (
        '60000000-0000-4000-8000-0000000007a1', '${organizationId}',
        '50000000-0000-4000-8000-0000000007a1', 920004,
        'factory', 'lifecycle', '${CLAIM_REPOSITORY}', 'main',
        'https://github.com/${CLAIM_REPOSITORY}', true, 'private', true, now()
      );
      insert into public.project_connections (
        organization_id, project_id, connection_id, github_repository_id,
        is_primary, created_by
      ) values (
        '${organizationId}', '${projectId}',
        '30000000-0000-4000-8000-0000000007a1',
        '60000000-0000-4000-8000-0000000007a1', true, '${ownerId}'
      );
    `);
    await db.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, 'member')
       on conflict (organization_id, user_id) do update set role = 'member'`,
      [organizationId, memberId],
    );

    const template = findTemplate("agentic_sdlc");
    const built = buildLaunchPlan(template!, DEFAULT_GRAPH_BUDGET);
    if (!built.ok) throw new Error(`the SDLC template did not compile: ${built.errors.join("; ")}`);

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

  it("keeps row security, force row security and read-only grants on graph_gates", async () => {
    await db.exec("reset role");
    const security = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relrowsecurity, relforcerowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relname = 'graph_gates'`,
    );
    expect(security.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    const grants = await db.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'graph_gates'
          and grantee in ('anon', 'authenticated')`,
    );
    expect(grants.rows).toEqual([{ grantee: "authenticated", privilege_type: "SELECT" }]);
  });

  it("records a stage on every node the template staged", async () => {
    await db.exec("reset role");
    const staged = await db.query<{ node_key: string; lifecycle_stage: string | null }>(
      `select node_key, lifecycle_stage from public.graph_nodes where graph_id = $1`,
      [graphId],
    );
    expect(staged.rows).toHaveLength(12);
    expect(staged.rows.every((row) => row.lifecycle_stage !== null)).toBe(true);
    expect(new Set(staged.rows.map((row) => row.lifecycle_stage))).toEqual(
      new Set(["GOAL", "PRD", "ARCHITECTURE", "IMPLEMENTATION", "REVIEW", "TEST", "DEPLOYMENT", "MONITORING"]),
    );
  });

  it("stores the feedback edges but withholds them from the claim", async () => {
    await db.exec("reset role");
    const stored = await db.query<{ is_feedback: boolean; count: string }>(
      `select is_feedback, count(*)::text as count from public.graph_edges
        where graph_id = $1 group by is_feedback order by is_feedback`,
      [graphId],
    );
    const feedback = Number(stored.rows.find((r) => r.is_feedback === true)?.count ?? 0);
    const forward = Number(stored.rows.find((r) => r.is_feedback === false)?.count ?? 0);
    expect(feedback).toBe(4);
    expect(forward).toBe(14);

    const claimed = await claim(db);
    expect(claimed).not.toBeNull();
    // The compiler rejects cycles. A claim carrying the backward edges would
    // produce a graph that never compiles and therefore never runs.
    expect(claimed!.edges).toHaveLength(forward);
  });

  it("tells the worker which nodes are staged and which wait at a gate", async () => {
    const claimed = await claim(db);
    expect(claimed, "a live RUNNING graph cannot be claimed by a second worker").toBeNull();

    // The real worker opens a gate while both its graph run and exact node run
    // are live, then closes the parent run before a decision is made. Recreate
    // that order here instead of attaching evidence to an already-closed run.
    const priorRunId = await latestRunId(db, graphId);
    const deploy = await prepareGateNode(db, priorRunId, "deploy");
    await asWorker(db);
    const gate = await db.query<{ id: string }>(
      `select (public.open_node_gate_as_worker($1, $2, $3, 0)).id as id`,
      [WORKER, deploy.nodeId, priorRunId],
    );
    await closeRunAsPartial(db, priorRunId);
    await asUser(db, ownerId);
    await db.query(`select public.decide_node_gate($1, true, 'deployment route reviewed')`, [gate.rows[0].id]);

    const reclaimed = await claim(db);
    expect(reclaimed, "an approved gate is what makes a halted lifecycle claimable").not.toBeNull();
    expect(reclaimed!.is_lifecycle).toBe(true);
    expect(reclaimed!.iteration).toBe(1);
    expect(reclaimed!.max_iterations).toBe(3);

    const byKey = new Map(reclaimed!.nodes.map((node) => [node.node_key, node]));
    expect(byKey.get("goal")?.lifecycle_stage).toBe("GOAL");
    expect(byKey.get("goal")?.gate_kind).toBeNull();
    expect(byKey.get("architecture")?.gate_kind).toBe("HUMAN");
    expect(byKey.get("test")?.gate_kind).toBe("AUTOMATIC");
    // Never opened yet, which is different from opened-and-undecided.
    expect(byKey.get("architecture")?.gate_state).toBeNull();
    // The node id is what a gate is keyed to; without it the worker cannot
    // open one that outlives this run.
    expect(byKey.get("architecture")?.node_id).toMatch(/^[0-9a-f-]{36}$/);

    // Leave an honestly opened architecture gate for the authorization cases
    // below: exact RUNNING graph, exact VERIFYING node, then parent close.
    const architecture = await prepareGateNode(db, reclaimed!.graph_run_id, "architecture");
    await asWorker(db);
    await db.query(`select public.open_node_gate_as_worker($1, $2, $3, 0)`,
      [WORKER, architecture.nodeId, reclaimed!.graph_run_id]);
    await closeRunAsPartial(db, reclaimed!.graph_run_id);
  });

  it("refuses to open a gate on a node whose plan named none", async () => {
    await db.exec("reset role");
    const ungated = await db.query<{ id: string }>(
      `select id from public.graph_nodes where graph_id = $1 and gate_kind is null limit 1`,
      [graphId],
    );
    const runId = await latestRunId(db, graphId);
    await asWorker(db);
    await expect(
      db.query(`select public.open_node_gate_as_worker($1, $2, $3, 0)`,
        [WORKER, ungated.rows[0].id, runId]),
    ).rejects.toThrow(/node_has_no_gate/);
  });

  it("refuses a human gate to a plain member, and takes it from an owner", async () => {
    await db.exec("reset role");
    const opened = await db.query<{ id: string }>(
      `select gate.id
         from public.graph_gates gate
         join public.graph_nodes node on node.id = gate.node_id
        where node.graph_id = $1 and node.node_key = 'architecture'`,
      [graphId],
    );
    const gateId = opened.rows[0].id;

    await asUser(db, memberId);
    await expect(
      db.query(`select public.decide_node_gate($1, true, null)`, [gateId]),
    ).rejects.toThrow(/owner or admin role is required to decide a gate/);

    await asUser(db, ownerId);
    const decided = await db.query<{ state: string }>(
      `select (public.decide_node_gate($1, true, 'design reviewed')).state::text as state`,
      [gateId],
    );
    expect(decided.rows[0].state).toBe("APPROVED");
  });

  it("carries that approval into the next run, which is the point of keying it to the node", async () => {
    /*
     * The whole justification for keying a gate to the graph node rather than
     * the node run. The worker re-runs a claimed graph from the beginning, so a
     * run-keyed gate would be new and undecided on every claim and the
     * lifecycle could never pass its first human decision. This asserts the
     * approval made against the *previous* run is visible on a *later* one.
     */
    await db.exec("reset role");
    const before = await db.query<{ graph_run_id: string; state: string }>(
      `select id as graph_run_id, state::text as state from public.graph_runs
        where graph_id = $1 order by started_at desc limit 1`,
      [graphId],
    );
    if (before.rows[0].state === "RUNNING") {
      await closeRunAsPartial(db, before.rows[0].graph_run_id);
    }

    const claimed = await claim(db);
    expect(claimed).not.toBeNull();
    expect(claimed!.graph_run_id).not.toBe(before.rows[0].graph_run_id);

    const architecture = claimed!.nodes.find((node) => node.node_key === "architecture");
    expect(architecture?.gate_state).toBe("APPROVED");

    // And a fresh node_run: the approval outlived the run, the run did not.
    expect(architecture?.node_run_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("will not reopen a decided gate on a later claim", async () => {
    const runId = await latestRunId(db, graphId);
    const node = await prepareGateNode(db, runId, "architecture", "COMPLETED");
    await asWorker(db);
    const reopened = await db.query<{ state: string; reason: string | null }>(
      `select (public.open_node_gate_as_worker($1, $2, $3, 0)).state::text as state,
              (public.open_node_gate_as_worker($1, $2, $3, 0)).reason as reason`,
      [WORKER, node.nodeId, runId],
    );
    expect(reopened.rows[0].state).toBe("APPROVED");
    expect(reopened.rows[0].reason).toBe("design reviewed");
  });

  it("reserves automatic approval for the evidence-bound worker, but records an owner rejection", async () => {
    const runId = await latestRunId(db, graphId);
    const node = await prepareGateNode(db, runId, "test", "COMPLETED");
    await asWorker(db);
    const opened = await db.query<{ id: string }>(
      `select (public.open_node_gate_as_worker($1, $2, $3, 0)).id as id`,
      [WORKER, node.nodeId, runId],
    );
    const gateId = opened.rows[0].id;

    await asUser(db, ownerId);
    await expect(
      db.query(`select public.decide_node_gate($1, true, null)`, [gateId]),
    ).rejects.toThrow(/automatic gate approval is worker-only and evidence-bound/);

    // Refusing to approve on no evidence is not refusing to record a decision.
    const rejected = await db.query<{ state: string }>(
      `select (public.decide_node_gate($1, false, 'no evidence')).state::text as state`,
      [gateId],
    );
    expect(rejected.rows[0].state).toBe("REJECTED");

    await expect(
      db.query(`select public.decide_node_gate($1, true, null)`, [gateId]),
    ).rejects.toThrow(/gate_already_decided/);

    await closeRunAsPartial(db, runId);
  });

  it("writes an audit event for every gate decision", async () => {
    await db.exec("reset role");
    const events = await db.query<{ event_type: string }>(
      `select distinct event_type::text as event_type from public.activity_events
        where organization_id = $1 and event_type::text like 'lifecycle.%'`,
      [organizationId],
    );
    const types = events.rows.map((row) => row.event_type);
    expect(types).toContain("lifecycle.graph_created");
    expect(types).toContain("lifecycle.gate_opened");
    expect(types).toContain("lifecycle.gate_approved");
    expect(types).toContain("lifecycle.gate_rejected");
  });

  it("advances the iteration to its cap and then reports that it cannot", async () => {
    await asUser(db, ownerId);
    for (const expected of [2, 3]) {
      const step = await db.query<{ iteration: number; advanced: boolean }>(
        `select iteration, advanced from public.advance_graph_iteration($1)`,
        [graphId],
      );
      expect(step.rows[0]).toMatchObject({ iteration: expected, advanced: true });
    }

    const capped = await db.query<{ iteration: number; advanced: boolean }>(
      `select iteration, advanced from public.advance_graph_iteration($1)`,
      [graphId],
    );
    expect(capped.rows[0]).toMatchObject({ iteration: 3, advanced: false });

    // The record of the exhaustion survives, which an exception would have
    // rolled back along with itself.
    const exhausted = await db.query<{ count: string }>(
      `select count(*)::text as count from public.activity_events
        where organization_id = $1 and event_type::text = 'lifecycle.iteration_exhausted'`,
      [organizationId],
    );
    expect(Number(exhausted.rows[0].count)).toBeGreaterThan(0);
  });

  it("halts the real worker at the first undecided gate", async () => {
    /*
     * The worker itself, not a stand-in for it.
     *
     * Everything above tests the database's rules; this drives
     * `runClaimedGraph` — the deployed code path — through a lifecycle and
     * asserts where it stops. A gated node must record its output, land on
     * VERIFYING rather than COMPLETED, open its gate, and take nothing
     * downstream with it.
     */
    await db.exec("reset role");
    const fresh = await db.query<{ id: string }>(
      `select public.create_graph_from_plan($1, $2, 'halt at the gate', 'SEQUENTIAL'::public.graph_topology,
                '[]'::jsonb, 'green'::public.risk_level, false, $3::jsonb, $4::jsonb, '{}'::jsonb) as id`,
      [
        organizationId, projectId,
        JSON.stringify([
          { node_key: "goal", job: "State it.", executor: "MODEL", capability: "planning",
            lifecycle_stage: "GOAL", input_schema: {}, output_schema: NODE_OUTPUT_SCHEMA },
          { node_key: "prd", job: "Write it.", executor: "MODEL", capability: "planning",
            lifecycle_stage: "PRD", gate_kind: "AUTOMATIC",
            input_schema: inboundNodeSchema("goal"), output_schema: NODE_OUTPUT_SCHEMA },
          { node_key: "architecture", job: "Design it.", executor: "MODEL", capability: "architecture",
            lifecycle_stage: "ARCHITECTURE",
            input_schema: inboundNodeSchema("prd"), output_schema: NODE_OUTPUT_SCHEMA },
        ]),
        JSON.stringify([
          { from_node_key: "goal", to_node_key: "prd", reason: "DATA", detail: "d", is_feedback: false },
          { from_node_key: "prd", to_node_key: "architecture", reason: "DATA", detail: "d", is_feedback: false },
        ]),
      ],
    );
    const freshGraphId = fresh.rows[0].id;

    // Claim it: the SDLC graph above is exhausted, so this is the one on offer.
    let claimed = await claim(db);
    while (claimed !== null && !claimed.nodes.some((n) => n.node_key === "architecture")) {
      await closeRunAsPartial(db, claimed.graph_run_id);
      claimed = await claim(db);
    }
    expect(claimed, "the new lifecycle graph was never offered").not.toBeNull();

    const parsed = parseClaimedGraph(claimed);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const compiled = compileClaimedGraph(parsed.graph);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const executed: string[] = [];
    const summary = await runClaimedGraph(
      parsed.graph, compiled.graph, workerStore(db),
      async (node): Promise<NodeExecutionResult> => {
        executed.push(node.nodeKey);
        return { status: "SUCCEEDED", output: { node: node.nodeKey }, provider: "anthropic", model: "m" };
      },
    );

    // goal ran, prd ran and then held. architecture never started, because its
    // dependency did not complete.
    expect(executed).toEqual(["goal", "prd"]);
    expect(summary.awaitingGate).toEqual(["prd"]);
    expect(summary.finalState).toBe("PARTIAL");
    // Held, not failed: a lifecycle waiting on a decision must not spend the
    // graph's three chances.
    expect(summary.nodesFailed).toBe(0);

    await db.exec("reset role");
    const states = await db.query<{ node_key: string; state: string }>(
      `select n.node_key, r.state::text as state
         from public.node_runs r join public.graph_nodes n on n.id = r.node_id
        where r.graph_run_id = $1 order by n.node_key`,
      [claimed!.graph_run_id],
    );
    expect(states.rows).toEqual([
      { node_key: "architecture", state: "SKIPPED" },
      { node_key: "goal", state: "COMPLETED" },
      { node_key: "prd", state: "VERIFYING" },
    ]);

    // Its output survived the halt: the work was real even though the stage is
    // not finished.
    const artifacts = await db.query<{ count: string }>(
      `select count(*)::text as count from public.graph_artifacts where graph_run_id = $1`,
      [claimed!.graph_run_id],
    );
    expect(Number(artifacts.rows[0].count)).toBe(2);

    const gate = await db.query<{ state: string; stage: string }>(
      `select g.state::text as state, g.stage::text as stage
         from public.graph_gates g join public.graph_nodes n on n.id = g.node_id
        where n.graph_id = $1`,
      [freshGraphId],
    );
    expect(gate.rows).toEqual([{ state: "OPEN", stage: "PRD" }]);
  });

  it("refuses to store a node output carrying something secret-shaped", async () => {
    await asUser(db, ownerId);
    await db.query(
      `select public.create_graph_from_plan(
        $1, $2, 'artifact boundary fixture', 'SEQUENTIAL'::public.graph_topology,
        '[]'::jsonb, 'green'::public.risk_level, false,
        $3::jsonb, '[]'::jsonb, '{}'::jsonb
      )`,
      [
        organizationId,
        projectId,
        JSON.stringify([{
          node_key: "artifact",
          job: "Record one artifact.",
          executor: "MODEL",
          capability: "analysis",
          input_schema: {},
          output_schema: {},
        }]),
      ],
    );
    const artifactRun = await claim(db);
    expect(artifactRun, "the artifact fixture must have a live parent run").not.toBeNull();
    const runId = artifactRun!.graph_run_id;
    await asWorker(db);

    await expect(
      db.query(`select public.record_graph_artifact_as_worker($1, $2, 'RAW', $3::jsonb)`,
        [WORKER, runId, JSON.stringify({ finding: "ok", api_key: "abc" })]),
    ).rejects.toThrow(/graph artifact payload is sensitive or oversized/);

    // A secret-shaped value under an innocent key is caught too, which a
    // blocklist of key names alone would wave through.
    await expect(
      db.query(`select public.record_graph_artifact_as_worker($1, $2, 'RAW', $3::jsonb)`,
        [WORKER, runId,
         JSON.stringify({ note: "found sk-abcdefghijklmnopqrstuvwxyz012345 in the config" })]),
    ).rejects.toThrow(/graph artifact payload is sensitive or oversized/);

    const ordinary = await db.query<{ id: string }>(
      `select public.record_graph_artifact_as_worker($1, $2, 'RAW', $3::jsonb) as id`,
      [WORKER, runId, JSON.stringify({ criteria: ["the screen saves"] })],
    );
    expect(ordinary.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    await closeRunAsPartial(db, runId);
  });
});
