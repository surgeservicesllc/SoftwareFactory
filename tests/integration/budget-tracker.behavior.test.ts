// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

vi.mock("server-only", () => ({}));

/**
 * The Budget Tracker schema, against real PostgreSQL semantics.
 *
 * This table set holds a household's finances, so the tests that matter are
 * the ones about who can read a row and what the database refuses to store:
 * a debit that is somehow positive, a credit limit on a mortgage, a second
 * import of the same file, a transaction pointed at someone else's account.
 */

const migrationsRoot = resolve(import.meta.dirname, "../../supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000b0001";
const housemateId = "00000000-0000-4000-8000-0000000b0002";
const outsiderId = "00000000-0000-4000-8000-0000000b0003";
const organizationId = "10000000-0000-4000-8000-0000000b0001";
const otherOrganizationId = "10000000-0000-4000-8000-0000000b0002";

let db: PGlite;

async function asUser(userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1::text, false)", [userId]);
  await db.query(
    "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)",
    [userId],
  );
  // Required, not decorative: a superuser bypasses RLS outright, FORCE or not.
  // Without assuming the authenticated role these tests would pass against a
  // schema with no policies at all.
  await db.exec("set role authenticated");
}

/**
 * A stable 64-character hex digest from a short label.
 *
 * The column requires real hex, so a padded label like "g1000..." is refused
 * — correctly. Hashing the label keeps the fixtures readable while producing
 * something the constraint accepts.
 */
