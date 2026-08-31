import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServicesCanvassingPanel } from "@/components/services/canvassing-panel";

/**
 * The knocking itself, finally on the page.
 *
 * The schema and the routes existed; nothing let a person plan a route or
 * record a knock, and nothing showed per-rep figures. What matters here:
 * the knock form mirrors the schema's honesty rules (a follow-up date is
 * only offered where one belongs), and the per-rep table keeps a route
 * with no rep as an "Unassigned" row rather than losing its doors.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

const repAda = "11111111-1111-4111-8111-111111111111";

const board = {
  routes: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      territoryId: null,
      repId: repAda,
      name: "Maple Street north",
      status: "walking",
      walkedOn: "2026-08-30",
      startedAt: null,
      endedAt: null,
      notes: null,
      createdAt: "",
      updatedAt: "",
      knockCount: 40,
      productiveCount: 8,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      territoryId: null,
      repId: null,
      name: "Riverside loop",
      status: "planned",
      walkedOn: "2026-08-31",
      startedAt: null,
      endedAt: null,
      notes: null,
      createdAt: "",
      updatedAt: "",
      knockCount: 10,
      productiveCount: 0,
    },
  ],
  knocks: [],
  counts: {
    routes: 2,
    knocks: 50,
    productive: 8,
    sold: 0,
    productiveRate: 16,
    byDisposition: {},
  },
};

function mockFetch() {
  return vi.spyOn(global, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/api/services/territories")) {
      return Promise.resolve(jsonResponse({ territories: [] }));
    }
    if (url.includes("/api/services/employees")) {
      return Promise.resolve(
        jsonResponse({ employees: [{ id: repAda, firstName: "Ada", lastName: "Osei" }] }),
      );
    }
    return Promise.resolve(jsonResponse(board));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the canvassing page's writes and per-rep figures", () => {
  it("plans a route through the real endpoint", async () => {
    const fetchMock = mockFetch();
    render(<ServicesCanvassingPanel />);
    await screen.findAllByText("Maple Street north");

    await userEvent.type(screen.getByLabelText(/Route name/), "Oak Court south");
    await userEvent.click(screen.getByRole("button", { name: "Plan route" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith("/api/services/canvassing") && init?.method === "POST",
      );
      expect(post).toBeDefined();
      const body = JSON.parse(String(post?.[1]?.body));
      expect(body.name).toBe("Oak Court south");
      expect(body.walkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it("offers a follow-up date only where the schema allows one", async () => {
    mockFetch();
    render(<ServicesCanvassingPanel />);
    await screen.findAllByText("Maple Street north");

    expect(screen.queryByLabelText(/Follow up on/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/Disposition/), "callback");
    expect(screen.getByLabelText(/Follow up on/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/Disposition/), "not_interested");
    expect(screen.queryByLabelText(/Follow up on/)).not.toBeInTheDocument();
  });

  it("records a knock against the chosen route", async () => {
    const fetchMock = mockFetch();
    render(<ServicesCanvassingPanel />);
    await screen.findAllByText("Maple Street north");

    await userEvent.selectOptions(screen.getByLabelText(/^Route$/), board.routes[0].id);
    await userEvent.type(screen.getByLabelText(/Address/), "12 Maple St");
    await userEvent.selectOptions(screen.getByLabelText(/Disposition/), "appointment_set");
    await userEvent.click(screen.getByRole("button", { name: "Record knock" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([input, init]) => String(input).includes("/knocks") && init?.method === "POST",
      );
      expect(post).toBeDefined();
      const body = JSON.parse(String(post?.[1]?.body));
      expect(body.canvassRouteId).toBe(board.routes[0].id);
      expect(body.address).toBe("12 Maple St");
      expect(body.disposition).toBe("appointment_set");
    });
  });

  it("keeps unassigned routes' doors visible in the per-rep table", async () => {
    mockFetch();
    render(<ServicesCanvassingPanel />);
    await screen.findAllByText("Maple Street north");

    const table = await screen.findByTestId("services-canvassing-rep-stats");
    expect(table).toHaveTextContent("Ada Osei");
    expect(table).toHaveTextContent("Unassigned");
    // Ada: 40 doors, 8 productive, 20%. Unassigned: 10 doors, 0 productive, 0%.
    expect(table).toHaveTextContent("20%");
    expect(table).toHaveTextContent("0%");
  });
});
