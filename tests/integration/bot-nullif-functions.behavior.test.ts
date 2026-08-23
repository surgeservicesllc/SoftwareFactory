// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260823001000_node_detail_in_graph_runs.sql";

const ownerId = "00000000-0000-4000-8000-000000000701";
const organizationId = "10000000-0000-4000-8000-000000000701";

type BotRow = {
  base_url: string | null;
  id: string;
  last_checked_at: string | null;
  model: string;
  name: string;
  notes: string | null;
  readiness: string;
  readiness_detail: string | null;
};

async function assumeAuthenticated(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  await db.exec("set role authenticated");
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

describe("bot NULLIF function repair", () => {
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

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(migrationFiles.at(-1)).toBe(latestMigration);
    for (const migrationFile of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id, raw_user_meta_data)
      values ('${ownerId}', '{"full_name":"Bot Owner"}'::jsonb);

      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Bot Runtime Tenant', 'bot-runtime-tenant', '${ownerId}');
    `);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("leaves exactly the three repaired definitions valid, definer-scoped, and NULLIF-clean", async () => {
    const functions = await db.query<{
      definition: string;
      function_config: string;
      proname: string;
      prosecdef: boolean;
      proretset: boolean;
      result_type: string;
    }>(`
      select
        procedure.proname,
        pg_catalog.pg_get_functiondef(procedure.oid) as definition,
        coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), '') as function_config,
        procedure.prosecdef,
        procedure.proretset,
        pg_catalog.format_type(procedure.prorettype, null) as result_type
      from pg_catalog.pg_proc procedure
      where procedure.oid in (
        'public.register_bot(uuid,text,public.bot_provider,text,text,text,text)'::regprocedure,
        'public.update_bot(uuid,uuid,text,text,text,text,text)'::regprocedure,
        'public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)'::regprocedure
      )
      order by procedure.proname
    `);

    expect(functions.rows).toHaveLength(3);
    expect(functions.rows.map((row) => row.proname)).toEqual([
      "record_bot_readiness",
      "register_bot",
      "update_bot",
    ]);
    for (const functionRow of functions.rows) {
      expect(functionRow.definition.toLowerCase()).not.toContain("pg_catalog.nullif");
      expect(functionRow.definition).toMatch(/\bNULLIF\s*\(/i);
      expect(functionRow.function_config).toBe("search_path=pg_catalog");
      expect(functionRow.prosecdef).toBe(true);
      expect(functionRow.proretset).toBe(true);
      expect(functionRow.result_type).toBe("bots");
    }
  });

  it("keeps legacy registration narrow and readiness evidence service-only", async () => {
    const privileges = await db.query<{
      anon_execute: boolean;
      authenticated_execute: boolean;
      proname: string;
      service_role_execute: boolean;
    }>(`
      select
        procedure.proname,
        pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE') as anon_execute,
        pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as authenticated_execute,
        pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE') as service_role_execute
      from pg_catalog.pg_proc procedure
      where procedure.oid in (
        'public.register_bot(uuid,text,public.bot_provider,text,text,text,text)'::regprocedure,
        'public.update_bot(uuid,uuid,text,text,text,text,text)'::regprocedure,
        'public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)'::regprocedure,
        'public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)'::regprocedure
      )
      order by procedure.proname
    `);

    expect(privileges.rows).toEqual([
      {
        anon_execute: false,
        authenticated_execute: false,
        proname: "record_bot_readiness",
        service_role_execute: false,
      },
      {
        anon_execute: false,
        authenticated_execute: false,
        proname: "record_bot_readiness_preserving_disabled",
        service_role_execute: true,
      },
      {
        anon_execute: false,
        authenticated_execute: true,
        proname: "register_bot",
        service_role_execute: false,
      },
      {
        anon_execute: false,
        authenticated_execute: true,
        proname: "update_bot",
        service_role_execute: false,
      },
    ]);
  });

  it("executes register, update, and readiness calls with the original trim-to-null semantics", async () => {
    await assumeAuthenticated(db);
    try {
      const registered = await db.query<BotRow>(`
        select id, name, model, base_url, notes, readiness, readiness_detail, last_checked_at
        from public.register_bot(
          $1::uuid, $2::text, $3::public.bot_provider, $4::text,
          $5::text, $6::text, $7::text
        )
      `, [
        organizationId,
        "  Runtime Bot  ",
        "openai",
        "  gpt-5.3-codex  ",
        "  SOFTWAREFACTORY_OPENAI_API_KEY  ",
        "   ",
        "   ",
      ]);
      expect(registered.rows).toEqual([
        expect.objectContaining({
          base_url: null,
          model: "gpt-5.3-codex",
          name: "Runtime Bot",
          notes: null,
          readiness: "not_connected",
          readiness_detail: null,
        }),
      ]);
      const botId = registered.rows[0]?.id;
      expect(botId).toBeDefined();

      const updated = await db.query<BotRow>(`
        select id, name, model, base_url, notes, readiness, readiness_detail, last_checked_at
        from public.update_bot(
          $1::uuid, $2::uuid, $3::text, $4::text,
          $5::text, $6::text, $7::text
        )
      `, [
        organizationId,
        botId,
        "  Updated Runtime Bot  ",
        "  gpt-5.3-codex-mini  ",
        "SOFTWAREFACTORY_OPENAI_API_KEY",
        "  https://bots.example/runtime  ",
        "  Configuration reference only  ",
      ]);
      expect(updated.rows).toEqual([
        expect.objectContaining({
          base_url: "https://bots.example/runtime",
          id: botId,
          model: "gpt-5.3-codex-mini",
          name: "Updated Runtime Bot",
          notes: "Configuration reference only",
          readiness: "not_connected",
          readiness_detail: null,
        }),
      ]);

      await resetRole(db);
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
      const blankReadiness = await db.query<BotRow>(`
        select id, readiness, readiness_detail, last_checked_at
        from public.record_bot_readiness(
          $1::uuid, $2::uuid, $3::public.bot_readiness, $4::text
        )
      `, [organizationId, botId, "ready", "   "]);
      expect(blankReadiness.rows).toEqual([
        expect.objectContaining({
          id: botId,
          readiness: "ready",
          readiness_detail: null,
        }),
      ]);
      expect(blankReadiness.rows[0]?.last_checked_at).not.toBeNull();

      const detailedReadiness = await db.query<BotRow>(`
        select id, readiness, readiness_detail, last_checked_at
        from public.record_bot_readiness(
          $1::uuid, $2::uuid, $3::public.bot_readiness, $4::text
        )
      `, [organizationId, botId, "blocked", "  Provider session not verified  "]);
      expect(detailedReadiness.rows).toEqual([
        expect.objectContaining({
          id: botId,
          readiness: "blocked",
          readiness_detail: "Provider session not verified",
        }),
      ]);
    } finally {
      await resetRole(db);
    }

    const activity = await db.query<{ event_count: number; event_type: string }>(`
      select event_type::text, count(*)::integer as event_count
      from public.activity_events
      where organization_id = '${organizationId}'
        and event_type in (
          'bot.registered'::public.activity_event_type,
          'bot.updated'::public.activity_event_type,
          'bot.readiness_checked'::public.activity_event_type
        )
      group by event_type
      order by event_type::text
    `);
    expect(activity.rows).toEqual([
      { event_count: 2, event_type: "bot.readiness_checked" },
      { event_count: 1, event_type: "bot.registered" },
      { event_count: 1, event_type: "bot.updated" },
    ]);
  });
});
