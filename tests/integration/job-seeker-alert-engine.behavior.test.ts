// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

vi.mock("server-only", () => ({}));

/**
 * The alert engine's definer boundary, against real PostgreSQL semantics.
 *
 * The runner's unit tests mock these two functions; this suite runs the SQL
 * itself. The rules that must not rot live in the database: due-ness windows
 * measured from last_scanned_at, the recipient read through the row so an
 * account without an email is never offered, ON CONFLICT DO NOTHING as the
 * never-repeat guarantee, and a ledger nothing can rewrite.
 *
 * The auth.users shim here carries an email column deliberately: the
 * function reads `(to_jsonb(u) ->> 'email')` exactly so it works with and
 * without one, and this suite exercises the "with" side the minimal shims
 * cannot.
 */


const seekerId = "00000000-0000-4000-8000-0000000a1001";
const emaillessId = "00000000-0000-4000-8000-0000000a1002";
const organizationId = "10000000-0000-4000-8000-0000000a1001";
const bareOrganizationId = "10000000-0000-4000-8000-0000000a1002";

let db: PGlite;

async function asService<T>(run: () => Promise<T>): Promise<T> {
  await db.exec("reset role");
  return run();
}

async function makeSearch(name: string, userId = seekerId, organization = organizationId) {
  const row = await db.query<{ id: string }>(
    `insert into public.job_seeker_saved_searches (organization_id, user_id, name, query)
     values ($1, $2, $3, '{"text":"marketing"}'::jsonb) returning id`,
    [organization, userId, name],
  );
  return row.rows[0].id;
}

