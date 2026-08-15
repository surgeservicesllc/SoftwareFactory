// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * The worker waits for CI jobs by display name, so the names have to match.
 *
 * `SOFTWAREFACTORY_REQUIRED_CHECKS` names the checks a Phase 1C run waits for
 * before it reports a result. GitHub reports check runs by their display name,
 * so the worker is coupled to the `name:` of each job in `ci.yml` through a
 * string that nothing validates.
 *
 * Renaming a CI job is an ordinary, obviously-safe-looking edit. It would leave
 * the worker waiting for a check that will never report — and the failure mode
 * is a hang rather than an error, on the live acceptance path, after real work
 * has already been done and pushed. That is expensive to diagnose and trivial
 * to prevent.
 *
 * This is the same class of defect as the migration version collision and the
 * `.rpc()` argument mismatch: a cross-file string contract that type-checks,
 * lints, and passes every other test, because the two halves are only brought
 * together at runtime.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");

let ci = "";
let worker = "";

beforeAll(async () => {
  ci = await readFile(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  worker = await readFile(resolve(repositoryRoot, ".github/workflows/codex-worker.yml"), "utf8");
});

/** Job-level `name:` values — two-space indented under a job key. */
function ciJobNames(source: string): string[] {
  return [...source.matchAll(/^ {4}name: (.+)$/gm)].map((match) => match[1].trim());
}

function requiredChecks(source: string): string[] {
  const match = /^ {6}SOFTWAREFACTORY_REQUIRED_CHECKS: (.+)$/m.exec(source);
  if (!match) return [];
  return match[1]
    .trim()
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
}

describe("required check wiring", () => {
  it("finds both halves of the contract, so an empty match cannot pass vacuously", () => {
    expect(ciJobNames(ci).length).toBeGreaterThan(0);
    expect(requiredChecks(worker).length).toBeGreaterThan(0);
  });

  it("names only checks that a CI job actually produces", () => {
    const produced = ciJobNames(ci);
    const awaited = requiredChecks(worker);

    const missing = awaited.filter((name) => !produced.includes(name));

    // A name here that CI never reports is a run that waits forever.
    expect(missing).toEqual([]);
  });

  it("waits for every CI job, so a new required job is not silently ignored", () => {
    // The reverse direction matters too: adding a job to CI without adding it
    // here means the worker reports success while a required check is still
    // running or failing.
    const produced = ciJobNames(ci);
    const awaited = requiredChecks(worker);

    expect([...awaited].sort()).toEqual([...produced].sort());
  });

  it("preloads exactly the validation image the validator demands", async () => {
    // The workflow pulls a pinned digest; `DeterministicValidator` refuses to
    // run against anything but `PINNED_VALIDATION_IMAGE`. Bumping one without
    // the other fails a live run *after* it has claimed a durable attempt and
    // prepared a workspace — the expensive place to discover a typo.
    const validation = await readFile(
      resolve(repositoryRoot, "lib/worker/validation.ts"),
      "utf8",
    );
    const expected = /PINNED_VALIDATION_IMAGE = "([^"]+)"/.exec(validation)?.[1];

    expect(expected, "PINNED_VALIDATION_IMAGE not found in lib/worker/validation.ts").toBeDefined();
    expect(expected).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(
      worker.includes(`docker pull ${expected}`),
      `codex-worker.yml must preload ${expected}`,
    ).toBe(true);
  });

  it("keeps the merge-readiness fixtures on the same names", async () => {
    // `evaluateMergeReadiness` treats an unreported required check as blocking.
    // Its tests encode these names as fixtures, so they drift silently too.
    const fixtures = await readFile(
      resolve(repositoryRoot, "tests/unit/autonomy-merge-readiness.test.ts"),
      "utf8",
    );

    for (const name of requiredChecks(worker)) {
      expect(fixtures).toContain(name);
    }
  });
});
