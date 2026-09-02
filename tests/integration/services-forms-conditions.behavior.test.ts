// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LATEST_MIGRATION } from "../support/latest-migration";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

/**
 * The form asks the next question (ADR-238) against the real chain: a
 * condition points only at an earlier question of the same form and fits
 * its type; "asked" is arithmetic over the answers present, up the whole
 * chain; "completed" counts only asked required questions; an answer to
 * an unasked question is refused; and a visit whose service type a
 * template names gets that form assigned once, the moment it is created.
 */

const acmeOwner = "00000000-0000-4000-8000-000000038001";
const rivalOwner = "00000000-0000-4000-8000-000000038002";
const acmeOrg = "10000000-0000-4000-8000-000000038001";
const rivalOrg = "10000000-0000-4000-8000-000000038002";

describe("conditional questions and service-type-triggered forms", { timeout: 240_000 }, () => {
  let db: PGlite;
  let template = ""; let pests = ""; let which = ""; let rodentBait = ""; let notes = ""; let count = "";
  let account = ""; let property = ""; let rosa = "";

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function rejects(run: () => Promise<unknown>): Promise<string> {
    try {
      await run();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error("expected the statement to be rejected");
  }

  async function field(templateId: string, position: number, label: string, fieldType: string, required: boolean, options: string[] | null, dependsOn: string | null, showWhen: Record<string, unknown> | null) {
    return (await db.query<{ id: string }>(
      `insert into public.crm_form_fields
         (organization_id, template_id, position, label, field_type, required, options, depends_on_field_id, show_when)
       values ($1, $2, $3, $4, $5::public.crm_field_type, $6, $7, $8, $9::jsonb) returning id`,
      [acmeOrg, templateId, position, label, fieldType, required, options, dependsOn, showWhen === null ? null : JSON.stringify(showWhen)],
    )).rows[0].id;
  }

  async function instance(templateId: string) {
    return (await db.query<{ id: string }>(
      `insert into public.crm_form_instances (organization_id, template_id, created_by) values ($1, $2, $3) returning id`,
      [acmeOrg, templateId, acmeOwner])).rows[0].id;
  }

  async function answer(instanceId: string, fieldId: string, column: string, value: unknown) {
    await db.query(
      `insert into public.crm_form_answers (organization_id, instance_id, field_id, ${column}, created_by)
       values ($1, $2, $3, $4, $5)
       on conflict (organization_id, instance_id, field_id) do update set ${column} = excluded.${column}`,
      [acmeOrg, instanceId, fieldId, value, acmeOwner]);
  }

  async function asked(instanceId: string) {
    return (await db.query<{ label: string; asked: boolean; answered: boolean; depends_on_label: string | null }>(
      `select label, asked, answered, depends_on_label from public.crm_form_instance_questions($1)`, [instanceId])).rows;
  }

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        email text,
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
      grant usage on schema auth to anon, authenticated, service_role;
    `);
    const migrationFiles = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
    expect(migrationFiles.at(-1)).toBe(LATEST_MIGRATION);
    for (const file of migrationFiles) {
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
      values ('${acmeOrg}', 'Acme Pest', 'acme-pest-conditions', '${acmeOwner}'),
             ('${rivalOrg}', 'Rival Pest', 'rival-pest-conditions', '${rivalOwner}');
    `);
    await as(acmeOwner);
    template = (await db.query<{ id: string }>(
      `insert into public.crm_form_templates (organization_id, name, kind, version, created_by)
       values ($1, 'Service report', 'service_report', 1, $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    pests = await field(template, 1, "Pests found?", "boolean", true, null, null, null);
    which = await field(template, 2, "Which pests?", "multi_select", true, ["ants", "roaches", "rodents"], pests, { op: "is_true" });
    rodentBait = await field(template, 3, "Rodent bait placed?", "boolean", true, null, which, { op: "any_of", values: ["rodents"] });
    notes = await field(template, 4, "Notes for the customer", "long_text", true, null, null, null);
    count = await field(template, 5, "Stations serviced", "number", true, null, pests, { op: "is_true" });

    account = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    property = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Plant', '1 Loaf Lane') returning id`, [acmeOrg, account])).rows[0].id;
    rosa = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, last_name, created_by)
       values ($1, 'Rosa', 'Vega', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
  });

  afterAll(async () => { await db?.close(); });

  it("shapes a condition: an earlier question of the same form, an op that fits it, exactly its operand", async () => {
    await as(acmeOwner);
    const shape = (await db.query<{ id: string }>(
      `insert into public.crm_form_templates (organization_id, name, kind, version, created_by)
       values ($1, 'Shape check', 'inspection', 1, $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    const yesNo = await field(shape, 1, "Any activity?", "boolean", false, null, null, null);
    const text = await field(shape, 2, "Where?", "text", false, null, yesNo, { op: "is_true" });
    const other = (await db.query<{ id: string }>(
      `insert into public.crm_form_templates (organization_id, name, kind, version, created_by)
       values ($1, 'Other form', 'inspection', 1, $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    const otherField = await field(other, 1, "Elsewhere", "boolean", false, null, null, null);
    // Depending on an earlier question of the same form is the normal case; "Where?" above is one.
    expect(await rejects(() => field(shape, 3, "Bad parent", "text", false, null, otherField, { op: "answered" }))).toMatch(/same form/);
    expect(await rejects(() => field(shape, 0, "Too early", "text", false, null, yesNo, { op: "answered" }))).toMatch(/position|earlier/);
    expect(await rejects(() => field(shape, 3, "Wrong op", "text", false, null, text, { op: "is_true" }))).toMatch(/yes\/no question/);
    expect(await rejects(() => field(shape, 3, "Bad op", "text", false, null, yesNo, { op: "sometimes" }))).toMatch(/show_when_shape/);
    expect(await rejects(() => field(shape, 3, "No value", "text", false, null, text, { op: "equals" }))).toMatch(/show_when_shape/);
    expect(await rejects(() => field(shape, 3, "Extra value", "text", false, null, yesNo, { op: "answered", value: "x" }))).toMatch(/show_when_shape/);
    expect(await rejects(() => field(shape, 3, "Half", "text", false, null, yesNo, null))).toMatch(/condition_whole/);
    // A parent cannot move past its child.
    expect(await rejects(() => db.query(`update public.crm_form_fields set position = 9 where id = $1`, [yesNo]))).toMatch(/move past/);
  });

  it("asks a question only when its whole chain of conditions is met, and counts completion over what is asked", async () => {
    await as(acmeOwner);
    const form = await instance(template);
    let rows = await asked(form);
    expect(rows.map((row) => [row.label, row.asked, row.answered])).toEqual([
      ["Pests found?", true, false],
      ["Which pests?", false, false],
      ["Rodent bait placed?", false, false],
      ["Notes for the customer", true, false],
      ["Stations serviced", false, false],
    ]);
    expect(rows[1].depends_on_label).toBe("Pests found?");
    expect(rows[2].depends_on_label).toBe("Which pests?");

    // Answering an unasked question is refused; the parent goes first.
    expect(await rejects(() => answer(form, which, "value_options", ["ants"]))).toMatch(/not asked/);

    await answer(form, pests, "value_boolean", false);
    await answer(form, notes, "value_text", "All clear.");
    // No pests: only the notes are required, and the form completes.
    await db.query(`update public.crm_form_instances set status = 'completed', completed_at = now() where id = $1`, [form]);
    await db.query(`update public.crm_form_instances set status = 'in_progress', completed_at = null where id = $1`, [form]);

    // Pests after all: two more questions open and one is required.
    await answer(form, pests, "value_boolean", true);
    rows = await asked(form);
    expect(rows.map((row) => row.asked)).toEqual([true, true, false, true, true]);
    // "Which pests?" and "Stations serviced" are both required and both asked now.
    expect(await rejects(() => db.query(`update public.crm_form_instances set status = 'completed', completed_at = now() where id = $1`, [form])))
      .toMatch(/2 required question\(s\) are unanswered/);
    await answer(form, which, "value_options", ["ants", "roaches"]);
    expect((await asked(form))[2].asked).toBe(false);
    expect(await rejects(() => db.query(`update public.crm_form_instances set status = 'completed', completed_at = now() where id = $1`, [form])))
      .toMatch(/1 required question\(s\) are unanswered/);
    await answer(form, which, "value_options", ["rodents"]);
    expect((await asked(form))[2].asked).toBe(true);
    expect(await rejects(() => db.query(`update public.crm_form_instances set status = 'completed', completed_at = now() where id = $1`, [form])))
      .toMatch(/2 required question\(s\) are unanswered/);
    await answer(form, rodentBait, "value_boolean", true);
    await answer(form, count, "value_number", 12);
    await db.query(`update public.crm_form_instances set status = 'completed', completed_at = now() where id = $1`, [form]);

    // The parent changes its mind: the child's answer is kept, hidden and uncounted.
    await db.query(`update public.crm_form_instances set status = 'in_progress', completed_at = null where id = $1`, [form]);
    await answer(form, which, "value_options", ["ants"]);
    rows = await asked(form);
    expect(rows[2]).toMatchObject({ label: "Rodent bait placed?", asked: false, answered: true });
    await db.query(`update public.crm_form_instances set status = 'completed', completed_at = now() where id = $1`, [form]);
  });

  it("assigns the form a visit's service type names, once, with the visit's account, site and technician", async () => {
    await as(acmeOwner);
    await db.query(`update public.crm_form_templates set trigger_service_types = array['Rodent control', 'General pest'] where id = $1`, [template]);
    expect(await rejects(() => db.query(`update public.crm_form_templates set trigger_service_types = array[''] where id = $1`, [template]))).toMatch(/triggers_bounded/);
    const retired = (await db.query<{ id: string }>(
      `insert into public.crm_form_templates (organization_id, name, kind, version, active, trigger_service_types, created_by)
       values ($1, 'Retired report', 'service_report', 1, false, array['Rodent control'], $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;

    const visit = (await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, service_type, scheduled_start, scheduled_end, status, created_by)
       values ($1, $2, $3, $4, '  rodent CONTROL ', now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled', $5) returning id`,
      [acmeOrg, account, property, rosa, acmeOwner])).rows[0].id;
    const assigned = (await db.query<{ template_id: string; account_id: string; property_id: string; technician_id: string; status: string; created_by: string }>(
      `select template_id, account_id, property_id, technician_id, status, created_by from public.crm_form_instances where work_order_id = $1`, [visit])).rows;
    expect(assigned).toEqual([{ template_id: template, account_id: account, property_id: property, technician_id: rosa, status: "assigned", created_by: acmeOwner }]);
    expect(assigned.map((row) => row.template_id)).not.toContain(retired);

    const unrelated = (await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, service_type, scheduled_start, scheduled_end, status, created_by)
       values ($1, $2, $3, $4, 'Termite inspection', now() + interval '2 day', now() + interval '2 day 1 hour', 'scheduled', $5) returning id`,
      [acmeOrg, account, property, rosa, acmeOwner])).rows[0].id;
    expect((await db.query(`select 1 from public.crm_form_instances where work_order_id = $1`, [unrelated])).rows).toHaveLength(0);
  });

  it("grants the readable functions to authenticated only and keeps the trigger functions to nobody", async () => {
    await db.exec("reset role");
    const rows = (await db.query<{ name: string; anon: boolean; authenticated: boolean; service: boolean; definer: boolean }>(
      `select p.proname as name, p.prosecdef as definer,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('crm_form_condition_met', 'crm_form_question_asked', 'crm_form_instance_questions',
                            'crm_check_field_condition', 'crm_check_answer_asked', 'crm_assign_forms_for_visit', 'crm_check_form_completeness')
        order by 1`)).rows;
    expect(rows).toEqual([
      { name: "crm_assign_forms_for_visit", definer: true, anon: false, authenticated: false, service: false },
      { name: "crm_check_answer_asked", definer: true, anon: false, authenticated: false, service: false },
      { name: "crm_check_field_condition", definer: true, anon: false, authenticated: false, service: false },
      { name: "crm_check_form_completeness", definer: true, anon: false, authenticated: false, service: false },
      { name: "crm_form_condition_met", definer: false, anon: false, authenticated: true, service: false },
      { name: "crm_form_instance_questions", definer: false, anon: false, authenticated: true, service: false },
      { name: "crm_form_question_asked", definer: false, anon: false, authenticated: true, service: false },
    ]);
    // A rival reads nothing of it.
    await as(rivalOwner);
    expect((await db.query(`select 1 from public.crm_form_instance_questions((select id from public.crm_form_instances limit 1))`)).rows).toHaveLength(0);
  });
});
