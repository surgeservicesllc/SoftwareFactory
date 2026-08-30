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

import { GET as listEstimates, POST as createEstimate } from "@/app/api/services/estimates/route";
import { PATCH as patchEstimate } from "@/app/api/services/estimates/[estimateId]/route";
import { GET as listInvoices, POST as createInvoice } from "@/app/api/services/invoices/route";
import { PATCH as patchInvoice } from "@/app/api/services/invoices/[invoiceId]/route";
import { POST as recordPayment } from "@/app/api/services/payments/route";
import { POST as recordRefund } from "@/app/api/services/refunds/route";
import { GET as listContracts, PATCH as patchContract } from "@/app/api/services/contracts/route";

/**
 * The billing boundary's own conduct. The database owns the money rules —
 * append-only payments, the refund cap, settlement by trigger — and the
 * behavior suite proves those against real SQL. This file pins what the
 * routes themselves promise: totals derived from lines rather than taken
 * from the caller, `paid` unreachable by assertion, a void that names its
 * reason, payments filed against the invoice's own account, and the
 * ledger's refusals surfaced as refusals rather than 500s.
 */

const organizationId = "10000000-0000-4000-8000-0000000b0001";
const userId = "00000000-0000-4000-8000-0000000b0001";
const accountId = "20000000-0000-4000-8000-0000000b0001";
const invoiceId = "30000000-0000-4000-8000-0000000b0001";
const estimateId = "40000000-0000-4000-8000-0000000b0001";
const paymentId = "50000000-0000-4000-8000-0000000b0001";
const contractId = "60000000-0000-4000-8000-0000000b0001";

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
let tables: Map<string, ReturnType<typeof stubTable>>;

function client(results: Record<string, QueryResult[]>) {
  tables = new Map();
  from = vi.fn((table: string) => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created = stubTable(results[table] ?? [{ data: null, error: null }]);
    tables.set(table, created);
    return created;
  });
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: userId },
    client: { from },
  });
}

