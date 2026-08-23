// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { GRAPH_TEMPLATES, findTemplate } from "@/lib/graph/templates";

/**
 * The payload the launch route sends must be one `create_graph_from_plan`
 * actually accepts.
 *
 * A unit test with a stubbed client would prove the route calls the function and
 * nothing about whether the call would work. The interesting failures here are
 * shape failures — an enum in the wrong case, a jsonb key the function does not
 * read, a node referencing an edge that was stripped — and every one of them is
 * invisible until Postgres sees it.
 *
 * So the real function, from the real migration, is run against the real
 * payload builder.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000009a1";
const organizationId = "10000000-0000-4000-8000-0000000009a1";
const projectId = "40000000-0000-4000-8000-0000000009a1";

/**
 * `create_graph_from_plan` requires `is_organization_member(auth.uid())`, so the
 * caller must be a real authenticated member. `reset role` clears the claim and
 * the function correctly refuses with `not_a_member` — which is the write
 * boundary working, and was the first thing this test got wrong.
 */
async function asMember(db: PGlite): Promise<void> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  await db.exec("set role authenticated");
}

async function asCatalogue(db: PGlite): Promise<void> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

describe("the graph launch payload", () => {
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

    for (const file of (await readdir(migrationsRoot)).filter((f) => /^\d+.*\.sql$/.test(f)).sort()) {
      await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Launch Org', 'launch-org', '${ownerId}');
      insert into public.projects (id, organization_id, name, status, created_by) values
        ('${projectId}', '${organizationId}', 'Launch Project', 'active', '${ownerId}');
    `);
  }, 300_000);

  afterAll(async () => {
    await db?.close();
  });

  async function launch(templateKey: string, goal?: string): Promise<string> {
    const template = findTemplate(templateKey)!;
    const built = buildLaunchPlan(template, DEFAULT_GRAPH_BUDGET, { goal });
    if (!built.ok) throw new Error(`template did not compile: ${built.errors.join("; ")}`);
    const plan = built.plan;

    const result = await db.query<{ create_graph_from_plan: string }>(
      `select public.create_graph_from_plan(
         $1::uuid, $2::uuid, $3::text, $4::public.graph_topology, $5::jsonb,
         $6::public.risk_level, $7::boolean, $8::jsonb, $9::jsonb, $10::jsonb)`,
      [
        organizationId,
        projectId,
        plan.goal,
        plan.topology,
        JSON.stringify(plan.topologyReasons),
        plan.riskLevel,
        plan.requiresOwnerApproval,
        JSON.stringify(plan.nodes),
        JSON.stringify(plan.edges),
        JSON.stringify(plan.budget),
      ],
    );
    return result.rows[0].create_graph_from_plan;
  }

  it("creates a graph, its nodes and its edges from a template", async () => {
    await asMember(db);
    const graphId = await launch("feature_build");
    expect(graphId).toMatch(/^[0-9a-f-]{36}$/);

    await asCatalogue(db);
    const nodes = await db.query<{ count: number }>(
      "select count(*)::int as count from public.graph_nodes where graph_id = $1",
      [graphId],
    );
    const edges = await db.query<{ count: number }>(
      "select count(*)::int as count from public.graph_edges where graph_id = $1",
      [graphId],
    );

    // The engine's own numbers, not a guess: whatever the compiler produced is
    // what the database should now hold.
    const built = buildLaunchPlan(findTemplate("feature_build")!, DEFAULT_GRAPH_BUDGET);
    if (!built.ok) throw new Error("feature_build did not compile");
    expect(nodes.rows[0].count).toBe(built.plan.nodes.length);
    expect(edges.rows[0].count).toBe(built.plan.edges.length);
  }, 120_000);

  it("stores the request in the person's own words, not the template's summary", async () => {
    /*
     * `graphs.goal` is what every downstream surface shows as "what this run is
     * for" — the runs list, the stage pages, the artifacts page. A launch that
     * recorded the template's summary there would give ten runs of the same
     * template ten identical descriptions, and the one-sentence intake would
     * have nowhere to put the sentence.
     */
    await asMember(db);
    const asked = "Add world-class backtesting to my trading platform.";
    const graphId = await launch("agentic_sdlc", asked);

    await asCatalogue(db);
    const stored = await db.query<{ goal: string; is_lifecycle: boolean }>(
      "select goal, is_lifecycle from public.graphs where id = $1",
      [graphId],
    );
    expect(stored.rows[0].goal).toBe(asked);
    expect(stored.rows[0].is_lifecycle).toBe(true);
  }, 120_000);

  it("falls back to the template's summary when no request was typed", async () => {
    // Launching a template from the pipelines page is still a legitimate way
    // in and has no sentence behind it. Recording an empty goal would violate
    // the column's own check constraint; recording the summary says truthfully
    // that a template was run rather than a request made.
    await asMember(db);
    const graphId = await launch("security_audit");

    await asCatalogue(db);
    const stored = await db.query<{ goal: string }>(
      "select goal from public.graphs where id = $1",
      [graphId],
    );
    expect(stored.rows[0].goal).toBe(findTemplate("security_audit")!.summary);
  }, 120_000);

  it("treats a goal of nothing but spaces as no goal at all", async () => {
    await asMember(db);
    const graphId = await launch("security_audit", "   ");

    await asCatalogue(db);
    const stored = await db.query<{ goal: string }>(
      "select goal from public.graphs where id = $1",
      [graphId],
    );
    expect(stored.rows[0].goal).toBe(findTemplate("security_audit")!.summary);
  }, 120_000);

  it("stages every node of every template, and iterates only the lifecycle", async () => {
    /*
     * Two facts that used to be one, and separating them was the point of
     * `stageForCapability`.
     *
     * A stage is now a *label*: every template's nodes carry one, so the
     * graph-runs Stage column reads as something for an audit as well as for a
     * lifecycle. Whether a graph may ITERATE is a *different* question,
     * answered by `graphs.is_lifecycle`. Conflating them meant labelling an
     * audit node turned every read-only analysis into a graph that re-runs
     * itself, spending subscription turns on passes nobody asked for.
     *
     * This asserted "no node of the others is staged" before that separation
     * landed. That is now false and would have been the wrong thing to protect.
     */
    await asMember(db);
    const lifecycle = await launch("agentic_sdlc", "Ship the thing.");
    const audit = await launch("security_audit");

    await asCatalogue(db);
    const staged = await db.query<{ stage: string | null; count: number }>(
      `select lifecycle_stage::text as stage, count(*)::int as count
         from public.graph_nodes where graph_id = $1 group by 1 order by 1`,
      [lifecycle],
    );
    expect(staged.rows.every((row) => row.stage !== null)).toBe(true);
    expect(new Set(staged.rows.map((row) => row.stage))).toEqual(new Set([
      "REQUIREMENT", "DISCOVER", "EVALUATE", "DECIDE", "ARCHITECT",
      "BUILD", "REVIEW", "TEST", "DEPLOY", "MONITOR",
    ]));

    // The audit's nodes are staged too, by the work they do rather than by a
    // per-template opinion. A security audit reads something that already
    // exists and reports on it, which is REVIEW.
    const auditStages = await db.query<{ stage: string | null; count: number }>(
      `select lifecycle_stage::text as stage, count(*)::int as count
         from public.graph_nodes where graph_id = $1 group by 1 order by 1`,
      [audit],
    );
    expect(auditStages.rows.every((row) => row.stage !== null)).toBe(true);
    expect(new Set(auditStages.rows.map((row) => row.stage))).toEqual(new Set(["REVIEW"]));

    // And the separation itself: labelled, but never a lifecycle, so nothing
    // iterates it.
    const flags = await db.query<{ id: string; is_lifecycle: boolean }>(
      `select id::text, is_lifecycle from public.graphs where id in ($1, $2) order by is_lifecycle`,
      [lifecycle, audit],
    );
    expect(flags.rows.map((row) => row.is_lifecycle)).toEqual([false, true]);
  }, 120_000);

  it("records the compiler's topology and risk rather than a default", async () => {
    await asMember(db);
    const graphId = await launch("security_audit");

    await asCatalogue(db);
    const { rows } = await db.query<{ topology: string; risk_level: string }>(
      "select topology, risk_level from public.graphs where id = $1",
      [graphId],
    );
    const built = buildLaunchPlan(findTemplate("security_audit")!, DEFAULT_GRAPH_BUDGET);
    if (!built.ok) throw new Error("security_audit did not compile");

    expect(rows[0].topology).toBe(built.plan.topology);
    // The enum is lowercase and the engine is uppercase. This assertion is the
    // one that fails if that conversion is ever dropped.
    expect(rows[0].risk_level).toBe(built.plan.riskLevel);
  }, 120_000);

  it("persists the compiled execution envelope instead of database defaults", async () => {
    await asMember(db);
    const graphId = await launch("security_audit");

    await asCatalogue(db);
    const { rows } = await db.query<{ node_key: string; executor: string; timeout_ms: number; max_attempts: number }>(
      "select node_key, executor::text as executor, timeout_ms, max_attempts from public.graph_nodes where graph_id = $1 order by node_key",
      [graphId],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // A MODEL inspector carries the measured eight-minute envelope; code
      // keeps the tight default. Before the payload carried these fields,
      // the database defaults silently overrode the planner (the first live
      // drain burned on exactly that).
      expect({ key: row.node_key, timeout: row.timeout_ms }).toEqual({
        key: row.node_key,
        timeout: row.executor === "MODEL" ? 480_000 : 180_000,
      });
      expect(row.max_attempts).toBe(2);
    }
  }, 120_000);

  it("produces a payload every registered template can be launched with", async () => {
    await asMember(db);
    // A template that compiles but cannot be written is a template nobody can
    // use, and the console offers all of them.
    const failures: string[] = [];
    for (const template of GRAPH_TEMPLATES) {
      const built = buildLaunchPlan(template, DEFAULT_GRAPH_BUDGET);
      if (!built.ok) {
        failures.push(`${template.key}: did not compile — ${built.errors.join("; ")}`);
        continue;
      }
      try {
        await launch(template.key);
      } catch (error) {
        failures.push(`${template.key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(failures).toEqual([]);
  }, 300_000);

  it("refuses a graph for a project in another organization", async () => {
    await asMember(db);
    const otherOrg = "10000000-0000-4000-8000-0000000009b2";
    await db.exec(`
      insert into public.organizations (id, name, slug, created_by) values
        ('${otherOrg}', 'Other Org', 'other-org-9b2', '${ownerId}')
      on conflict do nothing;
    `);

    const built = buildLaunchPlan(findTemplate("feature_build")!, DEFAULT_GRAPH_BUDGET);
    if (!built.ok) throw new Error("feature_build did not compile");
    const plan = built.plan;

    // The project belongs to `organizationId`; the graph claims `otherOrg`. The
    // composite foreign key is what stops this, which is why the tables carry
    // one rather than a plain project reference.
    await expect(
      db.query(
        `select public.create_graph_from_plan(
           $1::uuid, $2::uuid, $3::text, $4::public.graph_topology, $5::jsonb,
           $6::public.risk_level, $7::boolean, $8::jsonb, $9::jsonb, $10::jsonb)`,
        [
          otherOrg,
          projectId,
          plan.goal,
          plan.topology,
          JSON.stringify(plan.topologyReasons),
          plan.riskLevel,
          plan.requiresOwnerApproval,
          JSON.stringify(plan.nodes),
          JSON.stringify(plan.edges),
          JSON.stringify(plan.budget),
        ],
      ),
    ).rejects.toThrow();
  }, 120_000);
});
