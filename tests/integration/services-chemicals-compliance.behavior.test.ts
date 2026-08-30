// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260830001000_chemicals_compliance.sql";

/**
 * Chemicals and compliance (ADR-191) against the real migration chain. A
 * pesticide application is a legal record, and every promise about it is a
 * schema promise: append-only by grant, drawn from its lot in the same
 * transaction (refusing an over-draw or a unit mismatch), landing on the
 * customer's immutable timeline, and correctable only by a superseding
 * record. None of it is keepable by application code.
 */

const acmeOwner = "00000000-0000-4000-8000-0000000b0001";
const rivalOwner = "00000000-0000-4000-8000-0000000b0002";
const acmeOrg = "10000000-0000-4000-8000-0000000b0001";
const rivalOrg = "10000000-0000-4000-8000-0000000b0002";

describe("chemicals and compliance", { timeout: 240_000 }, () => {
  let db: PGlite;
  let accountId = "";
  let propertyId = "";
  let technicianId = "";
  let productId = "";

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
    const property = await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Distribution Center', '14 Dock Road') returning id`,
      [acmeOrg, accountId],
    );
    propertyId = property.rows[0].id;
    const technician = await db.query<{ id: string }>(
      `insert into public.crm_technicians
         (organization_id, first_name, last_name, license_number, created_by)
       values ($1, 'Miguel', 'Santos', 'OR-PA-44119', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    technicianId = technician.rows[0].id;
    const product = await db.query<{ id: string }>(
      `insert into public.crm_products
         (organization_id, name, epa_registration_number, active_ingredient, default_unit, created_by)
       values ($1, 'Maxforce FC Select', '432-1259', 'Fipronil 0.01%', 'oz', $2) returning id`,
      [acmeOrg, acmeOwner],
    );
    productId = product.rows[0].id;
    await reset();
  }, 240_000);

  afterAll(async () => {
    await db?.close();
  });

  it("draws the application from its lot, and refuses what the lot cannot supply", async () => {
    await as(acmeOwner);
    const lot = await db.query<{ id: string }>(
      `insert into public.crm_product_lots
         (organization_id, product_id, lot_number, unit, quantity_received, quantity_remaining, created_by)
       values ($1, $2, 'LOT-2026-04', 'oz', 32, 32, $3) returning id`,
      [acmeOrg, productId, acmeOwner],
    );
    const lotId = lot.rows[0].id;

    await db.query(
      `insert into public.crm_applications
         (organization_id, account_id, property_id, product_id, lot_id, technician_id,
          applicator_license, method, quantity, unit, target_pest, created_by)
       values ($1, $2, $3, $4, $5, $6, 'OR-PA-44119', 'crack_and_crevice', 4.5, 'oz', 'German cockroach', $7)`,
      [acmeOrg, accountId, propertyId, productId, lotId, technicianId, acmeOwner],
    );
    const drawn = await db.query<{ remaining: string }>(
      "select quantity_remaining::text as remaining from public.crm_product_lots where id = $1",
      [lotId],
    );
    expect(Number(drawn.rows[0].remaining)).toBe(27.5);

    // More than the lot holds is refused, and nothing is drawn.
    await expect(db.query(
      `insert into public.crm_applications
         (organization_id, account_id, property_id, product_id, lot_id, technician_id,
          method, quantity, unit, created_by)
       values ($1, $2, $3, $4, $5, $6, 'bait', 100, 'oz', $7)`,
      [acmeOrg, accountId, propertyId, productId, lotId, technicianId, acmeOwner],
    )).rejects.toThrow(/lot holds/);

    // A unit mismatch is refused rather than silently converted.
    await expect(db.query(
      `insert into public.crm_applications
         (organization_id, account_id, property_id, product_id, lot_id, technician_id,
          method, quantity, unit, created_by)
       values ($1, $2, $3, $4, $5, $6, 'bait', 1, 'l', $7)`,
      [acmeOrg, accountId, propertyId, productId, lotId, technicianId, acmeOwner],
    )).rejects.toThrow(/does not match lot unit/);

    const untouched = await db.query<{ remaining: string }>(
      "select quantity_remaining::text as remaining from public.crm_product_lots where id = $1",
      [lotId],
    );
    expect(Number(untouched.rows[0].remaining)).toBe(27.5);
    await reset();
  });

  it("writes the application onto the customer's immutable timeline", async () => {
    await as(acmeOwner);
    const trail = await db.query<{ kind: string; summary: string; detail: string | null; actor_user_id: string | null }>(
      `select kind::text, summary, detail, actor_user_id from public.crm_timeline_events
        where account_id = $1 and kind = 'service' order by recorded_at`,
      [accountId],
    );
    expect(trail.rows).toEqual([
      {
        kind: "service",
        summary: "Applied Maxforce FC Select (4.500 oz).",
        detail: "Method: crack_and_crevice. Target: German cockroach.",
        actor_user_id: acmeOwner,
      },
    ]);
    await reset();
  });

  it("keeps the application log append-only: corrections supersede, never edit", async () => {
    await as(acmeOwner);
    const original = await db.query<{ id: string }>(
      `insert into public.crm_applications
         (organization_id, account_id, property_id, product_id, technician_id,
          method, quantity, unit, created_by)
       values ($1, $2, $3, $4, $5, 'perimeter', 8, 'fl_oz', $6) returning id`,
      [acmeOrg, accountId, propertyId, productId, technicianId, acmeOwner],
    );
    const originalId = original.rows[0].id;

    await expect(db.query(
      "update public.crm_applications set quantity = 2 where id = $1",
      [originalId],
    )).rejects.toThrow(/permission denied/);
    await expect(db.query(
      "delete from public.crm_applications where id = $1",
      [originalId],
    )).rejects.toThrow(/permission denied/);

    // The correction is a new record naming the one it replaces.
    const correction = await db.query<{ supersedes_id: string | null }>(
      `insert into public.crm_applications
         (organization_id, account_id, property_id, product_id, technician_id,
          method, quantity, unit, note, supersedes_id, created_by)
       values ($1, $2, $3, $4, $5, 'perimeter', 6, 'fl_oz', 'Corrects an over-recorded quantity.', $6, $7)
       returning supersedes_id`,
      [acmeOrg, accountId, propertyId, productId, technicianId, originalId, acmeOwner],
    );
    expect(correction.rows[0].supersedes_id).toBe(originalId);

    // The superseded record is still there — that is the point.
    const survives = await db.query<{ count: number }>(
      "select count(*)::integer as count from public.crm_applications where id = $1",
      [originalId],
    );
    expect(survives.rows[0].count).toBe(1);
    await reset();
  });

  it("accepts a published SDS and label reference, and refuses a bare one", async () => {
    /*
     * The regression this pins: PostgreSQL refuses a regex repetition count
     * above 255, so a `{4,500}` bound compiles only when a row actually
     * carries a URL. Every earlier test left these columns null, so the
     * constraint was never evaluated and the first real product would have
     * failed in production. Insert one with both links.
     */
    await as(acmeOwner);
    const stored = await db.query<{ sds_url: string; label_url: string }>(
      `insert into public.crm_products
         (organization_id, name, sds_url, label_url, created_by)
       values ($1, 'Linked Product', $2, $3, $4)
       returning sds_url, label_url`,
      [acmeOrg,
       `https://sds.example/${"a".repeat(180)}.pdf`,
       "https://labels.example/short.pdf",
       acmeOwner],
    );
    expect(stored.rows[0].label_url).toBe("https://labels.example/short.pdf");

    // http, whitespace and an over-long reference are all still refused.
    for (const bad of [
      "http://insecure.example/sds.pdf",
      "https://has space.example/sds.pdf",
      `https://sds.example/${"a".repeat(520)}.pdf`,
    ]) {
      await expect(db.query(
        `insert into public.crm_products (organization_id, name, sds_url, created_by)
         values ($1, 'Bad link', $2, $3)`,
        [acmeOrg, bad, acmeOwner],
      )).rejects.toThrow(/violates check constraint/);
    }
    await reset();
  });

  it("holds products and lots to their own integrity, and never lets them be deleted", async () => {
    await as(acmeOwner);
    // A lot cannot hold more remaining than it received.
    await expect(db.query(
      `insert into public.crm_product_lots
         (organization_id, product_id, lot_number, unit, quantity_received, quantity_remaining, created_by)
       values ($1, $2, 'LOT-BAD', 'oz', 10, 20, $3)`,
      [acmeOrg, productId, acmeOwner],
    )).rejects.toThrow(/crm_product_lots_remaining_within_received/);

    // One EPA number names one product per organization.
    await expect(db.query(
      `insert into public.crm_products (organization_id, name, epa_registration_number, created_by)
       values ($1, 'Duplicate registration', '432-1259', $2)`,
      [acmeOrg, acmeOwner],
    )).rejects.toThrow(/crm_products_org_epa_key|duplicate key/);

    // A product with applications against it cannot be removed at all.
    await expect(db.query("delete from public.crm_products where id = $1", [productId]))
      .rejects.toThrow(/permission denied/);
    await reset();
  });

  it("keeps jurisdiction rules per organization and tenants apart", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_compliance_rules
         (organization_id, jurisdiction, label, retention_years, requires_target_pest, created_by)
       values ($1, 'US-OR', 'Oregon Department of Agriculture', 3, true, $2)`,
      [acmeOrg, acmeOwner],
    );
    await expect(db.query(
      `insert into public.crm_compliance_rules
         (organization_id, jurisdiction, label, retention_years, created_by)
       values ($1, 'US-OR', 'A second Oregon rule', 5, $2)`,
      [acmeOrg, acmeOwner],
    )).rejects.toThrow(/crm_compliance_rules_org_jurisdiction_key|duplicate key/);
    await reset();

    await as(rivalOwner);
    // The same jurisdiction code is free for another organization.
    const reused = await db.query<{ id: string }>(
      `insert into public.crm_compliance_rules
         (organization_id, jurisdiction, label, retention_years, created_by)
       values ($1, 'US-OR', 'Rival Oregon rule', 2, $2) returning id`,
      [rivalOrg, rivalOwner],
    );
    expect(reused.rows[0].id).toBeTruthy();

    const seen = await db.query<{ products: number; applications: number; rules: number }>(
      `select
         (select count(*)::integer from public.crm_products where organization_id = $1) as products,
         (select count(*)::integer from public.crm_applications where organization_id = $1) as applications,
         (select count(*)::integer from public.crm_compliance_rules where organization_id = $1) as rules`,
      [acmeOrg],
    );
    expect(seen.rows[0]).toEqual({ products: 0, applications: 0, rules: 0 });
    await reset();
  });

  it("shuts anon and service_role out of every compliance table", async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    for (const role of ["anon", "service_role"]) {
      await db.exec(`set role ${role}`);
      for (const table of [
        "crm_products",
        "crm_product_lots",
        "crm_applications",
        "crm_compliance_rules",
      ]) {
        await expect(db.query(`select count(*) from public.${table}`))
          .rejects.toThrow(/permission denied/);
      }
      await db.exec("reset role");
    }
  });
});
