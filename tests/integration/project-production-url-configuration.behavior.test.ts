// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationsRoot = resolve(import.meta.dirname, "../../supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000f101";
const adminId = "00000000-0000-4000-8000-00000000f102";
const memberId = "00000000-0000-4000-8000-00000000f103";
const outsiderId = "00000000-0000-4000-8000-00000000f104";
const organizationId = "10000000-0000-4000-8000-00000000f101";
const otherOrganizationId = "10000000-0000-4000-8000-00000000f102";
const projectId = "20000000-0000-4000-8000-00000000f101";
const syntheticSecret = `sk-${"a".repeat(32)}`;

let database: PGlite;

async function resetRole() {
  await database.exec("reset role");
  await database.query("select set_config('request.jwt.claim.sub', '', false)");
}

async function actAs(userId: string, role = "authenticated") {
  await resetRole();
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await database.exec(`set role ${role}`);
}

async function setProductionUrl(userId: string, value: string | null) {
  await actAs(userId);
  const result = await database.query<{ production_url: string | null }>(
    "select production_url from public.set_project_production_url($1,$2,$3)",
    [organizationId, projectId, value],
  );
  return result.rows[0]?.production_url ?? null;
}

beforeAll(async () => {
  database = new PGlite({ extensions: { pgcrypto } });
  await database.exec(`
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
  for (const file of (await readdir(migrationsRoot)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
    await database.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
  }

  await database.exec(`
    insert into auth.users (id) values
      ('${ownerId}'), ('${adminId}'), ('${memberId}'), ('${outsiderId}');
    insert into public.organizations (id, name, slug, created_by) values
      ('${organizationId}', 'URL Factory', 'url-factory', '${ownerId}'),
      ('${otherOrganizationId}', 'Other Factory', 'other-url-factory', '${outsiderId}');
    insert into public.organization_members (organization_id, user_id, role, created_by) values
      ('${organizationId}', '${adminId}', 'admin', '${ownerId}'),
      ('${organizationId}', '${memberId}', 'member', '${ownerId}');
    insert into public.projects (
      id, organization_id, name, status, created_by
    ) values (
      '${projectId}', '${organizationId}', 'Public Application', 'active', '${ownerId}'
    );
  `);
});

afterAll(async () => {
  await database.close();
});

describe("project production URL configuration behavior", () => {
  it("keeps the legacy detail signature and hardened project RLS", async () => {
    await resetRole();
    const result = await database.query<{
      detail_exists: boolean;
      force_rls: boolean;
      row_security: boolean;
      trigger_exact: boolean;
      validated: boolean;
    }>(`
      select
        to_regprocedure('public.update_project_details(uuid,text,text)') is not null as detail_exists,
        relation.relrowsecurity as row_security,
        relation.relforcerowsecurity as force_rls,
        constraint_row.convalidated as validated,
        exists (
          select 1
          from pg_catalog.pg_trigger trigger_row
          where trigger_row.tgrelid = 'public.projects'::regclass
            and trigger_row.tgname = 'projects_audit_change'
            and not trigger_row.tgisinternal
            and trigger_row.tgenabled = 'O'
            and trigger_row.tgfoid = 'public.audit_project_change()'::regprocedure
            and trigger_row.tgtype = 21
            and trigger_row.tgnargs = 0
            and trigger_row.tgqual is null
            and not trigger_row.tgdeferrable
            and not trigger_row.tginitdeferred
        ) as trigger_exact
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      join pg_catalog.pg_constraint constraint_row on constraint_row.conrelid = relation.oid
      where namespace.nspname = 'public'
        and relation.relname = 'projects'
        and constraint_row.conname = 'projects_production_url_public_https'
    `);
    expect(result.rows[0]).toEqual({
      detail_exists: true,
      force_rls: true,
      row_security: true,
      trigger_exact: true,
      validated: true,
    });
  });

  it("allows owner/admin changes, clears, audits once, and makes replay a no-op", async () => {
    expect(await setProductionUrl(ownerId, "https://www.theagoras.com")).toBe(
      "https://www.theagoras.com",
    );
    await resetRole();
    const firstAudit = await database.query<{ count: string }>(`
      select count(*)::text as count
      from public.activity_events
      where project_id = '${projectId}' and event_type = 'project.updated'
    `);
    expect(firstAudit.rows[0]?.count).toBe("1");

    expect(await setProductionUrl(ownerId, "https://www.theagoras.com")).toBe(
      "https://www.theagoras.com",
    );
    await resetRole();
    const replayAudit = await database.query<{ count: string }>(`
      select count(*)::text as count
      from public.activity_events
      where project_id = '${projectId}' and event_type = 'project.updated'
    `);
    expect(replayAudit.rows[0]?.count).toBe("1");

    expect(await setProductionUrl(adminId, null)).toBeNull();
    await resetRole();
    const stored = await database.query<{ production_url: string | null }>(
      "select production_url from public.projects where id = $1",
      [projectId],
    );
    expect(stored.rows[0]?.production_url).toBeNull();
  });

  it.each([memberId, outsiderId])("refuses non-manager %s", async (userId) => {
    await expect(setProductionUrl(userId, "https://www.theagoras.com")).rejects.toThrow(
      /owner or administrator access is required|project not found/i,
    );
  });

  it("refuses a tenant mismatch and an archived project", async () => {
    await actAs(ownerId);
    await expect(database.query(
      "select * from public.set_project_production_url($1,$2,$3)",
      [otherOrganizationId, projectId, "https://www.theagoras.com"],
    )).rejects.toThrow(/project not found/i);

    await resetRole();
    await database.query("update public.projects set status = 'archived' where id = $1", [projectId]);
    await expect(setProductionUrl(ownerId, "https://www.theagoras.com")).rejects.toThrow(
      /restore it before changing its production URL/i,
    );
    await resetRole();
    await database.query("update public.projects set status = 'active' where id = $1", [projectId]);
  });

  it.each([
    "http://www.theagoras.com",
    "https://user:password@www.theagoras.com",
    "https://www.theagoras.com?preview=true",
    "https://www.theagoras.com#fragment",
    "https://localhost",
    "https://service.internal",
    "https://intranet",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://100.64.0.1",
    "https://169.254.169.254",
    "https://172.16.0.1",
    "https://192.168.0.1",
    "https://[::1]",
    "https://0177.0.0.1",
    "https://2130706433",
    "https://www.theagoras.com:8443",
    `https://www.theagoras.com/${syntheticSecret}`,
  ])("refuses unsafe durable target %s", async (value) => {
    await expect(setProductionUrl(ownerId, value)).rejects.toThrow(/public HTTPS URL/i);
  });

  it("keeps the RPC authenticated-only and helper non-callable", async () => {
    await actAs(outsiderId, "anon");
    await expect(database.query(
      "select * from public.set_project_production_url($1,$2,$3)",
      [organizationId, projectId, "https://www.theagoras.com"],
    )).rejects.toThrow(/permission denied/i);

    await actAs(outsiderId, "service_role");
    await expect(database.query(
      "select * from public.set_project_production_url($1,$2,$3)",
      [organizationId, projectId, "https://www.theagoras.com"],
    )).rejects.toThrow(/permission denied/i);

    await actAs(ownerId);
    await expect(database.query(
      "select public.project_production_url_is_safe('https://www.theagoras.com')",
    )).rejects.toThrow(/permission denied/i);
  });
});
