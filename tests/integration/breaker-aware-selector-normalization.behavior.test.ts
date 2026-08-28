// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const staleSelectorMigration = "20260815000300_phase2e_portfolio_scheduler.sql";
const priorTailMigration = "20260827000210_contain_legacy_graph_artifact_payloads.sql";
const normalizationMigration =
  "20260828000050_normalize_breaker_aware_phase1c_selector.sql";

const staleSelectorHash = "ed5840b9d8d0efdb513a8576df128e9b";
const breakerAwareSelectorHash = "5933952d71f9da90a2a80a05ce6e0378";

interface RoutineIdentity {
  readonly acl: string;
  readonly anonExecute: boolean;
  readonly authenticatedExecute: boolean;
  readonly config: string[];
  readonly ownerName: string;
  readonly parallel: string;
  readonly securityDefiner: boolean;
  readonly serviceExecute: boolean;
  readonly sourceMd5: string;
  readonly volatility: string;
}

interface HelperIdentity extends RoutineIdentity {
  readonly requestedSignature: string;
}

function extractFunctionDefinition(source: string, functionName: string) {
  const marker = `create or replace function public.${functionName}(`;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`missing function definition: ${functionName}`);
  }

  const remainder = source.slice(start);
  const opening = /\bas\s+(\$[A-Za-z_]*\$)\r?\n/i.exec(remainder);
  if (!opening?.[1] || opening.index === undefined) {
    throw new Error(`missing function body delimiter: ${functionName}`);
  }

  const delimiter = opening[1];
  const bodyStart = opening.index + opening[0].length;
  const end = remainder.indexOf(`${delimiter};`, bodyStart);
  if (end < 0) {
    throw new Error(`unterminated function definition: ${functionName}`);
  }

  return remainder.slice(0, end + delimiter.length + 1);
}

async function bootstrap() {
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

  const priorMigrations = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/.test(file) && file < normalizationMigration)
    .sort();
  expect(priorMigrations.at(-1)).toBe(priorTailMigration);

  for (const migration of priorMigrations) {
    await db.exec(await readFile(resolve(migrationsDirectory, migration), "utf8"));
  }
  return db;
}

