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
});
