// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { budgetForTemplate, findTemplate, templateStageFor } from "@/lib/graph/templates";
import { SDLC_STAGES } from "@/lib/sdlc/lifecycle";

/**
 * One request through all ten phases of the owner's process.
 *
 * The boards say it plainly: one request in, an execution graph whose nodes
 * are the ten steps, with three human authority boundaries: ARCHITECTURE
 * approves the handoff, TEST owns the merge decision after exact-head CI, and
 * DEPLOYMENT owns release acceptance after exact deployment evidence. The
 * `full_lifecycle` template is that graph, stitched entirely from existing
 * machinery: the scout's look-before-you-build chain, the SDLC's build half,
 * the same capabilities, contracts, gates and budget rules every other
 * template runs under.
 *
 * What this suite proves against a real PostgreSQL: the template compiles and
 * launches through the same `create_graph_from_plan` the product uses, every
 * one of the eleven stages holds at least one stored node (the ten phases,
 * with REQUIREMENT as GOAL + PRD), the stages arrive in dependency order, and
 * the gates land where the lifecycle definitions put them.
 */


const ownerId = "00000000-0000-4000-8000-00000000fa01";
const organizationId = "10000000-0000-4000-8000-00000000fa01";
const projectId = "20000000-0000-4000-8000-00000000fa01";

let db: PGlite;
let graphId: string;

async function asUser(client: PGlite, userId: string) {
  await client.exec("reset role");
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

beforeAll(async () => {
  // The chain, restored from a snapshot rather than replayed; the
  // helper keys its cache on the CONTENT of every migration, and
  // asserts coverage of the whole directory.
  db = await createMigratedDatabase();

  await db.exec(`
    insert into auth.users (id) values ('${ownerId}');
    insert into public.organizations (id, name, slug, created_by)
    values ('${organizationId}', 'Lifecycle Tenant', 'lifecycle-tenant', '${ownerId}');
    insert into public.projects (id, organization_id, name, created_by)
    values ('${projectId}', '${organizationId}', 'Lifecycle Project', '${ownerId}');
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
}, 240_000);

afterAll(async () => {
  await db?.close();
});

describe("the full lifecycle graph", () => {
  it("stores at least one node in every one of the eleven stages", async () => {
    // The ten phases of the owner's board, with REQUIREMENT as GOAL + PRD.
    // A phase with no node is a phase this graph cannot enter, and the claim
    // "all ten phases" would be prose rather than rows.
    await db.exec("reset role");
    const staged = await db.query<{ lifecycle_stage: string }>(
      `select distinct lifecycle_stage::text from public.graph_nodes
        where graph_id = $1 and lifecycle_stage is not null`,
      [graphId],
    );
    expect(new Set(staged.rows.map((row) => row.lifecycle_stage))).toEqual(new Set(SDLC_STAGES));
  });

  it("orders the phases by dependency: no stage's node precedes its input stage", async () => {
    await db.exec("reset role");
    const edges = await db.query<{ from_stage: string; to_stage: string }>(
      `select upstream.lifecycle_stage::text as from_stage,
              downstream.lifecycle_stage::text as to_stage
         from public.graph_edges edge
         join public.graph_nodes upstream on upstream.id = edge.from_node_id
         join public.graph_nodes downstream on downstream.id = edge.to_node_id
        where edge.graph_id = $1 and coalesce(edge.is_feedback, false) = false`,
      [graphId],
    );
    expect(edges.rows.length).toBeGreaterThan(0);
    const order = new Map(SDLC_STAGES.map((stage, index) => [stage, index]));
    for (const edge of edges.rows) {
      expect(
        order.get(edge.to_stage as (typeof SDLC_STAGES)[number])!,
        `${edge.from_stage} -> ${edge.to_stage} runs backwards`,
      ).toBeGreaterThanOrEqual(order.get(edge.from_stage as (typeof SDLC_STAGES)[number])!);
    }
  });

  it("keeps architecture, merge, and release acceptance behind human gates", async () => {
    // Full Lifecycle v2 does not let the graph worker approve its own merge.
    // TEST records exact-head CI, then a HUMAN gate owns the merge decision;
    // DEPLOYMENT separately records the exact release, then a HUMAN gate owns
    // release acceptance. ARCHITECTURE remains the owner boundary that starts
    // the separately authorized Phase 1C build.
    await db.exec("reset role");
    const gates = await db.query<{ node_key: string; gate_kind: string | null; stage: string; executor: string }>(
      `select node_key, gate_kind::text, lifecycle_stage::text as stage, executor::text as executor
         from public.graph_nodes where graph_id = $1 and gate_kind is not null
        order by node_key`,
      [graphId],
    );
    const human = gates.rows.filter((row) => row.gate_kind === "HUMAN");
    expect(human.map((row) => row.stage).sort()).toEqual(["ARCHITECTURE", "DEPLOYMENT", "TEST"]);
    const automatic = gates.rows.filter((row) => row.gate_kind === "AUTOMATIC");
    expect(automatic).toEqual([]);
  });

  it("records the feedback loop the board draws from MONITOR back to the goal", async () => {
    await db.exec("reset role");
    const feedback = await db.query<{ from_key: string; to_key: string }>(
      `select upstream.node_key as from_key, downstream.node_key as to_key
         from public.graph_edges edge
         join public.graph_nodes upstream on upstream.id = edge.from_node_id
         join public.graph_nodes downstream on downstream.id = edge.to_node_id
        where edge.graph_id = $1 and edge.is_feedback = true`,
      [graphId],
    );
    expect(feedback.rows).toContainEqual({ from_key: "monitor", to_key: "goal" });
  });

  it("declares a stage for every node, through the same rule every template uses", () => {
    const template = findTemplate("full_lifecycle")!;
    for (const node of template.nodes) {
      expect(templateStageFor(template, node.nodeId).stage, node.nodeId).not.toBeNull();
    }
  });
});
