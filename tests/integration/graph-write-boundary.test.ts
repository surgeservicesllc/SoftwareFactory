// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";


const ownerOneId = "00000000-0000-4000-8000-000000000101";
const ownerTwoId = "00000000-0000-4000-8000-000000000201";
const organizationOneId = "10000000-0000-4000-8000-000000000001";
const organizationTwoId = "10000000-0000-4000-8000-000000000002";
const projectOneId = "40000000-0000-4000-8000-000000000001";
const workerId = "graph-worker-write-boundary";
const supportedExecutors = ["MODEL", "DETERMINISTIC", "ANCHOR"];
const claimRepository = "factory/graph-write-boundary";
const claimRequiredChecks = ["CI"];

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

type WorkerClaim = {
  graph_id: string;
  graph_run_id: string;
  nodes: Array<{ node_key: string; node_run_id: string }>;
};

async function completeAsWorker(
  db: PGlite,
  graphRunId: string,
  state: "COMPLETED" | "PARTIAL" | "FAILED",
  hadPartialInput: boolean,
) {
  await assumeRole(db, "service_role");
  await db.query(
    `select public.complete_graph_run_with_phase1c_bridge_as_worker(
      $1, $2::uuid, $3::public.graph_run_state, $4
    )`,
    [workerId, graphRunId, state, hadPartialInput],
  );
  await resetRole(db);
}

async function claimGraph(db: PGlite, graphId: string): Promise<WorkerClaim> {
  // Earlier structure-only cases deliberately leave their graphs unclaimed.
  // Drain those as honest PARTIAL worker runs until the exact fixture graph is
  // offered; claim_planned_graph intentionally has no caller-selected target.
  for (let attempts = 0; attempts < 20; attempts += 1) {
    await assumeRole(db, "service_role");
    const result = await db.query<{ claim: WorkerClaim | null }>(
      `select public.claim_planned_graph_v3($1, $2::text[], $3, $4::jsonb, 3) as claim`,
      [workerId, supportedExecutors, claimRepository, JSON.stringify(claimRequiredChecks)],
    );
    await resetRole(db);
    const claim = result.rows[0].claim;
    expect(claim, `worker queue did not offer graph ${graphId}`).not.toBeNull();
    if (claim!.graph_id === graphId) return claim!;
    for (const node of claim!.nodes) {
      await recordNodeAsWorker(
        db,
        node.node_run_id,
        "SKIPPED",
        "queue-drain fixture did not execute this node",
      );
    }
    await completeAsWorker(db, claim!.graph_run_id, "PARTIAL", true);
  }
  throw new Error(`worker queue never reached graph ${graphId}`);
}

async function recordNodeAsWorker(
  db: PGlite,
  nodeRunId: string,
  state: "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED",
  detail: string | null = null,
  provider: string | null = null,
  model: string | null = null,
) {
  await assumeRole(db, "service_role");
  await db.query(
    `select public.record_node_state_as_worker(
      $1, $2::uuid, $3::public.graph_node_state, $4, $5, $6, null
    )`,
    [workerId, nodeRunId, state, detail, provider, model],
  );
  await resetRole(db);
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

const verificationPlanNodes = [
  {
    ...planNodes[1],
    node_key: "subject",
    job: "Produce the implementation evidence",
  },
  {
    ...planNodes[0],
    node_key: "security-review",
    job: "Review the implementation evidence",
    capability: "security_review",
  },
];

const verificationPlanEdges = [
  {
    from_node_key: "subject",
    to_node_key: "security-review",
    reason: "DATA",
    detail: "reviewer consumes the implementation evidence",
  },
];

async function createGraph(
  db: PGlite,
  organizationId = organizationOneId,
  nodes = planNodes,
  edges = planEdges,
) {
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
      JSON.stringify(nodes),
      JSON.stringify(edges),
      JSON.stringify({ max_nodes: 20, max_concurrent_nodes: 4 }),
    ],
  );
  return result.rows[0].create_graph_from_plan;
}

