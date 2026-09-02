import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomerPortalPanel } from "@/components/customer-portal/panel";

/**
 * The customer's own side: a completed visit can be rated once from the
 * Visits tab and the rating then shows in its place; the Messages tab
 * reads the thread, marks staff replies seen on opening, and sends.
 */

const visitId = "80000000-0000-4000-8000-0000000c0001";

const payloads: Record<string, unknown> = {
  "/api/customer-portal": { role: "viewer", summary: { accountName: "Harborview Foods", accountStatus: "customer", openInvoices: 0, balanceCents: 0, nextVisitOn: null, openRequests: 0 } },
  "/api/customer-portal/invoices": { invoices: [] },
  "/api/customer-portal/visits": { visits: [
    { id: visitId, serviceType: "General pest", status: "completed", scheduledStart: "2026-04-01T09:00:00Z", completedAt: "2026-04-01T10:00:00Z", propertyLabel: "Plant", completionNotes: "Stations serviced." },
    { id: "80000000-0000-4000-8000-0000000c0002", serviceType: "Rodent", status: "scheduled", scheduledStart: "2026-04-20T09:00:00Z", completedAt: null, propertyLabel: "Plant", completionNotes: null },
  ] },
  "/api/customer-portal/documents": { documents: [] },
  "/api/customer-portal/requests": { requests: [] },
  "/api/customer-portal/sites": { sites: [] },
  "/api/customer-portal/stations": { stations: [], trend: [] },
  "/api/customer-portal/conditions": { conditions: [] },
  "/api/customer-portal/compliance": { products: [], inspections: [] },
  "/api/customer-portal/wdo": { reports: [] },
  "/api/customer-portal/filed-documents": { documents: [] },
  "/api/customer-portal/surveys": { surveys: [] },
  "/api/customer-portal/messages": { messages: [
    { id: "m1", requestId: null, authorKind: "customer", body: "The gate code changed.", sentAt: "2026-04-02T09:00:00Z", readAt: "2026-04-02T10:00:00Z" },
    { id: "m2", requestId: null, authorKind: "staff", body: "Noted, thank you.", sentAt: "2026-04-02T11:00:00Z", readAt: null },
  ], counts: { total: 2, unreadFromStaff: 1 } },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function serve() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let rated = false;
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (init?.method === "POST" && url === "/api/customer-portal/surveys") {
      rated = true;
      return Promise.resolve(json({ surveyId: "s1" }, 201));
    }
    if (init?.method === "POST") return Promise.resolve(json({ messageId: "m3" }, 201));
    if (init?.method === "PATCH") return Promise.resolve(json({ marked: 1 }));
    if (url === "/api/customer-portal/surveys" && rated) {
      return Promise.resolve(json({ surveys: [{ workOrderId: visitId, score: 4, comment: "Thorough.", submittedAt: "2026-04-01T18:00:00Z" }] }));
    }
    return Promise.resolve(json(payloads[url.split("?")[0]] ?? {}));
  }));
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the customer's own side", () => {
  it("rates a completed visit once, from the visits tab, and then shows the rating in its place", async () => {
    const calls = serve();
    const user = userEvent.setup();
    render(<CustomerPortalPanel />);
    await user.click(await screen.findByRole("tab", { name: /Visits/ }));
    const table = await screen.findByTestId("customer-portal-visits-table");
    expect(within(table).getAllByRole("button", { name: /Rate the/ })).toHaveLength(1);
    await user.click(within(table).getByRole("button", { name: "Rate the General pest visit" }));
    await user.click(within(table).getByRole("radio", { name: "4 of 5" }));
    await user.type(within(table).getByLabelText("What should we know?"), "Thorough.");
    await user.click(within(table).getByRole("button", { name: "Send rating" }));
    await waitFor(() => {
      const post = calls.find((call) => call.init?.method === "POST" && call.url === "/api/customer-portal/surveys");
      expect(post).toBeDefined();
      expect(JSON.parse(String(post!.init!.body))).toEqual({ workOrderId: visitId, score: 4, comment: "Thorough." });
    });
    await waitFor(() => expect(screen.getByTestId(`customer-portal-rating-${visitId}`)).toHaveTextContent("4/5 · “Thorough.”"));
  });

  it("opens the thread, marks staff replies seen, and sends a message", async () => {
    const calls = serve();
    const user = userEvent.setup();
    render(<CustomerPortalPanel />);
    const tab = await screen.findByRole("tab", { name: /Messages/ });
    expect(tab).toHaveTextContent("1");
    await user.click(tab);
    const thread = await screen.findByTestId("customer-portal-messages");
    expect(within(thread).getByText("Noted, thank you.")).toBeInTheDocument();
    await waitFor(() => expect(calls.some((call) => call.init?.method === "PATCH" && call.url === "/api/customer-portal/messages")).toBe(true));
    await user.type(screen.getByLabelText("Write a message"), "Thanks!");
    await user.click(screen.getByTestId("customer-portal-send-message"));
    await waitFor(() => {
      const post = calls.find((call) => call.init?.method === "POST" && call.url === "/api/customer-portal/messages");
      expect(post).toBeDefined();
      expect(JSON.parse(String(post!.init!.body))).toEqual({ body: "Thanks!" });
    });
  });
});
