// @vitest-environment node

import { describe, expect, it } from "vitest";

import { toPortalTrendView, type CrmPortalTrendRow } from "@/lib/services/crm";

/**
 * The activity heat map's four states.
 *
 * `crm_portal_device_trend` returns `scans` and `scans_with_count` beside
 * `activity_total` for one reason: a month nobody visited, a month
 * somebody visited without counting, and a month counted at nothing are
 * three different facts, and only the third means the site was clean.
 *
 * A single colour ramp flattens all three into "pale", which is precisely
 * the rounding a compliance binder must not make. This file pins the
 * classification the grid draws from, so a later "simplification" of the
 * cell logic has to delete a test that says why.
 */

type State = "unscanned" | "uncounted" | "zero" | "active";

/** The same rule the panel applies, over the mapped view. */
function classify(cell: ReturnType<typeof toPortalTrendView> | undefined): State {
  if (cell === undefined) return "unscanned";
  if (cell.scansWithCount === 0) return "uncounted";
  return (cell.activityTotal ?? 0) === 0 ? "zero" : "active";
}

function row(overrides: Partial<CrmPortalTrendRow>): CrmPortalTrendRow {
  return {
    month: "2026-08-01",
    device_type: "bait_station",
    scans: 1,
    scans_with_count: 1,
    activity_total: "0",
    stations_flagged: 0,
    ...overrides,
  };
}

describe("the activity heat map's cell states", () => {
  it("treats a month absent from the data as unscanned, never as clean", () => {
    // The function only returns a row where a scan happened, so the months
    // nobody visited are exactly the ones MISSING. A grid rendered from
    // the returned rows alone would silently drop them.
    expect(classify(undefined)).toBe("unscanned");
  });

  it("keeps a scan with no number written down out of the clean state", () => {
    const cell = toPortalTrendView(row({ scans: 4, scans_with_count: 0, activity_total: null }));
    expect(cell.activityTotal).toBeNull();
    expect(cell.scans).toBe(4);
    // Somebody went. Nobody counted. That is not a clean month, and it is
    // not an empty one either.
    expect(classify(cell)).toBe("uncounted");
  });

  it("calls a counted zero clean, because that one actually is", () => {
    const cell = toPortalTrendView(row({ scans: 3, scans_with_count: 3, activity_total: "0" }));
    expect(cell.activityTotal).toBe(0);
    expect(classify(cell)).toBe("zero");
  });

  it("separates real activity from all three of the others", () => {
    const cell = toPortalTrendView(row({ scans: 6, scans_with_count: 6, activity_total: "31" }));
    expect(cell.activityTotal).toBe(31);
    expect(classify(cell)).toBe("active");
  });

  it("gives the three non-active states distinct classifications", () => {
    // The assertion that matters most: no two of these collapse together.
    const states = new Set<State>([
      classify(undefined),
      classify(toPortalTrendView(row({ scans_with_count: 0, activity_total: null }))),
      classify(toPortalTrendView(row({ activity_total: "0" }))),
      classify(toPortalTrendView(row({ activity_total: "9" }))),
    ]);
    expect(states.size).toBe(4);
  });

  it("carries a bigint activity total across as a number, not a string", () => {
    // PostgREST sends bigint as text; a grid shading by it would otherwise
    // compare strings and order 9 above 31.
    const cell = toPortalTrendView(row({ scans_with_count: 2, activity_total: "310" }));
    expect(cell.activityTotal).toBe(310);
    expect(typeof cell.activityTotal).toBe("number");
  });
});
