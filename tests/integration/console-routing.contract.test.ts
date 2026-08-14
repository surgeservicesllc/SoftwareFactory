// @vitest-environment node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

/**
 * The control plane lives under /solutions. Three separate files have to agree
 * about that: the route tree, the redirects that keep old links working, and
 * the crawler directives. They drifted apart once already — the sitemap kept
 * advertising /solutions after it stopped being a marketing page and became a
 * noindex console — so the agreement is asserted here rather than assumed.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const consoleRoot = resolve(repositoryRoot, "app/(portal)/solutions");
const marketingRoot = resolve(repositoryRoot, "app/(marketing)");

function consoleRoutes(): string[] {
  return readdirSync(consoleRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Public marketing pages. Their bare paths are not the console's to claim. */
function marketingRoutes(): string[] {
  return readdirSync(marketingRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe("console routing", () => {
  it("serves every console page under /solutions", () => {
    // A page left in the old route group would render without the global
    // navigation, which is the whole point of the move.
    expect(existsSync(resolve(repositoryRoot, "app/(console)"))).toBe(false);
    expect(consoleRoutes().length).toBeGreaterThan(0);
  });

  it("redirects every old top-level console path to its /solutions home", async () => {
    const config = readFileSync(resolve(repositoryRoot, "next.config.ts"), "utf8");

    for (const route of consoleRoutes()) {
      if (marketingRoutes().includes(route)) continue;
      expect(config, `${route} must keep a redirect from its old path`).toContain(`"${route}"`);
    }
  });

  it("never redirects a bare path that a marketing page still serves", () => {
    // `/resources` is a public marketing page *and* a console page name. A
    // redirect list built by walking the console tree would quietly send that
    // public URL to the console with a permanent 308, which browsers and
    // search engines cache. The collision is asserted rather than remembered.
    const config = readFileSync(resolve(repositoryRoot, "next.config.ts"), "utf8");

    for (const route of marketingRoutes()) {
      expect(
        config,
        `/${route} is a marketing page; redirecting it to /solutions/${route} would take it offline`,
      ).not.toContain(`"${route}"`);
    }
  });

  it("still reaches a console page whose bare path belongs to marketing", () => {
    // The console page must exist under /solutions even though nothing
    // redirects to it, or the collision above would silently mean no console
    // page at all.
    for (const route of marketingRoutes()) {
      if (!consoleRoutes().includes(route)) continue;
      expect(existsSync(resolve(consoleRoot, route, "page.tsx"))).toBe(true);
    }
  });

  it("keeps the console out of search results", async () => {
    const directives = await robots();
    const rule = Array.isArray(directives.rules) ? directives.rules[0] : directives.rules;
    const disallow = rule?.disallow;

    expect(Array.isArray(disallow) ? disallow : [disallow]).toContain("/solutions");
  });

  it("never lists a disallowed path in the sitemap", async () => {
    const directives = await robots();
    const rule = Array.isArray(directives.rules) ? directives.rules[0] : directives.rules;
    const raw = rule?.disallow ?? [];
    const disallowed = (Array.isArray(raw) ? raw : [raw]).filter(Boolean) as string[];

    for (const entry of await sitemap()) {
      const path = new URL(entry.url).pathname;
      const conflict = disallowed.find(
        (prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
      );
      expect(conflict, `${path} is in the sitemap but disallowed by ${conflict}`).toBeUndefined();
    }
  });

  it("gives each console page its own title", () => {
    // Without a title the root layout's marketing default applies, and every
    // console tab reads as the public home page.
    for (const route of consoleRoutes()) {
      const source = readFileSync(resolve(consoleRoot, route, "page.tsx"), "utf8");
      expect(source, `${route} must export a metadata title`).toMatch(
        /export const metadata\s*=\s*\{[^}]*title:/,
      );
    }
  });
});
