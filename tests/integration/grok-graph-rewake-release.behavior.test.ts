// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migrations = resolve(root, "supabase/migrations");

describe("Grok graph re-wake protected release SQL", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create function auth.uid() returns uuid language sql stable as
        $$ select null::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as
        $$ select '{}'::jsonb $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);
    for (const file of (await readdir(migrations))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort()) {
      await db.exec(await readFile(resolve(migrations, file), "utf8"));
    }
    await db.exec(`
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations (
        version text primary key
      );
      insert into supabase_migrations.schema_migrations(version)
      values ('20260831001600');
    `);
  }, 180_000);

  afterAll(async () => db?.close());

  it("executes the installed catalog and fail-closed runtime postflight under rollback", async () => {
    const postflight = (await readFile(resolve(
      root,
      ".github/grok-release/grok-graph-rewake-postflight.sql",
    ), "utf8")).replace(/^\\set .*$/gm, "");

    await expect(db.exec(postflight)).resolves.toBeDefined();
    const state = await db.query<{
      attempts: number; intents: number; ledger: number;
    }>(`
      select
        (select count(*)::integer from public.grok_graph_rewake_attempts) attempts,
        (select count(*)::integer from public.grok_graph_rewake_intents) intents,
        (select count(*)::integer from supabase_migrations.schema_migrations
          where version='20260831001600') ledger
    `);
    expect(state.rows).toEqual([{ attempts: 0, intents: 0, ledger: 1 }]);
  });
});
