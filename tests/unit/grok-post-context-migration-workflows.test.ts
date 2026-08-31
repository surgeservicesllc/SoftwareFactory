// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

type WorkflowStep = Readonly<{
  name: string;
  if?: string;
  run?: string;
}>;

type Workflow = Readonly<{
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
}>;

const releases = [
  {
    label: "claim-context projection",
    version: "20260831001500",
    workflowPath: ".github/workflows/grok-claim-context-projection-migration.yml",
    migrationPath: "supabase/migrations/20260831001500_grok_claim_context_projection.sql",
    preflightPath: ".github/grok-release/grok-claim-context-projection-preflight.sql",
    postflightPath: ".github/grok-release/grok-claim-context-projection-postflight.sql",
    sha256: "4c33bcb908cb0b7a1972b4e2dc79d9fdc8bee13d118490e179afc2001a159e4b",
    confirm: "grok-claim-context-projection",
    preflightMarker: "grok-claim-context-release-preflight-ok",
    postflightMarker: "grok-claim-context-release-postflight-ok",
    functions: [
      "public.grok_initial_context_claim_projection(uuid)",
      "public.attach_current_grok_admissions_to_claim(jsonb)",
      "public.attach_current_grok_admission_to_phase1c_claim(jsonb)",
      "public.claim_planned_graph_v3(text,text[],text,jsonb,integer)",
      "public.claim_planned_graph_by_id_v3(text,text[],text,jsonb,uuid,integer)",
      "public.claim_phase1c_run_v3(text,text,text,integer,integer)",
      "public.claim_phase1c_run_by_command_v3(text,text,text,integer,uuid,integer)",
    ],
  },
  {
    label: "read-only research runtime",
    version: "20260831001700",
    workflowPath: ".github/workflows/grok-read-only-research-runtime-migration.yml",
    migrationPath: "supabase/migrations/20260831001700_grok_read_only_research_runtime.sql",
    preflightPath: ".github/grok-release/grok-read-only-research-runtime-preflight.sql",
    postflightPath: ".github/grok-release/grok-read-only-research-runtime-postflight.sql",
    sha256: "3fe4cf4b6d49b29ed927650ab1581d3e580352702c76f5f6f0a837094d603061",
    confirm: "grok-read-only-research",
    preflightMarker: "grok-read-only-research-release-preflight-ok",
    postflightMarker: "grok-read-only-research-release-postflight-ok",
    functions: [
      "public.launch_grok_read_only_research_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)",
    ],
  },
  {
    label: "admission-version null fence",
    version: "20260831001900",
    workflowPath: ".github/workflows/grok-admission-version-null-fence-migration.yml",
    migrationPath: "supabase/migrations/20260831001900_grok_admission_version_null_fence.sql",
    preflightPath: ".github/grok-release/grok-admission-version-null-fence-preflight.sql",
    postflightPath: ".github/grok-release/grok-admission-version-null-fence-postflight.sql",
    sha256: "a0dd4da859e5ed6cb65342f2e5b3962c07d672346bd06685052c6446e99c5221",
    confirm: "grok-admission-version-null-fence",
    preflightMarker: "grok-admission-version-null-fence-release-preflight-ok",
    postflightMarker: "grok-admission-version-null-fence-release-postflight-ok",
    functions: [
      "public.record_grok_specialist_roster_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,bigint)",
      "public.record_grok_specialist_roster_v2_as_server(uuid,uuid,uuid,uuid,uuid,text,bigint)",
      "public.launch_grok_full_lifecycle_v3_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)",
      "public.launch_grok_full_lifecycle_v4_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)",
      "public.launch_grok_read_only_research_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)",
      "public.launch_grok_read_only_research_v2_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)",
    ],
  },
] as const;