async function selectorIdentity(db: PGlite) {
  const { rows } = await db.query<RoutineIdentity>(`
    select
      pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
        routine.prosrc, E'\\r\\n', E'\\n'
      ), E'\\r', E'\\n')) as "sourceMd5",
      pg_catalog.pg_get_userbyid(routine.proowner) as "ownerName",
      routine.prosecdef as "securityDefiner",
      routine.proconfig as "config",
      routine.provolatile::text as "volatility",
      routine.proparallel::text as "parallel",
      routine.proacl::text as "acl",
      pg_catalog.has_function_privilege(
        'anon', routine.oid, 'EXECUTE'
      ) as "anonExecute",
      pg_catalog.has_function_privilege(
        'authenticated', routine.oid, 'EXECUTE'
      ) as "authenticatedExecute",
      pg_catalog.has_function_privilege(
        'service_role', routine.oid, 'EXECUTE'
      ) as "serviceExecute"
    from pg_catalog.pg_proc routine
    where routine.oid = pg_catalog.to_regprocedure(
      'public.claim_phase1c_run_budget_internal(text,text,text,integer)'
    )
  `);
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function helperIdentities(db: PGlite) {
  const { rows } = await db.query<HelperIdentity>(`
    with expected(requested_signature) as (values
      ('public.breaker_cooldown_seconds(text)'),
      ('public.breaker_suppression_reason(uuid,text,text,timestamptz)'),
      ('public.consume_breaker_trial(uuid,text,text)')
    )
    select
      expected.requested_signature as "requestedSignature",
      pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
        routine.prosrc, E'\\r\\n', E'\\n'
      ), E'\\r', E'\\n')) as "sourceMd5",
      pg_catalog.pg_get_userbyid(routine.proowner) as "ownerName",
      routine.prosecdef as "securityDefiner",
      routine.proconfig as "config",
      routine.provolatile::text as "volatility",
      routine.proparallel::text as "parallel",
      routine.proacl::text as "acl",
      pg_catalog.has_function_privilege(
        'anon', routine.oid, 'EXECUTE'
      ) as "anonExecute",
      pg_catalog.has_function_privilege(
        'authenticated', routine.oid, 'EXECUTE'
      ) as "authenticatedExecute",
      pg_catalog.has_function_privilege(
        'service_role', routine.oid, 'EXECUTE'
      ) as "serviceExecute"
    from expected
    join pg_catalog.pg_proc routine
      on routine.oid = pg_catalog.to_regprocedure(expected.requested_signature)
    order by expected.requested_signature
  `);
  expect(rows).toHaveLength(3);
  return rows;
}

describe("breaker-aware Phase 1C selector normalization", { timeout: 30_000 }, () => {
  it("normalizes the exact hosted stale shape and refuses helper metadata drift", async () => {
    const db = await bootstrap();
    try {
      const staleMigration = await readFile(
        resolve(migrationsDirectory, staleSelectorMigration),
        "utf8",
      );
      const normalization = await readFile(
        resolve(migrationsDirectory, normalizationMigration),
        "utf8",
      );

      // Reconstruct the hosted split catalog: the exact 150003 selector body
      // alongside the exact breaker helpers installed from 150005.
      await db.exec(extractFunctionDefinition(
        staleMigration,
        "claim_phase1c_run_budget_internal",
      ));

      const before = await selectorIdentity(db);
      const helpersBefore = await helperIdentities(db);
      expect(before).toMatchObject({
        acl: "{postgres=X/postgres}",
        anonExecute: false,
        authenticatedExecute: false,
        config: ["search_path=pg_catalog"],
        ownerName: "postgres",
        parallel: "u",
        securityDefiner: true,
        serviceExecute: false,
        sourceMd5: staleSelectorHash,
        volatility: "v",
      });

      await db.exec(normalization);

      const after = await selectorIdentity(db);
      expect(after).toEqual({
        ...before,
        sourceMd5: breakerAwareSelectorHash,
      });
      expect(await helperIdentities(db)).toEqual(helpersBefore);

      await db.exec(
        "alter function public.breaker_cooldown_seconds(text) parallel safe",
      );
      await expect(db.exec(normalization)).rejects.toThrow(
        "breaker-aware selector helper identity mismatch: "
          + "public.breaker_cooldown_seconds(text)",
      );

      // The failed preflight must not partially rewrite the already-normalized
      // selector or widen its private execution boundary.
      expect(await selectorIdentity(db)).toEqual(after);
    } finally {
      await db.close();
    }
  });

  it.each([
    [
      "a permissive replacement policy",
      "alter policy resource_breakers_select_members on public.resource_breakers using (true)",
      "breaker-aware selector dependency table drifted",
    ],
    [
      "a weakened named constraint",
      `alter table public.resource_breakers
         drop constraint resource_breakers_closed_is_clean,
         add constraint resource_breakers_closed_is_clean check (true)`,
      "breaker-aware selector dependency table drifted",
    ],
    [
      "a changed column default",
      "alter table public.resource_breakers alter column state set default 'open'",
      "breaker-aware selector dependency table drifted",
    ],
    [
      "a widened browser ACL",
      "grant insert on table public.resource_breakers to authenticated",
      "breaker-aware selector dependency table drifted",
    ],
    [
      "a column-level browser ACL",
      "grant update (state) on table public.resource_breakers to authenticated",
      "breaker-aware selector dependency table drifted",
    ],
    [
      "a replaced partial index",
      `drop index public.resource_breakers_open;
       create index resource_breakers_open
         on public.resource_breakers (state, organization_id)
         where state <> 'closed'`,
      "breaker-aware selector dependency table drifted",
    ],
    [
      "an extra base-selector overload",
      `create function public.claim_planned_graph_internal(text)
       returns void language sql as $$ select $$`,
      "breaker-aware selector base overload count drifted",
    ],
  ])("refuses %s before replacing the selector", async (_name, tamper, message) => {
    const db = await bootstrap();
    try {
      const staleMigration = await readFile(
        resolve(migrationsDirectory, staleSelectorMigration),
        "utf8",
      );
      const normalization = await readFile(
        resolve(migrationsDirectory, normalizationMigration),
        "utf8",
      );
      await db.exec(extractFunctionDefinition(
        staleMigration,
        "claim_phase1c_run_budget_internal",
      ));
      await db.exec(tamper);
      await expect(db.exec(normalization)).rejects.toThrow(message);
      expect((await selectorIdentity(db)).sourceMd5).toBe(staleSelectorHash);
    } finally {
      await db.close();
    }
  });
});
