import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServicesBillingPanel } from "@/components/services/billing-panel";

/**
 * The download that makes the accounting export a capability rather than a
 * module (ADR-220).
 *
 * The competitor row moved from GAP to PARTIAL on the strength of a person
 * being able to GET THE FILE. A journal builder nobody can reach would not
 * have earned that, so this checks the control exists, points at the real
 * route, and says plainly that nothing is being synced anywhere.
 */

let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function serve() {
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith("/api/services/invoices")) return Promise.resolve(json({ invoices: [] }));
    if (url.startsWith("/api/services/estimates")) return Promise.resolve(json({ estimates: [] }));
    if (url.startsWith("/api/services/contracts")) return Promise.resolve(json({ contracts: [] }));
    if (url.startsWith("/api/services/payments")) return Promise.resolve(json({ payments: [] }));
    if (url.startsWith("/api/services/refunds")) return Promise.resolve(json({ refunds: [] }));
    if (url.startsWith("/api/services/accounts")) return Promise.resolve(json({ accounts: [] }));
    if (url.startsWith("/api/services/work-orders")) return Promise.resolve(json({ workOrders: [] }));
    return Promise.resolve(json({}));
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the accounting export control", () => {
  it("offers the journal on the ledger tab, pointed at the real route", async () => {
    serve();
    render(<ServicesBillingPanel />);

    const ledger = await screen.findByRole("tab", { name: /payments & credits/i });
    await userEvent.click(ledger);

    const link = await screen.findByTestId("services-accounting-export");
    expect(link).toHaveAttribute("href", "/api/services/accounting-export?format=csv");
    expect(link).toHaveAttribute("download", "general-journal.csv");
  });

  it("says it is a file to import, not a sync to an accounting package", async () => {
    serve();
    render(<ServicesBillingPanel />);

    await userEvent.click(await screen.findByRole("tab", { name: /payments & credits/i }));

    // The row this earns is PARTIAL, not HAVE, and the copy has to carry
    // that distinction where a person reads it rather than only in an ADR.
    expect(
      await screen.findByText(/nothing is sent to an accounting package from here/i),
    ).toBeInTheDocument();
  });

  it("does not fetch the export until somebody asks for it", async () => {
    serve();
    render(<ServicesBillingPanel />);
    await screen.findByRole("tab", { name: /payments & credits/i });

    // It is a link, not a load: rendering the panel must not build a journal
    // over every invoice, payment and refund in the workspace.
    const called = fetchMock.mock.calls.map(([url]) => String(url));
    expect(called.some((url) => url.includes("accounting-export"))).toBe(false);
  });
});
