// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

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
  const relativePath = relative(resolve(repositoryRoot, "app"), file)
    .replaceAll("\\", "/")
    .replace(/(^|\/)page\.tsx$/, "");
  const path = relativePath
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
      .filter((file) => /[\\/]page\.tsx$/.test(file));
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
    /**
     * Routes with no layout: a bare redirect has nothing to lay out.
     *
     * `/sign-in` is one. The `/job-seeker` subtree and `/decision` are the
     * others: both are hard-gated in the page or layout, so signed out — which
     * is how the sweep runs — they redirect, and the redirect is asserted by
     * its own case. Adding them to the overflow sweep does not measure them;
     * it navigates away mid-`evaluate` and destroys the execution context,
     * which is what happened when they were listed there. The populated
     * layouts are measured through the harness cases named "job-seeker-*",
     * and for the chooser through "decision-products" and
     * "decision-overview".
     */
    const REDIRECT_ONLY = new Set(["/sign-in"]);
    /*
     * `/JobSearch` and its legacy `/Job-Search` alias are gated destinations
     * like the subtrees below them, but each is a single route rather than a
     * root with children, so both are named
     * rather than prefix-matched. Signed out it only redirects, and measuring
     * a page that navigates away mid-measure destroyed the evaluation context
     * on runs 96276312872/96276312910. Its signed-in layout is the same
     * JobSearchPanel the harness already measures at all eight widths, and
     * responsive.spec.ts proves the redirect.
     */
    const GATED_SUBTREES = ["/job-seeker", "/decision", "/JobSearch", "/Job-Search"];

    const missing = routes.filter((route) => {
      if (REDIRECT_ONLY.has(route)) return false;
      if (GATED_SUBTREES.some((root) => route === root || route.startsWith(`${root}/`))) {
        return false;
      }
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
      .filter((file) => /[\\/]page\.tsx$/.test(file))
      .filter((file) => !file.replaceAll("\\", "/").includes("/solutions/"));

    // Layouts render on every route in their group, so the header and footer
    // are laid out by every sweep — they are reached through a layout rather
    // than a page, which is a distinction only this walk cares about.
    const layouts = (await walk(resolve(repositoryRoot, "app")))
      .filter((file) => /[\\/]layout\.tsx$/.test(file));

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
      .map((file) => relative(repositoryRoot, file).replaceAll("\\", "/"))
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

describe("the harness serves the code that is on disk", () => {
  it("never reuses a server that is serving a build", async () => {
    /*
     * The measurement is only worth what the server under it is serving.
     *
     * The harness entry is `harness:build && harness:serve` — `vite preview`,
     * which serves a compiled artifact. Combined with Playwright's
     * `reuseExistingServer`, which is on outside CI, the first local run built
     * the bundle and every run afterwards reused that server and skipped the
     * build. A preview started hours earlier answered every request, and the
     * width sweep passed against components that had since changed. It was
     * caught by breaking a layout on purpose and watching the suite stay
     * green.
     *
     * CI never saw it, because `reuseExistingServer` is false there. That is
     * the worst shape for this kind of bug: it only misleads the machine
     * drawing the conclusions.
     *
     * Either half is fine on its own — a dev server may be reused because it
     * compiles on request, and a build may be served as long as it is rebuilt
     * every run. The combination is what lies.
     */
    const config = await readFile(resolve(repositoryRoot, "playwright.config.ts"), "utf8");
    const packageJson = JSON.parse(
      await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    const entry = /\{(?:[^{}]|\n)*url: HARNESS_URL,(?:[^{}]|\n)*\}/.exec(config)?.[0];
    expect(
      entry,
      "playwright.config.ts no longer has a webServer entry keyed on HARNESS_URL.",
    ).toBeTruthy();

    const scripts = [...entry!.matchAll(/npm run ([a-z:]+)/g)]
      .map((match) => packageJson.scripts[match[1]] ?? "");
    expect(scripts.length, `no npm scripts found in the harness webServer entry: ${entry}`)
      .toBeGreaterThan(0);

    const servesABuild = scripts.some((script) => /vite (build|preview)/.test(script));
    const reuses = !/reuseExistingServer:\s*false/.test(entry!);

    expect(
      servesABuild && reuses,
      `The harness runs ${JSON.stringify(scripts)} with reuse `
        + `${reuses ? "enabled" : "disabled"}. A reused preview keeps answering with whatever `
        + "was compiled when it started, which made this suite measure stale code. Either "
        + "set reuseExistingServer: false, or serve the harness with `vite` dev.",
    ).toBe(false);
  });
});
