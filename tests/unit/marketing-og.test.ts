// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { clampOgText, headlineFontSize, ogAltFor, size, contentType, revalidate } = await import(
  "@/lib/marketing/og"
);
const { MARKETING_PAGES } = await import("@/lib/marketing/content");

const repositoryRoot = resolve(import.meta.dirname, "../..");
const marketingRoot = resolve(repositoryRoot, "app/(marketing)");

/**
 * `solutions` has a content row but no page in this route group: it resolves to
 * the authenticated console dashboard, which is `noindex` and needs no card.
 */
const CONSOLE_OWNED_SLUGS = new Set(["solutions"]);

/** Every marketing route directory, plus the group root for `/`. */
function routeDirectories(): { dir: string; slug: string }[] {
  const nested = readdirSync(marketingRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ dir: resolve(marketingRoot, entry.name), slug: entry.name }));
  return [{ dir: marketingRoot, slug: "home" }, ...nested];
}

describe("card dimensions", () => {
  it("uses the 1.91:1 size both networks expect", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
  });

  it("caches rather than re-rendering per request", () => {
    expect(revalidate).toBeGreaterThan(0);
  });
});

describe("clampOgText", () => {
  it("leaves text that already fits untouched", () => {
    expect(clampOgText("Short enough", 40)).toBe("Short enough");
    expect(clampOgText("exactly-ten", 11)).toBe("exactly-ten");
  });

  it("cuts at a word boundary rather than mid-word", () => {
    expect(clampOgText("Simple, transparent pricing for teams", 24)).toBe("Simple, transparent…");
  });

  it("falls back to a hard cut when there is no usable boundary", () => {
    expect(clampOgText("Supercalifragilisticexpialidocious", 10)).toBe("Supercalif…");
  });

  it("never returns more than the limit plus the ellipsis", () => {
    for (const page of MARKETING_PAGES) {
      const clamped = clampOgText(page.subheadline ?? "", 150);
      expect(clamped.length).toBeLessThanOrEqual(151);
    }
  });

  it("leaves no trailing space before the ellipsis", () => {
    expect(clampOgText("alpha beta gamma", 11)).toBe("alpha beta…");
  });
});

describe("headlineFontSize", () => {
  it("shrinks as the headline grows so it stays inside the card", () => {
    expect(headlineFontSize(20)).toBe(70);
    expect(headlineFontSize(60)).toBe(60);
    expect(headlineFontSize(100)).toBe(52);
  });

  it("is monotonically non-increasing", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let length = 0; length <= 140; length += 4) {
      const current = headlineFontSize(length);
      expect(current).toBeLessThanOrEqual(previous);
      previous = current;
    }
  });

  it("keeps every seeded headline within the card width", () => {
    for (const page of MARKETING_PAGES) {
      const combined = `${page.headline} ${page.headlineAccent ?? ""}`;
      const fontSize = headlineFontSize(combined.length);
      // Two lines are drawn, each at ~0.55em average glyph width in 1056px.
      const longestLine = Math.max(page.headline.length, (page.headlineAccent ?? "").length);
      expect(longestLine * fontSize * 0.55).toBeLessThanOrEqual(1056 * 2);
    }
  });
});

describe("ogAltFor", () => {
  it("gives every seeded page real alt text", () => {
    for (const page of MARKETING_PAGES) {
      expect(ogAltFor(page.slug)).toBe(page.seoTitle);
      expect(ogAltFor(page.slug).length).toBeGreaterThan(0);
    }
  });

  it("still returns something usable for an unknown slug", () => {
    expect(ogAltFor("no-such-page")).toBe("AI Software Factory");
  });
});

describe("marketing route wiring", () => {
  const routes = routeDirectories();

  it("gives every marketing route both an Open Graph and a Twitter card", () => {
    const publicPages = MARKETING_PAGES.filter((page) => !CONSOLE_OWNED_SLUGS.has(page.slug));
    expect(routes.length).toBe(publicPages.length);

    for (const { dir, slug } of routes) {
      const files = readdirSync(dir);
      expect(files, `${slug} needs an opengraph-image`).toContain("opengraph-image.tsx");
      expect(files, `${slug} needs a twitter-image`).toContain("twitter-image.tsx");
    }
  });

  it("points each card at the slug of the page it sits on", () => {
    for (const { dir, slug } of routes) {
      const pageSlug = slug === "home" ? "home" : slug;
      for (const kind of ["opengraph-image.tsx", "twitter-image.tsx"]) {
        const source = readFileSync(resolve(dir, kind), "utf8");
        expect(source, `${slug}/${kind} must render its own page`).toContain(
          `renderMarketingOgImage("${pageSlug}")`,
        );
        expect(source).toContain(`ogAltFor("${pageSlug}")`);
      }
    }
  });

  it("declares revalidate literally, since Next.js cannot follow a re-export", () => {
    for (const { dir, slug } of routes) {
      for (const kind of ["opengraph-image.tsx", "twitter-image.tsx"]) {
        const source = readFileSync(resolve(dir, kind), "utf8");
        expect(source, `${slug}/${kind} must not re-export revalidate`).toMatch(
          /export const revalidate = \d+;/,
        );
        expect(source).not.toMatch(/export \{[^}]*revalidate[^}]*\} from/);
      }
    }
  });
});
