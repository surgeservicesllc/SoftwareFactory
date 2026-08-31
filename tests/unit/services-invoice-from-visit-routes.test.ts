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

import { POST as buildFromVisit } from "@/app/api/services/invoices/[invoiceId]/from-visit/route";

/**
 * The boundary for building an invoice from a visit (ADR-212).
 *
 * The behavior suite proves the SQL refuses the four things it must. This
 * file pins that the ROUTE carries each refusal back as its own status and
 * the database's own words: an operator told "that visit is already billed
 * on INV-1042" can act, and one told "the invoice could not be built"
 * cannot.
 */

const organizationId = "10000000-0000-4000-8000-0000000e1001";
const userId = "00000000-0000-4000-8000-0000000e1001";
const invoiceId = "a0000000-0000-4000-8000-0000000e1001";
const workOrderId = "b0000000-0000-4000-8000-0000000e1001";

type QueryResult = { data: unknown; error: unknown };

function stubTable(results: QueryResult[]) {
  let call = 0;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "eq", "order", "limit"]) builder[method] = vi.fn(chain);
  builder.single = vi.fn(() => Promise.resolve(results[Math.min(call++, results.length - 1)]));
  builder.maybeSingle = vi.fn(() => Promise.resolve(results[Math.min(call++, results.length - 1)]));
  builder.then = (onFulfilled: (value: QueryResult) => unknown) =>
    Promise.resolve(results[Math.min(call++, results.length - 1)]).then(onFulfilled);
  return builder;
}

let rpc: ReturnType<typeof vi.fn>;
let from: ReturnType<typeof vi.fn>;

function client(rpcResult: QueryResult, tables: Record<string, QueryResult[]> = {}) {
  rpc = vi.fn(() => Promise.resolve(rpcResult));
  const built = new Map<string, ReturnType<typeof stubTable>>();
  from = vi.fn((table: string) => {
    const existing = built.get(table);
    if (existing) return existing;
    const created = stubTable(tables[table] ?? [{ data: null, error: null }]);
    built.set(table, created);
    return created;
  });
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: userId },
    client: { rpc, from },
  });
}

function post(body: unknown) {
  return new Request(`https://factory.example/api/services/invoices/${invoiceId}/from-visit`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://factory.example" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ invoiceId }) };

const invoiceRow = {
  id: invoiceId,
  account_id: "c0000000-0000-4000-8000-0000000e1001",
  contract_id: null,
  work_order_id: workOrderId,
  number: "INV-1042",
  status: "draft",
  subtotal_cents: 154_000,
  tax_cents: 0,
  total_cents: 154_000,
  paid_cents: 0,
  issued_on: null,
  due_on: null,
  memo: null,
  voided_at: null,
  void_reason: null,
  created_at: "2026-08-31T10:00:00Z",
  updated_at: "2026-08-31T10:00:00Z",
};

const lineRows = [
  {
    id: "d0000000-0000-4000-8000-0000000e1001",
    invoice_id: invoiceId,
    position: 1,
    description: "Quarterly IPM — 12 Jan 2026",
    quantity: "1.00",
    unit_price_cents: 154_000,
    amount_cents: 154_000,
    source: "work_order",
    created_at: "2026-08-31T10:00:00Z",
  },
  {
    id: "d0000000-0000-4000-8000-0000000e1002",
    invoice_id: invoiceId,
    position: 2,
    description: "Termidor SC — 100 fl_oz for German cockroach (EPA 90000-123)",
    quantity: "1.00",
    unit_price_cents: 0,
    amount_cents: 0,
    source: "application",
    created_at: "2026-08-31T10:00:00Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("building an invoice from a visit", () => {
  it("returns the invoice the database recomputed and the lines it wrote", async () => {
    client({ data: [], error: null }, {
      crm_invoices: [{ data: invoiceRow, error: null }],
      crm_invoice_lines: [{ data: lineRows, error: null }],
    });

    const response = await buildFromVisit(post({ workOrderId }), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("crm_invoice_lines_from_visit", {
      p_invoice: invoiceId,
      p_work_order: workOrderId,
    });
    expect(body.invoice.totalCents).toBe(154_000);
    expect(body.lines.map((line: { source: string }) => line.source))
      .toEqual(["work_order", "application"]);
  });

  it.each([
    ["work order 1 is dispatched — a visit is billed after it happens, not before",
      409, "visit_not_completed"],
    ["invoice 1 was already built from a visit; void it and raise another rather than rebuilding it",
      409, "invoice_already_built"],
    ["that visit is already billed on invoice INV-1042", 409, "visit_already_billed"],
    ["invoice 1 is open and can no longer be rebuilt from a visit", 409, "invoice_not_draft"],
    ["that visit belongs to a different account than this invoice", 409, "account_mismatch"],
    ["no such work order in this workspace", 404, "work_order_not_found"],
    ["no such invoice in this workspace", 404, "invoice_not_found"],
  ])("carries back %s as its own status", async (message, status, code) => {
    client({ data: null, error: { message } });

    const response = await buildFromVisit(post({ workOrderId }), params);
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body.error.code).toBe(code);
    // The database's own words reach the operator, not a generic failure.
    expect(body.error.message).toBe(message);
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses a body with no visit before touching the database", async () => {
    client({ data: [], error: null });

    const response = await buildFromVisit(post({}), params);

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
});
