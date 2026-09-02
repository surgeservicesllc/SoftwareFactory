import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServicesSchedulePanel } from "@/components/services/schedule-panel";
import { ServicesTechniciansPanel } from "@/components/services/technicians-panel";

/**
 * The schedule and roster as a person works them: the board and its counts
 * render from the live payload, a due plan generates through the real
 * route, completing a visit asks for the field notes before anything is
 * sent, and the roster's additions post the real body.
 */

const accountId = "20000000-0000-4000-8000-0000000c0001";
const technicianId = "70000000-0000-4000-8000-0000000c0001";
const workOrderId = "80000000-0000-4000-8000-0000000c0001";
const planId = "90000000-0000-4000-8000-0000000c0001";

const workOrder = {
  id: workOrderId,
  accountId,
  propertyId: "60000000-0000-4000-8000-0000000c0001",
  technicianId,
  planId: null,
  status: "scheduled",
  serviceType: "Monthly IPM service",
  scheduledStart: "2026-09-02T09:00:00Z",
  scheduledEnd: "2026-09-02T11:00:00Z",
  instructions: null,
  completionNotes: null,
  completedAt: null,
  createdAt: "2026-08-30T10:00:00Z",
  updatedAt: "2026-08-30T10:00:00Z",
};

const workOrdersPayload = {
  workOrders: [workOrder],
  counts: {
    byStatus: { scheduled: 1, dispatched: 0, in_progress: 0, completed: 4, cancelled: 1 },
    total: 6,
  },
};

const plansPayload = {
  plans: [
    {
      id: planId,
      accountId,
      propertyId: "60000000-0000-4000-8000-0000000c0001",
      serviceType: "Quarterly deep inspection",
      recurrence: "quarterly",
      nextDue: "2020-01-01",
      technicianId,
      valueCents: 89_000,
      active: true,
      notes: null,
      cycleMonths: null,
      createdAt: "2026-08-30T10:00:00Z",
      updatedAt: "2026-08-30T10:00:00Z",
    },
  ],
  dueCount: 1,
};

const emptySequence = {
  cycleMonths: null,
  steps: [],
  occurrences: [],
  cadence: { sequenced: false, visitsPerYear: null, billsPerYear: 4 },
};

const techniciansPayload = {
  technicians: [
    {
      id: technicianId,
      firstName: "Miguel",
      lastName: "Santos",
      email: null,
      phone: "(555) 016-0001",
      licenseNumber: "DEMO-APP-10482",
      active: true,
      createdAt: "2026-08-30T10:00:00Z",
      updatedAt: "2026-08-30T10:00:00Z",
    },
  ],
};

