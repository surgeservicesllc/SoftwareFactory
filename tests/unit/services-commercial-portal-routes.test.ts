// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAuthenticatedUser } = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/auth")>()),
  requireAuthenticatedUser,
}));

import { GET as sites } from "@/app/api/customer-portal/sites/route";
import { GET as stations } from "@/app/api/customer-portal/stations/route";
import { GET as conditions, POST as report } from "@/app/api/customer-portal/conditions/route";
import { GET as compliance } from "@/app/api/customer-portal/compliance/route";

/**
 * The commercial portal boundary.
 *
 * The behavior suite proves the SQL shows one account and refuses to
 * invent a reading. This file pins what the ROUTES must not undo on the
 * way to JSON: a null activity total must not become 0, a station nobody
 * scanned must not be counted as clear, the trend window must be bounded
 * before it becomes a scan, and the database's refusal of somebody else's
 * site must reach the customer as an answer rather than a 500.
 */

const portalUserId = "30000000-0000-4000-8000-0000000e0001";
const accountId = "20000000-0000-4000-8000-0000000e0001";
const organizationId = "10000000-0000-4000-8000-0000000e0001";
const plantSite = "40000000-0000-4000-8000-0000000e0001";

let rpc: ReturnType<typeof vi.fn>;

const me = {
  data: [
    {
      organization_id: organizationId,
      account_id: accountId,
      portal_user_id: portalUserId,
      role: "viewer",
    },
  ],
  error: null,
};

function client(responses: Record<string, { data: unknown; error: unknown }>) {
  rpc = vi.fn((name: string) =>
    Promise.resolve(responses[name] ?? { data: [], error: null }),
  );
  requireAuthenticatedUser.mockResolvedValue({
    user: { id: "00000000-0000-4000-8000-0000000e0001" },
    client: { rpc },
  });
}

const emptyBook = {
  crm_portal_me: me,
  crm_portal_sites: { data: [], error: null },
  crm_portal_devices: { data: [], error: null },
  crm_portal_device_trend: { data: [], error: null },
  crm_portal_conditions: { data: [], error: null },
  crm_portal_safety_library: { data: [], error: null },
  crm_portal_inspections: { data: [], error: null },
};

