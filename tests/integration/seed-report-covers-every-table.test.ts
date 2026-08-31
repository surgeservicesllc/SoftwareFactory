// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LATEST_MIGRATION } from "../support/latest-migration";
import {
  DELIBERATELY_UNSEEDED,
  SEED_SPEC_TABLES,
} from "@/lib/services/seed-validation";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

/**
 * The seed report's roster is hand-written, and a hand-written roster stops
 * covering the schema the moment somebody adds a table.
 *
 * That already happened: three CRM tables shipped between increments 17 and
 * 21 without entering the roster, and the report went on saying "48/48
 * tables passing" — complete only relative to a list that had quietly
 * fallen behind. A green that means less than it looks like is worse than a
 * red, because nobody investigates it.
 *
 * So the roster is now compared against the tables the migrations actually
 * create. A new crm_ table has to be seeded or explicitly recorded as not
 * worth seeding, with a reason. There is no third option, and in
 * particular there is no silence.
 */

describe("the seed report covers every table the schema has", { timeout: 240_000 }, () => {
  let db: PGlite;
  let crmTables: string[] = [];

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        email text,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      grant usage on schema auth to anon, authenticated, service_role;
    `);

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(migrationFiles.at(-1)).toBe(LATEST_MIGRATION);
    for (const file of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    const rows = await db.query<{ table_name: string }>(
      `select c.relname as table_name
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'crm\\_%'
        order by c.relname`,
    );
    crmTables = rows.rows.map((row) => row.table_name);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("finds every crm table either audited or recorded as deliberately unseeded", () => {
    const audited = new Set(SEED_SPEC_TABLES);
    const excused = new Set(Object.keys(DELIBERATELY_UNSEEDED));

    const uncovered = crmTables.filter((table) => !audited.has(table) && !excused.has(table));

    expect(
      uncovered,
      `these crm tables are neither seeded nor recorded as deliberately unseeded, so the `
        + `report's "all tables passing" would be complete only relative to a stale list: `
        + uncovered.join(", "),
    ).toEqual([]);
  });

  it("keeps the roster honest in the other direction too", () => {
    // A spec for a table that no longer exists audits nothing and reads as
    // a passing row, which is the same lie from the opposite side.
    const existing = new Set(crmTables);
    const phantom = SEED_SPEC_TABLES.filter(
      (table) => table.startsWith("crm_") && !existing.has(table),
    );

    expect(phantom, `these specs name tables the schema does not have: ${phantom.join(", ")}`)
      .toEqual([]);
  });

  it("requires a real reason beside every excused table", () => {
    for (const [table, reason] of Object.entries(DELIBERATELY_UNSEEDED)) {
      expect(crmTables, `${table} is excused but does not exist`).toContain(table);
      // A reason has to say something about the table's nature. A word or
      // two ("operational", "n/a") is how this list becomes a place to hide
      // work rather than a record of a decision.
      expect(reason.length, `${table}'s reason is too short to be a reason`).toBeGreaterThan(60);
    }
  });
});
