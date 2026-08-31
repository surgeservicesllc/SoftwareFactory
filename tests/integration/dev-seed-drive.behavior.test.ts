// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { budgetForTemplate, findTemplate } from "@/lib/graph/templates";
import { SDLC_STAGES } from "@/lib/sdlc/lifecycle";
import { WORKER_SUPPORTED_EXECUTORS } from "@/lib/worker/executor-support";
import type { GraphRunStore } from "@/lib/worker/graph-run";
import { driveSeedLifecycle, type SeedGate } from "@/scripts/seed-drive.mjs";

/**
 * The seeded ten-step flow, walked end to end by the seed's own loop.
 *
 * The sibling suite pins the seed's setup; this pins its walk — and pins it
 * by calling `driveSeedLifecycle`, the exact function `npm run seed:dev`
 * runs, rather than a parallel reimplementation that could agree with itself
 * while the script was wrong. Only the outside is substituted: PGlite for
 * supabase-js, over the real migrated schema and the same `*_as_worker`
 * boundary the production drain uses.
 *
 * The claim it exists to support is the one that must not be taken on trust:
 * the seeded flow completes all ten steps. Which means, concretely — the run
 * closes COMPLETED, every one of the eleven stages holds a COMPLETED node
 * with an artifact recorded, all three human authority gates were approved by
 * a person, and the lineage from the request to the monitoring probe is
 * unbroken.
 */


const WORKER = "dev-seed-lifecycle";
const CLAIM_REPOSITORY = "factory/dev-seed";
const CLAIM_REQUIRED_CHECKS = ["CI"];
const ownerId = "00000000-0000-4000-8000-00000000d21e";
const organizationId = "10000000-0000-4000-8000-00000000d21e";
const projectId = "20000000-0000-4000-8000-00000000d21e";

let db: PGlite;
let graphId: string;

async function asOwner() {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  await db.exec("set role authenticated");
}

async function asServiceRole() {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec("set role service_role");
}

async function reset() {
  await db.exec("reset role");
}

/** The production store's shape, over PGlite instead of supabase-js. */
function pgliteStore(): GraphRunStore & { claimPlannedGraph: () => Promise<unknown | null> } {
  return {
    async claimPlannedGraph() {
      await asServiceRole();
      const claimed = await db.query<{ claim: unknown }>(
        "select public.claim_planned_graph_v3($1, $2::text[], $3, $4::jsonb, 3) as claim",
        [WORKER, WORKER_SUPPORTED_EXECUTORS, CLAIM_REPOSITORY,
          JSON.stringify(CLAIM_REQUIRED_CHECKS)],
      );
      await reset();
      return claimed.rows[0].claim ?? null;
    },
    async recordNodeState(nodeRunId, state, detail, execution) {
      await asServiceRole();
      await db.query(
        "select public.record_node_state_as_worker($1, $2::uuid, $3::public.graph_node_state, $4, $5, $6, $7)",
        [WORKER, nodeRunId, state, detail ?? null, execution?.provider ?? null, execution?.model ?? null, execution?.latencyMs ?? null],
      );
      await reset();
    },
    async recordArtifact(graphRunId, kind, payload, nodeRunId) {
      await asServiceRole();
      await db.query(
        "select public.record_graph_artifact_as_worker($1, $2::uuid, $3::public.graph_artifact_kind, $4::jsonb, $5::uuid)",
        [WORKER, graphRunId, kind, JSON.stringify(payload ?? {}), nodeRunId ?? null],
      );
      await reset();
    },
    async readPriorNodeResults(priorGraphId) {
      await asServiceRole();
      const result = await db.query<{
        model: string | null;
        node_key: string;
        payload: unknown;
        provider: string | null;
      }>(
        `select node_key, payload, provider, model
           from public.read_prior_node_results_as_worker_v2($1, $2::uuid, 2)`,
        [WORKER, priorGraphId],
      );
      await reset();
      return new Map(result.rows.map((row) => [row.node_key, {
        output: row.payload,
        provider: row.provider ?? undefined,
        model: row.model ?? undefined,
      }]));
    },
    async openGate(nodeId, graphRunId, anchorCount) {
      await asServiceRole();
      await db.query(
        "select public.open_node_gate_as_worker($1, $2::uuid, $3::uuid, $4)",
        [WORKER, nodeId, graphRunId, anchorCount],
      );
      await reset();
    },
    async completeReviewerWithVerifications(verifierNodeRunId, artifactPayload, execution, verifications) {
      await asServiceRole();
      await db.query(
        `select public.complete_reviewer_with_verifications_as_worker(
           $1, $2::uuid, $3::jsonb, $4, $5, $6, $7::jsonb
         )`,
        [WORKER, verifierNodeRunId, JSON.stringify(artifactPayload),
          execution.provider, execution.model, execution.latencyMs,
          JSON.stringify(verifications)],
      );
      await reset();
    },
    async completeRun(graphRunId, state, hadPartialInput, detail, usage) {
      await asServiceRole();
      await db.query(
        "select public.complete_graph_run_with_phase1c_bridge_as_worker($1, $2::uuid, $3::public.graph_run_state, $4, $5, $6, null, $7)",
        [
          WORKER, graphRunId, state, hadPartialInput,
          usage?.tokensUsed ?? null, usage?.costMicros ?? null, detail ?? null,
        ],
      );
      await reset();
    },
  };
}

