// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every route and every component is measured by something.
 *
 * The browser suites measure a lot; what they could not tell you is whether
 * they measure *everything*. Coverage asserted in prose drifts the moment
 * somebody adds a page — and it did, repeatedly, which is why this exists.
 *
 * Two claims, both derived rather than listed:
 *
 *   Every `page.tsx` under `app/` appears in a width sweep.
 *   Every component under `components/` is reachable from a harness case, so
 *   its layout is measured at all eight widths inside a real browser.
 *
 * Reachability is transitive: a component does not need its own case, it needs
 * to be rendered by one. That is what makes this exhaustive rather than a
 * second list to maintain.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  }));
  return nested.flat();
}

/** `app/(portal)/solutions/runs/page.tsx` → `/solutions/runs`. */
function routeFor(file: string): string {
  const relative = file.slice(resolve(repositoryRoot, "app").length).replace(/\/page\.tsx$/, "");
  const path = relative
    .split("/")
    .filter((segment) => segment && !/^\(.+\)$/.test(segment))
    .join("/");
  return `/${path}`;
}

const IMPORT = /(?:from|import)\s+["']([^"']+)["']/g;

async function readIfPresent(path: string): Promise<string | null> {
  for (const candidate of [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`, `${path}/index.tsx`]) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

async function reachableFrom(entries: string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  const queue = [...entries];

  while (queue.length > 0) {
    const current = queue.pop()!;
    const resolved = [current, `${current}.tsx`, `${current}.ts`].find((candidate) =>
      candidate.endsWith(".tsx") || candidate.endsWith(".ts"));
    const key = resolved ?? current;
    if (seen.has(key)) continue;

    const source = await readIfPresent(current);
    if (source === null) continue;
    seen.add(key);

    for (const match of source.matchAll(IMPORT)) {
      const specifier = match[1];
      if (specifier.startsWith("@/")) queue.push(resolve(repositoryRoot, specifier.slice(2)));
      else if (specifier.startsWith(".")) queue.push(resolve(dirname(current), specifier));
    }
  }

  return seen;
}

describe("every route is swept at every supported width", () => {
  it("leaves no page out of the width sweep", async () => {
    const pages = (await walk(resolve(repositoryRoot, "app")))
      .filter((file) => file.endsWith("/page.tsx"));
    const routes = pages.map(routeFor);
    expect(routes.length).toBeGreaterThan(20);

    const sweeps = await Promise.all([
      readFile(resolve(repositoryRoot, "tests/e2e/responsive.spec.ts"), "utf8"),
      readFile(resolve(repositoryRoot, "tests/e2e/pages.spec.ts"), "utf8"),
      readFile(resolve(repositoryRoot, "tests/e2e/marketing.spec.ts"), "utf8"),
    ]);
    const measured = sweeps.join("\n");

    /*
     * `/sign-in` redirects and `/solutions/[id]`-shaped routes are swept with
     * a concrete id, so match the dynamic ones by their static prefix.
     */
    /** Routes with no layout: a bare redirect has nothing to lay out. */
    const REDIRECT_ONLY = new Set(["/sign-in"]);

    const missing = routes.filter((route) => {
      if (REDIRECT_ONLY.has(route)) return false;
      const dynamic = route.replace(/\/\[[^\]]+\]/g, "");
      return !measured.includes(`"${route}"`) && !measured.includes(`"${dynamic}`);
    });

    expect(
      missing,
      "these routes are in no width sweep. Add them to tests/e2e/responsive.spec.ts:\n"
        + missing.join("\n"),
    ).toEqual([]);
  });
});

describe("every component's layout is measured in a browser", () => {
  it("leaves no component unreachable from a harness case", async () => {
    const harness = await readFile(resolve(repositoryRoot, "tests/harness/main.tsx"), "utf8");

    /*
     * Two ways to be measured, and both are real.
     *
     * A harness case renders the component directly at all eight widths. But
     * the marketing and authentication pages render *fully* without a session,
     * so the route sweep already lays out everything on them — asking those
     * components for a harness case as well would be a second measurement of
     * the same pixels. The console pages are the ones that gate, which is why
     * their components need the harness.
     */
    const fullyRenderedPages = (await walk(resolve(repositoryRoot, "app")))
      .filter((file) => file.endsWith("/page.tsx"))
      .filter((file) => !file.includes("/solutions/"));

    // Layouts render on every route in their group, so the header and footer
    // are laid out by every sweep — they are reached through a layout rather
    // than a page, which is a distinction only this walk cares about.
    const layouts = (await walk(resolve(repositoryRoot, "app")))
      .filter((file) => file.endsWith("/layout.tsx"));

    const reachable = await reachableFrom([
      resolve(repositoryRoot, "tests/harness/main.tsx"),
      ...fullyRenderedPages,
      ...layouts,
    ]);

    const components = (await walk(resolve(repositoryRoot, "components")))
      .filter((file) => file.endsWith(".tsx"));
    expect(components.length).toBeGreaterThan(30);

    /** Components that render no layout, so there is nothing to measure. */
    const RENDERS_NOTHING = new Set([
      "components/service-worker-registrar.tsx",
      // An async server component: it cannot mount in a client-side harness,
      // and it renders server-side on /solutions/connections, which the route
      // sweep measures at every width.
      "components/auth-readiness-notice.tsx",
    ]);

    const unmeasured = components
      .filter((file) => !reachable.has(file))
      .map((file) => file.slice(repositoryRoot.length + 1))
      .filter((relative) => !RENDERS_NOTHING.has(relative));

    expect(
      unmeasured,
      "these components are rendered by no harness case, so their layout is "
        + "measured at no width. Add a case to tests/harness/main.tsx, or render "
        + "them from one that exists:\n" + unmeasured.join("\n"),
    ).toEqual([]);

    // And the harness must actually be wired into the spec that measures it.
    const spec = await readFile(resolve(repositoryRoot, "tests/e2e/component-layout.spec.ts"), "utf8");
    for (const name of harness.matchAll(/^\s{2}"?([a-z-]+)"?:\s*\(\)\s*=>/gm)) {
      expect(spec, `harness case "${name[1]}" is never measured`).toContain(`"${name[1]}"`);
    }
  });
});
