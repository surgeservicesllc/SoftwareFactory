import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { functionsDefinedIn, migrationTables, tablesCreatedIn } from "@/lib/supabase/migration-tables";

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

  it("keeps only functions this audit's own role could see", () => {
    // The description the audit reads is filtered by EXECUTE privilege. Most
    // of these functions are granted to `authenticated` only -- deliberately,
    // since they re-derive the caller from auth.uid() -- so their absence from
    // a service-role view is the boundary working. Probing them reported three
    // healthy migrations as outstanding.
    const rows = migrationTables([
      {
        name: "20260101000000_two_functions.sql",
        sql: "create function public.mine() returns int language sql;\n"
          + "create function public.theirs() returns int language sql;\n"
          + "grant execute on function public.mine(int) to service_role;\n"
          + "grant execute on function public.theirs(int) to authenticated;",
      },
    ]);
    expect(rows[0].functions).toEqual(["mine"]);
  });

  it("accepts a grant written across several lines, and one made by a later migration", () => {
    const rows = migrationTables([
      { name: "a.sql", sql: "create function public.late() returns int language sql;" },
      { name: "b.sql", sql: "grant execute on function public.late(\n  uuid, text\n) to service_role;" },
    ]);
    expect(rows[0].functions).toEqual(["late"]);
  });

  it("reports a migration that creates nothing rather than dropping it", () => {
    const rows = migrationTables([{ name: "20260101000000_empty.sql", sql: "grant select on public.projects to authenticated;" }]);
    expect(rows).toEqual([{ migration: "20260101000000_empty", tables: [], functions: [] }]);
  });
});

describe("reading what a migration defines", () => {
  it("finds a function with or without replace and schema", () => {
    expect(functionsDefinedIn("create function public.f() returns int language sql")).toEqual(["f"]);
    expect(functionsDefinedIn("CREATE OR REPLACE FUNCTION claim_planned_graph(p text) returns json language plpgsql")).toEqual(["claim_planned_graph"]);
  });

  it("leaves out trigger functions, which PostgREST can never list", () => {
    // Including them turned thirty fully-applied migrations into PARTLY
    // VISIBLE on the probe's first run. A report whose alarms are mostly false
    // teaches its reader to skim past the real ones.
    expect(functionsDefinedIn("create function public.guard() returns trigger language plpgsql")).toEqual([]);
    expect(functionsDefinedIn("create function public.guard()\n  returns TRIGGER\n  language plpgsql")).toEqual([]);
  });

  it("ignores a function quoted in a comment", () => {
    expect(functionsDefinedIn("-- create function public.never() returns int language sql")).toEqual([]);
  });

  it("names a function once however many times the migration replaces it", () => {
    const sql = "create or replace function public.f() returns int language sql;\n"
      + "create or replace function public.f() returns int language sql;";
    expect(functionsDefinedIn(sql)).toEqual(["f"]);
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

  it("finds the functions the executed lanes call", () => {
    const functions = new Set(migrationTables(files).flatMap((row) => row.functions));
    // The graph drain called each of these against hosted on 2026-08-19, and
    // all three are granted to service_role, so the audit can ask about them.
    for (const name of ["claim_planned_graph", "record_node_state_as_worker", "complete_graph_run_as_worker"]) {
      expect(functions, `${name} is not defined by any migration`).toContain(name);
    }
  });

  it("finds the tables the graph and resource lanes depend on", () => {
    const tables = new Set(migrationTables(files).flatMap((row) => row.tables));
    for (const table of ["graphs", "graph_runs", "node_runs", "resource_reservations", "resource_breakers", "projects"]) {
      expect(tables, `${table} is not created by any migration`).toContain(table);
    }
  });
});
