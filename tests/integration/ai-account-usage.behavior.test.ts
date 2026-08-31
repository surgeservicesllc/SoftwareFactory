// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

/**
 * Usage observations against the real migrated schema: only the worker's
 * definer function can write, only members can read, rows are append-only,
 * the window payload is allowlisted down to its keys, and the projection
 * returns exactly the latest row per account — because the console renders
 * whatever this returns as the truth about a subscription's usage.
 */


const ownerId = "00000000-0000-4000-8000-0000000000c1";
const memberId = "00000000-0000-4000-8000-0000000000c2";
const outsiderId = "00000000-0000-4000-8000-0000000000c3";
const organizationId = "10000000-0000-4000-8000-0000000000c1";
const otherOrganizationId = "10000000-0000-4000-8000-0000000000c2";

const windows = [
  {
    window_key: "session_5h",
    label: "Session (5h)",
    used_percent: 37.3,
    resets_at: "2026-08-16T21:00:00.000Z",
  },
  { window_key: "week_all_models", label: "Week (all models)", used_percent: 82 },
];

async function assumeRole(db: PGlite, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

describe("ai account usage observations", { timeout: 180_000 }, () => {
  let db: PGlite;
  let accountId: string;
  let otherOrgAccountId: string;

  async function record(
    targetOrganizationId: string,
    targetAccountId: string,
    status: string,
    payload: unknown,
    detail: string | null = null,
  ) {
    return db.query<{ record_ai_account_usage: string }>(
      "select public.record_ai_account_usage($1::uuid, $2::uuid, $3, $4::jsonb, $5)",
      [targetOrganizationId, targetAccountId, status, JSON.stringify(payload), detail],
    );
  }

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Factory', 'factory-usage', '${ownerId}'),
             ('${otherOrganizationId}', 'Elsewhere', 'elsewhere-usage', '${outsiderId}');
      insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${memberId}', 'member')
      on conflict do nothing;
    `);

    await assumeRole(db, ownerId);
    const created = await db.query<{ create_ai_account: string }>(
      "select public.create_ai_account($1::uuid, 'anthropic', 'subscription', 'Claude account 1', 'claude')",
      [organizationId],
    );
    accountId = created.rows[0].create_ai_account;
    await resetRole(db);

    await assumeRole(db, outsiderId);
    const other = await db.query<{ create_ai_account: string }>(
      "select public.create_ai_account($1::uuid, 'anthropic', 'subscription', 'Claude account 1', 'claude')",
      [otherOrganizationId],
    );
    otherOrgAccountId = other.rows[0].create_ai_account;
    await resetRole(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("records a measured observation and serves the latest row per account to members", async () => {
    await record(organizationId, accountId, "measured", windows);
    // A later failed probe is newer truth and must win the projection. The
    // pause guarantees a strictly later observed_at across autocommits.
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 25));
    await record(
      organizationId,
      accountId,
      "unavailable",
      [],
      "The provider refused the stored credential (HTTP 401).",
    );

    await assumeRole(db, memberId);
    const listed = await db.query<{
      usage_account_id: string;
      usage_status: string;
      usage_windows: unknown;
      usage_detail: string | null;
      usage_measured_at: string | null;
      usage_measured_windows: Array<{ window_key: string }> | null;
    }>("select * from public.list_ai_account_usage($1::uuid)", [organizationId]);
    await resetRole(db);

    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0].usage_account_id).toBe(accountId);
    expect(listed.rows[0].usage_status).toBe("unavailable");
    expect(listed.rows[0].usage_detail).toContain("HTTP 401");
    // The failed probe is the latest truth, but it must not erase the last
    // real measurement: the row carries both, each under its own timestamp.
    // This is what keeps a rate-limited sweep from blanking the Bot Manager's
    // usage bars beside a green Connected badge.
    expect(listed.rows[0].usage_measured_at).not.toBeNull();
    expect(
      (listed.rows[0].usage_measured_windows ?? []).map((window) => window.window_key),
    ).toEqual(windows.map((window) => window.window_key));
  });

  it("carries no measurement columns for an account that has never measured", async () => {
    // A fresh account whose first probe failed: the projection must say so
    // without inventing a prior measurement.
    await assumeRole(db, ownerId);
    const freshAccount = await db.query<{ create_ai_account: string }>(
      "select public.create_ai_account($1::uuid, 'anthropic', 'subscription', 'Fresh account', 'claude_fresh')",
      [organizationId],
    );
    await resetRole(db);
    const freshId = freshAccount.rows[0].create_ai_account;
    await record(organizationId, freshId, "unavailable", [], "The usage endpoint could not be reached.");

    await assumeRole(db, memberId);
    const listed = await db.query<{
      usage_account_id: string;
      usage_measured_at: string | null;
      usage_measured_windows: unknown;
    }>("select * from public.list_ai_account_usage($1::uuid)", [organizationId]);
    await resetRole(db);

    const fresh = listed.rows.find((row) => row.usage_account_id === freshId);
    expect(fresh).toBeDefined();
    expect(fresh?.usage_measured_at).toBeNull();
    expect(fresh?.usage_measured_windows).toBeNull();
  });

  it("refuses a measured observation without windows, and windows on a failure", async () => {
    await expect(record(organizationId, accountId, "measured", [])).rejects.toThrow();
    await expect(
      record(organizationId, accountId, "unavailable", windows, "failed"),
    ).rejects.toThrow();
  });

  it("allowlists the window payload down to its keys and bounds", async () => {
    const bad = [
      [{ label: "Session", used_percent: 10 }], // missing window_key
      [{ window_key: "session_5h", label: "Session", used_percent: 101 }],
      [{ window_key: "session_5h", label: "Session", used_percent: -1 }],
      [{ window_key: "Session-5h!", label: "Session", used_percent: 10 }],
      [{ window_key: "session_5h", label: "Session", used_percent: 10, extra: "field" }],
      [{ window_key: "session_5h", label: "sk-ant-api03-abcdefghijklmnopqrstuvwx", used_percent: 10 }],
      "not-an-array",
      [[1, 2, 3]],
    ];
    for (const payload of bad) {
      await expect(record(organizationId, accountId, "measured", payload)).rejects.toThrow();
    }
  });

  it("refuses secret-shaped detail text", async () => {
    await expect(
      record(
        organizationId,
        accountId,
        "unavailable",
        [],
        "token sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345 leaked into an error",
      ),
    ).rejects.toThrow();
  });

  it("refuses to attribute usage across a tenant boundary", async () => {
    await expect(
      record(organizationId, otherOrgAccountId, "unsupported", []),
    ).rejects.toThrow();
  });

  it("is append-only and closed to direct table access", async () => {
    await expect(
      db.query("update public.ai_account_usage_observations set status = 'measured'"),
    ).rejects.toThrow();
    await expect(
      db.query("delete from public.ai_account_usage_observations"),
    ).rejects.toThrow();

    await assumeRole(db, memberId);
    await expect(
      db.query("select * from public.ai_account_usage_observations"),
    ).rejects.toThrow();
    await expect(
      db.query(
        "select public.record_ai_account_usage($1::uuid, $2::uuid, 'unsupported', '[]'::jsonb, null)",
        [organizationId, accountId],
      ),
    ).rejects.toThrow();
    await resetRole(db);
  });

  it("keeps non-members and anonymous callers out of the projection", async () => {
    await assumeRole(db, outsiderId);
    await expect(
      db.query("select * from public.list_ai_account_usage($1::uuid)", [organizationId]),
    ).rejects.toThrow();
    await resetRole(db);

    await db.exec("set role anon");
    await expect(
      db.query("select * from public.list_ai_account_usage($1::uuid)", [organizationId]),
    ).rejects.toThrow();
    await db.exec("reset role");
  });
});
