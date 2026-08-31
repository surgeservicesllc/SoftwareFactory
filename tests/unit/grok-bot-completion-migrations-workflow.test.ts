// @vitest-environment node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const workflowPath = ".github/workflows/grok-bot-completion-migrations.yml";
const migrations = [
  {
    stem: "MIGRATION_PROVIDER_ADMISSION",
    path: "supabase/migrations/20260831000100_grok_provider_admission.sql",
    hash: "37809d9b3d9bc760ffbee501fcca383f0daa5665fb047964734603ceed41aef7",
  },
  {
    stem: "MIGRATION_TRANSACTIONAL_NOTICES",
    path: "supabase/migrations/20260831000700_transactional_notices.sql",
    hash: "c4c562b06d61cdf67283cefa2b0ef12b35d64d33e22398d6c71b273d000b363b",
  },
  {
    stem: "MIGRATION_AUTOPAY_AUTHORIZATION",
    path: "supabase/migrations/20260831000800_autopay_authorization.sql",
    hash: "41875a16a58deb6945affa24ecf0adf6493875788ef8da3a1c7cd03f98afb4b2",
  },
  {
    stem: "MIGRATION_CLAIM_ADMISSION",
    path: "supabase/migrations/20260831000900_grok_claim_admission_fence.sql",
    hash: "7f2dc3b80e466b3c06f589ac6383fd768df847d66e02ec0cab53b8d8431ab737",
  },
  {
    stem: "MIGRATION_SPECIALIST_PLANNING",
    path: "supabase/migrations/20260831001000_grok_specialist_admission_planning.sql",
    hash: "728628f0368e1f715d8c786ffb536d2d3fcc3a859a177a0665a00ea98a8386f1",
  },
] as const;

const source = readFileSync(resolve(root, workflowPath), "utf8");
const workflow = parse(source) as {
  on: {
    workflow_dispatch: {
      inputs: {
        scope: {
          default: string;
          required: boolean;
          type: string;
          options: string[];
        };
        confirm: { default: string; required: boolean; type: string };
        release_sha: { required: boolean; type: string };
      };
    };
  };
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: {
    release: {
      "timeout-minutes": number;
      env: Record<string, string>;
      steps: Array<{
        name: string;
        if?: string;
        env?: Record<string, string>;
        run?: string;
      }>;
    };
  };
};

const steps = workflow.jobs.release.steps;

function stepByName(name: string) {
  const step = steps.find((candidate) => candidate.name === name);
  expect(step).toBeDefined();
  return step!;
}

