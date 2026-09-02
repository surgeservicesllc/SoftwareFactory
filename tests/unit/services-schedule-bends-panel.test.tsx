import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServicesSchedulePanel } from "@/components/services/schedule-panel";

/**
 * The schedule bending, as a person works it: two visits selected, one
 * change applied, every outcome listed by name; a project's visits carry
 * their day label; the Projects card shows progress, cancels in two steps,
 * and creates a project through the form.
 */

const accountId = "20000000-0000-4000-8000-0000000f0001";
const technicianId = "70000000-0000-4000-8000-0000000f0001";
const plain = "80000000-0000-4000-8000-0000000f0001";
const done = "80000000-0000-4000-8000-0000000f0002";
const dayOne = "80000000-0000-4000-8000-0000000f0003";
const dayTwo = "80000000-0000-4000-8000-0000000f0004";
const projectId = "90000000-0000-4000-8000-0000000f0001";

const order = (id: string, serviceType: string, day: string, status: string, project: string | null) => ({
  id, accountId, propertyId: "60000000-0000-4000-8000-0000000f0001", technicianId, planId: null, projectId: project, status, serviceType,
  scheduledStart: `${day}T09:00:00Z`, scheduledEnd: `${day}T11:00:00Z`, instructions: null, completionNotes: null, completedAt: status === "completed" ? `${day}T11:00:00Z` : null, createdAt: "x", updatedAt: "x",
});

const payloads: Record<string, unknown> = {
  "/api/services/work-orders": { workOrders: [order(plain, "Monthly IPM", "2026-10-06", "scheduled", null), order(done, "Rodent", "2026-10-06", "completed", null), order(dayOne, "Fumigation", "2026-10-12", "scheduled", projectId), order(dayTwo, "Fumigation", "2026-10-13", "scheduled", projectId)], counts: { byStatus: { scheduled: 3, dispatched: 0, in_progress: 0, completed: 1, cancelled: 0 }, total: 4 } },
  "/api/services/service-plans": { plans: [], counts: { active: 0, due: 0 } },
  "/api/services/technicians": { technicians: [{ id: technicianId, firstName: "Rosa", lastName: "Vega", active: true }], counts: { active: 1 } },
  "/api/services/accounts": { accounts: [{ id: accountId, name: "Harborview Foods", kind: "commercial", status: "customer" }], counts: {} },
  "/api/services/schedule/audit": { window: { days: 14 }, summary: { total: 0, bySeverity: { high: 0, medium: 0, low: 0 }, byFinding: [] }, findings: [], ceiling: { findings: 200, reached: false } },
  "/api/services/projects": { projects: [{ projectId, name: "Plant fumigation", accountId, accountName: "Harborview Foods", propertyId: "s", propertyLabel: "Plant", technicianId, technicianName: "Rosa Vega", serviceType: "Fumigation", startsOn: "2026-10-12", endsOn: "2026-10-13", note: null, days: 2, completed: 0, cancelled: 0, remaining: 2, nextDay: "2026-10-12", state: "planned" }], counts: { total: 1, active: 0, planned: 1 } },
  [`/api/services/accounts/${accountId}`]: { properties: [{ id: "60000000-0000-4000-8000-0000000f0001", label: "Plant" }] },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function serve() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "/api/services/work-orders/bulk" && init?.method === "POST") {
      return Promise.resolve(json({ summary: { applied: 1, refused: 1, sentence: "1 of 2 changed; 1 not: 1 on a route." }, outcomes: [
        { workOrderId: plain, applied: true, reason: null, technicianId, scheduledStart: "2026-10-07T09:00:00Z", status: "scheduled" },
        { workOrderId: dayOne, applied: false, reason: 'on route "Monday" for 2026-10-12; take it off the route first', technicianId, scheduledStart: "2026-10-12T09:00:00Z", status: "scheduled" },
      ] }));
    }
    if (url === "/api/services/projects" && init?.method === "POST") return Promise.resolve(json({ projectId: "new", visits: 3 }, 201));
    if (url.startsWith("/api/services/projects/") && init?.method === "PATCH") return Promise.resolve(json({ projectId, cancelledVisits: 2 }));
    return Promise.resolve(json(payloads[url.split("?")[0]] ?? {}));
  }));
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("bulk edit on the schedule", () => {
  it("selects open visits only, applies one change, and lists every refusal by name", async () => {
    const calls = serve();
    const user = userEvent.setup();
    render(<ServicesSchedulePanel />);

    await screen.findByTestId("services-schedule-board");
    expect(screen.queryByTestId(`services-select-${done}`)).toBeNull();
    expect(screen.getByTestId(`services-project-day-${dayTwo}`)).toHaveTextContent("Day 2 of 2");
    await user.click(screen.getByTestId(`services-select-${plain}`));
    await user.click(screen.getByTestId(`services-select-${dayOne}`));
    const bar = screen.getByTestId("services-bulk-bar");
    expect(bar).toHaveTextContent("2 visits selected");
    expect(within(bar).getByTestId("services-bulk-apply")).toBeDisabled();
    await user.clear(within(bar).getByLabelText("Bulk move by days"));
    await user.type(within(bar).getByLabelText("Bulk move by days"), "1");
    await user.click(within(bar).getByTestId("services-bulk-apply"));

    await waitFor(() => expect(screen.getByTestId("services-bulk-result")).toHaveTextContent("1 of 2 changed; 1 not: 1 on a route."));
    expect(screen.getByTestId("services-bulk-refusals")).toHaveTextContent('Fumigation · Harborview Foods · 2026-10-12: on route "Monday" for 2026-10-12; take it off the route first');
    const post = calls.find((call) => call.url === "/api/services/work-orders/bulk");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ ids: [plain, dayOne], setTechnician: false, shiftDays: 1 });
  });
});

