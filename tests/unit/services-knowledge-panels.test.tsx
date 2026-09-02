import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServicesKnowledgePanel } from "@/components/services/knowledge-panel";
import { LotLabels } from "@/components/services/lot-labels";
import { CustomerPortalPanel } from "@/components/customer-portal/panel";

/**
 * What people look up, as a person works it: the Knowledge page lists
 * what is written with the rank printed beside a search hit and saves a
 * new article with the slug it derived; the portal's Help tab searches
 * and opens an article, and a booked visit offers its calendar file; a
 * lot prints a label, or the reason it cannot.
 */

const hit = { id: "a1", slug: "ant-treatment-what-to-expect", title: "Ant treatment: what to expect", category: "Before your visit", audience: "customer", publishedAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", rank: 4, titleHits: 1, bodyHits: 1, excerpt: "We place bait where the ants trail." };
const draftHit = { ...hit, id: "a2", slug: "termite-pretreatment", title: "Termite pretreatment", audience: "customer", publishedAt: null, rank: 0, titleHits: 0, bodyHits: 0, excerpt: "Draft." };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Knowledge page", () => {
  it("lists what is written, prints the rank beside a search hit, and saves a new article with the slug it derived", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { title: string };
        return Promise.resolve(json({ article: { id: "a3", slug: "reading-your-invoice", title: body.title, body: "b", category: null, audience: "customer", publishedAt: null, createdBy: "u", updatedBy: "u", createdAt: "x", updatedAt: "x" } }, 201));
      }
      if (url.startsWith("/api/services/knowledge?q=")) {
        return Promise.resolve(json({ query: "ants", audience: null, publishedOnly: false, hits: [hit], counts: { total: 2, published: 1, customer: 1 } }));
      }
      return Promise.resolve(json({ query: "", audience: null, publishedOnly: false, hits: [hit, draftHit], counts: { total: 2, published: 1, customer: 1 } }));
    }));
    const user = userEvent.setup();
    render(<ServicesKnowledgePanel />);

    const hits = await screen.findByTestId("services-knowledge-hits");
    expect(within(hits).getAllByRole("listitem")).toHaveLength(2);
    expect(within(hits).getByText("draft")).toBeInTheDocument();
    expect(screen.queryByTestId("services-knowledge-rank-ant-treatment-what-to-expect")).toBeNull();
    expect(screen.getByTestId("services-knowledge-counts")).toHaveTextContent("2");

    await user.type(screen.getByLabelText("Search the knowledge base"), "ants");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByTestId("services-knowledge-rank-ant-treatment-what-to-expect")).toHaveTextContent("rank 4: 1 in the title ×3 + 1 in the body");
    expect(calls.some((call) => call.url === "/api/services/knowledge?q=ants")).toBe(true);

    await user.click(screen.getByTestId("services-knowledge-new"));
    await user.type(screen.getByLabelText("Title"), "Reading your invoice");
    expect(screen.getByLabelText("Slug")).toHaveValue("reading-your-invoice");
    await user.type(screen.getByLabelText("Body"), "An invoice lists each visit.");
    await user.selectOptions(screen.getByLabelText("Article audience"), "customer");
    await user.click(screen.getByTestId("services-knowledge-save"));
    await waitFor(() => expect(screen.getByTestId("services-knowledge-message")).toHaveTextContent("Saved “Reading your invoice”."));
    const post = calls.find((call) => call.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ title: "Reading your invoice", body: "An invoice lists each visit.", slug: "reading-your-invoice", category: null, audience: "customer", published: false });
  });
});

