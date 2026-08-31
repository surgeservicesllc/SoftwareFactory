// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { budgetForTemplate, findTemplate } from "@/lib/graph/templates";
import { WORKER_SUPPORTED_EXECUTORS } from "@/lib/worker/executor-support";

/**
 * The development seed's setup half, against the real migrated schema.
 *
 * `scripts/seed-dev-lifecycle.mts` plants a world — seed owner, organization,
 * project, one `full_lifecycle` graph — and then drives it with the same
 * worker store the production drain uses. The drive half is already pinned by
 * the worker suites; this pins the half that was not, because the script has
 * never run against a live stack (the container it was written in cannot
 * start Docker, and the script refuses the production project outright).
 *
 * An unrun script's most likely defects are exactly what a real database
 * catches and a mock cannot: an RPC parameter that does not exist, a call
 * made under a role RLS refuses, or an order that plants a graph before the
 * membership that authorizes it. So this performs the seed's own sequence,
 * in the seed's own order, under the seed's own roles.
 *
 * It earned its place immediately: the first run failed twice, on two real
 * defects the script would have hit at runtime and no reviewer had noticed.
 * The seed created its project with a direct service-role insert — but only
 * `postgres` may insert a project, because a project is born from the
 * audited `connect_github_project` path. And it read its world with the
 * service-role client — but `service_role` holds SELECT on none of
 * `projects`, `graphs` or `graph_gates`; those are granted to
 * `authenticated`, so RLS decides who sees what. Both are fixed: the seed
 * finds a project rather than inventing one, and reads as the signed-in
 * owner. The cases below are the shape of both failures.
 *
 * What it must prove:
 *
 *   - Onboarding is idempotent by slug: a second seed run finds the
 *     organization rather than duplicating it, which is the whole basis of
 *     the script's "run me twice" promise.
 *   - No role the seed holds can invent a project.
 *   - The seed's discovery read works as the owner and is refused the
 *     service role.
 *   - `full_lifecycle` plants through the same RPC the product's Launch
 *     button calls, is marked a lifecycle, and stages all eleven phases.
 *   - The planted graph is immediately claimable by a worker — a seed that
 *     produced an unclaimable graph would look like it worked and leave the
 *     factory pages empty forever.
 */


// The script's own constants, restated so a drift in either is a failure here.
const SEED_ORGANIZATION_NAME = "Dev Seed Factory";
const SEED_ORGANIZATION_SLUG = "dev-seed-factory";

const SEED_GOAL_PREFIX = "Dev seed:";
const CLAIM_REPOSITORY = "factory/dev-seed-setup";
const CLAIM_REQUIRED_CHECKS = ["CI"];

const ownerId = "00000000-0000-4000-8000-00000000d5ed";

let db: PGlite;

async function asOwner() {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  await db.exec("set role authenticated");
}

/** The seed's admin client: service role, as `SUPABASE_SERVICE_ROLE_KEY` is. */
async function asServiceRole() {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec("set role service_role");
}

async function reset() {
  await db.exec("reset role");
}

beforeAll(async () => {
  // The chain, restored from a snapshot rather than replayed; the
  // helper keys its cache on the CONTENT of every migration, and
  // asserts coverage of the whole directory.
  db = await createMigratedDatabase();
  // The seed creates this through the auth admin API; the row is what matters.
  await db.exec(`insert into auth.users (id) values ('${ownerId}');`);
}, 240_000);

afterAll(async () => {
  await db?.close();
});