describe("the Projects card", () => {
  it("shows progress, cancels in two steps, and creates a project through the form", async () => {
    const calls = serve();
    const user = userEvent.setup();
    render(<ServicesSchedulePanel />);

    const card = await screen.findByTestId("services-projects");
    await waitFor(() => expect(within(card).getByTestId(`services-project-progress-${projectId}`)).toHaveTextContent("0 of 2 days done · next 2026-10-12 · Rosa Vega"));
    await user.click(within(card).getByTestId(`services-project-cancel-${projectId}`));
    await user.click(within(card).getByTestId(`services-project-cancel-confirm-${projectId}`));
    await waitFor(() => expect(within(card).getByTestId("services-projects-message")).toHaveTextContent("Cancelled “Plant fumigation”: 2 visits cancelled"));
    expect(calls.some((call) => call.url === `/api/services/projects/${projectId}` && call.init?.method === "PATCH")).toBe(true);

    await user.click(within(card).getByTestId("services-projects-new"));
    await user.selectOptions(within(card).getByLabelText("Project account"), accountId);
    await waitFor(() => expect(within(card).getByRole("option", { name: "Plant" })).toBeInTheDocument());
    await user.selectOptions(within(card).getByLabelText("Project site"), "60000000-0000-4000-8000-0000000f0001");
    await user.type(within(card).getByLabelText("Project name"), "Warehouse exclusion");
    await user.type(within(card).getByLabelText("Project service"), "Exclusion");
    await user.type(within(card).getByLabelText("Project first day"), "2026-11-02");
    await user.type(within(card).getByLabelText("Project last day"), "2026-11-04");
    await user.click(within(card).getByLabelText("Include weekends"));
    await user.click(within(card).getByTestId("services-project-create"));
    await waitFor(() => expect(within(card).getByTestId("services-projects-message")).toHaveTextContent("Project created with 3 visits."));
    const post = calls.find((call) => call.url === "/api/services/projects" && call.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      accountId, propertyId: "60000000-0000-4000-8000-0000000f0001", name: "Warehouse exclusion", serviceType: "Exclusion",
      startsOn: "2026-11-02", endsOn: "2026-11-04", dailyStart: "07:00", dailyEnd: "15:30", includeWeekends: true,
    });
  });
});
