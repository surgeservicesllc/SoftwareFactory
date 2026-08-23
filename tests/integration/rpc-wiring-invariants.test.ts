// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The application-to-schema direction of the wiring, which nothing else guards.
 *
 * `schema-security-invariants` asks whether the schema is safe. This asks
 * whether the application can actually reach it. They are different failures:
 * a perfectly secured function that no caller may execute, and a route calling
 * a function that does not exist, both pass every other suite in this
 * repository and both break at runtime rather than at build time.
 *
 * Neither failure is hypothetical. A migration can rename a function, or revoke
 * a grant to tighten a boundary, without touching the route that calls it —
 * TypeScript cannot see across that seam, because an RPC name is a string. The
 * first symptom is a production `404` or `403` on a real user action.
 *
 * So this reads the RPC names out of the source, applies every migration, and
 * asks the catalogue whether each one exists and is executable by at least one
 * role the application actually authenticates as.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const sourceDirectories = ["app", "lib", "scripts"] as const;

/** Roles a Supabase client in this application can authenticate as. */
const APPLICATION_ROLES = ["anon", "authenticated", "service_role"] as const;

/**
 * `.rpc("name")` is the only way this application invokes a database function,
 * so the literal is the contract. A dynamic name would be invisible here — that
 * is a reason not to write one, not a reason to weaken this check.
 */
const RPC_CALL_PATTERN = /\.rpc\(\s*"([a-z][a-z0-9_]*)"/g;

/**
 * Rolling deploy compatibility calls remain in the candidate application so
 * it can run before EXPAND reaches hosted Postgres. CONTRACT deliberately
 * revokes their grants; each fallback is reachable only when its checked
 * replacement is absent, and must disappear in a later cleanup release.
 */
const CONTRACT_REVOKED_ROLLING_FALLBACKS = {
  assign_bots_to_project: "assign_bots_to_project_checked",
  set_bot_assignment_execution: "set_bot_assignment_execution_checked",
  update_bot_assignment: "update_bot_assignment_checked",
  update_bot_assignment_configuration: "update_bot_assignment_configuration_checked",
} as const;

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return collectSourceFiles(path);
      return /\.(ts|tsx|mts)$/.test(entry.name) ? [path] : [];
    }),
  );
  return files.flat();
}

async function collectCalledRpcNames(): Promise<string[]> {
  const names = new Set<string>();
  for (const directory of sourceDirectories) {
    const files = await collectSourceFiles(resolve(repositoryRoot, directory));
    for (const file of files) {
      const contents = await readFile(file, "utf8");
      for (const match of contents.matchAll(RPC_CALL_PATTERN)) {
        names.add(match[1]!);
      }
    }
  }
  return [...names].sort();
}

describe("application-to-schema RPC wiring", () => {
  let db: PGlite;
  let calledRpcNames: string[];
  let definedFunctions: Set<string>;
  let executableFunctions: Set<string>;

  beforeAll(async () => {
    calledRpcNames = await collectCalledRpcNames();

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
    for (const migrationFile of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
    }

    const defined = await db.query<{ proname: string }>(`
      select distinct proname
      from pg_catalog.pg_proc proc
      join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
      where namespace.nspname = 'public'
    `);
    definedFunctions = new Set(defined.rows.map((row) => row.proname));

    const executable = await db.query<{ proname: string }>(`
      select distinct proc.proname
      from pg_catalog.pg_proc proc
      join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace,
      unnest($1::text[]) as role_name
      where namespace.nspname = 'public'
        and pg_catalog.has_function_privilege(role_name, proc.oid, 'EXECUTE')
    `, [`{${APPLICATION_ROLES.join(",")}}`]);
    executableFunctions = new Set(executable.rows.map((row) => row.proname));
  }, 240_000);

  afterAll(async () => {
    await db.close();
  });

  it("finds the RPC calls it is supposed to be checking", () => {
    // A regex that silently matches nothing would make every assertion below
    // vacuously true, which is the failure mode this kind of test dies of.
    expect(calledRpcNames.length).toBeGreaterThan(40);
    expect(calledRpcNames).toContain("sync_github_installation");
    expect(calledRpcNames).toContain("disconnect_github_connection");
    expect(calledRpcNames).toContain("process_github_webhook_delivery");
    expect(calledRpcNames).toEqual(expect.arrayContaining([
      ...Object.keys(CONTRACT_REVOKED_ROLLING_FALLBACKS),
      ...Object.values(CONTRACT_REVOKED_ROLLING_FALLBACKS),
    ]));
  });

  it("defines every database function the application calls", () => {
    const missing = calledRpcNames.filter((name) => !definedFunctions.has(name));

    // Named, not counted: a count says something broke, a list says what.
    expect(missing).toEqual([]);
  });

  it("revokes only the exact rolling fallbacks and exposes every checked replacement", () => {
    const unreachable = calledRpcNames.filter(
      (name) => definedFunctions.has(name) && !executableFunctions.has(name),
    );
    const intentionallyRevoked = Object.keys(CONTRACT_REVOKED_ROLLING_FALLBACKS).sort();
    const checkedReplacements = Object.values(CONTRACT_REVOKED_ROLLING_FALLBACKS);

    // No ordinary RPC may be dead on arrival. These four legacy calls are the
    // exact exception: the candidate retains them only to bridge a pre-EXPAND
    // database, while the post-CONTRACT catalogue intentionally denies them.
    expect(unreachable.sort()).toEqual(intentionallyRevoked);
    expect(unreachable.filter((name) => !(name in CONTRACT_REVOKED_ROLLING_FALLBACKS)))
      .toEqual([]);

    // Every denied legacy path has a literal, called, defined, executable
    // checked replacement. This prevents the exception list from masking a
    // typo or a CONTRACT migration that revoked the new boundary as well.
    for (const checked of checkedReplacements) {
      expect(calledRpcNames).toContain(checked);
      expect(definedFunctions).toContain(checked);
      expect(executableFunctions).toContain(checked);
    }
  });
});
