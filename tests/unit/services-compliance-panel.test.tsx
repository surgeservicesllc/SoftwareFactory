import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServicesCompliancePanel } from "@/components/services/compliance-panel";

/**
 * Chemicals and compliance as a person works it: the catalogue and its
 * lots render live, the audit report runs against the real route and
 * offers the same rows as a CSV download, and recording an application
 * posts the exact body — including the jurisdiction it is held to.
 */

const productId = "d0000000-0000-4000-8000-0000000c0001";
const accountId = "20000000-0000-4000-8000-0000000c0001";
const propertyId = "60000000-0000-4000-8000-0000000c0001";
const technicianId = "e0000000-0000-4000-8000-0000000c0001";

const productsPayload = {
  products: [
    {
      id: productId,
      name: "Demo Gel Bait (fipronil)",
      epaRegistrationNumber: "90001-101",
      activeIngredient: "Fipronil 0.05%",
      signalWord: "CAUTION",
      sdsUrl: "https://example.test/sds.pdf",
      labelUrl: null,
      restrictedUse: false,
      defaultUnit: "oz",
      active: true,
      createdAt: "2026-08-30T10:00:00Z",
      updatedAt: "2026-08-30T10:00:00Z",
    },
  ],
  lots: [
    {
      id: "c1000000-0000-4000-8000-0000000c0001",
      productId,
      lotNumber: "DEMO-LOT-2026-04",
      unit: "oz",
      quantityReceived: 60,
      quantityRemaining: 55.5,
      receivedOn: "2026-05-01",
      expiresOn: "2027-11-01",
      createdAt: "2026-05-01T10:00:00Z",
      updatedAt: "2026-08-30T10:00:00Z",
    },
  ],
};

