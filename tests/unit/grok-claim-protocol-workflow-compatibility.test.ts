// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const audit = read("scripts/hosted-schema-audit.mts");
const hostedApply = read(".github/workflows/apply-hosted-migrations.yml");
const containment = read(".github/workflows/graph-artifact-containment.yml");

const claimMigrationVersion = "20260831000900";
const graphClaims = [
  "claim_planned_graph",
  "claim_planned_graph_by_id",
] as const;
const phaseClaims = [
  "claim_phase1c_run",
  "claim_phase1c_run_by_command",
] as const;

describe("Grok claim-protocol workflow compatibility", () => {
  it("uses protocol v3 as the hosted-schema control with a v2 pre-cutover fallback", () => {
    expect(audit).toContain(
      'const CONTROL_FUNCTIONS = ["claim_planned_graph_v3", "claim_planned_graph_v2"] as const;',
    );
    expect(audit).toContain(
      "CONTROL_FUNCTIONS.find((candidate) => callable.has(candidate)) ?? null",
    );
    expect(audit).toContain("const trustFunctions = controlFunction !== null");
    expect(audit).not.toContain(
      'const CONTROL_FUNCTION = "claim_planned_graph_v2";',
    );
  });

  it("makes broad hosted apply accept only the exact pre- or post-cutover claim ACL", () => {
    const start = hostedApply.indexOf("PROTECTED_GRAPH_PROTOCOL_READY=");
    const end = hostedApply.indexOf(
      'if [ "$PROTECTED_GRAPH_PROTOCOL_READY" != "t" ]',
      start,
    );
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const gate = hostedApply.slice(start, end);

    expect(gate).toContain(`version='${claimMigrationVersion}'`);
    expect(gate).toContain("select applied in (0,1) from cutover");
    expect(gate).toContain("when protocol=2 then routine is not null");
    expect(gate).toContain(
      "has_function_privilege('service_role',routine,'EXECUTE')=(applied=0)",
    );
    expect(gate).toContain("when applied=0 then routine is null");
    expect(gate).toContain(
      "and has_function_privilege('service_role',routine,'EXECUTE')",
    );
    expect(gate).toContain(
      "and not has_function_privilege('anon',routine,'EXECUTE')",
    );
    expect(gate).toContain(
      "and not has_function_privilege('authenticated',routine,'EXECUTE')",
    );
    for (const stem of [...graphClaims, ...phaseClaims]) {
      expect(gate).toContain(`public.${stem}_v2`);
      expect(gate).toContain(`public.${stem}_v3`);
    }
    expect(gate).toContain(
      "select cutover.applied,expected.protocol,to_regprocedure(expected.signature) routine",
    );
  });

  it("keeps graph-artifact verification valid on both sides of the v3 cutover", () => {
    expect(containment).toContain(`version='${claimMigrationVersion}'`);
    for (const stem of [graphClaims[0], phaseClaims[0]]) {
      expect(containment).toContain(`then 'public.${stem}_v3`);
      expect(containment).toContain(`else 'public.${stem}_v2`);
      expect(containment).toContain(
        `not has_function_privilege('service_role','public.${stem}_v2`,
      );
      expect(containment).toContain(
        `has_function_privilege('service_role','public.${stem}_v3`,
      );
    }
    expect(containment).toContain(
      `(select count(*) from supabase_migrations.schema_migrations where version='${claimMigrationVersion}')=0`,
    );
    expect(containment).toContain(
      `(select count(*) from supabase_migrations.schema_migrations where version='${claimMigrationVersion}')=1`,
    );
  });
});