describe("the portal's Help tab and calendar file", () => {
  const visitId = "80000000-0000-4000-8000-0000000d0001";
  const payloads: Record<string, unknown> = {
    "/api/customer-portal": { role: "viewer", summary: { accountName: "Harborview Foods", accountStatus: "customer", openInvoices: 0, balanceCents: 0, nextVisitOn: null, openRequests: 0 } },
    "/api/customer-portal/invoices": { invoices: [] },
    "/api/customer-portal/visits": { visits: [
      { id: visitId, serviceType: "General pest", status: "scheduled", scheduledStart: "2026-10-05T14:00:00Z", completedAt: null, propertyLabel: "Plant", completionNotes: null },
      { id: "80000000-0000-4000-8000-0000000d0002", serviceType: "Rodent", status: "completed", scheduledStart: "2026-04-01T09:00:00Z", completedAt: "2026-04-01T10:00:00Z", propertyLabel: "Plant", completionNotes: "Done." },
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
    "/api/customer-portal/messages": { messages: [], counts: { total: 0, unreadFromStaff: 0 } },
    "/api/customer-portal/articles": { query: "", articles: [
      { id: "a1", slug: "ant-treatment-what-to-expect", title: "Ant treatment: what to expect", category: "Before your visit", body: "We place bait where the ants trail.\nIt can take ten days.", publishedAt: "2026-09-01T00:00:00Z", rank: 0, excerpt: "We place bait where the ants trail." },
      { id: "a2", slug: "reading-your-invoice", title: "Reading your invoice", category: "Billing", body: "Each visit is a line.", publishedAt: "2026-09-01T00:00:00Z", rank: 0, excerpt: "Each visit is a line." },
    ], counts: { total: 2 } },
  };

  it("searches and opens an article, and offers the calendar file only on a booked visit", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === "/api/customer-portal/articles?q=invoice") {
        return Promise.resolve(json({ query: "invoice", articles: [{ id: "a2", slug: "reading-your-invoice", title: "Reading your invoice", category: "Billing", body: "Each visit is a line.", publishedAt: "2026-09-01T00:00:00Z", rank: 3, excerpt: "Each visit is a line." }], counts: { total: 1 } }));
      }
      return Promise.resolve(json(payloads[url.split("?")[0]] ?? {}));
    }));
    const user = userEvent.setup();
    render(<CustomerPortalPanel />);

    const helpTab = await screen.findByRole("tab", { name: /Help/ });
    await waitFor(() => expect(helpTab).toHaveTextContent("2"));
    await user.click(helpTab);
    const list = await screen.findByTestId("customer-portal-help");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    await user.click(screen.getByTestId("customer-portal-article-ant-treatment-what-to-expect"));
    expect(screen.getByTestId("customer-portal-article-body-ant-treatment-what-to-expect")).toHaveTextContent("It can take ten days.");

    await user.type(screen.getByLabelText("Search help"), "invoice");
    await user.click(screen.getByTestId("customer-portal-help-search"));
    await waitFor(() => expect(within(screen.getByTestId("customer-portal-help")).getAllByRole("listitem")).toHaveLength(1));
    expect(calls).toContain("/api/customer-portal/articles?q=invoice");

    await user.click(screen.getByRole("tab", { name: /Visits/ }));
    const link = await screen.findByTestId(`customer-portal-calendar-${visitId}`);
    expect(link).toHaveAttribute("href", `/api/customer-portal/visits/${visitId}/calendar`);
    expect(link).toHaveAttribute("download");
    expect(screen.queryByTestId("customer-portal-calendar-80000000-0000-4000-8000-0000000d0002")).toBeNull();
  });
});

describe("lot labels", () => {
  const lot = (id: string, lotNumber: string, quantityRemaining: number) => ({
    id, productId: "p1", lotNumber, unit: "oz", quantityReceived: 60, quantityRemaining, receivedOn: "2026-05-01", expiresOn: "2027-11-01", createdAt: "x", updatedAt: "x",
  });

  it("prints a Code 39 symbol for a lot in stock, text with the reason for one it cannot encode, and nothing for a spent lot", async () => {
    const user = userEvent.setup();
    render(<LotLabels lots={[lot("l1", "DEMO-LOT-2026-04", 55.5), lot("l2", "lot-x", 3), lot("l3", "SPENT-01", 0)]} productName={() => "Demo Gel Bait"} />);
    await user.click(screen.getByRole("button", { name: "Lot labels (2)" }));
    const labels = screen.getAllByTestId("lot-label");
    expect(labels).toHaveLength(2);
    expect(within(labels[0]).getByTestId("lot-label-symbol")).toBeInTheDocument();
    expect(within(labels[0]).getByText("Demo Gel Bait")).toBeInTheDocument();
    expect(within(labels[0]).getByText(/55.5 oz left · expires 2027-11-01/)).toBeInTheDocument();
    expect(within(labels[1]).queryByTestId("lot-label-symbol")).toBeNull();
    expect(within(labels[1]).getByTestId("lot-label-refusal").textContent).toMatch(/lower-case|cannot|Code 39/i);
    expect(screen.getByText(/1 of these 2 lots carry a number Code 39 cannot encode/)).toBeInTheDocument();
  });

  it("renders nothing when every lot is spent", () => {
    const { container } = render(<LotLabels lots={[lot("l3", "SPENT-01", 0)]} productName={() => null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