async function makeAlert(
  savedSearchId: string,
  cadence: string,
  lastScannedAt: string | null,
  overrides: { userId?: string; organizationId?: string; active?: boolean } = {},
) {
  const row = await db.query<{ id: string }>(
    `insert into public.job_seeker_search_alerts
       (organization_id, user_id, saved_search_id, cadence, active, last_scanned_at)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      overrides.organizationId ?? organizationId,
      overrides.userId ?? seekerId,
      savedSearchId,
      cadence,
      overrides.active ?? true,
      lastScannedAt,
    ],
  );
  return row.rows[0].id;
}

type DueRow = {
  alert_id: string;
  recipient_email: string;
  search_name: string;
  cadence: string;
  profile_recorded: boolean;
  profile: Record<string, unknown>;
  delivered_urls: string[];
};

async function listDue(now: string): Promise<DueRow[]> {
  const result = await db.query<DueRow>(
    "select * from public.list_due_job_seeker_alerts($1::timestamptz)",
    [now],
  );
  return result.rows;
}

const NOW = "2026-08-29T12:00:00Z";

function hoursBefore(hours: number): string {
  return new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();
}

beforeAll(async () => {
  // The chain, restored from a snapshot rather than replayed; the
  // helper keys its cache on the CONTENT of every migration, and
  // asserts coverage of the whole directory.
  db = await createMigratedDatabase();

  await db.exec(`
    insert into auth.users (id, email) values
      ('${seekerId}', 'seeker@example.org'),
      ('${emaillessId}', null);
    insert into public.organizations (id, name, slug, created_by) values
      ('${organizationId}', 'Seeker Co', 'seeker-co', '${seekerId}'),
      ('${bareOrganizationId}', 'Bare Co', 'bare-co', '${emaillessId}');
    insert into public.organization_members (organization_id, user_id, role) values
      ('${organizationId}', '${seekerId}', 'owner'),
      ('${bareOrganizationId}', '${emaillessId}', 'owner')
    on conflict do nothing;
    insert into public.job_seeker_profiles (organization_id, user_id, skills, location)
      values ('${organizationId}', '${seekerId}', '["paid acquisition"]'::jsonb, 'USA');
    insert into public.job_seeker_preferences (organization_id, user_id, qualification_threshold)
      values ('${organizationId}', '${seekerId}', 80);
  `);
}, 120_000);

describe("which alerts are due", () => {
  it("offers a never-scanned alert with the recipient, the stored query, and the recorded facts", async () => {
    const searchId = await makeSearch("Never scanned");
    const alertId = await makeAlert(searchId, "daily", null);

    const due = await listDue(NOW);
    const row = due.find((entry) => entry.alert_id === alertId);
    expect(row).toBeDefined();
    expect(row?.recipient_email).toBe("seeker@example.org");
    expect(row?.search_name).toBe("Never scanned");
    expect(row?.profile_recorded).toBe(true);
    expect(row?.profile).toMatchObject({ skills: ["paid acquisition"], location: "USA" });
    expect(row?.delivered_urls).toEqual([]);
  });

  it("measures each cadence's window from last_scanned_at", async () => {
    const cases: Array<[string, number, boolean]> = [
      ["asap", 0.5, false],
      ["asap", 1, true],
      ["daily", 12, false],
      ["daily", 23.5, true],
      ["weekly", 5 * 24, false],
      ["weekly", 6 * 24 + 19, true],
    ];
    for (const [cadence, hours, expected] of cases) {
      const searchId = await makeSearch(`${cadence} at -${hours}h`);
      const alertId = await makeAlert(searchId, cadence, hoursBefore(hours));
      const due = await listDue(NOW);
      expect(
        due.some((entry) => entry.alert_id === alertId),
        `${cadence} scanned ${hours}h ago should ${expected ? "" : "not "}be due`,
      ).toBe(expected);
    }
  });

  it("never offers an account that has no email address", async () => {
    const searchId = await makeSearch("No address", emaillessId, bareOrganizationId);
    const alertId = await makeAlert(searchId, "daily", null, {
      userId: emaillessId,
      organizationId: bareOrganizationId,
    });
    const due = await listDue(NOW);
    expect(due.some((entry) => entry.alert_id === alertId)).toBe(false);
  });

  it("leaves a paused alert alone", async () => {
    const searchId = await makeSearch("Paused");
    const alertId = await makeAlert(searchId, "daily", null, { active: false });
    const due = await listDue(NOW);
    expect(due.some((entry) => entry.alert_id === alertId)).toBe(false);
  });

  it("says profile_recorded false when no profile row exists, instead of inventing facts", async () => {
    await db.exec(`
      insert into auth.users (id, email)
        values ('00000000-0000-4000-8000-0000000a1003', 'bare@example.org');
      insert into public.organization_members (organization_id, user_id, role)
        values ('${bareOrganizationId}', '00000000-0000-4000-8000-0000000a1003', 'member')
      on conflict do nothing;
    `);
    const searchId = await makeSearch(
      "Bare profile", "00000000-0000-4000-8000-0000000a1003", bareOrganizationId,
    );
    const alertId = await makeAlert(searchId, "daily", null, {
      userId: "00000000-0000-4000-8000-0000000a1003",
      organizationId: bareOrganizationId,
    });
    const due = await listDue(NOW);
    const row = due.find((entry) => entry.alert_id === alertId);
    expect(row?.profile_recorded).toBe(false);
  });
});

describe("recording a scan", () => {
  it("bumps last_scanned_at, stores the deliveries, and reports exactly the new URLs", async () => {
    const searchId = await makeSearch("Records deliveries");
    const alertId = await makeAlert(searchId, "daily", null);

    const recorded = await db.query<{ job_url: string }>(
      "select * from public.record_job_seeker_alert_scan($1, $2::jsonb)",
      [alertId, JSON.stringify([
        {
          jobUrl: "https://remotive.com/remote-jobs/100",
          jobTitle: "Growth Marketing Manager",
          jobCompany: "Contra",
          board: "remotive",
          matchScore: 85,
          emailStatus: "sent",
        },
      ])],
    );
    expect(recorded.rows.map((row) => row.job_url)).toEqual([
      "https://remotive.com/remote-jobs/100",
    ]);

    const alert = await db.query<{ last_scanned_at: string | null }>(
      "select last_scanned_at from public.job_seeker_search_alerts where id = $1",
      [alertId],
    );
    expect(alert.rows[0].last_scanned_at).not.toBeNull();

    // Scanned just now, so the alert leaves the due list.
    const due = await listDue(new Date().toISOString());
    expect(due.some((entry) => entry.alert_id === alertId)).toBe(false);
  });

  it("makes re-delivery structurally impossible: the same URL again returns nothing and stores nothing", async () => {
    const searchId = await makeSearch("Never repeats");
    const alertId = await makeAlert(searchId, "daily", null);
    const delivery = JSON.stringify([
      {
        jobUrl: "https://remotive.com/remote-jobs/200",
        jobTitle: "Role",
        jobCompany: "Acme",
        board: "remotive",
        matchScore: null,
        emailStatus: "sent",
      },
    ]);

    const first = await db.query<{ job_url: string }>(
      "select * from public.record_job_seeker_alert_scan($1, $2::jsonb)", [alertId, delivery]);
    expect(first.rows).toHaveLength(1);

    const second = await db.query<{ job_url: string }>(
      "select * from public.record_job_seeker_alert_scan($1, $2::jsonb)", [alertId, delivery]);
    expect(second.rows).toHaveLength(0);

    const ledger = await db.query<{ count: number }>(
      `select count(*)::int as count from public.job_seeker_alert_deliveries
        where saved_search_id = $1`, [searchId]);
    expect(ledger.rows[0].count).toBe(1);
  });

  it("hands already-delivered URLs to the next listing, so the engine can skip them before searching", async () => {
    const searchId = await makeSearch("Carries history");
    const alertId = await makeAlert(searchId, "daily", null);
    await db.query(
      "select * from public.record_job_seeker_alert_scan($1, $2::jsonb)",
      [alertId, JSON.stringify([
        {
          jobUrl: "https://remotive.com/remote-jobs/300",
          jobTitle: "Role",
          jobCompany: "Acme",
          board: "remotive",
          matchScore: 42,
          emailStatus: "failed",
        },
      ])],
    );
    // Make it due again without waiting a day.
    await db.query(
      "update public.job_seeker_search_alerts set last_scanned_at = $2 where id = $1",
      [alertId, hoursBefore(24)],
    );

    const due = await listDue(NOW);
    const row = due.find((entry) => entry.alert_id === alertId);
    expect(row?.delivered_urls).toEqual(["https://remotive.com/remote-jobs/300"]);
  });

  it("refuses a scan for an alert that does not exist", async () => {
    await expect(
      db.query("select * from public.record_job_seeker_alert_scan($1, '[]'::jsonb)",
        ["00000000-0000-4000-8000-00000000dead"]),
    ).rejects.toThrow(/no such alert/);
  });
});

describe("the ledger and the boundary", () => {
  it("keeps the ledger append-only, because deleting a row would re-arm never-repeat", async () => {
    const searchId = await makeSearch("Immutable ledger");
    const alertId = await makeAlert(searchId, "daily", null);
    await db.query(
      "select * from public.record_job_seeker_alert_scan($1, $2::jsonb)",
      [alertId, JSON.stringify([
        {
          jobUrl: "https://remotive.com/remote-jobs/400",
          jobTitle: "Role",
          jobCompany: "Acme",
          board: "remotive",
          matchScore: null,
          emailStatus: "sent",
        },
      ])],
    );

    await expect(asService(() =>
      db.query("update public.job_seeker_alert_deliveries set email_status = 'failed' where saved_search_id = $1",
        [searchId]),
    )).rejects.toThrow(/append-only/);
    await expect(asService(() =>
      db.query("delete from public.job_seeker_alert_deliveries where saved_search_id = $1", [searchId]),
    )).rejects.toThrow(/append-only/);
  });

  it("refuses both functions to a signed-in browser session", async () => {
    await db.exec("set role authenticated");
    try {
      await expect(
        db.query("select * from public.list_due_job_seeker_alerts(now())"),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query("select * from public.record_job_seeker_alert_scan($1, '[]'::jsonb)",
          ["00000000-0000-4000-8000-00000000dead"]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });
});
