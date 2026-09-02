import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServicesFollowupsPanel } from "@/components/services/followups-panel";
import { taskBucket } from "@/lib/services/followups";

/**
 * The page shows what is owed today and what the book suggests, and every
 * click it offers is a real request: accepting a suggestion posts its KEY
 * (never its text — the server recomputes the reason), finishing a task
 * patches only its status, and the buckets are decided by the same
 * function the route counts with.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const ada = "11111111-1111-4111-8111-111111111111";
const acct = "22222222-2222-4222-8222-222222222222";
const overdueTask = "33333333-3333-4333-8333-333333333333";
const todayTask = "44444444-4444-4444-8444-444444444444";

const board = {
  today: "2026-09-02",
  tasks: [
    {
      id: overdueTask, accountId: acct, opportunityId: null, assigneeEmployeeId: ada,
      title: "Confirm the renewal with Harborview Foods", detail: null, dueOn: "2026-08-30",
      priority: "high", status: "open", origin: "manual", suggestionKey: null, reason: null,
      doneAt: null, cancelledAt: null, createdAt: "", updatedAt: "",
    },
    {
      id: todayTask, accountId: acct, opportunityId: null, assigneeEmployeeId: null,
      title: "Collect invoice INV-7", detail: null, dueOn: "2026-09-02",
      priority: "high", status: "open", origin: "suggested",
      suggestionKey: `invoice_quiet:${acct}`, reason: "12 days overdue; no collection action recorded in the last 7 days.",
      doneAt: null, cancelledAt: null, createdAt: "", updatedAt: "",
    },
  ],
  recent: [],
  suggestions: [
    {
      suggestionKey: `stale_lead:${acct}`, rule: "stale_lead", accountId: acct, opportunityId: null,
      title: "Reach out to Ridgeway Bakery", reason: "Lead with no recorded activity in 21 days.",
      dueOn: "2026-09-02", priority: "normal",
    },
  ],
  employees: [{ id: ada, name: "Ada Lovelace", role: "csr" }],
  counts: { open: 2, overdue: 1, dueToday: 1, doneThisWeek: 0, suggestions: 1 },
};

function mockFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (init?.method === "POST" && url.endsWith("/suggestions")) {
      return jsonResponse({ task: { id: "new" } }, 201);
    }
    if (init?.method === "PATCH") return jsonResponse({ task: board.tasks[0] });
    if (init?.method === "POST") return jsonResponse({ task: { id: "new" } }, 201);
    if (init?.method === "PUT") return jsonResponse({ dismissed: {} });
    return jsonResponse(board);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("taskBucket", () => {
  it("buckets only open tasks, by the date alone", () => {
    expect(taskBucket({ status: "open", dueOn: "2026-09-01" }, "2026-09-02")).toBe("overdue");
    expect(taskBucket({ status: "open", dueOn: "2026-09-02" }, "2026-09-02")).toBe("today");
    expect(taskBucket({ status: "open", dueOn: "2026-09-03" }, "2026-09-02")).toBe("later");
    expect(taskBucket({ status: "done", dueOn: "2026-08-01" }, "2026-09-02")).toBeNull();
    expect(taskBucket({ status: "cancelled", dueOn: "2026-09-02" }, "2026-09-02")).toBeNull();
  });
});

describe("ServicesFollowupsPanel", () => {
  it("shows the suggestion with its reason and buckets the open tasks", async () => {
    mockFetch();
    render(<ServicesFollowupsPanel />);

    await screen.findByText("Reach out to Ridgeway Bakery");
    expect(screen.getByText("Lead with no recorded activity in 21 days.")).toBeInTheDocument();
    expect(screen.getByText(/A lead or prospect with no recorded activity in 14 days/)).toBeInTheDocument();

    const overdue = screen.getByTestId("followups-overdue");
    expect(within(overdue).getByText("Confirm the renewal with Harborview Foods")).toBeInTheDocument();
    const today = screen.getByTestId("followups-today");
    expect(within(today).getByText("Collect invoice INV-7")).toBeInTheDocument();
    expect(within(today).getByText(/from a suggestion/)).toBeInTheDocument();
  });

  it("accepts a suggestion by posting its key only", async () => {
    const calls = mockFetch();
    render(<ServicesFollowupsPanel />);
    await screen.findByText("Reach out to Ridgeway Bakery");

    await userEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => {
      const accept = calls.find((call) => call.init?.method === "POST" && call.url.endsWith("/suggestions"));
      expect(accept).toBeDefined();
      const body = JSON.parse(String(accept!.init!.body)) as Record<string, unknown>;
      expect(body).toEqual({ suggestionKey: `stale_lead:${acct}`, assigneeEmployeeId: null });
      expect(body).not.toHaveProperty("title");
      expect(body).not.toHaveProperty("reason");
    });
  });

  it("finishes a task by patching only its status", async () => {
    const calls = mockFetch();
    render(<ServicesFollowupsPanel />);
    await screen.findByText("Confirm the renewal with Harborview Foods");

    const overdue = screen.getByTestId("followups-overdue");
    await userEvent.click(within(overdue).getByRole("button", { name: "Done" }));

    await waitFor(() => {
      const patch = calls.find((call) => call.init?.method === "PATCH");
      expect(patch).toBeDefined();
      expect(JSON.parse(String(patch!.init!.body))).toEqual({ taskId: overdueTask, status: "done" });
    });
  });

  it("adds a manual follow-up with the date and owner chosen", async () => {
    const calls = mockFetch();
    render(<ServicesFollowupsPanel />);
    await screen.findByText("Reach out to Ridgeway Bakery");

    await userEvent.type(screen.getByLabelText("Follow-up"), "Call the school about the summer programme");
    await userEvent.type(screen.getByLabelText("Due on"), "2026-09-09");
    await userEvent.selectOptions(screen.getByLabelText("Owner"), ada);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const create = calls.find((call) => call.init?.method === "POST" && !call.url.endsWith("/suggestions"));
      expect(create).toBeDefined();
      expect(JSON.parse(String(create!.init!.body))).toEqual({
        title: "Call the school about the summer programme",
        dueOn: "2026-09-09",
        priority: "normal",
        assigneeEmployeeId: ada,
      });
    });
  });

  it("surfaces a refused acceptance in the server's own words", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (init?.method === "POST") {
        return jsonResponse({ error: { code: "suggestion_gone", message: "That suggestion no longer applies." } }, 409);
      }
      return jsonResponse(board);
    }));
    render(<ServicesFollowupsPanel />);
    await screen.findByText("Reach out to Ridgeway Bakery");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That suggestion no longer applies.");
  });
});
