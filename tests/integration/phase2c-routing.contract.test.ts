// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Boundaries the routing path must keep.
 *
 * The risk this guards is specific: a router that decides who does the work is
 * one small step from a router that starts it. These assert that step has not
 * been taken, and that undeclared model properties keep failing closed.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");

function source(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("Phase 2C routing boundaries", () => {
  const route = source("app/api/resources/route/route.ts");

  it("selects a worker without starting anything", () => {
    // No claim, no token, no provider call. Routing decides; it does not run.
    expect(route).not.toMatch(/claim_phase1c_run|submit_command|createGitHubInstallationToken/);
    expect(route).not.toMatch(/executeProviderRun|runProvider|fetch\(/);
    expect(route).toMatch(/Not Connected/);
  });

  it("checks the caller's role and origin before reading tenant rows", () => {
    expect(route).toMatch(/assertSameOriginRequest\(request\)/);
    expect(route).toMatch(/require(Manager|Owner)\(context\)/);
    // Every read is scoped to the caller's active organization; RLS is the real
    // guarantee, but an unscoped query would still be a bug worth catching.
    expect(route).toMatch(/\.eq\("organization_id", organizationId\)/);
  });

  it("never invents observed performance for a pair that has never run", () => {
    // `performance: null` is the honest value. A zero would be a measurement
    // nobody made, and it would then be scored as if it were evidence.
    expect(route).toMatch(/performance: null/);
    expect(route).not.toMatch(/performance:\s*\{/);
  });

  it("keeps undeclared model properties failing closed", () => {
    const candidates = source("lib/resources/candidates.ts");
    // Undeclared strength must resolve to the weakest tier, so it cannot pass
    // the strong-model eligibility gate; undeclared context must resolve to
    // zero, so nothing can be shown to fit it.
    expect(candidates).toMatch(/return "economical";/);
    expect(candidates).toMatch(/value > 0 \? value : 0/);
  });

  it("does not map a Phase 2A capability onto a Phase 2C one it does not mean", () => {
    const candidates = source("lib/resources/candidates.ts");
    const mapping = candidates.slice(
      candidates.indexOf("WORK_CAPABILITY_FROM_PROVIDER_CAPABILITY"),
      candidates.indexOf("ROLE_CAPABILITIES"),
    );
    // `synthesis` gates work onto strong models, so mapping `reporting` onto it
    // would hand judgement work to a model nobody said could do it.
    expect(mapping).not.toMatch(/^\s*reporting:/m);
    expect(mapping).not.toMatch(/^\s*structured_output:/m);
  });

  it("distinguishes an unconfigured organization from a routing failure", () => {
    expect(route).toMatch(/NO_CANDIDATES_CONFIGURED/);
    expect(route).toMatch(/undeclaredModels\(/);
  });

  it("returns the decision even when it could not be recorded", () => {
    // Hiding a real decision behind a storage error would make a routing
    // problem and a persistence problem look identical.
    expect(route).toMatch(/recorded: assignmentId !== null/);
    expect(route).toMatch(/recordingError/);
  });
});
