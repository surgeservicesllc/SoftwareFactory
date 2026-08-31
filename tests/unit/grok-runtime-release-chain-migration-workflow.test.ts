// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const workflowPath = ".github/workflows/grok-runtime-release-chain-migrations.yml";
const preflightPath = ".github/grok-release/grok-runtime-release-chain-preflight.sql";
const postflightPath = ".github/grok-release/grok-runtime-release-chain-postflight.sql";
const lintPath = ".github/grok-release/grok-runtime-release-chain-lint.sql";
const dedicated019PreflightPath =
  ".github/grok-release/grok-admission-version-null-fence-preflight.sql";
const dedicated019PostflightPath =
  ".github/grok-release/grok-admission-version-null-fence-postflight.sql";

const migrations = [
  {
    slot: "018",
    version: "20260831001800",
    path: "supabase/migrations/20260831001800_grok_deploy_readiness_runtime.sql",
    sha256: "7c401a943833bc2fd7fc505cf3692012077180a3198f00ec9760b3a46dcc4444",
    bytes: 41_937,
  },
  {
    slot: "019",
    version: "20260831001900",
    path: "supabase/migrations/20260831001900_grok_admission_version_null_fence.sql",
    sha256: "a0dd4da859e5ed6cb65342f2e5b3962c07d672346bd06685052c6446e99c5221",
    bytes: 8_404,
  },
  {
    slot: "020",
    version: "20260831002000",
    path: "supabase/migrations/20260831002000_exact_graph_repository_workspace.sql",
    sha256: "6bdcbdaa5a0b6f512a53ed72c513da02ce2d8042d28157e70f497a6ded4f3057",
    bytes: 19_411,
  },
  {
    slot: "021",
    version: "20260831002100",
    path: "supabase/migrations/20260831002100_grok_initial_wake_receipts.sql",
    sha256: "838f300d25c6a44f6632ed883010066524da229e165598968c7cdd7dab583b16",
    bytes: 37_089,
  },
] as const;

const source = readFileSync(resolve(root, workflowPath), "utf8");
const preflight = readFileSync(resolve(root, preflightPath), "utf8");
const postflight = readFileSync(resolve(root, postflightPath), "utf8");
const lint = readFileSync(resolve(root, lintPath), "utf8");
const dedicated019Preflight = readFileSync(
  resolve(root, dedicated019PreflightPath),
  "utf8",
);
const dedicated019Postflight = readFileSync(
  resolve(root, dedicated019PostflightPath),
  "utf8",
);

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

function canonical(path: string) {
  return readFileSync(resolve(root, path), "utf8").replace(/\r\n?/g, "\n");
}

