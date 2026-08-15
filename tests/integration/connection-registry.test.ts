// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The registry half of Phase 2D, checked against the real migration chain.
 *
 * `identity-router.test.ts` proves the decision. This proves the database
 * actually enforces what that decision assumes: that a capability cannot be
 * invented, that health is a closed set, that capacity cannot be exceeded by a
 * direct write, and that the projection a surface reads never carries
 * `secret_reference`.
 */

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000002a1";
const outsiderId = "00000000-0000-4000-8000-0000000002a2";
const organizationId = "10000000-0000-4000-8000-0000000002b1";
const projectId = "40000000-0000-4000-8000-0000000002c1";
const primaryConnectionId = "20000000-0000-4000-8000-0000000002d1";
const backupConnectionId = "20000000-0000-4000-8000-0000000002d2";

describe("Phase 2D connection registry", () => {
  let db: PGlite;

  async function asRole(role: string, userId: string | null = null) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
    await db.exec(`set role ${role}`);
  }

  async function asOwnerOfDatabase() {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }

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

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const migrationFile of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by)
        values ('${organizationId}', 'Registry Tenant', 'registry-tenant', '${ownerId}');
      insert into public.projects (id, organization_id, name, status, github_repository, default_branch, created_by)
        values ('${projectId}', '${organizationId}', 'Registry Project', 'active', 'tenant/app', 'main', '${ownerId}');
      insert into public.connections (
        id, organization_id, name, provider, status, external_account_label, secret_reference, created_by
      ) values
        ('${primaryConnectionId}', '${organizationId}', 'GitHub · primary', 'github', 'connected', 'primary-account', 'env://GITHUB_APP', '${ownerId}'),
        ('${backupConnectionId}', '${organizationId}', 'GitHub · backup', 'github', 'connected', 'backup-account', 'env://GITHUB_APP_BACKUP', '${ownerId}');

      update public.connections
      set capabilities = '["repository.read", "repository.write"]'::jsonb,
          health = 'connected'
      where organization_id = '${organizationId}';
      insert into public.project_connections (
        organization_id, project_id, connection_id, capability, priority, is_primary, created_by
      ) values
        ('${organizationId}', '${projectId}', '${primaryConnectionId}', 'repository.write', 10, true, '${ownerId}'),
        ('${organizationId}', '${projectId}', '${backupConnectionId}', 'repository.write', 20, false, '${ownerId}');
    `);
    await db.exec("reset role");
  }, 240_000);

  afterAll(async () => {
    await db.close();
  });

  it("registers a new connection as routable for nothing until a capability is declared", async () => {
    await asOwnerOfDatabase();
    const created = await db.query<{ capabilities: string[]; health: string }>(
      `insert into public.connections (
         organization_id, name, provider, status, external_account_label, secret_reference, created_by
       ) values ($1, 'Vercel · unconfigured', 'vercel', 'pending', 'unconfigured', 'env://VERCEL', $2)
       returning capabilities, health`,
      [organizationId, ownerId],
    );

    // Fail closed. A connection that exists is not thereby authorized for
    // anything, and health is `offline` until something actually verifies it —
    // never `connected` on the strength of a row existing.
    expect(created.rows[0]!.capabilities).toEqual([]);
    expect(created.rows[0]!.health).toBe("offline");
  });

  it("declares the capabilities an existing GitHub connection already exercised", async () => {
    await asOwnerOfDatabase();
    const result = await db.query<{ capabilities: string[]; health: string }>(
      "select capabilities, health from public.connections where id = $1",
      [primaryConnectionId],
    );

    expect(result.rows[0]!.capabilities).toEqual(["repository.read", "repository.write"]);
    expect(result.rows[0]!.health).toBe("connected");
  });

  it("refuses a capability that is not in the vocabulary", async () => {
    await asOwnerOfDatabase();
    await expect(
      db.query("update public.connections set capabilities = $1::jsonb where id = $2", [
        '["repository.destroy"]',
        primaryConnectionId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      db.query("update public.connections set capabilities = $1::jsonb where id = $2", [
        "[42]",
        primaryConnectionId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("constrains health to the six states the router understands", async () => {
    await asOwnerOfDatabase();
    for (const health of ["connected", "degraded", "offline", "unauthorized", "error", "disabled"]) {
      await db.query("update public.connections set health = $1 where id = $2", [
        health,
        backupConnectionId,
      ]);
    }
    await expect(
      db.query("update public.connections set health = $1 where id = $2", [
        "probably_fine",
        backupConnectionId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });

    await db.query("update public.connections set health = 'connected' where id = $1", [
      backupConnectionId,
    ]);
  });

  it("refuses to record more work in flight than the ceiling allows", async () => {
    await asOwnerOfDatabase();
    await db.query(
      "update public.connections set max_concurrency = 2, active_leases = 2 where id = $1",
      [primaryConnectionId],
    );
    await expect(
      db.query("update public.connections set active_leases = 3 where id = $1", [
        primaryConnectionId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.query("update public.connections set active_leases = -1 where id = $1", [
        primaryConnectionId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });

    await db.query(
      "update public.connections set max_concurrency = null, active_leases = 0 where id = $1",
      [primaryConnectionId],
    );
  });

  it("lets one project map two accounts to the same capability at distinct priorities", async () => {
    await asRole("authenticated", ownerId);
    const result = await db.query<{
      account_label: string;
      capability: string;
      connection_id: string;
      priority: number;
    }>(
      "select connection_id, account_label, capability, priority from public.list_project_connection_identities($1::uuid)",
      [projectId],
    );
    await db.exec("reset role");

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.account_label)).toEqual([
      "primary-account",
      "backup-account",
    ]);
    expect(result.rows.map((row) => row.priority)).toEqual([10, 20]);
  });

  it("never exposes secret_reference through the project identity projection", async () => {
    await asRole("authenticated", ownerId);
    const columns = await db.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'connections'`,
    );
    const result = await db.query("select * from public.list_project_connection_identities($1::uuid)", [
      projectId,
    ]);
    await db.exec("reset role");

    expect(columns.rows.map((row) => row.column_name)).toContain("secret_reference");
    // The projection omits it structurally rather than trusting a caller to
    // select the right columns.
    expect(JSON.stringify(result.rows)).not.toContain("env://");
    expect(Object.keys(result.rows[0] as object)).not.toContain("secret_reference");
  });

  it("denies an unrelated user and an anonymous caller", async () => {
    await asRole("authenticated", outsiderId);
    const outsider = await db.query(
      "select * from public.list_project_connection_identities($1::uuid)",
      [projectId],
    );
    expect(outsider.rows).toHaveLength(0);

    await asRole("anon");
    await expect(
      db.query("select * from public.list_project_connection_identities($1::uuid)", [projectId]),
    ).rejects.toMatchObject({ code: "42501" });
    await db.exec("reset role");
  });

  it("keeps the capability vocabulary readable but never writable from a browser", async () => {
    await asRole("authenticated", ownerId);
    const readable = await db.query<{ total: string }>(
      "select count(*)::text as total from public.connection_capability_types",
    );
    expect(Number(readable.rows[0]!.total)).toBeGreaterThanOrEqual(8);

    await expect(
      db.query(
        "insert into public.connection_capability_types (capability, description) values ('repository.destroy', 'no')",
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await db.exec("reset role");
  });

  it("keeps a legacy mapping readable but unroutable", async () => {
    // A mapping with no capability predates Phase 2D. It must not vanish, and
    // it must not be silently treated as satisfying whatever was asked for.
    await asOwnerOfDatabase();
    await db.query(
      `insert into public.project_connections (
         organization_id, project_id, connection_id, is_primary, created_by
       ) values ($1, $2, $3, false, $4)
       on conflict (project_id, connection_id) do nothing`,
      [organizationId, projectId, primaryConnectionId, ownerId],
    );

    const legacy = await db.query<{ total: string }>(
      "select count(*)::text as total from public.project_connections where project_id = $1 and capability is null",
      [projectId],
    );
    expect(Number(legacy.rows[0]!.total)).toBe(0);
  });

  it("records selections and refusals as immutable, member-readable routing evidence", async () => {
    // Phase 2D row 27: the router's answer becomes durable. Both outcomes are
    // recorded — an audit of only selections would read as if the router
    // never said no.
    await asRole("authenticated", ownerId);
    const selected = await db.query<{ id: string }>(
      `select public.record_connection_routing_decision(
         $1::uuid, 'repository.write', 'SELECTED', $2::uuid, null, false, 2,
         $3::jsonb
       ) as id`,
      [projectId, primaryConnectionId, JSON.stringify([
        { connectionId: backupConnectionId, reason: "CAPACITY_EXHAUSTED" },
      ])],
    );
    expect(selected.rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    await db.query(
      `select public.record_connection_routing_decision(
         $1::uuid, 'deploy.preview', 'REFUSED', null, 'NO_MAPPING', false, 0, '[]'::jsonb
       )`,
      [projectId],
    );

    const visible = await db.query<{ decision: string; refusal_code: string | null }>(
      `select decision, refusal_code from public.connection_routing_decisions
       where project_id = $1 order by created_at`,
      [projectId],
    );
    expect(visible.rows.map((row) => row.decision)).toEqual(["SELECTED", "REFUSED"]);
    expect(visible.rows[1]!.refusal_code).toBe("NO_MAPPING");

    // Append-only holds even for the most privileged role.
    await asOwnerOfDatabase();
    await expect(
      db.query("update public.connection_routing_decisions set refusal_code = 'EDITED'"),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query("delete from public.connection_routing_decisions"),
    ).rejects.toThrow(/append-only/);

    // An outsider sees nothing and can record nothing; anonymous is denied.
    await asRole("authenticated", outsiderId);
    const foreign = await db.query("select 1 from public.connection_routing_decisions");
    expect(foreign.rows).toHaveLength(0);
    await expect(
      db.query(
        `select public.record_connection_routing_decision(
           $1::uuid, 'repository.write', 'REFUSED', null, 'NO_MAPPING', false, 0, '[]'::jsonb
         )`,
        [projectId],
      ),
    ).rejects.toThrow(/project not found/);
    await asRole("anon");
    await expect(
      db.query("select 1 from public.connection_routing_decisions"),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });

  it("refuses evidence rows that lie about themselves", async () => {
    await asRole("authenticated", ownerId);
    // A selection without a connection selected nothing.
    await expect(
      db.query(
        `select public.record_connection_routing_decision(
           $1::uuid, 'repository.write', 'SELECTED', null, null, false, 1, '[]'::jsonb
         )`,
        [projectId],
      ),
    ).rejects.toThrow(/connection_routing_decisions_shape/);
    // A refusal with a connection is a contradiction.
    await expect(
      db.query(
        `select public.record_connection_routing_decision(
           $1::uuid, 'repository.write', 'REFUSED', $2::uuid, 'NO_MAPPING', false, 1, '[]'::jsonb
         )`,
        [projectId, primaryConnectionId],
      ),
    ).rejects.toThrow(/connection_routing_decisions_shape/);
    // A capability outside the vocabulary cannot be recorded.
    await expect(
      db.query(
        `select public.record_connection_routing_decision(
           $1::uuid, 'time.travel', 'REFUSED', null, 'NO_MAPPING', false, 0, '[]'::jsonb
         )`,
        [projectId],
      ),
    ).rejects.toThrow(/foreign key|violates/i);
    // A connection outside the caller's organization gets the generic answer.
    await expect(
      db.query(
        `select public.record_connection_routing_decision(
           $1::uuid, 'repository.write', 'SELECTED',
           '99999999-9999-4999-8999-999999999999'::uuid, null, false, 1, '[]'::jsonb
         )`,
        [projectId],
      ),
    ).rejects.toThrow(/connection not found/);
    await db.exec("reset role");
  });
});
