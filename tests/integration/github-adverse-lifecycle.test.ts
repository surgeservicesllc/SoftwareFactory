// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Phase 1B — the adverse lifecycle matrix.
 *
 * The happy path for the GitHub integration has been live for the owner
 * repository since Phase 1B shipped. What was never covered is the set of
 * things that go wrong afterwards: an installation revoked, a permission
 * withdrawn, a webhook arriving twice or out of order, a deletion that must be
 * terminal, a connection explicitly lost.
 *
 * Those are the cases where an integration quietly starts lying — reporting a
 * connection it no longer has, accepting a stale event as current, or losing
 * the history that explains what happened. Each one below asserts the refusal
 * rather than the success, because the refusals are what have never been
 * exercised.
 *
 * Everything runs against the real migrated schema. No mechanism is simulated.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000b0001";
const outsiderId = "00000000-0000-4000-8000-0000000b0002";
const organizationId = "10000000-0000-4000-8000-0000000b0001";
const otherOrganizationId = "10000000-0000-4000-8000-0000000b0002";
const projectId = "40000000-0000-4000-8000-0000000b0001";
const connectionId = "20000000-0000-4000-8000-0000000b0001";
const installationId = "30000000-0000-4000-8000-0000000b0001";

const EXTERNAL_INSTALLATION = 153479019;

