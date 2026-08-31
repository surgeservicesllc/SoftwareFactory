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

import { GET as fleet, PATCH as patchAsset, POST as post } from "@/app/api/services/equipment/route";

/**
 * The fleet boundary.
 *
 * The behavior suite proves the ledger governs state. This file pins that
 * the ROUTE cannot get around it: status and assignment are not in the
 * patch schema at all, the ledger's backwards-meter message reaches the
 * technician intact rather than being flattened, and the two counts a fleet
 * report usually hides are computed rather than assumed.
 */

const organizationId = "10000000-0000-4000-8000-00000000a901";
const userId = "00000000-0000-4000-8000-00000000a901";
const equipmentId = "20000000-0000-4000-8000-00000000a901";

type QueryResult = { data: unknown; error: unknown };

function stubTable(results: QueryResult[]) {
  let call = 0;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "insert", "update", "eq", "in", "order", "limit"]) {
    builder[method] = vi.fn(chain);
  }
  const next = () => Promise.resolve(results[Math.min(call++, results.length - 1)]);
  builder.single = vi.fn(next);
  builder.maybeSingle = vi.fn(next);
  builder.then = (onFulfilled: (value: QueryResult) => unknown) => next().then(onFulfilled);
  return builder;
}

let from: ReturnType<typeof vi.fn>;
let rpc: ReturnType<typeof vi.fn>;
let tables: Map<string, ReturnType<typeof stubTable>>;

function client(
  tableResults: Record<string, QueryResult[]>,
  rpcResults: Record<string, QueryResult> = {},
) {
  tables = new Map();
  from = vi.fn((table: string) => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created = stubTable(tableResults[table] ?? [{ data: [], error: null }]);
    tables.set(table, created);
    return created;
  });
  rpc = vi.fn((name: string) => Promise.resolve(rpcResults[name] ?? { data: [], error: null }));
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: userId },
    client: { from, rpc },
  });
}

