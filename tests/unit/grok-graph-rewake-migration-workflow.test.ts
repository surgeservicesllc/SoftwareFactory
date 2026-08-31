// @vitest-environment node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const workflowPath = ".github/workflows/grok-graph-rewake-migration.yml";
const preflightPath = ".github/grok-release/grok-graph-rewake-preflight.sql";
const postflightPath = ".github/grok-release/grok-graph-rewake-postflight.sql";
const migrationPath =
  "supabase/migrations/20260831001600_grok_phase1c_graph_rewake.sql";
const migrationSha256 =
  "04e0bc9115c30f179bcac89fac512fe30c9b0c1bc4a5271166e755fd47fbf76e";

const source = readFileSync(resolve(root, workflowPath), "utf8");
const preflight = readFileSync(resolve(root, preflightPath), "utf8");
const postflight = readFileSync(resolve(root, postflightPath), "utf8");

type WorkflowStep = Readonly<{
  name: string;
  if?: string;
  env?: Record<string, string>;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}>;

const workflow = parse(source) as {
  on: { workflow_dispatch: { inputs: Record<string, unknown> } };
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: {
    release: {
      "timeout-minutes": number;
      env: Record<string, string>;
      steps: WorkflowStep[];
    };
  };
};
const steps = workflow.jobs.release.steps;

function step(name: string) {
  const found = steps.find((candidate) => candidate.name === name);
  expect(found).toBeDefined();
  return found!;
}