function table(name: string) {
  return tables.get(name) as unknown as {
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function send(method: "POST" | "PATCH", url: string, body: unknown, origin = "https://factory.example") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

const estimateRow = {
  id: estimateId,
  account_id: accountId,
  property_id: null,
  opportunity_id: null,
  number: "EST-0001-01",
  status: "sent",
  subtotal_cents: 30_000,
  tax_cents: 2_400,
  total_cents: 32_400,
  valid_until: "2026-10-01",
  terms: "Net 30",
  notes: null,
  sent_at: "2026-08-01T10:00:00Z",
  decided_at: null,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
};

const invoiceRow = {
  id: invoiceId,
  account_id: accountId,
  contract_id: null,
  work_order_id: null,
  number: "INV-0001-01",
  status: "open",
  subtotal_cents: 30_000,
  tax_cents: 2_400,
  total_cents: 32_400,
  paid_cents: 0,
  issued_on: "2026-08-01",
  due_on: "2026-08-31",
  memo: null,
  voided_at: null,
  void_reason: null,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
};

const paymentRow = {
  id: paymentId,
  account_id: accountId,
  invoice_id: invoiceId,
  amount_cents: 32_400,
  method: "check",
  reference: "DEMO-PAY-0001",
  received_at: "2026-08-10T10:00:00Z",
  recorded_at: "2026-08-10T10:00:00Z",
  note: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the estimates boundary", () => {
  it("derives the money from the lines rather than the caller", async () => {
    client({
      crm_estimates: [{ data: estimateRow, error: null }],
      crm_estimate_lines: [{ data: [], error: null }],
    });
    const response = await createEstimate(
      send("POST", "https://factory.example/api/services/estimates", {
        accountId,
        number: "EST-0001-01",
        taxCents: 2_400,
        lines: [
          { description: "Monthly IPM service", quantity: 2, unitPriceCents: 12_000 },
          { description: "Bait station installation", quantity: 1, unitPriceCents: 6_000 },
        ],
      }),
    );
    expect(response.status).toBe(201);
    expect(table("crm_estimates").insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: organizationId,
        created_by: userId,
        status: "draft",
        subtotal_cents: 30_000,
        tax_cents: 2_400,
        total_cents: 32_400,
      }),
    );
    // Lines are numbered by their order, and each carries its own extension.
    expect(table("crm_estimate_lines").insert).toHaveBeenCalledWith([
      expect.objectContaining({ position: 1, amount_cents: 24_000 }),
      expect.objectContaining({ position: 2, amount_cents: 6_000 }),
    ]);
  });

  it("refuses a subtotal the caller tries to assert", async () => {
    client({ crm_estimates: [{ data: estimateRow, error: null }] });
    const response = await createEstimate(
      send("POST", "https://factory.example/api/services/estimates", {
        accountId,
        number: "EST-0001-02",
        subtotalCents: 1,
        lines: [{ description: "Service", quantity: 1, unitPriceCents: 100 }],
      }),
    );
    expect(response.status).toBe(422);
  });

  it("surfaces a duplicate estimate number as a conflict, never a merge", async () => {
    client({
      crm_estimates: [{ data: null, error: { code: "23505", message: "duplicate key" } }],
    });
    const response = await createEstimate(
      send("POST", "https://factory.example/api/services/estimates", {
        accountId,
        number: "EST-0001-01",
        lines: [{ description: "Service", quantity: 1, unitPriceCents: 100 }],
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("estimate_number_taken");
  });

  it("gives a decision its moment, and takes it back when the estimate reopens", async () => {
    client({
      crm_estimates: [
        { data: estimateRow, error: null },
        { data: { ...estimateRow, status: "accepted" }, error: null },
      ],
    });
    const accepted = await patchEstimate(
      send("PATCH", `https://factory.example/api/services/estimates/${estimateId}`, {
        status: "accepted",
      }),
      { params: Promise.resolve({ estimateId }) },
    );
    expect(accepted.status).toBe(200);
    expect(table("crm_estimates").update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "accepted", decided_at: expect.any(String) }),
    );

    client({
      crm_estimates: [
        { data: { ...estimateRow, status: "declined", decided_at: "2026-08-05T10:00:00Z" }, error: null },
        { data: { ...estimateRow, status: "draft" }, error: null },
      ],
    });
    await patchEstimate(
      send("PATCH", `https://factory.example/api/services/estimates/${estimateId}`, { status: "draft" }),
      { params: Promise.resolve({ estimateId }) },
    );
    expect(table("crm_estimates").update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft", decided_at: null }),
    );
  });

  it("lists estimates with their lines attached to the right estimate", async () => {
    client({
      crm_estimates: [{ data: [estimateRow], error: null }],
      crm_estimate_lines: [
        {
          data: [
            {
              id: "70000000-0000-4000-8000-0000000b0001",
              estimate_id: estimateId,
              position: 1,
              description: "Monthly IPM service",
              quantity: "2.00",
              unit_price_cents: 12_000,
              amount_cents: 24_000,
              created_at: "2026-08-01T10:00:00Z",
            },
          ],
          error: null,
        },
      ],
    });
    const response = await listEstimates();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.estimates[0].lines).toHaveLength(1);
    expect(body.estimates[0].lines[0]).toMatchObject({ quantity: 2, amountCents: 24_000 });
    expect(body.openValueCents).toBe(32_400);
  });
});

