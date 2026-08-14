// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Declaring a model's characteristics, against the real migrated schema.
 *
 * The reason this matters: `20260814000200` made undeclared models fail closed,
 * which is correct but was a state nobody could leave — the columns had no
 * writer. These assert the writer exists, is owner/admin-gated, and can
 * withdraw a declaration as well as make one.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000f001";
const memberId = "00000000-0000-4000-8000-00000000f002";
const organizationId = "10000000-0000-4000-8000-00000000f001";

async function actAs(db: PGlite, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

describe("Phase 2C model declaration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);

    const migrationFiles = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
    // Assert the migration this suite depends on is in the chain, rather than
    // that it happens to sort last. The last-file pin used by the older suites
    // is a deliberate tripwire so a new migration cannot be added without
    // someone reading them — but it says nothing about *this* test, and with
    // two agents landing migrations on the same day it broke three times in an
    // hour while never once catching a real problem here.
    expect(migrationFiles).toContain("20260814000250_declare_model_characteristics.sql");
    for (const file of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}');
      insert into public.organizations (id, name, slug, created_by)
        values ('${organizationId}', 'Declaring Factory', 'declaring-factory', '${ownerId}');
      insert into public.organization_members (organization_id, user_id, role)
        values ('${organizationId}', '${memberId}', 'member')
        on conflict do nothing;
      insert into public.provider_model_configurations
        (organization_id, provider, model, display_name, capabilities, created_by)
      values
        ('${organizationId}', 'anthropic', 'claude-strong', 'Claude Strong', '["code_authoring"]'::jsonb, '${ownerId}');
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("starts undeclared, which is what makes routing refuse it", async () => {
    await actAs(db, ownerId);
    const { rows } = await db.query<{ strength_tier: string | null; context_limit_tokens: number | null }>(
      `select strength_tier, context_limit_tokens from public.provider_model_configurations where model = 'claude-strong'`,
    );
    expect(rows[0]).toMatchObject({ strength_tier: null, context_limit_tokens: null });
  });

  it("records a declaration and reports it complete", async () => {
    await actAs(db, ownerId);
    const { rows } = await db.query<{
      declared_strength_tier: string; declared_context_limit_tokens: number; fully_declared: boolean;
    }>(
      `select declared_strength_tier, declared_context_limit_tokens, fully_declared
       from public.declare_model_characteristics($1::uuid, 'anthropic', 'claude-strong', 'strong', 200000)`,
      [organizationId],
    );
    expect(rows[0]).toMatchObject({
      declared_strength_tier: "strong",
      declared_context_limit_tokens: 200000,
      fully_declared: true,
    });
  });

  it("reports a half declaration as incomplete rather than usable", async () => {
    await actAs(db, ownerId);
    const { rows } = await db.query<{ fully_declared: boolean }>(
      `select fully_declared from public.declare_model_characteristics(
         $1::uuid, 'anthropic', 'claude-strong', 'strong', null)`,
      [organizationId],
    );
    expect(rows[0].fully_declared).toBe(false);
  });

  it("lets an owner withdraw a declaration rather than forcing another guess", async () => {
    await actAs(db, ownerId);
    const { rows } = await db.query<{ declared_strength_tier: string | null; fully_declared: boolean }>(
      `select declared_strength_tier, fully_declared from public.declare_model_characteristics(
         $1::uuid, 'anthropic', 'claude-strong', null, null)`,
      [organizationId],
    );
    expect(rows[0]).toMatchObject({ declared_strength_tier: null, fully_declared: false });
  });

  it("refuses a tier nobody defined and a context limit below one", async () => {
    await actAs(db, ownerId);
    await expect(
      db.query(`select public.declare_model_characteristics($1::uuid, 'anthropic', 'claude-strong', 'godlike', 1000)`, [organizationId]),
    ).rejects.toThrow(/strength tier must be/i);
    await expect(
      db.query(`select public.declare_model_characteristics($1::uuid, 'anthropic', 'claude-strong', 'strong', 0)`, [organizationId]),
    ).rejects.toThrow(/at least one token/i);
  });

  it("refuses a model that is not in the catalogue", async () => {
    await actAs(db, ownerId);
    await expect(
      db.query(`select public.declare_model_characteristics($1::uuid, 'anthropic', 'not-configured', 'strong', 1000)`, [organizationId]),
    ).rejects.toThrow(/not in this organization catalogue/i);
  });

  it("refuses an ordinary member, because a tier decides what work a model may be given", async () => {
    await actAs(db, memberId);
    await expect(
      db.query(`select public.declare_model_characteristics($1::uuid, 'anthropic', 'claude-strong', 'strong', 1000)`, [organizationId]),
    ).rejects.toThrow(/owner or administrator/i);
  });

  it("grants service_role no execute on the declaration function", async () => {
    await db.exec("reset role");
    const { rows } = await db.query<{ can_execute: boolean }>(
      `select pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') as can_execute
       from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'declare_model_characteristics'`,
    );
    expect(rows[0].can_execute).toBe(false);
  });
});