describe("the development seed's setup sequence", { timeout: 240_000 }, () => {
  let organizationId = "";
  let projectId = "";
  let graphId = "";

  it("onboards the seed organization, and finds it again on a second run", async () => {
    await asOwner();
    const first = await db.query<{ organization_id: string; was_created: boolean }>(
      "select * from public.onboard_authenticated_organization($1, $2)",
      [SEED_ORGANIZATION_NAME, SEED_ORGANIZATION_SLUG],
    );
    expect(first.rows[0].was_created).toBe(true);
    organizationId = first.rows[0].organization_id;

    // The script's idempotency promise: running it twice is safe.
    const second = await db.query<{ organization_id: string; was_created: boolean }>(
      "select * from public.onboard_authenticated_organization($1, $2)",
      [SEED_ORGANIZATION_NAME, SEED_ORGANIZATION_SLUG],
    );
    await reset();
    expect(second.rows[0].was_created, "a second seed run must not duplicate").toBe(false);
    expect(second.rows[0].organization_id).toBe(organizationId);
  });

  it("cannot invent a project, under either role the seed holds", async () => {
    /*
     * This is why the seed finds a project instead of creating one. An
     * earlier draft inserted the row with the service-role client; this case
     * is the proof it would have died at runtime. Migration 20260812001700
     * revoked project writes from `authenticated`, and `service_role` never
     * held them, because a project is born from the audited
     * `connect_github_project` path and nothing else.
     */
    const insert = `insert into public.projects
      (organization_id, name, status, default_branch, created_by)
      values ($1, 'Invented Project', 'active', 'main', $2)`;

    await asServiceRole();
    await expect(
      db.query(insert, [organizationId, ownerId]),
      "service_role must not be able to invent a project",
    ).rejects.toThrow(/permission denied for table projects/);
    await reset();

    await asOwner();
    await expect(
      db.query(insert, [organizationId, ownerId]),
      "nor may the signed-in owner",
    ).rejects.toThrow(/permission denied for table projects/);
    await reset();
  });

  it("reads its world as the owner, because the service role may not", async () => {
    /*
     * The second defect this suite caught. The seed's discovery reads —
     * projects, graphs, gates — were written against the service-role client,
     * and `service_role` holds SELECT on none of those tables: they are
     * granted to `authenticated` only, so the product's own RLS decides who
     * sees what. Every one of those reads would have failed. The seed now
     * reads as the signed-in owner, exactly as the Projects page does.
     */
    await reset();
    const inserted = await db.query<{ id: string }>(
      `insert into public.projects (
         organization_id, name, status, github_repository, default_branch, created_by
       ) values ($1, 'Connected Project', 'active', $2, 'main', $3) returning id`,
      [organizationId, CLAIM_REPOSITORY, ownerId],
    );
    projectId = inserted.rows[0].id;
    await db.exec(`
      insert into public.connections (
        id, organization_id, name, provider, status, secret_reference, created_by
      ) values (
        '30000000-0000-4000-8000-00000000d5ed', '${organizationId}',
        'GitHub', 'github', 'connected', 'env://GITHUB_APP', '${ownerId}'
      );
      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id,
        app_slug, account_id, account_login, account_type, target_type,
        repository_selection, status, installed_at, created_by
      ) values (
        '50000000-0000-4000-8000-00000000d5ed', '${organizationId}',
        '30000000-0000-4000-8000-00000000d5ed', 980001, 980002,
        'dev-seed-setup-app', 980003, 'factory', 'Organization', 'Organization',
        'selected', 'active', now(), '${ownerId}'
      );
      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id,
        owner_login, name, full_name, default_branch, html_url, private,
        visibility, selected, github_updated_at
      ) values (
        '60000000-0000-4000-8000-00000000d5ed', '${organizationId}',
        '50000000-0000-4000-8000-00000000d5ed', 980004,
        'factory', 'dev-seed-setup', '${CLAIM_REPOSITORY}', 'main',
        'https://github.com/${CLAIM_REPOSITORY}', true, 'private', true, now()
      );
      insert into public.project_connections (
        organization_id, project_id, connection_id, github_repository_id,
        is_primary, created_by
      ) values (
        '${organizationId}', '${projectId}',
        '30000000-0000-4000-8000-00000000d5ed',
        '60000000-0000-4000-8000-00000000d5ed', true, '${ownerId}'
      );
    `);

    const discovery = "select id, name from public.projects where organization_id = $1 and status = 'active'";

    await asServiceRole();
    await expect(
      db.query(discovery, [organizationId]),
      "the service role must not be the seed's reader",
    ).rejects.toThrow(/permission denied for table projects/);
    await reset();

    // As the owner it works, and returns exactly the project the seed will use.
    await asOwner();
    const found = await db.query<{ id: string; name: string }>(discovery, [organizationId]);
    await reset();
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0].id).toBe(projectId);
  });

  it("plants full_lifecycle through the product's own RPC, staged and marked", async () => {
    const template = findTemplate("full_lifecycle");
    expect(template, "the seed names a template that must exist").toBeTruthy();
    const built = buildLaunchPlan(template!, budgetForTemplate(template!, DEFAULT_GRAPH_BUDGET));
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await asOwner();
    const created = await db.query<{ id: string }>(
      `select public.create_graph_from_plan($1, $2, $3, $4::public.graph_topology, $5::jsonb,
                $6::public.risk_level, $7, $8::jsonb, $9::jsonb, $10::jsonb) as id`,
      [
        organizationId, projectId, `${SEED_GOAL_PREFIX} ${built.plan.goal}`, built.plan.topology,
        JSON.stringify(built.plan.topologyReasons), built.plan.riskLevel,
        built.plan.requiresOwnerApproval,
        JSON.stringify(built.plan.nodes), JSON.stringify(built.plan.edges),
        JSON.stringify(built.plan.budget),
      ],
    );
    await reset();
    graphId = created.rows[0].id;

    const graph = await db.query<{ is_lifecycle: boolean; goal: string; requires_owner_approval: boolean }>(
      "select is_lifecycle, goal, requires_owner_approval from public.graphs where id = $1",
      [graphId],
    );
    // The seed's own goal prefix survives, so seed work is identifiable in
    // any listing without reading a payload.
    expect(graph.rows[0].goal.startsWith(SEED_GOAL_PREFIX)).toBe(true);
    expect(graph.rows[0].is_lifecycle, "the ten-step pages read lifecycles only").toBe(true);

    const stages = await db.query<{ n: number }>(
      `select count(distinct lifecycle_stage)::int as n from public.graph_nodes
        where graph_id = $1 and lifecycle_stage is not null`,
      [graphId],
    );
    expect(stages.rows[0].n, "all eleven phases must be staged").toBe(11);
  });

  it("leaves a graph a worker can actually claim", async () => {
    // A seed that planted an unclaimable graph would look like it worked and
    // leave every factory page empty. This is the assertion that catches it.
    await asServiceRole();
    const claimed = await db.query<{ claim_planned_graph: { graph_id?: string } | null }>(
      `select public.claim_planned_graph_v3(
         $1, $2::text[], $3, $4::jsonb, 3
       ) as claim_planned_graph`,
      ["dev-seed-lifecycle", WORKER_SUPPORTED_EXECUTORS, CLAIM_REPOSITORY,
        JSON.stringify(CLAIM_REQUIRED_CHECKS)],
    );
    await reset();
    expect(claimed.rows[0].claim_planned_graph, "the seed's graph must be claimable").not.toBeNull();
    expect(claimed.rows[0].claim_planned_graph?.graph_id).toBe(graphId);
  });
});
