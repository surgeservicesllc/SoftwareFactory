// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");

const ownerOneId = "00000000-0000-4000-8000-000000000101";
const ownerTwoId = "00000000-0000-4000-8000-000000000201";
const organizationOneId = "10000000-0000-4000-8000-000000000001";
const organizationTwoId = "10000000-0000-4000-8000-000000000002";
const projectOneId = "40000000-0000-4000-8000-000000000001";

type ApplicationRole = "anon" | "authenticated" | "service_role";

async function assumeRole(db: PGlite, role: ApplicationRole, userId: string | null = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

const planNodes = [
  {
    node_key: "plan",
    job: "Produce the audit plan",
    executor: "MODEL",
    capability: "planning",
    model_tier: "STRONG",
    input_schema: {},
    output_schema: { type: "array" },
    reads: [],
    writes: [],
  },
  {
    node_key: "worker",
    job: "Audit one route",
    executor: "MODEL",
    capability: "extraction",
    model_tier: "ECONOMY",
    input_schema: {},
    output_schema: { type: "array" },
    reads: [{ kind: "file", id: "app/api/health/route.ts" }],
    writes: [],
  },
  {
    node_key: "reduce",
    job: "Dedupe and rank the findings",
    executor: "DETERMINISTIC",
    capability: "synthesis",
    model_tier: "NONE",
    input_schema: {},
    output_schema: { type: "array" },
    reads: [],
    writes: [],
  },
];

const planEdges = [
  { from_node_key: "plan", to_node_key: "worker", reason: "DATA", detail: "worker consumes the plan" },
  { from_node_key: "worker", to_node_key: "reduce", reason: "DATA", detail: "reduce consumes findings" },
];

async function createGraph(db: PGlite, organizationId = organizationOneId) {
  const result = await db.query<{ create_graph_from_plan: string }>(
    `select public.create_graph_from_plan(
       $1::uuid, $2::uuid, $3::text, $4::public.graph_topology, $5::jsonb,
       $6::public.risk_level, $7::boolean, $8::jsonb, $9::jsonb, $10::jsonb)`,
    [
      organizationId,
      projectOneId,
      "Audit every route for missing authentication",
      "DIAMOND",
      JSON.stringify([{ code: "FAN_OUT_WITH_REDUCE", detail: "3 independent nodes converge" }]),
      "green",
      false,
      JSON.stringify(planNodes),
      JSON.stringify(planEdges),
      JSON.stringify({ max_nodes: 20, max_concurrent_nodes: 4 }),
    ],
  );
  return result.rows[0].create_graph_from_plan;
}

describe("Phase 2B graph write boundary", () => {
  let db: PGlite;

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

    const migrationFiles = (await readdir(migrationsRoot))
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();
    for (const migrationFile of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsRoot, migrationFile), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerOneId}'), ('${ownerTwoId}');

      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationOneId}', 'Graph One', 'graph-one', '${ownerOneId}'),
        ('${organizationTwoId}', 'Graph Two', 'graph-two', '${ownerTwoId}');

      insert into public.projects (id, organization_id, name, status, created_by) values
        ('${projectOneId}', '${organizationOneId}', 'Project One', 'active', '${ownerOneId}');
    `);
  }, 180_000);

  afterAll(async () => {
    await db?.close();
  });

  it("writes a whole graph in one call", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    const graphId = await createGraph(db);

    await resetRole(db);
    const nodes = await db.query("select id from public.graph_nodes where graph_id = $1", [graphId]);
    const edges = await db.query("select id from public.graph_edges where graph_id = $1", [graphId]);
    const contracts = await db.query(
      `select c.id from public.node_contracts c
         join public.graph_nodes n on n.id = c.node_id
        where n.graph_id = $1`,
      [graphId],
    );

    expect(nodes.rows).toHaveLength(3);
    expect(edges.rows).toHaveLength(2);
    // Every node gets a contract, or the scheduler has a node it cannot validate.
    expect(contracts.rows).toHaveLength(3);
  });

  it("refuses a plan whose edge names a node that is not in it", async () => {
    await assumeRole(db, "authenticated", ownerOneId);

    await expect(
      db.query(
        `select public.create_graph_from_plan(
           $1::uuid, $2::uuid, $3::text, $4::public.graph_topology, $5::jsonb,
           $6::public.risk_level, $7::boolean, $8::jsonb, $9::jsonb, $10::jsonb)`,
        [
          organizationOneId,
          projectOneId,
          "broken",
          "DAG",
          "[]",
          "green",
          false,
          JSON.stringify([planNodes[0]]),
          JSON.stringify([
            { from_node_key: "plan", to_node_key: "ghost", reason: "DATA", detail: "nope" },
          ]),
          "{}",
        ],
      ),
    ).rejects.toThrow(/unknown_edge_node/);
  });

  it("leaves nothing behind when a plan is rejected", async () => {
    await resetRole(db);
    const graphs = await db.query<{ count: string }>(
      "select count(*)::text as count from public.graphs where goal = 'broken'",
    );
    // The failed insert above must not have left a half-written graph.
    expect(graphs.rows[0].count).toBe("0");
  });

  it("refuses to write into an organization the caller does not belong to", async () => {
    await assumeRole(db, "authenticated", ownerTwoId);
    await expect(createGraph(db, organizationOneId)).rejects.toThrow(/not_a_member/);
  });

  it("queues every node PENDING when a run starts", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    const graphId = await createGraph(db);
    const run = await db.query<{ start_graph_run: string }>(
      "select public.start_graph_run($1::uuid)",
      [graphId],
    );

    await resetRole(db);
    const nodeRuns = await db.query<{ state: string }>(
      "select state from public.node_runs where graph_run_id = $1",
      [run.rows[0].start_graph_run],
    );

    // A node absent from the state map is indistinguishable from one that never
    // reported, which is exactly the confusion the fan-in guard exists to stop.
    expect(nodeRuns.rows).toHaveLength(3);
    expect(nodeRuns.rows.every((row) => row.state === "PENDING")).toBe(true);
  });

  it("records a node transition and an event for it", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    const graphId = await createGraph(db);
    const run = await db.query<{ start_graph_run: string }>(
      "select public.start_graph_run($1::uuid)",
      [graphId],
    );
    const runId = run.rows[0].start_graph_run;

    await resetRole(db);
    const first = await db.query<{ id: string }>(
      "select id from public.node_runs where graph_run_id = $1 limit 1",
      [runId],
    );

    await assumeRole(db, "authenticated", ownerOneId);
    await db.query(
      `select id from public.record_node_state(
         $1::uuid, $2::public.graph_node_state, $3::text, $4::text, $5::text, $6::integer)`,
      [first.rows[0].id, "RUNNING", null, "anthropic", "claude-opus-5", null],
    );

    await resetRole(db);
    const updated = await db.query<{ state: string; provider: string; started_at: string }>(
      "select state, provider, started_at from public.node_runs where id = $1",
      [first.rows[0].id],
    );
    expect(updated.rows[0].state).toBe("RUNNING");
    expect(updated.rows[0].provider).toBe("anthropic");
    expect(updated.rows[0].started_at).not.toBeNull();

    const events = await db.query(
      "select id from public.graph_events where node_run_id = $1 and event_type = 'node_running'",
      [first.rows[0].id],
    );
    expect(events.rows).toHaveLength(1);
  });

  it("refuses to reopen a node that already reached a terminal state", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    const graphId = await createGraph(db);
    const run = await db.query<{ start_graph_run: string }>(
      "select public.start_graph_run($1::uuid)",
      [graphId],
    );

    await resetRole(db);
    const node = await db.query<{ id: string }>(
      "select id from public.node_runs where graph_run_id = $1 limit 1",
      [run.rows[0].start_graph_run],
    );

    await assumeRole(db, "authenticated", ownerOneId);
    await db.query(
      `select id from public.record_node_state($1::uuid, $2::public.graph_node_state)`,
      [node.rows[0].id, "FAILED"],
    );

    // A failed node cannot be quietly relabelled as fine.
    await expect(
      db.query(`select id from public.record_node_state($1::uuid, $2::public.graph_node_state)`, [
        node.rows[0].id,
        "COMPLETED",
      ]),
    ).rejects.toThrow(/node_already_terminal/);
  });

  it("refuses to mark a run COMPLETED when its input was incomplete", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    const graphId = await createGraph(db);
    const run = await db.query<{ start_graph_run: string }>(
      "select public.start_graph_run($1::uuid)",
      [graphId],
    );
    const runId = run.rows[0].start_graph_run;

    // Twenty dispatched and nineteen returned is a PARTIAL run, not a finished
    // one. The boundary enforces that so no caller can forget.
    await expect(
      db.query(
        `select id from public.complete_graph_run(
           $1::uuid, $2::public.graph_run_state, $3::boolean)`,
        [runId, "COMPLETED", true],
      ),
    ).rejects.toThrow(/partial_input_cannot_complete/);

    const partial = await db.query<{ state: string; had_partial_input: boolean }>(
      `select state, had_partial_input from public.complete_graph_run(
         $1::uuid, $2::public.graph_run_state, $3::boolean)`,
      [runId, "PARTIAL", true],
    );
    expect(partial.rows[0].state).toBe("PARTIAL");
    expect(partial.rows[0].had_partial_input).toBe(true);
  });

  it("stores an invalid handoff rather than rejecting it", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    const graphId = await createGraph(db);
    const run = await db.query<{ start_graph_run: string }>(
      "select public.start_graph_run($1::uuid)",
      [graphId],
    );

    await resetRole(db);
    const target = await db.query<{ id: string }>(
      "select id from public.graph_nodes where graph_id = $1 and node_key = 'reduce'",
      [graphId],
    );

    await assumeRole(db, "authenticated", ownerOneId);
    await db.query(
      `select public.record_handoff(
         $1::uuid, $2::uuid, $3::jsonb, $4::boolean, $5::jsonb)`,
      [
        run.rows[0].start_graph_run,
        target.rows[0].id,
        JSON.stringify({ wrong: true }),
        false,
        JSON.stringify(["findings: expected array"]),
      ],
    );

    await resetRole(db);
    const stored = await db.query<{ contract_valid: boolean; validation_issues: unknown }>(
      "select contract_valid, validation_issues from public.graph_handoffs where graph_run_id = $1",
      [run.rows[0].start_graph_run],
    );
    // Evidence for why a node is blocked has to survive.
    expect(stored.rows[0].contract_valid).toBe(false);
    expect(stored.rows[0].validation_issues).toEqual(["findings: expected array"]);
  });

  it("refuses a verification whose verifier is the agent that did the work", async () => {
    await resetRole(db);
    const agent = await db.query<{ id: string }>(
      `insert into public.agents (organization_id, name, role, created_by)
       values ($1, 'Implementer', 'backend', $2) returning id`,
      [organizationOneId, ownerOneId],
    );

    await assumeRole(db, "authenticated", ownerOneId);
    const graphId = await createGraph(db);

    await resetRole(db);
    await db.query("update public.graph_nodes set agent_id = $1 where graph_id = $2", [
      agent.rows[0].id,
      graphId,
    ]);

    await assumeRole(db, "authenticated", ownerOneId);
    const run = await db.query<{ start_graph_run: string }>(
      "select public.start_graph_run($1::uuid)",
      [graphId],
    );

    await resetRole(db);
    const nodeRun = await db.query<{ id: string }>(
      "select id from public.node_runs where graph_run_id = $1 limit 1",
      [run.rows[0].start_graph_run],
    );

    await assumeRole(db, "authenticated", ownerOneId);
    // No-self-approval enforced at the boundary, so no code path can record a
    // self-review even by mistake.
    await expect(
      db.query(
        `select public.record_verification(
           $1::uuid, $2::public.verification_lens, $3::public.verification_verdict,
           $4::jsonb, $5::uuid)`,
        [nodeRun.rows[0].id, "correctness", "PASS", "[]", agent.rows[0].id],
      ),
    ).rejects.toThrow(/self_verification_forbidden/);
  });

  it("accepts a verification from a different agent", async () => {
    await resetRole(db);
    const reviewer = await db.query<{ id: string }>(
      `insert into public.agents (organization_id, name, role, created_by)
       values ($1, 'Reviewer', 'security', $2) returning id`,
      [organizationOneId, ownerOneId],
    );

    await assumeRole(db, "authenticated", ownerOneId);
    const graphId = await createGraph(db);
    const run = await db.query<{ start_graph_run: string }>(
      "select public.start_graph_run($1::uuid)",
      [graphId],
    );

    await resetRole(db);
    const nodeRun = await db.query<{ id: string }>(
      "select id from public.node_runs where graph_run_id = $1 limit 1",
      [run.rows[0].start_graph_run],
    );

    await assumeRole(db, "authenticated", ownerOneId);
    const verification = await db.query<{ record_verification: string }>(
      `select public.record_verification(
         $1::uuid, $2::public.verification_lens, $3::public.verification_verdict,
         $4::jsonb, $5::uuid, $6::text, $7::boolean)`,
      [
        nodeRun.rows[0].id,
        "security",
        "BLOCK",
        JSON.stringify(["credential in diff"]),
        reviewer.rows[0].id,
        "openai",
        false,
      ],
    );

    expect(verification.rows[0].record_verification).toBeTruthy();
  });

  it("grants no execute on the write functions to anon", async () => {
    await resetRole(db);
    const result = await db.query<{ routine_name: string }>(
      `select routine_name
         from information_schema.role_routine_grants
        where routine_schema = 'public'
          and grantee = 'anon'
          and routine_name in (
            'create_graph_from_plan', 'start_graph_run', 'record_node_state',
            'complete_graph_run', 'record_handoff', 'record_graph_artifact',
            'record_verification'
          )`,
    );
    expect(result.rows).toEqual([]);
  });
});