describe("Grok Bot completion migration workflow", () => {
  it("is manual, serialized with every hosted apply, and least privilege", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch.inputs.scope).toMatchObject({
      default: "probe",
      required: true,
      type: "choice",
      options: [
        "probe",
        "claim-admission-fence",
        "specialist-admission-planning",
        "verify",
      ],
    });
    expect(workflow.on.workflow_dispatch.inputs.confirm).toMatchObject({
      default: "",
      required: false,
      type: "string",
    });
    expect(workflow.on.workflow_dispatch.inputs.release_sha).toEqual({
      description:
        "Exact lowercase 40-character SoftwareFactory main SHA already green and READY in Production.",
      required: true,
      type: "string",
    });
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
      "scope",
      "confirm",
      "release_sha",
    ]);
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
    expect(workflow.jobs.release["timeout-minutes"]).toBe(20);
    expect(workflow.jobs.release.env.PROJECT_REF).toBe("qpuofpmagrmyamahqwxw");
    expect(workflow.jobs.release.env.VERCEL_PROJECT_ID).toBe(
      "prj_pAsrhftaVWI4SyaqstgRVSWHJkdD",
    );
  });

  it("pins the accepted provider/notices/autopay prerequisites and exact ordered 00900/01000 bytes", () => {
    for (const migration of migrations) {
      expect(workflow.jobs.release.env[migration.stem]).toBe(migration.path);
      expect(workflow.jobs.release.env[`${migration.stem}_SHA256`]).toBe(
        migration.hash,
      );
      const absolute = resolve(root, migration.path);
      expect(existsSync(absolute)).toBe(true);
      const normalized = readFileSync(absolute, "utf8").replace(/\r\n?/g, "\n");
      expect(createHash("sha256").update(normalized).digest("hex")).toBe(
        migration.hash,
      );
    }
    const identity = stepByName(
      "Verify the five exact LF-normalized forward files",
    ).run ?? "";
    expect(identity.match(/verify_file/g)).toHaveLength(6);
    expect(identity).toContain('replace(b"\\r\\n", b"\\n").replace(b"\\r", b"\\n")');
    expect(identity).toContain("^[0-9a-f]{64}$");
    expect(source).not.toContain("20260831000500_grok_claim_admission_fence");
    expect(source).not.toContain("20260831000600_grok_specialist_admission_planning");
    expect(source).not.toContain("20260831000800_grok_claim_admission_fence");
    expect(source).not.toContain("20260831000900_grok_specialist_admission_planning");
  });

  it("requires first-attempt configured-actor mutation authorization", () => {
    const step = stepByName("Authorize the exact mutation scope");
    expect(step.env).toEqual({
      AUTHORIZED_ACTOR: "${{ vars.PRODUCTION_RELEASE_ACTOR }}",
      SCOPE: "${{ inputs.scope }}",
      CONFIRM: "${{ inputs.confirm }}",
    });
    const command = step.run ?? "";
    expect(command).toContain("probe|verify) exit 0");
    expect(command).toContain(
      "claim-admission-fence|specialist-admission-planning)",
    );
    expect(command).toContain('[ "$CONFIRM" != "apply" ]');
    expect(command).toContain('[ "$GITHUB_ACTOR" != "$AUTHORIZED_ACTOR" ]');
    expect(command).toContain(
      '[ "$GITHUB_TRIGGERING_ACTOR" != "$AUTHORIZED_ACTOR" ]',
    );
    expect(command).toContain('[ "$GITHUB_RUN_ATTEMPT" != "1" ]');
  });

  it("requires exact main, all four exact-head checks, READY Vercel, health, and project", () => {
    const gate = stepByName(
      "Verify exact green production and stopped execution workflows",
    ).run ?? "";
    for (const evidence of [
      "RELEASE_SHA",
      "^[0-9a-f]{40}$",
      "surgeservicesllc/SoftwareFactory",
      "refs/heads/main",
      "Lint, typecheck, test, and build",
      "Browser and accessibility tests 1/3",
      "Browser and accessibility tests 2/3",
      "Browser and accessibility tests 3/3",
      '.environment=="Production"',
      '.creator.login=="vercel[bot]"',
      ".sha==$sha",
      '.[0].state=="success"',
      "PRODUCTION_HEALTH_URL",
      '.databaseProject=="matched"',
      ".databaseProjectRef==$project",
      '.deployment=="matched"',
      ".deploymentUrl==$deployment_url",
      ".vercelProjectId==$vercel_project",
      '.release=="matched"',
      ".releaseSha==$sha",
      '.releaseRef=="main"',
      "EXPECTED_VERCEL_DEPLOYMENT_URL",
      "EXPECTED_VERCEL_DEPLOYMENT_ID",
    ]) {
      expect(gate).toContain(evidence);
    }
  });

  it("keeps workers, schedules, broker, autonomy, and automatic actions stopped", () => {
    const gate = stepByName(
      "Verify exact green production and stopped execution workflows",
    ).run ?? "";
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
    }
    expect(gate).toContain('select(.status != "completed")');
    for (const variable of [
      "PHASE1C_WORKER_ENABLED",
      "GRAPH_WORKER_ENABLED",
      "GRAPH_WORKER_SCHEDULED",
      "AUTH_BROKER_DISABLED",
    ]) {
      expect(gate).toContain(variable);
    }

    const preflight = stepByName(
      "Verify exact ordered ledger catalog and stopped database state",
    ).run ?? "";
    const apply = stepByName(
      "Apply exactly one ordered forward completion migration",
    ).run ?? "";
    for (const command of [preflight, apply]) {
      for (const evidence of [
        "autonomy_kill_switch_active is distinct from true",
        "auto_plan",
        "auto_code",
        "auto_test",
        "auto_repair",
        "auto_review",
        "auto_approve",
        "auto_merge",
        "auto_deploy",
        "auto_rollback",
        "last_heartbeat_at>now()-interval '10 minutes'",
        "last_heartbeat_at>now()+interval '1 minute'",
        "current_run_id is not null",
        "state='RUNNING'",
        "status='running'",
      ]) {
        expect(command.replace(/\s+/g, "")).toContain(
          evidence.replace(/\s+/g, ""),
        );
      }
    }
    expect(source).not.toMatch(
      /(?:autonomous_mode|auto_(?:plan|code|test|repair|review|approve|merge|deploy|rollback))\s*=\s*true/i,
    );
    expect(source).not.toMatch(/autonomy_kill_switch_active\s*=\s*false/i);
  });

  it("requires the exact accepted prefix and ordered completion ledger", () => {
    const preflight = stepByName(
      "Verify exact ordered ledger catalog and stopped database state",
    ).run ?? "";
    for (const version of [
      "20260831000100",
      "20260831000200",
      "20260831000300",
      "20260831000400",
      "20260831000500",
      "20260831000600",
      "20260831000700",
      "20260831000800",
    ]) {
      expect(preflight).toContain(version);
    }
    for (const state of [
      "probe:0\\|0",
      "probe:1\\|0",
      "probe:1\\|1",
      "claim-admission-fence:0\\|0",
      "specialist-admission-planning:1\\|0",
      "verify:1\\|1",
    ]) {
      expect(preflight).toContain(state);
    }
    for (const catalogState of [
      "0\\|0:0\\|0:0\\|0",
      "1\\|0:1\\|16:0\\|0",
      "1\\|1:1\\|16:1\\|5",
    ]) {
      expect(preflight).toContain(catalogState);
    }
  });

  it("treats only the sixteen genuinely new claim routines as pristine-catalog objects", () => {
    const apply = stepByName(
      "Apply exactly one ordered forward completion migration",
    ).run ?? "";
    const claimScope = /claim-admission-fence\)\s*([\s\S]*?)\n\s*specialist-admission-planning\)/
      .exec(apply)?.[1] ?? "";
    const pristineGuard = /CATALOG_GUARD="([\s\S]*?)claim-admission fence catalog is not pristine/
      .exec(claimScope)?.[1] ?? "";

    expect(pristineGuard).not.toBe("");
    for (const name of [
      "grok_current_execution_admission_hash",
      "assert_current_grok_execution_admissions",
      "grok_execution_admission_projection",
      "attach_current_grok_admissions_to_claim",
      "claim_planned_graph_v3",
      "claim_planned_graph_by_id_v3",
      "attach_current_grok_admission_to_phase1c_claim",
      "is_current_grok_phase1c_submission_authorized",
      "validate_current_grok_phase1c_command_route",
      "current_grok_phase1c_claim_route",
      "claim_phase1c_run_v3",
      "claim_phase1c_run_by_command_v3",
      "read_grok_execution_credential_as_worker",
      "apply_grok_graph_control_v2_as_owner",
      "set_graph_pause_as_member_v2",
      "assert_grok_graph_admission_as_member",
    ]) {
      expect(pristineGuard.match(new RegExp(`'${name}'`, "g"))).toHaveLength(1);
    }
    for (const preExistingSelector of [
      "claim_phase1c_run_target_budget_internal",
      "claim_phase1c_run_target_internal",
      "claim_phase1c_run_budget_internal",
    ]) {
      expect(pristineGuard).not.toContain(preExistingSelector);
    }
  });

  it("stages and applies exactly one LF-normalized file in one locked transaction", () => {
    const step = stepByName(
      "Apply exactly one ordered forward completion migration",
    );
    expect(step.if).toBe(
      "${{ inputs.scope == 'claim-admission-fence' || inputs.scope == 'specialist-admission-planning' }}",
    );
    const command = step.run ?? "";
    for (const evidence of [
      "claim-admission-fence)",
      "VERSION=20260831000900",
      "specialist-admission-planning)",
      "VERSION=20260831001000",
      "STAGE_DIR=$(mktemp -d)",
      'find "$STAGE_DIR" -maxdepth 1 -type f',
      'replace(b"\\r\\n", b"\\n").replace(b"\\r", b"\\n")',
      "plpgsql_check_function_tb",
      "where language_row.lanname='plpgsql'",
      "finding.level in ('error','warning','extra')",
      "EXTENSION_BASELINE",
      "EXTENSION_RESIDUE",
      "--single-transaction",
      "set local lock_timeout='15s'",
      "set local statement_timeout='10min'",
      "lock table supabase_migrations.schema_migrations in share row exclusive mode",
      '-f "$STAGED_FILE"',
      "insert into supabase_migrations.schema_migrations(version) values ('${VERSION}')",
    ]) {
      expect(command).toContain(evidence);
    }
    expect(command.match(/-f "\$STAGED_FILE"/g)).toHaveLength(2);
    expect(command).not.toMatch(/supabase\s+db\s+(?:push|reset)/i);
    expect(command).not.toMatch(/down[-_ ]?migrat/i);
    expect(command).not.toMatch(/migration\s+repair/i);
    expect(command).not.toContain("supabase/migrations/*.sql");
  });

  it("keeps probe and verify read-only", () => {
    const mutating = steps.filter((step) =>
      /Apply exactly|Reload the PostgREST/.test(step.name),
    );
    expect(mutating).toHaveLength(2);
    for (const step of mutating) {
      expect(step.if).not.toContain("inputs.scope == 'probe'");
      expect(step.if).not.toContain("inputs.scope == 'verify'");
    }
  });

  it("postflights exact function identity, private helpers, and protocol ACLs", () => {
    const postflight = stepByName(
      "Verify exact completion catalog ACL runtime lint and stopped safety",
    ).run ?? "";
    for (const evidence of [
      "count(oid)=25",
      "count(distinct oid)=25",
      "count(oid)=5",
      "count(distinct oid)=5",
      "grok_current_execution_admission_hash",
      "assert_current_grok_execution_admissions",
      "normalize_grok_role_capabilities",
      "grok_specialist_admission_hash",
      "record_grok_specialist_roster_v1_as_server",
      "grok_execution_admission_hash_v2",
      "launch_grok_full_lifecycle_v3_as_server",
      "CURRENT_HASH_MD5=5d3611423811e3609dd9f2fc3f2f981a",
      "CURRENT_HASH_MD5=683feb8055a892b3b633a835a1a32683",
      "pg_get_userbyid(proowner)='postgres'",
      "proconfig=array['search_path=pg_catalog']::text[]",
      "actual_source_md5=source_md5",
      "aclexplode(proacl)",
      "has_function_privilege('service_role'",
      "not has_function_privilege('anon'",
      "not has_function_privilege('authenticated'",
      "Legacy v2 claim/control functions are not exact owner-only history",
    ]) {
      expect(postflight).toContain(evidence);
    }
  });

  it("postflights the full specialist table, constraint, index, RLS, and audit boundary", () => {
    const postflight = stepByName(
      "Verify exact completion catalog ACL runtime lint and stopped safety",
    ).run ?? "";
    for (const evidence of [
      "relation.relrowsecurity and relation.relforcerowsecurity",
      "cardinality(relation.relacl)=1",
      "count(*) from aclexplode(relation.relacl))=7",
      "count(*)=29 from pg_attribute",
      "count(*)=28 from pg_attribute",
      "attnotnull<>(attname<>'provider_identity')",
      "grok_specialist_admissions_select_members",
      "count(*)=2 and bool_and(tgfoid='public.reject_grok_evidence_mutation()'::regprocedure)",
      "count(*)=24 and bool_and(convalidated)",
      "count(*)=6 and bool_and(indisvalid and indisready and indislive)",
      "grok_specialist_admissions_capabilities_no_secret",
      "grok_specialist_admissions_provider_identity_shape",
      "grok_execution_admissions_specialist_fk",
      "grok_execution_admissions_specialist_idx",
      "(specialist_admission_id IS NOT NULL)",
      "not has_table_privilege('service_role'",
    ]) {
      expect(postflight).toContain(evidence);
    }
    expect(postflight.match(/contype<>'n'/g)).toHaveLength(4);
    expect(postflight).not.toContain(
      "count(*) from aclexplode(relation.relacl))=1",
    );
  });

  it("uses rollback runtime canaries, transactional linked lint, cache reload, and exact postflight health", () => {
    const reload = stepByName("Reload the PostgREST schema cache");
    expect(reload.if).toBe(
      "${{ inputs.scope == 'claim-admission-fence' || inputs.scope == 'specialist-admission-planning' }}",
    );
    expect(reload.run?.toLowerCase()).toContain("notify pgrst, 'reload schema'");

    const postflight = stepByName(
      "Verify exact completion catalog ACL runtime lint and stopped safety",
    ).run ?? "";
    for (const evidence of [
      "begin;",
      "assert_current_grok_execution_admissions(gen_random_uuid())",
      "claim_planned_graph_v3",
      "claim_planned_graph_by_id_v3",
      "claim_phase1c_run_v3",
      "claim_phase1c_run_by_command_v3",
      "read_grok_execution_credential_as_worker",
      "normalize_grok_role_capabilities",
      "record_grok_specialist_roster_v1_as_server",
      "launch_grok_full_lifecycle_v3_as_server",
      "rollback;",
      "plpgsql_check_function_tb",
      "finding.level in ('error','warning','extra')",
      "Postflight lint left extension residue",
    ]) {
      expect(postflight).toContain(evidence);
    }
    expect(source.match(/where language_row\.lanname='plpgsql'/g)).toHaveLength(2);

    const health = stepByName(
      "Reverify exact production health and stopped execution workflows",
    ).run ?? "";
    for (const evidence of [
      "CURRENT_MAIN_SHA",
      "EXPECTED_VERCEL_DEPLOYMENT_URL",
      "EXPECTED_VERCEL_DEPLOYMENT_ID",
      "Lint, typecheck, test, and build",
      "Browser and accessibility tests 1/3",
      "Browser and accessibility tests 2/3",
      "Browser and accessibility tests 3/3",
      "graph-worker.yml",
      "codex-worker.yml",
      "claude-worker.yml",
      "auth-broker.yml",
      "select(.status != \"completed\")",
    ]) {
      expect(health).toContain(evidence);
    }
    expect(source).not.toMatch(/\bgh\s+workflow\s+run\b|\/dispatches\b/);
  });
});
