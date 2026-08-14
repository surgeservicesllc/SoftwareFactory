import { describe, expect, it } from "vitest";

import {
  MARKETING_FEATURES,
  MARKETING_LOGOS,
  MARKETING_PAGES,
  MARKETING_PLANS,
  MARKETING_RESOURCES,
  MARKETING_TEAM,
  MARKETING_TESTIMONIALS,
  MARKETING_TOPICS,
  seedContentForPage,
} from "@/lib/marketing/content";

const EXPECTED_SLUGS = [
  "home",
  "platform",
  "features",
  "solutions",
  "pricing",
  "resources",
  "about",
] as const;

describe("seeded marketing pages", () => {
  it("covers every route in the main navigation", () => {
    expect(MARKETING_PAGES.map((page) => page.slug).sort()).toEqual([...EXPECTED_SLUGS].sort());
  });

  it("gives every page usable SEO copy within provider limits", () => {
    for (const page of MARKETING_PAGES) {
      expect(page.slug).toMatch(/^[a-z][a-z0-9-]{0,62}$/);
      expect(page.headline.trim().length).toBeGreaterThan(0);
      expect(page.seoTitle.length).toBeGreaterThan(0);
      expect(page.seoTitle.length).toBeLessThanOrEqual(120);
      expect(page.seoDescription.length).toBeGreaterThan(0);
      expect(page.seoDescription.length).toBeLessThanOrEqual(320);
    }
  });

  it("keeps every seeded string inside its database column bound", () => {
    for (const plan of MARKETING_PLANS) {
      expect(plan.blurb.length).toBeLessThanOrEqual(240);
      expect(plan.ctaHref).toMatch(/^(\/|https:\/\/)/);
    }
    for (const resource of MARKETING_RESOURCES) {
      expect(resource.slug).toMatch(/^[a-z][a-z0-9-]{0,80}$/);
      expect(resource.summary.length).toBeLessThanOrEqual(400);
      expect(resource.href).toMatch(/^(#|\/|https:\/\/)/);
    }
    for (const member of MARKETING_TEAM) {
      expect(member.bio.length).toBeLessThanOrEqual(400);
      if (member.linkedinUrl) expect(member.linkedinUrl).toMatch(/^https:\/\//);
      if (member.twitterUrl) expect(member.twitterUrl).toMatch(/^https:\/\//);
    }
    for (const group of Object.values(MARKETING_FEATURES)) {
      for (const feature of group) {
        expect(feature.title.length).toBeLessThanOrEqual(80);
        expect(feature.body.length).toBeLessThanOrEqual(400);
        expect(feature.icon).toMatch(/^[a-z][a-z0-9-]{0,40}$/);
      }
    }
  });

  it("carries no credential-shaped content", () => {
    const serialized = JSON.stringify({
      MARKETING_PAGES,
      MARKETING_PLANS,
      MARKETING_RESOURCES,
      MARKETING_TEAM,
      MARKETING_TESTIMONIALS,
      MARKETING_TOPICS,
      MARKETING_LOGOS,
      MARKETING_FEATURES,
    });
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
    expect(serialized).not.toMatch(/-----BEGIN/);
    expect(serialized).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("has a unique pricing plan slug per plan", () => {
    const slugs = MARKETING_PLANS.map((plan) => plan.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("marks exactly one plan as the highlighted one", () => {
    expect(MARKETING_PLANS.filter((plan) => plan.highlighted)).toHaveLength(1);
  });
});

describe("seedContentForPage", () => {
  it("always reports the seed as the source so the UI can label it", () => {
    for (const slug of EXPECTED_SLUGS) {
      expect(seedContentForPage(slug).source).toBe("seed");
    }
  });

  it("returns the matching page for a known slug", () => {
    const content = seedContentForPage("about");

    expect(content.page?.slug).toBe("about");
    expect(content.team.length).toBeGreaterThan(0);
    expect(content.logos.length).toBeGreaterThan(0);
    expect(content.features.every((feature) => feature.groupKey === "value")).toBe(true);
  });

  it("returns an empty, non-null shape for an unknown slug", () => {
    const content = seedContentForPage("does-not-exist");

    expect(content.page).toBeNull();
    expect(content.stats).toEqual([]);
    expect(content.features).toEqual([]);
    expect(content.plans).toEqual([]);
    expect(content.team).toEqual([]);
  });

  it("scopes plans, resources and topics to the pages that render them", () => {
    expect(seedContentForPage("pricing").plans.length).toBe(MARKETING_PLANS.length);
    expect(seedContentForPage("about").plans).toEqual([]);
    expect(seedContentForPage("resources").topics.length).toBe(MARKETING_TOPICS.length);
    expect(seedContentForPage("platform").resources).toEqual([]);
  });

  it("returns only the testimonials belonging to the page", () => {
    for (const slug of EXPECTED_SLUGS) {
      for (const testimonial of seedContentForPage(slug).testimonials) {
        expect(testimonial.pageSlug).toBe(slug);
      }
    }
  });

  it("hands back copies rather than the shared seed arrays", () => {
    const first = seedContentForPage("about");
    first.team.pop();

    expect(seedContentForPage("about").team.length).toBe(MARKETING_TEAM.length);
  });
});