describe("the invoices boundary", () => {
  it("reports the balance and what is overdue from the ledger's own figures", async () => {
    client({
      crm_invoices: [
        {
          data: [
            { ...invoiceRow, paid_cents: 12_400, due_on: "2020-01-01" },
            { ...invoiceRow, id: "30000000-0000-4000-8000-0000000b0002", status: "paid", paid_cents: 32_400 },
          ],
          error: null,
        },
      ],
      crm_invoice_lines: [{ data: [], error: null }],
    });
    const response = await listInvoices();
    const body = await response.json();
    expect(body.invoices[0]).toMatchObject({ balanceCents: 20_000, overdue: true });
    expect(body.invoices[1]).toMatchObject({ balanceCents: 0, overdue: false });
    expect(body.outstandingCents).toBe(20_000);
    expect(body.overdueCents).toBe(20_000);
    expect(body.collectedCents).toBe(44_800);
  });

  it("will not let a caller assert that an invoice is paid", async () => {
    client({ crm_invoices: [{ data: invoiceRow, error: null }] });
    const response = await patchInvoice(
      send("PATCH", `https://factory.example/api/services/invoices/${invoiceId}`, { status: "paid" }),
      { params: Promise.resolve({ invoiceId }) },
    );
    expect(response.status).toBe(422);
    // Refused at the boundary: the invoice was never read, let alone updated.
    expect(tables.has("crm_invoices")).toBe(false);
  });

  it("requires a void to name its reason, and records the moment with it", async () => {
    client({ crm_invoices: [{ data: invoiceRow, error: null }] });
    const bare = await patchInvoice(
      send("PATCH", `https://factory.example/api/services/invoices/${invoiceId}`, { status: "void" }),
      { params: Promise.resolve({ invoiceId }) },
    );
    expect(bare.status).toBe(422);

    client({
      crm_invoices: [
        { data: { ...invoiceRow, status: "void", void_reason: "Duplicate of INV-0001-01." }, error: null },
      ],
    });
    const voided = await patchInvoice(
      send("PATCH", `https://factory.example/api/services/invoices/${invoiceId}`, {
        status: "void",
        voidReason: "Duplicate of INV-0001-01.",
      }),
      { params: Promise.resolve({ invoiceId }) },
    );
    expect(voided.status).toBe(200);
    expect(table("crm_invoices").update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "void",
        void_reason: "Duplicate of INV-0001-01.",
        voided_at: expect.any(String),
      }),
    );
  });

  it("raises an invoice with the money its lines add up to", async () => {
    client({
      crm_invoices: [{ data: invoiceRow, error: null }],
      crm_invoice_lines: [{ data: [], error: null }],
    });
    const response = await createInvoice(
      send("POST", "https://factory.example/api/services/invoices", {
        accountId,
        number: "INV-0001-01",
        taxCents: 2_400,
        issuedOn: "2026-08-01",
        dueOn: "2026-08-31",
        lines: [{ description: "Monthly IPM service", quantity: 2.5, unitPriceCents: 12_000 }],
      }),
    );
    expect(response.status).toBe(201);
    expect(table("crm_invoices").insert).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal_cents: 30_000, total_cents: 32_400, status: "open" }),
    );
  });

  it("refuses an invoice that would fall due before it is issued", async () => {
    client({ crm_invoices: [{ data: invoiceRow, error: null }] });
    const response = await createInvoice(
      send("POST", "https://factory.example/api/services/invoices", {
        accountId,
        number: "INV-0001-02",
        issuedOn: "2026-08-31",
        dueOn: "2026-08-01",
        lines: [{ description: "Service", quantity: 1, unitPriceCents: 100 }],
      }),
    );
    expect(response.status).toBe(422);
  });
});

