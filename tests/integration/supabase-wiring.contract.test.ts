// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every console read reaches Supabase, and none of them invents rows.
 *
 * The responsive work measured what the console *looks* like. This measures
 * what it is made of: that each API route the browser calls resolves, through
 * its own import closure, to the Supabase boundary — and that nothing returns
 * a hard-coded list of domain records dressed as live data.
 *
 * Traced transitively rather than by looking at each route's own imports. Most
 * routes reach the database through a service in `lib/`, so a shallow check
 * reports two dozen false alarms and teaches everyone to ignore it.
 *
 * `AGENTS.md` is the reason this is a test rather than a one-off audit: it
 * requires that nothing implies live state it does not have, and a rule that
 * is checked once holds only until the next merge.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");

/**
 * The modules that actually talk to Supabase.
 *
 * Includes creating a client directly from `@supabase/supabase-js`: the
 * service-role helper the OAuth callbacks use does exactly that, and a
 * definition that misses it reports three wired routes as unwired — which is
 * how a guard like this gets ignored.
 */
const BOUNDARY = /@\/lib\/supabase\/(tenant|server|browser|anon|proxy|auth|env)|from "@supabase\/supabase-js"/;

/**
 * Routes that legitimately never touch the database.
 *
 * Each is listed with why. An entry here is a claim that the route has no
 * tenant data to read, and it is the only way to pass this test without one.
 */
const NO_TENANT_DATA: Record<string, string> = {
  "app/api/csp-report/route.ts": "browser-posted violation report",
};

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [full] : [];
  }));
  return files.flat();
}

const IMPORT = /(?:from|import)\s+["']([^"']+)["']/g;

async function readIfPresent(path: string): Promise<string | null> {
  for (const candidate of [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`]) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

/** Every module a file pulls in, followed through the repository's own code. */
async function importClosure(entry: string): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  const queue = [entry];

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (seen.has(current)) continue;

    const source = await readIfPresent(current);
    if (source === null) continue;
    seen.set(current, source);

    for (const match of source.matchAll(IMPORT)) {
      const specifier = match[1];
      if (specifier.startsWith("@/")) {
        queue.push(resolve(repositoryRoot, specifier.slice(2)));
      } else if (specifier.startsWith(".")) {
        queue.push(resolve(dirname(current), specifier));
      }
      // Anything else is a package, and packages do not hold our tenant data.
    }
  }

  return seen;
}

describe("every API route resolves to Supabase or says why not", () => {
  it("traces each route's imports to the database boundary", async () => {
    const routes = (await walk(resolve(repositoryRoot, "app/api")))
      .filter((path) => /[\\/]route\.ts$/.test(path))
      .sort();

    expect(routes.length).toBeGreaterThan(50);

    const unwired: string[] = [];
    for (const route of routes) {
      const relativePath = relative(repositoryRoot, route).replaceAll("\\", "/");
      if (relativePath in NO_TENANT_DATA) continue;

      const closure = await importClosure(route);
      const reaches = [...closure.values()].some((source) => BOUNDARY.test(source));
      if (!reaches) unwired.push(relativePath);
    }

    expect(
      unwired,
      "these routes reach no Supabase boundary. Either wire them, or add them "
        + "to NO_TENANT_DATA with the reason they have nothing to read:\n"
        + unwired.join("\n"),
    ).toEqual([]);
  }, 120_000);
});

describe("no surface invents the records it shows", () => {
  it("keeps fixture-shaped data out of components and routes", async () => {
    /*
     * The specific failure this guards: a console that renders a convincing
     * table nobody's database produced. `AGENTS.md` fixes **Demo Data** as the
     * exact label for anything seeded, so a literal array of records with no
     * label is the shape that lies.
     */
    const sources = [
      ...(await walk(resolve(repositoryRoot, "components"))),
      ...(await walk(resolve(repositoryRoot, "app/api"))),
    ];

    const suspicious: string[] = [];
    for (const path of sources) {
      const source = await readFile(path, "utf8");
      // Three or more object literals carrying an id, in a row.
      const seeded = /\[\s*\{\s*id:\s*["'][^"']+["'][\s\S]{0,400}?\}\s*,\s*\{\s*id:\s*["'][^"']+["'][\s\S]{0,400}?\}\s*,\s*\{\s*id:\s*["'][^"']+["']/;
      const match = seeded.exec(source);
      if (!match || /Demo Data/.test(source)) continue;

      /*
       * A list whose values reference something is reading, not inventing —
       * the Bot Fabric's tab strip is three `{ id, label, count }` objects
       * whose counts are `fabric.bots.length`, and flagging that taught
       * nothing. Only a block of pure literals is a seeded list.
       */
      const referencesState = /[\w)\]]\s*\.\s*\w|\$\{|\?\./.test(match[0]);
      if (!referencesState) suspicious.push(relative(repositoryRoot, path).replaceAll("\\", "/"));
    }

    expect(
      suspicious,
      "these files contain a seeded-looking list of records. Read them from "
        + "Supabase, or label them Demo Data exactly as AGENTS.md requires:\n"
        + suspicious.join("\n"),
    ).toEqual([]);
  });
});
