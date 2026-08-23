// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

/**
 * `scope=stage-handoffs` applies exactly one migration —
 * `20260823001000_structured_stage_handoffs.sql` — which introduces the first
 * writer `graph_handoffs` has ever had.
 *
 * The thing worth testing here is not that the step exists. It is that the
 * step stays *narrow* and stays *honest*: one file and no others, a preflight
 * that reads the premise off the live database rather than asserting it in a
 * comment, and a postflight that reads the grants back. A scope that quietly
 * grows a second `-f` is how an unrelated migration reaches production under
 * the authorization given for this one.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const workflowPath = resolve(
  repositoryRoot,
  ".github/workflows/apply-hosted-migrations.yml",
);
const scope = "stage-handoffs";
const migrationVersion = "20260823001000";
const migrationRelativePath =
  "supabase/migrations/20260823001000_structured_stage_handoffs.sql";
const stepName =
  "Record the handoff a stage makes to the next one (scope=stage-handoffs)";

interface WorkflowStep {
  readonly name?: string;
  readonly if?: string;
  readonly run?: string;
}

interface HostedApplyWorkflow {
  readonly on: {
    readonly workflow_dispatch: {
      readonly inputs: {
        readonly scope: { readonly options: readonly string[] };
      };
    };
  };
  readonly jobs: { readonly apply: { readonly steps: readonly WorkflowStep[] } };
}

const workflow = parse(
  readFileSync(workflowPath, "utf8"),
) as HostedApplyWorkflow;
const steps = workflow.jobs.apply.steps;

function handoffStep(): WorkflowStep {
  const matches = steps.filter((step) => step.name === stepName);
  expect(matches, `expected exactly one step named ${stepName}`).toHaveLength(1);
  return matches[0]!;
}

describe("the stage-handoffs hosted apply scope", () => {
  it("is a selectable scope", () => {
    expect(workflow.on.workflow_dispatch.inputs.scope.options).toContain(scope);
  });

  it("runs only when that scope is chosen", () => {
    expect(handoffStep().if).toBe(`\${{ inputs.scope == '${scope}' }}`);
  });

  it("applies exactly one migration file", () => {
    const run = handoffStep().run ?? "";
    const applied = [...run.matchAll(/supabase\/migrations\/[\w.]+\.sql/g)].map(
      (match) => match[0],
    );
    expect(new Set(applied)).toEqual(new Set([migrationRelativePath]));
  });

  it("records exactly that version in the ledger, and no other", () => {
    const run = handoffStep().run ?? "";
    const repaired = [
      ...run.matchAll(/migration repair --status applied (\d{14})/g),
    ].map((match) => match[1]);
    expect(new Set(repaired)).toEqual(new Set([migrationVersion]));
  });

  it("proves the table and the worker assertion exist before it writes", () => {
    const run = handoffStep().run ?? "";
    expect(run).toContain("to_regclass('public.graph_handoffs')");
    expect(run).toContain("assert_graph_worker_id");
  });

  it("reads the resulting grants back rather than asserting them", () => {
    const run = handoffStep().run ?? "";
    expect(run).toContain("record_graph_handoff_as_worker");
    expect(run).toContain("prosecdef");
    for (const role of ["service_role", "authenticated", "anon"]) {
      expect(run).toContain(`has_function_privilege('${role}'`);
    }
  });

  it("reads row level security back, because it is adding a writer", () => {
    const run = handoffStep().run ?? "";
    expect(run).toContain("relrowsecurity");
    expect(run).toContain("relforcerowsecurity");
  });

  it("does not touch sdlc_stage, so it carries no ordering dependency", () => {
    // 20260823000900 must stay above the 20260823000700 backfill. This file
    // has no such constraint, and the test records that as a property so a
    // later edit that adds an enum change here is caught rather than assumed
    // safe.
    const run = handoffStep().run ?? "";
    expect(run).not.toContain("sdlc_stage");
    const migration = readFileSync(
      resolve(repositoryRoot, migrationRelativePath),
      "utf8",
    );
    expect(migration).not.toContain("sdlc_stage");
  });

  it("is replay-safe by construction", () => {
    const migration = readFileSync(
      resolve(repositoryRoot, migrationRelativePath),
      "utf8",
    );
    expect(migration).toContain("create or replace function");
    expect(migration).not.toMatch(/drop\s+(table|type)\b/i);
    const indexes = [...migration.matchAll(/create index\s+(if not exists)?/gi)];
    expect(indexes.length).toBeGreaterThan(0);
    for (const index of indexes) {
      expect(index[1], "every index must be guarded").toBeDefined();
    }
  });

  it("grants execute to service_role only", () => {
    const migration = readFileSync(
      resolve(repositoryRoot, migrationRelativePath),
      "utf8",
    );
    expect(migration).toMatch(/revoke all on function[\s\S]*?from public, anon, authenticated/);
    expect(migration).toMatch(/grant execute on function[\s\S]*?to service_role/);
  });
});