describe("Grok graph re-wake protected migration workflow", () => {
  it("is one manual, serialized, least-privilege lane", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
      "operation",
      "confirm",
      "release_sha",
      "migration_sha256",
    ]);
    expect(workflow.on.workflow_dispatch.inputs.operation).toMatchObject({
      required: true,
      type: "choice",
      options: ["probe", "apply", "verify"],
    });
    expect(workflow.permissions).toEqual({
      actions: "read",
      checks: "read",
      contents: "read",
      deployments: "read",
    });
    expect(workflow.concurrency).toEqual({
      group: "apply-hosted-migrations",
      "cancel-in-progress": false,
    });
    expect(workflow.jobs.release["timeout-minutes"]).toBe(35);
  });

  it("pins the exact project, path, canonical bytes, and release identity", () => {
    expect(workflow.jobs.release.env).toMatchObject({
      PROJECT_REF: "qpuofpmagrmyamahqwxw",
      PRODUCTION_ORIGIN: "https://www.theagoras.com",
      VERCEL_PROJECT_ID: "prj_pAsrhftaVWI4SyaqstgRVSWHJkdD",
      MIGRATION_VERSION: "20260831001600",
      MIGRATION_FILE: migrationPath,
      MIGRATION_SHA256: migrationSha256,
    });
    const migration = resolve(root, migrationPath);
    if (existsSync(migration)) {
      const canonical = readFileSync(migration, "utf8").replace(/\r\n?/g, "\n");
      expect(createHash("sha256").update(canonical).digest("hex")).toBe(
        migrationSha256,
      );
    }
    const authorize = step("Authorize one exact protected operation").run ?? "";
    for (const proof of [
      "probe:probe-grok-graph-rewake",
      "apply:apply-grok-graph-rewake",
      "verify:verify-grok-graph-rewake",
      "PRODUCTION_RELEASE_ACTOR",
      "GITHUB_ACTOR",
      "GITHUB_TRIGGERING_ACTOR",
      "GITHUB_RUN_ATTEMPT",
      "surgeservicesllc/SoftwareFactory",
      "refs/heads/main",
      "^[0-9a-f]{40}$",
      "^[0-9a-f]{64}$",
    ]) expect(`${source}\n${authorize}`).toContain(proof);
  });

  it("requires exact-head CI, READY Vercel, matched health, and stopped workflows", () => {
    const gate = step(
      "Verify exact green production and stopped execution workflows",
    ).run ?? "";
    const final = step(
      "Reverify exact main health file identity and stopped workflows",
    ).run ?? "";
    for (const proof of [
      "CURRENT_MAIN_SHA",
      "GITHUB_SHA",
      "Lint, typecheck, test, and build",
      "Browser and accessibility tests 1/3",
      "Browser and accessibility tests 2/3",
      "Browser and accessibility tests 3/3",
      '.environment=="Production"',
      '.creator.login=="vercel[bot]"',
      '.releaseSha==$sha',
      '.databaseProjectRef==$project',
      ".vercelProjectId",
    ]) expect(gate).toContain(proof);
    for (const workflowName of [
      "graph-worker.yml",
      "codex-worker.yml",
      "claude-worker.yml",
      "auth-broker.yml",
      "graph-live-canary.yml",
      "handoff-canary.yml",
      "graph-artifact-containment.yml",
      "e2e-test-data.yml",
      "journey-prod-user.yml",
    ]) {
      expect(gate).toContain(workflowName);
      expect(final).toContain(workflowName);
    }
    for (const variable of [
      "PHASE1C_WORKER_ENABLED",
      "GRAPH_WORKER_ENABLED",
      "GRAPH_WORKER_SCHEDULED",
      "AUTH_BROKER_DISABLED",
    ]) {
      expect(gate).toContain(variable);
      expect(final).toContain(variable);
    }
  });

  it("applies only the staged 016 file and its ledger row in one transaction", () => {
    const stage = step("Stage exactly one canonical migration file").run ?? "";
    for (const proof of [
      "git ls-files --error-unmatch",
      "git diff --exit-code",
      "STAGED_MIGRATION",
      'replace(b"\\r\\n", b"\\n").replace(b"\\r", b"\\n")',
      "sha256sum",
      '!= "1"',
    ]) expect(stage).toContain(proof);

    const apply = step("Apply only the exact forward migration").run ?? "";
    expect(apply).toContain("--single-transaction");
    expect(apply).toContain("lock table supabase_migrations.schema_migrations");
    expect(apply).toContain(
      '-f .github/grok-release/grok-graph-rewake-preflight.sql',
    );
    expect(apply.match(/-f "\$STAGED_MIGRATION"/g)).toHaveLength(1);
    expect(apply).toContain(
      "insert into supabase_migrations.schema_migrations(version) values ('20260831001600')",
    );
    expect(source).not.toMatch(
      /supabase\s+db\s+(?:push|reset)|migration\s+(?:down|repair)|\bgh\s+workflow\s+run\b|\/dispatches\b/i,
    );
  });

  it("pins the prerequisite and unrelated ledger and proves stopped database state", () => {
    for (let version = 1; version <= 15; version += 1) {
      expect(preflight).toContain(`2026083100${String(version).padStart(2, "0")}00`);
    }
    for (const proof of [
      "unrelated_ledger_sha256",
      "20260831001600",
      "grok_graph_rewake_release_absent_ledger_or_catalog_mismatch",
      "grok_graph_rewake_release_verify_ledger_mismatch",
      "autonomy_kill_switch_active is distinct from true",
      "autonomous_mode",
      "auto_plan",
      "auto_code",
      "auto_test",
      "auto_repair",
      "auto_review",
      "auto_approve",
      "auto_merge",
      "auto_deploy",
      "auto_rollback",
      "last_heartbeat_at > pg_catalog.now() - interval '10 minutes'",
      "current_run_id is not null",
      "state = 'RUNNING'",
      "status = 'running'",
      "grok_phase1c_submission_guards",
    ]) expect(preflight).toContain(proof);
    expect(preflight).not.toMatch(
      /^\s*(?:insert|update|delete|truncate|alter|create|drop|grant|revoke|notify)\b/im,
    );
  });

  it("verifies exact RLS, policy, ACL, trigger, function, and replay identities", () => {
    expect(postflight).not.toMatch(/__[A-Z0-9_]+__/);
    for (const proof of [
      "relrowsecurity",
      "relforcerowsecurity",
      "grok_graph_rewake_intents",
      "grok_graph_rewake_attempts",
      "_owner_select",
      "has_table_privilege",
      "grok_graph_rewake_intents_bridge_unique",
      "grok_graph_rewake_intents_command_unique",
      "grok_graph_rewake_intents_run_unique",
      "grok_graph_rewake_attempts_accepted_once",
      "grok_graph_rewake_intents_transition",
      "grok_graph_rewake_attempts_append_only",
      "_no_truncate",
      "enqueue_grok_graph_rewake_after_phase1c()",
      "assert_current_grok_graph_rewake_intent(public.grok_graph_rewake_intents)",
      "claim_grok_graph_rewake_as_worker(text,uuid,integer)",
      "record_grok_graph_rewake_delivery_as_worker(text,uuid,uuid,uuid,uuid,uuid,uuid,boolean,text)",
      "search_path=pg_catalog",
      "has_function_privilege",
    ]) expect(postflight).toContain(proof);
  });

  it("runs rollback-only disabled-worker and zero-execution proofs", () => {
    expect(postflight).toMatch(/^begin;/m);
    expect(postflight).toMatch(/rollback;\s*$/);
    expect(postflight).not.toMatch(/^\s*commit\s*;/im);
    for (const proof of [
      "missing-disabled-worker",
      "disabled_worker_was_not_blocked",
      "disabled_delivery_was_not_blocked",
      "grok_graph_rewake_intents",
      "grok_graph_rewake_attempts",
      "public.graph_runs",
      "public.agent_runs",
      "runtime_or_evidence_changed",
    ]) expect(postflight).toContain(proof);
    expect(source).not.toMatch(
      /^\s*(?:PHASE1C_WORKER_ENABLED|GRAPH_WORKER_ENABLED|GRAPH_WORKER_SCHEDULED):\s*(?:true|"true")\s*$/im,
    );
    expect(source).not.toMatch(/autonomy_kill_switch_active\s*=\s*false/i);
  });

  it("rehearses and lints both candidate and installed functions without residue", () => {
    const rehearsal = step("Rehearse exact migration and linked-database lint").run ?? "";
    const verify = step(
      "Verify exact catalog ACL replay and fail-closed runtime",
    ).run ?? "";
    for (const command of [rehearsal, verify]) {
      expect(command).toContain("plpgsql_check_function_tb");
      expect(command).toContain('if [ "$RESIDUE" != "0|0" ]');
    }
    expect(verify).toContain("rollback;");
    expect(postflight).toMatch(/rollback;\s*$/);
    expect(rehearsal).toContain(
      "insert into supabase_migrations.schema_migrations(version) values ('20260831001600')",
    );
    expect(rehearsal).toContain(
      "-f .github/grok-release/grok-graph-rewake-postflight.sql",
    );
    expect(rehearsal).toContain("grok-graph-rewake-release-postflight-ok");
  });
});
