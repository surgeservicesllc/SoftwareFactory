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
 * Documents, canvassing and the marketing hub (ADR-196) against the real
 * migration chain.
 *
 * These are the tables where a CRM is most tempted to flatter itself: a
 * document row holding a public link, a canvasser improving yesterday's
 * disposition, an unsubscribe quietly reversed, an open rate larger than
 * the delivery it came from. Every one of those is refused here by the
 * database, under hosted-style default privileges, so no route and no
 * later migration can grant its way past them.
 */

const acmeOwner = "00000000-0000-4000-8000-00000000c101";
const rivalOwner = "00000000-0000-4000-8000-00000000c102";
const acmeOrg = "10000000-0000-4000-8000-00000000c101";
const rivalOrg = "10000000-0000-4000-8000-00000000c102";

describe("documents, canvassing and the marketing hub", { timeout: 240_000 }, () => {
  let db: PGlite;
  let branchId = "";
  let managerId = "";
  let repId = "";
  let accountId = "";

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

    const account = await db.query<{ id: string }>(
      `insert into public.crm_accounts
         (organization_id, name, kind, branch_id, owner_employee_id, created_by)
       values ($1, 'Harborview Foods', 'commercial', $2, $3, $4) returning id`,
      [acmeOrg, branchId, repId, acmeOwner],
    );
    accountId = account.rows[0].id;
    await reset();
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it("refuses a document reference that is a link rather than a path", async () => {
    await as(acmeOwner);
    for (const path of [
      "https://example.com/private/contract.pdf",
      "s3://bucket/contract.pdf",
      "/absolute/leading/slash.pdf",
    ]) {
      await expect(
        db.query(
          `insert into public.crm_documents
             (organization_id, account_id, title, kind, storage_path, created_by)
           values ($1, $2, 'Filed', 'contract', $3, $4)`,
          [acmeOrg, accountId, path, acmeOwner],
        ),
        `${path} was accepted as a storage path`,
      ).rejects.toThrow(/storage_path/);
    }

    // A real private path is accepted, so the CHECK discriminates rather
    // than merely blocking.
    const filed = await db.query<{ storage_path: string }>(
      `insert into public.crm_documents
         (organization_id, account_id, title, kind, storage_path, content_type, byte_size, created_by)
       values ($1, $2, 'Signed agreement', 'contract', 'services/0001/contract-01.pdf',
               'application/pdf', 42000, $3)
       returning storage_path`,
      [acmeOrg, accountId, acmeOwner],
    );
    expect(filed.rows[0].storage_path).toBe("services/0001/contract-01.pdf");
    await reset();
  });

  it("refuses a document filed about nothing at all", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `insert into public.crm_documents
           (organization_id, title, kind, storage_path, created_by)
         values ($1, 'Orphan', 'other', 'services/orphan.pdf', $2)`,
        [acmeOrg, acmeOwner],
      ),
    ).rejects.toThrow(/crm_documents_has_subject/);
    await reset();
  });

  it("will not let a canvasser improve yesterday's disposition", async () => {
    await as(acmeOwner);
    const route = await db.query<{ id: string }>(
      `insert into public.crm_canvass_routes
         (organization_id, territory_id, rep_id, name, status, walked_on, started_at, ended_at, created_by)
       values ($1, null, $2, 'North doors', 'complete', current_date, now(), now(), $3)
       returning id`,
      [acmeOrg, repId, acmeOwner],
    );
    await db.query(
      `insert into public.crm_knocks
         (organization_id, canvass_route_id, address, disposition, created_by)
       values ($1, $2, '12 Alder Street', 'not_interested', $3)`,
      [acmeOrg, route.rows[0].id, acmeOwner],
    );

    // Append-only at the grant level: there is no UPDATE and no DELETE to
    // fall back on, so both are denied outright rather than matching no rows.
    await expect(
      db.query("update public.crm_knocks set disposition = 'sold' where organization_id = $1", [acmeOrg]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.query("delete from public.crm_knocks where organization_id = $1", [acmeOrg]),
    ).rejects.toThrow(/permission denied/i);
    await reset();
  });

  it("makes a door that sold name the customer it produced", async () => {
    await as(acmeOwner);
    const route = await db.query<{ id: string }>(
      `insert into public.crm_canvass_routes
         (organization_id, name, status, walked_on, created_by)
       values ($1, 'South doors', 'planned', current_date, $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    await expect(
      db.query(
        `insert into public.crm_knocks
           (organization_id, canvass_route_id, address, disposition, created_by)
         values ($1, $2, '8 Basalt Way', 'sold', $3)`,
        [acmeOrg, route.rows[0].id, acmeOwner],
      ),
    ).rejects.toThrow(/crm_knocks_sold_has_account/);

    // And a follow-up date belongs only to a door that asked for one.
    await expect(
      db.query(
        `insert into public.crm_knocks
           (organization_id, canvass_route_id, address, disposition, follow_up_on, created_by)
         values ($1, $2, '9 Basalt Way', 'not_interested', current_date + 7, $3)`,
        [acmeOrg, route.rows[0].id, acmeOwner],
      ),
    ).rejects.toThrow(/crm_knocks_followup_iff_pending/);
    await reset();
  });

  it("keeps an unsubscribe, and refuses a reason without one", async () => {
    await as(acmeOwner);
    const list = await db.query<{ id: string }>(
      `insert into public.crm_marketing_lists (organization_id, name, created_by)
       values ($1, 'Quarterly renewals', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    await db.query(
      `insert into public.crm_list_members (organization_id, list_id, account_id, source, created_by)
       values ($1, $2, $3, 'website form', $4)`,
      [acmeOrg, list.rows[0].id, accountId, acmeOwner],
    );

    await expect(
      db.query(
        `update public.crm_list_members set unsubscribe_reason = 'Changed their mind.'
          where organization_id = $1`,
        [acmeOrg],
      ),
    ).rejects.toThrow(/crm_list_members_reason_iff_unsubscribed/);

    // Withdrawing consent keeps both the moment and the reason.
    const withdrawn = await db.query<{ unsubscribed_at: string; unsubscribe_reason: string }>(
      `update public.crm_list_members
          set unsubscribed_at = now(), unsubscribe_reason = 'Asked to be removed by phone.'
        where organization_id = $1
        returning unsubscribed_at::text, unsubscribe_reason`,
      [acmeOrg],
    );
    expect(withdrawn.rows[0].unsubscribe_reason).toBe("Asked to be removed by phone.");
    expect(withdrawn.rows[0].unsubscribed_at).not.toBeNull();

    // A dynamic list has to say what it selects.
    await expect(
      db.query(
        `insert into public.crm_marketing_lists (organization_id, name, is_dynamic, created_by)
         values ($1, 'Rule with no rule', true, $2)`,
        [acmeOrg, acmeOwner],
      ),
    ).rejects.toThrow(/crm_marketing_lists_dynamic_has_criteria/);
    await reset();
  });

  it("only lets the message funnel run one way", async () => {
    await as(acmeOwner);
    const campaign = await db.query<{ id: string }>(
      `insert into public.crm_campaigns
         (organization_id, name, channel, status, subject, created_by)
       values ($1, 'Spring sweep', 'email', 'draft', 'Book your visit', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    const campaignId = campaign.rows[0].id;

    // An open with nothing delivered behind it is refused, and so is a click
    // with nothing opened behind it.
    await expect(
      db.query(
        `insert into public.crm_messages
           (organization_id, campaign_id, account_id, channel, status, opened_at, created_by)
         values ($1, $2, $3, 'email', 'opened', now(), $4)`,
        [acmeOrg, campaignId, accountId, acmeOwner],
      ),
    ).rejects.toThrow(/crm_messages_delivered_before_opened/);

    // A failure reason belongs to a failure, and a failure carries one.
    await expect(
      db.query(
        `insert into public.crm_messages
           (organization_id, campaign_id, account_id, channel, status, created_by)
         values ($1, $2, $3, 'email', 'bounced', $4)`,
        [acmeOrg, campaignId, accountId, acmeOwner],
      ),
    ).rejects.toThrow(/crm_messages_failure_iff_failed/);

    // The whole funnel, in order, is accepted.
    const delivered = await db.query<{ status: string }>(
      `insert into public.crm_messages
         (organization_id, campaign_id, account_id, channel, status,
          sent_at, delivered_at, opened_at, clicked_at, created_by)
       values ($1, $2, $3, 'email', 'clicked',
               now() - interval '3 hours', now() - interval '2 hours',
               now() - interval '1 hour', now(), $4)
       returning status::text`,
      [acmeOrg, campaignId, accountId, acmeOwner],
    );
    expect(delivered.rows[0].status).toBe("clicked");

    // And the log is append-only: a delivery cannot be revised into an open.
    await expect(
      db.query("update public.crm_messages set status = 'opened' where organization_id = $1", [acmeOrg]),
    ).rejects.toThrow(/permission denied/i);
    await reset();
  });

  it("refuses an email campaign with no subject, and a rule that sends nothing it holds", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `insert into public.crm_campaigns (organization_id, name, channel, created_by)
         values ($1, 'Subjectless', 'email', $2)`,
        [acmeOrg, acmeOwner],
      ),
    ).rejects.toThrow(/crm_campaigns_email_has_subject/);

    await expect(
      db.query(
        `insert into public.crm_automations
           (organization_id, name, trigger_on, action, created_by)
         values ($1, 'Send with nothing to send', 'lead_created', 'send_email', $2)`,
        [acmeOrg, acmeOwner],
      ),
    ).rejects.toThrow(/crm_automations_sending_has_template/);

    // A rule cannot claim runs it never had, in either direction.
    await expect(
      db.query(
        `insert into public.crm_automations
           (organization_id, name, trigger_on, action, run_count, created_by)
         values ($1, 'Claims a run', 'lead_created', 'notify_manager', 3, $2)`,
        [acmeOrg, acmeOwner],
      ),
    ).rejects.toThrow(/crm_automations_run_count_matches_moment/);
    await reset();
  });

  it("gives nothing to anon or service_role, and lets nobody delete the record", async () => {
    await reset();
    const tables = [
      "crm_documents", "crm_canvass_routes", "crm_knocks", "crm_marketing_lists",
      "crm_list_members", "crm_campaigns", "crm_messages", "crm_automations",
      "crm_attributions",
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
      expect(
        row.privilege_type,
        `${row.table_name} grants ${row.privilege_type}`,
      ).not.toBe("DELETE");
    }
    expect(new Set(rows.map((row) => row.table_name)).size).toBe(tables.length);

    // The three append-only tables hold no UPDATE either.
    const writable = new Set(
      rows.filter((row) => row.privilege_type === "UPDATE").map((row) => row.table_name),
    );
    for (const appendOnly of ["crm_knocks", "crm_messages", "crm_attributions"]) {
      expect(writable.has(appendOnly), `${appendOnly} is rewritable`).toBe(false);
    }
    await reset();
  });

  it("keeps the marketing record inside its own tenant", async () => {
    await as(rivalOwner);
    const seen = await db.query("select id from public.crm_campaigns where organization_id = $1", [
      acmeOrg,
    ]);
    expect(seen.rows).toEqual([]);

    await expect(
      db.query(
        `insert into public.crm_documents
           (organization_id, account_id, title, kind, storage_path, created_by)
         values ($1, $2, 'Theirs', 'other', 'services/theirs.pdf', $3)`,
        [rivalOrg, accountId, rivalOwner],
      ),
    ).rejects.toThrow(/crm_documents_account_same_org/);
    await reset();
  });
});