const rulesPayload = {
  rules: [
    {
      id: "r1000000-0000-4000-8000-0000000c0001",
      jurisdiction: "US-OR",
      label: "Oregon Department of Agriculture (Demo Data)",
      retentionYears: 3,
      requiresApplicatorLicense: true,
      requiresTargetPest: true,
      requiresApplicationRate: false,
      requiresTreatedArea: false,
      notes: null,
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

const techniciansPayload = {
  technicians: [
    {
      id: technicianId,
      firstName: "Miguel",
      lastName: "Santos",
      email: null,
      phone: null,
      licenseNumber: "DEMO-APP-10482",
      active: true,
      createdAt: "2026-08-30T10:00:00Z",
      updatedAt: "2026-08-30T10:00:00Z",
    },
  ],
};

const detailPayload = {
  account: accountsPayload.accounts[0],
  contacts: [],
  properties: [
    {
      id: propertyId,
      accountId,
      label: "Distribution Center",
      address: "14 Dock Road",
      propertyType: "warehouse",
      accessNotes: null,
      createdAt: "2026-08-30T10:00:00Z",
    },
  ],
  opportunities: [],
  timeline: [],
  timelineTruncated: false,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function serve(onWrite?: (url: string, init: RequestInit) => Response | null) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET" && onWrite) {
      const handled = onWrite(url, init);
      if (handled) return Promise.resolve(handled);
    }
    if (url.startsWith("/api/services/products")) return Promise.resolve(json(productsPayload));
    if (url.startsWith("/api/services/applications")) return Promise.resolve(json({ applications: [] }));
    if (url.startsWith("/api/services/compliance/rules")) return Promise.resolve(json(rulesPayload));
    if (url.startsWith("/api/services/compliance/report")) {
      return Promise.resolve(json({
        rows: [
          {
            applied_at: "2026-08-12T09:00:00Z",
            customer: "Harborlight Foods Distribution",
            site: "Distribution Center",
            address: "14 Dock Road",
            product: "Demo Gel Bait (fipronil)",
            epa_registration_number: "90001-101",
            lot_number: "DEMO-LOT-2026-04",
            device: null,
            device_barcode: null,
            technician: "Miguel Santos",
            applicator_license: "DEMO-APP-10482",
            method: "crack_and_crevice",
            target_pest: "German cockroach",
            quantity: 2.5,
            unit: "oz",
            application_rate: null,
            treated_area: null,
            location: null,
            note: null,
            supersedes: null,
          },
        ],
        count: 1,
        truncated: false,
      }));
    }
    if (url.startsWith("/api/services/technicians")) return Promise.resolve(json(techniciansPayload));
    if (url.startsWith("/api/services/accounts/")) return Promise.resolve(json(detailPayload));
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

describe("the compliance panel", () => {
  it("renders the catalogue with its lots and the jurisdiction rules", async () => {
    serve();
    render(<ServicesCompliancePanel />);

    const products = await screen.findByTestId("services-products");
    expect(within(products).getByText("Demo Gel Bait (fipronil)")).toBeInTheDocument();
    expect(within(products).getByText("EPA 90001-101 · Fipronil 0.05%")).toBeInTheDocument();
    expect(within(products).getByText("55.5 of 60 oz left")).toBeInTheDocument();
    expect(within(products).getByRole("link", { name: "SDS" })).toHaveAttribute(
      "href",
      "https://example.test/sds.pdf",
    );

    const rules = screen.getByTestId("services-rules");
    expect(within(rules).getByText("US-OR")).toBeInTheDocument();
    expect(rules.textContent).toContain("Retain 3 years");
    expect(rules.textContent).toContain("applicator license, target pest");
  });

  it("runs the audit report and offers the same window as a CSV download", async () => {
    serve();
    const user = userEvent.setup();
    render(<ServicesCompliancePanel />);
    await screen.findByTestId("services-products");

    await user.type(screen.getByLabelText("From"), "2026-08-01");
    await user.type(screen.getByLabelText("To"), "2026-08-31");
    await user.click(screen.getByRole("button", { name: "Run report" }));

    const table = await screen.findByTestId("services-report-table");
    expect(within(table).getByText("Harborlight Foods Distribution")).toBeInTheDocument();
    expect(within(table).getByText("EPA 90001-101")).toBeInTheDocument();
    expect(within(table).getByText("DEMO-APP-10482")).toBeInTheDocument();

    // The CSV link carries the same window the table was built from.
    const csv = screen.getByRole("link", { name: /CSV/ });
    expect(csv).toHaveAttribute(
      "href",
      "/api/services/compliance/report?from=2026-08-01&to=2026-08-31&format=csv",
    );
  });

  it("records an application through the real route, held to its jurisdiction", async () => {
    let posted: unknown = null;
    serve((url, init) => {
      if (url === "/api/services/applications" && init.method === "POST") {
        posted = JSON.parse(init.body as string);
        return json({ application: { id: "f1" } }, 201);
      }
      return null;
    });
    const user = userEvent.setup();
    render(<ServicesCompliancePanel />);
    await screen.findByTestId("services-products");

    await user.click(screen.getByRole("button", { name: "Record application" }));
    await user.selectOptions(screen.getByLabelText("Account"), accountId);
    await user.selectOptions(await screen.findByLabelText("Property"), propertyId);
    await user.selectOptions(screen.getByLabelText("Technician"), technicianId);
    await user.selectOptions(screen.getByLabelText("Product"), productId);
    await user.selectOptions(screen.getByLabelText("Method"), "crack_and_crevice");
    await user.type(screen.getByLabelText("Quantity"), "2.5");
    await user.type(screen.getByLabelText("Target pest"), "German cockroach");
    await user.selectOptions(screen.getByLabelText("Hold to jurisdiction"), "US-OR");
    await user.click(screen.getByRole("button", { name: "Record application" }));

    expect(posted).toMatchObject({
      accountId,
      propertyId,
      productId,
      technicianId,
      method: "crack_and_crevice",
      quantity: 2.5,
      unit: "oz",
      targetPest: "German cockroach",
      jurisdiction: "US-OR",
    });
  });
});
