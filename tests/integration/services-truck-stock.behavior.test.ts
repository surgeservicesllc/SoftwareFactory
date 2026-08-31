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
 * Truck stock (ADR-213) against the real chain.
 *
 * A lot already knows how much of it is left. What no table knew is WHERE
 * the remainder sits, and "we have 40 oz" is a different fact from "the
 * 40 oz is on a truck that left at six".
 *
 * The outcome that must be impossible is a location holding a negative
 * amount of a regulated chemical: that is not a display bug, it means the
 * record of what was used where is wrong. Every test here is about that,
 * or about the two ledgers — stock and compliance — being unable to
 * disagree.
 */

const acmeOwner = "00000000-0000-4000-8000-000000013001";
const rivalOwner = "00000000-0000-4000-8000-000000013002";
const acmeOrg = "10000000-0000-4000-8000-000000013001";
const rivalOrg = "10000000-0000-4000-8000-000000013002";

describe("truck stock", { timeout: 240_000 }, () => {
  let db: PGlite;

  let depot = "";
  let truck = "";
  let secondTruck = "";
  let product = "";
  let account = "";
  let site = "";
  let technician = "";
  let lots = 0;

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function newLot(quantity = 100) {
    lots += 1;
    const created = await db.query<{ id: string }>(
      `insert into public.crm_product_lots
         (organization_id, product_id, lot_number, unit, quantity_received,
          quantity_remaining, created_by)
       values ($1, $2, $3, 'fl_oz', $4, $4, $5) returning id`,
      [acmeOrg, product, `LOT-${lots}`, quantity, acmeOwner],
    );
    return created.rows[0].id;
  }

  async function move(
    lot: string,
    kind: string,
    quantity: number,
    options: {
      fromBranch?: string | null; fromEquipment?: string | null;
      toBranch?: string | null; toEquipment?: string | null;
      application?: string | null;
    } = {},
  ) {
    return db.query(
      `select public.crm_stock_record_movement(
         $1, $2::public.crm_stock_movement_kind, $3, $4, $5, $6, $7, $8) as id`,
      [lot, kind, quantity,
        options.fromBranch ?? null, options.fromEquipment ?? null,
        options.toBranch ?? null, options.toEquipment ?? null,
        options.application ?? null],
    );
  }

  async function onHand(lot: string) {
    const rows = await db.query<{
      stock_branch_id: string | null; stock_equipment_id: string | null;
      stock_quantity: string;
    }>("select * from public.crm_stock_on_hand($1)", [lot]);
    return rows.rows.map((row) => ({
      where: row.stock_branch_id ?? row.stock_equipment_id,
      quantity: Number(row.stock_quantity),
    }));
  }

  async function newApplication(lot: string, quantity: number) {
    const created = await db.query<{ id: string }>(
      `insert into public.crm_applications
         (organization_id, account_id, property_id, product_id, lot_id, technician_id,
          method, quantity, unit, created_by)
       values ($1, $2, $3, $4, $5, $6, 'perimeter', $7, 'fl_oz', $8) returning id`,
      [acmeOrg, account, site, product, lot, technician, quantity, acmeOwner],
    );
    return created.rows[0].id;
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
      insert into public.organizations (id, name, slug, created_by)
      values
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-stock', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-stock', '${rivalOwner}');
    `);

    await as(acmeOwner);
    depot = (await db.query<{ id: string }>(
      `insert into public.crm_branches (organization_id, name, code, created_by)
       values ($1, 'North Depot', 'ND', $2) returning id`, [acmeOrg, acmeOwner],
    )).rows[0].id;
    truck = (await db.query<{ id: string }>(
      `insert into public.crm_equipment (organization_id, asset_tag, kind, name, created_by)
       values ($1, 'TRUCK-04', 'vehicle', 'Ford Transit', $2) returning id`, [acmeOrg, acmeOwner],
    )).rows[0].id;
    secondTruck = (await db.query<{ id: string }>(
      `insert into public.crm_equipment (organization_id, asset_tag, kind, name, created_by)
       values ($1, 'TRUCK-07', 'vehicle', 'Ford Transit', $2) returning id`, [acmeOrg, acmeOwner],
    )).rows[0].id;
    product = (await db.query<{ id: string }>(
      `insert into public.crm_products
         (organization_id, name, epa_registration_number, default_unit, created_by)
       values ($1, 'Termidor SC', '90000-123', 'fl_oz', $2) returning id`, [acmeOrg, acmeOwner],
    )).rows[0].id;
    account = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    site = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Harborview Plant', '4100 Cannery Row') returning id`, [acmeOrg, account],
    )).rows[0].id;
    technician = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, created_by)
       values ($1, 'Ada', $2) returning id`, [acmeOrg, acmeOwner],
    )).rows[0].id;
  });

  afterAll(async () => {
    await db?.close();
  });

  it("derives what each place holds from the movements, storing nothing", async () => {
    await as(acmeOwner);
    const lot = await newLot(100);
    await move(lot, "receipt", 100, { toBranch: depot });
    await move(lot, "transfer", 40, { fromBranch: depot, toEquipment: truck });

    expect(await onHand(lot)).toEqual(
      expect.arrayContaining([
        { where: depot, quantity: 60 },
        { where: truck, quantity: 40 },
      ]),
    );
  });

  it("will not let a location go negative, which is the whole point", async () => {
    await as(acmeOwner);
    const lot = await newLot(100);
    await move(lot, "receipt", 100, { toBranch: depot });
    await move(lot, "transfer", 40, { fromBranch: depot, toEquipment: truck });

    await expect(
      move(lot, "transfer", 50, { fromEquipment: truck, toBranch: depot }),
    ).rejects.toThrow(/holds 40.000 fl_oz of this lot; 50.000 cannot be taken/);
  });

  it("refuses to draw from a place that never held the lot at all", async () => {
    await as(acmeOwner);
    const lot = await newLot(50);
    await move(lot, "receipt", 50, { toBranch: depot });

    await expect(
      move(lot, "transfer", 1, { fromEquipment: secondTruck, toBranch: depot }),
    ).rejects.toThrow(/holds 0 fl_oz of this lot/);
  });

  it("makes the stock ledger and the compliance log agree, or refuses", async () => {
    await as(acmeOwner);
    const lot = await newLot(100);
    await move(lot, "receipt", 100, { toEquipment: truck });
    const application = await newApplication(lot, 12);

    await expect(
      move(lot, "consumption", 9, { fromEquipment: truck, application }),
    ).rejects.toThrow(/recorded 12.000 and this movement draws 9.000/);

    await move(lot, "consumption", 12, { fromEquipment: truck, application });
    expect(await onHand(lot)).toEqual([{ where: truck, quantity: 88 }]);
  });

  it("lets one application draw stock exactly once, however often a sync replays", async () => {
    await as(acmeOwner);
    const lot = await newLot(100);
    await move(lot, "receipt", 100, { toEquipment: truck });
    const application = await newApplication(lot, 5);
    await move(lot, "consumption", 5, { fromEquipment: truck, application });

    await expect(
      move(lot, "consumption", 5, { fromEquipment: truck, application }),
    ).rejects.toThrow(/already drawn stock; it cannot draw twice/);

    expect(await onHand(lot)).toEqual([{ where: truck, quantity: 95 }]);
  });

  it("refuses a consumption that names no application", async () => {
    await as(acmeOwner);
    const lot = await newLot(20);
    await move(lot, "receipt", 20, { toEquipment: truck });

    await expect(
      move(lot, "consumption", 5, { fromEquipment: truck }),
    ).rejects.toThrow(/names the application it served/);
  });

  it("refuses a consumption for an application recorded against another lot", async () => {
    await as(acmeOwner);
    const stocked = await newLot(30);
    const other = await newLot(30);
    await move(stocked, "receipt", 30, { toEquipment: truck });
    const application = await newApplication(other, 4);

    await expect(
      move(stocked, "consumption", 4, { fromEquipment: truck, application }),
    ).rejects.toThrow(/not recorded against this lot/);
  });

  it("corrects a miscount with another movement rather than an edit", async () => {
    await as(acmeOwner);
    const lot = await newLot(60);
    await move(lot, "receipt", 60, { toEquipment: truck });
    // A shelf count found two ounces less than the ledger says.
    await move(lot, "adjustment", 2, { fromEquipment: truck });

    expect(await onHand(lot)).toEqual([{ where: truck, quantity: 58 }]);

    const rows = await db.query<{ n: string }>(
      "select count(*) as n from public.crm_stock_movements where lot_id = $1", [lot]);
    // Both the receipt and the correction survive; nothing was rewritten.
    expect(Number(rows.rows[0].n)).toBe(2);
  });

  it("refuses a movement shaped like nothing that can happen", async () => {
    await as(acmeOwner);
    const lot = await newLot(10);

    // A receipt that also comes from somewhere is two claims at once.
    await expect(
      db.query(
        `insert into public.crm_stock_movements
           (organization_id, lot_id, kind, quantity, from_branch_id, to_branch_id, recorded_by)
         values ($1, $2, 'receipt', 1, $3, $3, $4)`,
        [acmeOrg, lot, depot, acmeOwner],
      ),
    ).rejects.toThrow(/crm_stock_movements_shape/);

    // A transfer to where it already is.
    await expect(
      db.query(
        `insert into public.crm_stock_movements
           (organization_id, lot_id, kind, quantity, from_branch_id, to_branch_id, recorded_by)
         values ($1, $2, 'transfer', 1, $3, $3, $4)`,
        [acmeOrg, lot, depot, acmeOwner],
      ),
    ).rejects.toThrow(/crm_stock_movements_transfer_moves/);

    // An adjustment cannot claim to have served an application.
    await expect(
      db.query(
        `insert into public.crm_stock_movements
           (organization_id, lot_id, kind, quantity, from_branch_id, application_id, recorded_by)
         values ($1, $2, 'adjustment', 1, $3, $4, $5)`,
        [acmeOrg, lot, depot, await newApplication(lot, 1), acmeOwner],
      ),
    ).rejects.toThrow(/crm_stock_movements_application_iff_consumption/);
  });

  it("keeps the ledger append-only: no member may update or delete a movement", async () => {
    await as(acmeOwner);
    const lot = await newLot(10);
    await move(lot, "receipt", 10, { toBranch: depot });

    await expect(
      db.query("update public.crm_stock_movements set quantity = 99 where lot_id = $1", [lot]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.query("delete from public.crm_stock_movements where lot_id = $1", [lot]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("keeps one book's stock out of another's", async () => {
    await as(acmeOwner);
    const lot = await newLot(10);
    await move(lot, "receipt", 10, { toBranch: depot });

    await as(rivalOwner);
    const rows = await db.query("select * from public.crm_stock_on_hand($1)", [lot]);
    const movements = await db.query(
      "select id from public.crm_stock_movements where lot_id = $1", [lot]);

    expect(rows.rows).toEqual([]);
    expect(movements.rows).toEqual([]);
  });

  it("leaves both stock functions invokers", async () => {
    await db.exec("reset role");
    const definers = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and p.proname in ('crm_stock_on_hand', 'crm_stock_record_movement')`,
    );

    expect(definers.rows).toEqual([]);
  });
});
