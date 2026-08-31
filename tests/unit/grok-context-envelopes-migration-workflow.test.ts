// @vitest-environment node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const workflowPath = ".github/workflows/grok-context-envelopes-migration.yml";
const preflightPath = ".github/grok-release/grok-context-envelopes-preflight.sql";
const postflightPath = ".github/grok-release/grok-context-envelopes-postflight.sql";
const migrationPath =
  "supabase/migrations/20260831001100_grok_context_envelopes.sql";
const migrationSha256 =
  "6ef23581e4d51a1bc4ad1651917e42d52d10e9b7b2c156e9207df682946c3344";

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

describe("Grok context-envelope protected migration workflow", () => {
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
      MIGRATION_VERSION: "20260831001100",
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
      "probe:probe-grok-context-envelope",
      "apply:apply-grok-context-envelope",
      "verify:verify-grok-context-envelope",
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

  it("applies only the staged 011 file and its ledger row in one transaction", () => {
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
      '-f .github/grok-release/grok-context-envelopes-preflight.sql',
    );
    expect(apply.match(/-f "\$STAGED_MIGRATION"/g)).toHaveLength(1);
    expect(apply).toContain(
      "insert into supabase_migrations.schema_migrations(version) values ('20260831001100')",
    );
    expect(source).not.toMatch(
      /supabase\s+db\s+(?:push|reset)|migration\s+(?:down|repair)|\bgh\s+workflow\s+run\b|\/dispatches\b/i,
    );
  });

  it("pins the prerequisite and unrelated ledger and proves stopped database state", () => {
    for (let version = 1; version <= 10; version += 1) {
      expect(preflight).toContain(`2026083100${String(version).padStart(2, "0")}00`);
    }
    for (const proof of [
      "unrelated_ledger_sha256",
      "20260831001100",
      "grok_context_release_absent_ledger_or_catalog_mismatch",
      "grok_context_release_verify_ledger_mismatch",
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

  it("verifies exact RLS, policy, ACL, trigger, function, and source identities", () => {
    expect(postflight).not.toMatch(/__[A-Z0-9_]+__/);
    for (const proof of [
      "relrowsecurity",
      "relforcerowsecurity",
      "grok_context_envelopes",
      "grok_context_items",
      "_select_member",
      "has_table_privilege",
      "aclexplode",
      "_immutable",
      "_no_truncate",
      "reject_grok_evidence_mutation()",
      "record_grok_context_envelope_internal(uuid,uuid,uuid,uuid,jsonb,text,bigint,uuid,boolean)",
      "record_grok_context_envelope_as_server(uuid,uuid,uuid,uuid,uuid,jsonb,text,bigint,boolean)",
      "append_grok_follow_up_context(uuid,uuid,uuid,text,jsonb,text,bigint,bigint,uuid)",
      "list_grok_context_envelopes(uuid,uuid,integer)",
      "search_path=pg_catalog",
      "prorettype",
      "pronargdefaults",
      "actual_md5 = state.source_md5",
      "has_function_privilege",
    ]) expect(postflight).toContain(proof);
  });

  it("runs rollback-only runtime, replay, adverse-tenant, and zero-execution proofs", () => {
    expect(postflight).toMatch(/^begin;/m);
    expect(postflight).toMatch(/rollback;\s*$/);
    expect(postflight).not.toMatch(/^\s*commit\s*;/im);
    for (const proof of [
      "replayed",
      "item_count",
      "total_bytes",
      "context.recorded",
      "workerWoken",
      "executionStarted",
      "plan_changed",
      "replan_required",
      "non_owner_read_was_not_blocked",
      "secret_was_not_blocked",
      "unlinked_integration_was_not_blocked",
      "private_url_was_not_blocked",
      "item_bound_was_not_blocked",
      "changed_replay_was_not_blocked",
      "cross_tenant_write_was_not_blocked",
      "update_was_not_blocked",
      "delete_was_not_blocked",
      "truncate_was_not_blocked",
      "public.graph_runs",
      "public.node_runs",
      "public.agent_runs",
      "public.provider_run_events",
      "public.graph_phase1c_bridges",
      "execution_must_remain_zero",
    ]) expect(postflight).toContain(proof);
    expect(source).not.toMatch(
      /^\s*(?:PHASE1C_WORKER_ENABLED|GRAPH_WORKER_ENABLED|GRAPH_WORKER_SCHEDULED):\s*(?:true|"true")\s*$/im,
    );
    expect(source).not.toMatch(/autonomy_kill_switch_active\s*=\s*false/i);
  });

  it("rehearses and lints both candidate and installed functions without residue", () => {
    const rehearsal = step("Rehearse exact migration and linked-database lint").run ?? "";
    const verify = step(
      "Verify exact catalog runtime immutability tenant safety and installed lint",
    ).run ?? "";
    for (const command of [rehearsal, verify]) {
      expect(command).toContain("plpgsql_check_function_tb");
      expect(command).toContain('if [ "$RESIDUE" != "0|0" ]');
    }
    expect(verify).toContain("rollback;");
    expect(postflight).toMatch(/rollback;\s*$/);
    expect(rehearsal).toContain(
      "insert into supabase_migrations.schema_migrations(version) values ('20260831001100')",
    );
    expect(rehearsal).toContain(
      "-f .github/grok-release/grok-context-envelopes-postflight.sql",
    );
    expect(rehearsal).toContain("grok-context-release-postflight-ok");
  });
});
