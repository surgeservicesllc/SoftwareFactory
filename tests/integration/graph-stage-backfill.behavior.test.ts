// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260830001800_customer_portal.sql";
/*
 * Two different files on purpose. `latestMigration` pins the replay chain's
 * tail; `backfillMigration` is the one this suite re-runs against seeded
 * rows. They were one constant until the chain grew past the backfill —
 * at which point the suite silently re-ran the wrong file, whose postflight
 * (rightly) refused the stage-less rows the suite had just seeded.
 */
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
    for (const migrationFile of migrationFiles) {
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
});
