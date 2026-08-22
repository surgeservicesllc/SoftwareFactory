// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

/**
 * 20260822001300 restores claim_provider_connect_session to the exact
 * 20260814002500 contract.
 *
 * Hosted holds an earlier draft of the function, applied out of ledger before
 * the file took its final shape: the RETURNS TABLE columns are the unprefixed
 * `organization_id, purpose` and the ACL carries the owner alone. Probe run
 * 32591774367 measured that state as contract md5
 * a7ca5a02b1faa50ebba452c4a4f46195 against the expected
 * 8992610aa5f3749a013a3bdf9f7d4fef — the one row of sixteen that blocked the
 * protected factory-any-model-record-only chain's pre-repair gate.
 *
 * The local migration chain never exhibits the drift, so a test that only
 * replays the chain would pass without exercising the repair at all. The
 * drifted case therefore reproduces the hosted state first and proves the
 * reproduction is exact by matching the probed md5, the same way the
 * job-seeker grant-contract test reproduces the hosted default grants.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const repairMigration = "20260822001300_restore_provider_claim_signature.sql";
const vaultMigration = "20260814002500_provider_credential_vault.sql";

// The five files the protected factory-any-model-record-only chain owns. The
// hosted pre-repair state this repair must produce is the chain WITHOUT them,
// which is also why they are excluded here rather than for convenience.
const protectedChain = new Set([
  "20260822000300_contract_bot_mutator_acls.sql",
  "20260822000900_repair_hosted_plpgsql_catalog_and_lint.sql",
  "20260822001000_factory_any_model_record_only.sql",
  "20260822001100_contract_resume_extraction_function_acl.sql",
  "20260822001200_contract_clear_function_acls.sql",
]);

const driftedContractMd5 = "a7ca5a02b1faa50ebba452c4a4f46195";
const expectedContractMd5 = "8992610aa5f3749a013a3bdf9f7d4fef";
const expectedSourceMd5 = "9961e16bbe95da08903caac340633bca";
// 20260822000900 rewrites the function as part of the frozen lint repair; a
// full replay reaches 20260822001300 with this body, which the repair must
// leave exactly alone.
const postRepairSourceMd5 = "aa271ab3d2be6c5f2ce7182670e48099";

const contractQuery = `
  select
    md5(replace(replace(p.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as source_md5,
    md5(jsonb_build_array(
      n.nspname, l.lanname, pg_get_userbyid(p.proowner), p.prokind::text,
      format_type(p.prorettype, null), p.proretset, p.pronargs, p.pronargdefaults,
      coalesce(array_to_string(p.proargnames, ','), ''),
      coalesce(array_to_string(p.proargmodes, ','), ''),
      coalesce((select string_agg(format_type(t.type_oid, null), ',' order by t.ordinality)
        from unnest(p.proallargtypes) with ordinality t(type_oid, ordinality)), ''),
      coalesce(pg_get_expr(p.proargdefaults, 0), ''),
      p.proisstrict, p.proleakproof, p.prosecdef, p.proparallel::text,
      p.provariadic = 0, p.procost::text, p.prorows::text, p.prosupport = 0,
      p.probin is null, p.prosqlbody is null, p.protrftypes is null,
      p.proconfig, p.proacl is null
    )::text) as contract_md5,
    p.proacl::text as proacl,
    array_to_string(p.proargnames, ',') as argnames,
    pg_catalog.has_function_privilege(
      'service_role', p.oid, 'EXECUTE') as service_role_execute,
    pg_catalog.has_function_privilege(
      'anon', p.oid, 'EXECUTE') as anon_execute,
    pg_catalog.has_function_privilege(
      'authenticated', p.oid, 'EXECUTE') as authenticated_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where p.oid = to_regprocedure('public.claim_provider_connect_session(text,text)')
`;

type ContractRow = {
  anon_execute: boolean;
  argnames: string;
  authenticated_execute: boolean;
  contract_md5: string;
  proacl: string;
  service_role_execute: boolean;
  source_md5: string;
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

/**
 * Reproduce the hosted draft: same body, unprefixed result columns, owner-only
 * ACL. Splices the real CREATE from 20260814002500 so a future edit to that
 * file keeps this reproduction honest instead of silently diverging.
 */
