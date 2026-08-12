// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function source(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("Phase 1D observation-only contracts", () => {
  const migration = source(
    "supabase/migrations/20260812001000_phase1d_observation_controls.sql",
  );
  const route = source("app/api/projects/[projectId]/controls/route.ts");

  it("locks the organization kill switch on and constrains projects to GREEN observation", () => {
    expect(migration).toMatch(
      /autonomy_kill_switch_active\s+boolean\s+not\s+null\s+default\s+true/i,
    );
    expect(migration).toMatch(
      /check\s*\(autonomy_kill_switch_active\)/i,
    );
    expect(migration).toMatch(
      /not\s+autonomous_mode[\s\S]*and\s+maximum_autonomous_risk\s*=\s*'green'::public\.risk_level[\s\S]*and\s+not\s+auto_approve[\s\S]*and\s+not\s+auto_merge[\s\S]*and\s+not\s+auto_deploy[\s\S]*and\s+not\s+auto_rollback/i,
    );
    expect(migration).toMatch(/validate\s+constraint\s+projects_phase1d_green_observation_only/i);
  });

  it("enforces the same boundary in the owner-only database workflow", () => {
    expect(migration).toMatch(/only an organization owner may change project controls/i);
    expect(migration).toMatch(/autonomous mode must remain OFF/i);
    expect(migration).toMatch(/for update/i);
    expect(migration).toMatch(/execution_allowed', false/i);
  });

  it("makes the project controls API same-origin, tenant-scoped, and fail closed", () => {
    expect(route).toMatch(/assertSameOriginRequest\(request\)/);
    expect(route).toMatch(/requireActiveOrganization\(\)/);
    expect(route).toMatch(/activeOrganization\.role !== "owner"/);
    expect(route).toMatch(/autonomousMode:\s*z\.literal\(false\)/);
    expect(route).toMatch(/maximumAutonomousRisk:\s*z\.literal\("green"\)/);
    expect(route).toMatch(/autoApprove:\s*z\.literal\(false\)/);
    expect(route).toMatch(/autoMerge:\s*z\.literal\(false\)/);
    expect(route).toMatch(/autoDeploy:\s*z\.literal\(false\)/);
    expect(route).toMatch(/autoRollback:\s*z\.literal\(false\)/);
    expect(route).toMatch(/PHASE_1D_SAFETY_DEFAULTS/);
  });

  it("contains no autonomous merge, deployment, or rollback route", () => {
    const expectedAbsent = [
      "app/api/github/merge/route.ts",
      "app/api/deployments/route.ts",
      "app/api/rollbacks/route.ts",
    ];

    for (const relativePath of expectedAbsent) {
      expect(() => source(relativePath)).toThrow();
    }
  });
});
