// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase, latestMigration } from "../support/migrated-database";
import { LATEST_MIGRATION } from "../support/latest-migration";

/**
 * Filed service documents (ADR-216) against the real chain.
 *
 * An auditor asks what the report SAID on the day. A report assembled live
 * from current rows is a different document every time somebody corrects a
 * note, so a filed copy freezes the bytes — and being unable to change them
 * afterwards is the entire value.
 */

const acmeOwner = "00000000-0000-4000-8000-000000015001";
const rivalOwner = "00000000-0000-4000-8000-000000015002";
const acmeOrg = "10000000-0000-4000-8000-000000015001";
const rivalOrg = "10000000-0000-4000-8000-000000015002";

describe("filed service documents", { timeout: 240_000 }, () => {
  let db: PGlite;

  let account = "";
  let property = "";
  let visit = "";

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function file(
    body: string,
    options: { title?: string; supersedes?: string | null; workOrder?: string | null } = {},
  ) {
    return db.query<{ id: string }>(
      `insert into public.crm_service_documents
         (organization_id, account_id, property_id, work_order_id, kind, title,
          content_type, byte_size, body, supersedes_id, filed_by)
       values ($1, $2, $3, $4, 'service_report', $5, 'text/html',
               octet_length($6::text), $6::text, $7, $8) returning id`,
      [acmeOrg, account, property,
        options.workOrder === undefined ? visit : options.workOrder,
        options.title ?? "Service report — 12 Jan 2026",
        body, options.supersedes ?? null, acmeOwner],
    );
  }

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed. The
    // coverage assertion each suite used to make survives: the helper
    // keys its cache on the CONTENT of every migration.
    expect(await latestMigration()).toBe(LATEST_MIGRATION);
    db = await createMigratedDatabase();

    await db.exec(`
      insert into auth.users (id) values ('${acmeOwner}'), ('${rivalOwner}');
      insert into public.organizations (id, name, slug, created_by)
      values
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-docs', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-docs', '${rivalOwner}');
    `);

    await as(acmeOwner);
    account = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    property = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Harborview Plant', '4100 Cannery Row') returning id`,
      [acmeOrg, account],
    )).rows[0].id;
    const technician = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, created_by)
       values ($1, 'Ada', $2) returning id`, [acmeOrg, acmeOwner],
    )).rows[0].id;
    visit = (await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, status, service_type,
          scheduled_start, scheduled_end, completed_at, created_by)
       values ($1, $2, $3, $4, 'completed', 'Quarterly IPM', '2026-01-12T09:00:00Z',
               '2026-01-12T11:00:00Z', '2026-01-12T10:42:00Z', $5) returning id`,
      [acmeOrg, account, property, technician, acmeOwner],
    )).rows[0].id;
  });

  afterAll(async () => {
    await db?.close();
  });

  it("keeps the bytes exactly as filed", async () => {
    await as(acmeOwner);
    const body = "<h1>Service report</h1><p>Perimeter treated; two stations rebaited.</p>";
    const filed = await file(body);

    const stored = await db.query<{ body: string; byte_size: number }>(
      `select body, byte_size
         from public.crm_service_documents where id = $1`, [filed.rows[0].id]);

    expect(stored.rows[0].body).toBe(body);
    expect(stored.rows[0].byte_size).toBe(Buffer.byteLength(body, "utf8"));
  });

  it("cannot be edited or deleted afterwards, which is the whole value", async () => {
    await as(acmeOwner);
    const filed = await file("<p>As issued</p>");

    await expect(
      db.query("update public.crm_service_documents set title = 'Rewritten' where id = $1",
        [filed.rows[0].id]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.query("delete from public.crm_service_documents where id = $1", [filed.rows[0].id]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("corrects by filing another that names the one it replaces", async () => {
    await as(acmeOwner);
    const original = await file("<p>Two stations rebaited</p>", { title: "Report A" });
    await file("<p>Three stations rebaited</p>", {
      title: "Report A (corrected)", supersedes: original.rows[0].id,
    });

    const filed = await db.query<{
      document_title: string; document_superseded: boolean; document_supersedes: string | null;
    }>("select * from public.crm_service_documents_filed($1)", [account]);

    const supersededRow = filed.rows.find((row) => row.document_title === "Report A");
    const correction = filed.rows.find((row) => row.document_title === "Report A (corrected)");
    // The original stays, and says it was replaced — an auditor may hold it.
    expect(supersededRow?.document_superseded).toBe(true);
    expect(correction?.document_supersedes).toBe(original.rows[0].id);
  });

  it("refuses a document that says it is about nothing", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `insert into public.crm_service_documents
           (organization_id, account_id, kind, title, content_type, byte_size, body, filed_by)
         values ($1, $2, 'service_report', 'Orphan', 'text/html', 3, 'abc', $3)`,
        [acmeOrg, account, acmeOwner],
      ),
    ).rejects.toThrow(/crm_service_documents_names_a_subject/);
  });

  it("refuses a size that disagrees with the bytes, so a truncated file cannot claim to be whole", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `insert into public.crm_service_documents
           (organization_id, account_id, property_id, kind, title, content_type,
            byte_size, body, filed_by)
         values ($1, $2, $3, 'service_report', 'Short', 'text/html', 999, 'abc', $4)`,
        [acmeOrg, account, property, acmeOwner],
      ),
    ).rejects.toThrow(/crm_service_documents_size_is_true/);
  });

  it("refuses a content type this product cannot actually produce", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `insert into public.crm_service_documents
           (organization_id, account_id, property_id, kind, title, content_type,
            byte_size, body, filed_by)
         values ($1, $2, $3, 'service_report', 'Claimed PDF', 'application/pdf',
                 3, 'abc', $4)`,
        [acmeOrg, account, property, acmeOwner],
      ),
    ).rejects.toThrow(/content_type/);
  });

  it("lists what was filed without moving the bytes", async () => {
    await as(acmeOwner);
    const listing = await db.query<{ document_bytes: number }>(
      "select * from public.crm_service_documents_filed($1, 5)", [account]);

    expect(listing.rows.length).toBeGreaterThan(0);
    // The index carries the size, not the body.
    expect(Object.keys(listing.rows[0])).not.toContain("body");
    expect(listing.rows[0].document_bytes).toBeGreaterThan(0);
  });

  it("keeps one book's filings out of another's", async () => {
    await as(rivalOwner);
    const rows = await db.query(
      "select id from public.crm_service_documents where account_id = $1", [account]);
    const listing = await db.query(
      "select * from public.crm_service_documents_filed($1)", [account]);

    expect(rows.rows).toEqual([]);
    expect(listing.rows).toEqual([]);
  });

  it("leaves the reader an invoker", async () => {
    await db.exec("reset role");
    const definers = await db.query(
      `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and p.proname = 'crm_service_documents_filed'`,
    );

    expect(definers.rows).toEqual([]);
  });
});