/** The seed's own dependency wiring, over PGlite. */
function pgliteDeps(drain: boolean, log: (line: string) => void) {
  return {
    store: pgliteStore(),
    graphId,
    drain,
    log,
    listOpenGates: async (id: string): Promise<readonly SeedGate[]> => {
      await asOwner();
      const gates = await db.query<SeedGate>(
        `select gate.id, gate.kind::text as kind, gate.node_id, gate.stage::text as stage
           from public.graph_gates gate where gate.graph_id = $1 and gate.state = 'OPEN'`,
        [id],
      );
      await reset();
      return gates.rows;
    },
    approveHumanGate: async (gate: SeedGate) => {
      await asOwner();
      await db.query(
        "select public.decide_node_gate($1::uuid, true, 'Approved by the dev seed owner.')",
        [gate.id],
      );
      await reset();
    },
    decideAutomaticGate: async (gate: SeedGate) => {
      await asServiceRole();
      await db.query("select public.decide_automatic_gate_as_worker($1, $2::uuid)", [WORKER, gate.node_id]);
      await reset();
    },
  };
}

beforeAll(async () => {
  // The chain, restored from a snapshot rather than replayed; the
  // helper keys its cache on the CONTENT of every migration, and
  // asserts coverage of the whole directory.
  db = await createMigratedDatabase();
  await db.exec(`
    insert into auth.users (id) values ('${ownerId}');
    insert into public.organizations (id, name, slug, created_by)
    values ('${organizationId}', 'Dev Seed Factory', 'dev-seed-drive', '${ownerId}');
    insert into public.projects (
      id, organization_id, name, status, github_repository, default_branch, created_by
    ) values (
      '${projectId}', '${organizationId}', 'Connected Project', 'active',
      '${CLAIM_REPOSITORY}', 'main', '${ownerId}'
    );
    insert into public.connections (
      id, organization_id, name, provider, status, secret_reference, created_by
    ) values (
      '30000000-0000-4000-8000-00000000d21e', '${organizationId}',
      'GitHub', 'github', 'connected', 'env://GITHUB_APP', '${ownerId}'
    );
    insert into public.github_installations (
      id, organization_id, connection_id, external_installation_id, app_id,
      app_slug, account_id, account_login, account_type, target_type,
      repository_selection, status, installed_at, created_by
    ) values (
      '50000000-0000-4000-8000-00000000d21e', '${organizationId}',
      '30000000-0000-4000-8000-00000000d21e', 940001, 940002,
      'dev-seed-app', 940003, 'factory', 'Organization', 'Organization',
      'selected', 'active', now(), '${ownerId}'
    );
    insert into public.github_repositories (
      id, organization_id, installation_id, external_repository_id,
      owner_login, name, full_name, default_branch, html_url, private,
      visibility, selected, github_updated_at
    ) values (
      '60000000-0000-4000-8000-00000000d21e', '${organizationId}',
      '50000000-0000-4000-8000-00000000d21e', 940004,
      'factory', 'dev-seed', '${CLAIM_REPOSITORY}', 'main',
      'https://github.com/${CLAIM_REPOSITORY}', true, 'private', true, now()
    );
    insert into public.project_connections (
      organization_id, project_id, connection_id, github_repository_id,
      is_primary, created_by
    ) values (
      '${organizationId}', '${projectId}',
      '30000000-0000-4000-8000-00000000d21e',
      '60000000-0000-4000-8000-00000000d21e', true, '${ownerId}'
    );
  `);

  // The seed's own plant: the product's template through the product's RPC.
  const template = findTemplate("full_lifecycle");
  const built = buildLaunchPlan(template!, budgetForTemplate(template!, DEFAULT_GRAPH_BUDGET));
  if (!built.ok) throw new Error(`full_lifecycle did not compile: ${built.errors.join("; ")}`);
  await asOwner();
  const created = await db.query<{ id: string }>(
    `select public.create_graph_from_plan($1, $2, $3, $4::public.graph_topology, $5::jsonb,
              $6::public.risk_level, $7, $8::jsonb, $9::jsonb, $10::jsonb) as id`,
    [
      organizationId, projectId, `Dev seed: ${built.plan.goal}`, built.plan.topology,
      JSON.stringify(built.plan.topologyReasons), built.plan.riskLevel,
      built.plan.requiresOwnerApproval,
      JSON.stringify(built.plan.nodes), JSON.stringify(built.plan.edges),
      JSON.stringify(built.plan.budget),
    ],
  );
  graphId = created.rows[0].id;
  await reset();
}, 240_000);

