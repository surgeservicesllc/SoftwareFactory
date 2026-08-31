// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase, latestMigration } from "../support/migrated-database";
import { LATEST_MIGRATION } from "../support/latest-migration";
import { PAN_PARITY_CASES, looksLikePan } from "../../lib/services/payment-instruments";

/**
 * Autopay authorization (ADR-218) against the real chain.
 *
 * Two claims to defend, both negative. A card number cannot be stored here
 * even by accident, and nothing can record that money moved while no
 * processor is connected. The positive half — that a real settlement lands
 * once one IS connected — is checked too, because a gate that never opens
 * is a wall.
 */

const acmeOwner = "00000000-0000-4000-8000-000000018001";
const rivalOwner = "00000000-0000-4000-8000-000000018002";
const acmeOrg = "10000000-0000-4000-8000-000000018001";
const rivalOrg = "10000000-0000-4000-8000-000000018002";

const AGREEMENT =
  "I authorise Acme Pest to charge the payment method on file for each invoice "
  + "as it falls due, up to the limit shown, until I withdraw this authorisation.";

describe("autopay authorization", { timeout: 240_000 }, () => {
  let db: PGlite;

  let account = "";
  let otherAccount = "";
  let instrument = "";
  let mandate = "";
  let enrollment = "";
  let invoiceSeq = 0;

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function addInstrument(options: {
    holder?: string; brand?: string; kind?: string; accountId?: string;
  } = {}) {
    const kind = options.kind ?? "card";
    return db.query<{ id: string }>(
      `insert into public.crm_payment_instruments
         (organization_id, account_id, kind, display_brand, last_four,
          expires_month, expires_year, holder_name, vault_purpose, created_by)
       values ($1, $2, $3::public.crm_instrument_kind, $4, '4242',
               $5, $6, $7, 'crm_card_token_acme', $8) returning id`,
      [acmeOrg, options.accountId ?? account, kind,
        options.brand ?? "Visa",
        kind === "card" ? 12 : null, kind === "card" ? 2030 : null,
        options.holder ?? "M. Vance", acmeOwner],
    );
  }

  async function addMandate(options: { instrumentId?: string; accountId?: string } = {}) {
    return db.query<{ id: string }>(
      `insert into public.crm_payment_mandates
         (organization_id, account_id, instrument_id, channel, agreement_text,
          agreement_version, authorized_by_name, authorized_at, recorded_by)
       values ($1, $2, $3, 'web', $4, 'v2.1', 'Marisol Vance',
               '2026-01-04T10:15:00Z', $5) returning id`,
      [acmeOrg, options.accountId ?? account, options.instrumentId ?? instrument,
        AGREEMENT, acmeOwner],
    );
  }

  async function makeInvoice(options: {
    total?: number; paid?: number; status?: string; accountId?: string; dueOn?: string;
  } = {}) {
    invoiceSeq += 1;
    const total = options.total ?? 12900;
    return db.query<{ id: string }>(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents,
          total_cents, paid_cents, issued_on, due_on, created_by)
       values ($1, $2, $3, $4::public.crm_invoice_status, $5, 0, $5, $6,
               '2026-02-10', $7, $8) returning id`,
      [acmeOrg, options.accountId ?? account, `INV-AP-${invoiceSeq}`,
        options.status ?? "open", total, options.paid ?? 0,
        options.dueOn ?? "2026-03-10", acmeOwner],
    );
  }

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed (see
    // tests/support/migrated-database). The coverage assertion each suite
    // used to make survives: the helper keys its cache on the CONTENT of
    // every migration, and this still pins the newest file by name.
    expect(await latestMigration()).toBe(LATEST_MIGRATION);
    db = await createMigratedDatabase();

    await db.exec(`
      insert into auth.users (id) values ('${acmeOwner}'), ('${rivalOwner}');
      insert into public.organizations (id, name, slug, created_by)
      values
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-autopay', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-autopay', '${rivalOwner}');
    `);

    await as(acmeOwner);
    account = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Marisol Vance', 'residential', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    otherAccount = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Harborview Foods', 'commercial', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;

    instrument = (await addInstrument()).rows[0].id;
    mandate = (await addMandate()).rows[0].id;
    enrollment = (await db.query<{ id: string }>(
      `insert into public.crm_autopay_enrollments
         (organization_id, account_id, instrument_id, mandate_id,
          charge_offset_days, max_amount_cents, created_by)
       values ($1, $2, $3, $4, 2, 20000, $5) returning id`,
      [acmeOrg, account, instrument, mandate, acmeOwner],
    )).rows[0].id;
  });

  afterAll(async () => {
    await db?.close();
  });

  it("refuses a card number wherever somebody might type one", async () => {
    await as(acmeOwner);
    // The failure this constraint exists for: a card number pasted into a
    // name field puts the whole database into PCI scope.
    await expect(addInstrument({ holder: "4111 1111 1111 1111" }))
      .rejects.toThrow(/holder_no_pan/i);
    await expect(addInstrument({ holder: "4111-1111-1111-1111" }))
      .rejects.toThrow(/holder_no_pan/i);
    await expect(addInstrument({ brand: "4111111111111111" }))
      .rejects.toThrow(/brand_no_pan/i);

    // Last four is exactly that, and nothing longer fits.
    await expect(
      db.query(
        `insert into public.crm_payment_instruments
           (organization_id, account_id, kind, display_brand, last_four,
            expires_month, expires_year, vault_purpose, created_by)
         values ($1, $2, 'card', 'Visa', '4111111111111111', 12, 2030,
                 'crm_card_token_acme', $3)`,
        [acmeOrg, account, acmeOwner]),
    ).rejects.toThrow(/last_four/i);
  });

  it("gives a card an expiry and a bank account none", async () => {
    await as(acmeOwner);
    const bank = await addInstrument({ kind: "bank_account", brand: "Cascadia Credit Union" });
    expect(bank.rows[0].id).toBeTruthy();

    await expect(
      db.query(
        `insert into public.crm_payment_instruments
           (organization_id, account_id, kind, display_brand, last_four,
            expires_month, expires_year, vault_purpose, created_by)
         values ($1, $2, 'bank_account', 'Cascadia', '0199', 12, 2030,
                 'crm_ach_token_acme', $3)`,
        [acmeOrg, account, acmeOwner]),
    ).rejects.toThrow(/expiry_iff_card/i);
  });

  it("will not rest autopay on somebody else's agreement", async () => {
    await as(acmeOwner);
    const otherInstrument = (await addInstrument()).rows[0].id;

    // A mandate for the customer's OTHER card authorizes nothing about this
    // one, and the trigger is what makes that true for every caller.
    await expect(
      db.query(
        `insert into public.crm_autopay_enrollments
           (organization_id, account_id, instrument_id, mandate_id,
            charge_offset_days, max_amount_cents, created_by)
         values ($1, $2, $3, $4, 0, 10000, $5)`,
        [acmeOrg, account, otherInstrument, mandate, acmeOwner]),
    ).rejects.toThrow(/must authorize this account and this instrument/i);
  });

  it("keeps the mandate exactly as agreed, for good", async () => {
    await as(acmeOwner);
    const stored = await db.query<{ agreement_text: string; agreement_version: string }>(
      `select agreement_text, agreement_version from public.crm_payment_mandates where id = $1`,
      [mandate]);
    expect(stored.rows[0].agreement_text).toBe(AGREEMENT);
    expect(stored.rows[0].agreement_version).toBe("v2.1");

    // The words shown on the day are the whole evidentiary value.
    await expect(
      db.query(`update public.crm_payment_mandates set agreement_text = 'Something else'
                 where id = $1`, [mandate]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.query(`delete from public.crm_payment_mandates where id = $1`, [mandate]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("charges the outstanding balance, never the whole bill again", async () => {
    await as(acmeOwner);
    // Part-paid by cheque. Charging the total would take the money twice.
    const invoice = (await makeInvoice({ total: 12900, paid: 5000 })).rows[0].id;
    const scheduled = await db.query<{
      attempt_amount_cents: number; attempt_scheduled_on: Date | string;
    }>(`select * from public.crm_autopay_schedule_charge($1, $2)`, [enrollment, invoice]);

    expect(Number(scheduled.rows[0].attempt_amount_cents)).toBe(7900);
    // Due 2026-03-10 with a two-day offset. A date column comes back as a
    // Date, so compare the day rather than the driver's rendering of it.
    expect(new Date(scheduled.rows[0].attempt_scheduled_on).toISOString().slice(0, 10))
      .toBe("2026-03-12");
  });

  it("stops at the ceiling the customer authorized, and says both numbers", async () => {
    await as(acmeOwner);
    const invoice = (await makeInvoice({ total: 45000 })).rows[0].id;
    await expect(
      db.query(`select * from public.crm_autopay_schedule_charge($1, $2)`, [enrollment, invoice]),
    ).rejects.toThrow(/charge is 450\.00 but the customer authorized at most 200\.00/i);
  });

  it("will not charge an invoice belonging to a different account", async () => {
    await as(acmeOwner);
    const invoice = (await makeInvoice({ accountId: otherAccount })).rows[0].id;
    await expect(
      db.query(`select * from public.crm_autopay_schedule_charge($1, $2)`, [enrollment, invoice]),
    ).rejects.toThrow(/different account/i);
  });

  it("will not schedule against a paid or empty invoice", async () => {
    await as(acmeOwner);
    const paid = (await makeInvoice({ status: "paid", total: 9000, paid: 9000 })).rows[0].id;
    await expect(
      db.query(`select * from public.crm_autopay_schedule_charge($1, $2)`, [enrollment, paid]),
    ).rejects.toThrow(/only an open invoice/i);
  });

  it("schedules one live charge per invoice, never two", async () => {
    await as(acmeOwner);
    const invoice = (await makeInvoice()).rows[0].id;
    await db.query(`select * from public.crm_autopay_schedule_charge($1, $2)`,
      [enrollment, invoice]);
    await expect(
      db.query(`select * from public.crm_autopay_schedule_charge($1, $2)`, [enrollment, invoice]),
    ).rejects.toThrow(/crm_charge_attempts_one_live_per_invoice_key/i);
  });

  it("cannot record money as moved while no processor is connected", async () => {
    await as(acmeOwner);
    const invoice = (await makeInvoice()).rows[0].id;
    const attempt = (await db.query<{ attempt_id: string }>(
      `select * from public.crm_autopay_schedule_charge($1, $2)`, [enrollment, invoice],
    )).rows[0].attempt_id;

    await expect(
      db.query(`select public.crm_autopay_record_settlement($1, 'ch_3Abc0Def0Ghi')`, [attempt]),
    ).rejects.toThrow(/no card payment provider is connected/i);

    // And there is no second route to that column.
    await expect(
      db.query(
        `update public.crm_charge_attempts
            set state = 'succeeded', settled_at = now(), processor_reference = 'invented'
          where id = $1`, [attempt]),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      db.query(
        `insert into public.crm_charge_attempts
           (organization_id, enrollment_id, invoice_id, amount_cents, scheduled_on,
            state, processor_reference, created_by)
         values ($1, $2, $3, 100, '2026-03-12', 'succeeded', 'invented', $4)`,
        [acmeOrg, enrollment, invoice, acmeOwner]),
    ).rejects.toThrow(/succeeded_evidence|one_live_per_invoice/i);
  });

  it("settles for real once a processor is genuinely connected", async () => {
    await as(acmeOwner);
    await db.query(
      `insert into public.crm_service_integrations
         (organization_id, provider, credential_purpose, display_label, enabled, created_by)
       values ($1, 'card_payments', 'crm_card_processor', 'Test processor', true, $2)`,
      [acmeOrg, acmeOwner]);

    const invoice = (await makeInvoice()).rows[0].id;
    const attempt = (await db.query<{ attempt_id: string }>(
      `select * from public.crm_autopay_schedule_charge($1, $2)`, [enrollment, invoice],
    )).rows[0].attempt_id;

    // The switch alone is not live.
    await expect(
      db.query(`select public.crm_autopay_record_settlement($1, 'ch_3Abc0Def0Ghi')`, [attempt]),
    ).rejects.toThrow(/no card payment provider is connected/i);

    await db.exec("reset role");
    await db.query(
      `insert into public.provider_credentials
         (organization_id, purpose, sealed_envelope, created_by)
       values ($1, 'crm_card_processor', $2, $3)`,
      [acmeOrg, `v1.${"a".repeat(48)}`, acmeOwner]);
    await as(acmeOwner);

    const settled = await db.query<{ crm_autopay_record_settlement: boolean }>(
      `select public.crm_autopay_record_settlement($1, 'ch_3Abc0Def0Ghi')`, [attempt]);
    expect(settled.rows[0].crm_autopay_record_settlement).toBe(true);

    const stored = await db.query<{ state: string; processor_reference: string }>(
      `select state, processor_reference from public.crm_charge_attempts where id = $1`,
      [attempt]);
    expect(stored.rows[0].state).toBe("succeeded");
    expect(stored.rows[0].processor_reference).toBe("ch_3Abc0Def0Ghi");

    // A settled charge is not cancellable: the money moved, and undoing it
    // is a refund, which this schema records elsewhere.
    await expect(
      db.query(`select public.crm_autopay_cancel_charge($1, 'changed mind')`, [attempt]),
    ).rejects.toThrow(/a succeeded charge cannot be cancelled/i);
  });

  it("holds one live enrollment per account, so two cannot race", async () => {
    await as(acmeOwner);
    const second = (await addInstrument()).rows[0].id;
    const secondMandate = (await addMandate({ instrumentId: second })).rows[0].id;
    await expect(
      db.query(
        `insert into public.crm_autopay_enrollments
           (organization_id, account_id, instrument_id, mandate_id,
            charge_offset_days, max_amount_cents, created_by)
         values ($1, $2, $3, $4, 0, 10000, $5)`,
        [acmeOrg, account, second, secondMandate, acmeOwner]),
    ).rejects.toThrow(/crm_autopay_enrollments_one_live_key/i);
  });

  it("will not enrol a payment method that was removed", async () => {
    await as(acmeOwner);
    const retired = (await addInstrument({ accountId: otherAccount })).rows[0].id;
    const retiredMandate = (await addMandate({
      instrumentId: retired, accountId: otherAccount,
    })).rows[0].id;
    await db.query(
      `update public.crm_payment_instruments
          set removed_at = now(), removed_reason = 'Card reported lost' where id = $1`,
      [retired]);

    await expect(
      db.query(
        `insert into public.crm_autopay_enrollments
           (organization_id, account_id, instrument_id, mandate_id,
            charge_offset_days, max_amount_cents, created_by)
         values ($1, $2, $3, $4, 0, 10000, $5)`,
        [acmeOrg, otherAccount, retired, retiredMandate, acmeOwner]),
    ).rejects.toThrow(/was removed/i);
  });

  it("agrees with the browser about what looks like a card number", async () => {
    await as(acmeOwner);
    // The browser refuses a PAN before it crosses the network; the schema
    // refuses one that gets there anyway. If the two rules disagree, the
    // browser either blocks what the database would take, or — the one
    // that matters — waves a card number onto the wire trusting a server
    // check that will not fire.
    const disagreements: string[] = [];
    for (const value of PAN_PARITY_CASES) {
      const server = await db.query<{ flagged: boolean }>(
        `select public.text_has_likely_pan($1) as flagged`, [value]);
      if (server.rows[0].flagged !== looksLikePan(value)) {
        disagreements.push(
          `${JSON.stringify(value)}: database ${server.rows[0].flagged}, browser ${looksLikePan(value)}`,
        );
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("keeps one workspace's instruments and charges out of another's", async () => {
    await as(rivalOwner);
    const instruments = await db.query<{ n: number }>(
      `select count(*)::int as n from public.crm_payment_instruments`);
    const charges = await db.query<{ n: number }>(
      `select count(*)::int as n from public.crm_charge_attempts`);
    const mandates = await db.query<{ n: number }>(
      `select count(*)::int as n from public.crm_payment_mandates`);
    expect(instruments.rows[0].n).toBe(0);
    expect(charges.rows[0].n).toBe(0);
    expect(mandates.rows[0].n).toBe(0);
  });
});
