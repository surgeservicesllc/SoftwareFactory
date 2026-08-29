// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const workflowPath = ".github/workflows/factory-lifecycle-release-migrations.yml";
const migrations = [
  {
    version: "20260828000050",
    path: "supabase/migrations/20260828000050_normalize_breaker_aware_phase1c_selector.sql",
    hash: "8914034508451d1550ebf3f1bedd8f7b71592f1809306e78c57774c458952896",
  },
  {
    version: "20260828000100",
    path: "supabase/migrations/20260828000100_project_production_url_configuration.sql",
    hash: "0856ddee447280a1bb4418f25d6a6d4650687e168fffcd5e98e8ce15edd62b27",
  },
  {
    version: "20260828000200",
    path: "supabase/migrations/20260828000200_target_bound_worker_claims.sql",
    hash: "f7d87242534e16bacd22c0244784a992bded3c335fcb0a38e85d8a6b9168eaa5",
  },
  {
    version: "20260828000300",
    path: "supabase/migrations/20260828000300_graph_postdeploy_validation.sql",
    hash: "0104f4b6514eb42fddb931b76a8026cea4834547f8dff011c2fff956d11579a5",
  },
] as const;

const workflowSource = readFileSync(resolve(root, workflowPath), "utf8");
const workflow = parse(workflowSource) as {
  on: {
    workflow_dispatch: {
      inputs: {
        scope: { default: string; required: boolean; type: string; options: string[] };
        confirm: { default: string; required: boolean; type: string };
        release_sha: { required: boolean; type: string; description: string };
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

describe("Full Lifecycle v2 hosted release workflow", () => {
  it("is manual, serialized with every hosted apply, and least-privilege", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch.inputs.scope).toMatchObject({
      default: "probe",
      required: true,
      type: "choice",
      options: [
        "probe",
        "selector-normalization",
        "configure-url",
        "target-claims",
        "postdeploy",
        "verify",
      ],
    });
    expect(workflow.on.workflow_dispatch.inputs.confirm).toMatchObject({
      default: "",
      required: false,
      type: "string",
    });
    expect(workflow.on.workflow_dispatch.inputs.release_sha).toMatchObject({
      required: true,
      type: "string",
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
    expect(workflow.jobs.release["timeout-minutes"]).toBe(20);
    expect(workflow.jobs.release.env.PROJECT_REF).toBe("qpuofpmagrmyamahqwxw");
    expect(workflow.jobs.release.env.VERCEL_PROJECT_ID).toBe(
      "prj_pAsrhftaVWI4SyaqstgRVSWHJkdD",
    );
  });

  it("pins all four LF migration identities to the reviewed bytes", () => {
    migrations.forEach((migration) => {
      const stem = "MIGRATION_" + migration.version.slice(-5);
      expect(workflow.jobs.release.env[stem]).toBe(
        migration.path,
      );
      expect(workflow.jobs.release.env[stem + "_SHA256"]).toBe(
        migration.hash,
      );
      const normalized = readFileSync(resolve(root, migration.path), "utf8").replace(
        /\r\n?/g,
        "\n",
      );
      expect(createHash("sha256").update(normalized).digest("hex")).toBe(
        migration.hash,
      );
    });
    const identity = stepByName("Verify the four exact forward files").run ?? "";
    expect(identity.match(/verify_file/g)).toHaveLength(5);
    expect(identity).toContain("sha256sum");
  });

  it("requires an explicit actor and confirmation only for mutation scopes", () => {
    const authorization = stepByName("Authorize the exact mutation scope");
    expect(authorization.env).toEqual({
      AUTHORIZED_ACTOR: "${{ vars.PRODUCTION_RELEASE_ACTOR }}",
      SCOPE: "${{ inputs.scope }}",
      CONFIRM: "${{ inputs.confirm }}",
    });
    const command = authorization.run ?? "";
    expect(command).toContain("probe|verify) exit 0");
    expect(command).toContain(
      'selector-normalization|configure-url|target-claims|postdeploy)',
    );
    expect(command).toContain('[ "$CONFIRM" != "apply" ]');
    expect(command).toContain('[ "$GITHUB_ACTOR" != "$AUTHORIZED_ACTOR" ]');
    expect(command).toContain('[ "$GITHUB_TRIGGERING_ACTOR" != "$AUTHORIZED_ACTOR" ]');
    expect(command).toContain('[ "$GITHUB_RUN_ATTEMPT" != "1" ]');
  });

  it("binds every scope to exact green main and exact READY Vercel production", () => {
    const gate =
      stepByName("Verify exact green production and stopped execution workflows").run ??
      "";
    expect(
      stepByName("Verify exact green production and stopped execution workflows").env,
    ).toMatchObject({
      PHASE1C_WORKER_ENABLED:
        "${{ vars.SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED }}",
      GRAPH_WORKER_ENABLED:
        "${{ vars.SOFTWAREFACTORY_GRAPH_WORKER_ENABLED }}",
      GRAPH_WORKER_SCHEDULED:
        "${{ vars.SOFTWAREFACTORY_GRAPH_WORKER_SCHEDULED }}",
      AUTH_BROKER_DISABLED:
        "${{ vars.SOFTWAREFACTORY_AUTH_BROKER_DISABLED }}",
    });
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
      '.ref==$sha or .ref=="main"',
      '.state=="success"',
      "graph-worker.yml",
      "codex-worker.yml",
      "claude-worker.yml",
      "auth-broker.yml",
      "graph-live-canary.yml",
      "handoff-canary.yml",
      "graph-artifact-containment.yml",
      "e2e-test-data.yml",
      "journey-prod-user.yml",
      'select(.status != "completed")',
      "PHASE1C_WORKER_ENABLED",
      "GRAPH_WORKER_ENABLED",
      "GRAPH_WORKER_SCHEDULED",
      "AUTH_BROKER_DISABLED",
      "PRODUCTION_HEALTH_URL",
      '.databaseProject=="matched"',
      '.databaseProjectRef==$project',
      '.deployment=="matched"',
      '.deploymentUrl==$deployment_url',
      '.vercelProjectId==$vercel_project',
      '^dpl_[A-Za-z0-9]+$',
      '.release=="matched"',
      '.releaseSha==$sha',
      '.releaseRef=="main"',
    ]) {
      expect(gate).toContain(evidence);
    }
    expect(workflowSource.match(/git\/ref\/heads\/main/g)?.length).toBeGreaterThanOrEqual(2);
    expect(workflowSource.match(/\.databaseProject=="matched"/g)).toHaveLength(2);
    expect(workflowSource.match(/\.databaseProjectRef==\$project/g)).toHaveLength(2);
    expect(workflowSource.match(/\.deploymentUrl==\$deployment_url/g)).toHaveLength(2);
    expect(workflowSource.match(/\.vercelProjectId==\$vercel_project/g)).toHaveLength(2);
    expect(workflowSource.match(/\.release=="matched"/g)).toHaveLength(2);
    expect(workflowSource.match(/deployments\?environment=Production/g)).toHaveLength(2);
  });

  it("accepts only the canonical ordered ledger states", () => {
    const preflight =
      stepByName("Verify prerequisite ledger and stopped database state").run ?? "";
    for (const version of ["20260827000200", "20260827000210", ...migrations.map((m) => m.version)]) {
      expect(preflight).toContain(version);
    }
    for (const state of [
      "selector-normalization:1\\|1\\|0\\|0\\|0\\|0",
      "configure-url:1\\|1\\|1\\|0\\|0\\|0",
      "target-claims:1\\|1\\|1\\|1\\|0\\|0",
      "postdeploy:1\\|1\\|1\\|1\\|1\\|0",
      "verify:1\\|1\\|1\\|1\\|1\\|1",
    ]) {
      expect(preflight).toContain(state);
    }
    expect(preflight).toContain("autonomy_kill_switch_active is distinct from true");
    expect(preflight).toContain("last_heartbeat_at > now()-interval '10 minutes'");
    expect(preflight).toContain("last_heartbeat_at > now()+interval '1 minute'");
    expect(preflight).toContain("current_run_id is not null");
    expect(preflight).toContain("public.graph_runs where state='RUNNING'");
    expect(preflight).toContain("public.agent_runs where status='running'");
    for (const action of [
      "auto_plan",
      "auto_code",
      "auto_test",
      "auto_repair",
      "auto_review",
      "auto_approve",
      "auto_merge",
      "auto_deploy",
      "auto_rollback",
    ]) {
      expect(preflight).toContain(action);
    }

    const apply = stepByName("Apply exactly one ordered forward migration").run ?? "";
    const postflight =
      stepByName("Verify ledger catalog ACL runtime and stopped safety").run ?? "";
    expect(
      stepByName("Verify ledger catalog ACL runtime and stopped safety").env,
    ).toMatchObject({
      PHASE1C_WORKER_ENABLED:
        "${{ vars.SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED }}",
      GRAPH_WORKER_ENABLED:
        "${{ vars.SOFTWAREFACTORY_GRAPH_WORKER_ENABLED }}",
      GRAPH_WORKER_SCHEDULED:
        "${{ vars.SOFTWAREFACTORY_GRAPH_WORKER_SCHEDULED }}",
      AUTH_BROKER_DISABLED:
        "${{ vars.SOFTWAREFACTORY_AUTH_BROKER_DISABLED }}",
    });
    for (const command of [preflight, apply, postflight]) {
      for (const containment of [
        "public.organizations",
        "public.projects",
        "last_heartbeat_at > now()-interval '10 minutes'",
        "last_heartbeat_at > now()+interval '1 minute'",
        "current_run_id is not null",
        "public.graph_runs where state='RUNNING'",
        "public.agent_runs where status='running'",
      ]) {
        expect(command).toContain(containment);
      }
    }
  });

  it("stages and applies one file with DDL and ledger in one locked transaction", () => {
    const apply = stepByName("Apply exactly one ordered forward migration");
    expect(apply.if).toBe(
      "${{ inputs.scope == 'selector-normalization' || inputs.scope == 'configure-url' || inputs.scope == 'target-claims' || inputs.scope == 'postdeploy' }}",
    );
    const command = apply.run ?? "";
    expect(command).toContain('find "$STAGE_DIR" -maxdepth 1 -type f');
    expect(command).toContain("plpgsql_check_function_tb");
    expect(command).toContain("finding.level in ('error','warning','extra')");
    expect(command).toContain("EXTENSION_BASELINE");
    expect(command).toContain("EXTENSION_RESIDUE");
    expect(command).toContain("--single-transaction");
    expect(command).toContain("set local lock_timeout='15s'");
    expect(command).toContain("set local statement_timeout='10min'");
    expect(command).toContain(
      "lock table supabase_migrations.schema_migrations in share row exclusive mode",
    );
    expect(command).toContain(
      "lock table public.organizations, public.projects, public.phase1c_workers",
    );
    expect(command).toContain('or exists (select 1 from public.graph_runs where state=\'RUNNING\'');
    expect(command).toContain("-f \"$STAGED_FILE\"");
    expect(command).toContain(
      "insert into supabase_migrations.schema_migrations(version) values ('${VERSION}')",
    );
    expect(command).not.toMatch(/supabase\s+db\s+(push|reset)/i);
    expect(command).not.toMatch(/down[-_ ]?migrat/i);
    expect(command).not.toContain("supabase/migrations/*.sql");
    for (const retired of [
      "claim_planned_graph_internal(text,text[],text,jsonb,uuid)",
      "claim_phase1c_run_budget_internal(text,text,text,integer,uuid)",
      "claim_phase1c_run_internal(text,text,text,integer,uuid)",
    ]) {
      expect(command).toContain(retired);
    }
  });

  it("isolates the exact stale selector in its own forward-only release scope", () => {
    const apply = stepByName("Apply exactly one ordered forward migration").run ?? "";
    const postflight =
      stepByName("Verify ledger catalog ACL runtime and stopped safety").run ?? "";
    for (const evidence of [
      "selector-normalization)",
      "VERSION=20260828000050",
      "ed5840b9d8d0efdb513a8576df128e9b",
      "5933952d71f9da90a2a80a05ce6e0378",
      "fdd3eee3e61c083789ffeb4808ed0a47",
      "public.claim_phase1c_run_budget_internal(text,text,text,integer)",
      "selector-normalization base selector overload count drifted",
      "selector-normalization hosted breaker ACL drifted",
      "attribute.attacl is not null",
      "acldefault('r',relation_row.relowner)",
      "(select privilege_type from actual where grantee=to_regrole('service_role')::oid) except select privilege_type from owner_expected",
      "(select privilege_type from owner_expected) except select privilege_type from actual where grantee=to_regrole('service_role')::oid",
      "${E050}",
    ]) {
      expect(apply).toContain(evidence);
    }
    for (const evidence of [
      "c050 integer",
      "c100 > c050",
      "expected_phase_selector_hash",
      "ed5840b9d8d0efdb513a8576df128e9b",
      "5933952d71f9da90a2a80a05ce6e0378",
      "breaker-aware selector helper catalog drifted",
      "release resource_breakers catalog or ACL drifted",
      "breaker_relation oid := to_regclass('public.resource_breakers')",
      "attribute.attacl is not null",
      "not index_row.indisvalid",
      "not index_row.indisready",
      "not index_row.indislive",
      "resource_breakers_select_members",
      "resource_breakers_closed_is_clean",
      "resource_breakers_target_unique",
      "f3b72bb359a50b640590970a2ab8e514",
      "75230039beb12ce952f24927f2bfa2f2",
      "04012ad5d4aa2f1b2ad25b2451e653f0",
      "ac9e3f03dd3d27504b3cadcc477aa415",
      "415d827b30b8846fb40447bd1d968b3e",
      "2eea03a91826969e8abc25f7f80097f6",
      "pg_catalog.acldefault('r', relation_row.relowner)",
      "pg_catalog.to_regrole('service_role')::oid",
    ]) {
      expect(postflight).toContain(evidence);
    }
    expect(workflowSource).not.toMatch(
      /insert into supabase_migrations\.schema_migrations[^\n]+20260815000(?:300|500)/i,
    );
    expect(workflowSource).not.toMatch(/migration repair[^\n]+20260815000(?:300|500)/i);
  });

  it("reloads schema only after mutation and strongly verifies catalog ACL and runtime", () => {
    const reload = stepByName("Reload the PostgREST schema cache");
    expect(reload.if).toBe(
      "${{ inputs.scope == 'selector-normalization' || inputs.scope == 'configure-url' || inputs.scope == 'target-claims' || inputs.scope == 'postdeploy' }}",
    );
    expect(reload.run).toContain("NOTIFY pgrst, 'reload schema'");

    const postflight =
      stepByName("Verify ledger catalog ACL runtime and stopped safety").run ?? "";
    for (const evidence of [
      "projects_production_url_public_https",
      "projects_audit_change",
      "project_production_url_is_safe('https://www.theagoras.com')",
      "set_project_production_url(uuid,uuid,text)",
      "assert_phase1c_claim_target",
      "claim_planned_graph_by_id_v2",
      "claim_phase1c_run_by_command_v2",
      "claim_planned_graph_target_internal",
      "claim_phase1c_run_target_budget_internal",
      "p_target_graph_id",
      "p_target_command_id",
      "complete_graph_run_with_validated_release_as_worker",
      "0ec1e97b80dc8696872d88162c5271f9ea822e7dea79556c5470730a025d3b49",
      "ac9bde8fc1cdd21e735f02b1fa7d940ab680c2bde8c1ec24d704d42c59045a09",
      "graph_run_not_found",
      "has_function_privilege('service_role'",
      "relrowsecurity and relforcerowsecurity",
      "autonomy_kill_switch_active is distinct from true",
      "projects_audit_change",
      "tgnargs=0",
      "activity_events_append_only",
      "reject_activity_event_mutation",
      "aclexplode",
      "pg_get_userbyid",
      "prosecdef",
      "proconfig=array['search_path=pg_catalog']",
      "source/catalog/ACL",
    ]) {
      expect(postflight).toContain(evidence);
    }
    for (const negativeCatalog of [
      "unledgered production URL catalog exists",
      "unledgered or retired target-claim catalog exists",
      "unledgered validated completion catalog exists",
    ]) {
      expect(postflight).toContain(negativeCatalog);
    }
    for (const state of [
      "selector-normalization:1\\|1\\|1\\|0\\|0\\|0",
      "configure-url:1\\|1\\|1\\|1\\|0\\|0",
      "target-claims:1\\|1\\|1\\|1\\|1\\|0",
      "postdeploy:1\\|1\\|1\\|1\\|1\\|1",
      "verify:1\\|1\\|1\\|1\\|1\\|1",
    ]) {
      expect(postflight).toContain(state);
    }
    expect(postflight.match(/workflow_runs\[\].*status != "completed"/g)).toHaveLength(1);
  });

  it("re-verifies the current Step 8 any-model record-only catalog and boundary", () => {
    const postflight =
      stepByName("Verify ledger catalog ACL runtime and stopped safety").run ?? "";
    for (const evidence of [
      "20260822001000",
      "RECORD_ONLY_READY",
      "count(oid) = 12",
      "list_factory_command_routing_candidates",
      "normalize_phase1c_command",
      "submit_command_phase1c_normalized_internal",
      "submit_factory_command_routing_internal",
      "record_provider_run_phase1c_compatibility_internal",
      "record_provider_run_phase2a_internal",
      "RECORD_ONLY_BOUNDARY",
      "factory_record_only_submission_guards",
      "count(*) = 7",
      "count(*) = 4",
      "count(*) = 20",
      "executionMode",
      "record_only",
    ]) {
      expect(postflight).toContain(evidence);
    }
    for (const sourceHash of [
      "203f54d969fbc699304e780c1ad68a85",
      "ba62f4f5357cec647d3ff582107710a7",
      "cd28d70a40e860660461700926e97830",
      "024c3aa1f74d976fb7a8a6d7138cd9fb",
      "6008476137a77db33d220be4b14a9c8d",
      "9dfdfc57f4f8b0965a89fefd927beb26",
    ]) {
      expect(postflight).toContain(sourceHash);
    }
  });

  it("keeps probe and verify read-only", () => {
    const mutatingSteps = steps.filter((step) =>
      /Apply exactly|Reload the PostgREST/.test(step.name),
    );
    expect(mutatingSteps).toHaveLength(2);
    for (const step of mutatingSteps) {
      expect(step.if).not.toContain("inputs.scope == 'probe'");
      expect(step.if).not.toContain("inputs.scope == 'verify'");
    }
  });
});