const accountsPayload = {
  accounts: [
    {
      id: accountId,
      name: "Harborlight Foods Distribution",
      kind: "commercial",
      status: "customer",
      email: null,
      phone: null,
      source: "Demo Data",
      billingAddress: null,
      notes: null,
      createdAt: "2026-08-30T10:00:00Z",
      updatedAt: "2026-08-30T10:00:00Z",
    },
  ],
  counts: { byStatus: { customer: 1 }, byKind: { commercial: 1 }, total: 1 },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const emptyAudit = {
  organizationId: "org-1",
  window: { days: 14 },
  findings: [],
  summary: { total: 0, bySeverity: { high: 0, medium: 0, low: 0 }, byFinding: [] },
  ceiling: { findings: 500, reached: false },
};

let fetchMock: ReturnType<typeof vi.fn>;

function serve(overrides: {
  workOrders?: unknown;
  plans?: unknown;
  sequence?: unknown;
  audit?: unknown;
  onWrite?: (url: string, init: RequestInit) => Response | null;
}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET" && overrides.onWrite) {
      const handled = overrides.onWrite(url, init);
      if (handled) return Promise.resolve(handled);
    }
    if (url.startsWith("/api/services/work-orders")) {
      return Promise.resolve(json(overrides.workOrders ?? workOrdersPayload));
    }
    if (url.includes("/steps")) {
      return Promise.resolve(json(overrides.sequence ?? emptySequence));
    }
    if (url.startsWith("/api/services/service-plans")) {
      return Promise.resolve(json(overrides.plans ?? plansPayload));
    }
    if (url.startsWith("/api/services/technicians")) {
      return Promise.resolve(json(techniciansPayload));
    }
    if (url.startsWith("/api/services/schedule/audit")) {
      return Promise.resolve(json(overrides.audit ?? emptyAudit));
    }
    return Promise.resolve(json(accountsPayload));
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

describe("the schedule panel", () => {
  it("renders the board, its status counts, and the due-plan lane from live payloads", async () => {
    serve({});
    render(<ServicesSchedulePanel />);

    const board = await screen.findByTestId("services-schedule-board");
    expect(within(board).getByText("Monthly IPM service")).toBeInTheDocument();
    expect(within(board).getByText("Harborlight Foods Distribution")).toBeInTheDocument();
    const counts = screen.getByTestId("services-schedule-counts");
    expect(counts.textContent).toContain("Completed 4");
    const due = screen.getByTestId("services-due-plans");
    expect(within(due).getByText(/Quarterly deep inspection/)).toBeInTheDocument();
  });

  it("an empty schedule names its next step", async () => {
    serve({
      workOrders: { workOrders: [], counts: { byStatus: {}, total: 0 } },
      plans: { plans: [], dueCount: 0 },
    });
    render(<ServicesSchedulePanel />);

    const empty = await screen.findByTestId("services-schedule-empty");
    expect(empty.textContent).toContain("New work order");
  });

  it("generates a due plan's visit through the real route", async () => {
    const posts: string[] = [];
    serve({
      onWrite: (url, init) => {
        if (init.method === "POST") {
          posts.push(url);
          return json({ workOrder, plan: plansPayload.plans[0] }, 201);
        }
        return null;
      },
    });
    const user = userEvent.setup();
    render(<ServicesSchedulePanel />);
    await screen.findByTestId("services-due-plans");

    await user.click(screen.getAllByRole("button", { name: "Generate visit" })[0]);
    expect(posts).toEqual([`/api/services/service-plans/${planId}/generate`]);
  });

  it("completing a visit asks for the field notes before anything is sent", async () => {
    const patches: { url: string; body: unknown }[] = [];
    serve({
      onWrite: (url, init) => {
        if (init.method === "PATCH") {
          patches.push({ url, body: JSON.parse(init.body as string) });
          return json({ workOrder: { ...workOrder, status: "completed" } });
        }
        return null;
      },
    });
    const user = userEvent.setup();
    render(<ServicesSchedulePanel />);
    await screen.findByTestId("services-schedule-board");

    await user.selectOptions(
      screen.getByLabelText(`Status for ${workOrder.serviceType}`),
      "completed",
    );
    expect(patches).toHaveLength(0);
    await user.type(
      screen.getByPlaceholderText("Field notes for the record…"),
      "Stations serviced; two rebaited.",
    );
    await user.click(screen.getByRole("button", { name: "Complete visit" }));
    expect(patches).toEqual([
      {
        url: `/api/services/work-orders/${workOrderId}`,
        body: { status: "completed", completionNotes: "Stations serviced; two rebaited." },
      },
    ]);
  });
});

describe("the technicians panel", () => {
  it("renders the roster and adds through the real route", async () => {
    let posted: unknown = null;
    serve({
      onWrite: (url, init) => {
        if (init.method === "POST" && url === "/api/services/technicians") {
          posted = JSON.parse(init.body as string);
          return json({ technician: techniciansPayload.technicians[0] }, 201);
        }
        return null;
      },
    });
    const user = userEvent.setup();
    render(<ServicesTechniciansPanel />);

    const roster = await screen.findByTestId("services-technicians");
    expect(within(roster).getByText("Miguel Santos")).toBeInTheDocument();
    expect(within(roster).getByText("DEMO-APP-10482")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add technician" }));
    const dialogButtons = screen.getAllByRole("button", { name: "Add technician" });
    await user.type(screen.getAllByRole("textbox")[0], "Aisha");
    await user.click(dialogButtons[dialogButtons.length - 1]);
    expect(posted).toEqual({ firstName: "Aisha" });
  });
});

describe("sequencing a plan onto named dates", () => {
  it("previews the dates before anything is saved, and saves the sequence the operator built", async () => {
    let sent: { cycleMonths: number | null; steps: unknown[] } | null = null;
    serve({
      onWrite: (url, init) => {
        if (init.method === "PUT" && url.endsWith(`/service-plans/${planId}/steps`)) {
          sent = JSON.parse(init.body as string);
          return json({
            cycleMonths: 1,
            steps: [],
            occurrences: [
              { stepPosition: 1, occursOn: "2026-09-01", serviceType: "Quarterly deep inspection" },
            ],
            cadence: { sequenced: true, visitsPerYear: 24, billsPerYear: 4 },
          });
        }
        return null;
      },
    });
    const user = userEvent.setup();
    render(<ServicesSchedulePanel />);

    const plans = await screen.findByTestId("services-plans");
    await user.click(within(plans).getByRole("button", { name: "Schedule" }));

    const editor = await screen.findByTestId("plan-sequence-editor");
    await user.click(within(editor).getByRole("button", { name: "1st and 15th" }));

    // The preview is computed in the browser, so it appears before a save.
    const preview = within(editor).getByTestId("plan-sequence-preview");
    expect(within(preview).getAllByRole("listitem").length).toBeGreaterThan(0);
    for (const date of within(preview).getAllByRole("listitem")) {
      expect(date.textContent).toMatch(/-(01|15)$/);
    }

    await user.click(within(editor).getByRole("button", { name: "Save schedule" }));

    expect(sent).toEqual({
      cycleMonths: 1,
      steps: [
        { position: 1, monthOffset: 0, anchor: "day_of_month", dayOfMonth: 1, weekOfMonth: null, weekday: null, serviceType: null },
        { position: 2, monthOffset: 0, anchor: "day_of_month", dayOfMonth: 15, weekOfMonth: null, weekday: null, serviceType: null },
      ],
    });
  });

  it("says visits and bills separately once they disagree", async () => {
    serve({
      sequence: {
        cycleMonths: 12,
        steps: [{
          id: "a0000000-0000-4000-8000-0000000c0001",
          planId,
          position: 1,
          monthOffset: 2,
          anchor: "nth_weekday",
          dayOfMonth: null,
          weekOfMonth: 2,
          weekday: 1,
          serviceType: "perimeter",
          createdAt: "2026-08-30T10:00:00Z",
          updatedAt: "2026-08-30T10:00:00Z",
        }],
        occurrences: [
          { stepPosition: 1, occursOn: "2027-03-08", serviceType: "perimeter" },
        ],
        cadence: { sequenced: true, visitsPerYear: 1, billsPerYear: 4 },
      },
    });
    const user = userEvent.setup();
    render(<ServicesSchedulePanel />);

    const plans = await screen.findByTestId("services-plans");
    await user.click(within(plans).getByRole("button", { name: "Schedule" }));

    const cadence = await screen.findByTestId("plan-cadence");
    expect(cadence.textContent).toContain("1 visits a year");
    expect(cadence.textContent).toContain("4 bills a year");
    expect(cadence.textContent).toContain("level billing");
  });

  it("shows the schedule audit with every finding named, and says so when nothing contradicts", async () => {
    serve({
      audit: {
        ...emptyAudit,
        findings: [
          { finding: "double_booked", label: "Double-booked technician", severity: "high", occursOn: "2026-04-15", workOrderId: "wo-1", otherWorkOrderId: "wo-2", planId: null, routeId: null, accountId: "acc-1", accountName: "Harborview Foods", technicianId: "t1", technicianName: "Rosa Vega", detail: "Overlaps Harborview Foods, 10:30–11:30." },
          { finding: "plan_due_unscheduled", label: "Plan due with no visit", severity: "medium", occursOn: "2026-04-17", workOrderId: null, otherWorkOrderId: null, planId: "p1", routeId: null, accountId: "acc-1", accountName: "Harborview Foods", technicianId: null, technicianName: null, detail: "Quarterly IPM due 2026-04-17 (quarterly); no visit within a week of it." },
        ],
        summary: { total: 2, bySeverity: { high: 1, medium: 1, low: 0 }, byFinding: [{ finding: "double_booked", label: "Double-booked technician", count: 1 }, { finding: "plan_due_unscheduled", label: "Plan due with no visit", count: 1 }] },
      },
    });
    render(<ServicesSchedulePanel />);
    const card = await screen.findByTestId("services-schedule-audit");
    expect(within(card).getByText("Schedule audit (2)")).toBeInTheDocument();
    expect(screen.getByTestId("services-schedule-audit-summary")).toHaveTextContent("1 double-booked technician · 1 plan due with no visit");
    expect(within(card).getByText("Overlaps Harborview Foods, 10:30–11:30.")).toBeInTheDocument();
    expect(within(card).getByText("Double-booked technician")).toBeInTheDocument();
    expect(within(card).getAllByText("high")).toHaveLength(1);

    cleanup();
    serve({});
    render(<ServicesSchedulePanel />);
    await screen.findByTestId("services-schedule-audit-clean");
    expect(screen.getByText("Schedule audit: nothing contradicts")).toBeInTheDocument();
  });
});
