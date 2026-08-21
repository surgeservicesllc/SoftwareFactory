import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

/**
 * `scope: probe` is documented as changing nothing at all, and it is the scope
 * an operator reaches for exactly when they do not trust the ledger yet.
 *
 * The ledger repair sat above the scope branch, so a probe could still rewrite
 * history rows in production — a read-only question able to edit the thing
 * being questioned. This pins the set of steps a probe can reach, so a new
 * step added without a scope guard fails here rather than in production.
 */
const WORKFLOW = resolve(import.meta.dirname, "../../.github/workflows/apply-hosted-migrations.yml");

interface Step { readonly name: string; readonly if?: string }

function stepsReachableByProbe(): readonly string[] {
  const workflow = parse(readFileSync(WORKFLOW, "utf8")) as {
    jobs: { apply: { steps: readonly Step[] } };
  };
  return workflow.jobs.apply.steps
    .filter((step) => {
      const guard = step.if ?? "";
      // A guard naming another scope excludes the probe; one excluding the
      // probe by name does too. Anything else runs.
      if (/inputs\.scope\s*==\s*'(?!probe')/.test(guard)) return false;
      if (/inputs\.scope\s*!=\s*'probe'/.test(guard)) return false;
      return true;
    })
    .map((step) => step.name);
}

describe("a probe of the hosted database", () => {
  it("reaches only steps that read", () => {
    expect(stepsReachableByProbe()).toEqual([
      "Check out the migrations",
      "Choose the connection",
      "Link the production project (token mode only)",
      "List the remote ledger before touching anything",
      "Report what the database already has (scope=probe)",
      "List the remote ledger after — the run's own evidence",
    ]);
  });

  it("cannot repair ledger rows", () => {
    expect(stepsReachableByProbe()).not.toContain("Repair stale ledger rows (idempotent)");
  });
});
