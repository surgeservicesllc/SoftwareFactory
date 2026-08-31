// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase, latestMigration } from "../support/migrated-database";
import { LATEST_MIGRATION } from "../support/latest-migration";

const ownerOneId = "00000000-0000-4000-8000-000000000101";
const viewerOneId = "00000000-0000-4000-8000-000000000102";
const ownerTwoId = "00000000-0000-4000-8000-000000000201";
const organizationOneId = "10000000-0000-4000-8000-000000000001";
const organizationTwoId = "10000000-0000-4000-8000-000000000002";
const projectOneId = "20000000-0000-4000-8000-000000000001";
const projectTwoId = "20000000-0000-4000-8000-000000000002";
const safeEventId = "30000000-0000-4000-8000-000000000001";
const unsafeEventId = "30000000-0000-4000-8000-000000000002";

type ApplicationRole = "anon" | "authenticated" | "service_role";

async function assumeRole(db: PGlite, role: ApplicationRole, userId: string | null = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

async function listActivity(db: PGlite, organizationId: string, limit: number | null) {
  return db.query<Record<string, unknown>>(
    "select * from public.list_activity($1::uuid, $2::integer)",
    [organizationId, limit],
  );
}

describe("safe activity list RPC", () => {
  let db: PGlite;

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed.
    expect(await latestMigration()).toBe(LATEST_MIGRATION);
    db = await createMigratedDatabase();

    await db.exec(`
      insert into auth.users (id, raw_user_meta_data) values
        ('${ownerOneId}', '{"full_name":"Owner One"}'::jsonb),
        ('${viewerOneId}', '{"full_name":"Viewer One"}'::jsonb),
        ('${ownerTwoId}', '{"full_name":"Owner Two"}'::jsonb);

      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationOneId}', 'Tenant One', 'tenant-one', '${ownerOneId}'),
        ('${organizationTwoId}', 'Tenant Two', 'tenant-two', '${ownerTwoId}');
      insert into public.organization_members (
        organization_id, user_id, role, created_by
      ) values (
        '${organizationOneId}', '${viewerOneId}', 'viewer', '${ownerOneId}'
      );

      insert into public.projects (
        id, organization_id, name, status, created_by
      ) values
        ('${projectOneId}', '${organizationOneId}', 'Tenant One Project', 'active', '${ownerOneId}'),
        ('${projectTwoId}', '${organizationTwoId}', 'Tenant Two Project', 'active', '${ownerTwoId}');

      insert into public.activity_events (
        id, organization_id, project_id, actor_user_id, event_type,
        entity_type, entity_id, description, metadata, occurred_at
      ) values
        (
          '${safeEventId}', '${organizationOneId}', '${projectOneId}', '${ownerOneId}',
          'project.updated', 'github_webhook_delivery',
          '40000000-0000-4000-8000-000000000001', 'Safe GitHub activity',
          '{
            "action":"opened",
            "arbitrary_blob":"must-not-leave-the-database",
            "conclusion":"success",
            "delivery_id":"delivery-123",
            "github_actor":{"avatar_url":"https://tracking.example/pixel","login":"safe-actor"},
            "payload":{"private_context":"must-not-leave"},
            "repository":"tenant-one/application",
            "resource_number":42,
            "resource_type":"pull_request",
            "source":"github",
            "state_transition":"applied",
            "status":"completed"
          }'::jsonb,
          '2030-08-13T12:00:00Z'
        ),
        (
          '${unsafeEventId}', '${organizationOneId}', '${projectOneId}', null,
          'project.updated', 'e' || repeat('x', 62),
          '40000000-0000-4000-8000-000000000002', 'Bounded GitHub activity',
          pg_catalog.jsonb_build_object(
            'action', pg_catalog.jsonb_build_object('nested', 'value'),
            'github_actor', pg_catalog.jsonb_build_object('login', 'not a valid login'),
            'provider', 'github',
            'repository', repeat('x', 161),
            'state_transition', E'line\\nbreak',
            'status', pg_catalog.jsonb_build_array('completed')
          ),
          '2030-08-13T11:59:00Z'
        ),
        (
          '30000000-0000-4000-8000-000000000003', '${organizationTwoId}',
          '${projectTwoId}', '${ownerTwoId}', 'project.updated', 'project',
          '${projectTwoId}', 'Other tenant activity',
          '{"source":"softwarefactory","status":"private-other-tenant"}'::jsonb,
          '2030-08-13T12:01:00Z'
        );

      insert into public.activity_events (
        organization_id, project_id, actor_user_id, event_type, entity_type,
        description, metadata, occurred_at
      )
      select
        '${organizationOneId}', '${projectOneId}', '${ownerOneId}',
        'project.updated', 'project', 'Tenant One bulk activity ' || series,
        '{}'::jsonb, '2029-08-13T12:00:00Z'::timestamptz - series * interval '1 second'
      from pg_catalog.generate_series(1, 110) series;
    `);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("revokes raw activity and delivery reads while preserving service-role webhook ingress", async () => {
    const privileges = await db.query<{
      activity_delete: boolean;
      activity_insert: boolean;
      activity_select: boolean;
      activity_update: boolean;
      delivery_insert: boolean;
      delivery_select: boolean;
      delivery_update: boolean;
      role_name: string;
    }>(`
      select role_name,
        has_table_privilege(role_name, 'public.activity_events', 'SELECT') as activity_select,
        has_table_privilege(role_name, 'public.activity_events', 'INSERT') as activity_insert,
        has_table_privilege(role_name, 'public.activity_events', 'UPDATE') as activity_update,
        has_table_privilege(role_name, 'public.activity_events', 'DELETE') as activity_delete,
        has_table_privilege(role_name, 'public.github_webhook_deliveries', 'SELECT') as delivery_select,
        has_table_privilege(role_name, 'public.github_webhook_deliveries', 'INSERT') as delivery_insert,
        has_table_privilege(role_name, 'public.github_webhook_deliveries', 'UPDATE') as delivery_update
      from unnest(array['anon','authenticated','service_role']) role_name
      order by role_name
    `);
    expect(privileges.rows).toEqual([
      {
        activity_delete: false,
        activity_insert: false,
        activity_select: false,
        activity_update: false,
        delivery_insert: false,
        delivery_select: false,
        delivery_update: false,
        role_name: "anon",
      },
      {
        activity_delete: false,
        activity_insert: false,
        activity_select: false,
        activity_update: false,
        delivery_insert: false,
        delivery_select: false,
        delivery_update: false,
        role_name: "authenticated",
      },
      {
        activity_delete: false,
        activity_insert: false,
        activity_select: false,
        activity_update: false,
        delivery_insert: true,
        delivery_select: true,
        delivery_update: true,
        role_name: "service_role",
      },
    ]);

    for (const role of ["anon", "authenticated"] as const) {
      await assumeRole(db, role, role === "authenticated" ? viewerOneId : null);
      await expect(db.query("select id from public.activity_events limit 1"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(db.query("select id from public.github_webhook_deliveries limit 1"))
        .rejects.toMatchObject({ code: "42501" });
    }

    await assumeRole(db, "service_role");
    await expect(db.query("select id from public.activity_events limit 1"))
      .rejects.toMatchObject({ code: "42501" });
    await expect(db.query("select id from public.github_webhook_deliveries limit 1"))
      .resolves.toMatchObject({ rows: [] });
    await resetRole(db);
  });

  it("grants only the caller-bound list RPC and keeps projection helpers private", async () => {
    const privileges = await db.query<{
      evidence_execute: boolean;
      list_execute: boolean;
      role_name: string;
      scalar_execute: boolean;
    }>(`
      select role_name,
        has_function_privilege(role_name, 'public.list_activity(uuid,integer)', 'EXECUTE') as list_execute,
        has_function_privilege(role_name, 'public.safe_activity_evidence(jsonb)', 'EXECUTE') as evidence_execute,
        has_function_privilege(role_name, 'public.activity_safe_scalar(jsonb,integer)', 'EXECUTE') as scalar_execute
      from unnest(array['anon','authenticated','service_role']) role_name
      order by role_name
    `);
    expect(privileges.rows).toEqual([
      { evidence_execute: false, list_execute: false, role_name: "anon", scalar_execute: false },
      { evidence_execute: false, list_execute: true, role_name: "authenticated", scalar_execute: false },
      { evidence_execute: false, list_execute: false, role_name: "service_role", scalar_execute: false },
    ]);

    for (const role of ["anon", "service_role"] as const) {
      await assumeRole(db, role);
      await expect(listActivity(db, organizationOneId, 1))
        .rejects.toMatchObject({ code: "42501" });
    }
    await resetRole(db);
  });

  it("returns only the exact member tenant and reviewed output columns", async () => {
    await assumeRole(db, "authenticated", viewerOneId);
    const ownRows = await listActivity(db, organizationOneId, 2);
    expect(ownRows.rows).toHaveLength(2);
    expect(Object.keys(ownRows.rows[0] ?? {}).sort()).toEqual([
      "actor_display_name",
      "actor_user_id",
      "description",
      "entity_id",
      "entity_type",
      "event_type",
      "evidence",
      "id",
      "occurred_at",
      "project_id",
      "project_name",
    ]);
    expect(ownRows.rows.every((row) => row.project_name === "Tenant One Project")).toBe(true);
    expect(await listActivity(db, organizationTwoId, 100)).toMatchObject({ rows: [] });

    await assumeRole(db, "authenticated", ownerTwoId);
    const tenantTwoRows = await listActivity(db, organizationTwoId, 100);
    expect(tenantTwoRows.rows).toContainEqual(expect.objectContaining({
      actor_display_name: "Owner Two",
      description: "Other tenant activity",
      project_name: "Tenant Two Project",
    }));
    expect(JSON.stringify(tenantTwoRows.rows)).not.toContain("Tenant One");
  });

  it("projects only bounded allowlisted evidence and never raw metadata", async () => {
    await assumeRole(db, "authenticated", viewerOneId);
    const rows = await db.query<{ evidence: Record<string, unknown>; id: string }>(`
      select id, evidence
      from public.list_activity('${organizationOneId}', 100)
      where id in ('${safeEventId}', '${unsafeEventId}')
      order by id
    `);
    expect(rows.rows).toEqual([
      {
        evidence: {
          action: "opened",
          conclusion: "success",
          delivery_id: "delivery-123",
          github_actor: { login: "safe-actor" },
          repository: "tenant-one/application",
          resource_number: "42",
          resource_type: "pull_request",
          source: "github",
          state_transition: "applied",
          status: "completed",
        },
        id: safeEventId,
      },
      { evidence: { source: "github" }, id: unsafeEventId },
    ]);
    expect(JSON.stringify(rows.rows)).not.toMatch(
      /arbitrary_blob|must-not-leave|avatar_url|private_context|tracking\.example|x{80}/,
    );
  });

  it("bounds direct display text and keeps token-shaped descriptions out at the row guard", async () => {
    await assumeRole(db, "authenticated", viewerOneId);
    const bounded = await db.query<{
      description_length: number;
      entity_type_length: number;
    }>(`
      select char_length(description)::integer as description_length,
        char_length(entity_type)::integer as entity_type_length
      from public.list_activity('${organizationOneId}', 100)
      where id = '${unsafeEventId}'
    `);
    expect(bounded.rows).toEqual([{ description_length: 23, entity_type_length: 63 }]);

    await resetRole(db);
    await expect(db.query(`
      insert into public.activity_events (
        organization_id, event_type, entity_type, description, metadata
      ) values (
        '${organizationOneId}', 'project.updated', 'project',
        'Bearer abcdefghijklmnopqrstuvwxyz123456', '{}'::jsonb
      )
    `)).rejects.toMatchObject({ code: "23514" });
  });

  it("keeps the pure evidence helper invoker-rights and non-callable", async () => {
    await resetRole(db);
    const catalog = await db.query<{ evidence_security_definer: boolean }>(`
      select procedure.prosecdef as evidence_security_definer
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'safe_activity_evidence'
    `);
    expect(catalog.rows).toEqual([{ evidence_security_definer: false }]);

    await assumeRole(db, "authenticated", viewerOneId);
    await expect(db.query("select public.safe_activity_evidence('{}'::jsonb)"))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("clamps the database row count to 1..100 and defaults null to 50", async () => {
    await assumeRole(db, "authenticated", viewerOneId);
    expect((await listActivity(db, organizationOneId, 0)).rows).toHaveLength(1);
    expect((await listActivity(db, organizationOneId, 1_000)).rows).toHaveLength(100);
    expect((await listActivity(db, organizationOneId, null)).rows).toHaveLength(50);
  });

  it("retains RLS and FORCE RLS on both protected raw tables", async () => {
    await resetRole(db);
    const security = await db.query<{
      policy_count: number;
      relforcerowsecurity: boolean;
      relname: string;
      relrowsecurity: boolean;
    }>(`
      select class.relname, class.relrowsecurity, class.relforcerowsecurity,
        count(policy.oid)::integer as policy_count
      from pg_catalog.pg_class class
      join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      left join pg_catalog.pg_policy policy on policy.polrelid = class.oid
      where namespace.nspname = 'public'
        and class.relname in ('activity_events', 'github_webhook_deliveries')
      group by class.relname, class.relrowsecurity, class.relforcerowsecurity
      order by class.relname
    `);
    expect(security.rows).toHaveLength(2);
    expect(security.rows.every((row) => (
      row.relrowsecurity && row.relforcerowsecurity && row.policy_count > 0
    ))).toBe(true);
  });
});
