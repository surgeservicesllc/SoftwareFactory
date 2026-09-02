import { describe, expect, it } from "vitest";

import {
  readBps,
  summarizeHygiene,
  toContactHygieneView,
  toForecastScenarioMonthView,
  totalScenario,
} from "@/lib/services/trust";

/**
 * The pure side of trust: an input outside 0–100% is clamped rather than
 * trusted, the scenario's totals are the recorded and applied sums with the
 * difference stated, and the hygiene summary counts reasons in the report's
 * own order with the multi-flagged contacts counted separately.
 */

describe("readBps", () => {
  it("reads a basis-point input, clamps it to 0–100%, and treats nonsense as absent", () => {
    expect(readBps(null)).toBeNull();
    expect(readBps("")).toBeNull();
    expect(readBps("abc")).toBeNull();
    expect(readBps("1200")).toBe(1200);
    expect(readBps("1200.6")).toBe(1201);
    expect(readBps("-5")).toBe(0);
    expect(readBps("25000")).toBe(10_000);
  });
});

describe("totalScenario", () => {
  it("sums both series and states the difference", () => {
    const months = [
      { month: "2026-09-01", months_ahead: 0, recorded_cents: "10000", scenario_cents: "10000", factor_bps: 10000, plans: 1, contracts: 0 },
      { month: "2026-10-01", months_ahead: 1, recorded_cents: "10000", scenario_cents: 9894, factor_bps: 9894, plans: 1, contracts: 0 },
    ].map(toForecastScenarioMonthView);
    expect(months[1]).toMatchObject({ month: "2026-10-01", recordedCents: 10000, scenarioCents: 9894 });
    expect(totalScenario(months)).toEqual({ recordedCents: 20000, scenarioCents: 19894, differenceCents: -106 });
    expect(totalScenario([])).toEqual({ recordedCents: 0, scenarioCents: 0, differenceCents: 0 });
  });
});

describe("summarizeHygiene", () => {
  it("counts each reason in the report's order, labels every flag, and counts the multi-flagged", () => {
    const rows = [
      { contact_id: "c1", account_id: "a1", account_name: "Old Mill", account_status: "inactive", contact_name: "Sam Ortiz", email: "x@y.z", phone: null, is_primary: true, last_touch_at: null, days_since_touch: null, flags: ["undeliverable", "duplicate_email", "inactive_account", "untouched_year"], flag_count: 4 },
      { contact_id: "c2", account_id: "a2", account_name: "Harborview", account_status: "customer", contact_name: "Pat Quinn", email: null, phone: null, is_primary: false, last_touch_at: "2026-04-01T00:00:00Z", days_since_touch: 3, flags: ["unreachable"], flag_count: 1 },
      { contact_id: "c3", account_id: "a2", account_name: "Harborview", account_status: "customer", contact_name: "Dana Reyes", email: "x@y.z", phone: null, is_primary: true, last_touch_at: "2026-04-01T00:00:00Z", days_since_touch: 3, flags: ["duplicate_email", "future_flag"], flag_count: 2 },
    ].map(toContactHygieneView);
    expect(rows[0].labels).toEqual([
      "A notice to this address or number failed",
      "Same email on another contact",
      "Account is inactive",
      "Nothing on the account in a year",
    ]);
    expect(rows[2].labels).toEqual(["Same email on another contact", "future flag"]);
    expect(summarizeHygiene(rows)).toEqual({
      contacts: 3,
      multiFlagged: 2,
      byFlag: [
        { flag: "unreachable", label: "No email and no phone", count: 1 },
        { flag: "undeliverable", label: "A notice to this address or number failed", count: 1 },
        { flag: "duplicate_email", label: "Same email on another contact", count: 2 },
        { flag: "inactive_account", label: "Account is inactive", count: 1 },
        { flag: "untouched_year", label: "Nothing on the account in a year", count: 1 },
        { flag: "future_flag", label: "future flag", count: 1 },
      ],
    });
    expect(summarizeHygiene([])).toEqual({ contacts: 0, byFlag: [], multiFlagged: 0 });
  });
});
