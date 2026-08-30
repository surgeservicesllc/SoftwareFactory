import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServicesCustomersPanel } from "@/components/services/customers-panel";
import { ServicesOverviewPanel } from "@/components/services/overview-panel";

/**
 * The CRM pages as a person meets them: live rows render as a table, an
 * empty workspace names its next step instead of dressing itself in zeros,
 * creation posts the real body, and a refusal is shown in the server's
 * words — never paraphrased into a success.
 */

const account = {
  id: "20000000-0000-4000-8000-0000000c0001",
  name: "Harborview Foods",
  kind: "commercial",
  status: "lead",
  email: null,
  phone: null,
  source: "referral",
  billingAddress: null,
  notes: null,
  createdAt: "2026-08-30T10:00:00Z",
  updatedAt: "2026-08-30T10:00:00Z",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the customers panel", () => {
  it("renders the live book of business", async () => {
    fetchMock.mockResolvedValue(json({
      accounts: [account],
      counts: { byStatus: { lead: 1 }, byKind: { commercial: 1 }, total: 1 },
    }));
    render(<ServicesCustomersPanel />);

    const table = await screen.findByTestId("services-accounts-table");
    expect(within(table).getByText("Harborview Foods")).toBeInTheDocument();
    expect(within(table).getByText("referral")).toBeInTheDocument();
  });

  it("an empty workspace names its next step", async () => {
    fetchMock.mockResolvedValue(json({
      accounts: [],
      counts: { byStatus: {}, byKind: {}, total: 0 },
    }));
    render(<ServicesCustomersPanel />);

    const empty = await screen.findByTestId("services-empty");
    expect(empty.textContent).toContain("record your first lead");
  });

  it("creates through the real route and shows a refusal in the server's words", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(json(
          { error: { message: "The account could not be recorded." } },
          422,
        ));
      }
      return Promise.resolve(json({
        accounts: [],
        counts: { byStatus: {}, byKind: {}, total: 0 },
      }));
    });
    const user = userEvent.setup();
    render(<ServicesCustomersPanel />);
    await screen.findByTestId("services-empty");

    await user.click(screen.getByRole("button", { name: "New account" }));
    await user.type(screen.getByPlaceholderText("Person or company"), "Harborview Foods");
    await user.click(screen.getByRole("button", { name: "Record account" }));

    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(call).toBeDefined();
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({
      name: "Harborview Foods",
      kind: "residential",
    });
    expect(await screen.findByText("The account could not be recorded.")).toBeInTheDocument();
  });

  it("surfaces likely duplicates and records anyway only on the deliberate second step", async () => {
    const posts: unknown[] = [];
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(init.body as string) as { allowDuplicate?: boolean };
        posts.push(body);
        if (body.allowDuplicate !== true) {
          return Promise.resolve(json(
            {
              error: {
                code: "possible_duplicate",
                message: "An account with the same name, email or phone already exists. Review the matches, or record it anyway.",
              },
              duplicates: [account],
            },
            409,
          ));
        }
        return Promise.resolve(json({ account: { id: account.id, name: "Harborview Foods" } }, 201));
      }
      return Promise.resolve(json({ accounts: [], counts: { byStatus: {}, byKind: {}, total: 0 } }));
    });
    const user = userEvent.setup();
    render(<ServicesCustomersPanel />);
    await screen.findByTestId("services-empty");

    await user.click(screen.getByRole("button", { name: "New account" }));
    await user.type(screen.getByPlaceholderText("Person or company"), "Harborview Foods");
    await user.click(screen.getByRole("button", { name: "Record account" }));

    // The matches are shown; nothing was merged or created.
    const matches = await screen.findByTestId("services-duplicates");
    expect(within(matches).getByText("Harborview Foods")).toBeInTheDocument();
    expect(posts).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Record anyway" }));
    expect(await screen.findByText("Harborview Foods is recorded as a lead.")).toBeInTheDocument();
    expect(posts[1]).toMatchObject({ name: "Harborview Foods", allowDuplicate: true });
  });
});

describe("the overview panel", () => {
  it("counts come from the live read, and an empty book says what to do", async () => {
    fetchMock.mockResolvedValue(json({
      accounts: [],
      counts: { byStatus: { lead: 3, customer: 5 }, byKind: { commercial: 2, residential: 6 }, total: 8 },
    }));
    render(<ServicesOverviewPanel />);

    expect(await screen.findByText("Leads")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("6 residential")).toBeInTheDocument();
    expect(screen.getByText(/recording your first lead/)).toBeInTheDocument();
  });

  it("renders the pipeline headline from the board's own read", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/services/opportunities")) {
        return Promise.resolve(json({
          opportunities: [],
          report: {
            byStage: {},
            openCount: 3,
            openValueCents: 620_000,
            wonCount: 4,
            wonValueCents: 1_848_000,
            lostCount: 2,
            winRatePercent: 67,
          },
        }));
      }
      return Promise.resolve(json({
        accounts: [account],
        counts: { byStatus: { lead: 1 }, byKind: { commercial: 1 }, total: 1 },
      }));
    });
    render(<ServicesOverviewPanel />);

    const pipeline = await screen.findByTestId("services-overview-pipeline");
    expect(within(pipeline).getByText("$6,200")).toBeInTheDocument();
    expect(within(pipeline).getByText("$18,480")).toBeInTheDocument();
    expect(within(pipeline).getByText("67%")).toBeInTheDocument();
  });

  it("an empty book can seed the Demo Data clientele through the real route", async () => {
    let posted = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted += 1;
        expect(url).toBe("/api/services/demo-seed");
        return Promise.resolve(json({ seeded: { accounts: 14, timelineEvents: 90 } }, 201));
      }
      if (url.startsWith("/api/services/opportunities")) {
        return Promise.resolve(json({ opportunities: [], report: null }));
      }
      return Promise.resolve(json({ accounts: [], counts: { byStatus: {}, byKind: {}, total: 0 } }));
    });
    const user = userEvent.setup();
    render(<ServicesOverviewPanel />);

    const seedBlock = await screen.findByTestId("services-demo-seed");
    expect(seedBlock.textContent).toContain("Demo Data");
    await user.click(screen.getByRole("button", { name: "Load Demo Data" }));

    expect(posted).toBe(1);
    expect(await screen.findByText(/Demo Data loaded: 14 accounts/)).toBeInTheDocument();
  });

  it("a seeded book is labeled Demo Data at the top of the page", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith("/api/services/opportunities")) {
        return Promise.resolve(json({ opportunities: [], report: null }));
      }
      return Promise.resolve(json({
        accounts: [{ ...account, source: "Demo Data" }],
        counts: { byStatus: { lead: 1 }, byKind: { commercial: 1 }, total: 1 },
      }));
    });
    render(<ServicesOverviewPanel />);

    expect(await screen.findByText(/seeded demonstration book/)).toBeInTheDocument();
  });
});