describe("Grok runtime release-chain protected workflow", () => {
  it("is one manual serialized least-privilege probe/apply-one/verify lane", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
      "operation",
      "confirm",
      "release_sha",
    ]);
    expect(workflow.on.workflow_dispatch.inputs.operation).toMatchObject({
      required: true,
      type: "choice",
      options: ["probe", "apply-one", "verify"],
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
    expect(workflow.jobs.release["timeout-minutes"]).toBe(45);
    expect(source).not.toMatch(/^\s*(?:schedule|push|pull_request):/m);
  });

  it("requires the exact actor, first attempt, main SHA, and confirmation", () => {
    const authorize = step("Authorize the exact protected operation").run ?? "";
    for (const proof of [
      "probe:probe-grok-runtime-release-chain",
      "apply-one:apply-one-grok-runtime-release-chain",
      "verify:verify-grok-runtime-release-chain",
      "PRODUCTION_RELEASE_ACTOR",
      "GITHUB_ACTOR",
      "GITHUB_TRIGGERING_ACTOR",
      "GITHUB_RUN_ATTEMPT",
      "surgeservicesllc/SoftwareFactory",
      "refs/heads/main",
      "^[0-9a-f]{40}$",
    ]) expect(`${source}\n${authorize}`).toContain(proof);
    expect(step("Check out the exact release")).toMatchObject({
      uses: "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
      with: {
        ref: "${{ inputs.release_sha }}",
        "persist-credentials": false,
      },
    });
  });

  it("pins all four committed canonical-LF file and byte identities", () => {
    expect(workflow.jobs.release.env).toMatchObject({
      PROJECT_REF: "qpuofpmagrmyamahqwxw",
      PRODUCTION_ORIGIN: "https://www.theagoras.com",
      PRODUCTION_HEALTH_URL: "https://www.theagoras.com/api/health",
      VERCEL_PROJECT_ID: "prj_pAsrhftaVWI4SyaqstgRVSWHJkdD",
    });
    for (const migration of migrations) {
      expect(workflow.jobs.release.env[`MIGRATION_${migration.slot}_FILE`]).toBe(
        migration.path,
      );
      expect(workflow.jobs.release.env[`MIGRATION_${migration.slot}_SHA256`]).toBe(
        migration.sha256,
      );
      expect(Number(workflow.jobs.release.env[`MIGRATION_${migration.slot}_BYTES`])).toBe(
        migration.bytes,
      );
      const body = canonical(migration.path);
      expect(Buffer.byteLength(body)).toBe(migration.bytes);
      expect(createHash("sha256").update(body).digest("hex")).toBe(migration.sha256);
    }
    expect(source).not.toContain(
      "ca6a5d4bbe5fbb30009f6b3f1bc81e1b0081472d2cc398832aae352ddab77b24",
    );
    const stage = step("Stage the four exact canonical LF files").run ?? "";
    for (const proof of [
      "git ls-files --error-unmatch",
      "git diff --exit-code",
      'replace(b"\\r\\n", b"\\n").replace(b"\\r", b"\\n")',
      "sha256sum",
      '!= "4"',
    ]) expect(stage).toContain(proof);
  });

  it("binds exact-head green CI to one exact READY Vercel and health identity", () => {
    const gate = step(
      "Verify exact green READY production and stopped execution",
    ).run ?? "";
    const apply = step("Apply only the next ordered forward migration").run ?? "";
    const final = step(
      "Reverify exact identities ledger and stopped containment",
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
      '.sha==$sha',
      '.state=="success"',
      ".deploymentUrl==$deployment_url",
      ".vercelDeploymentId",
      ".vercelProjectId==$vercel_project",
      ".databaseProjectRef==$project",
      '.releaseSha==$sha',
      '.releaseRef=="main"',
    ]) expect(gate).toContain(proof);
    for (const proof of [
      "VERCEL_DEPLOYMENT_URL",
      "VERCEL_DEPLOYMENT_ID",
      "VERCEL_PROJECT_ID",
      "databaseProjectRef",
      "releaseRef",
    ]) {
      expect(apply).toContain(proof);
      expect(final).toContain(proof);
    }
    expect(final).toContain("GITHUB_DEPLOYMENT_ID");
  });

  it("keeps workflows, schedules, auth broker, autonomy, actions, and workers stopped", () => {
    const gate = step(
      "Verify exact green READY production and stopped execution",
    ).run ?? "";
    const apply = step("Apply only the next ordered forward migration").run ?? "";
    const final = step(
      "Reverify exact identities ledger and stopped containment",
    ).run ?? "";
    const gateContract = JSON.stringify(step(
      "Verify exact green READY production and stopped execution",
    ));
    const applyContract = JSON.stringify(step(
      "Apply only the next ordered forward migration",
    ));
    const finalContract = JSON.stringify(step(
      "Reverify exact identities ledger and stopped containment",
    ));
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
      expect(apply).toContain(workflowName);
      expect(final).toContain(workflowName);
    }
    for (const variable of [
      "SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED",
      "SOFTWAREFACTORY_GRAPH_WORKER_ENABLED",
      "SOFTWAREFACTORY_GRAPH_WORKER_SCHEDULED",
      "SOFTWAREFACTORY_AUTH_BROKER_DISABLED",
    ]) {
      expect(gateContract).toContain(variable);
      expect(applyContract).toContain(variable);
      expect(finalContract).toContain(variable);
    }
    for (const proof of [
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
    expect(source).not.toMatch(
      /^\s*(?:PHASE1C_WORKER_ENABLED|GRAPH_WORKER_ENABLED|GRAPH_WORKER_SCHEDULED):\s*(?:true|"true")\s*$/im,
    );
    expect(source).not.toContain("/actions/variables");
    expect(source).not.toMatch(/autonomy_kill_switch_active\s*=\s*false/i);
  });

  it("accepts only a gap-free prefix and resolves no caller-selected migration", () => {
    const resolveNext = step("Resolve only the next eligible migration").run ?? "";
    expect(preflight).toContain("('0000', '1000', '1100', '1110', '1111')");
    expect(preflight).toContain("grok_runtime_release_later_version_present");
    expect(preflight).toContain("migration.version > '20260831002100'");
    expect(preflight).toContain("grok_runtime_release_unrelated_ledger_changed");
    expect(preflight).toContain("grok_runtime_release_next_version_changed");
    expect(preflight).toContain("grok_runtime_release_has_no_next_forward_migration");
    for (const migration of migrations) expect(preflight).toContain(migration.version);
    expect(preflight).toMatch(/when '0000' then '20260831001800'/);
    expect(preflight).toMatch(/when '1000' then '20260831001900'/);
    expect(preflight).toMatch(/when '1100' then '20260831002000'/);
    expect(preflight).toMatch(/when '1110' then '20260831002100'/);
    expect(preflight).toMatch(/when '1111' then 'complete'/);
    expect(resolveNext).toContain('[ "$BEFORE_PREFIX" = "0000" ]');
    expect(resolveNext).toContain('[ "$BEFORE_PREFIX" = "1000" ]');
    expect(resolveNext).toContain(
      "chain-native predecessor fingerprint preserves 017 after 019 revokes its old service endpoint",
    );
    expect(preflight).not.toMatch(
      /^\s*(?:insert|update|delete|truncate|alter|create|drop|grant|revoke|notify)\b/im,
    );
    expect(workflow.on.workflow_dispatch.inputs).not.toHaveProperty("migration");
    expect(workflow.on.workflow_dispatch.inputs).not.toHaveProperty("version");
    expect(workflow.on.workflow_dispatch.inputs).not.toHaveProperty("scope");
  });

  it("rehearses and applies exactly one resolved staged file and ledger row", () => {
    const rehearsal = step("Rehearse only the next migration and linked lint").run ?? "";
    const apply = step("Apply only the next ordered forward migration").run ?? "";
    expect(rehearsal.match(/-f "\$STAGED_MIGRATION"/g)).toHaveLength(1);
    expect(apply.match(/-f "\$STAGED_MIGRATION"/g)).toHaveLength(1);
    expect(rehearsal).toContain(
      "insert into supabase_migrations.schema_migrations(version) values (:'next_version')",
    );
    expect(apply).toContain(
      "insert into supabase_migrations.schema_migrations(version) values (:'next_version')",
    );
    expect(apply).toContain("--single-transaction");
    expect(apply).toContain("lock table supabase_migrations.schema_migrations");
    expect(apply).toContain('expected_next_version="$NEXT_VERSION"');
    expect(apply).toContain(
      "-f .github/grok-release/grok-runtime-release-chain-preflight.sql",
    );
    expect(apply).toContain(
      "-f .github/grok-release/grok-runtime-release-chain-postflight.sql",
    );
    expect(source).not.toMatch(
      /supabase\s+db\s+(?:push|reset)|migration\s+(?:down|repair)|\bgh\s+workflow\s+run\b|\/dispatches\b|\bgit\s+push\b/i,
    );
  });

  it("retains the unchanged dedicated 019 release safeguards", () => {
    expect(createHash("sha256").update(canonical(dedicated019PreflightPath)).digest("hex"))
      .toBe("88b2e2d8cbd4a57516b7115ae15ce504eaaa456a976b0d9bce2763a9cd0767b3");
    expect(createHash("sha256").update(canonical(dedicated019PostflightPath)).digest("hex"))
      .toBe("11aa0a343f34c37fbb333be8cf49311172a841e9a2615b85f41e12b90e1685e9");
    const preserve = step("Preserve the exact dedicated 019 safeguards").run ?? "";
    const rehearsal = step("Rehearse only the next migration and linked lint").run ?? "";
    const verify = step(
      "Verify exact prefix catalog ACL RLS audit runtime and lint",
    ).run ?? "";
    for (const path of [dedicated019PreflightPath, dedicated019PostflightPath]) {
      expect(`${preserve}\n${rehearsal}\n${verify}`).toContain(`-f ${path}`);
    }
    for (const proof of [
      "f9b3b947feccfe16eec03916cb3330fb",
      "1f4e57b243466f21a67215712307eb76",
      "2cb5d0d85ecff30add9c7e21711bf434",
      "8c8276ef3a0d5bf27204a836788f736f",
      "4e41c8e312bca5fb13773dd0c9fbf19f",
      "e028c29915d50f0eb7773affa146fae7",
      "grok_admission_fence_postflight_roster_replay_mismatch",
      "grok_admission_fence_postflight_idempotent_replay_mismatch",
      "grok_admission_fence_postflight_cross_tenant_owner_was_not_blocked",
    ]) expect(`${dedicated019Preflight}\n${dedicated019Postflight}`).toContain(proof);
  });

  it("pins native function bodies, signatures, security, search paths, and exact ACLs", () => {
    for (const proof of [
      "06c7fb24b7c4b50bbf80aee57385ff57",
      "c1075dafaa5bc957d16ff2599382a811",
      "2562fa378097239ce4a3e47e9121d410",
      "4a6da8bed8d1fdda17f11df00d549817",
      "f83873aa19703d2c61553026d4141a4c",
      "ef8803cb5ec809266b8fdf6f048b1a2f",
      "14c204c6c9d8da1ed6038d0f56942be8",
      "e8c53d578a6c03a45239d1df531dafb1",
      "07d1b171531f172882601ff3748c5830",
      "e7747781fc873442b2d8204d7aac9366",
      "ae7f04c8179e76599857905ac8ffb310",
      "77a19916949510d970da271d54fd051a",
      "ef92138092840861e8396b16f163462e",
      "1bf01dddd4f0cc34d424ca140e317060",
      "99cb0a44a597c7837cf1545422564554",
      "4dff24999b2dc60901164b4ae3c9121b",
      "c0d97d5427c3ba6e6f214f9a7e43352b",
      "3d9e625a675c88fd56e218b588b3f6a5",
      "search_path=pg_catalog",
      "routine.prosecdef",
      "routine.prorettype",
      "routine.pronargs",
      "routine.proacl",
      "aclexplode",
      "has_function_privilege",
      "service_before_019",
      "owner_only",
      "authenticated",
      "service_role",
    ]) expect(postflight).toContain(proof);
  });

  it("verifies wake RLS, ACL, constraints, indexes, immutable audit triggers, and denial runtime", () => {
    for (const proof of [
      "grok_graph_wake_intents",
      "grok_graph_wake_dispatch_attempts",
      "grok_graph_wake_receipts",
      "relrowsecurity",
      "relforcerowsecurity",
      "_select_member",
      "is_organization_member(organization_id)",
      "grok_graph_wake_intents_consecutive_revision",
      "grok_graph_wake_dispatch_outcome_shape",
      "grok_graph_wake_receipts_run_fk",
      "grok_graph_wake_intents_graph_revision_idx",
      "grok_graph_wake_dispatch_intent_idx",
      "grok_graph_wake_receipts_session_idx",
      "_immutable",
      "_no_truncate",
      "trigger_row.tgtype = expected.trigger_type",
      "reject_grok_evidence_mutation()",
      "021_unauthorized_resume_was_not_blocked",
      "021_invalid_dispatch_was_not_blocked",
      "021_unauthorized_read_was_not_blocked",
      "runtime_probe_left_residue",
    ]) expect(postflight).toContain(proof);
  });

  it("runs linked lint only after the intentional 018 forward dependency exists", () => {
    const rehearsal = step("Rehearse only the next migration and linked lint").run ?? "";
    const verify = step(
      "Verify exact prefix catalog ACL RLS audit runtime and lint",
    ).run ?? "";
    expect(rehearsal).toContain('NEXT_VERSION" != "20260831001800');
    expect(verify).toContain("Linked lint is deferred until 019 installs");
    for (const command of [rehearsal, verify]) {
      expect(command).toContain("plpgsql_check");
      expect(command).toContain('if [ "$RESIDUE" != "0|0" ]');
      expect(command).toContain("grok-runtime-release-chain-lint.sql");
    }
    expect(lint).toContain("plpgsql_check_function_tb");
    expect(lint).toContain("finding.level in ('error', 'warning', 'extra')");
    for (const migration of migrations) expect(lint).toContain(migration.version);
  });

  it("keeps rollback control outside the reusable postflight and never commits a probe", () => {
    expect(postflight).not.toMatch(/^\s*(?:begin|commit|rollback)\s*;/im);
    const rehearsal = step("Rehearse only the next migration and linked lint").run ?? "";
    expect(rehearsal).toContain('-c "begin;');
    expect(rehearsal).toContain('PSQL_ARGS+=(-c "rollback;")');
    expect(dedicated019Postflight).toMatch(/^begin;/m);
    expect(dedicated019Postflight).toMatch(/rollback;\s*$/);
    expect(dedicated019Postflight).not.toMatch(/^\s*commit\s*;/im);
  });

  it("stays below the GitHub workflow size ceiling and leaves action pins immutable", () => {
    expect(Buffer.byteLength(source)).toBeLessThan(490_000);
    const actionReferences = [...source.matchAll(/uses:\s*([^\s]+)/g)].map((match) => match[1]);
    expect(actionReferences).toEqual([
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    ]);
    expect(actionReferences.every((reference) => /@[0-9a-f]{40}$/.test(reference))).toBe(true);
  });
});
