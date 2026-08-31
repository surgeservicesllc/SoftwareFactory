// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(root, "supabase/migrations");

describe("Grok post-context hosted migration postflights", () => {
  let db: PGlite | undefined;

  async function loadThrough(targetVersion: string) {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        email text,
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
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations (
        version text primary key,
        statements text[]
      );
    `);

    for (const file of (await readdir(migrationsRoot))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .filter((name) => name.slice(0, 14) <= targetVersion)
      .sort()) {
      await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
      const version = file.match(/^(\d+)/)?.[1];
      if (version) {
        await db.query(
          "insert into supabase_migrations.schema_migrations(version) values ($1) on conflict do nothing",
          [version],
        );
      }
    }
  }

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it.each([
    [
      "20260831001500",
      ".github/grok-release/grok-claim-context-projection-postflight.sql",
    ],
    [
      "20260831001700",
      ".github/grok-release/grok-read-only-research-runtime-postflight.sql",
    ],
  ])("executes %s %s entirely inside its rollback", async (version, path) => {
    await loadThrough(version);
    const sql = (await readFile(resolve(root, path), "utf8"))
      .replace(/^\\set ON_ERROR_STOP on\r?\n/, "");
    await expect(db!.exec(sql)).resolves.toBeDefined();
    const residue = await db!.query<{ users: number; runs: number }>(`
      select
        (select count(*)::integer from auth.users
          where email like 'grok-claim-context-%@example.org'
             or email like 'grok-research-%@example.org') as users,
        (select count(*)::integer from public.graph_runs) as runs
    `);
    expect(residue.rows[0]).toEqual({ users: 0, runs: 0 });
  });
});
