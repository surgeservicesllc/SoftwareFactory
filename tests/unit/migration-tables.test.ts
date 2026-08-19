import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { migrationTables, tablesCreatedIn } from "@/lib/supabase/migration-tables";

const MIGRATIONS = resolve(import.meta.dirname, "../../supabase/migrations");

describe("reading what a migration creates", () => {
  it("finds a table with or without the guard and the schema", () => {
    expect(tablesCreatedIn("create table public.graphs (id uuid);")).toEqual(["graphs"]);
    expect(tablesCreatedIn("CREATE TABLE IF NOT EXISTS graph_runs (id uuid);")).toEqual(["graph_runs"]);
    expect(tablesCreatedIn('create table "public"."node_runs" (id uuid);')).toEqual(["node_runs"]);
  });

  it("ignores DDL that only appears in a comment", () => {
    // These migrations routinely quote a statement to explain why it is not
    // being run. Probing for a table nobody created reports a permanent
    // outstanding migration that no apply can ever clear.
    expect(tablesCreatedIn("-- create table public.never_made (id uuid);\nselect 1;")).toEqual([]);
    expect(tablesCreatedIn("/* create table public.never_made (id uuid); */")).toEqual([]);
  });

  it("keeps only public tables, because nothing else is reachable over REST", () => {
    expect(tablesCreatedIn("create table supabase_migrations.schema_migrations (version text);")).toEqual([]);
  });

  it("reports a migration that creates nothing rather than dropping it", () => {
    const rows = migrationTables([{ name: "20260101000000_functions_only.sql", sql: "create function f() returns int language sql as $$ select 1 $$;" }]);
    expect(rows).toEqual([{ migration: "20260101000000_functions_only", tables: [] }]);
  });
});

describe("against the real migration directory", () => {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), "utf8") }));

  it("covers every migration on disk, not a list written by hand", () => {
    // The audit's frozen list knew four of these. The count is asserted against
    // the directory itself so it cannot fall behind again.
    expect(migrationTables(files)).toHaveLength(files.length);
  });

  it("finds the tables the graph and resource lanes depend on", () => {
    const tables = new Set(migrationTables(files).flatMap((row) => row.tables));
    for (const table of ["graphs", "graph_runs", "node_runs", "resource_reservations", "resource_breakers", "projects"]) {
      expect(tables, `${table} is not created by any migration`).toContain(table);
    }
  });
});
