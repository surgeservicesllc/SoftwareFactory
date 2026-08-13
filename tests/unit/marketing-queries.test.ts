// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createSupabaseServerClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));

const { getMarketingContent, getMarketingMetadata } = await import("@/lib/marketing/queries");

type Rows = Record<string, Record<string, unknown>[]>;

/**
 * Stands in for the PostgREST builder: every chain method returns the same
 * object, and awaiting it resolves the rows registered for that table.
 */
function fakeClient(rows: Rows, errorFor: string[] = []) {
  return {
    from(table: string) {
      const result = errorFor.includes(table)
        ? { data: null, error: { message: "boom" } }
        : { data: rows[table] ?? [], error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  };
}

const pageRow = {
  slug: "about",
  eyebrow: "About",
  headline: "We build",
  headline_accent: "the future.",
  subheadline: "A subheadline.",
  seo_title: "About",
  seo_description: "About the company.",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("getMarketingContent", () => {
  it("falls back to the seed when Supabase is not configured", async () => {
    createSupabaseServerClient.mockRejectedValueOnce(new Error("not configured"));

    const content = await getMarketingContent("about");

    expect(content.source).toBe("seed");
    expect(content.page?.slug).toBe("about");
    expect(content.team.length).toBeGreaterThan(0);
  });

  it("falls back rather than throwing when the client blows up mid-query", async () => {
    createSupabaseServerClient.mockResolvedValueOnce({
      from() {
        throw new Error("connection reset");
      },
    });

    await expect(getMarketingContent("pricing")).resolves.toMatchObject({ source: "seed" });
  });

  it("falls back wholesale when the page row is missing, never half-live", async () => {
    createSupabaseServerClient.mockResolvedValueOnce(
      fakeClient({ marketing_pages: [], marketing_team_members: [{ name: "Ghost" }] }),
    );

    const content = await getMarketingContent("about");

    expect(content.source).toBe("seed");
    expect(content.team.map((member) => member.name)).not.toContain("Ghost");
  });

  it("reports Supabase as the source and maps rows when content is deployed", async () => {
    createSupabaseServerClient.mockResolvedValueOnce(
      fakeClient({
        marketing_pages: [pageRow],
        marketing_stats: [{ value: "25K+", label: "Teams", icon: "users" }],
        marketing_features: [
          { group_key: "value", title: "Integrity", body: "We act openly.", icon: "star", accent: "blue", href: null },
        ],
        marketing_team_members: [
          { name: "Ada", role: "CTO", bio: "Builds things.", headshot_url: null, linkedin_url: null, twitter_url: null },
        ],
        marketing_logos: [{ name: "Acme", wordmark: "ACME" }],
      }),
    );

    const content = await getMarketingContent("about");

    expect(content.source).toBe("supabase");
    expect(content.page?.headlineAccent).toBe("the future.");
    expect(content.stats).toEqual([{ value: "25K+", label: "Teams", icon: "users" }]);
    expect(content.features[0]).toMatchObject({ groupKey: "value", accent: "blue", href: null });
    expect(content.team[0].name).toBe("Ada");
    expect(content.logos[0].wordmark).toBe("ACME");
  });

  it("joins plan features onto their plan", async () => {
    createSupabaseServerClient.mockResolvedValueOnce(
      fakeClient({
        marketing_pages: [{ ...pageRow, slug: "pricing" }],
        marketing_pricing_plans: [
          {
            slug: "pro", name: "Pro", monthly_price_cents: 7900, yearly_price_cents: 6320,
            price_note: "user / month", blurb: "For teams.", cta_label: "Start", cta_href: "/sign-in",
            accent: "violet", highlighted: true, highlight_label: "Most Popular",
          },
        ],
        marketing_plan_features: [
          { plan_slug: "pro", label: "Up to 25 Users", matrix_row: "Users", matrix_value: "Up to 25", included: true },
          { plan_slug: "orphan", label: "Ignored", matrix_row: null, matrix_value: null, included: true },
        ],
      }),
    );

    const content = await getMarketingContent("pricing");

    expect(content.plans).toHaveLength(1);
    expect(content.plans[0].highlighted).toBe(true);
    expect(content.plans[0].features).toHaveLength(1);
    expect(content.plans[0].features[0].matrixValue).toBe("Up to 25");
  });

  it("degrades a single failing table to empty without losing the page", async () => {
    createSupabaseServerClient.mockResolvedValueOnce(
      fakeClient({ marketing_pages: [pageRow], marketing_logos: [{ name: "Acme", wordmark: "ACME" }] },
        ["marketing_team_members"]),
    );

    const content = await getMarketingContent("about");

    expect(content.source).toBe("supabase");
    expect(content.team).toEqual([]);
    expect(content.logos).toHaveLength(1);
  });

  it("keeps only testimonials scoped to this page or to no page", async () => {
    createSupabaseServerClient.mockResolvedValueOnce(
      fakeClient({
        marketing_pages: [pageRow],
        marketing_testimonials: [
          { quote: "Mine", author_name: "A", author_title: "X", avatar_url: null, page_slug: "about" },
          { quote: "Global", author_name: "B", author_title: "Y", avatar_url: null, page_slug: null },
          { quote: "Theirs", author_name: "C", author_title: "Z", avatar_url: null, page_slug: "pricing" },
        ],
      }),
    );

    const quotes = (await getMarketingContent("about")).testimonials.map((entry) => entry.quote);

    expect(quotes).toEqual(["Mine", "Global"]);
  });

  it("falls back to a safe resource kind for an unrecognized value", async () => {
    createSupabaseServerClient.mockResolvedValueOnce(
      fakeClient({
        marketing_pages: [{ ...pageRow, slug: "resources" }],
        marketing_resources: [
          { slug: "x", kind: "podcast", title: "T", summary: "S", read_time: null, level: null, href: "#", topic: null, featured: true },
        ],
      }),
    );

    const content = await getMarketingContent("resources");

    expect(content.resources[0].kind).toBe("guide");
  });
});

describe("getMarketingMetadata", () => {
  it("uses the page SEO copy", async () => {
    createSupabaseServerClient.mockRejectedValueOnce(new Error("not configured"));

    const metadata = await getMarketingMetadata("pricing");

    expect(metadata.title).toMatch(/pricing/i);
    expect(metadata.description.length).toBeGreaterThan(0);
  });

  it("still returns usable metadata for an unknown page", async () => {
    createSupabaseServerClient.mockRejectedValueOnce(new Error("not configured"));

    const metadata = await getMarketingMetadata("no-such-page");

    expect(metadata.title).toBe("AI Software Factory");
    expect(metadata.description.length).toBeGreaterThan(0);
  });
});
