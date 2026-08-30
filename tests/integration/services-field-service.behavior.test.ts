// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260830001400_branches_org_sales.sql";

/**
 * Field service (ADR-189) against the real migration chain: completing a
 * work order writing the 'service' event is a definer trigger, completed_at
 * agreeing with the status is a trigger plus a CHECK, a visit landing only
 * on its own account's property is a three-column foreign key, and the
 * undeletable roster and schedule are missing grants. All schema promises —
 * none keepable by application code.
 */

const acmeOwner = "00000000-0000-4000-8000-0000000f0001";
const rivalOwner = "00000000-0000-4000-8000-0000000f0002";
const acmeOrg = "10000000-0000-4000-8000-0000000f0001";
const rivalOrg = "10000000-0000-4000-8000-0000000f0002";

describe("the field service core", { timeout: 240_000 }, () => {
  let db: PGlite;
  let accountId = "";
  let otherAccountId = "";
  let propertyId = "";
  let otherPropertyId = "";
  let technicianId = "";

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function reset() {
    await db.exec("reset role");
  }

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(migrationFiles.at(-1)).toBe(latestMigration);
    for (const file of migrationFiles) {
      // Hosted-style default privileges before the CRM window, as in the
      // other CRM chain suites.
      if (file === "20260830000500_services_crm_foundation.sql") {
        await db.exec(`
          alter default privileges in schema public grant all privileges on tables to authenticated;
          alter default privileges in schema public grant all privileges on tables to service_role;
        `);
      }
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${acmeOwner}'), ('${rivalOwner}');
      insert into public.organizations (id, name, slug, created_by)
      values
        ('${acmeOrg}', 'Acme Pest', 'acme-pest', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest', '${rivalOwner}');
    `);

    await as(acmeOwner);
    const account = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, created_by)
       values ($1, 'Harborview Foods', 'commercial', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    accountId = account.rows[0].id;
    const otherAccount = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, created_by)
       values ($1, 'Neighbor LLC', 'commercial', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    otherAccountId = otherAccount.rows[0].id;
    const property = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Distribution Center', '14 Dock Road') returning id`,
      [acmeOrg, accountId],
    );
    propertyId = property.rows[0].id;
    const otherProperty = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Neighbor Office', '2 Side Street') returning id`,
      [acmeOrg, otherAccountId],
    );
    otherPropertyId = otherProperty.rows[0].id;
    const technician = await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, last_name, created_by)
       values ($1, 'Miguel', 'Santos', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    technicianId = technician.rows[0].id;
    await reset();
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it("writes the service onto the account timeline when a visit completes — and only then", async () => {
    await as(acmeOwner);
    const order = await db.query<{ id: string; completed_at: string | null }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, service_type, scheduled_start, scheduled_end, created_by)
       values ($1, $2, $3, $4, 'Monthly IPM service', '2026-09-02T09:00:00Z', '2026-09-02T11:00:00Z', $5)
       returning id, completed_at`,
      [acmeOrg, accountId, propertyId, technicianId, acmeOwner],
    );
    const workOrderId = order.rows[0].id;
    expect(order.rows[0].completed_at).toBeNull();

    // Dispatch progress is not history.
    await db.query("update public.crm_work_orders set status = 'dispatched' where id = $1", [workOrderId]);
    const midway = await db.query<{ count: number }>(
      `select count(*)::integer as count from public.crm_timeline_events
        where account_id = $1 and kind = 'service'`,
      [accountId],
    );
    expect(midway.rows[0].count).toBe(0);

    const completed = await db.query<{ completed_at: string | null }>(
      `update public.crm_work_orders
          set status = 'completed', completion_notes = 'Stations serviced; two rebaited at the north fence.'
        where id = $1 returning completed_at`,
      [workOrderId],
    );
    expect(completed.rows[0].completed_at).not.toBeNull();

    const trail = await db.query<{ summary: string; detail: string | null; actor_user_id: string | null }>(
      `select summary, detail, actor_user_id from public.crm_timeline_events
        where account_id = $1 and kind = 'service'`,
      [accountId],
    );
    expect(trail.rows).toEqual([
      {
        summary: "Service completed: Monthly IPM service.",
        detail: "Property: Distribution Center. Stations serviced; two rebaited at the north fence.",
        actor_user_id: acmeOwner,
      },
    ]);
    await reset();
  });

  it("records a cancellation as the status change it is", async () => {
    await as(acmeOwner);
    const order = await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, service_type, scheduled_start, scheduled_end, created_by)
       values ($1, $2, $3, 'Trap check', '2026-09-05T09:00:00Z', '2026-09-05T10:00:00Z', $4)
       returning id`,
      [acmeOrg, accountId, propertyId, acmeOwner],
    );
    await db.query("update public.crm_work_orders set status = 'cancelled' where id = $1", [order.rows[0].id]);
    const trail = await db.query<{ summary: string }>(
      `select summary from public.crm_timeline_events
        where account_id = $1 and kind = 'status_change' and summary like 'Work order%'`,
      [accountId],
    );
    expect(trail.rows).toEqual([{ summary: "Work order cancelled: Trap check." }]);
    await reset();
  });

  it("refuses a visit at another account's property, even inside the same organization", async () => {
    await as(acmeOwner);
    await expect(db.query(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, service_type, scheduled_start, scheduled_end, created_by)
       values ($1, $2, $3, 'Misdirected visit', '2026-09-02T09:00:00Z', '2026-09-02T10:00:00Z', $4)`,
      [acmeOrg, accountId, otherPropertyId, acmeOwner],
    )).rejects.toThrow(/foreign key|not present/i);
    await reset();
  });

  it("keeps tenants apart and the roster and schedule undeletable", async () => {
    await as(rivalOwner);
    const seen = await db.query<{ technicians: number; orders: number }>(
      `select
         (select count(*)::integer from public.crm_technicians where organization_id = $1) as technicians,
         (select count(*)::integer from public.crm_work_orders where organization_id = $1) as orders`,
      [acmeOrg],
    );
    expect(seen.rows[0]).toEqual({ technicians: 0, orders: 0 });
    await reset();

    await as(acmeOwner);
    await expect(db.query("delete from public.crm_technicians where id = $1", [technicianId]))
      .rejects.toThrow(/permission denied/);
    await expect(db.query("delete from public.crm_work_orders where account_id = $1", [accountId]))
      .rejects.toThrow(/permission denied/);
    await expect(db.query("delete from public.crm_service_plans where account_id = $1", [accountId]))
      .rejects.toThrow(/permission denied/);
    await reset();
  });

  it("shuts anon and service_role out of the field-service tables entirely", async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    for (const role of ["anon", "service_role"]) {
      await db.exec(`set role ${role}`);
      for (const table of ["crm_technicians", "crm_service_plans", "crm_work_orders"]) {
        await expect(db.query(`select count(*) from public.${table}`))
          .rejects.toThrow(/permission denied/);
      }
      await db.exec("reset role");
    }
  });
});