function hexHash(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

async function makeAccount(
  userId: string,
  name: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const kind = (overrides.kind as string) ?? "checking";
  const organization = (overrides.organization_id as string) ?? organizationId;
  const result = await db.query<{ id: string }>(
    `insert into public.budget_accounts
       (organization_id, user_id, name, kind, credit_limit_cents, current_balance_cents)
     values ($1, $2, $3, $4::public.budget_account_kind, $5, $6)
     returning id`,
    [
      organization,
      userId,
      name,
      kind,
      (overrides.credit_limit_cents as number | null) ?? null,
      (overrides.current_balance_cents as number) ?? 0,
    ],
  );
  return result.rows[0].id;
}

async function insertTransaction(
  userId: string,
  accountId: string,
  values: {
    amount_cents: number;
    kind: string;
    hash: string;
    description?: string;
    organization_id?: string;
    category_id?: string | null;
  },
) {
  return db.query(
    `insert into public.budget_transactions
       (organization_id, user_id, account_id, category_id, posted_on, kind, description,
        amount_cents, content_hash)
     values ($1, $2, $3, $4, date '2026-09-04', $5::public.budget_transaction_kind, $6, $7, $8)`,
    [
      values.organization_id ?? organizationId,
      userId,
      accountId,
      values.category_id ?? null,
      values.kind,
      values.description ?? "TEST TRANSACTION",
      values.amount_cents,
      hexHash(values.hash),
    ],
  );
}

beforeAll(async () => {
  // The chain, restored from a snapshot rather than replayed; the
  // helper keys its cache on the CONTENT of every migration, and
  // asserts coverage of the whole directory.
  db = await createMigratedDatabase();

  await db.exec(`
    insert into auth.users (id) values ('${ownerId}'), ('${housemateId}'), ('${outsiderId}');
    insert into public.organizations (id, name, slug, created_by) values
      ('${organizationId}', 'Household', 'household', '${ownerId}'),
      ('${otherOrganizationId}', 'Outsider Co', 'outsider-co', '${outsiderId}');
    insert into public.organization_members (organization_id, user_id, role) values
      ('${organizationId}', '${ownerId}', 'owner'),
      ('${organizationId}', '${housemateId}', 'admin'),
      ('${otherOrganizationId}', '${outsiderId}', 'owner')
    on conflict (organization_id, user_id) do update set role = excluded.role;
  `);
}, 180_000);

beforeEach(async () => {
  await db.exec("reset role");
  await db.exec(`
    delete from public.budget_transactions;
    delete from public.budget_month_plans;
    delete from public.budget_import_batches;
    delete from public.budget_obligations;
    delete from public.budget_categories;
    delete from public.budget_accounts;
  `);
});

afterAll(async () => {
  await db?.close();
});

describe("money is integer cents", () => {
  it("stores a running total no float can hold, exactly", async () => {
    /*
     * The spreadsheet this replaces carries 5402.860000000001 in its running
     * total column, because 8,000 additions of binary floating point drift.
     * The same figures as cents must come back identical.
     */
    await asUser(ownerId);
    const accountId = await makeAccount(ownerId, "Checking");
    for (const [index, cents] of [149858, -1098, -6129, -6430].entries()) {
      await insertTransaction(ownerId, accountId, {
        amount_cents: cents,
        kind: cents > 0 ? "deposit" : "debit",
        hash: `a${index}`,
      });
    }

    const total = await db.query<{ sum: string }>(
      "select sum(amount_cents)::text as sum from public.budget_transactions",
    );
    expect(total.rows[0].sum).toBe("136201");
  });
});

describe("the database refuses what a ledger must never hold", () => {
  it("refuses a debit that is positive", async () => {
    await asUser(ownerId);
    const accountId = await makeAccount(ownerId, "Checking");
    await expect(
      insertTransaction(ownerId, accountId, { amount_cents: 4000, kind: "debit", hash: "b1" }),
    ).rejects.toThrow(/sign_follows_kind/);
  });

  it("refuses a deposit that is negative", async () => {
    await asUser(ownerId);
    const accountId = await makeAccount(ownerId, "Checking");
    await expect(
      insertTransaction(ownerId, accountId, { amount_cents: -4000, kind: "deposit", hash: "b2" }),
    ).rejects.toThrow(/sign_follows_kind/);
  });

  it("refuses a credit limit on anything that is not revolving credit", async () => {
    await asUser(ownerId);
    await expect(
      makeAccount(ownerId, "Mortgage", { kind: "mortgage", credit_limit_cents: 500000 }),
    ).rejects.toThrow(/limit_is_revolving/);
  });

  it("accepts a credit limit on a card, so utilization means something", async () => {
    await asUser(ownerId);
    const accountId = await makeAccount(ownerId, "Everyday card", {
      kind: "credit_card",
      credit_limit_cents: 500000,
      current_balance_cents: -320000,
    });
    expect(accountId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses a month plan that is not anchored to the first of a month", async () => {
    await asUser(ownerId);
    const category = await db.query<{ id: string }>(
      `insert into public.budget_categories (organization_id, user_id, name, kind)
       values ($1, $2, 'Groceries', 'expense') returning id`,
      [organizationId, ownerId],
    );
    await expect(
      db.query(
        `insert into public.budget_month_plans
           (organization_id, user_id, category_id, month, planned_cents)
         values ($1, $2, $3, date '2026-09-15', 80000)`,
        [organizationId, ownerId, category.rows[0].id],
      ),
    ).rejects.toThrow(/month_check|violates check/);
  });

  it("refuses an import batch claiming more imported rows than it read", async () => {
    await asUser(ownerId);
    const accountId = await makeAccount(ownerId, "Checking");
    await expect(
      db.query(
        `insert into public.budget_import_batches
           (organization_id, user_id, account_id, source_name, rows_read, rows_imported, rows_skipped)
         values ($1, $2, $3, 'Finances.xlsx', 10, 9, 4)`,
        [organizationId, ownerId, accountId],
      ),
    ).rejects.toThrow(/counts_add_up/);
  });
});

describe("importing the same file twice does not double the ledger", () => {
  it("conflicts on the second insert of an identical row", async () => {
    await asUser(ownerId);
    const accountId = await makeAccount(ownerId, "Checking");
    await insertTransaction(ownerId, accountId, {
      amount_cents: -25000,
      kind: "debit",
      hash: "c1",
      description: "CAR LOAN PAYMENT",
    });
    await expect(
      insertTransaction(ownerId, accountId, {
        amount_cents: -25000,
        kind: "debit",
        hash: "c1",
        description: "CAR LOAN PAYMENT",
      }),
    ).rejects.toThrow(/hash_per_person/);
  });

  it("keeps two genuinely repeated charges, because their occurrence differs", async () => {
    await asUser(ownerId);
    const accountId = await makeAccount(ownerId, "Checking");
    await insertTransaction(ownerId, accountId, {
      amount_cents: -14000,
      kind: "debit",
      hash: "d1",
      description: "STORE CARD",
    });
    await insertTransaction(ownerId, accountId, {
      amount_cents: -14000,
      kind: "debit",
      hash: "d2",
      description: "STORE CARD",
    });
    const count = await db.query<{ count: number }>(
      "select count(*)::int as count from public.budget_transactions",
    );
    expect(count.rows[0].count).toBe(2);
  });
});

describe("one person's finances are not another's", () => {
  it("hides a member's transactions from an admin of the same organization", async () => {
    await asUser(ownerId);
    const accountId = await makeAccount(ownerId, "Checking");
    await insertTransaction(ownerId, accountId, {
      amount_cents: 512300,
      kind: "deposit",
      hash: "e1",
      description: "DIRECT DEPOSIT",
    });

    await asUser(housemateId);
    const seen = await db.query<{ count: number }>(
      "select count(*)::int as count from public.budget_transactions",
    );
    expect(seen.rows[0].count).toBe(0);

    const accounts = await db.query<{ count: number }>(
      "select count(*)::int as count from public.budget_accounts",
    );
    expect(accounts.rows[0].count).toBe(0);
  });

  it("hides everything from someone outside the organization", async () => {
    await asUser(ownerId);
    await makeAccount(ownerId, "Checking");

    await asUser(outsiderId);
    const accounts = await db.query<{ count: number }>(
      "select count(*)::int as count from public.budget_accounts",
    );
    expect(accounts.rows[0].count).toBe(0);
  });

  it("refuses a transaction pointed at someone else's account", async () => {
    await asUser(housemateId);
    const housemateAccount = await makeAccount(housemateId, "Their Checking");

    await asUser(ownerId);
    await expect(
      insertTransaction(ownerId, housemateAccount, {
        amount_cents: -1000,
        kind: "debit",
        hash: "f1",
      }),
    ).rejects.toThrow(/account does not belong to this person/);
  });

  it("refuses a transaction filed under someone else's category", async () => {
    await asUser(housemateId);
    const theirCategory = await db.query<{ id: string }>(
      `insert into public.budget_categories (organization_id, user_id, name, kind)
       values ($1, $2, 'Their Groceries', 'expense') returning id`,
      [organizationId, housemateId],
    );

    await asUser(ownerId);
    const accountId = await makeAccount(ownerId, "Checking");
    await expect(
      insertTransaction(ownerId, accountId, {
        amount_cents: -1000,
        kind: "debit",
        hash: "f2",
        category_id: theirCategory.rows[0].id,
      }),
    ).rejects.toThrow(/category does not belong to this person/);
  });

  it("lets a month plan through for the writer's own category", async () => {
    await asUser(ownerId);
    const category = await db.query<{ id: string }>(
      `insert into public.budget_categories (organization_id, user_id, name, kind)
       values ($1, $2, 'Groceries', 'expense') returning id`,
      [organizationId, ownerId],
    );
    await db.query(
      `insert into public.budget_month_plans
         (organization_id, user_id, category_id, month, planned_cents)
       values ($1, $2, $3, date '2026-09-01', 80000)`,
      [organizationId, ownerId, category.rows[0].id],
    );
    const plans = await db.query<{ count: number }>(
      "select count(*)::int as count from public.budget_month_plans",
    );
    expect(plans.rows[0].count).toBe(1);
  });
});

describe("row level security is forced, not merely enabled", () => {
  it("forces RLS on every budget table", async () => {
    await db.exec("reset role");
    const result = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity
         from pg_class
        where relnamespace = 'public'::regnamespace
          and relname like 'budget_%'
          and relkind = 'r'
        order by relname`,
    );
    expect(result.rows.length).toBe(6);
    for (const row of result.rows) {
      expect({ table: row.relname, enabled: row.relrowsecurity, forced: row.relforcerowsecurity })
        .toEqual({ table: row.relname, enabled: true, forced: true });
    }
  });

  it("takes service_role's grants away even when something hands them over", async () => {
    /*
     * The one grant that would undo every policy above rather than widen one:
     * service_role is BYPASSRLS. The hosted database's default privileges hand
     * it each new table automatically, and the one-time narrowing migration
     * covered only the tables that existed when it ran.
     *
     * PGlite has no such default privileges, so simply checking the catalogue
     * here would pass against a migration that never revoked anything. This
     * grants them the way hosted would, re-applies the migration, and checks
     * they are gone — which fails if the revoke is removed.
     */
    await db.exec("reset role");
    await db.exec("grant all privileges on all tables in schema public to service_role");

    const granted = await db.query<{ count: number }>(
      `select count(distinct table_name)::int as count
         from information_schema.role_table_grants
        where grantee = 'service_role' and table_name like 'budget\\_%'`,
    );
    expect(granted.rows[0].count).toBe(6);

    await db.exec(
      await readFile(resolve(migrationsRoot, "20260829000200_budget_tracker_foundation.sql"), "utf8"),
    );

    const after = await db.query<{ table_name: string }>(
      `select distinct table_name
         from information_schema.role_table_grants
        where grantee = 'service_role' and table_name like 'budget\\_%'`,
    );
    expect(after.rows).toEqual([]);
  });

  it("grants anon nothing at all", async () => {
    await db.exec("reset role");
    const result = await db.query<{ count: number }>(
      `select count(*)::int as count
         from information_schema.role_table_grants
        where grantee = 'anon' and table_name like 'budget_%'`,
    );
    expect(result.rows[0].count).toBe(0);
  });
});

describe("the aggregate reads run as the caller, not as a definer", () => {
  it("totals a month's income and spending, leaving transfers out of both", async () => {
    await asUser(ownerId);
    const accountId = await makeAccount(ownerId, "Checking");
    // Two real movements and one transfer between the person's own accounts.
    await insertTransaction(ownerId, accountId, {
      amount_cents: 512300,
      kind: "deposit",
      hash: "g1",
      description: "DIRECT DEPOSIT",
    });
    await insertTransaction(ownerId, accountId, {
      amount_cents: -123456,
      kind: "debit",
      hash: "g2",
      description: "MORTGAGE",
    });
    await insertTransaction(ownerId, accountId, {
      amount_cents: -2000000,
      kind: "transfer_out",
      hash: "g3",
      description: "TRANSFER TO SAVINGS",
    });

    const flow = await db.query<{
      month: string;
      income_cents: number;
      expense_cents: number;
      net_cents: number;
      transaction_count: number;
    }>("select * from public.budget_monthly_flow($1::uuid, 36)", [organizationId]);

    expect(flow.rows.length).toBe(1);
    expect(flow.rows[0].income_cents).toBe(512300);
    expect(flow.rows[0].expense_cents).toBe(123456);
    expect(flow.rows[0].net_cents).toBe(388844);
    expect(flow.rows[0].transaction_count).toBe(2);
  });

  it("reports nothing to a member who owns none of the rows", async () => {
    await asUser(ownerId);
    const accountId = await makeAccount(ownerId, "Checking");
    await insertTransaction(ownerId, accountId, {
      amount_cents: 512300,
      kind: "deposit",
      hash: "h1",
    });

    // The same organization, a different person. A SECURITY DEFINER function
    // would answer here; this one must not.
    await asUser(housemateId);
    const flow = await db.query(
      "select * from public.budget_monthly_flow($1::uuid, 36)",
      [organizationId],
    );
    expect(flow.rows.length).toBe(0);
  });

  it("splits a month's spending by category", async () => {
    await asUser(ownerId);
    const accountId = await makeAccount(ownerId, "Checking");
    const category = await db.query<{ id: string }>(
      `insert into public.budget_categories (organization_id, user_id, name, kind)
       values ($1, $2, 'Utilities', 'expense') returning id`,
      [organizationId, ownerId],
    );
    await insertTransaction(ownerId, accountId, {
      amount_cents: -9900,
      kind: "debit",
      hash: "i1",
      description: "PHONE BILL",
      category_id: category.rows[0].id,
    });
    await insertTransaction(ownerId, accountId, {
      amount_cents: -6400,
      kind: "debit",
      hash: "i2",
      description: "INTERNET BILL",
      category_id: category.rows[0].id,
    });
    await insertTransaction(ownerId, accountId, {
      amount_cents: -4000,
      kind: "debit",
      hash: "i3",
      description: "UNFILED",
    });

    const spend = await db.query<{ category_id: string | null; spent_cents: number }>(
      "select * from public.budget_category_spend($1::uuid, date '2026-09-01')",
      [organizationId],
    );
    expect(spend.rows.length).toBe(2);
    expect(spend.rows[0]).toMatchObject({ category_id: category.rows[0].id, spent_cents: 16300 });
    // Uncategorised spending is its own bucket, not a silently dropped remainder.
    expect(spend.rows[1]).toMatchObject({ category_id: null, spent_cents: 4000 });
  });
});