describe("the payments boundary", () => {
  it("files a payment against the invoice's own account, not one the caller names", async () => {
    client({
      crm_invoices: [{ data: invoiceRow, error: null }, { data: { ...invoiceRow, status: "paid", paid_cents: 32_400 }, error: null }],
      crm_payments: [{ data: paymentRow, error: null }],
    });
    const response = await recordPayment(
      send("POST", "https://factory.example/api/services/payments", {
        invoiceId,
        amountCents: 32_400,
        method: "check",
      }),
    );
    expect(response.status).toBe(201);
    expect(table("crm_payments").insert).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: accountId, invoice_id: invoiceId, created_by: userId }),
    );
    // The ledger's verdict is read back rather than assumed.
    const body = await response.json();
    expect(body.invoice).toMatchObject({ status: "paid", balanceCents: 0 });
  });

  it("refuses payment against a voided invoice", async () => {
    client({
      crm_invoices: [
        { data: { ...invoiceRow, status: "void", void_reason: "Raised in error." }, error: null },
      ],
    });
    const response = await recordPayment(
      send("POST", "https://factory.example/api/services/payments", {
        invoiceId,
        amountCents: 100,
        method: "card",
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("invoice_not_payable");
    expect(tables.has("crm_payments")).toBe(false);
  });

  it("refuses a cross-origin post before touching anything", async () => {
    client({ crm_invoices: [{ data: invoiceRow, error: null }] });
    const response = await recordPayment(
      send(
        "POST",
        "https://factory.example/api/services/payments",
        { invoiceId, amountCents: 100, method: "card" },
        "https://evil.example",
      ),
    );
    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("the refunds boundary", () => {
  it("surfaces the ledger's cap as a refusal, not a server error", async () => {
    client({
      crm_payments: [{ data: paymentRow, error: null }],
      crm_refunds: [
        { data: null, error: { code: "23514", message: "refunds would exceed the payment" } },
      ],
    });
    const response = await recordRefund(
      send("POST", "https://factory.example/api/services/refunds", {
        paymentId,
        amountCents: 99_999,
        reason: "Partial credit for a missed visit.",
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("refund_exceeds_payment");
  });

  it("records a credit and reports what it did to the invoice", async () => {
    client({
      crm_payments: [{ data: paymentRow, error: null }],
      crm_refunds: [
        {
          data: {
            id: "80000000-0000-4000-8000-0000000b0001",
            payment_id: paymentId,
            amount_cents: 5_000,
            reason: "Partial credit for a missed visit.",
            refunded_at: "2026-08-12T10:00:00Z",
            recorded_at: "2026-08-12T10:00:00Z",
          },
          error: null,
        },
      ],
      crm_invoices: [{ data: { ...invoiceRow, paid_cents: 27_400 }, error: null }],
    });
    const response = await recordRefund(
      send("POST", "https://factory.example/api/services/refunds", {
        paymentId,
        amountCents: 5_000,
        reason: "Partial credit for a missed visit.",
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.refund).toMatchObject({ amountCents: 5_000 });
    // Refunding below the total reopens the invoice's balance.
    expect(body.invoice).toMatchObject({ balanceCents: 5_000 });
  });
});

describe("the contracts boundary", () => {
  const contractRow = {
    id: contractId,
    account_id: accountId,
    estimate_id: estimateId,
    plan_id: null,
    number: "CON-0001-01",
    status: "active",
    value_cents: 32_400,
    starts_on: "2026-01-01",
    ends_on: "2026-12-31",
    auto_renew: true,
    terms: "Annual agreement.",
    notes: null,
    signed_at: "2026-01-01T10:00:00Z",
    signed_by_name: "Alex Reyes",
    ended_at: null,
    created_at: "2026-01-01T10:00:00Z",
    updated_at: "2026-01-01T10:00:00Z",
  };

  it("totals only the terms that are still running", async () => {
    client({
      crm_contracts: [
        {
          data: [
            contractRow,
            { ...contractRow, id: "60000000-0000-4000-8000-0000000b0002", status: "ended", ended_at: "2026-06-01T10:00:00Z" },
          ],
          error: null,
        },
      ],
    });
    const response = await listContracts();
    const body = await response.json();
    expect(body.contracts).toHaveLength(2);
    expect(body.activeValueCents).toBe(32_400);
  });

  it("records when a term closed, and takes it back if the term reopens", async () => {
    client({ crm_contracts: [{ data: { ...contractRow, status: "cancelled" }, error: null }] });
    await patchContract(
      send("PATCH", "https://factory.example/api/services/contracts", {
        contractId,
        status: "cancelled",
      }),
    );
    expect(table("crm_contracts").update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled", ended_at: expect.any(String) }),
    );

    client({ crm_contracts: [{ data: contractRow, error: null }] });
    await patchContract(
      send("PATCH", "https://factory.example/api/services/contracts", { contractId, status: "active" }),
    );
    expect(table("crm_contracts").update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active", ended_at: null }),
    );
  });
});
