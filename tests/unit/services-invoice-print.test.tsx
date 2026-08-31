import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InvoicePrintView } from "@/components/services/invoice-print";

/**
 * The printed invoice carries the ledger, not a copy of it.
 *
 * A draft or void invoice must announce itself so it cannot circulate as
 * a bill, and the money block must show the derived balance — paid net
 * of refunds, never a stored figure.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

const invoice: Record<string, unknown> = {
  id: "11111111-1111-4111-8111-111111111111",
  accountId: "22222222-2222-4222-8222-222222222222",
  number: "INV-2026-0007",
  status: "open",
  subtotalCents: 45_000,
  taxCents: 3_600,
  totalCents: 48_600,
  paidCents: 20_000,
  balanceCents: 28_600,
  issuedOn: "2026-08-05",
  dueOn: "2026-09-04",
  memo: null,
  voidedAt: null,
  voidReason: null,
  lines: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      position: 1,
      description: "Quarterly IPM service",
      quantity: 1,
      unitPriceCents: 45_000,
      amountCents: 45_000,
    },
  ],
};

function mockFetch(overrides: Record<string, unknown> = {}) {
  vi.spyOn(global, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/api/services/accounts")) {
      return Promise.resolve(
        jsonResponse({ accounts: [{ id: invoice.accountId, name: "Harborview Foods" }] }),
      );
    }
    return Promise.resolve(jsonResponse({ invoices: [{ ...invoice, ...overrides }] }));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the printable invoice", () => {
  it("prints the ledger's arithmetic and the account it bills", async () => {
    mockFetch();
    render(<InvoicePrintView invoiceId={invoice.id as string} />);
    expect(await screen.findByText("Invoice INV-2026-0007")).toBeInTheDocument();
    expect(screen.getByText("Billed to: Harborview Foods")).toBeInTheDocument();
    // 48,600 CENTS — the print shows dollars.
    expect(screen.getByText("$486.00")).toBeInTheDocument();
    expect(screen.getByText("$286.00")).toBeInTheDocument();
    expect(screen.getByText(/net of refunds/)).toBeInTheDocument();
    expect(screen.queryByText(/Draft — not an issued invoice/)).not.toBeInTheDocument();
  });

  it("banners a draft and a void so neither circulates as a bill", async () => {
    mockFetch({ status: "draft", issuedOn: null });
    render(<InvoicePrintView invoiceId={invoice.id as string} />);
    expect(await screen.findByText(/Draft — not an issued invoice/)).toBeInTheDocument();

    vi.restoreAllMocks();
    mockFetch({ status: "void", voidedAt: "2026-08-10T00:00:00Z", voidReason: "Duplicate billing" });
    render(<InvoicePrintView invoiceId={invoice.id as string} />);
    expect(await screen.findByText(/Void — Duplicate billing/)).toBeInTheDocument();
  });
});
