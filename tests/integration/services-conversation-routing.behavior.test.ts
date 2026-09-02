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
 * Conversation routing (ADR-240) against the real chain: the suggestion
 * walks branch manager → territory rep → least-loaded CSR → nobody and
 * says which step chose it; an assignment is recorded on the account's
 * timeline by name; the queue lists the unassigned first with their
 * suggestion; and a rival sees none of it.
 */

const acmeOwner = "00000000-0000-4000-8000-000000040001";
const rivalOwner = "00000000-0000-4000-8000-000000040002";
const acmeOrg = "10000000-0000-4000-8000-000000040001";
const rivalOrg = "10000000-0000-4000-8000-000000040002";

describe("conversation routing", { timeout: 240_000 }, () => {
  let db: PGlite;
  let harborview = ""; let oldMill = ""; let inTerritory = ""; let outside = "";
  let manager = ""; let rep = ""; let csr = ""; let dispatcher = "";

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

  async function suggestion(request: string) {
    return (await db.query<{ employee_id: string | null; employee_name: string | null; role: string | null; reason: string; territory_code: string | null; postal_code: string | null; open_requests: number | null }>(
      `select * from public.crm_request_suggested_assignee($1, $2)`, [acmeOrg, request])).rows[0];
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
      values ('${acmeOrg}', 'Acme Pest', 'acme-pest-routing', '${acmeOwner}'),
             ('${rivalOrg}', 'Rival Pest', 'rival-pest-routing', '${rivalOwner}');
    `);
    await as(acmeOwner);
    const north = (await db.query<{ id: string }>(
      `insert into public.crm_branches (organization_id, name, code, created_by) values ($1, 'North', 'NORTH', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    const employee = async (code: string, first: string, last: string, role: string, branch: string | null, userId: string | null = null) => (await db.query<{ id: string }>(
      `insert into public.crm_employees (organization_id, branch_id, user_id, employee_code, first_name, last_name, role, created_by)
       values ($1, $2, $3, $4, $5, $6, $7::public.crm_employee_role, $8) returning id`,
      [acmeOrg, branch, userId, code, first, last, role, acmeOwner])).rows[0].id;
    manager = await employee("MGR-1", "Ana", "Cruz", "branch_manager", north, acmeOwner);
    rep = await employee("REP-1", "Ben", "Ortiz", "sales_rep", north);
    csr = await employee("CSR-1", "Cara", "Diaz", "csr", north);
    dispatcher = await employee("DSP-1", "Dev", "Ahmed", "dispatcher", north);
    await db.query(
      `insert into public.crm_territories (organization_id, branch_id, rep_id, name, code, postal_codes, created_by)
       values ($1, $2, $3, 'Monterey', 'N1', array['93940'], $4)`, [acmeOrg, north, rep, acmeOwner]);

    harborview = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, billing_address, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', '4100 Cannery Row, Monterey 93940', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    oldMill = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, billing_address, created_by)
       values ($1, 'Old Mill', 'residential', 'customer', '9 Mill Road, Nowhere 10001', $2) returning id`, [acmeOrg, acmeOwner])).rows[0].id;
    const request = async (account: string, summary: string) => (await db.query<{ id: string }>(
      `insert into public.crm_portal_requests (organization_id, account_id, kind, summary, created_by)
       values ($1, $2, 'question', $3, $4) returning id`, [acmeOrg, account, summary, acmeOwner])).rows[0].id;
    inTerritory = await request(harborview, "Ants in the dry store");
    outside = await request(oldMill, "Gate code changed");
  });

  afterAll(async () => { await db?.close(); });

  it("suggests the branch manager, then the territory rep, then the least-loaded CSR, then nobody — and says which step chose", async () => {
    await as(acmeOwner);
    expect(await suggestion(inTerritory)).toMatchObject({
      employee_id: manager, employee_name: "Ana Cruz", role: "branch_manager", territory_code: "N1", postal_code: "93940", open_requests: 0,
      reason: "branch manager of North; the address's postal code 93940 is in territory N1",
    });
    await db.query(`update public.crm_employees set active = false where id = $1`, [manager]);
    expect(await suggestion(inTerritory)).toMatchObject({
      employee_id: rep, employee_name: "Ben Ortiz", role: "sales_rep",
      reason: "rep for territory N1 (postal code 93940); North has no active branch manager",
    });

    // Load counts: give the CSR one open request, and the dispatcher is now the lighter pair of hands.
    await db.query(`select public.crm_request_assign($1, $2, $3)`, [acmeOrg, outside, csr]);
    await db.query(`update public.crm_employees set active = false where id = $1`, [rep]);
    expect(await suggestion(inTerritory)).toMatchObject({
      employee_id: dispatcher, employee_name: "Dev Ahmed", role: "dispatcher", open_requests: 0,
      reason: "least-loaded dispatcher (0 open); territory N1 has no active branch manager or rep",
    });
    expect(await suggestion(outside)).toMatchObject({
      employee_id: dispatcher, territory_code: null, postal_code: null,
      reason: "least-loaded dispatcher (0 open); the address matches no active territory",
    });
    // Ties break by name: with equal loads, Ahmed comes before Diaz.
    await db.query(`select public.crm_request_assign($1, $2, null)`, [acmeOrg, outside]);
    expect((await suggestion(outside)).employee_name).toBe("Dev Ahmed");

    await db.query(`update public.crm_employees set active = false where id in ($1, $2)`, [csr, dispatcher]);
    expect((await suggestion(inTerritory)).reason).toBe("nobody: territory N1 has no active branch manager or rep, and no active CSR or dispatcher is on the book");
    expect((await suggestion(outside)).reason).toBe("nobody: the address matches no active territory and no active CSR or dispatcher is on the book");
    expect((await suggestion(outside)).employee_id).toBeNull();
    await db.query(`update public.crm_employees set active = true where id in ($1, $2, $3, $4)`, [manager, rep, csr, dispatcher]);
  });

  it("records an assignment on the account's timeline by name, refuses an inactive person, and unassigns", async () => {
    await as(acmeOwner);
    await db.query(`select public.crm_request_assign($1, $2, $3)`, [acmeOrg, inTerritory, manager]);
    const row = (await db.query<{ assignee_employee_id: string; assigned_by: string; assigned_at: string | null }>(
      `select assignee_employee_id, assigned_by, assigned_at from public.crm_portal_requests where id = $1`, [inTerritory])).rows[0];
    expect(row.assignee_employee_id).toBe(manager);
    expect(row.assigned_by).toBe(acmeOwner);
    expect(row.assigned_at).not.toBeNull();
    const notes = (await db.query<{ summary: string }>(
      `select summary from public.crm_timeline_events where account_id = $1 and kind = 'note' order by occurred_at`, [harborview])).rows.map((entry) => entry.summary);
    expect(notes).toContain("Request assigned to Ana Cruz.");

    await db.query(`update public.crm_employees set active = false where id = $1`, [rep]);
    expect(await rejects(() => db.query(`select public.crm_request_assign($1, $2, $3)`, [acmeOrg, inTerritory, rep]))).toMatch(/not an active member of staff/);
    await db.query(`update public.crm_employees set active = true where id = $1`, [rep]);
    expect(await rejects(() => db.query(`update public.crm_portal_requests set assignee_employee_id = null where id = $1`, [inTerritory]))).toMatch(/assignment_whole/);

    await db.query(`select public.crm_request_assign($1, $2, null)`, [acmeOrg, inTerritory]);
    expect(Number((await db.query<{ n: string | number }>(`select count(*) as n from public.crm_timeline_events where account_id = $1 and summary = 'Request unassigned.'`, [harborview])).rows[0].n)).toBe(1);

    // A rival can see neither acme's people nor its requests: whichever check speaks first refuses.
    await as(rivalOwner);
    expect(await rejects(() => db.query(`select public.crm_request_assign($1, $2, $3)`, [acmeOrg, inTerritory, manager]))).toMatch(/no such request|not an active member/);
    expect(await rejects(() => db.query(`select public.crm_request_assign($1, $2, null)`, [acmeOrg, inTerritory]))).toMatch(/no such request/);
  });

  it("queues the unassigned first with their suggestion, names who has the rest, and knows the caller's own record", async () => {
    await as(acmeOwner);
    await db.query(`select public.crm_request_assign($1, $2, $3)`, [acmeOrg, outside, csr]);
    const queue = (await db.query<{ summary: string; assignee_name: string | null; suggested_name: string | null; suggested_reason: string | null; account_name: string }>(
      `select summary, assignee_name, suggested_name, suggested_reason, account_name from public.crm_request_queue($1)`, [acmeOrg])).rows;
    expect(queue.map((row) => [row.summary, row.assignee_name, row.suggested_name])).toEqual([
      ["Ants in the dry store", null, "Ana Cruz"],
      ["Gate code changed", "Cara Diaz", null],
    ]);
    expect(queue[0].suggested_reason).toMatch(/^branch manager of North/);
    expect((await db.query<{ id: string | null }>(`select public.crm_my_employee() as id`)).rows[0].id).toBe(manager);
    await db.query(`update public.crm_portal_requests set status = 'resolved', resolved_at = now() where id = $1`, [outside]);
    expect((await db.query(`select 1 from public.crm_request_queue($1)`, [acmeOrg])).rows).toHaveLength(1);

    await as(rivalOwner);
    expect((await db.query(`select 1 from public.crm_request_queue($1)`, [acmeOrg])).rows).toHaveLength(0);
    expect((await db.query<{ id: string | null }>(`select public.crm_my_employee() as id`)).rows[0].id).toBeNull();
  });

  it("grants the five functions to authenticated only, all invoker", async () => {
    await db.exec("reset role");
    const rows = (await db.query<{ name: string; definer: boolean; anon: boolean; authenticated: boolean; service: boolean }>(
      `select p.proname as name, p.prosecdef as definer,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('crm_my_employee', 'crm_request_open_load', 'crm_request_suggested_assignee', 'crm_request_assign', 'crm_request_queue')
        order by 1`)).rows;
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => !row.definer && !row.anon && row.authenticated && !row.service)).toBe(true);
  });
});
