// @vitest-environment node

import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every control in the Bots section reaches a route that exists.
 *
 * The section is where a person connects an AI account, creates a bot, and
 * puts it on a project, and its controls are spread across five components
 * calling twenty-odd endpoints. A path typed into a template literal has no
 * compiler behind it: rename a route segment and the button keeps rendering,
 * keeps being clickable, and answers 404 — which the console reports as the
 * generic failure for whatever it was trying to do.
 *
 * So the paths are extracted from the components and resolved against the
 * route files on disk. Dynamic segments are matched against `[param]`
 * directories, because that is what Next resolves them to.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");

const SECTION_COMPONENTS = [
  "components/ai-accounts-panel.tsx",
  "components/bot-manager/home.tsx",
  "components/ai-account-connect.tsx",
  "components/bot-fabric-console.tsx",
  "components/bot-usage-console.tsx",
];

/** `/api/bots/${bot.id}/rename` → ["api", "bots", ":dynamic", "rename"]. */
function segmentsOf(path: string): string[] {
  return path
    .replace(/\?.*$/, "")
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => (segment.includes("${") ? ":dynamic" : segment));
}

async function routeExists(segments: string[]): Promise<boolean> {
  let directory = resolve(repositoryRoot, "app");
  for (const segment of segments) {
    const entries = await readdir(directory, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());
    const literal = directories.find((entry) => entry.name === segment);
    // A dynamic segment resolves to the one `[param]` directory here; a
    // literal one may also be served by it, which is how Next behaves.
    const dynamic = directories.find((entry) => /^\[.+\]$/.test(entry.name));
    const next = segment === ":dynamic" ? dynamic : (literal ?? dynamic);
    if (!next) return false;
    directory = resolve(directory, next.name);
  }
  return stat(resolve(directory, "route.ts")).then(() => true, () => false);
}

describe("the Bots section is wired to routes that exist", () => {
  it("resolves every endpoint its components call", async () => {
    const called = new Set<string>();
    for (const file of SECTION_COMPONENTS) {
      const source = await readFile(resolve(repositoryRoot, file), "utf8");
      for (const match of source.matchAll(/["`](\/api\/[^"`]+)["`]/g)) {
        called.add(match[1]);
      }
    }

    // If this ever reads zero the test proves nothing, which is the failure
    // mode a contract test has to rule out first.
    expect(called.size).toBeGreaterThan(15);

    const missing: string[] = [];
    for (const path of called) {
      if (!(await routeExists(segmentsOf(path)))) missing.push(path);
    }

    expect(
      missing.sort(),
      "These paths are called from the Bots section and have no route file. "
        + "A button wired to a missing route still renders and still clicks; it "
        + "answers 404, and the console reports whatever generic failure it has "
        + "for that action.",
    ).toEqual([]);
  });
});
