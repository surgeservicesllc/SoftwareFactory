// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every third-party action a workflow runs must be pinned to a full commit
 * SHA, not a floating tag.
 *
 * These workflows hold the things this repository promises never to leak:
 * the subscription credential, the service-role key, the database URL. A
 * floating tag like `@v4` means whoever controls that tag controls code that
 * runs with those secrets in scope — and tags have been retargeted in real
 * supply-chain attacks. Most workflows here already pin, each with a
 * "reviewed immutable commit" comment; round 15 of the transformation audit
 * found four (including two credential-bearing canaries and the Claude
 * worker) still on floating tags, which is exactly the drift this test ends.
 *
 * A 40-hex ref is immutable; anything else — tag, branch, short SHA — fails.
 */

const workflowsDirectory = resolve(import.meta.dirname, "../../.github/workflows");

describe("workflow action pinning", () => {
  it("pins every `uses:` to a full commit SHA", async () => {
    const files = (await readdir(workflowsDirectory)).filter(
      (file) => file.endsWith(".yml") || file.endsWith(".yaml"),
    );
    expect(files.length).toBeGreaterThan(0);

    const floating: string[] = [];
    for (const file of files) {
      const source = await readFile(resolve(workflowsDirectory, file), "utf8");
      for (const match of source.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)) {
        const reference = match[1];
        // Local reusable workflows (./...) carry the repo's own review.
        if (reference.startsWith("./")) continue;
        if (!/@[0-9a-f]{40}$/.test(reference)) {
          floating.push(`${file}: ${reference}`);
        }
      }
    }

    expect(floating).toEqual([]);
  });
});
