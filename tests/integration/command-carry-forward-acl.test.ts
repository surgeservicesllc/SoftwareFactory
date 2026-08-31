// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

/**
 * 20260822001500 converges the command-submission functions to the exact
 * owner-plus-authenticated ACL the protected 20260822001000 chain requires
 * of submit_command.
 *
 * Hosted applies 20260815001000 late (scope=command-carry-forward), and
 * hosted Supabase default privileges have repeatedly attached direct
 * EXECUTE grants that no local replay reproduces. The drift case therefore
 * reproduces the default grants by hand, the same way the other
 * grant-contract tests do.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const contractMigration = "20260822001500_contract_command_submission_acls.sql";

const protectedChain = new Set([
  "20260822000300_contract_bot_mutator_acls.sql",
  "20260822000850_normalize_hosted_pre_repair_function_acls.sql",
  "20260822000900_repair_hosted_plpgsql_catalog_and_lint.sql",
  "20260822001000_factory_any_model_record_only.sql",
  "20260822001100_contract_resume_extraction_function_acl.sql",
  "20260822001200_contract_clear_function_acls.sql",
  "20260831000900_grok_claim_admission_fence.sql",
  "20260831001000_grok_specialist_admission_planning.sql",
  "20260831001500_grok_claim_context_projection.sql",
  "20260831001600_grok_phase1c_graph_rewake.sql",
  "20260831001700_grok_read_only_research_runtime.sql",
  "20260831001800_grok_deploy_readiness_runtime.sql",
  "20260831001900_grok_admission_version_null_fence.sql",
]);

const signatures = [
  "public.submit_command(uuid,text,public.risk_level,jsonb,text)",
  "public.declare_cross_project_dependency(uuid,uuid,text)",
  "public.release_cross_project_dependency(uuid,uuid,text)",
];

const postureQuery = `
  select expected.signature,
         p.proacl::text as proacl,
         (select count(*) from aclexplode(p.proacl)) as acl_entries,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
         has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
  from (values
    ('public.submit_command(uuid,text,public.risk_level,jsonb,text)'),
    ('public.declare_cross_project_dependency(uuid,uuid,text)'),
    ('public.release_cross_project_dependency(uuid,uuid,text)')
  ) expected(signature)
  join pg_proc p on p.oid = to_regprocedure(expected.signature)
  order by expected.signature
`;

type PostureRow = {
  acl_entries: number;
  anon_execute: boolean;
  authenticated_execute: boolean;
  proacl: string;
  service_role_execute: boolean;
  signature: string;
};

async function freshDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
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
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb,
        '{}'::jsonb
      )
    $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  `);
  return db;
}

async function applyChain(db: PGlite, skip: (file: string) => boolean) {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  for (const file of files) {
    if (skip(file)) continue;
    await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
  }
}

async function posture(db: PGlite): Promise<PostureRow[]> {
  const result = await db.query<PostureRow>(postureQuery);
  expect(result.rows).toHaveLength(3);
  return result.rows;
}

function expectContracted(rows: PostureRow[]) {
  for (const row of rows) {
    expect(row.acl_entries).toBe(2);
    expect(row.proacl).toBe("{postgres=X/postgres,authenticated=X/postgres}");
    expect(row.authenticated_execute).toBe(true);
    expect(row.anon_execute).toBe(false);
    expect(row.service_role_execute).toBe(false);
  }
}

describe("20260822001500 command submission ACL contract", () => {
  it("is a no-op on the already-clean replay without the protected chain", async () => {
    const db = await freshDb();
    try {
      await applyChain(db, (file) => protectedChain.has(file));
      expectContracted(await posture(db));
    } finally {
      await db.close();
    }
  }, 240_000);

  it("removes reproduced hosted default grants from all three functions", async () => {
    const db = await freshDb();
    try {
      await applyChain(
        db,
        (file) => protectedChain.has(file) || file === contractMigration,
      );
      for (const signature of signatures) {
        await db.exec(`grant execute on function ${signature} to service_role;`);
        await db.exec(`grant execute on function ${signature} to anon;`);
      }
      const drifted = await posture(db);
      expect(drifted.every((row) => row.service_role_execute)).toBe(true);

      await db.exec(
        await readFile(resolve(migrationsDirectory, contractMigration), "utf8"),
      );
      expectContracted(await posture(db));
    } finally {
      await db.close();
    }
  }, 240_000);

  it("refuses an ACL entry for a role outside the known hosted set", async () => {
    const db = await freshDb();
    try {
      await applyChain(
        db,
        (file) => protectedChain.has(file) || file === contractMigration,
      );
      await db.exec("create role intruder nologin;");
      await db.exec(`grant execute on function ${signatures[0]} to intruder;`);
      await expect(
        db.exec(
          await readFile(resolve(migrationsDirectory, contractMigration), "utf8"),
        ),
      ).rejects.toThrow(/unknown ACL shape/);
    } finally {
      await db.close();
    }
  }, 240_000);

  it("stays exact on a full replay including the protected chain", async () => {
    const db = await freshDb();
    try {
      await applyChain(db, () => false);
      expectContracted(await posture(db));
    } finally {
      await db.close();
    }
  }, 240_000);
});
