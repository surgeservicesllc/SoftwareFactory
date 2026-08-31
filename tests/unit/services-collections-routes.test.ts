// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { GET as listRuns, POST as runBilling } from "@/app/api/services/billing/recurring/route";
import { GET as worklist, POST as recordNotice } from "@/app/api/services/collections/route";

/**
 * The billing and collections boundary.
 *
 * The behavior suite proves the database cannot double-bill. This file pins
 * what the ROUTE must not undo: the organization is never taken from the
 * caller's body, a re-run's skipped count survives to the response rather
 * than being flattened into a success, the two provider-gated controls stay
 * labelled Not Connected, and the untouched count — the reason the worklist
 * exists — is computed rather than assumed.
 */

const organizationId = "10000000-0000-4000-8000-0000000f0001";
const userId = "00000000-0000-4000-8000-0000000f0001";
const accountId = "20000000-0000-4000-8000-0000000f0001";
const invoiceId = "30000000-0000-4000-8000-0000000f0001";

type QueryResult = { data: unknown; error: unknown };

function stubTable(results: QueryResult[]) {
  let call = 0;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "insert", "update", "eq", "in", "order", "limit"]) {
    builder[method] = vi.fn(chain);
  }
  const next = () => Promise.resolve(results[Math.min(call++, results.length - 1)]);
  builder.single = vi.fn(next);
  builder.maybeSingle = vi.fn(next);
  builder.then = (onFulfilled: (value: QueryResult) => unknown) => next().then(onFulfilled);
  return builder;
}

let from: ReturnType<typeof vi.fn>;
let rpc: ReturnType<typeof vi.fn>;
let tables: Map<string, ReturnType<typeof stubTable>>;

function client(
  tableResults: Record<string, QueryResult[]>,
  rpcResults: Record<string, QueryResult> = {},
) {
  tables = new Map();
  from = vi.fn((table: string) => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created = stubTable(tableResults[table] ?? [{ data: [], error: null }]);
    tables.set(table, created);
    return created;
  });
  rpc = vi.fn((name: string) => Promise.resolve(rpcResults[name] ?? { data: [], error: null }));
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: userId },
    client: { from, rpc },
  });
}

function send(method: "POST", url: string, body: unknown, origin = "https://factory.example") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://factory.example");
});

describe("the recurring billing route", () => {
  it("bills the active workspace and never an organization the caller names", async () => {
    client(
      {},
      {
        crm_generate_due_invoices: {
          data: [
            {
              billing_run_id: "40000000-0000-4000-8000-0000000f0001",
              plans_considered: 4,
              invoices_created: 3,
              plans_already_billed: 1,
              total_cents: "120000",
            },
          ],
          error: null,
        },
      },
    );

    const response = await runBilling(
      send("POST", "https://factory.example/api/services/billing/recurring", {
        // A caller trying to bill somebody else's book. The route does not
        // read this, and the schema would refuse it anyway.
        organizationId: "10000000-0000-4000-8000-0000000f0009",
        note: "Month-end batch.",
      } as Record<string, unknown>),
    );
    // An unknown key is refused outright by the strict schema, which is the
    // narrower answer than silently ignoring it.
    expect(response.status).toBe(422);

    client(
      {},
      {
        crm_generate_due_invoices: {
          data: [
            {
              billing_run_id: "40000000-0000-4000-8000-0000000f0001",
              plans_considered: 4,
              invoices_created: 3,
              plans_already_billed: 1,
              total_cents: "120000",
            },
          ],
          error: null,
        },
      },
    );
    const ok = await runBilling(
      send("POST", "https://factory.example/api/services/billing/recurring", { note: "Month-end batch." }),
    );
    expect(ok.status).toBe(201);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_organization: organizationId });
  });

  it("reports what a re-run skipped instead of flattening it into a success", async () => {
    client(
      {},
      {
        crm_generate_due_invoices: {
          data: [
            {
              billing_run_id: "40000000-0000-4000-8000-0000000f0002",
              plans_considered: 6,
              invoices_created: 0,
              plans_already_billed: 6,
              total_cents: "0",
            },
          ],
          error: null,
        },
      },
    );
    const body = (await (
      await runBilling(send("POST", "https://factory.example/api/services/billing/recurring", {}))
    ).json()) as { run: { invoicesCreated: number; plansAlreadyBilled: number } };
    // Six plans due, none billed, because the periods were already covered.
    // A caller must be able to tell that from "there was nothing to do".
    expect(body.run.invoicesCreated).toBe(0);
    expect(body.run.plansAlreadyBilled).toBe(6);
  });

  it("turns the database's net-terms refusal into the caller's answer", async () => {
    client(
      {},
      {
        crm_generate_due_invoices: {
          data: null,
          error: { code: "23514", message: "net terms must be between 0 and 365 days" },
        },
      },
    );
    const response = await runBilling(
      send("POST", "https://factory.example/api/services/billing/recurring", { netDays: 0 }),
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_net_terms",
    );
  });

  it("keeps scheduled billing labelled Not Connected", async () => {
    client({
      crm_billing_runs: [
        {
          data: [
            {
              id: "40000000-0000-4000-8000-0000000f0001",
              through_on: "2026-08-01",
              plans_considered: 10,
              invoices_created: 8,
              plans_already_billed: 2,
              total_cents: "240000",
              note: null,
              ran_at: "2026-08-01T00:00:00.000Z",
            },
          ],
          error: null,
        },
      ],
    });
    const body = (await (await listRuns()).json()) as {
      counts: { invoicesCreated: number; billedCents: number; alreadyBilled: number };
      automatic: { available: boolean; label: string };
    };
    expect(body.counts.invoicesCreated).toBe(8);
    expect(body.counts.billedCents).toBe(240_000);
    expect(body.counts.alreadyBilled).toBe(2);
    // Nothing in this product runs on a schedule, and the page says so.
    expect(body.automatic).toEqual({ available: false, label: "Not Connected" });
  });
});

