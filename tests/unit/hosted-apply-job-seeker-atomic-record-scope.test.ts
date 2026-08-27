// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const workflowSource = readFileSync(
  resolve(root, ".github/workflows/apply-hosted-migrations.yml"),
  "utf8",
);
const workflow = parse(workflowSource) as {
  on: { workflow_dispatch: { inputs: { scope: { options: string[] } } } };
  jobs: { apply: { steps: Array<{ name: string; if?: string; run?: string }> } };
};
const scope = "job-seeker-atomic-record";
const path = "supabase/migrations/20260827000100_record_job_seeker_job_atomically.sql";
const hash = "2f51bf64ba3fd2bc711e6fbf9e660a2cc0dd5ef4b1f85d932ee574e79e9c7d13";
const steps = workflow.jobs.apply.steps;
const step = steps.find((candidate) =>
  candidate.name === "Apply atomic job recording (scope=job-seeker-atomic-record)"
)!;

function canRun(candidate: { if?: string }): boolean {
  const guard = candidate.if ?? "";
  if ([...guard.matchAll(/inputs\.scope\s*!=\s*'([^']+)'/g)].some((match) => match[1] === scope)) return false;
  const includes = [...guard.matchAll(/inputs\.scope\s*==\s*'([^']+)'/g)].map((match) => match[1]);
  return includes.length === 0 || includes.includes(scope);
}

function mutatesMigrationState(candidate: { run?: string }): boolean {
  const run = candidate.run ?? "";
  return /\bpsql\b[\s\S]*?\s-f\s/m.test(run)
    || /\bsupabase\s+migration\s+repair\b/.test(run)
    || /\bsupabase\s+db\s+push\b/.test(run);
}

describe("hosted atomic job-recording scope", () => {
  it("is a single exact dispatch choice and mutation path", () => {
    expect(workflow.on.workflow_dispatch.inputs.scope.options.filter((value) => value === scope)).toEqual([scope]);
    expect(step.if).toBe("${{ inputs.scope == 'job-seeker-atomic-record' }}");
    expect(steps.filter(canRun).filter(mutatesMigrationState).map((candidate) => candidate.name)).toEqual([
      "Apply atomic job recording (scope=job-seeker-atomic-record)",
    ]);
  });

  it("pins and stages exactly the frozen migration", () => {
    const run = step.run ?? "";
    const migration = readFileSync(resolve(root, path), "utf8").replace(/\r\n?/g, "\n");
    expect(createHash("sha256").update(migration).digest("hex")).toBe(hash);
    expect(run.match(/supabase\/migrations\/[A-Za-z0-9_.-]+\.sql/g)).toEqual([path]);
    expect(run.match(/(?<=EXPECTED_SHA256=)[a-f0-9]{64}/g)).toEqual([hash]);
    expect(run).toContain('STAGE_DIR=$(mktemp -d)');
    expect(run).toContain('find "$STAGE_DIR" -maxdepth 1 -type f');
    expect(run.match(/-f "\$STAGED_FILE"/g)).toHaveLength(1);
  });

  it("binds identity and applies DDL plus ledger in one transaction", () => {
    const run = step.run ?? "";
    expect(run).toContain('"surgeservicesllc/SoftwareFactory"');
    expect(run).toContain('"refs/heads/main"');
    expect(run).toContain('"qpuofpmagrmyamahqwxw"');
    expect(run).toContain('--single-transaction');
    expect(run).toContain("insert into supabase_migrations.schema_migrations (version) values ('20260827000100')");
    expect(run).not.toMatch(/migration\s+repair|supabase\s+db\s+push/);
  });

  it("fails closed around exact ledger, catalog, ACL, constraints, and RLS state", () => {
    const run = step.run ?? "";
    for (const evidence of [
      "TARGET", "READY", "VERIFIED", "record_job_seeker_job", "job_seeker_jobs_owner_identity_key",
      "job_seeker_matches_job_owner_fkey", "job_seeker_applications_job_owner_fkey",
      "has_function_privilege('authenticated'", "not has_function_privilege('anon'",
      "not has_function_privilege('service_role'", "relrowsecurity", "relforcerowsecurity",
    ]) expect(run).toContain(evidence);
  });

  it("blocks scope=all until the frozen migration is already accepted", () => {
    const broad = steps.find((candidate) => candidate.name === "Push the outstanding migrations (scope=all)")!;
    const run = broad.run ?? "";
    const gate = run.indexOf("PROTECTED_JOB_ATOMIC_RECORD=");
    const push = run.search(/\bsupabase\s+db\s+push\b/);
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(run).toContain('if [ "$PROTECTED_JOB_ATOMIC_RECORD" != "1" ]');
    expect(run).toContain("scope=job-seeker-atomic-record");
    expect(push).toBeGreaterThan(gate);
  });
});
