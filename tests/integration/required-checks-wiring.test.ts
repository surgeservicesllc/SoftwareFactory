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

/**
 * Job-level `name:` values, with a one-dimensional matrix expanded.
 *
 * GitHub reports one check per matrix combination, named by substituting the
 * matrix value into the job's `name:`. Reading the template literally would
 * make the worker's list look wrong for a sharded job and — worse — would let
 * a shard count change without anything noticing that a required check no
 * longer exists. The e2e job is sharded, so the expansion is the contract.
 */
function ciJobNames(source: string): string[] {
  const names: string[] = [];
  // Split on job keys (two-space indent) so a matrix belongs to its own job.
  const blocks = source.split(/^ {2}(?=[A-Za-z_][A-Za-z0-9_-]*:$)/m);
  for (const block of blocks) {
    const name = /^ {4}name: (.+)$/m.exec(block)?.[1]?.trim();
    if (!name) continue;

    const variable = /\$\{\{\s*matrix\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/.exec(name);
    if (!variable) {
      names.push(name);
      continue;
    }

    const values = /^ {8}[A-Za-z_][A-Za-z0-9_]*: \[(.+)\]$/m.exec(block)?.[1];
    if (!values) {
      throw new Error(`${name} interpolates matrix.${variable[1]} but no matrix values were found`);
    }
    for (const value of values.split(",").map((entry) => entry.trim().replace(/^["']|["']$/g, ""))) {
      names.push(name.replace(variable[0], value));
    }
  }
  return names;
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

describe("CI verdicts on main", () => {
  /**
   * A merge that cancels the previous merge's CI leaves main unverified.
   *
   * `cancel-in-progress` is correct for a pull-request ref: a newer push to the
   * same branch makes the older run's answer worthless. It is wrong for pushes
   * to main, where each commit is a distinct thing to verify and the older run
   * is the only proof that the commit before it was good. With a shared group,
   * a burst of merges leaves a trail of `cancelled` runs — runs 32272713212 and
   * 32216103242 were both cancelled that way — and a cancelled run is
   * indistinguishable from a suite that never ran.
   *
   * This is a guard on the shape of the answer, not on how it is spelled: any
   * config that keys pushes by commit and refuses to pre-empt them passes.
   */
  it("gives every commit on main its own concurrency group", () => {
    const group = /^ {2}group: (.+)$/m.exec(ci)?.[1] ?? "";

    expect(group, "ci.yml must declare a concurrency group").not.toBe("");
    // github.ref is identical for every push to main; github.sha is not.
    expect(group).toContain("github.sha");
    expect(group).toContain("push");
  });

  it("never pre-empts an in-progress run for a push", () => {
    const cancel = /^ {2}cancel-in-progress: (.+)$/m.exec(ci)?.[1]?.trim() ?? "";

    expect(cancel, "ci.yml must declare cancel-in-progress").not.toBe("");
    // A bare `true` cancels main's own verification; the value has to be an
    // expression that excludes pushes.
    expect(cancel).not.toBe("true");
    expect(cancel).toMatch(/github\.event_name/);
    expect(cancel).toContain("push");
  });
  it("runs as many Playwright shards as the matrix declares", () => {
    // `--shard=i/n`: the denominator is written separately from the matrix, so
    // adding a fourth shard without changing it leaves shard 4 of 3, and
    // Playwright refuses. Getting it wrong the other way — four matrix values
    // against `/3` — is worse: three jobs re-run the same third of the suite
    // and a third of the tests never run at all, with three green checks.
    const shardValues = /^ {8}shard: \[(.+)\]$/m.exec(ci)?.[1];
    expect(shardValues, "ci.yml must declare the shard matrix").toBeDefined();
    const declared = (shardValues as string).split(",").length;

    const denominator = /--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/.exec(ci)?.[1];
    expect(denominator, "ci.yml must run playwright with --shard").toBeDefined();

    expect(Number(denominator)).toBe(declared);
    // And the job name says the same number, so the check names a reader sees
    // match the split that actually ran.
    expect(ci).toContain(`name: Browser and accessibility tests \${{ matrix.shard }}/${declared}`);
  });
});