async function reproduceHostedDraft(db: PGlite) {
  const vault = await readFile(resolve(migrationsDirectory, vaultMigration), "utf8");
  const start = vault.indexOf(
    "create or replace function public.claim_provider_connect_session(",
  );
  expect(start).toBeGreaterThan(-1);
  const end = vault.indexOf("$function$;", start) + "$function$;".length;
  const createBlock = vault
    .slice(start, end)
    .replace(
      "returns table (claimed_organization_id uuid, claimed_purpose text)",
      "returns table (organization_id uuid, purpose text)",
    );
  await db.exec("drop function public.claim_provider_connect_session(text, text);");
  await db.exec(createBlock);
  await db.exec(`
    revoke all on function public.claim_provider_connect_session(text, text)
      from public, anon, authenticated, service_role;
  `);
}

async function contractRow(db: PGlite): Promise<ContractRow> {
  const result = await db.query<ContractRow>(contractQuery);
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}

function expectRepairedState(row: ContractRow) {
  expect(row.source_md5).toBe(expectedSourceMd5);
  expect(row.contract_md5).toBe(expectedContractMd5);
  expect(row.argnames).toBe(
    "p_code_digest,p_sealed_envelope,claimed_organization_id,claimed_purpose",
  );
  expect(row.proacl).toBe("{postgres=X/postgres,service_role=X/postgres}");
  expect(row.service_role_execute).toBe(true);
  expect(row.anon_execute).toBe(false);
  expect(row.authenticated_execute).toBe(false);
}

describe("20260822001300 provider claim signature repair", () => {
  it("is a no-op on the already-correct local chain", async () => {
    const db = await freshDb();
    try {
      await applyChain(db, (file) => protectedChain.has(file));
      expectRepairedState(await contractRow(db));
    } finally {
      await db.close();
    }
  }, 240_000);

  it("repairs the exact hosted draft the probe measured", async () => {
    const db = await freshDb();
    try {
      await applyChain(
        db,
        (file) => protectedChain.has(file) || file === repairMigration,
      );
      await reproduceHostedDraft(db);

      // The reproduction must BE the hosted state, not an approximation of
      // it: the contract md5 here is the value probe run 32591774367 printed
      // for production. If this line fails, the reproduction drifted and
      // nothing below it says anything about the hosted database.
      const drifted = await contractRow(db);
      expect(drifted.contract_md5).toBe(driftedContractMd5);
      expect(drifted.source_md5).toBe(expectedSourceMd5);
      expect(drifted.proacl).toBe("{postgres=X/postgres}");
      expect(drifted.argnames).toBe(
        "p_code_digest,p_sealed_envelope,organization_id,purpose",
      );

      await db.exec(
        await readFile(resolve(migrationsDirectory, repairMigration), "utf8"),
      );
      expectRepairedState(await contractRow(db));
    } finally {
      await db.close();
    }
  }, 240_000);

  it("leaves the post-20260822000900 body untouched on a full-chain replay", async () => {
    const db = await freshDb();
    try {
      // No skips at all: the protected five run in order, 20260822000900
      // rewrites the function, and 20260822001300 arrives last. Rewriting the
      // body back to the 20260814002500 source here would silently regress
      // the lint repair, which is exactly what this case exists to catch.
      await applyChain(db, () => false);
      const row = await contractRow(db);
      expect(row.source_md5).toBe(postRepairSourceMd5);
      expect(row.contract_md5).toBe(expectedContractMd5);
      expect(row.proacl).toBe("{postgres=X/postgres,service_role=X/postgres}");
    } finally {
      await db.close();
    }
  }, 240_000);

  it("refuses a function whose body is not the known 20260814002500 body", async () => {
    const db = await freshDb();
    try {
      await applyChain(
        db,
        (file) => protectedChain.has(file) || file === repairMigration,
      );
      await db.exec(`
        create or replace function public.claim_provider_connect_session(
          p_code_digest text, p_sealed_envelope text
        ) returns table (claimed_organization_id uuid, claimed_purpose text)
        language plpgsql volatile security definer set search_path = pg_catalog
        as $tampered$ begin return; end; $tampered$;
      `);
      await expect(
        db.exec(
          await readFile(resolve(migrationsDirectory, repairMigration), "utf8"),
        ),
      ).rejects.toThrow(/neither the known draft nor the current definition/);
    } finally {
      await db.close();
    }
  }, 240_000);
});