describe("the collections route", () => {
  const overdue = [
    {
      invoice_id: invoiceId,
      account_id: accountId,
      account_name: "Harborview Foods",
      number: "INV-OLD",
      balance_cents: "90000",
      due_on: "2026-02-01",
      days_overdue: 200,
      notices: 0,
      last_action: null,
      last_acted_at: null,
    },
    {
      invoice_id: "30000000-0000-4000-8000-0000000f0002",
      account_id: accountId,
      account_name: "Harborview Foods",
      number: "INV-NEW",
      balance_cents: "5000",
      due_on: "2026-08-20",
      days_overdue: 11,
      notices: 2,
      last_action: "reminder_call",
      last_acted_at: "2026-08-25T00:00:00.000Z",
    },
  ];

  it("counts the overdue invoices nobody has touched, and buckets by age", async () => {
    client({}, { crm_collections_worklist: { data: overdue, error: null } });
    const body = (await (
      await worklist(new Request("https://factory.example/api/services/collections"))
    ).json()) as {
      invoices: { bucket: string; untouched: boolean }[];
      counts: { untouched: number; over90: number; balanceCents: number };
      delivery: { available: boolean; label: string };
    };
    expect(body.invoices[0].bucket).toBe("90+");
    expect(body.invoices[0].untouched).toBe(true);
    expect(body.invoices[1].bucket).toBe("1-30");
    expect(body.invoices[1].untouched).toBe(false);
    expect(body.counts.untouched).toBe(1);
    expect(body.counts.over90).toBe(1);
    expect(body.counts.balanceCents).toBe(95_000);
    // No email or SMS provider is connected, so nothing claims delivery.
    expect(body.delivery).toEqual({ available: false, label: "Not Connected" });
  });

  it("bounds the age filter a caller asks for", async () => {
    client({}, { crm_collections_worklist: { data: [], error: null } });
    await worklist(new Request("https://factory.example/api/services/collections?minDays=abc"));
    expect(rpc).toHaveBeenCalledWith("crm_collections_worklist", { p_min_days: 1 });

    client({}, { crm_collections_worklist: { data: [], error: null } });
    await worklist(new Request("https://factory.example/api/services/collections?minDays=999999"));
    expect(rpc).toHaveBeenCalledWith("crm_collections_worklist", { p_min_days: 3650 });
  });

  it("turns a note filed against the wrong customer into a refusal, not a 500", async () => {
    client({
      crm_dunning_notices: [
        { data: null, error: { code: "23514", message: "that invoice is not on this account" } },
      ],
    });
    const response = await recordNotice(
      send("POST", "https://factory.example/api/services/collections", {
        invoiceId,
        accountId: "20000000-0000-4000-8000-0000000f0009",
        action: "final_notice",
        daysOverdue: 200,
        balanceCents: 90_000,
      }),
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "invoice_not_on_account",
    );
  });

  it("records the age at the moment of acting, as sent", async () => {
    client({
      crm_dunning_notices: [
        {
          data: {
            id: "50000000-0000-4000-8000-0000000f0001",
            invoice_id: invoiceId,
            account_id: accountId,
            action: "reminder_call",
            days_overdue: 200,
            balance_cents: "90000",
            outcome: "Left a message with the office.",
            acted_at: "2026-08-31T00:00:00.000Z",
          },
          error: null,
        },
      ],
    });
    const response = await recordNotice(
      send("POST", "https://factory.example/api/services/collections", {
        invoiceId,
        accountId,
        action: "reminder_call",
        daysOverdue: 200,
        balanceCents: 90_000,
        outcome: "Left a message with the office.",
      }),
    );
    expect(response.status).toBe(201);
    const inserted = (
      tables.get("crm_dunning_notices") as unknown as { insert: ReturnType<typeof vi.fn> }
    ).insert.mock.calls[0][0] as Record<string, unknown>;
    // Copied onto the record, so reading it back next year says how overdue
    // it was WHEN somebody acted rather than how overdue it is now.
    expect(inserted.days_overdue).toBe(200);
    expect(inserted.balance_cents).toBe(90_000);
    expect(inserted.organization_id).toBe(organizationId);
  });

  it("rejects an action nobody defined", async () => {
    client({ crm_dunning_notices: [{ data: null, error: null }] });
    const response = await recordNotice(
      send("POST", "https://factory.example/api/services/collections", {
        invoiceId,
        accountId,
        action: "sent_a_strongly_worded_letter",
        daysOverdue: 10,
        balanceCents: 100,
      }),
    );
    expect(response.status).toBe(422);
  });
});
