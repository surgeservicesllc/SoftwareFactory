// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

/**
 * 20260822001400 clears a partially applied AgentOS isolation foundation.
 *
 * Hosted records 20260814000300 as applied while only a fragment of its
 * objects exist — protected-chain run 32600709789 stopped at 20260822000900's
 * first guard with "expected 0 or 32 named objects; found 4". The repair can
 * only restore from a proven-absent state, so the fragment has to go first.
 * Locally the foundation is always complete, so a plain replay would never
 * exercise the cleanup; the partial case reproduces a fragment by hand.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const cleanupMigration = "20260822001400_clear_partial_agentos_foundation.sql";

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
]);

const rosterTablesChildFirst = [
  "agentos_agent_collaborators", "agentos_agent_filesystem_grants",
  "agentos_agent_repo_grants", "agentos_agent_skill_grants",
  "agentos_agent_mcp_grants", "agentos_agent_grants",
  "agentos_skills", "agentos_mcp_connections", "agentos_environments",
];

const censusQuery = `
  select
    (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typname in ('agentos_network_mode', 'agentos_skill_kind', 'agentos_repo_permission'))::int
    + (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and c.relname in (
            'agentos_environments', 'agentos_mcp_connections', 'agentos_skills',
            'agentos_agent_grants', 'agentos_agent_mcp_grants',
            'agentos_agent_skill_grants', 'agentos_agent_repo_grants',
            'agentos_agent_filesystem_grants', 'agentos_agent_collaborators'))::int
    + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('agentos_hosts_are_bare_hostnames', 'agentos_resolved_agent_grants'))::int
    as named_objects
`;

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
 * Reproduce the hosted fragment: drop the tables (children first, plain DROP
 * TABLE, which also removes their indexes and policies) and one helper,
 * leaving the three enums and the other helper — a strict subset, like the
 * four objects hosted holds.
 */
async function reproduceFragment(db: PGlite) {
  for (const table of rosterTablesChildFirst) {
    await db.exec(`drop table public.${table};`);
  }
  await db.exec("drop function public.agentos_resolved_agent_grants(uuid);");
}

async function census(db: PGlite): Promise<number> {
  const result = await db.query<{ named_objects: number }>(censusQuery);
  return result.rows[0].named_objects;
}

describe("20260822001400 partial AgentOS foundation cleanup", () => {
  it("leaves a complete foundation alone on the ordinary replay", async () => {
    const db = await freshDb();
    try {
      await applyChain(db, (file) => protectedChain.has(file));
      // 3 enums + 9 tables + 2 helpers = 14 in this reduced census.
      expect(await census(db)).toBe(14);
    } finally {
      await db.close();
    }
  }, 240_000);

  it("clears a reproduced fragment down to the proven-absent state", async () => {
    const db = await freshDb();
    try {
      await applyChain(
        db,
        (file) => protectedChain.has(file) || file === cleanupMigration,
      );
      await reproduceFragment(db);
      expect(await census(db)).toBe(4); // three enums and one helper, like hosted

      await db.exec(
        await readFile(resolve(migrationsDirectory, cleanupMigration), "utf8"),
      );
      expect(await census(db)).toBe(0);
    } finally {
      await db.close();
    }
  }, 240_000);

  it("refuses to drop a remnant table that holds rows", async () => {
    const db = await freshDb();
    try {
      await applyChain(
        db,
        (file) => protectedChain.has(file) || file === cleanupMigration,
      );
      // A partial state where a surviving table has data: drop only the
      // leaf tables, then seed the survivor through its owning role.
      for (const table of rosterTablesChildFirst.slice(0, 6)) {
        await db.exec(`drop table public.${table};`);
      }
      await db.exec(`
        insert into public.organizations (id, name, slug, created_by)
        select '10000000-0000-4000-8000-00000000ae01', 'AgentOS Tenant', 'agentos-tenant', users.id
        from (select id from auth.users limit 1) users;
      `);
      await db.exec(`
        insert into auth.users (id) values ('00000000-0000-4000-8000-00000000ae02')
        on conflict do nothing;
      `);
      await db.exec(`
        insert into public.organizations (id, name, slug, created_by) values
          ('10000000-0000-4000-8000-00000000ae03', 'AgentOS Tenant B', 'agentos-tenant-b',
           '00000000-0000-4000-8000-00000000ae02')
        on conflict do nothing;
      `);
      await db.exec(`
        insert into public.agentos_environments (organization_id, name, networking, created_by)
        values ('10000000-0000-4000-8000-00000000ae03', 'remnant-env', 'limited',
                '00000000-0000-4000-8000-00000000ae02');
      `);
      await expect(
        db.exec(
          await readFile(resolve(migrationsDirectory, cleanupMigration), "utf8"),
        ),
      ).rejects.toThrow(/holds rows; refusing to drop it/);
    } finally {
      await db.close();
    }
  }, 240_000);

  it("stays a no-op on a full replay including the protected chain", async () => {
    const db = await freshDb();
    try {
      await applyChain(db, () => false);
      expect(await census(db)).toBe(14);
    } finally {
      await db.close();
    }
  }, 240_000);
});
