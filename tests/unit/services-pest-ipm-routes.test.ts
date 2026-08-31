// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { POST as createDevice } from "@/app/api/services/devices/route";
import { POST as scanDevice } from "@/app/api/services/devices/scan/route";
import { PATCH as resolveSighting } from "@/app/api/services/sightings/[sightingId]/route";
import { GET as readIpm } from "@/app/api/services/ipm/route";

/**
 * The IPM boundaries: a barcode resolves inside the organization or answers
 * an honest 404, a move without a destination is refused before the
 * database, the corrective action lands with its timestamp, and the
 * dashboard read stays org-scoped.
 */

const organizationId = "10000000-0000-4000-8000-0000000c0001";
const userId = "00000000-0000-4000-8000-0000000c0001";
const accountId = "20000000-0000-4000-8000-0000000c0001";
const propertyId = "60000000-0000-4000-8000-0000000c0001";
const deviceId = "a0000000-0000-4000-8000-0000000c0001";
const sightingId = "b0000000-0000-4000-8000-0000000c0001";

type QueryResult = { data: unknown; error: unknown; count?: number };

function stubTable(results: QueryResult[]) {
  let call = 0;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "insert", "update", "eq", "order", "limit", "ilike"]) {
    builder[method] = vi.fn(chain);
  }
  builder.single = vi.fn(() => Promise.resolve(results[Math.min(call++, results.length - 1)]));
  builder.maybeSingle = vi.fn(() => Promise.resolve(results[Math.min(call++, results.length - 1)]));
  builder.then = (onFulfilled: (value: QueryResult) => unknown) =>
    Promise.resolve(results[Math.min(call++, results.length - 1)]).then(onFulfilled);
  return builder;
}

let from: ReturnType<typeof vi.fn>;

function client(results: Record<string, QueryResult[]>) {
  const tables = new Map<string, ReturnType<typeof stubTable>>();
  from = vi.fn((table: string) => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created = stubTable(results[table] ?? [{ data: null, error: null }]);
    tables.set(table, created);
    return created;
  });
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: userId },
    client: { from },
  });
}

function post(url: string, body: unknown, origin = "https://factory.example") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

function patch(url: string, body: unknown, origin = "https://factory.example") {
  return new Request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

const deviceRow = {
  id: deviceId,
  account_id: accountId,
  property_id: propertyId,
  label: "Station 01",
  device_type: "bait_station",
  barcode: "DEMO-ST-1001",
  status: "active",
  location_note: "North fence, post 1",
  activity_threshold: 3,
  installed_at: "2026-05-12T09:00:00Z",
  removed_at: null,
  created_at: "2026-05-12T09:00:00Z",
  updated_at: "2026-08-30T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the device boundary", () => {
  it("installs a station with the exact tenant identity", async () => {
    client({ crm_devices: [{ data: deviceRow, error: null }] });
    const response = await createDevice(
      post("https://factory.example/api/services/devices", {
        accountId,
        propertyId,
        label: "Station 01",
        deviceType: "bait_station",
        barcode: "DEMO-ST-1001",
        activityThreshold: 3,
      }),
    );
    expect(response.status).toBe(201);
    const table = from.mock.results[0]?.value as { insert: ReturnType<typeof vi.fn> };
    expect(table.insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: organizationId,
      account_id: accountId,
      property_id: propertyId,
      barcode: "DEMO-ST-1001",
      created_by: userId,
    }));
  });

  it("answers a taken barcode with an honest 409", async () => {
    client({ crm_devices: [{ data: null, error: { code: "23505", message: "dup" } }] });
    const response = await createDevice(
      post("https://factory.example/api/services/devices", {
        accountId,
        propertyId,
        label: "Duplicate",
        deviceType: "bait_station",
        barcode: "DEMO-ST-1001",
      }),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("barcode_taken");
  });
});