function ask(url: string) {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the commercial portal routes", () => {
  it("counts sites with nothing on the calendar rather than leaving it to be spotted", async () => {
    client({
      ...emptyBook,
      crm_portal_sites: {
        data: [
          {
            id: plantSite,
            label: "Harborview Plant",
            address: "4100 Cannery Row",
            property_type: "food processing",
            active_devices: 12,
            open_sightings: 2,
            last_visit_at: "2026-08-20T10:00:00Z",
            next_visit_at: "2026-09-20T10:00:00Z",
          },
          {
            id: "40000000-0000-4000-8000-0000000e0002",
            label: "Harborview Depot",
            address: "9 Dockside Way",
            property_type: null,
            active_devices: 3,
            open_sightings: 0,
            last_visit_at: null,
            next_visit_at: null,
          },
        ],
        error: null,
      },
    });

    const body = (await (await sites()).json()) as {
      sites: { lastVisitAt: string | null; nextVisitAt: string | null }[];
      counts: Record<string, number>;
    };

    expect(body.counts.total).toBe(2);
    expect(body.counts.activeDevices).toBe(15);
    expect(body.counts.openSightings).toBe(2);
    expect(body.counts.withoutNextVisit).toBe(1);
    // Never visited is not a date at the beginning of time.
    expect(body.sites[1].lastVisitAt).toBeNull();
    expect(body.sites[1].nextVisitAt).toBeNull();
  });

  it("keeps a station nobody could read out of the clear column", async () => {
    client({
      ...emptyBook,
      crm_portal_devices: {
        data: [
          {
            id: "50000000-0000-4000-8000-0000000e0001",
            property_id: plantSite,
            property_label: "Harborview Plant",
            label: "RB-01",
            barcode: "HV-RB-0001",
            device_type: "bait_station",
            status: "active",
            location_note: null,
            activity_threshold: 5,
            installed_at: "2025-01-01T00:00:00Z",
            last_service_at: "2026-08-26T00:00:00Z",
            last_condition: "ok",
            last_activity_count: 9,
            last_pest_observed: "Norway rat",
            over_threshold: true,
          },
          {
            // Scanned, but nobody wrote a number down.
            id: "50000000-0000-4000-8000-0000000e0002",
            property_id: plantSite,
            property_label: "Harborview Plant",
            label: "ILT-02",
            barcode: "HV-ILT-0002",
            device_type: "insect_light_trap",
            status: "active",
            location_note: null,
            activity_threshold: 10,
            installed_at: "2025-01-01T00:00:00Z",
            last_service_at: "2026-08-25T00:00:00Z",
            last_condition: "ok",
            last_activity_count: null,
            last_pest_observed: null,
            over_threshold: null,
          },
          {
            // Never scanned at all.
            id: "50000000-0000-4000-8000-0000000e0003",
            property_id: plantSite,
            property_label: "Harborview Plant",
            label: "MC-03",
            barcode: "HV-MC-0003",
            device_type: "multi_catch",
            status: "active",
            location_note: null,
            activity_threshold: null,
            installed_at: "2026-08-01T00:00:00Z",
            last_service_at: null,
            last_condition: null,
            last_activity_count: null,
            last_pest_observed: null,
            over_threshold: null,
          },
        ],
        error: null,
      },
    });

    const body = (await (
      await stations(ask("https://factory.example/api/customer-portal/stations"))
    ).json()) as {
      counts: Record<string, number>;
      stations: { everScanned: boolean; counted: boolean; overThreshold: boolean | null }[];
    };

    expect(body.counts.total).toBe(3);
    expect(body.counts.flagged).toBe(1);
    // Two stations answer nothing. Neither is clear.
    expect(body.counts.unknown).toBe(2);
    expect(body.counts.clear).toBe(0);
    expect(body.stations[1].counted).toBe(false);
    expect(body.stations[1].overThreshold).toBeNull();
    expect(body.stations[2].everScanned).toBe(false);
  });

  it("carries a null activity total to JSON as null, beside the scans that produced it", async () => {
    client({
      ...emptyBook,
      crm_portal_device_trend: {
        data: [
          {
            month: "2026-08-01",
            device_type: "insect_light_trap",
            scans: 4,
            scans_with_count: 0,
            activity_total: null,
            stations_flagged: 0,
          },
          {
            month: "2026-08-01",
            device_type: "bait_station",
            scans: 6,
            scans_with_count: 6,
            activity_total: "31",
            stations_flagged: 2,
          },
        ],
        error: null,
      },
    });

    const body = (await (
      await stations(ask("https://factory.example/api/customer-portal/stations"))
    ).json()) as { trend: { activityTotal: number | null; scans: number }[] };

    // Four scans happened and none carried a number. The cell says both,
    // and the total is not 0.
    expect(body.trend[0].activityTotal).toBeNull();
    expect(body.trend[0].scans).toBe(4);
    expect(body.trend[1].activityTotal).toBe(31);
  });

  it("bounds the trend window and the property filter before either reaches SQL", async () => {
    client(emptyBook);
    await stations(ask("https://factory.example/api/customer-portal/stations"));
    expect(rpc).toHaveBeenCalledWith("crm_portal_device_trend", {
      p_months: 12,
      p_property_id: null,
    });

    client(emptyBook);
    const refused = await stations(
      ask("https://factory.example/api/customer-portal/stations?months=400"),
    );
    expect(refused.status).toBe(422);

    client(emptyBook);
    const badProperty = await stations(
      ask("https://factory.example/api/customer-portal/stations?propertyId=not-a-uuid"),
    );
    expect(badProperty.status).toBe(422);

    client(emptyBook);
    await stations(
      ask(`https://factory.example/api/customer-portal/stations?propertyId=${plantSite}&months=6`),
    );
    // The same filter reaches BOTH reads. Letting the table narrow while
    // the trend stayed wide would put two different questions on one page.
    expect(rpc).toHaveBeenCalledWith("crm_portal_devices", { p_property_id: plantSite });
    expect(rpc).toHaveBeenCalledWith("crm_portal_device_trend", {
      p_months: 6,
      p_property_id: plantSite,
    });
  });

  it("separates the customer's own reports from what a technician observed", async () => {
    client({
      ...emptyBook,
      crm_portal_conditions: {
        data: [
          {
            kind: "sighting",
            source_id: "60000000-0000-4000-8000-0000000e0001",
            property_id: plantSite,
            property_label: "Harborview Plant",
            headline: "German cockroach",
            detail: "Prep line drain",
            severity: "high",
            observed_at: "2026-08-28T06:00:00Z",
            reported_by_customer: true,
          },
          {
            kind: "device",
            source_id: "50000000-0000-4000-8000-0000000e0001",
            property_id: plantSite,
            property_label: "Harborview Plant",
            headline: "RB-01",
            detail: "Activity 9 at or above the threshold of 5",
            severity: "moderate",
            observed_at: "2026-08-26T00:00:00Z",
            reported_by_customer: false,
          },
        ],
        error: null,
      },
    });

    const body = (await (await conditions()).json()) as { counts: Record<string, number> };
    expect(body.counts.total).toBe(2);
    expect(body.counts.sightings).toBe(1);
    expect(body.counts.stations).toBe(1);
    expect(body.counts.high).toBe(1);
    expect(body.counts.reportedByCustomer).toBe(1);
  });

  it("names the products applied here that have no safety sheet on file", async () => {
    client({
      ...emptyBook,
      crm_portal_safety_library: {
        data: [
          {
            product_id: "70000000-0000-4000-8000-0000000e0001",
            name: "Contrac Blox",
            epa_registration_number: "90001-1",
            active_ingredient: "Bromadiolone",
            signal_word: "CAUTION",
            restricted_use: false,
            sds_url: "https://labels.example/contrac-sds.pdf",
            label_url: null,
            applications: 4,
            last_applied_at: "2026-08-26T00:00:00Z",
          },
          {
            product_id: "70000000-0000-4000-8000-0000000e0002",
            name: "Alpine WSG",
            epa_registration_number: null,
            active_ingredient: null,
            signal_word: null,
            restricted_use: true,
            sds_url: null,
            label_url: null,
            applications: 1,
            last_applied_at: "2026-07-02T00:00:00Z",
          },
        ],
        error: null,
      },
      crm_portal_inspections: {
        data: [
          {
            id: "80000000-0000-4000-8000-0000000e0001",
            template_name: "Quarterly AIB Inspection",
            template_kind: "inspection",
            property_id: plantSite,
            property_label: "Harborview Plant",
            completed_at: "2026-08-01T00:00:00Z",
            signed_by_name: "M. Okonkwo",
            signed_at: "2026-08-01T00:00:00Z",
            has_signature: true,
            notes: null,
          },
        ],
        error: null,
      },
    });

    const body = (await (await compliance()).json()) as {
      products: { sdsUrl: string | null }[];
      counts: Record<string, number>;
    };

    expect(body.counts.products).toBe(2);
    expect(body.counts.restricted).toBe(1);
    // The gap is counted, not hidden. An auditor finds it either way.
    expect(body.counts.missingSds).toBe(1);
    expect(body.products[1].sdsUrl).toBeNull();
    expect(body.counts.inspections).toBe(1);
    expect(body.counts.signed).toBe(1);
  });

  it("turns the database's refusal of another account's site into the customer's answer", async () => {
    client({
      ...emptyBook,
      crm_portal_report_sighting: {
        data: null,
        error: { code: "23514", message: "that site is not on this account" },
      },
    });

    const response = await report(
      new Request("https://factory.example/api/customer-portal/conditions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://factory.example",
        },
        body: JSON.stringify({ propertyId: plantSite, pest: "Fruit fly" }),
      }),
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("property_not_on_account");
  });

  it("refuses a sighting with no site named, before it reaches the database", async () => {
    client(emptyBook);
    const response = await report(
      new Request("https://factory.example/api/customer-portal/conditions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://factory.example",
        },
        body: JSON.stringify({ pest: "Fruit fly" }),
      }),
    );

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalledWith("crm_portal_report_sighting", expect.anything());
  });

  it("gives a caller with no portal link nothing, on every commercial read", async () => {
    for (const call of [
      () => sites(),
      () => stations(ask("https://factory.example/api/customer-portal/stations")),
      () => conditions(),
      () => compliance(),
    ]) {
      client({ ...emptyBook, crm_portal_me: { data: [], error: null } });
      const response = await call();
      expect(response.status).toBe(403);
    }
  });
});
