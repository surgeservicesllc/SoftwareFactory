import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServicesIpmPanel } from "@/components/services/ipm-panel";

/**
 * The IPM dashboard as a person works it: sites, stations and thresholds
 * render from the live payload, a scan posts through the real route, and a
 * sighting resolves by recording its corrective action.
 */

const accountId = "20000000-0000-4000-8000-0000000c0001";
const propertyId = "60000000-0000-4000-8000-0000000c0001";
const deviceId = "a0000000-0000-4000-8000-0000000c0001";
const sightingId = "b0000000-0000-4000-8000-0000000c0001";

const ipmPayload = {
  devices: [
    {
      id: deviceId,
      accountId,
      propertyId,
      label: "Station 01",
      deviceType: "bait_station",
      barcode: "DEMO-ST-1001",
      status: "active",
      locationNote: "North fence, post 1",
      activityThreshold: 3,
      installedAt: "2026-05-12T09:00:00Z",
      removedAt: null,
      createdAt: "2026-05-12T09:00:00Z",
      updatedAt: "2026-08-30T10:00:00Z",
    },
  ],
  recentEvents: [
    {
      id: "c0000000-0000-4000-8000-0000000c0001",
      deviceId,
      event: "service",
      condition: "ok",
      activityCount: 4,
      pestObserved: "House mouse",
      locationNote: null,
      note: null,
      workOrderId: null,
      recordedAt: "2026-08-12T09:00:00Z",
      recordedBySystem: false,
    },
  ],
  sightings: [
    {
      id: sightingId,
      accountId,
      propertyId,
      pest: "House mouse",
      severity: "high",
      locationNote: "Dock door 7",
      note: null,
      sightedAt: "2026-08-12T09:00:00Z",
      correctiveAction: null,
      correctedAt: null,
      createdAt: "2026-08-12T09:00:00Z",
      updatedAt: "2026-08-12T09:00:00Z",
    },
  ],
  properties: [{ id: propertyId, accountId, label: "Distribution Center" }],
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

let fetchMock: ReturnType<typeof vi.fn>;

function serve(overrides: {
  ipm?: unknown;
  onWrite?: (url: string, init: RequestInit) => Response | null;
}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET" && overrides.onWrite) {
      const handled = overrides.onWrite(url, init);
      if (handled) return Promise.resolve(handled);
    }
    if (url.startsWith("/api/services/ipm")) {
      return Promise.resolve(json(overrides.ipm ?? ipmPayload));
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

describe("the IPM panel", () => {
  it("renders sites, stations and the over-threshold flag from the live payload", async () => {
    serve({});
    render(<ServicesIpmPanel />);

    const sites = await screen.findByTestId("services-ipm-sites");
    expect(within(sites).getByText("Station 01")).toBeInTheDocument();
    expect(within(sites).getByText("DEMO-ST-1001")).toBeInTheDocument();
    // Latest count 4 at threshold 3: flagged.
    expect(within(sites).getByText("over threshold")).toBeInTheDocument();
    const counts = screen.getByTestId("services-ipm-counts");
    expect(counts.textContent).toContain("1 over threshold");
    expect(counts.textContent).toContain("1 open sighting");
  });

  it("an empty station map names its next step", async () => {
    serve({ ipm: { devices: [], recentEvents: [], sightings: [], properties: [] } });
    render(<ServicesIpmPanel />);

    const empty = await screen.findByTestId("services-ipm-empty");
    expect(empty.textContent).toContain("Install device");
  });

  it("records a scan through the real route with the exact body", async () => {
    let posted: unknown = null;
    serve({
      onWrite: (url, init) => {
        if (init.method === "POST" && url === "/api/services/devices/scan") {
          posted = JSON.parse(init.body as string);
          return json({ scan: ipmPayload.recentEvents[0], device: ipmPayload.devices[0] }, 201);
        }
        return null;
      },
    });
    const user = userEvent.setup();
    render(<ServicesIpmPanel />);
    await screen.findByTestId("services-ipm-sites");

    await user.type(screen.getByPlaceholderText("DEMO-ST-1001"), "DEMO-ST-1001");
    await user.type(screen.getByLabelText(/Captures \/ activity/), "4");
    await user.type(screen.getByLabelText(/Pest observed/), "House mouse");
    await user.click(screen.getByRole("button", { name: "Record scan" }));

    expect(posted).toEqual({
      barcode: "DEMO-ST-1001",
      event: "service",
      activityCount: 4,
      pestObserved: "House mouse",
    });
  });

  it("resolves a sighting by recording its corrective action", async () => {
    const patches: { url: string; body: unknown }[] = [];
    serve({
      onWrite: (url, init) => {
        if (init.method === "PATCH") {
          patches.push({ url, body: JSON.parse(init.body as string) });
          return json({ sighting: { ...ipmPayload.sightings[0], correctedAt: "2026-08-30T11:00:00Z" } });
        }
        return null;
      },
    });
    const user = userEvent.setup();
    render(<ServicesIpmPanel />);
    await screen.findByTestId("services-ipm-sites");

    await user.click(screen.getByRole("button", { name: "Record corrective action" }));
    await user.type(
      screen.getByLabelText("Corrective action for House mouse"),
      "Multi-catch moved to dock door 7.",
    );
    await user.click(screen.getByRole("button", { name: "Record action" }));

    expect(patches).toEqual([
      {
        url: `/api/services/sightings/${sightingId}`,
        body: { correctiveAction: "Multi-catch moved to dock door 7." },
      },
    ]);
  });
});

describe("printing a station label", () => {
  it("draws a Code 39 symbol beside the barcode a scan resolves to", async () => {
    serve({});
    const user = userEvent.setup();
    render(<ServicesIpmPanel />);

    const labels = await screen.findByTestId("station-labels");
    await user.click(within(labels).getByRole("button", { name: /Station labels/ }));

    const label = await screen.findByTestId("station-label");
    expect(within(label).getByText("Station 01")).toBeInTheDocument();
    expect(within(label).getByText("DEMO-ST-1001")).toBeInTheDocument();
    expect(within(label).getByTestId("station-label-symbol")).toBeInTheDocument();
  });

  it("prints a lowercase barcode without a symbol, and says why", async () => {
    // Barcodes are case-sensitive in this schema, so an uppercased symbol
    // would scan as a different station. The label tells the truth instead.
    serve({
      ipm: {
        ...ipmPayload,
        devices: [{ ...ipmPayload.devices[0], barcode: "demo-st-1001" }],
      },
    });
    const user = userEvent.setup();
    render(<ServicesIpmPanel />);

    const labels = await screen.findByTestId("station-labels");
    await user.click(within(labels).getByRole("button", { name: /Station labels/ }));

    const label = await screen.findByTestId("station-label");
    expect(within(label).queryByTestId("station-label-symbol")).toBeNull();
    expect(within(label).getByTestId("station-label-refusal").textContent)
      .toMatch(/scan as a different station/);
  });
});
