// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SDLC_STAGES } from "@/lib/sdlc/lifecycle";

/**
 * The three stages ADR-136 held back, now earned.
 *
 * 20260823000800 grows `sdlc_stage` by DISCOVERY, EVALUATION and DECISION —
 * between PRD and ARCHITECTURE, where look-before-you-build belongs — and
 * 20260823000900 extends the capability→stage derivation to the three
 * capabilities that produce them. What is worth proving against a real
 * PostgreSQL: the enum's order matches the application's `SDLC_STAGES`
 * exactly (a stage summary that sorts by enum must agree with one that sorts
 * by the array), a node can actually be stored in the new stages, and the
 * split into two files exists because the second could not run in the
 * first's transaction.
 */

const migrationsRoot = resolve(import.meta.dirname, "../../supabase/migrations");

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
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  expect(migrationFiles.at(-1)).toBe("20260830000500_services_crm_foundation.sql");
  for (const file of migrationFiles) {
    await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
  }
}, 240_000);

afterAll(async () => {
  await db?.close();
});

describe("the DISCOVERY/EVALUATION/DECISION stage growth", () => {
  it("orders the enum exactly as the application's SDLC_STAGES", async () => {
    const labels = await db.query<{ enumlabel: string }>(`
      select enumlabel from pg_enum
       where enumtypid = 'public.sdlc_stage'::regtype
       order by enumsortorder`);
    expect(labels.rows.map((row) => row.enumlabel)).toEqual([...SDLC_STAGES]);
  });

  it("stores a node in each new stage, which is what makes the values vocabulary", async () => {
    // Straight casts prove storability without walking the whole launch path,
    // which the agentic-sdlc behaviour suite already exercises.
    const cast = await db.query<{ stage: string }>(`
      select unnest(array[
        'DISCOVERY'::public.sdlc_stage,
        'EVALUATION'::public.sdlc_stage,
        'DECISION'::public.sdlc_stage
      ])::text as stage`);
    expect(cast.rows.map((row) => row.stage)).toEqual(["DISCOVERY", "EVALUATION", "DECISION"]);
  });

  it("keeps the growth in a file that never uses what it adds", async () => {
    /*
     * The hosted apply runs each migration under `psql -1`, and PostgreSQL
     * refuses a cast to an enum value inside the transaction that added it.
     * The reason this is two files is exactly that refusal; a cast creeping
     * into 000800 would pass the PGlite replay (separate execs) and then
     * fail the one place it matters.
     */
    const growth = await readFile(
      resolve(migrationsRoot, "20260823000800_discovery_evaluation_decision_stages.sql"),
      "utf8",
    );
    expect(growth).not.toMatch(/'(DISCOVERY|EVALUATION|DECISION)'::public\.sdlc_stage/);
  });

  it("answers the apply scope's own readback with t, so the verifier cannot fail the verified", async () => {
    /*
     * The first hosted apply of this pair proved why this exists: both
     * migrations applied, both postflights passed, both ledger rows were
     * recorded — and then the workflow's readback query died on
     * `name[] = text[]`, failing the run after everything real had
     * succeeded (run 32665300909). The workflow's exact query is executed
     * here against the replayed database, so a verifier that cannot parse
     * or that disagrees with the migrations fails at commit time instead
     * of after a production apply.
     */
    const workflow = await readFile(
      resolve(import.meta.dirname, "../../.github/workflows/apply-hosted-migrations.yml"),
      "utf8",
    );
    const scope = workflow.slice(workflow.indexOf("scope == 'discovery-stages'"));
    const match = scope.match(/VERIFIED=\$\(psql "\$DB_URL" -v ON_ERROR_STOP=1 -Atqc "\r?\n([\s\S]*?);"\)/);
    expect(match, "the discovery-stages readback query was not found in the workflow").not.toBeNull();

    const verdict = await db.query<{ verified: boolean }>(`${match![1]} as verified`);
    expect(verdict.rows[0].verified).toBe(true);
  });

  it("leaves no node with a known capability stage-less after the map extension", async () => {
    const orphaned = await db.query<{ count: number }>(`
      select count(*)::int as count from public.graph_nodes
       where lifecycle_stage is null
         and capability in (
           'qa', 'implementation', 'architecture', 'planning',
           'extraction', 'review', 'security_review', 'synthesis', 'reporting',
           'discovery', 'evaluation', 'decision'
         )`);
    expect(orphaned.rows[0].count).toBe(0);
  });
});