afterAll(async () => {
  await db?.close();
});

describe("the seeded ten-step flow, driven by the seed's own loop", { timeout: 240_000 }, () => {
  const lines: string[] = [];

  it("halts for a decision without --drain, rather than deciding for the owner", async () => {
    // The default run is a demonstration, not an approval: it stops where a
    // person is required and says so.
    const outcome = await driveSeedLifecycle(pgliteDeps(false, (line) => lines.push(line)));

    expect(outcome.haltedForDecision, "the seed must stop at the first human gate").toBe(true);
    expect(outcome.finalState).toBe("PARTIAL");
    expect(lines.some((line) => line.includes("ARCHITECTURE (HUMAN)"))).toBe(true);
    expect(lines.some((line) => line.includes("Re-run with --drain"))).toBe(true);
  });

  it("walks all ten steps to a COMPLETED run with --drain", async () => {
    const outcome = await driveSeedLifecycle(pgliteDeps(true, (line) => lines.push(line)));
    await reset();
    const incomplete = await db.query<{
      blocked_reason: string | null;
      error_message: string | null;
      node_key: string;
      run_state: string;
      state: string;
    }>(
      `select node.node_key, run.state::text as run_state,
              node_run.state::text as state,
              node_run.blocked_reason, node_run.error_message
       from public.graph_runs run
       join public.node_runs node_run on node_run.graph_run_id = run.id
       join public.graph_nodes node on node.id = node_run.node_id
       where run.graph_id = $1 and node_run.state <> 'COMPLETED'
       order by run.created_at, node.node_key`,
      [graphId],
    );

    expect(
      outcome.finalState,
      `the seeded flow must reach a completed run:\n${lines.join("\n")}\n${JSON.stringify(incomplete.rows)}`,
    ).toBe("COMPLETED");
    expect(outcome.windows, "gates must have split the walk into several windows").toBeGreaterThan(1);
  });

  it("closed every one of the eleven stages with its artifact recorded", async () => {
    await reset();
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
      expect(slice, `stage ${stage} must hold a node run`).toBeDefined();
      expect(slice!.completed, `stage ${stage} must complete`).toBeGreaterThan(0);
      expect(slice!.artifacts, `stage ${stage} must record its product`).toBeGreaterThan(0);
    }
  });

  it("keeps architecture, merge, and release acceptance with a person", async () => {
    await reset();
    const gates = await db.query<{ stage: string; kind: string; state: string; decided_by: string | null; anchor_count: number }>(
      `select stage::text as stage, kind::text as kind, state::text as state, decided_by, anchor_count
         from public.graph_gates where graph_id = $1 order by stage`,
      [graphId],
    );
    const human = gates.rows.filter((row) => row.kind === "HUMAN");
    const automatic = gates.rows.filter((row) => row.kind === "AUTOMATIC");

    expect(human.map((row) => row.stage).sort()).toEqual(["ARCHITECTURE", "DEPLOYMENT", "TEST"]);
    for (const gate of human) {
      expect(gate.state).toBe("APPROVED");
      expect(gate.decided_by, "a human gate is decided by a person").toBe(ownerId);
    }
    expect(automatic).toEqual([]);
  });

  it("labels everything it wrote as seed output, so nothing reads as real work", async () => {
    await reset();
    const payloads = await db.query<{ total: number; labelled: number }>(
      `select count(*)::int as total,
              count(*) filter (where a.payload ? 'dev_seed')::int as labelled
         from public.graph_artifacts a
         join public.node_runs nr on nr.id = a.node_run_id
         join public.graph_nodes n on n.id = nr.node_id
        where n.graph_id = $1`,
      [graphId],
    );
    expect(payloads.rows[0].total).toBeGreaterThan(0);
    expect(
      payloads.rows[0].labelled,
      "every seeded artifact must carry dev_seed",
    ).toBe(payloads.rows[0].total);
  });
});
