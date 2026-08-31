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
 * WDO inspection reports (ADR-205) against the real migration chain.
 *
 * An NPMA-33 is a legal document, and the failure this suite is built
 * around is not a missing field. It is a report that READS AS CLEAN WHEN
 * NOBODY LOOKED — and its evil twin, a report that says "no visible
 * evidence" while a live-infestation finding sits on it. That second one
 * is how somebody gets a mortgage on a house with termites in it, so it
 * has its own test and the refusal is asserted in both directions.
 */

const acmeOwner = "00000000-0000-4000-8000-00000000d101";
const rivalOwner = "00000000-0000-4000-8000-00000000d102";
const acmeOrg = "10000000-0000-4000-8000-00000000d101";
const rivalOrg = "10000000-0000-4000-8000-00000000d102";
const customerLogin = "00000000-0000-4000-8000-00000000d111";
const rivalCustomerLogin = "00000000-0000-4000-8000-00000000d112";

describe("wood-destroying-organism reports", { timeout: 240_000 }, () => {
  let db: PGlite;

  let acmeAccount = "";
  let rivalAccount = "";
  let plantSite = "";
  let rivalSite = "";
  let inspector = "";
  let rivalInspector = "";

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function reset() {
    await db.exec("reset role");
  }

  async function newReport(
    options: { evidence: boolean; number: string; obstructions?: string | null },
  ): Promise<string> {
    const row = await db.query<{ id: string }>(
      `insert into public.crm_wdo_inspections
         (organization_id, account_id, property_id, inspector_technician_id, report_number,
          structures_inspected, visible_evidence, obstructions, created_by)
       values ($1, $2, $3, $4, $5, 'Main dwelling and detached garage', $6, $7, $8)
       returning id`,
      [
        acmeOrg, acmeAccount, plantSite, inspector, options.number,
        options.evidence, options.obstructions ?? null, acmeOwner,
      ],
    );
    return row.rows[0].id;
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

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
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
      insert into auth.users (id, email) values
        ('${customerLogin}', 'owner@harborview.example'),
        ('${rivalCustomerLogin}', 'owner@rivalgrocers.example');
      insert into public.organizations (id, name, slug, created_by)
      values
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-wdo', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-wdo', '${rivalOwner}');
    `);

    await as(acmeOwner);
    const account = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    acmeAccount = account.rows[0].id;
    const site = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Harborview Plant', '4100 Cannery Row, Portland') returning id`,
      [acmeOrg, acmeAccount],
    );
    plantSite = site.rows[0].id;
    const technician = await db.query<{ id: string }>(
      `insert into public.crm_technicians
         (organization_id, first_name, last_name, license_number, created_by)
       values ($1, 'Ada', 'Fernsby', 'WDO-90114', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    inspector = technician.rows[0].id;
    await db.query(
      `insert into public.crm_portal_users (organization_id, account_id, email, created_by)
       values ($1, $2, 'owner@harborview.example', $3)`,
      [acmeOrg, acmeAccount, acmeOwner],
    );
    await reset();

    await as(rivalOwner);
    const rival = await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Rival Grocers', 'commercial', 'customer', $2) returning id`,
      [rivalOrg, rivalOwner],
    );
    rivalAccount = rival.rows[0].id;
    const rivalProperty = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Rival DC', '77 Sideline Ave, Tacoma') returning id`,
      [rivalOrg, rivalAccount],
    );
    rivalSite = rivalProperty.rows[0].id;
    const rivalTech = await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, created_by)
       values ($1, 'Bo', $2) returning id`,
      [rivalOrg, rivalOwner],
    );
    rivalInspector = rivalTech.rows[0].id;
    await db.query(
      `insert into public.crm_portal_users (organization_id, account_id, email, created_by)
       values ($1, $2, 'owner@rivalgrocers.example', $3)`,
      [rivalOrg, rivalAccount, rivalOwner],
    );
    await reset();

    await as(customerLogin);
    await db.query("select public.crm_portal_accept_invitation()");
    await reset();
    await as(rivalCustomerLogin);
    await db.query("select public.crm_portal_accept_invitation()");
    await reset();
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it("will not accept an inspection that has not answered the headline question", async () => {
    await as(acmeOwner);
    // `visible_evidence` is NOT NULL by design: an inspector who has not
    // answered it has not finished the inspection, and the row must not be
    // able to exist looking like a clean result.
    await expect(
      db.query(
        `insert into public.crm_wdo_inspections
           (organization_id, account_id, property_id, inspector_technician_id, report_number,
            structures_inspected, created_by)
         values ($1, $2, $3, $4, 'WDO-NULL', 'Main dwelling', $5)`,
        [acmeOrg, acmeAccount, plantSite, inspector, acmeOwner],
      ),
    ).rejects.toThrow(/null value in column "visible_evidence"|not-null/i);
    await reset();
  });

  it("refuses to issue a report that claims evidence it never recorded", async () => {
    await as(acmeOwner);
    const report = await newReport({ evidence: true, number: "WDO-1001" });
    await expect(
      db.query("select public.crm_wdo_issue_report($1)", [report]),
    ).rejects.toThrow(/records no infestation, damage or previous infestation/);

    // Record what the inspector actually saw, and it issues.
    await db.query(
      `insert into public.crm_wdo_findings
         (organization_id, inspection_id, kind, organism, area, position_x, position_y, note, created_by)
       values ($1, $2, 'live_infestation', 'Eastern subterranean termite',
               'Crawlspace, NE corner joists', 0.3125, 0.7500,
               'Active mud tubes on two joists.', $3)`,
      [acmeOrg, report, acmeOwner],
    );
    // `select * from f(x)`, NOT `select (f(x)).*`. The second form
    // re-evaluates the function once per output column, so a VOLATILE
    // function that mutates runs fourteen times. That mistake has its own
    // test below, because the guard against it is what makes it safe.
    const issued = await db.query<{ status: string; issued_at: string | null }>(
      "select * from public.crm_wdo_issue_report($1)", [report],
    );
    expect(issued.rows[0].status).toBe("issued");
    expect(issued.rows[0].issued_at).not.toBeNull();
    await reset();
  });

  it("refuses to issue a report that calls a structure clean while a live infestation sits on it", async () => {
    // THE test. Everybody remembers to stop a report claiming evidence it
    // does not have. This is the inverse, and it is the one that puts
    // somebody in a house with termites in it.
    await as(acmeOwner);
    const report = await newReport({ evidence: false, number: "WDO-1002" });
    await db.query(
      `insert into public.crm_wdo_findings
         (organization_id, inspection_id, kind, organism, area, created_by)
       values ($1, $2, 'live_infestation', 'Drywood termite', 'Attic rafters', $3)`,
      [acmeOrg, report, acmeOwner],
    );
    await expect(
      db.query("select public.crm_wdo_issue_report($1)", [report]),
    ).rejects.toThrow(/says no visible evidence was observed while 1 adverse finding/);
    await reset();
  });

  it("issues a genuinely clean report, and a conducive condition does not make it dirty", async () => {
    await as(acmeOwner);
    const report = await newReport({
      evidence: false,
      number: "WDO-1003",
      obstructions: "Stored pallets against the south wall; that section was not inspected.",
    });
    // A conducive condition — standing water, wood-to-soil contact — is
    // worth recording and is NOT evidence of an organism. It must not block
    // an honest clean report.
    await db.query(
      `insert into public.crm_wdo_findings
         (organization_id, inspection_id, kind, area, note, created_by)
       values ($1, $2, 'conducive_condition', 'South foundation',
               'Wood-to-soil contact at two posts.', $3)`,
      [acmeOrg, report, acmeOwner],
    );
    const issued = await db.query<{ status: string }>(
      "select * from public.crm_wdo_issue_report($1)", [report],
    );
    expect(issued.rows[0].status).toBe("issued");
    await reset();
  });

  it("refuses a contradictory report issued by writing the column directly, not just through the function", async () => {
    /*
     * The check that a report cannot contradict its own findings spans two
     * tables, so it cannot be a CHECK — and it must not live only in
     * crm_wdo_issue_report, because that function is not the only door. A
     * member holds the same privileges through PostgREST and can PATCH
     * `status` straight onto the row.
     *
     * So the rule is on the trigger, and this test comes in through the
     * door the function does not guard. It is the whole reason the check
     * is where it is.
     */
    await as(acmeOwner);
    const report = await newReport({ evidence: false, number: "WDO-1006" });
    await db.query(
      `insert into public.crm_wdo_findings
         (organization_id, inspection_id, kind, organism, area, created_by)
       values ($1, $2, 'live_infestation', 'Formosan subterranean termite', 'Sill plate', $3)`,
      [acmeOrg, report, acmeOwner],
    );

    await expect(
      db.query(
        "update public.crm_wdo_inspections set status = 'issued', issued_at = now() where id = $1",
        [report],
      ),
    ).rejects.toThrow(/says no visible evidence was observed while 1 adverse finding/);

    // And the other direction, through the same door.
    const empty = await newReport({ evidence: true, number: "WDO-1007" });
    await expect(
      db.query(
        "update public.crm_wdo_inspections set status = 'issued', issued_at = now() where id = $1",
        [empty],
      ),
    ).rejects.toThrow(/records no infestation, damage or previous infestation/);

    // Both are still drafts: neither refusal left a half-issued document.
    const after = await db.query<{ status: string }>(
      "select status from public.crm_wdo_inspections where report_number in ('WDO-1006', 'WDO-1007')",
    );
    expect(after.rows.map((row) => row.status)).toEqual(["draft", "draft"]);

    // A direct write that does NOT contradict is allowed, and the trigger
    // fills in the moment rather than refusing the row for a caller who
    // set only the status.
    await db.query(
      `insert into public.crm_wdo_findings
         (organization_id, inspection_id, kind, area, created_by)
       values ($1, $2, 'visible_damage', 'Sill plate', $3)`,
      [acmeOrg, empty, acmeOwner],
    );
    await db.query(
      "update public.crm_wdo_inspections set status = 'issued' where id = $1", [empty],
    );
    const issued = await db.query<{ status: string; issued_at: string | null }>(
      "select status, issued_at from public.crm_wdo_inspections where id = $1", [empty],
    );
    expect(issued.rows[0].status).toBe("issued");
    expect(issued.rows[0].issued_at).not.toBeNull();
    await reset();
  });

  it("survives a caller who writes (f()).* and calls the issue function fourteen times", async () => {
    /*
     * `select (f(x)).*` expands to one evaluation of f PER OUTPUT COLUMN.
     * For a stable read that is merely wasteful; for a VOLATILE function
     * that mutates, it is fourteen writes from one line of application
     * code, and it looks completely ordinary in a code review.
     *
     * The already-issued guard is what makes that survivable, and the
     * outcome is better than merely loud. The second evaluation raises,
     * and because all fourteen happen inside ONE statement, the first
     * one's UPDATE rolls back with it. The report is left exactly as it
     * was — not issued twice, and not half-issued with a timestamp from a
     * call the caller never meant to make.
     *
     * That guard has to live in the FUNCTION, not the trigger, and this
     * test is what proves it: every evaluation in one statement shares the
     * same transaction `now()`, so a trigger comparing old and new
     * issued_at sees no difference and waves all fourteen through. Moving
     * the check to the trigger made this test fail, which is exactly what
     * it is for.
     */
    await as(acmeOwner);
    const report = await newReport({ evidence: false, number: "WDO-1005" });
    await expect(
      db.query("select (public.crm_wdo_issue_report($1)).*", [report]),
    ).rejects.toThrow(/was already issued on/);

    // The statement rolled back whole: the report is untouched, not
    // issued fourteen times and not left half-issued.
    const after = await db.query<{ status: string; issued_at: string | null }>(
      "select status, issued_at from public.crm_wdo_inspections where id = $1", [report],
    );
    expect(after.rows[0].status).toBe("draft");
    expect(after.rows[0].issued_at).toBeNull();

    // And issuing it properly still works afterwards.
    const proper = await db.query<{ status: string }>(
      "select * from public.crm_wdo_issue_report($1)", [report],
    );
    expect(proper.rows[0].status).toBe("issued");
    await reset();
  });

  it("freezes an issued report and its findings, and takes a correction as a new report", async () => {
    await as(acmeOwner);
    const issued = await db.query<{ id: string }>(
      "select id from public.crm_wdo_inspections where report_number = 'WDO-1003'",
    );
    const original = issued.rows[0].id;

    await expect(
      db.query("select public.crm_wdo_issue_report($1)", [original]),
    ).rejects.toThrow(/was already issued on/);

    await expect(
      db.query(
        "update public.crm_wdo_inspections set recommendation = 'Re-treat' where id = $1",
        [original],
      ),
    ).rejects.toThrow(/correct it with a new report that supersedes it/);

    await expect(
      db.query(
        `insert into public.crm_wdo_findings
           (organization_id, inspection_id, kind, area, created_by)
         values ($1, $2, 'visible_damage', 'Attic', $3)`,
        [acmeOrg, original, acmeOwner],
      ),
    ).rejects.toThrow(/is issued; its findings can no longer change/);

    // The correction is a NEW report that names the one it replaces.
    const correction = await db.query<{ id: string }>(
      `insert into public.crm_wdo_inspections
         (organization_id, account_id, property_id, inspector_technician_id, report_number,
          structures_inspected, visible_evidence, supersedes_id, created_by)
       values ($1, $2, $3, $4, 'WDO-1003-R1', 'Main dwelling and detached garage', true, $5, $6)
       returning id`,
      [acmeOrg, acmeAccount, plantSite, inspector, original, acmeOwner],
    );
    await db.query(
      `insert into public.crm_wdo_findings
         (organization_id, inspection_id, kind, organism, area, created_by)
       values ($1, $2, 'visible_damage', 'Carpenter ant', 'Attic rafters, south bay', $3)`,
      [acmeOrg, correction.rows[0].id, acmeOwner],
    );
    await db.query("select public.crm_wdo_issue_report($1)", [correction.rows[0].id]);
    await reset();
  });

  it("keeps a coordinate whole, and inside the diagram", async () => {
    await as(acmeOwner);
    const report = await newReport({ evidence: true, number: "WDO-1004" });

    // Half a coordinate is a mark nobody can place.
    await expect(
      db.query(
        `insert into public.crm_wdo_findings
           (organization_id, inspection_id, kind, area, position_x, created_by)
         values ($1, $2, 'visible_damage', 'Porch', 0.5, $3)`,
        [acmeOrg, report, acmeOwner],
      ),
    ).rejects.toThrow(/crm_wdo_findings_position_complete/);

    // And the diagram is a unit square; anything else is off the page.
    await expect(
      db.query(
        `insert into public.crm_wdo_findings
           (organization_id, inspection_id, kind, area, position_x, position_y, created_by)
         values ($1, $2, 'visible_damage', 'Porch', 1.5, 0.5, $3)`,
        [acmeOrg, report, acmeOwner],
      ),
    ).rejects.toThrow(/position_x/);

    // A finding with NO coordinates is legitimate and common — recorded
    // long before anybody puts a pin in a drawing.
    await db.query(
      `insert into public.crm_wdo_findings
         (organization_id, inspection_id, kind, area, created_by)
       values ($1, $2, 'previous_treatment', 'Perimeter, per 2019 notice', $3)`,
      [acmeOrg, report, acmeOwner],
    );
    await reset();
  });

  it("counts evidence and clean over ISSUED reports only, and reports what the diagram cannot draw", async () => {
    await as(acmeOwner);
    const summary = await db.query<{
      inspections: number;
      issued: number;
      drafts: number;
      with_evidence: number;
      clean: number;
      reports_with_obstructions: number;
      findings: number;
      unplaced_findings: number;
      latest_inspected_on: string;
    }>("select * from public.crm_wdo_summary()");

    const row = summary.rows[0];
    // WDO-1001 (issued, evidence), WDO-1002 (draft), WDO-1003 (issued,
    // clean), WDO-1005 (issued, clean), WDO-1003-R1 (issued, evidence),
    // WDO-1004 (draft).
    expect(row.inspections).toBe(8);
    expect(row.issued).toBe(5);
    expect(row.drafts).toBe(3);
    expect(row.with_evidence).toBe(3);
    expect(row.clean).toBe(2);
    expect(row.issued + row.drafts).toBe(row.inspections);
    // A draft has not answered the question. It is in neither column, and
    // with_evidence + clean is therefore issued, not inspections.
    expect(row.with_evidence + row.clean).toBe(row.issued);
    expect(row.reports_with_obstructions).toBe(1);
    // A diagram showing some of the marks is not a diagram of the
    // inspection, so the gap is counted rather than smoothed away.
    expect(row.unplaced_findings).toBeGreaterThan(0);
    expect(row.findings).toBeGreaterThan(row.unplaced_findings);
    await reset();
  });

  it("gives the customer issued reports with the obstructions, and never a draft", async () => {
    await as(customerLogin);
    const reports = await db.query<{
      report_number: string;
      visible_evidence: boolean;
      obstructions: string | null;
      findings: number;
      superseded: boolean;
    }>("select * from public.crm_portal_wdo_reports()");

    const numbers = reports.rows.map((row) => row.report_number).sort();
    expect(numbers).toEqual([
      "WDO-1001", "WDO-1003", "WDO-1003-R1", "WDO-1005", "WDO-1007",
    ]);
    // WDO-1002 and WDO-1004 are drafts. A draft is not a document, and
    // showing one would let an unfinished inspection read as a finding.
    expect(numbers).not.toContain("WDO-1002");
    expect(numbers).not.toContain("WDO-1004");

    const clean = reports.rows.find((row) => row.report_number === "WDO-1003");
    expect(clean?.visible_evidence).toBe(false);
    // The part of the report a customer most needs and is least likely to
    // be told travels to their copy.
    expect(clean?.obstructions).toMatch(/Stored pallets/);
    // And it is marked as replaced, so nobody relies on the older one.
    expect(clean?.superseded).toBe(true);

    const first = reports.rows.find((row) => row.report_number === "WDO-1001");
    expect(first?.superseded).toBe(false);
    expect(first?.findings).toBe(1);
    await reset();
  });

  it("hands the customer the marks for their own issued report, and nothing for a draft", async () => {
    await as(customerLogin);
    const reports = await db.query<{ id: string; report_number: string }>(
      "select * from public.crm_portal_wdo_reports()",
    );
    const issued = reports.rows.find((row) => row.report_number === "WDO-1001");
    const findings = await db.query<{ position_x: string | null; area: string }>(
      "select * from public.crm_portal_wdo_findings($1)", [issued?.id],
    );
    expect(findings.rows).toHaveLength(1);
    expect(Number(findings.rows[0].position_x)).toBeCloseTo(0.3125, 4);
    await reset();

    await as(acmeOwner);
    const draft = await db.query<{ id: string }>(
      "select id from public.crm_wdo_inspections where report_number = 'WDO-1004'",
    );
    await reset();

    await as(customerLogin);
    const none = await db.query("select * from public.crm_portal_wdo_findings($1)", [
      draft.rows[0].id,
    ]);
    expect(none.rows).toHaveLength(0);
    await reset();
  });

  it("shows the rival tenant nothing of Acme's, through either door", async () => {
    await as(rivalOwner);
    const staff = await db.query("select * from public.crm_wdo_inspections");
    expect(staff.rows).toHaveLength(0);
    const summary = await db.query("select * from public.crm_wdo_summary()");
    // No book, so no row — not a row of zeroes standing in for one.
    expect(summary.rows).toHaveLength(0);
    await reset();

    await as(rivalCustomerLogin);
    const portal = await db.query("select * from public.crm_portal_wdo_reports()");
    expect(portal.rows).toHaveLength(0);
    await reset();

    // Naming Acme's report id explicitly buys nothing either.
    await as(acmeOwner);
    const acmeReport = await db.query<{ id: string }>(
      "select id from public.crm_wdo_inspections where report_number = 'WDO-1001'",
    );
    await reset();
    await as(rivalCustomerLogin);
    const reach = await db.query("select * from public.crm_portal_wdo_findings($1)", [
      acmeReport.rows[0].id,
    ]);
    expect(reach.rows).toHaveLength(0);
    await reset();

    // And a rival inspector cannot be attached to an Acme property.
    await as(rivalOwner);
    await expect(
      db.query(
        `insert into public.crm_wdo_inspections
           (organization_id, account_id, property_id, inspector_technician_id, report_number,
            structures_inspected, visible_evidence, created_by)
         values ($1, $2, $3, $4, 'WDO-X', 'Main dwelling', false, $5)`,
        [rivalOrg, rivalAccount, plantSite, rivalInspector, rivalOwner],
      ),
    ).rejects.toThrow();
    await reset();
    expect(rivalSite).not.toBe(plantSite);
  });

  it("lets nobody delete a report or a finding, and keeps RLS forced on both", async () => {
    for (const table of ["crm_wdo_inspections", "crm_wdo_findings"]) {
      const posture = await db.query<{ forced: boolean; enabled: boolean }>(
        `select relrowsecurity as enabled, relforcerowsecurity as forced
           from pg_class where oid = ('public.' || $1)::regclass`,
        [table],
      );
      expect(posture.rows[0].enabled).toBe(true);
      expect(posture.rows[0].forced).toBe(true);

      const grant = await db.query<{ allowed: boolean }>(
        `select has_table_privilege('authenticated', 'public.' || $1, 'delete') as allowed`,
        [table],
      );
      // A WDO report is the record somebody relied on. It is superseded,
      // never erased — and the guarantee is the ABSENCE of the grant.
      expect(grant.rows[0].allowed).toBe(false);
    }
  });

  it("keeps the summary an invoker and the portal reads definers", async () => {
    const polarity = await db.query<{ proname: string; prosecdef: boolean }>(
      `select p.proname, p.prosecdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('crm_wdo_summary', 'crm_portal_wdo_reports',
                            'crm_portal_wdo_findings', 'crm_wdo_issue_report')
        order by p.proname`,
    );
    const byName = new Map(polarity.rows.map((row) => [row.proname, row.prosecdef]));
    // The summary aggregates a whole book; a definer would aggregate every
    // tenant's at once.
    expect(byName.get("crm_wdo_summary")).toBe(false);
    // Issuing acts as the member who is issuing, under their own RLS.
    expect(byName.get("crm_wdo_issue_report")).toBe(false);
    // The portal reads narrow to one account for a caller who is not a
    // member, so they must be definers or they return nothing.
    expect(byName.get("crm_portal_wdo_reports")).toBe(true);
    expect(byName.get("crm_portal_wdo_findings")).toBe(true);
  });
});
