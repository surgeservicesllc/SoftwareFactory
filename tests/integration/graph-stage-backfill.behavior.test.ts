// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
/**
 * Two different facts, which used to be one string.
 *
 * `latestMigration` pins the newest file in the directory; `backfillMigration`
 * names the file this suite actually exercises. They were the same value while
 * the backfill *was* the newest migration, and a later pin bump silently
 * repointed the suite at an unrelated file — which read as "the backfill filled
 * nothing" rather than as "the suite ran the wrong SQL".
 */
const latestMigration = "20260823001100_node_run_confidence.sql";
const backfillMigration = "20260823000700_backfill_graph_node_lifecycle_stage.sql";

const ownerId = "00000000-0000-4000-8000-0000000009a1";
const organizationId = "10000000-0000-4000-8000-0000000009a1";
const projectId = "20000000-0000-4000-8000-0000000009a1";
const graphId = "30000000-0000-4000-8000-0000000009a1";

/**
 * The backfill, against the real migrated schema.
 *
 * Every graph created before the templates learned to supply a stage stored
 * null on every node, so the graph-runs Stage column showed an em dash for the
 * whole of the owner's history — including the first real Step 9 run. The
 * stage is derivable from `capability`, which those rows already have.
 */
describe("graph node lifecycle backfill", () => {
  let db: PGlite;
  let backfill: string;
  /** The migrations after the backfill, applied by the last case. */
  let afterBackfill: string[] = [];

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

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(migrationFiles.at(-1)).toBe(latestMigration);

    /*
     * Applied only as far as the backfill, on purpose.
     *
     * The backfill writes the eight-stage vocabulary — `'IMPLEMENTATION'`,
     * `'ARCHITECTURE'`, `'PRD'` — because it runs before the ten-stage widening
     * rebuilds the enum. On a fully migrated database those labels no longer
     * exist and every statement below would die on `invalid input value for
     * enum sdlc_stage`.
     *
     * That is not a defect in either migration: the chain runs them in order
     * and the widening maps every row the backfill wrote. It does mean this
     * suite has to stand where the backfill actually stands, so the cases keep
     * asserting what the backfill really produces. The last case then applies
     * the rest of the chain and proves the two compose.
     */
    const upToBackfill = migrationFiles.slice(0, migrationFiles.indexOf(backfillMigration) + 1);
    afterBackfill = migrationFiles.slice(upToBackfill.length);
    expect(upToBackfill.at(-1), "the backfill migration is missing").toBe(backfillMigration);
    expect(afterBackfill.length, "the widening must run after the backfill").toBeGreaterThan(0);

    for (const migrationFile of upToBackfill) {
      await db.exec(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
    }
    backfill = await readFile(resolve(migrationsDirectory, backfillMigration), "utf8");

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Stage Tenant', 'stage-tenant', '${ownerId}');
      insert into public.projects (id, organization_id, name, created_by)
      values ('${projectId}', '${organizationId}', 'Stage Project', '${ownerId}');
      insert into public.graphs (id, organization_id, project_id, goal, topology, created_by)
      values (
        '${graphId}', '${organizationId}', '${projectId}',
        'An audit recorded before templates carried stages.',
        'DIAMOND'::public.graph_topology, '${ownerId}'
      );
    `);
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  async function seedAndBackfill(rows: readonly { key: string; capability: string }[]) {
    for (const row of rows) {
      await db.query(
        `insert into public.graph_nodes
           (organization_id, graph_id, node_key, job, executor, capability, lifecycle_stage)
         values ($1::uuid, $2::uuid, $3::text, $4::text, 'MODEL'::public.graph_node_executor, $5::text, null)`,
        [organizationId, graphId, row.key, `Job for ${row.key}`, row.capability],
      );
    }
    await db.exec(backfill);
    const { rows: read } = await db.query<{ node_key: string; lifecycle_stage: string | null }>(
      `select node_key, lifecycle_stage::text from public.graph_nodes
        where graph_id = $1::uuid order by node_key`,
      [graphId],
    );
    return new Map(read.map((row) => [row.node_key, row.lifecycle_stage]));
  }

  it("derives each stage from the work the node does", async () => {
    const stages = await seedAndBackfill([
      { key: "a_inspect", capability: "review" },
      { key: "b_secure", capability: "security_review" },
      { key: "c_reduce", capability: "extraction" },
      { key: "d_report", capability: "reporting" },
      { key: "e_tests", capability: "qa" },
      { key: "f_build", capability: "implementation" },
      { key: "g_design", capability: "architecture" },
      { key: "h_plan", capability: "planning" },
    ]);

    expect(stages.get("a_inspect")).toBe("REVIEW");
    expect(stages.get("b_secure")).toBe("REVIEW");
    expect(stages.get("c_reduce")).toBe("REVIEW");
    expect(stages.get("d_report")).toBe("REVIEW");
    expect(stages.get("e_tests")).toBe("TEST");
    expect(stages.get("f_build")).toBe("IMPLEMENTATION");
    expect(stages.get("g_design")).toBe("ARCHITECTURE");
    expect(stages.get("h_plan")).toBe("PRD");
  });

  it("leaves a capability it does not recognise alone", async () => {
    // The column is free text. An em dash is honest about a value this system
    // never defined; a guessed stage would not be.
    const stages = await seedAndBackfill([{ key: "z_unknown", capability: "astrology" }]);
    expect(stages.get("z_unknown")).toBeNull();
  });

  it("never overwrites a stage a template declared", async () => {
    await db.query(
      `insert into public.graph_nodes
         (organization_id, graph_id, node_key, job, executor, capability, lifecycle_stage)
       values ($1::uuid, $2::uuid, 'y_declared', 'Declared node', 'MODEL'::public.graph_node_executor,
               'qa', 'DEPLOYMENT'::public.sdlc_stage)`,
      [organizationId, graphId],
    );
    await db.exec(backfill);

    const { rows } = await db.query<{ lifecycle_stage: string }>(
      `select lifecycle_stage::text from public.graph_nodes
        where graph_id = $1::uuid and node_key = 'y_declared'`,
      [graphId],
    );
    // `qa` derives to TEST; the declared DEPLOYMENT must survive, which is
    // what makes a replay of this migration safe.
    expect(rows[0]?.lifecycle_stage).toBe("DEPLOYMENT");
  });

  it("is a no-op on replay", async () => {
    const before = await db.query<{ count: string }>(
      `select count(*)::text as count from public.graph_nodes where lifecycle_stage is null`,
    );
    await db.exec(backfill);
    const after = await db.query<{ count: string }>(
      `select count(*)::text as count from public.graph_nodes where lifecycle_stage is null`,
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("hands every backfilled row to the ten-stage widening intact", async () => {
    /*
     * The composition, run in the order production runs it.
     *
     * Everything above proved the backfill derives the right eight-stage label.
     * This applies the rest of the chain — including the widening that rebuilds
     * the enum — and proves each of those rows arrives at its ten-stage
     * equivalent rather than being stranded or dropped.
     *
     * The three that matter are the three the widening renames. REVIEW and TEST
     * are asserted too: a map that silently passes some values through is a map
     * nobody can check by reading.
     */
    for (const migrationFile of afterBackfill) {
      await db.exec(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
    }

    const { rows } = await db.query<{ node_key: string; lifecycle_stage: string | null }>(
      `select node_key, lifecycle_stage::text from public.graph_nodes
        where graph_id = $1::uuid order by node_key`,
      [graphId],
    );
    const stages = new Map(rows.map((row) => [row.node_key, row.lifecycle_stage]));

    expect(stages.get("f_build"), "IMPLEMENTATION should widen to BUILD").toBe("BUILD");
    expect(stages.get("g_design"), "ARCHITECTURE should widen to ARCHITECT").toBe("ARCHITECT");
    expect(stages.get("h_plan"), "PRD should widen to REQUIREMENT").toBe("REQUIREMENT");
    expect(stages.get("y_declared"), "DEPLOYMENT should widen to DEPLOY").toBe("DEPLOY");
    expect(stages.get("a_inspect")).toBe("REVIEW");
    expect(stages.get("e_tests")).toBe("TEST");
    // The unrecognised capability stayed null through the backfill, and the
    // widening renames values rather than inventing them.
    expect(stages.get("z_unknown")).toBeNull();

    const labels = await db.query<{ enumlabel: string }>(
      `select label.enumlabel from pg_type kind
         join pg_namespace space on space.oid = kind.typnamespace
         join pg_enum label on label.enumtypid = kind.oid
        where space.nspname = 'public' and kind.typname = 'sdlc_stage'
        order by label.enumsortorder`,
    );
    expect(labels.rows.map((row) => row.enumlabel)).toEqual([
      "REQUIREMENT", "DISCOVER", "EVALUATE", "DECIDE", "ARCHITECT",
      "BUILD", "REVIEW", "TEST", "DEPLOY", "MONITOR",
    ]);
  }, 240_000);
});