function load(release: (typeof releases)[number]) {
  const source = readFileSync(resolve(root, release.workflowPath), "utf8");
  const workflow = parse(source) as Workflow;
  const preflight = readFileSync(resolve(root, release.preflightPath), "utf8");
  const postflight = readFileSync(resolve(root, release.postflightPath), "utf8");
  const step = (name: string) => {
    const found = workflow.jobs.release.steps.find((candidate) => candidate.name === name);
    expect(found).toBeDefined();
    return found!;
  };
  return { source, workflow, preflight, postflight, step };
}

describe.each(releases)("protected $label migration lane", (release) => {
  const loaded = load(release);

  it("is manual serialized and least privilege", () => {
    expect(Object.keys(loaded.workflow.on)).toEqual(["workflow_dispatch"]);
    expect(Object.keys(loaded.workflow.on.workflow_dispatch.inputs)).toEqual([
      "operation", "confirm", "release_sha", "migration_sha256",
    ]);
    expect(loaded.workflow.on.workflow_dispatch.inputs.operation).toMatchObject({
      required: true,
      type: "choice",
      options: ["probe", "apply", "verify"],
    });
    expect(loaded.workflow.permissions).toEqual({
      actions: "read",
      checks: "read",
      contents: "read",
      deployments: "read",
    });
    expect(loaded.workflow.concurrency).toEqual({
      group: "apply-hosted-migrations",
      "cancel-in-progress": false,
    });
    expect(loaded.workflow.jobs.release["timeout-minutes"]).toBe(35);
  });

  it("pins exact release file canonical hash and confirmations", () => {
    expect(loaded.workflow.jobs.release.env).toMatchObject({
      PROJECT_REF: "qpuofpmagrmyamahqwxw",
      PRODUCTION_ORIGIN: "https://www.theagoras.com",
      VERCEL_PROJECT_ID: "prj_pAsrhftaVWI4SyaqstgRVSWHJkdD",
      MIGRATION_VERSION: release.version,
      MIGRATION_FILE: release.migrationPath,
      MIGRATION_SHA256: release.sha256,
    });
    const canonical = readFileSync(resolve(root, release.migrationPath), "utf8")
      .replace(/\r\n?/g, "\n");
    expect(createHash("sha256").update(canonical).digest("hex")).toBe(release.sha256);
    const authorize = loaded.step("Authorize one exact protected operation").run ?? "";
    for (const operation of ["probe", "apply", "verify"]) {
      expect(authorize).toContain(`${operation}:${operation}-${release.confirm}`);
    }
    for (const proof of [
      "PRODUCTION_RELEASE_ACTOR", "GITHUB_ACTOR", "GITHUB_TRIGGERING_ACTOR",
      "GITHUB_RUN_ATTEMPT", "surgeservicesllc/SoftwareFactory", "refs/heads/main",
      "^[0-9a-f]{40}$", "^[0-9a-f]{64}$",
    ]) expect(`${loaded.source}\n${authorize}`).toContain(proof);
  });

  it("requires exact green production health and stopped execution", () => {
    const gate = loaded.step(
      "Verify exact green production and stopped execution workflows",
    ).run ?? "";
    const final = loaded.step(
      "Reverify exact main health file identity and stopped workflows",
    ).run ?? "";
    for (const proof of [
      "CURRENT_MAIN_SHA", "GITHUB_SHA", "Lint, typecheck, test, and build",
      "Browser and accessibility tests 1/3", "Browser and accessibility tests 2/3",
      "Browser and accessibility tests 3/3", '.environment=="Production"',
      '.creator.login=="vercel[bot]"', ".releaseSha==$sha",
      ".databaseProjectRef==$project", ".vercelProjectId",
    ]) expect(gate).toContain(proof);
    for (const workflowName of [
      "graph-worker.yml", "codex-worker.yml", "claude-worker.yml", "auth-broker.yml",
      "graph-live-canary.yml", "handoff-canary.yml", "graph-artifact-containment.yml",
      "e2e-test-data.yml", "journey-prod-user.yml",
    ]) {
      expect(gate).toContain(workflowName);
      expect(final).toContain(workflowName);
    }
    for (const variable of [
      "PHASE1C_WORKER_ENABLED", "GRAPH_WORKER_ENABLED",
      "GRAPH_WORKER_SCHEDULED", "AUTH_BROKER_DISABLED",
    ]) {
      expect(gate).toContain(variable);
      expect(final).toContain(variable);
    }
  });

  it("stages and applies only the exact forward file and ledger row", () => {
    const stage = loaded.step("Stage exactly one canonical migration file").run ?? "";
    for (const proof of [
      "git ls-files --error-unmatch", "git diff --exit-code", "STAGED_MIGRATION",
      'replace(b"\\r\\n", b"\\n").replace(b"\\r", b"\\n")',
      "sha256sum", '!= "1"',
    ]) expect(stage).toContain(proof);
    const apply = loaded.step("Apply only the exact forward migration").run ?? "";
    expect(apply).toContain("--single-transaction");
    expect(apply).toContain("lock table supabase_migrations.schema_migrations");
    expect(apply).toContain(`-f ${release.preflightPath}`);
    expect(apply.match(/-f "\$STAGED_MIGRATION"/g)).toHaveLength(1);
    expect(apply).toContain(
      `insert into supabase_migrations.schema_migrations(version) values ('${release.version}')`,
    );
    expect(loaded.source).not.toMatch(
      /supabase\s+db\s+(?:push|reset)|migration\s+(?:down|repair)|\bgh\s+workflow\s+run\b|\/dispatches\b/i,
    );
  });

  it("pins ledger catalog ACL and stopped database prerequisites", () => {
    expect(loaded.preflight).toContain("unrelated_ledger_sha256");
    expect(loaded.preflight).toContain(release.version);
    for (const proof of [
      "autonomy_kill_switch_active is distinct from true", "autonomous_mode",
      "auto_plan", "auto_code", "auto_test", "auto_repair", "auto_review",
      "auto_approve", "auto_merge", "auto_deploy", "auto_rollback",
      "last_heartbeat_at > pg_catalog.now() - interval '10 minutes'",
      "current_run_id is not null", "state = 'RUNNING'", "status = 'running'",
      "grok_phase1c_submission_guards", "search_path=pg_catalog",
      "has_function_privilege",
    ]) expect(loaded.preflight).toContain(proof);
    for (const signature of release.functions) {
      expect(loaded.preflight).toContain(signature);
      expect(loaded.postflight).toContain(signature);
    }
    expect(loaded.preflight).not.toMatch(
      /^\s*(?:insert|update|delete|truncate|alter|create|drop|grant|revoke|notify)\b/im,
    );
  });

  it("rehearses and lints candidate and installed functions without residue", () => {
    const rehearsal = loaded.step("Rehearse exact migration and linked-database lint").run ?? "";
    const verify = loaded.step(
      "Verify exact catalog runtime immutability tenant safety and installed lint",
    ).run ?? "";
    for (const command of [rehearsal, verify]) {
      expect(command).toContain("plpgsql_check_function_tb");
      expect(command).toContain('if [ "$RESIDUE" != "0|0" ]');
    }
    expect(rehearsal).toContain(`-f ${release.postflightPath}`);
    expect(rehearsal).toContain(release.postflightMarker);
    expect(verify).toContain("rollback;");
    expect(loaded.postflight).toMatch(/^begin;/m);
    expect(loaded.postflight).toMatch(/rollback;\s*$/);
    expect(loaded.postflight).not.toMatch(/^\s*commit\s*;/im);
  });
});

