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

import { POST as createApplication } from "@/app/api/services/applications/route";
import { GET as complianceReport } from "@/app/api/services/compliance/report/route";
import { POST as createProduct } from "@/app/api/services/products/route";

/**
 * The compliance boundaries: the applicator's license is copied from the
 * roster onto the record, a named jurisdiction's configured requirements
 * are enforced before anything is written, the lot's refusal comes back as
 * the caller's problem rather than a server fault, and the report resolves
 * ids into the names an inspector reads — in CSV that a spreadsheet cannot
 * turn into a formula.
 */

const organizationId = "10000000-0000-4000-8000-0000000c0001";
const userId = "00000000-0000-4000-8000-0000000c0001";
const accountId = "20000000-0000-4000-8000-0000000c0001";
const propertyId = "60000000-0000-4000-8000-0000000c0001";
const productId = "d0000000-0000-4000-8000-0000000c0001";
const technicianId = "e0000000-0000-4000-8000-0000000c0001";

type QueryResult = { data: unknown; error: unknown; count?: number };

function stubTable(results: QueryResult[]) {
  let call = 0;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "insert", "update", "eq", "order", "limit", "ilike", "gte", "lte"]) {
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

const applicationRow = {
  id: "f0000000-0000-4000-8000-0000000c0001",
  account_id: accountId,
  property_id: propertyId,
  work_order_id: null,
  product_id: productId,
  lot_id: null,
  device_id: null,
  technician_id: technicianId,
  applicator_license: "OR-PA-44119",
  method: "crack_and_crevice",
  target_pest: "German cockroach",
  quantity: "4.500",
  unit: "oz",
  application_rate: null,
  treated_area: null,
  location_note: null,
  note: null,
  applied_at: "2026-08-30T09:00:00Z",
  recorded_at: "2026-08-30T09:05:00Z",
  supersedes_id: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the application boundary", () => {
  it("copies the applicator's license from the roster onto the record", async () => {
    client({
      crm_technicians: [{ data: { id: technicianId, license_number: "OR-PA-44119", active: true }, error: null }],
      crm_applications: [{ data: applicationRow, error: null }],
    });
    const response = await createApplication(
      post("https://factory.example/api/services/applications", {
        accountId,
        propertyId,
        productId,
        technicianId,
        method: "crack_and_crevice",
        quantity: 4.5,
        unit: "oz",
        targetPest: "German cockroach",
      }),
    );
    expect(response.status).toBe(201);
    const applications = from.mock.results[
      from.mock.calls.findIndex(([table]) => table === "crm_applications")
    ]?.value as { insert: ReturnType<typeof vi.fn> };
    expect(applications.insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: organizationId,
      applicator_license: "OR-PA-44119",
      created_by: userId,
    }));
  });

  it("holds a record to the jurisdiction it names, writing nothing when a field is missing", async () => {
    client({
      crm_technicians: [{ data: { id: technicianId, license_number: null, active: true }, error: null }],
      crm_compliance_rules: [{
        data: {
          jurisdiction: "US-OR",
          label: "Oregon Department of Agriculture",
          requires_applicator_license: true,
          requires_target_pest: true,
          requires_application_rate: false,
          requires_treated_area: false,
          active: true,
        },
        error: null,
      }],
    });
    const response = await createApplication(
      post("https://factory.example/api/services/applications", {
        accountId,
        propertyId,
        productId,
        technicianId,
        method: "bait",
        quantity: 2,
        unit: "oz",
        jurisdiction: "US-OR",
      }),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("jurisdiction_requirements_unmet");
    expect(body.missing).toEqual(["applicator license", "target pest"]);
    expect(from.mock.calls.some(([table]) => table === "crm_applications")).toBe(false);
  });

  it("answers an unconfigured jurisdiction honestly instead of inventing a rule", async () => {
    client({
      crm_technicians: [{ data: { id: technicianId, license_number: "OR-PA-44119", active: true }, error: null }],
      crm_compliance_rules: [{ data: null, error: null }],
    });
    const response = await createApplication(
      post("https://factory.example/api/services/applications", {
        accountId,
        propertyId,
        productId,
        technicianId,
        method: "bait",
        quantity: 2,
        unit: "oz",
        jurisdiction: "US-TX",
      }),
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("jurisdiction_not_configured");
  });

  it("returns the lot's refusal as the caller's to correct", async () => {
    client({
      crm_technicians: [{ data: { id: technicianId, license_number: "OR-PA-44119", active: true }, error: null }],
      crm_applications: [{
        data: null,
        error: { code: "23514", message: "lot holds 3.000 but the application draws 100.000" },
      }],
    });
    const response = await createApplication(
      post("https://factory.example/api/services/applications", {
        accountId,
        propertyId,
        productId,
        technicianId,
        lotId: "c1000000-0000-4000-8000-0000000c0001",
        method: "bait",
        quantity: 100,
        unit: "oz",
      }),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("lot_cannot_supply");
    expect(body.error.message).toContain("does not hold enough");
  });

  it("refuses an unknown technician before writing a record", async () => {
    client({ crm_technicians: [{ data: null, error: null }] });
    const response = await createApplication(
      post("https://factory.example/api/services/applications", {
        accountId,
        propertyId,
        productId,
        technicianId,
        method: "bait",
        quantity: 1,
        unit: "oz",
      }),
    );
    expect(response.status).toBe(404);
    expect(from.mock.calls.some(([table]) => table === "crm_applications")).toBe(false);
  });
});

describe("the product boundary", () => {
  it("refuses an SDS reference that is not https, before the database", async () => {
    client({ crm_products: [{ data: null, error: null }] });
    const response = await createProduct(
      post("https://factory.example/api/services/products", {
        name: "Something",
        sdsUrl: "http://insecure.example/sds.pdf",
      }),
    );
    expect(response.status).toBe(422);
    expect(requireActiveOrganization).not.toHaveBeenCalled();
  });

  it("answers a duplicate EPA registration with an honest 409", async () => {
    client({ crm_products: [{ data: null, error: { code: "23505", message: "dup" } }] });
    const response = await createProduct(
      post("https://factory.example/api/services/products", {
        name: "Duplicate",
        epaRegistrationNumber: "432-1259",
      }),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("epa_number_taken");
  });
});

describe("the compliance report", () => {
  function reportClient() {
    client({
      crm_applications: [{ data: [applicationRow], error: null }],
      crm_accounts: [{ data: [{ id: accountId, name: "Harborlight Foods" }], error: null }],
      crm_properties: [{
        data: [{ id: propertyId, label: "Distribution Center", address: "14 Dock Road" }],
        error: null,
      }],
      crm_products: [{
        data: [{ id: productId, name: "Maxforce FC Select", epa_registration_number: "432-1259" }],
        error: null,
      }],
      crm_product_lots: [{ data: [], error: null }],
      crm_technicians: [{ data: [{ id: technicianId, first_name: "Miguel", last_name: "Santos" }], error: null }],
      crm_devices: [{ data: [], error: null }],
    });
  }

  it("resolves every id into the name an inspector reads", async () => {
    reportClient();
    const response = await complianceReport(
      new Request("https://factory.example/api/services/compliance/report?from=2026-08-01&to=2026-08-31"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.count).toBe(1);
    expect(body.rows[0]).toMatchObject({
      customer: "Harborlight Foods",
      site: "Distribution Center",
      product: "Maxforce FC Select",
      epa_registration_number: "432-1259",
      technician: "Miguel Santos",
      applicator_license: "OR-PA-44119",
      quantity: 4.5,
      unit: "oz",
    });
  });

  it("streams the same rows as CSV, guarded against spreadsheet formulas", async () => {
    client({
      crm_applications: [{
        data: [{ ...applicationRow, note: "=cmd|'/c calc'!A1", target_pest: 'A "quoted" pest' }],
        error: null,
      }],
      crm_accounts: [{ data: [{ id: accountId, name: "Harborlight Foods" }], error: null }],
      crm_properties: [{
        data: [{ id: propertyId, label: "Distribution Center", address: "14 Dock Road" }],
        error: null,
      }],
      crm_products: [{
        data: [{ id: productId, name: "Maxforce FC Select", epa_registration_number: "432-1259" }],
        error: null,
      }],
      crm_product_lots: [{ data: [], error: null }],
      crm_technicians: [{ data: [{ id: technicianId, first_name: "Miguel", last_name: "Santos" }], error: null }],
      crm_devices: [{ data: [], error: null }],
    });
    const response = await complianceReport(
      new Request("https://factory.example/api/services/compliance/report?format=csv"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    const csv = await response.text();
    expect(csv.split("\r\n")[0]).toContain("applied_at,customer,site");
    // The formula is neutralised, and the embedded quotes are doubled.
    expect(csv).toContain(`"'=cmd|'/c calc'!A1"`);
    expect(csv).toContain(`"A ""quoted"" pest"`);
  });
});
