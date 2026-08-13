import { describe, expect, it } from "vitest";

import { MARKETING_PLANS } from "@/lib/marketing/content";
import {
  featuresInGroup,
  formatPlanPrice,
  matrixCell,
  matrixRows,
  topicsOfKind,
  yearlySavingPercent,
  type MarketingFeature,
  type MarketingPricingPlan,
  type MarketingTopic,
} from "@/lib/marketing/types";

const plan = (overrides: Partial<MarketingPricingPlan> = {}): MarketingPricingPlan => ({
  slug: "test",
  name: "Test",
  monthlyPriceCents: 2900,
  yearlyPriceCents: 2320,
  priceNote: "user / month",
  blurb: "A plan.",
  ctaLabel: "Start",
  ctaHref: "/sign-in",
  accent: "violet",
  highlighted: false,
  highlightLabel: null,
  features: [],
  ...overrides,
});

describe("formatPlanPrice", () => {
  it("renders whole dollars without decimals", () => {
    expect(formatPlanPrice(plan(), "monthly")).toBe("$29");
  });

  it("keeps cents when a yearly rate is not a whole dollar", () => {
    expect(formatPlanPrice(plan(), "yearly")).toBe("$23.20");
  });

  it("renders a free plan as $0 rather than blank", () => {
    expect(formatPlanPrice(plan({ monthlyPriceCents: 0, yearlyPriceCents: 0 }), "monthly")).toBe("$0");
  });

  it("renders an unpriced plan as Custom", () => {
    expect(
      formatPlanPrice(plan({ monthlyPriceCents: null, yearlyPriceCents: null }), "monthly"),
    ).toBe("Custom");
  });
});

describe("yearlySavingPercent", () => {
  it("reports the whole-percent saving", () => {
    expect(yearlySavingPercent(plan())).toBe(20);
  });

  it("reports nothing when there is no saving", () => {
    expect(yearlySavingPercent(plan({ yearlyPriceCents: 2900 }))).toBeNull();
    expect(yearlySavingPercent(plan({ monthlyPriceCents: 0, yearlyPriceCents: 0 }))).toBeNull();
    expect(yearlySavingPercent(plan({ monthlyPriceCents: null }))).toBeNull();
  });

  it("never claims a saving when the yearly rate is higher", () => {
    expect(yearlySavingPercent(plan({ yearlyPriceCents: 3500 }))).toBeNull();
  });

  it("matches the advertised saving on the seeded plans", () => {
    const best = MARKETING_PLANS.reduce(
      (highest, entry) => Math.max(highest, yearlySavingPercent(entry) ?? 0),
      0,
    );
    expect(best).toBe(20);
  });
});

describe("comparison matrix", () => {
  const plans = [
    plan({
      slug: "free",
      features: [
        { planSlug: "free", label: "1 User", matrixRow: "Users", matrixValue: "1", included: true },
        { planSlug: "free", label: null, matrixRow: "SLA", matrixValue: null, included: false },
      ],
    }),
    plan({
      slug: "pro",
      features: [
        { planSlug: "pro", label: "25 Users", matrixRow: "Users", matrixValue: "Up to 25", included: true },
        { planSlug: "pro", label: null, matrixRow: "SLA", matrixValue: "99.9%", included: true },
        { planSlug: "pro", label: "SSO", matrixRow: "SSO", matrixValue: null, included: true },
      ],
    }),
  ];

  it("collects distinct rows in declaration order", () => {
    expect(matrixRows(plans)).toEqual(["Users", "SLA", "SSO"]);
  });

  it("returns the cell value when one is set", () => {
    expect(matrixCell(plans[1], "SLA")).toEqual({ included: true, value: "99.9%" });
  });

  it("returns an excluded cell for a row a plan does not declare", () => {
    expect(matrixCell(plans[0], "SSO")).toEqual({ included: false, value: null });
  });

  it("distinguishes a declared-but-excluded row from a missing one", () => {
    expect(matrixCell(plans[0], "SLA")).toEqual({ included: false, value: null });
  });

  it("covers every seeded plan without gaps in the row set", () => {
    const rows = matrixRows(MARKETING_PLANS);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const declared = MARKETING_PLANS.filter((entry) =>
        entry.features.some((feature) => feature.matrixRow === row),
      );
      expect(declared.length, `no plan declares matrix row ${row}`).toBeGreaterThan(0);
    }
  });
});

describe("group filters", () => {
  const features: MarketingFeature[] = [
    { groupKey: "value", title: "A", body: "b", icon: "star", accent: "violet", href: null },
    { groupKey: "pillar", title: "B", body: "b", icon: "star", accent: "violet", href: null },
  ];
  const topics: MarketingTopic[] = [
    { name: "AI", icon: "brain", resourceCount: 1, kind: "topic", href: "/resources" },
    { name: "Devs", icon: "users", resourceCount: 2, kind: "role", href: "/resources" },
  ];

  it("selects only the requested group", () => {
    expect(featuresInGroup(features, "value").map((entry) => entry.title)).toEqual(["A"]);
    expect(featuresInGroup(features, "missing")).toEqual([]);
  });

  it("separates topics from roles", () => {
    expect(topicsOfKind(topics, "topic").map((entry) => entry.name)).toEqual(["AI"]);
    expect(topicsOfKind(topics, "role").map((entry) => entry.name)).toEqual(["Devs"]);
  });
});
