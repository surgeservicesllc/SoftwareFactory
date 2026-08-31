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

import { GET as readStock, POST as recordMovement } from "@/app/api/services/stock/route";

/**
 * The stock boundary (ADR-213).
 *
 * The behavior suite proves the SQL cannot let a location go negative and
 * cannot let the stock ledger disagree with the compliance log. This file
 * pins what the ROUTE must not undo: a place emptied to zero must not be
 * shown as a holding, a uuid must not reach a technician where a truck tag
 * belongs, and each database refusal must arrive with its own status and
 * the database's own words.
 */

const organizationId = "10000000-0000-4000-8000-0000000f1001";
const userId = "00000000-0000-4000-8000-0000000f1001";
const lotId = "a0000000-0000-4000-8000-0000000f1001";
const depotId = "b0000000-0000-4000-8000-0000000f1001";
const truckId = "c0000000-0000-4000-8000-0000000f1001";

type QueryResult = { data: unknown; error: unknown };

function stubTable(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "in", "eq", "order", "limit"]) builder[method] = vi.fn(chain);
  builder.then = (onFulfilled: (value: QueryResult) => unknown) =>
    Promise.resolve(result).then(onFulfilled);
  return builder;
}

let rpc: ReturnType<typeof vi.fn>;

function client(
  procedures: Record<string, QueryResult>,
  tables: Record<string, QueryResult> = {},
) {
  rpc = vi.fn((name: string) => Promise.resolve(procedures[name] ?? { data: [], error: null }));
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: userId },
    client: {
      rpc,
      from: vi.fn((table: string) => stubTable(tables[table] ?? { data: [], error: null })),
    },
  });
}

const namedPlaces = {
  crm_branches: { data: [{ id: depotId, name: "North Depot" }], error: null },
  crm_equipment: {
    data: [{ id: truckId, asset_tag: "TRUCK-04", name: "Ford Transit" }],
    error: null,
  },
};

function post(body: unknown) {
  return new Request("https://factory.example/api/services/stock", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://factory.example" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reading where the stock is", () => {
  it("names the places rather than handing a technician a uuid", async () => {
    client(
      {
        crm_stock_on_hand: {
          data: [
            { stock_lot_id: lotId, stock_branch_id: depotId, stock_equipment_id: null, stock_quantity: "60.000" },
            { stock_lot_id: lotId, stock_branch_id: null, stock_equipment_id: truckId, stock_quantity: "40.000" },
          ],
          error: null,
        },
      },
      namedPlaces,
    );

    const response = await readStock(new Request("https://factory.example/api/services/stock"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.balances.map((row: { locationLabel: string }) => row.locationLabel))
      .toEqual(["North Depot", "TRUCK-04 · Ford Transit"]);
    expect(body.balances[0].locationKind).toBe("branch");
    expect(body.balances[1].locationKind).toBe("equipment");
    expect(body.counts).toEqual({ locations: 2, lots: 1 });
  });

  it("does not show a place emptied to zero as a holding", async () => {
    client(
      {
        crm_stock_on_hand: {
          data: [
            { stock_lot_id: lotId, stock_branch_id: depotId, stock_equipment_id: null, stock_quantity: "0.000" },
            { stock_lot_id: lotId, stock_branch_id: null, stock_equipment_id: truckId, stock_quantity: "40.000" },
          ],
          error: null,
        },
      },
      namedPlaces,
    );

    const response = await readStock(new Request("https://factory.example/api/services/stock"));
    const body = await response.json();

    // The ledger still remembers the depot; the truck is what holds stock.
    expect(body.balances).toHaveLength(1);
    expect(body.balances[0].locationLabel).toBe("TRUCK-04 · Ford Transit");
  });
});

describe("recording a movement", () => {
  it("records through the locking function and answers with the derived balance", async () => {
    client(
      {
        crm_stock_record_movement: { data: "d0000000-0000-4000-8000-0000000f1001", error: null },
        crm_stock_on_hand: {
          data: [
            { stock_lot_id: lotId, stock_branch_id: null, stock_equipment_id: truckId, stock_quantity: "40.000" },
          ],
          error: null,
        },
      },
      namedPlaces,
    );

    const response = await recordMovement(post({
      lotId, kind: "transfer", quantity: 40, fromBranchId: depotId, toEquipmentId: truckId,
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("crm_stock_record_movement", expect.objectContaining({
      p_lot: lotId, p_kind: "transfer", p_quantity: 40,
      p_from_branch: depotId, p_to_equipment: truckId,
    }));
    expect(body.balances[0].quantity).toBe(40);
  });

  it.each([
    ["that location holds 40.000 fl_oz of this lot; 50.000 cannot be taken from it",
      409, "insufficient_stock"],
    ["that application has already drawn stock; it cannot draw twice",
      409, "application_already_drawn"],
    ["a consumption names the application it served", 422, "consumption_needs_application"],
    ["that application is not recorded against this lot", 409, "application_lot_mismatch"],
    ["the application recorded 12.000 and this movement draws 9.000; they must agree",
      409, "quantity_disagrees"],
    ["no such product lot in this workspace", 404, "lot_not_found"],
  ])("carries back %s as its own status", async (message, status, code) => {
    client({ crm_stock_record_movement: { data: null, error: { message } } });

    const response = await recordMovement(post({
      lotId, kind: "transfer", quantity: 50, fromEquipmentId: truckId, toBranchId: depotId,
    }));
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body.error.code).toBe(code);
    // A dispatcher can act on the database's own sentence.
    expect(body.error.message).toBe(message);
  });

  it("refuses a movement claiming two sources before the database has to", async () => {
    client({});

    const response = await recordMovement(post({
      lotId, kind: "transfer", quantity: 1,
      fromBranchId: depotId, fromEquipmentId: truckId, toBranchId: depotId,
    }));

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a non-positive quantity before the database has to", async () => {
    client({});

    const response = await recordMovement(post({
      lotId, kind: "receipt", quantity: 0, toBranchId: depotId,
    }));

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
});