describe("the scan boundary", () => {
  it("resolves the barcode inside the organization and appends with the actor", async () => {
    client({
      crm_devices: [
        { data: deviceRow, error: null },
        { data: { ...deviceRow, status: "removed", removed_at: "2026-08-30T11:00:00Z" }, error: null },
      ],
      crm_device_events: [{
        data: {
          id: "c0000000-0000-4000-8000-0000000c0001",
          device_id: deviceId,
          event: "remove",
          condition: null,
          activity_count: null,
          pest_observed: null,
          location_note: null,
          note: null,
          work_order_id: null,
          recorded_at: "2026-08-30T11:00:00Z",
          actor_user_id: userId,
        },
        error: null,
      }],
    });
    const response = await scanDevice(
      post("https://factory.example/api/services/devices/scan", {
        barcode: "DEMO-ST-1001",
        event: "remove",
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.scan.event).toBe("remove");
    // The device comes back re-read: the ledger trigger already moved it.
    expect(body.device.status).toBe("removed");
    const events = from.mock.results[from.mock.calls.findIndex(([t]) => t === "crm_device_events")]
      ?.value as { insert: ReturnType<typeof vi.fn> };
    expect(events.insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: organizationId,
      device_id: deviceId,
      event: "remove",
      actor_user_id: userId,
    }));
  });

  it("answers an unknown barcode with an honest 404, appending nothing", async () => {
    client({ crm_devices: [{ data: null, error: null }] });
    const response = await scanDevice(
      post("https://factory.example/api/services/devices/scan", {
        barcode: "NOPE-0000",
        event: "service",
      }),
    );
    expect(response.status).toBe(404);
    expect(from.mock.calls.some(([table]) => table === "crm_device_events")).toBe(false);
  });

  it("refuses a move that does not say where, before the database", async () => {
    client({ crm_devices: [{ data: deviceRow, error: null }] });
    const response = await scanDevice(
      post("https://factory.example/api/services/devices/scan", {
        barcode: "DEMO-ST-1001",
        event: "move",
      }),
    );
    expect(response.status).toBe(422);
    expect(requireActiveOrganization).not.toHaveBeenCalled();
  });
});

describe("the sighting boundary", () => {
  it("records the corrective action together with its timestamp", async () => {
    client({
      crm_pest_sightings: [{
        data: {
          id: sightingId,
          account_id: accountId,
          property_id: propertyId,
          pest: "House mouse",
          severity: "high",
          location_note: null,
          note: null,
          sighted_at: "2026-08-12T09:00:00Z",
          corrective_action: "Multi-catch moved to dock door 7.",
          corrected_at: "2026-08-30T10:00:00Z",
          created_at: "2026-08-12T09:00:00Z",
          updated_at: "2026-08-30T10:00:00Z",
        },
        error: null,
      }],
    });
    const response = await resolveSighting(
      patch(`https://factory.example/api/services/sightings/${sightingId}`, {
        correctiveAction: "Multi-catch moved to dock door 7.",
      }),
      { params: Promise.resolve({ sightingId }) },
    );
    expect(response.status).toBe(200);
    const table = from.mock.results[0]?.value as { update: ReturnType<typeof vi.fn> };
    expect(table.update).toHaveBeenCalledWith({
      corrective_action: "Multi-catch moved to dock door 7.",
      corrected_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });
});

describe("the dashboard boundary", () => {
  it("reads all four org-scoped groups in one payload", async () => {
    client({
      crm_devices: [{ data: [deviceRow], error: null }],
      crm_device_events: [{ data: [], error: null }],
      crm_pest_sightings: [{ data: [], error: null }],
      crm_properties: [{ data: [{ id: propertyId, account_id: accountId, label: "Distribution Center" }], error: null }],
    });
    const response = await readIpm();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.devices[0]).toMatchObject({ barcode: "DEMO-ST-1001", activityThreshold: 3 });
    expect(body.properties).toEqual([
      { id: propertyId, accountId, label: "Distribution Center" },
    ]);
  });
});