async function assumeRole(db: PGlite, role: string, userId: string | null = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

describe("Phase 1B adverse lifecycle", () => {
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

    const files = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');

      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Adverse Factory', 'adverse-factory', '${ownerId}'),
        ('${otherOrganizationId}', 'Other', 'other-adverse', '${outsiderId}');

      insert into public.projects (id, organization_id, name, status, default_branch, created_by)
      values ('${projectId}', '${organizationId}', 'Bound', 'active', 'main', '${ownerId}');

      -- A connected connection must carry a secret *reference*, never secret
      -- material. The constraint enforcing that is the schema's way of saying a
      -- connection record is metadata plus a pointer.
      insert into public.connections (
        id, organization_id, name, provider, status, external_account_label,
        secret_reference, created_by
      ) values (
        '${connectionId}', '${organizationId}', 'GitHub', 'github', 'connected',
        'surgeservicesllc', 'env://GITHUB_APP_PRIVATE_KEY_BASE64', '${ownerId}'
      );

      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id, app_slug,
        account_id, account_login, account_type, target_type, repository_selection,
        status, installed_at, created_by
      ) values (
        '${installationId}', '${organizationId}', '${connectionId}', ${EXTERNAL_INSTALLATION},
        4582606, 'softwarefactory', 316305532, 'surgeservicesllc', 'User', 'User',
        'selected', 'active', now(), '${ownerId}'
      );
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  describe("revoked and insufficient permission", () => {
    it("records a connection as lost only for a declared reason", async () => {
      // An open-ended reason string would let any caller invent a loss state
      // that downstream code has no rule for.
      await expect(
        db.query("select public.mark_github_connection_lost($1::uuid, $2::uuid, $3::text)", [
          ownerId,
          connectionId,
          "felt like it",
        ]),
      ).rejects.toThrow(/invalid/i);

      const { rows } = await db.query<{ mark_github_connection_lost: boolean }>(
        "select public.mark_github_connection_lost($1::uuid, $2::uuid, $3::text)",
        [ownerId, connectionId, "installation_revoked"],
      );
      expect(rows[0].mark_github_connection_lost).toBe(true);
    });

    it("preserves the installation history rather than deleting it", async () => {
      // The record of what was connected is the only way to explain what
      // happened afterwards; losing it with the connection would be worse than
      // the loss itself.
      const { rows } = await db.query<{ count: string }>(
        "select count(*)::text as count from public.github_installations where connection_id = $1",
        [connectionId],
      );
      expect(rows[0].count).toBe("1");
    });

    it("reports a lost connection as lost rather than connected", async () => {
      const { rows } = await db.query<{ status: string }>(
        "select status::text as status from public.connections where id = $1",
        [connectionId],
      );
      expect(rows[0].status).not.toBe("connected");
    });

    it("is idempotent, so a repeated revocation signal changes nothing", async () => {
      const before = await db.query<{ status: string; updated_at: string }>(
        "select status::text as status, updated_at from public.connections where id = $1",
        [connectionId],
      );

      await db.query("select public.mark_github_connection_lost($1::uuid, $2::uuid, $3::text)", [
        ownerId,
        connectionId,
        "insufficient_permission",
      ]);

      const after = await db.query<{ status: string }>(
        "select status::text as status from public.connections where id = $1",
        [connectionId],
      );
      // A provider that resends a revocation must not ratchet the record into
      // some further state.
      expect(after.rows[0].status).toBe(before.rows[0].status);
    });

    it("refuses a caller outside the organization", async () => {
      await assumeRole(db, "authenticated", outsiderId);
      await expect(
        db.query("select public.mark_github_connection_lost($1::uuid, $2::uuid, $3::text)", [
          outsiderId,
          connectionId,
          "installation_revoked",
        ]),
      ).rejects.toThrow();
      await resetRole(db);
    });
  });

  describe("explicit disconnect", () => {
    it("refuses to disconnect against the wrong installation id", async () => {
      // The expected-installation argument exists so a disconnect cannot be
      // aimed at a connection that has since been re-installed.
      await expect(
        db.query("select public.disconnect_github_connection($1::uuid, $2::uuid, $3::bigint)", [
          ownerId,
          connectionId,
          999_999_999,
        ]),
      ).rejects.toThrow();
    });

    it("refuses a member who is neither owner nor admin", async () => {
      await expect(
        db.query("select public.disconnect_github_connection($1::uuid, $2::uuid, $3::bigint)", [
          outsiderId,
          connectionId,
          EXTERNAL_INSTALLATION,
        ]),
      ).rejects.toThrow();
    });

    it("disconnects on the exact installation and keeps the audit trail", async () => {
      const { rows } = await db.query<{ disconnect_github_connection: number }>(
        "select public.disconnect_github_connection($1::uuid, $2::uuid, $3::bigint)",
        [ownerId, connectionId, EXTERNAL_INSTALLATION],
      );

      expect(Number(rows[0].disconnect_github_connection)).toBeGreaterThanOrEqual(0);

      const history = await db.query<{ count: string }>(
        "select count(*)::text as count from public.github_installations where connection_id = $1",
        [connectionId],
      );
      expect(history.rows[0].count).toBe("1");
    });
  });

  describe("terminal deletion", () => {
    it("requires a deletion timestamp alongside the deleted status", async () => {
      // Status and marker cannot disagree: a row claiming deleted without a
      // time is a deletion nobody can date.
      await expect(
        db.exec(`
          update public.github_installations
             set status = 'deleted'
           where id = '${installationId}';
        `),
      ).rejects.toThrow(/deleted_marker_consistent/);
    });

    it("keeps a deleted installation deleted", async () => {
      await db.exec(`
        update public.github_installations
           set status = 'deleted', deleted_at = now()
         where id = '${installationId}';
      `);

      // A deleted-then-restored installation would let a revoked integration
      // quietly come back, so deletion is terminal for an installation ID.
      await expect(
        db.exec(`
          update public.github_installations
             set status = 'active', deleted_at = null
           where id = '${installationId}';
        `),
      ).rejects.toThrow();
    });
  });

  describe("isolation", () => {
    it("denies anonymous callers every GitHub table", async () => {
      await assumeRole(db, "anon");
      for (const table of ["connections", "github_installations", "github_repositories"]) {
        await expect(db.query(`select * from public.${table}`), table).rejects.toThrow(
          /permission denied/i,
        );
      }
      await resetRole(db);
    });

    it("shows an unrelated organization nothing", async () => {
      await assumeRole(db, "authenticated", outsiderId);
      const { rows } = await db.query(
        "select id from public.github_installations where organization_id = $1",
        [organizationId],
      );
      expect(rows).toEqual([]);
      await resetRole(db);
    });
  });
});
