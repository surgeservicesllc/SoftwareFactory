// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Two migrations must not create the same database object.
 *
 * `migration-versions.contract.test.ts` already guarantees one migration per
 * ledger version. That is a different problem from this one, and solving it does
 * not help here: two files can hold perfectly distinct versions and still both
 * try to create `public.work_locks`.
 *
 * That happened. Merging `main` into the Phase 2B branch brought a
 * `20260814001200_phase2b_task_graph_and_handoffs.sql` whose `work_locks` is a
 * path-prefix lock for specialist agents, alongside this branch's
 * `graph_engineering.sql` whose `work_locks` was a resource lease for the graph
 * scheduler. Same name, different columns, different purpose, written by two
 * agents who never saw each other's file. Git merged both cleanly because
 * nothing textually conflicted.
 *
 * Two failure modes came out of it, and the quiet one is worse:
 *
 * 1. **The table collided loudly.** The second `create table` failed with
 *    `relation "work_locks" already exists`, which at least stops the apply —
 *    but it surfaces as a wasm stack trace from whichever behavioural suite runs
 *    first, naming no migration and suggesting no fix.
 * 2. **The functions collided silently.** Both files defined
 *    `release_work_lock(uuid)` with `create or replace`. Same name, same
 *    argument list, entirely different bodies. Postgres replaced one with the
 *    other without a word, and the losing subsystem's locks would simply never
 *    be released — a defect with no error, no failing test, and no symptom until
 *    something wedged in production.
 *
 * One thing it deliberately does not flag: a later migration that *rebuilds* an
 * object it drops first. That is one author acting in full knowledge of the
 * other, which is the opposite of the accident above, and the allowances below
 * name the exact file pairs rather than the object — so a third file creating
 * the same name is still the accident this test is for.
 *
 * So this file checks the two things separately, because they need different
 * instruments. Tables and types are caught statically from the files, which is
 * fast and can name the exact pair. The silent function case cannot be caught
 * that way — 41 functions in this repository are legitimately redefined by a
 * later migration, so "defined twice" is a normal idiom here and flagging it
 * would be noise. It is caught instead against the applied schema, by asserting
 * no `public` function name resolves to more than one implementation.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const FORWARD_REPAIR_TABLES = new Set([
  "agentos_environments",
  "agentos_mcp_connections",
  "agentos_skills",
  "agentos_agent_grants",
  "agentos_agent_mcp_grants",
  "agentos_agent_skill_grants",
  "agentos_agent_repo_grants",
  "agentos_agent_filesystem_grants",
  "agentos_agent_collaborators",
]);

async function migrationFiles(): Promise<string[]> {
  return (await readdir(migrationsDirectory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
}

/** Collect `create <keyword> [if not exists] [public.]<name>` per migration. */
async function creationsByName(keyword: "table" | "type"): Promise<Map<string, string[]>> {
  const pattern = new RegExp(
    String.raw`^\s*create\s+${keyword}\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)`,
    "gim",
  );

  const byName = new Map<string, string[]>();
  for (const file of await migrationFiles()) {
    const sql = await readFile(resolve(migrationsDirectory, file), "utf8");
    for (const match of sql.matchAll(pattern)) {
      const name = match[1];
      const seen = byName.get(name) ?? [];
      // A migration that creates the same name twice is its own error and would
      // fail on apply; this test is about collisions *between* migrations.
      if (!seen.includes(file)) byName.set(name, [...seen, file]);
    }
  }
  return byName;
}

/**
 * Types a later migration deliberately rebuilds, and the exact pair allowed to.
 *
 * The failure this file exists to catch is two authors independently creating
 * the same name, where the second apply dies with `already exists` and takes
 * the chain with it. A *rebuild* is the opposite: one file, written in full
 * knowledge of the other, that drops the type before creating it.
 *
 * `sdlc_stage` is rebuilt rather than altered because renaming could not carry
 * the change — `PRD` had to merge into `REQUIREMENT`, and a merge is not a
 * rename. The rebuild sits inside a DO block that returns early when the type
 * already holds `REQUIREMENT`, so a replay is a no-op rather than a second
 * drop, and `hosted-scope-replay.behavior.test.ts` runs that replay against
 * real PostgreSQL to prove it.
 *
 * Named as an exact pair, not as a name: a third migration creating
 * `sdlc_stage` would be the accident this test is for, and would still fail.
 */
const FORWARD_REBUILT_TYPES: ReadonlyMap<string, string> = new Map([
  ["sdlc_stage", [
    "20260821000200_agentic_sdlc_lifecycle.sql",
    "20260823000200_ten_stage_lifecycle.sql",
  ].join("|")],
]);

function collisionsIn(byName: Map<string, string[]>): string[] {
  return [...byName.entries()]
    .filter(([name, files]) => {
      if (files.length <= 1) return false;
      if (FORWARD_REPAIR_TABLES.has(name)
        && files.join("|") === [
          "20260814000300_agentos_isolation_model.sql",
          "20260822000900_repair_hosted_plpgsql_catalog_and_lint.sql",
        ].join("|")) {
        return false;
      }
      return FORWARD_REBUILT_TYPES.get(name) !== files.join("|");
    })
    .map(([name, files]) => `${name}: ${files.join(" and ")}`);
}

describe("migration object collisions", () => {
  it("never creates the same table in two migrations", async () => {
    const collisions = collisionsIn(await creationsByName("table"));

    expect(
      collisions,
      collisions.length > 0
        ? "Two migrations create the same table. The later one fails to apply with " +
          '`relation "…" already exists`, which halts the whole chain. Rename the ' +
          "table in whichever migration has NOT reached hosted, along with its " +
          "indexes, constraints, policies and functions.\n  " +
          collisions.join("\n  ")
        : undefined,
    ).toEqual([]);
  });

  it("never creates the same type in two migrations", async () => {
    const collisions = collisionsIn(await creationsByName("type"));

    expect(
      collisions,
      collisions.length > 0
        ? "Two migrations create the same type. Rename the one that has NOT reached " +
          "hosted.\n  " + collisions.join("\n  ")
        : undefined,
    ).toEqual([]);
  });
});

describe("applied schema", () => {
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

    for (const file of await migrationFiles()) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }
  }, 300_000);

  afterAll(async () => {
    await db?.close();
  });

  it("leaves no overloaded function in the public schema", async () => {
    const { rows } = await db.query<{ proname: string; n: number }>(
      `select proname, count(*)::int as n
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
        group by proname having count(*) > 1
        order by proname`,
    );

    // Two implementations behind one name is a hazard here beyond the accident
    // that produces it: PostgREST routes `/rpc/<name>` by name, so an overload
    // makes which implementation runs depend on how the arguments happen to be
    // coerced. Every function in this schema is called that way.
    //
    // If you are adding a deliberate overload, this assertion is the place to
    // argue for it — and the argument has to address the routing above.
    expect(
      rows.map((row) => `${row.proname} (${row.n} implementations)`),
      rows.length > 0
        ? "A public function name resolves to more than one implementation. If two " +
          "migrations defined the same name for different purposes, the second " +
          "`create or replace` silently replaced the first only when the argument " +
          "lists matched exactly — otherwise both survive as overloads. Rename the " +
          "one that has NOT reached hosted."
        : undefined,
    ).toEqual([]);
  });
});
