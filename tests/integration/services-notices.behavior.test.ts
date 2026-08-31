// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase, latestMigration } from "../support/migrated-database";
import { LATEST_MIGRATION } from "../support/latest-migration";

/**
 * Transactional service notices (ADR-217) against the real chain.
 *
 * The claim this file has to defend is a negative one: with no provider
 * connected, NOTHING in this schema can record that a notice was sent. Not
 * the function, not a direct update, not a hand-written insert. A test
 * that only proved the happy path would be proving the least interesting
 * half.
 */

const acmeOwner = "00000000-0000-4000-8000-000000017001";
const rivalOwner = "00000000-0000-4000-8000-000000017002";
const acmeOrg = "10000000-0000-4000-8000-000000017001";
const rivalOrg = "10000000-0000-4000-8000-000000017002";

describe("transactional service notices", { timeout: 240_000 }, () => {
  let db: PGlite;

  let account = "";
  let property = "";
  let visit = "";
  let invoice = "";

  async function as(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function compose(options: {
    kind?: string;
    channel?: string;
    subject?: string;
    destination?: string;
    body?: string;
    dueOn?: string;
    subjectLine?: string | null;
  } = {}) {
    return db.query<{ notice_id: string; notice_state: string; notice_duplicate: boolean }>(
      `select * from public.crm_notice_compose(
         $1::public.crm_notice_kind, $2::public.crm_channel, $3::uuid,
         $4, $5, $6::date, ($6::date + time '09:00') at time zone 'UTC', $7)`,
      [
        options.kind ?? "visit_reminder",
        options.channel ?? "sms",
        options.subject ?? visit,
        options.destination ?? "+15550100123",
        options.body ?? "Your quarterly service is tomorrow between 9 and 11.",
        options.dueOn ?? "2026-03-10",
        options.subjectLine === undefined ? null : options.subjectLine,
      ],
    );
  }

  async function setPreference(options: {
    channel?: string;
    transactional?: boolean;
    marketing?: boolean;
    stoppedAt?: string | null;
    reason?: string | null;
  }) {
    return db.query(
      `insert into public.crm_contact_preferences
         (organization_id, account_id, channel, transactional_allowed, marketing_allowed,
          do_not_contact_at, do_not_contact_reason, updated_by)
       values ($1, $2, $3::public.crm_channel, $4, $5, $6, $7, $8)
       on conflict (organization_id, account_id, channel) do update
         set transactional_allowed = excluded.transactional_allowed,
             marketing_allowed = excluded.marketing_allowed,
             do_not_contact_at = excluded.do_not_contact_at,
             do_not_contact_reason = excluded.do_not_contact_reason`,
      [acmeOrg, account, options.channel ?? "sms",
        options.transactional ?? true, options.marketing ?? true,
        options.stoppedAt ?? null, options.reason ?? null, acmeOwner],
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
        ('${acmeOrg}', 'Acme Pest', 'acme-pest-notices', '${acmeOwner}'),
        ('${rivalOrg}', 'Rival Pest', 'rival-pest-notices', '${rivalOwner}');
    `);

    await as(acmeOwner);
    account = (await db.query<{ id: string }>(
      `insert into public.crm_accounts (organization_id, name, kind, status, created_by)
       values ($1, 'Marisol Vance', 'residential', 'customer', $2) returning id`,
      [acmeOrg, acmeOwner],
    )).rows[0].id;
    property = (await db.query<{ id: string }>(
      `insert into public.crm_properties (organization_id, account_id, label, address)
       values ($1, $2, 'Vance residence', '88 Larkspur Lane') returning id`,
      [acmeOrg, account],
    )).rows[0].id;
    const technician = (await db.query<{ id: string }>(
      `insert into public.crm_technicians (organization_id, first_name, created_by)
       values ($1, 'Ada', $2) returning id`, [acmeOrg, acmeOwner],
    )).rows[0].id;
    visit = (await db.query<{ id: string }>(
      `insert into public.crm_work_orders
         (organization_id, account_id, property_id, technician_id, status, service_type,
          scheduled_start, scheduled_end, created_by)
       values ($1, $2, $3, $4, 'scheduled', 'Quarterly IPM', '2026-03-11T09:00:00Z',
               '2026-03-11T11:00:00Z', $5) returning id`,
      [acmeOrg, account, property, technician, acmeOwner],
    )).rows[0].id;
    invoice = (await db.query<{ id: string }>(
      `insert into public.crm_invoices
         (organization_id, account_id, number, status, subtotal_cents, tax_cents,
          total_cents, issued_on, due_on, created_by)
       values ($1, $2, 'INV-3310', 'open', 12000, 900, 12900,
               '2026-02-10', '2026-03-10', $3) returning id`,
      [acmeOrg, account, acmeOwner],
    )).rows[0].id;
  });

  afterAll(async () => {
    await db?.close();
  });

  it("derives the account from the visit rather than trusting a parameter", async () => {
    await as(acmeOwner);
    const composed = await compose({ dueOn: "2026-03-01" });

    expect(composed.rows[0].notice_state).toBe("composed");
    expect(composed.rows[0].notice_duplicate).toBe(false);

    const stored = await db.query<{ account_id: string; work_order_id: string }>(
      `select account_id, work_order_id from public.crm_notices where id = $1`,
      [composed.rows[0].notice_id]);
    expect(stored.rows[0].account_id).toBe(account);
    expect(stored.rows[0].work_order_id).toBe(visit);
  });

  it("cannot be recorded as sent while no provider is connected", async () => {
    await as(acmeOwner);
    const composed = await compose({ dueOn: "2026-03-02" });

    await expect(
      db.query(`select public.crm_notice_mark_dispatched($1, 'SM0123456789abcdef')`,
        [composed.rows[0].notice_id]),
    ).rejects.toThrow(/no sms provider is connected/i);

    const stored = await db.query<{ state: string }>(
      `select state from public.crm_notices where id = $1`, [composed.rows[0].notice_id]);
    expect(stored.rows[0].state).toBe("composed");
  });

  it("holds no update grant, so nothing can hand-write a send", async () => {
    await as(acmeOwner);
    const composed = await compose({ dueOn: "2026-03-03" });

    // The absence of the grant is the feature. A policy could be reasoned
    // around; a missing privilege cannot.
    await expect(
      db.query(
        `update public.crm_notices
            set state = 'sent', dispatched_at = now(), provider_reference = 'made-up'
          where id = $1`, [composed.rows[0].notice_id]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.query(`delete from public.crm_notices where id = $1`, [composed.rows[0].notice_id]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("refuses a sent row even when inserted directly with a provider reference", async () => {
    await as(acmeOwner);
    // Insert IS granted, so the constraint has to carry this one: a row
    // claiming 'sent' without a dispatch moment is not a shape this table
    // can hold.
    await expect(
      db.query(
        `insert into public.crm_notices
           (organization_id, account_id, kind, channel, state, work_order_id,
            body, destination, due_on, due_at, provider_reference, created_by)
         values ($1, $2, 'visit_reminder', 'sms', 'sent', $3,
                 'Anything', '+15550100123', '2026-03-04', now(), 'invented', $4)`,
        [acmeOrg, account, visit, acmeOwner]),
    ).rejects.toThrow(/crm_notices_sent_evidence/i);
  });

  it("composes once per subject per day, however many times it is asked", async () => {
    await as(acmeOwner);
    const first = await compose({ dueOn: "2026-03-05" });
    const second = await compose({ dueOn: "2026-03-05", body: "A different wording." });

    expect(second.rows[0].notice_duplicate).toBe(true);
    expect(second.rows[0].notice_id).toBe(first.rows[0].notice_id);

    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from public.crm_notices
        where work_order_id = $1 and due_on = '2026-03-05'`, [visit]);
    expect(count.rows[0].n).toBe(1);
  });

  it("suppresses on a do-not-contact, and keeps the row saying so", async () => {
    await as(acmeOwner);
    await setPreference({
      transactional: false, marketing: false,
      stoppedAt: "2026-02-01T00:00:00Z", reason: "Asked by phone on 1 February.",
    });

    const composed = await compose({ dueOn: "2026-03-06" });
    expect(composed.rows[0].notice_state).toBe("suppressed");

    const stored = await db.query<{ suppression_reason: string; body: string }>(
      `select suppression_reason, body from public.crm_notices where id = $1`,
      [composed.rows[0].notice_id]);
    // The point: a suppressed notice still exists, still says what it would
    // have said, and names why nobody got it.
    expect(stored.rows[0].suppression_reason).toMatch(/asked not to be contacted on sms/i);
    expect(stored.rows[0].body).toMatch(/quarterly service/i);

    await setPreference({ transactional: true, marketing: true, stoppedAt: null, reason: null });
  });

  it("shows the suppressed ones alongside the outstanding ones", async () => {
    await as(acmeOwner);
    const outstanding = await db.query<{ notice_state: string }>(
      `select * from public.crm_notices_outstanding($1, 500)`, [acmeOrg]);

    const states = new Set(outstanding.rows.map((row) => row.notice_state));
    expect(states.has("composed")).toBe(true);
    expect(states.has("suppressed")).toBe(true);
  });

  it("has no state that means do-not-contact but marketing is fine", async () => {
    await as(acmeOwner);
    await expect(
      setPreference({
        channel: "email", transactional: false, marketing: true,
        stoppedAt: "2026-02-01T00:00:00Z", reason: "Contradictory on purpose.",
      }),
    ).rejects.toThrow(/crm_contact_preferences_stop_forbids_everything/i);
  });

  it("writes a preference change into the account's history", async () => {
    await as(acmeOwner);
    await setPreference({
      channel: "email", transactional: false, marketing: false,
      stoppedAt: "2026-02-02T00:00:00Z", reason: "Written request.",
    });
    await setPreference({
      channel: "email", transactional: true, marketing: true, stoppedAt: null, reason: null,
    });

    const history = await db.query<{ summary: string }>(
      `select summary from public.crm_timeline_events
        where account_id = $1 and kind = 'status_change' order by recorded_at`, [account]);
    const summaries = history.rows.map((row) => row.summary);

    expect(summaries).toContain("Do not contact on email.");
    // The lift is the transition nobody could reconstruct from current state.
    expect(summaries).toContain("Do-not-contact lifted on email.");
  });

  it("refuses a notice whose kind does not match what it points at", async () => {
    await as(acmeOwner);
    await expect(
      db.query(
        `insert into public.crm_notices
           (organization_id, account_id, kind, channel, work_order_id,
            body, destination, due_on, due_at, created_by)
         values ($1, $2, 'invoice_overdue', 'sms', $3,
                 'Your invoice is overdue.', '+15550100123', '2026-03-07', now(), $4)`,
        [acmeOrg, account, visit, acmeOwner]),
    ).rejects.toThrow(/crm_notices_subject_matches_kind/i);
  });

  it("gives an email a subject line and an SMS none", async () => {
    await as(acmeOwner);
    const email = await compose({
      kind: "invoice_overdue", channel: "email", subject: invoice,
      destination: "marisol@example.test", body: "Invoice INV-3310 is past due.",
      dueOn: "2026-03-08", subjectLine: "Invoice INV-3310 is past due",
    });
    expect(email.rows[0].notice_state).toBe("composed");

    await expect(
      compose({ channel: "sms", dueOn: "2026-03-09", subjectLine: "SMS has no subject" }),
    ).rejects.toThrow(/crm_notices_subject_line_iff_email/i);
  });

  it("keeps one workspace's notices out of another's", async () => {
    await as(rivalOwner);
    const visible = await db.query<{ n: number }>(
      `select count(*)::int as n from public.crm_notices`);
    expect(visible.rows[0].n).toBe(0);

    await expect(
      db.query(`select * from public.crm_notice_compose(
        'visit_reminder'::public.crm_notice_kind, 'sms'::public.crm_channel, $1::uuid,
        '+15550100999', 'Poaching attempt.', '2026-03-12'::date, now(), null)`, [visit]),
    ).rejects.toThrow(/no such visit_reminder subject/i);
  });

  it("dispatches once a provider is genuinely connected, and not merely enabled", async () => {
    await as(acmeOwner);
    // The owner's half of `live`: a switch, which on its own does nothing.
    await db.query(
      `insert into public.crm_service_integrations
         (organization_id, provider, credential_purpose, display_label, enabled, created_by)
       values ($1, 'sms', 'crm_sms_provider', 'Test SMS', true, $2)`,
      [acmeOrg, acmeOwner]);

    const stillRefused = await compose({ dueOn: "2026-03-20" });
    await expect(
      db.query(`select public.crm_notice_mark_dispatched($1, 'SM0123456789abcdef')`,
        [stillRefused.rows[0].notice_id]),
    ).rejects.toThrow(/no sms provider is connected/i);

    // The other half: a sealed credential really present. No browser role
    // can write one, which is why this insert drops out of `authenticated`
    // — it models the server-side path, not something a member can do.
    await db.exec("reset role");
    await db.query(
      `insert into public.provider_credentials
         (organization_id, purpose, sealed_envelope, created_by)
       values ($1, 'crm_sms_provider', $2, $3)`,
      [acmeOrg, `v1.${"a".repeat(48)}`, acmeOwner]);

    await as(acmeOwner);
    const dispatched = await db.query<{ crm_notice_mark_dispatched: boolean }>(
      `select public.crm_notice_mark_dispatched($1, 'SM0123456789abcdef')`,
      [stillRefused.rows[0].notice_id]);
    expect(dispatched.rows[0].crm_notice_mark_dispatched).toBe(true);

    const stored = await db.query<{ state: string; provider_reference: string; dispatched_at: string }>(
      `select state, provider_reference, dispatched_at
         from public.crm_notices where id = $1`, [stillRefused.rows[0].notice_id]);
    expect(stored.rows[0].state).toBe("sent");
    expect(stored.rows[0].provider_reference).toBe("SM0123456789abcdef");
    expect(stored.rows[0].dispatched_at).not.toBeNull();
  });

  it("stops dispatching the moment the owner switches the provider off", async () => {
    await as(acmeOwner);
    await db.query(
      `update public.crm_service_integrations set enabled = false
        where organization_id = $1 and provider = 'sms'`, [acmeOrg]);

    const composed = await compose({ dueOn: "2026-03-21" });
    await expect(
      db.query(`select public.crm_notice_mark_dispatched($1, 'SMdeadbeefdeadbeef')`,
        [composed.rows[0].notice_id]),
    ).rejects.toThrow(/no sms provider is connected/i);

    await db.query(
      `update public.crm_service_integrations set enabled = true
        where organization_id = $1 and provider = 'sms'`, [acmeOrg]);
  });

  it("will not dispatch the same notice twice", async () => {
    await as(acmeOwner);
    const composed = await compose({ dueOn: "2026-03-22" });
    await db.query(`select public.crm_notice_mark_dispatched($1, 'SMaaaabbbbccccdddd')`,
      [composed.rows[0].notice_id]);

    await expect(
      db.query(`select public.crm_notice_mark_dispatched($1, 'SMeeeeffff00001111')`,
        [composed.rows[0].notice_id]),
    ).rejects.toThrow(/only a composed notice can be dispatched; this one is sent/i);
  });

  it("will not cancel something that was already sent, and cancels what was not", async () => {
    await as(acmeOwner);
    const composed = await compose({ dueOn: "2026-03-13" });
    const cancelled = await db.query<{ crm_notice_cancel: boolean }>(
      `select public.crm_notice_cancel($1)`, [composed.rows[0].notice_id]);
    expect(cancelled.rows[0].crm_notice_cancel).toBe(true);

    // Cancelling frees the day, so a corrected replacement can be composed.
    const replacement = await compose({ dueOn: "2026-03-13", body: "Corrected window: 1 to 3." });
    expect(replacement.rows[0].notice_duplicate).toBe(false);
    expect(replacement.rows[0].notice_id).not.toBe(composed.rows[0].notice_id);

    // A sent notice cannot be cancelled. The customer has it; unsaying it
    // is not something this schema gets to pretend it can do.
    const sent = await compose({ dueOn: "2026-03-23" });
    await db.query(`select public.crm_notice_mark_dispatched($1, 'SM1111222233334444')`,
      [sent.rows[0].notice_id]);
    await expect(
      db.query(`select public.crm_notice_cancel($1)`, [sent.rows[0].notice_id]),
    ).rejects.toThrow(/a sent notice cannot be cancelled/i);
  });
});
