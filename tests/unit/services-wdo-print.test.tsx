import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WdoPrintView } from "@/components/services/wdo-print";

/**
 * The printed page carries exactly what the report carries.
 *
 * The cases that matter are the ones a paper copy gets misread over: a
 * draft must announce itself, the areas that could NOT be inspected must
 * print even when empty ("none recorded" is a claim, silence is not),
 * and the diagram's numbered marks must correspond to the findings table.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

const inspection = {
  id: "11111111-1111-4111-8111-111111111111",
  reportNumber: "WDO-2026-0042",
  inspectedOn: "2026-08-12",
  structuresInspected: "Main dwelling and detached garage",
  visibleEvidence: true,
  obstructions: "Stored goods against the garage wall",
  inaccessibleAreas: null,
  recommendation: "Treat the sill plate and correct the grade.",
  diagramKind: "outline",
  status: "draft",
  issuedAt: null,
};

const findings = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    kind: "visible_damage",
    organism: "Subterranean termites",
    area: "Sill plate, north wall",
    positionX: 0.25,
    positionY: 0.5,
    placed: true,
    adverse: true,
    note: "Galleries in the sill.",
    treatmentNote: null,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    kind: "conducive_condition",
    organism: null,
    area: "Grade at the east foundation",
    positionX: null,
    positionY: null,
    placed: false,
    adverse: false,
    note: null,
    treatmentNote: null,
  },
];

function mockFetch(overrides: Partial<typeof inspection> = {}) {
  vi.spyOn(global, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/findings")) {
      return Promise.resolve(jsonResponse({ findings }));
    }
    return Promise.resolve(jsonResponse({ inspections: [{ ...inspection, ...overrides }] }));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the printable WDO report", () => {
  it("prints a draft only under a DRAFT banner", async () => {
    mockFetch();
    render(<WdoPrintView inspectionId={inspection.id} />);
    expect(await screen.findByText("WDO-2026-0042")).toBeInTheDocument();
    expect(screen.getByText(/Draft — not an issued report/)).toBeInTheDocument();
  });

  it("drops the banner once issued, and says the rendering is the browser's", async () => {
    mockFetch({ status: "issued", issuedAt: "2026-08-13T09:00:00Z" });
    render(<WdoPrintView inspectionId={inspection.id} />);
    expect(await screen.findByText("WDO-2026-0042")).toBeInTheDocument();
    expect(screen.queryByText(/Draft — not an issued report/)).not.toBeInTheDocument();
    expect(screen.getByText(/on your machine, not on a server/)).toBeInTheDocument();
  });

  it("prints the inaccessible-areas claim even when there are none, and numbers the diagram to the table", async () => {
    mockFetch();
    render(<WdoPrintView inspectionId={inspection.id} />);
    await screen.findByText("WDO-2026-0042");
    // Absence is a claim, printed as one.
    expect(screen.getByText(/None recorded — every area/)).toBeInTheDocument();
    // The placed finding is row 1 in the table and mark "1" on the diagram;
    // the unplaced one appears in the table only.
    expect(screen.getByText("Visible damage")).toBeInTheDocument();
    expect(screen.getByText("Conducive condition")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Structure diagram with 1 placed finding/ }),
    ).toBeInTheDocument();
  });
});