describe("post-context migration release order and adverse behavior", () => {
  const context = load(releases[0]);
  const research = load(releases[1]);
  const fence = load(releases[2]);

  it("requires 015 before every later migration", () => {
    for (const version of [
      "20260831001100", "20260831001200", "20260831001300", "20260831001400",
    ]) expect(context.preflight).toContain(version);
    expect(context.preflight).toContain("migration.version > '20260831001500'");
    expect(context.preflight).toContain("grok_claim_context_release_absent_ledger_or_catalog_mismatch");
    expect(research.preflight).toContain("20260831001500");
    expect(research.preflight).toContain("20260831001600");
    expect(research.preflight).toContain("grok_initial_context_claim_projection(uuid)");
    expect(research.preflight).toContain("migration.version > '20260831001700'");
  });

  it("proves immutable initial-only context and zero-run claim safety", () => {
    for (const proof of [
      "replayed", "grok_initial_context_claim_projection", "initial_projection_mismatch",
      "replan_required", "follow_up_boundary_mismatch", "secret_tamper_was_not_blocked",
      "Keep the owner goal intact.", "workerWoken", "executionStarted",
      "public.graph_runs", "public.agent_runs", "public.provider_run_events",
      "public.graph_phase1c_bridges",
    ]) expect(context.postflight).toContain(proof);
  });

  it("proves exact research pause replay admission adverse cases and zero execution", () => {
    for (const proof of [
      "e028c29915d50f0eb7773affa146fae7", "relrowsecurity",
      "relforcerowsecurity", "aclexplode", "idempotent_replay_mismatch",
      "cross_tenant_owner_was_not_blocked", "changed_replay_was_not_blocked",
      "write_node_was_not_blocked", "pause_requested_at", "writes = '[]'::jsonb",
      "assert_current_grok_execution_admissions", "workerWoken", "executionStarted",
      "public.graph_runs", "public.node_runs", "public.agent_runs",
      "public.provider_run_events", "public.graph_phase1c_bridges",
    ]) expect(research.postflight).toContain(proof);
    expect(research.source).not.toMatch(
      /^\s*(?:PHASE1C_WORKER_ENABLED|GRAPH_WORKER_ENABLED|GRAPH_WORKER_SCHEDULED):\s*(?:true|"true")\s*$/im,
    );
    expect(research.source).not.toMatch(/autonomy_kill_switch_active\s*=\s*false/i);
  });

  it("proves the 019 exact null fence ACL contraction and zero-residue runtime", () => {
    expect(fence.workflow.jobs.release.env).toMatchObject({ MIGRATION_BYTES: "8404" });
    expect(fence.step("Stage exactly one canonical migration file").run).toContain(
      'ACTUAL_BYTES=$(wc -c < "$STAGED_MIGRATION"',
    );
    for (const version of ["20260831001500", "20260831001600", "20260831001700"]) {
      expect(fence.preflight).toContain(version);
    }
    for (const hash of [
      "8c8276ef3a0d5bf27204a836788f736f",
      "4e41c8e312bca5fb13773dd0c9fbf19f",
      "e028c29915d50f0eb7773affa146fae7",
      "f9b3b947feccfe16eec03916cb3330fb",
      "1f4e57b243466f21a67215712307eb76",
      "2cb5d0d85ecff30add9c7e21711bf434",
    ]) expect(`${fence.preflight}\n${fence.postflight}`).toContain(hash);
    for (const proof of [
      "null_roster_version_was_not_blocked",
      "missing_roster_version_was_not_blocked",
      "wrong_roster_version_was_not_blocked",
      "roster_rejection_left_residue",
      "null_admission_version_was_not_blocked",
      "missing_admission_version_was_not_blocked",
      "wrong_admission_version_was_not_blocked",
      "v4_null_version_was_not_blocked",
      "v4_missing_version_was_not_blocked",
      "v4_wrong_version_was_not_blocked",
      "admission_rejection_left_residue",
      "roster_replay_mismatch",
      "idempotent_replay_mismatch",
      "aclexplode",
      "service_role_execute",
      "workerWoken",
      "executionStarted",
    ]) expect(fence.postflight).toContain(proof);
    expect(fence.source).toContain("record_grok_specialist_roster_v2_as_server");
    expect(fence.source).toContain("launch_grok_full_lifecycle_v4_as_server");
    expect(fence.source).toContain("launch_grok_read_only_research_v2_as_server");
    expect(fence.source).not.toMatch(/autonomy_kill_switch_active\s*=\s*false/i);
  });
});
