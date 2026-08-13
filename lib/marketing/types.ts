/**
 * Wire shapes for published marketing content.
 *
 * Browser-safe: this module holds type definitions only. Every field here is
 * public marketing copy, so nothing in this shape is sensitive.
 */

export type MarketingSource = "supabase" | "seed";

export type MarketingPage = {
  slug: string;
  eyebrow: string | null;
  headline: string;
  headlineAccent: string | null;
  subheadline: string | null;
  seoTitle: string;
  seoDescription: string;
};

export type MarketingStat = {
  value: string;
  label: string;
  icon: string;
};

export type MarketingFeature = {
  groupKey: string;
  title: string;
  body: string;
  icon: string;
  accent: string;
  href: string | null;
};

export type MarketingPricingPlan = {
  slug: string;
  name: string;
  monthlyPriceCents: number | null;
  yearlyPriceCents: number | null;
  priceNote: string | null;
  blurb: string;
  ctaLabel: string;
  ctaHref: string;
  accent: string;
  highlighted: boolean;
  highlightLabel: string | null;
  features: MarketingPlanFeature[];
};

export type MarketingPlanFeature = {
  planSlug: string;
  label: string | null;
  matrixRow: string | null;
  matrixValue: string | null;
  included: boolean;
};

export type MarketingResourceKind =
  | "guide"
  | "template"
  | "video"
  | "case_study"
  | "checklist"
  | "documentation"
  | "download";

export type MarketingResource = {
  slug: string;
  kind: MarketingResourceKind;
  title: string;
  summary: string;
  readTime: string | null;
  level: string | null;
  href: string;
  topic: string | null;
  featured: boolean;
};

export type MarketingTopic = {
  name: string;
  icon: string;
  resourceCount: number;
  kind: "topic" | "role";
  href: string;
};

export type MarketingTeamMember = {
  name: string;
  role: string;
  bio: string;
  headshotUrl: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
};

export type MarketingTestimonial = {
  quote: string;
  authorName: string;
  authorTitle: string;
  avatarUrl: string | null;
  pageSlug: string | null;
};

export type MarketingLogo = {
  name: string;
  wordmark: string;
};

/**
 * Everything a marketing page needs, plus where it came from.
 *
 * `source` exists so the interface can tell the truth: content served from the
 * seeded fallback is labelled **Demo Data**, content read from Supabase is not.
 */
export type MarketingContent = {
  source: MarketingSource;
  page: MarketingPage | null;
  stats: MarketingStat[];
  features: MarketingFeature[];
  plans: MarketingPricingPlan[];
  resources: MarketingResource[];
  topics: MarketingTopic[];
  team: MarketingTeamMember[];
  testimonials: MarketingTestimonial[];
  logos: MarketingLogo[];
};

export function featuresInGroup(
  features: readonly MarketingFeature[],
  groupKey: string,
): MarketingFeature[] {
  return features.filter((feature) => feature.groupKey === groupKey);
}

export function topicsOfKind(
  topics: readonly MarketingTopic[],
  kind: MarketingTopic["kind"],
): MarketingTopic[] {
  return topics.filter((topic) => topic.kind === kind);
}

/** Distinct comparison-matrix rows, in the order the plans declare them. */
export function matrixRows(plans: readonly MarketingPricingPlan[]): string[] {
  const rows: string[] = [];
  for (const plan of plans) {
    for (const feature of plan.features) {
      if (feature.matrixRow && !rows.includes(feature.matrixRow)) {
        rows.push(feature.matrixRow);
      }
    }
  }
  return rows;
}

export function matrixCell(
  plan: MarketingPricingPlan,
  row: string,
): { included: boolean; value: string | null } {
  const feature = plan.features.find((entry) => entry.matrixRow === row);
  if (!feature) return { included: false, value: null };
  return { included: feature.included, value: feature.matrixValue };
}

export function formatPlanPrice(
  plan: MarketingPricingPlan,
  cadence: "monthly" | "yearly",
): string {
  const cents = cadence === "monthly" ? plan.monthlyPriceCents : plan.yearlyPriceCents;
  if (cents === null) return "Custom";
  if (cents === 0) return "$0";
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** Whole-percent saving from paying yearly, or null when there is none. */
export function yearlySavingPercent(plan: MarketingPricingPlan): number | null {
  const { monthlyPriceCents: monthly, yearlyPriceCents: yearly } = plan;
  if (monthly === null || yearly === null || monthly <= 0 || yearly >= monthly) return null;
  return Math.round(((monthly - yearly) / monthly) * 100);
}