function send(method: "POST" | "PATCH", body: unknown, origin = "https://factory.example") {
  return new Request("https://factory.example/api/services/equipment", {
    method,
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

const asset = {
  equipment_id: equipmentId,
  asset_tag: "TRUCK-04",
  name: "Service truck 4",
  kind: "vehicle",
  status: "in_service",
  branch_id: null,
  assigned_technician_id: null,
  meter_reading: "43250.0",
  meter_unit: "miles",
  last_serviced_on: "2026-08-01",
  service_interval_days: 180,
  next_service_due: "2027-01-28",
  days_until_service: 150,
  events: 6,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://factory.example");
});

describe("the fleet route", () => {
  it("counts unscheduled apart from ok, and names kit nobody is carrying", async () => {
    client(
      {},
      {
        crm_fleet_status: {
          data: [
            asset,
            {
              ...asset,
              equipment_id: "20000000-0000-4000-8000-00000000a902",
              asset_tag: "SPRAY-11",
              // No interval on file: not judged, not fine.
              service_interval_days: null,
              next_service_due: null,
              days_until_service: null,
            },
            {
              ...asset,
              equipment_id: "20000000-0000-4000-8000-00000000a903",
              asset_tag: "METER-02",
              days_until_service: -310,
            },
            {
              ...asset,
              equipment_id: "20000000-0000-4000-8000-00000000a904",
              asset_tag: "OLD-01",
              status: "retired",
              days_until_service: -900,
            },
          ],
          error: null,
        },
      },
    );

    const body = (await (await fleet()).json()) as {
      fleet: { standing: string; unassigned: boolean }[];
      counts: { overdue: number; unscheduled: number; unassigned: number; retired: number };
      telemetry: { available: boolean; label: string };
    };
    expect(body.fleet[0].standing).toBe("ok");
    // Never folded into ok: nobody has said when this is due.
    expect(body.fleet[1].standing).toBe("unscheduled");
    expect(body.fleet[2].standing).toBe("overdue");
    expect(body.counts.unscheduled).toBe(1);
    // A retired asset is off the roster, so its overdue schedule is not
    // counted against the fleet.
    expect(body.counts.overdue).toBe(1);
    expect(body.counts.retired).toBe(1);
    // Three on the roster, none assigned.
    expect(body.counts.unassigned).toBe(3);
    expect(body.telemetry).toEqual({ available: false, label: "Not Connected" });
  });

  it("has no way to set status or who holds an asset", async () => {
    client({ crm_equipment: [{ data: null, error: null }] });
    for (const forbidden of [
      { equipmentId, status: "retired" },
      { equipmentId, assignedTechnicianId: "30000000-0000-4000-8000-00000000a901" },
      { equipmentId, meterReading: 1 },
      { equipmentId, lastServicedOn: "2026-08-01" },
    ]) {
      const response = await patchAsset(send("PATCH", forbidden));
      // Those are projections of the ledger. A route that could set them
      // would let the roster disagree with its own history.
      expect(response.status, JSON.stringify(forbidden)).toBe(422);
    }
  });

  it("passes the ledger's backwards-meter refusal through intact", async () => {
    client({
      crm_equipment_events: [
        {
          data: null,
          error: {
            code: "P0001",
            message: "a meter does not run backwards: reading 24000.0 is below the recorded 42000.0",
          },
        },
      ],
    });
    const response = await post(
      send("POST", { equipmentId, kind: "meter_reading", meterReading: 24_000 }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("meter_went_backwards");
    // Both readings survive to the technician. "Something went wrong"
    // would not tell them they typed a transposed digit.
    expect(body.error.message).toContain("24000.0");
    expect(body.error.message).toContain("42000.0");
  });

  it("refuses half a meter reading before the database has to", async () => {
    client({ crm_equipment: [{ data: null, error: null }] });
    const response = await post(
      send("POST", { assetTag: "TRUCK-09", kind: "vehicle", name: "Truck 9", meterReading: 100 }),
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(
      /needs its unit/,
    );
  });

  it("sends the reading's moment with it, so the schema's triple is whole", async () => {
    client({
      crm_equipment: [
        {
          data: {
            id: equipmentId,
            asset_tag: "TRUCK-09",
            kind: "vehicle",
            name: "Truck 9",
            make: null,
            model: null,
            serial_number: null,
            branch_id: null,
            status: "in_service",
            assigned_technician_id: null,
            meter_reading: "100.0",
            meter_unit: "miles",
            meter_read_at: "2026-08-31T00:00:00.000Z",
            service_interval_days: null,
            last_serviced_on: null,
            purchased_on: null,
            retired_on: null,
            notes: null,
            created_at: "2026-08-31T00:00:00.000Z",
            updated_at: "2026-08-31T00:00:00.000Z",
          },
          error: null,
        },
      ],
    });
    const response = await post(
      send("POST", {
        assetTag: "TRUCK-09",
        kind: "vehicle",
        name: "Truck 9",
        meterReading: 100,
        meterUnit: "miles",
      }),
    );
    expect(response.status).toBe(201);
    const inserted = (
      tables.get("crm_equipment") as unknown as { insert: ReturnType<typeof vi.fn> }
    ).insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.meter_reading).toBe(100);
    expect(inserted.meter_unit).toBe("miles");
    expect(typeof inserted.meter_read_at).toBe("string");
  });

  it("leaves the moment null when there is no reading", async () => {
    client({ crm_equipment: [{ data: { id: equipmentId, asset_tag: "SPRAY-12", kind: "sprayer", name: "S", make: null, model: null, serial_number: null, branch_id: null, status: "in_service", assigned_technician_id: null, meter_reading: null, meter_unit: null, meter_read_at: null, service_interval_days: null, last_serviced_on: null, purchased_on: null, retired_on: null, notes: null, created_at: "x", updated_at: "x" }, error: null }] });
    await post(send("POST", { assetTag: "SPRAY-12", kind: "sprayer", name: "Sprayer 12" }));
    const inserted = (
      tables.get("crm_equipment") as unknown as { insert: ReturnType<typeof vi.fn> }
    ).insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.meter_reading).toBeNull();
    expect(inserted.meter_read_at).toBeNull();
  });

  it("turns a duplicate tag and a retired asset into answers, not 500s", async () => {
    client({ crm_equipment: [{ data: null, error: { code: "23505" } }] });
    const duplicate = await post(send("POST", { assetTag: "TRUCK-04", kind: "vehicle", name: "Dup" }));
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { error: { code: string } }).error.code).toBe("asset_tag_taken");

    client({
      crm_equipment_events: [
        { data: null, error: { code: "P0001", message: "that asset is retired" } },
      ],
    });
    const retired = await post(send("POST", { equipmentId, kind: "service" }));
    expect(retired.status).toBe(409);
    expect(((await retired.json()) as { error: { code: string } }).error.code).toBe("equipment_retired");
  });

  it("rejects an assignment with no technician on it", async () => {
    client({
      crm_equipment_events: [
        { data: null, error: { code: "23514", message: "crm_equipment_events_assigned_has_technician" } },
      ],
    });
    const response = await post(send("POST", { equipmentId, kind: "assigned" }));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "equipment_refused",
    );
  });
});
