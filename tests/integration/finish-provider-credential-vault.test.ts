// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The one function 20260814002500 died before creating.
 *
 * Probe run 32652393423 measured the hosted database and found that file's
 * two tables complete, its index present, RLS and FORCE RLS on with no client
 * grants, five of its six functions created — and
 * `resolve_provider_connect_session` missing. That gap is why every correct
 * bot sign-in code was answered "connect_session_invalid", and why Supabase's
 * preview branch replayed the unrecorded file into a 42P07.
 *
 * What matters about the repair is that it is the SAME function, with the same
 * posture: server-only, definer, non-mutating, and refusing an expired or
 * already-claimed code exactly as the claim does.
 */

const migrationsRoot = resolve(import.meta.dirname, "../../supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000f001";
const organizationId = "10000000-0000-4000-8000-00000000f001";

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
  const migrationFiles = (await readdir(migrationsRoot))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  expect(migrationFiles.at(-1)).toBe("20260830000300_project_node_attempt.sql");
  for (const file of migrationFiles) {
    await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id) values ('${ownerId}');
    insert into public.organizations (id, name, slug, created_by) values
      ('${organizationId}', 'Vault Co', 'vault-co', '${ownerId}');
  `);
}, 240_000);

afterAll(async () => {
  await db?.close();
});

describe("resolve_provider_connect_session", () => {
  it("resolves a live pending session to its organization and purpose", async () => {
    await db.exec("reset role");
    await db.query(
      `insert into public.provider_connect_sessions
         (organization_id, purpose, code_digest, expires_at, created_by)
       values ($1, 'anthropic_subscription', repeat('a', 64), now() + interval '10 minutes', $2)`,
      [organizationId, ownerId],
    );

    const resolved = await db.query<{ session_organization_id: string; session_purpose: string }>(
      "select * from public.resolve_provider_connect_session($1)",
      [ "a".repeat(64) ],
    );
    expect(resolved.rows).toEqual([
      { session_organization_id: organizationId, session_purpose: "anthropic_subscription" },
    ]);
  });

  it("refuses an expired code and an already-claimed one, the same rules the claim applies", async () => {
    await db.exec("reset role");
    // A session cannot be born already expired — `short_lived` requires
    // expires_at > created_at — so this one is aged rather than back-dated.
    await db.query(
      `insert into public.provider_connect_sessions
         (organization_id, purpose, code_digest, created_at, expires_at, created_by)
       values ($1, 'expired_purpose', repeat('b', 64),
               now() - interval '10 minutes', now() - interval '1 minute', $2)`,
      [organizationId, ownerId],
    );
    await db.query(
      `insert into public.provider_connect_sessions
         (organization_id, purpose, code_digest, expires_at, claimed_at, claimed_by, created_by)
       values ($1, 'claimed_purpose', repeat('c', 64), now() + interval '10 minutes', now(), $2, $2)`,
      [organizationId, ownerId],
    );

    for (const digest of ["b".repeat(64), "c".repeat(64), "d".repeat(64)]) {
      const result = await db.query(
        "select * from public.resolve_provider_connect_session($1)",
        [digest],
      );
      expect(result.rows, digest).toHaveLength(0);
    }
  });

  it("never returns the digest itself", async () => {
    const columns = await db.query<{ column_name: string }>(`
      select column_name from information_schema.columns
       where table_schema = 'public'
         and table_name = 'resolve_provider_connect_session'`);
    // A set-returning function's output columns are the two it declares.
    const declared = await db.query<{ names: string }>(`
      select array_to_string(proargnames, ',') as names from pg_proc
       where oid = to_regprocedure('public.resolve_provider_connect_session(text)')`);
    expect(columns.rows).toHaveLength(0);
    expect(declared.rows[0].names).toBe("p_code_digest,session_organization_id,session_purpose");
  });

  it("is reachable by the server only — never the browser", async () => {
    const acl = await db.query<{ anon: boolean; auth: boolean; service: boolean; definer: boolean }>(`
      select has_function_privilege('anon', 'public.resolve_provider_connect_session(text)', 'EXECUTE') as anon,
             has_function_privilege('authenticated', 'public.resolve_provider_connect_session(text)', 'EXECUTE') as auth,
             has_function_privilege('service_role', 'public.resolve_provider_connect_session(text)', 'EXECUTE') as service,
             (select prosecdef from pg_proc
               where oid = to_regprocedure('public.resolve_provider_connect_session(text)')) as definer`);
    expect(acl.rows[0]).toEqual({ anon: false, auth: false, service: true, definer: true });
  });

  it("leaves the sealed envelope table unreadable by every client role", async () => {
    const acl = await db.query<{ anon: boolean; auth: boolean; service: boolean }>(`
      select has_table_privilege('anon', 'public.provider_credentials', 'SELECT') as anon,
             has_table_privilege('authenticated', 'public.provider_credentials', 'SELECT') as auth,
             has_table_privilege('service_role', 'public.provider_credentials', 'SELECT') as service`);
    expect(acl.rows[0]).toEqual({ anon: false, auth: false, service: false });
  });

  it("completes every object 20260814002500 declares", async () => {
    const present = await db.query<{ missing: number }>(`
      select count(*)::int as missing from (
        values
          (to_regclass('public.provider_credentials')::text),
          (to_regclass('public.provider_connect_sessions')::text),
          (to_regclass('public.provider_connect_sessions_expiry_idx')::text),
          (to_regprocedure('public.list_provider_credentials(uuid)')::text),
          (to_regprocedure('public.open_provider_connect_session(uuid,text,text,integer)')::text),
          (to_regprocedure('public.resolve_provider_connect_session(text)')::text),
          (to_regprocedure('public.claim_provider_connect_session(text,text)')::text),
          (to_regprocedure('public.read_provider_credential(uuid,text)')::text),
          (to_regprocedure('public.forget_provider_credential(uuid,text)')::text)
      ) as objects(reference) where reference is null`);
    expect(present.rows[0].missing).toBe(0);
  });
});