describe("Phase 2B graph write boundary", () => {
  let db: PGlite;

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();

    await db.exec(`
      insert into auth.users (id) values ('${ownerOneId}'), ('${ownerTwoId}');

      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationOneId}', 'Graph One', 'graph-one', '${ownerOneId}'),
        ('${organizationTwoId}', 'Graph Two', 'graph-two', '${ownerTwoId}');

      insert into public.projects (
        id, organization_id, name, status, github_repository, created_by
      ) values (
        '${projectOneId}', '${organizationOneId}', 'Project One', 'active',
        '${claimRepository}', '${ownerOneId}'
      );
      insert into public.connections (
        id, organization_id, name, provider, status, secret_reference, created_by
      ) values (
        '30000000-0000-4000-8000-000000000001', '${organizationOneId}',
        'GitHub', 'github', 'connected', 'env://GITHUB_APP', '${ownerOneId}'
      );
      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id,
        app_slug, account_id, account_login, account_type, target_type,
        repository_selection, status, installed_at, created_by
      ) values (
        '50000000-0000-4000-8000-000000000001', '${organizationOneId}',
        '30000000-0000-4000-8000-000000000001', 960001, 960002,
        'write-boundary-app', 960003, 'factory', 'Organization', 'Organization',
        'selected', 'active', now(), '${ownerOneId}'
      );
      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id,
        owner_login, name, full_name, default_branch, html_url, private,
        visibility, selected, github_updated_at
      ) values (
        '60000000-0000-4000-8000-000000000001', '${organizationOneId}',
        '50000000-0000-4000-8000-000000000001', 960004,
        'factory', 'graph-write-boundary', '${claimRepository}', 'main',
        'https://github.com/${claimRepository}', true, 'private', true, now()
      );
      insert into public.project_connections (
        organization_id, project_id, connection_id, github_repository_id,
        is_primary, created_by
      ) values (
        '${organizationOneId}', '${projectOneId}',
        '30000000-0000-4000-8000-000000000001',
        '60000000-0000-4000-8000-000000000001', true, '${ownerOneId}'
      );
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

  it("queues every node PENDING when the worker claims a graph", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    const graphId = await createGraph(db);
    const run = await claimGraph(db, graphId);

    await resetRole(db);
    const nodeRuns = await db.query<{ state: string }>(
      "select state from public.node_runs where graph_run_id = $1",
      [run.graph_run_id],
    );

    // A node absent from the state map is indistinguishable from one that never
    // reported, which is exactly the confusion the fan-in guard exists to stop.
    expect(nodeRuns.rows).toHaveLength(3);
    expect(nodeRuns.rows.every((row) => row.state === "PENDING")).toBe(true);
  });

  it("records a node transition and an event for it", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    const graphId = await createGraph(db);
    const run = await claimGraph(db, graphId);
    const runId = run.graph_run_id;

    await resetRole(db);
    const first = await db.query<{ id: string }>(
      "select id from public.node_runs where graph_run_id = $1 limit 1",
      [runId],
    );

    await recordNodeAsWorker(db, first.rows[0].id, "RUNNING", null, "anthropic", "claude-opus-5");

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
    const run = await claimGraph(db, graphId);

    await resetRole(db);
    const node = await db.query<{ id: string }>(
      "select id from public.node_runs where graph_run_id = $1 limit 1",
      [run.graph_run_id],
    );

    await recordNodeAsWorker(db, node.rows[0].id, "RUNNING");
    await recordNodeAsWorker(db, node.rows[0].id, "FAILED");

    // A failed node cannot be quietly relabelled as fine.
    await assumeRole(db, "service_role");
    await expect(
      db.query(
        `select public.record_node_state_as_worker(
          $1, $2::uuid, 'COMPLETED'::public.graph_node_state
        )`,
        [workerId, node.rows[0].id],
      ),
    ).rejects.toThrow(/invalid_worker_node_state_transition/);
    await resetRole(db);
  });

  it("refuses to mark a run COMPLETED when its input was incomplete", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    const graphId = await createGraph(db);
    const run = await claimGraph(db, graphId);
    const runId = run.graph_run_id;

    // Twenty dispatched and nineteen returned is a PARTIAL run, not a finished
    // one. The boundary enforces that so no caller can forget.
    for (const node of run.nodes.slice(0, -1)) {
      await recordNodeAsWorker(db, node.node_run_id, "RUNNING", "fixture executing");
      await recordNodeAsWorker(db, node.node_run_id, "COMPLETED", "fixture completed");
    }
    await recordNodeAsWorker(
      db,
      run.nodes.at(-1)!.node_run_id,
      "SKIPPED",
      "one dispatched input never returned",
    );
    await assumeRole(db, "service_role");
    await expect(
      db.query(
        `select public.complete_graph_run_with_phase1c_bridge_as_worker(
          $1, $2::uuid, 'COMPLETED'::public.graph_run_state, true
        )`,
        [workerId, runId],
      ),
    ).rejects.toThrow(/requires every child to be terminal and successful/);

    const partial = await db.query<{ state: string; had_partial_input: boolean }>(
      `select (closed).state::text as state, (closed).had_partial_input
         from (select public.complete_graph_run_with_phase1c_bridge_as_worker(
           $1, $2::uuid, 'PARTIAL'::public.graph_run_state, true
         ) as closed) result`,
      [workerId, runId],
    );
    expect(partial.rows[0].state).toBe("PARTIAL");
    expect(partial.rows[0].had_partial_input).toBe(true);
    await resetRole(db);
  });

  it("stores an invalid handoff rather than rejecting it", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    const graphId = await createGraph(db);
    const run = await claimGraph(db, graphId);

    await resetRole(db);
    const target = await db.query<{ id: string }>(
      "select id from public.graph_nodes where graph_id = $1 and node_key = 'reduce'",
      [graphId],
    );

    // No worker consumes the legacy generic handoff writer. Seed the durable
    // invalid-contract evidence as the schema owner and keep this test focused
    // on the persistence behavior the handoff table still promises.
    await resetRole(db);
    await db.query(
      `insert into public.graph_handoffs (
         organization_id, graph_run_id, to_node_id, payload,
         contract_valid, validation_issues
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, false, $5::jsonb)`,
      [
        organizationOneId,
        run.graph_run_id,
        target.rows[0].id,
        JSON.stringify({ wrong: true }),
        JSON.stringify(["findings: expected array"]),
      ],
    );

    await resetRole(db);
    const stored = await db.query<{ contract_valid: boolean; validation_issues: unknown }>(
      "select contract_valid, validation_issues from public.graph_handoffs where graph_run_id = $1",
      [run.graph_run_id],
    );
    // Evidence for why a node is blocked has to survive.
    expect(stored.rows[0].contract_valid).toBe(false);
    expect(stored.rows[0].validation_issues).toEqual(["findings: expected array"]);
  });

  it("refuses self-verification by an exact node-run identity", async () => {
    await assumeRole(db, "authenticated", ownerOneId);
    const graphId = await createGraph(
      db,
      organizationOneId,
      verificationPlanNodes,
      verificationPlanEdges,
    );
    const run = await claimGraph(db, graphId);

    await resetRole(db);
    const nodeRun = await db.query<{ id: string }>(
      `select node_run.id
         from public.node_runs node_run
         join public.graph_nodes node on node.id = node_run.node_id
        where node_run.graph_run_id = $1 and node.node_key = 'security-review'`,
      [run.graph_run_id],
    );

    await recordNodeAsWorker(db, nodeRun.rows[0].id, "RUNNING", null, "openai", "gpt-5");
    await assumeRole(db, "service_role");
    await expect(
      db.query(
        `select public.complete_reviewer_with_verifications_as_worker(
          $1, $2::uuid, '[]'::jsonb, 'openai', 'gpt-5', 7,
          pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'subjectNodeRunId', $2::text,
            'verdict', 'PASS',
            'evidence', pg_catalog.jsonb_build_array('self')
          ))
        )`,
        [workerId, nodeRun.rows[0].id],
      ),
    ).rejects.toThrow(/unsafe or self-referential/);
    await resetRole(db);
  });

  it("accepts a verification from a different agent", async () => {
    await resetRole(db);
    const reviewer = await db.query<{ id: string }>(
      `insert into public.agents (organization_id, name, role, created_by)
       values ($1, 'Reviewer', 'security', $2) returning id`,
      [organizationOneId, ownerOneId],
    );

    await assumeRole(db, "authenticated", ownerOneId);
    const graphId = await createGraph(
      db,
      organizationOneId,
      verificationPlanNodes,
      verificationPlanEdges,
    );

    await resetRole(db);
    await db.query(
      `update public.graph_nodes
       set agent_id = $1
       where graph_id = $2 and node_key = 'security-review'`,
      [reviewer.rows[0].id, graphId],
    );

    await assumeRole(db, "authenticated", ownerOneId);
    const run = await claimGraph(db, graphId);

    await resetRole(db);
    const nodeRuns = await db.query<{ id: string; node_key: string }>(
      `select node_run.id, node.node_key
         from public.node_runs node_run
         join public.graph_nodes node on node.id = node_run.node_id
        where node_run.graph_run_id = $1`,
      [run.graph_run_id],
    );
    const subject = nodeRuns.rows.find((node) => node.node_key === "subject")!;
    const verifier = nodeRuns.rows.find((node) => node.node_key === "security-review")!;

    await recordNodeAsWorker(db, subject.id, "RUNNING", null, "anthropic", "claude-sonnet");
    await recordNodeAsWorker(db, subject.id, "COMPLETED");
    await recordNodeAsWorker(db, verifier.id, "RUNNING", null, "openai", "gpt-5");
    await assumeRole(db, "service_role");
    await db.query(
      `select public.complete_reviewer_with_verifications_as_worker(
         $1, $2::uuid, $3::jsonb, 'openai', 'gpt-5', 8, $4::jsonb)`,
      [
        workerId,
        verifier.id,
        JSON.stringify([]),
        JSON.stringify([{
          subjectNodeRunId: subject.id,
          verdict: "BLOCK",
          evidence: ["credential finding in diff"],
        }]),
      ],
    );

    await resetRole(db);
    const persisted = await db.query<{
      subject_node_run_id: string;
      verifier_agent_id: string;
      verifier_node_run_id: string;
      verifier_provider: string;
    }>(
      `select subject_node_run_id, verifier_agent_id, verifier_node_run_id, verifier_provider
         from public.graph_verifications
        where verifier_node_run_id = $1`,
      [verifier.id],
    );
    expect(persisted.rows[0]).toEqual({
      subject_node_run_id: subject.id,
      verifier_agent_id: reviewer.rows[0].id,
      verifier_node_run_id: verifier.id,
      verifier_provider: "openai",
    });
  });

  it("retires every legacy mutation RPC from browser and service roles", async () => {
    await resetRole(db);
    const result = await db.query<{
      signature: string;
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(
      `with routines(signature) as (values
         ('start_graph_run(uuid)'),
         ('record_node_state(uuid,public.graph_node_state,text,text,text,integer)'),
         ('complete_graph_run(uuid,public.graph_run_state,boolean,bigint,bigint,text)'),
         ('record_handoff(uuid,uuid,jsonb,boolean,jsonb,uuid,jsonb,jsonb,jsonb,text)'),
         ('record_graph_artifact(uuid,public.graph_artifact_kind,jsonb,uuid,integer,integer)'),
         ('record_verification(uuid,public.verification_lens,public.verification_verdict,jsonb,uuid,text,boolean)')
       )
       select signature,
              pg_catalog.has_function_privilege(
                'anon', pg_catalog.to_regprocedure('public.' || signature), 'EXECUTE'
              ) as anon,
              pg_catalog.has_function_privilege(
                'authenticated', pg_catalog.to_regprocedure('public.' || signature), 'EXECUTE'
              ) as authenticated,
              pg_catalog.has_function_privilege(
                'service_role', pg_catalog.to_regprocedure('public.' || signature), 'EXECUTE'
              ) as service_role
         from routines order by signature`,
    );
    expect(result.rows).toHaveLength(6);
    expect(result.rows.every((row) =>
      !row.anon && !row.authenticated && !row.service_role,
    )).toBe(true);

    // Planning remains a member action, but never an anonymous one.
    expect(
      await db.query<{ allowed: boolean }>(
        `select pg_catalog.has_function_privilege(
          'anon',
          'public.create_graph_from_plan(uuid,uuid,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb)',
          'EXECUTE'
        ) as allowed`,
      ),
    ).toMatchObject({ rows: [{ allowed: false }] });
  });
});
