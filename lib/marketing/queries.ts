import "server-only";

import { seedContentForPage } from "@/lib/marketing/content";
import type {
  MarketingContent,
  MarketingFeature,
  MarketingLogo,
  MarketingPage,
  MarketingPlanFeature,
  MarketingPricingPlan,
  MarketingResource,
  MarketingResourceKind,
  MarketingStat,
  MarketingTeamMember,
  MarketingTestimonial,
  MarketingTopic,
} from "@/lib/marketing/types";
import { createSupabaseAnonClient } from "@/lib/supabase/anon";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Published marketing content, read through a Supabase client.
 *
 * Marketing rows are world-readable, so this needs no session — the `anon`
 * SELECT policy applies. It never throws: an unconfigured or unreachable
 * Supabase, or a missing page row, returns the seeded content marked
 * `source: "seed"` so the interface can label it **Demo Data** rather than
 * present seeded copy as live.
 */

const RESOURCE_KINDS: readonly string[] = [
  "guide",
  "template",
  "video",
  "case_study",
  "checklist",
  "documentation",
  "download",
];

function toResourceKind(value: unknown): MarketingResourceKind {
  return RESOURCE_KINDS.includes(value as string)
    ? (value as MarketingResourceKind)
    : "guide";
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type Row = Record<string, unknown>;

/**
 * Minimal structural view of the query builder.
 *
 * PostgREST's generated types recurse deeply enough to trip TypeScript's
 * instantiation limit when the chain is passed through a generic helper. These
 * tables are plain content reads, so a narrow structural type is both cheaper
 * and clearer than threading the full builder generics.
 */
type SelectResult = { data: Row[] | null; error: { message?: string } | null };
type Chain = {
  eq: (column: string, value: string) => Chain;
  order: (column: string, options: { ascending: boolean }) => Chain;
  limit: (count: number) => PromiseLike<SelectResult>;
};
type ContentClient = { from: (table: string) => { select: (columns: string) => Chain } };

async function rowsOf(query: PromiseLike<SelectResult>): Promise<Row[]> {
  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}

function mapPage(row: Row): MarketingPage {
  return {
    slug: text(row.slug),
    eyebrow: nullableText(row.eyebrow),
    headline: text(row.headline),
    headlineAccent: nullableText(row.headline_accent),
    subheadline: nullableText(row.subheadline),
    seoTitle: text(row.seo_title),
    seoDescription: text(row.seo_description),
  };
}

function mapPlans(planRows: Row[], featureRows: Row[]): MarketingPricingPlan[] {
  const featuresByPlan = new Map<string, MarketingPlanFeature[]>();
  for (const row of featureRows) {
    const planSlug = text(row.plan_slug);
    const entry: MarketingPlanFeature = {
      planSlug,
      label: nullableText(row.label),
      matrixRow: nullableText(row.matrix_row),
      matrixValue: nullableText(row.matrix_value),
      included: row.included !== false,
    };
    const existing = featuresByPlan.get(planSlug);
    if (existing) existing.push(entry);
    else featuresByPlan.set(planSlug, [entry]);
  }

  return planRows.map((row) => {
    const slug = text(row.slug);
    return {
      slug,
      name: text(row.name),
      monthlyPriceCents: integerOrNull(row.monthly_price_cents),
      yearlyPriceCents: integerOrNull(row.yearly_price_cents),
      priceNote: nullableText(row.price_note),
      blurb: text(row.blurb),
      ctaLabel: text(row.cta_label),
      ctaHref: text(row.cta_href) || "/auth/sign-up",
      accent: text(row.accent) || "violet",
      highlighted: row.highlighted === true,
      highlightLabel: nullableText(row.highlight_label),
      features: featuresByPlan.get(slug) ?? [],
    };
  });
}

/**
 * Load everything a marketing page renders.
 *
 * Queries run in parallel and each one degrades independently, but a missing
 * page row is treated as "content not deployed" and falls back wholesale, so a
 * page never renders half-live and half-seeded.
 */
export async function getMarketingContent(slug: string): Promise<MarketingContent> {
  return loadMarketingContent(slug, createSupabaseServerClient);
}

/**
 * The same content, read without the caller's session.
 *
 * Marketing copy is published to `anon`, so a session adds nothing — and
 * reading cookies would force every caller to render per request. Social card
 * routes use this so they stay cacheable.
 */
export async function getPublicMarketingContent(slug: string): Promise<MarketingContent> {
  return loadMarketingContent(slug, createSupabaseAnonClient);
}

async function loadMarketingContent(
  slug: string,
  createClient: () => unknown,
): Promise<MarketingContent> {
  const fallback = seedContentForPage(slug);

  let client: unknown;
  try {
    client = await createClient();
  } catch {
    return fallback;
  }

  try {
    const db = client as ContentClient;
    const [
      pageRows, statRows, featureRows, planRows, planFeatureRows,
      resourceRows, topicRows, teamRows, testimonialRows, logoRows,
    ] = await Promise.all([
      rowsOf(db.from("marketing_pages")
        .select("slug,eyebrow,headline,headline_accent,subheadline,seo_title,seo_description")
        .eq("slug", slug).limit(1)),
      rowsOf(db.from("marketing_stats")
        .select("value,label,icon,sort_order")
        .eq("page_slug", slug).order("sort_order", { ascending: true }).limit(24)),
      rowsOf(db.from("marketing_features")
        .select("group_key,title,body,icon,accent,href,sort_order")
        .eq("page_slug", slug).order("sort_order", { ascending: true }).limit(60)),
      rowsOf(db.from("marketing_pricing_plans")
        .select("slug,name,monthly_price_cents,yearly_price_cents,price_note,blurb,cta_label,cta_href,accent,highlighted,highlight_label,sort_order")
        .order("sort_order", { ascending: true }).limit(12)),
      rowsOf(db.from("marketing_plan_features")
        .select("plan_slug,label,matrix_row,matrix_value,included,sort_order")
        .order("sort_order", { ascending: true }).limit(200)),
      rowsOf(db.from("marketing_resources")
        .select("slug,kind,title,summary,read_time,level,href,topic,featured,sort_order")
        .order("sort_order", { ascending: true }).limit(60)),
      rowsOf(db.from("marketing_resource_topics")
        .select("name,icon,resource_count,kind,href,sort_order")
        .order("sort_order", { ascending: true }).limit(40)),
      rowsOf(db.from("marketing_team_members")
        .select("name,role,bio,headshot_url,linkedin_url,twitter_url,sort_order")
        .order("sort_order", { ascending: true }).limit(40)),
      rowsOf(db.from("marketing_testimonials")
        .select("quote,author_name,author_title,avatar_url,page_slug,sort_order")
        .order("sort_order", { ascending: true }).limit(24)),
      rowsOf(db.from("marketing_logos")
        .select("name,wordmark,sort_order")
        .order("sort_order", { ascending: true }).limit(24)),
    ]);

    const page = pageRows[0];
    if (!page) return fallback;

    const plans = mapPlans(planRows, planFeatureRows);

    return {
      source: "supabase",
      page: mapPage(page),
      stats: statRows.map((row): MarketingStat => ({
        value: text(row.value),
        label: text(row.label),
        icon: text(row.icon) || "sparkles",
      })),
      features: featureRows.map((row): MarketingFeature => ({
        groupKey: text(row.group_key),
        title: text(row.title),
        body: text(row.body),
        icon: text(row.icon) || "sparkles",
        accent: text(row.accent) || "violet",
        href: nullableText(row.href),
      })),
      plans,
      resources: resourceRows.map((row): MarketingResource => ({
        slug: text(row.slug),
        kind: toResourceKind(row.kind),
        title: text(row.title),
        summary: text(row.summary),
        readTime: nullableText(row.read_time),
        level: nullableText(row.level),
        href: text(row.href) || "#",
        topic: nullableText(row.topic),
        featured: row.featured === true,
      })),
      topics: topicRows.map((row): MarketingTopic => ({
        name: text(row.name),
        icon: text(row.icon) || "sparkles",
        resourceCount: integerOrNull(row.resource_count) ?? 0,
        kind: row.kind === "role" ? "role" : "topic",
        href: text(row.href) || "/resources",
      })),
      team: teamRows.map((row): MarketingTeamMember => ({
        name: text(row.name),
        role: text(row.role),
        bio: text(row.bio),
        headshotUrl: nullableText(row.headshot_url),
        linkedinUrl: nullableText(row.linkedin_url),
        twitterUrl: nullableText(row.twitter_url),
      })),
      testimonials: testimonialRows
        .map((row): MarketingTestimonial => ({
          quote: text(row.quote),
          authorName: text(row.author_name),
          authorTitle: text(row.author_title),
          avatarUrl: nullableText(row.avatar_url),
          pageSlug: nullableText(row.page_slug),
        }))
        .filter((entry) => entry.pageSlug === null || entry.pageSlug === slug),
      logos: logoRows.map((row): MarketingLogo => ({
        name: text(row.name),
        wordmark: text(row.wordmark),
      })),
    };
  } catch {
    return fallback;
  }
}

/** Page metadata, falling back to the seeded copy when Supabase is unavailable. */
export async function getMarketingMetadata(slug: string) {
  const { page } = await getMarketingContent(slug);
  return {
    title: page?.seoTitle ?? "AI Software Factory",
    description: page?.seoDescription ?? "Build, deploy and scale better software with AI.",
  };
}
