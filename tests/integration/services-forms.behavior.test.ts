// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LATEST_MIGRATION } from "../support/latest-migration";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = LATEST_MIGRATION;

/**
 * The forms and inspections engine, timesheets and licence expiry (ADR-197)
 * against the real migration chain.
 *
 * A form's value is entirely in whether its data can be trusted later. So
 * the questions freeze once a form is assigned from them, an answer lands
 * in the column its question's type calls for, "completed" is arithmetic
 * over the required questions rather than a claim, a signature is whole or
 * absent, and a technician cannot be in two places at once. All five are
 * the database's, under hosted-style default privileges.
 */

const acmeOwner = "00000000-0000-4000-8000-00000000b201";
const rivalOwner = "00000000-0000-4000-8000-00000000b202";
const acmeOrg = "10000000-0000-4000-8000-00000000b201";
const rivalOrg = "10000000-0000-4000-8000-00000000b202";

describe("forms, timesheets and licences", { timeout: 240_000 }, () => {
  let db: PGlite;
  let branchId = "";
  let managerId = "";
  let repId = "";

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
      // Hosted grants ALL on every new table by default, so the CRM chain is
      // replayed under that posture: a capability expressed as the ABSENCE
      // of a grant only means something if the default was there to revoke.
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
    const branch = await db.query<{ id: string }>(
      `insert into public.crm_branches (organization_id, code, name, time_zone, opened_on, created_by)
       values ($1, 'BR-NORTH', 'North Branch', 'America/Denver', current_date - 900, $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    branchId = branch.rows[0].id;

    const manager = await db.query<{ id: string }>(
      `insert into public.crm_employees
         (organization_id, branch_id, employee_code, first_name, last_name, role, commission_bps, created_by)
       values ($1, $2, 'EMP-1', 'Rosa', 'Ibarra', 'branch_manager', 500, $3) returning id`,
      [acmeOrg, branchId, acmeOwner],
    );
    managerId = manager.rows[0].id;

    const rep = await db.query<{ id: string }>(
      `insert into public.crm_employees
         (organization_id, branch_id, reports_to_id, employee_code, first_name, last_name,
          role, commission_bps, monthly_quota_cents, created_by)
       values ($1, $2, $3, 'EMP-2', 'Dev', 'Okafor', 'sales_rep', 750, 4000000, $4) returning id`,
      [acmeOrg, branchId, managerId, acmeOwner],
    );
    repId = rep.rows[0].id;

    await db.query(
      "update public.crm_branches set manager_id = $1 where id = $2",
      [managerId, branchId],
    );

    // A customer for the forms to be about; the suite reaches it through
    // the instances rather than by id.
    await db.query<{ id: string }>(
      `insert into public.crm_accounts
         (organization_id, name, kind, branch_id, owner_employee_id, created_by)
       values ($1, 'Harborview Foods', 'commercial', $2, $3, $4) returning id`,
      [acmeOrg, branchId, repId, acmeOwner],
    );
    await reset();
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  async function makeTemplate(name: string, version = 1) {
    const template = await db.query<{ id: string }>(
      `insert into public.crm_form_templates (organization_id, name, kind, version, created_by)
       values ($1, $2, 'inspection', $3, $4) returning id`,
      [acmeOrg, name, version, acmeOwner],
    );
    return template.rows[0].id;
  }

  async function makeField(
    templateId: string,
    position: number,
    label: string,
    fieldType: string,
    required = false,
    options: string[] | null = null,
  ) {
    const field = await db.query<{ id: string }>(
      `insert into public.crm_form_fields
         (organization_id, template_id, position, label, field_type, required, options)
       values ($1, $2, $3, $4, $5::public.crm_field_type, $6, $7) returning id`,
      [acmeOrg, templateId, position, label, fieldType, required, options],
    );
    return field.rows[0].id;
  }

  it("makes an answer land in the column its question's type calls for", async () => {
    await as(acmeOwner);
    const template = await makeTemplate("Shape check");
    const numberField = await makeField(template, 1, "Stations serviced", "number");
    const instance = await db.query<{ id: string }>(
      `insert into public.crm_form_instances (organization_id, template_id, created_by)
       values ($1, $2, $3) returning id`,
      [acmeOrg, template, acmeOwner],
    );

    // Prose in a number question is refused by the trigger, by name.
    await expect(
      db.query(
        `insert into public.crm_form_answers
           (organization_id, instance_id, field_id, value_text, created_by)
         values ($1, $2, $3, 'about a dozen', $4)`,
        [acmeOrg, instance.rows[0].id, numberField, acmeOwner],
      ),
    ).rejects.toThrow(/cannot be answered with a text value/);

    const accepted = await db.query<{ value_number: string }>(
      `insert into public.crm_form_answers
         (organization_id, instance_id, field_id, value_number, created_by)
       values ($1, $2, $3, 12, $4) returning value_number::text`,
      [acmeOrg, instance.rows[0].id, numberField, acmeOwner],
    );
    expect(Number(accepted.rows[0].value_number)).toBe(12);
    await reset();
  });

  it("refuses a choice answer that is not one of the choices offered", async () => {
    await as(acmeOwner);
    const template = await makeTemplate("Choice check");
    const select = await makeField(template, 1, "Severity", "select", false, ["low", "moderate", "high"]);
    const multi = await makeField(template, 2, "Pests seen", "multi_select", false, ["ants", "roaches", "rodents"]);
    const instance = await db.query<{ id: string }>(
      `insert into public.crm_form_instances (organization_id, template_id, created_by)
       values ($1, $2, $3) returning id`,
      [acmeOrg, template, acmeOwner],
    );
    const instanceId = instance.rows[0].id;

    await expect(
      db.query(
        `insert into public.crm_form_answers
           (organization_id, instance_id, field_id, value_text, created_by)
         values ($1, $2, $3, 'catastrophic', $4)`,
        [acmeOrg, instanceId, select, acmeOwner],
      ),
    ).rejects.toThrow(/not one of the choices offered/);

    await expect(
      db.query(
        `insert into public.crm_form_answers
           (organization_id, instance_id, field_id, value_options, created_by)
         values ($1, $2, $3, array['ants', 'wasps'], $4)`,
        [acmeOrg, instanceId, multi, acmeOwner],
      ),
    ).rejects.toThrow(/not among the choices offered/);

    // And the real choices are accepted, so the rule discriminates.
    const good = await db.query<{ count: string }>(
      `insert into public.crm_form_answers
         (organization_id, instance_id, field_id, value_options, created_by)
       values ($1, $2, $3, array['ants', 'roaches'], $4)
       returning array_length(value_options, 1)::text as count`,
      [acmeOrg, instanceId, multi, acmeOwner],
    );
    expect(good.rows[0].count).toBe("2");
    await reset();
  });

  it("will not call a form complete while a required question is unanswered", async () => {
    await as(acmeOwner);
    const template = await makeTemplate("Completeness check");
    const required = await makeField(template, 1, "Bait consumed", "boolean", true);
    await makeField(template, 2, "Notes", "long_text", false);
    const instance = await db.query<{ id: string }>(
      `insert into public.crm_form_instances (organization_id, template_id, created_by)
       values ($1, $2, $3) returning id`,
      [acmeOrg, template, acmeOwner],
    );
    const instanceId = instance.rows[0].id;

    await expect(
      db.query(
        "update public.crm_form_instances set status = 'completed', completed_at = now() where id = $1",
        [instanceId],
      ),
    ).rejects.toThrow(/required question/);

    // Answer it, and the same transition is accepted.
    await db.query(
      `insert into public.crm_form_answers
         (organization_id, instance_id, field_id, value_boolean, created_by)
       values ($1, $2, $3, true, $4)`,
      [acmeOrg, instanceId, required, acmeOwner],
    );
    const completed = await db.query<{ status: string }>(
      `update public.crm_form_instances set status = 'completed', completed_at = now()
        where id = $1 returning status::text`,
      [instanceId],
    );
    expect(completed.rows[0].status).toBe("completed");
    await reset();
  });

  it("freezes a template's questions once a form has been assigned from it", async () => {
    await as(acmeOwner);
    const template = await makeTemplate("Frozen");
    await makeField(template, 1, "First question", "text");
    await db.query(
      `insert into public.crm_form_instances (organization_id, template_id, created_by)
       values ($1, $2, $3)`,
      [acmeOrg, template, acmeOwner],
    );

    await expect(makeField(template, 2, "Added later", "text")).rejects.toThrow(
      /publish a new version instead/,
    );

    // The remedy the refusal names actually works.
    const next = await makeTemplate("Frozen", 2);
    const added = await makeField(next, 1, "First question", "text");
    expect(added).toMatch(/^[0-9a-f-]{36}$/);
    await reset();
  });

  it("keeps a signature whole, or absent", async () => {
    await as(acmeOwner);
    const template = await makeTemplate("Signature check");
    const instance = await db.query<{ id: string }>(
      `insert into public.crm_form_instances (organization_id, template_id, created_by)
       values ($1, $2, $3) returning id`,
      [acmeOrg, template, acmeOwner],
    );

    // Two thirds of a signature is not a signature.
    await expect(
      db.query(
        `update public.crm_form_instances
            set signed_by_name = 'Dana Ruiz', signed_at = now()
          where id = $1`,
        [instance.rows[0].id],
      ),
    ).rejects.toThrow(/crm_form_instances_signature_complete/);

    // And the image is a stored path, never a link — the documents rule.
    await expect(
      db.query(
        `update public.crm_form_instances
            set signed_by_name = 'Dana Ruiz', signed_at = now(),
                signature_path = 'https://example.com/sig.png'
          where id = $1`,
        [instance.rows[0].id],
      ),
    ).rejects.toThrow(/signature_path/);

    const signed = await db.query<{ signed_by_name: string }>(
      `update public.crm_form_instances
          set signed_by_name = 'Dana Ruiz', signed_at = now(),
              signature_path = 'services/forms/sig-0001.png'
        where id = $1 returning signed_by_name`,
      [instance.rows[0].id],
    );
    expect(signed.rows[0].signed_by_name).toBe("Dana Ruiz");
    await reset();
  });

  it("will not put a technician in two places at once", async () => {
    await as(acmeOwner);
    const technician = await db.query<{ id: string }>(
      `insert into public.crm_technicians
         (organization_id, first_name, last_name, license_number, created_by)
       values ($1, 'Ilya', 'Novak', 'DEMO-APP-90001', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    const technicianId = technician.rows[0].id;

    await db.query(
      `insert into public.crm_timesheets
         (organization_id, technician_id, started_at, ended_at, created_by)
       values ($1, $2, now() - interval '5 hours', now() - interval '1 hour', $3)`,
      [acmeOrg, technicianId, acmeOwner],
    );

    await expect(
      db.query(
        `insert into public.crm_timesheets
           (organization_id, technician_id, started_at, ended_at, created_by)
         values ($1, $2, now() - interval '3 hours', now() - interval '2 hours', $3)`,
        [acmeOrg, technicianId, acmeOwner],
      ),
    ).rejects.toThrow(/already has a shift covering this time/);

    // A shift after the first is fine.
    const later = await db.query<{ id: string }>(
      `insert into public.crm_timesheets
         (organization_id, technician_id, started_at, created_by)
       values ($1, $2, now(), $3) returning id`,
      [acmeOrg, technicianId, acmeOwner],
    );
    expect(later.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);

    // A shift that ends before it starts, and one running past a day, are
    // both refused — the second is a forgotten clock-out, not a day's work.
    await expect(
      db.query(
        `insert into public.crm_timesheets
           (organization_id, technician_id, started_at, ended_at, created_by)
         values ($1, $2, now() - interval '40 days', now() - interval '41 days', $3)`,
        [acmeOrg, technicianId, acmeOwner],
      ),
    ).rejects.toThrow(/crm_timesheets_ended_after_started/);
    await expect(
      db.query(
        `insert into public.crm_timesheets
           (organization_id, technician_id, started_at, ended_at, created_by)
         values ($1, $2, now() - interval '40 days', now() - interval '38 days', $3)`,
        [acmeOrg, technicianId, acmeOwner],
      ),
    ).rejects.toThrow(/crm_timesheets_bounded/);
    await reset();
  });

  it("will not record a licence expiry with no licence behind it", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `insert into public.crm_technicians
           (organization_id, first_name, license_expires_on, created_by)
         values ($1, 'Nameless', current_date + 30, $2)`,
        [acmeOrg, acmeOwner],
      ),
    ).rejects.toThrow(/crm_technicians_expiry_needs_licence/);
    await reset();
  });

  it("gives nothing to anon or service_role, and lets nobody delete a form", async () => {
    await reset();
    const tables = [
      "crm_form_templates", "crm_form_fields", "crm_form_instances",
      "crm_form_answers", "crm_timesheets",
    ];
    const { rows } = await db.query<{ table_name: string; grantee: string; privilege_type: string }>(
      `select table_name, grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public'
          and grantee in ('anon', 'authenticated', 'service_role')
          and table_name = any($1)
        order by table_name, grantee, privilege_type`,
      [tables],
    );
    for (const row of rows) {
      expect(row.grantee, `${row.table_name} is reachable by ${row.grantee}`).toBe("authenticated");
      expect(row.privilege_type, `${row.table_name} grants ${row.privilege_type}`).not.toBe("DELETE");
    }
    expect(new Set(rows.map((row) => row.table_name)).size).toBe(tables.length);
    await reset();
  });

  it("keeps forms inside their own tenant", async () => {
    await as(acmeOwner);
    const template = await makeTemplate("Tenant check");
    await reset();

    await as(rivalOwner);
    const seen = await db.query("select id from public.crm_form_templates where id = $1", [template]);
    expect(seen.rows).toEqual([]);
    await expect(
      db.query(
        `insert into public.crm_form_instances (organization_id, template_id, created_by)
         values ($1, $2, $3)`,
        [rivalOrg, template, rivalOwner],
      ),
    ).rejects.toThrow(/crm_form_instances_template_same_org/);
    await reset();
  });
});
