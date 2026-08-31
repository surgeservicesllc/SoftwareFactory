// @vitest-environment node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const workflowPath = ".github/workflows/grok-bot-release-migrations.yml";
const migrations = [
  {
    version: "20260830000900",
    stem: "MIGRATION_00900",
    path: "supabase/migrations/20260830000900_full_lifecycle_typed_input_identity.sql",
    hash: "08f4c618954d4fe65384f396a881f6546591a413c6fd3facacaaaa9ce8d984f5",
  },
  {
    version: "20260830001000",
    stem: "MIGRATION_01000",
    path: "supabase/migrations/20260830001000_grok_chief_of_staff_persistence.sql",
    hash: "cf17ece506e30beb08163c8bc5888b6b18341bb4e66f61bafaabd6912f225aa6",
  },
  {
    version: "20260830001200",
    stem: "MIGRATION_01100",
    path: "supabase/migrations/20260830001100_grok_planning_failure.sql",
    hash: "22c035897cb51c611aa373c83e637dc4e033352d9079059521eda7fefa35e8f7",
  },
] as const;

const source = readFileSync(resolve(root, workflowPath), "utf8");
const canonicalGrokLauncher =
  "public.launch_grok_full_lifecycle_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb)";
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

describe("Grok Bot hosted release workflow", () => {
  it("is manual, serialized with every hosted apply, and least privilege", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch.inputs.scope).toMatchObject({
      default: "probe",
      required: true,
      type: "choice",
      options: [
        "probe",
        "typed-input",
        "grok-persistence",
        "planning-failure",
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

  it("pins all three reviewed migration byte identities", () => {
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
    const identity = stepByName("Verify the three exact forward files").run ?? "";
    expect(identity.match(/verify_file/g)).toHaveLength(4);
    expect(identity).toContain("sha256sum");
    expect(identity).toContain("^[0-9a-f]{64}$");
    expect(source).not.toContain("planning_failure_sha256");
  });

  it("requires explicit actor, confirmation, exact green main, and READY production", () => {
    const authorization = stepByName("Authorize the exact mutation scope");
    expect(authorization.env).toEqual({
      AUTHORIZED_ACTOR: "${{ vars.PRODUCTION_RELEASE_ACTOR }}",
      SCOPE: "${{ inputs.scope }}",
      CONFIRM: "${{ inputs.confirm }}",
    });
    const authorize = authorization.run ?? "";
    expect(authorize).toContain("probe|verify) exit 0");
    expect(authorize).toContain(
      "typed-input|grok-persistence|planning-failure)",
    );
    expect(authorize).toContain('[ "$CONFIRM" != "apply" ]');
    expect(authorize).toContain('[ "$GITHUB_ACTOR" != "$AUTHORIZED_ACTOR" ]');
    expect(authorize).toContain(
      '[ "$GITHUB_TRIGGERING_ACTOR" != "$AUTHORIZED_ACTOR" ]',
    );
    expect(authorize).toContain('[ "$GITHUB_RUN_ATTEMPT" != "1" ]');

    const gate =
      stepByName(
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
      '.ref==$sha or .ref=="main"',
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
    ]) {
      expect(gate).toContain(evidence);
    }
    expect(
      source.match(/git\/ref\/heads\/main/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(source.match(/deployments\?environment=Production/g)).toHaveLength(
      2,
    );
    expect(source.match(/\.databaseProject=="matched"/g)).toHaveLength(2);
  });

  it("requires stopped workers, autonomy and automatic actions off, and kill switch on", () => {
    const gate =
      stepByName(
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
    for (const envName of [
      "PHASE1C_WORKER_ENABLED",
      "GRAPH_WORKER_ENABLED",
      "GRAPH_WORKER_SCHEDULED",
      "AUTH_BROKER_DISABLED",
    ]) {
      expect(gate).toContain(envName);
    }

    const preflight =
      stepByName(
        "Verify prerequisite ledger catalog and stopped database state",
      ).run ?? "";
    const apply =
      stepByName("Apply exactly one ordered forward migration").run ?? "";
    const postflight =
      stepByName(
        "Verify ledger catalog ACL runtime lint health and stopped safety",
      ).run ?? "";
    for (const command of [preflight, apply, postflight]) {
      for (const containment of [
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
        "last_heartbeat_at > now()-interval '10 minutes'",
        "last_heartbeat_at > now()+interval '1 minute'",
        "current_run_id is not null",
        "state='RUNNING'",
        "status='running'",
      ]) {
        expect(command.replace(/\s+/g, "")).toContain(
          containment.replace(/\s+/g, ""),
        );
      }
    }
    expect(source).not.toMatch(
      /(?:autonomous_mode|auto_(?:plan|code|test|repair|review|approve|merge|deploy|rollback))\s*=\s*true/i,
    );
    expect(source).not.toMatch(/autonomy_kill_switch_active\s*=\s*false/i);
  });

  it("accepts only the ordered prerequisite and postflight ledger states", () => {
    const preflight =
      stepByName(
        "Verify prerequisite ledger catalog and stopped database state",
      ).run ?? "";
    for (const version of [
      "20260828000300",
      ...migrations.map((item) => item.version),
    ]) {
      expect(preflight).toContain(version);
    }
    for (const state of [
      "typed-input:1\\|0\\|0\\|0",
      "grok-persistence:1\\|1\\|0\\|0",
      "planning-failure:1\\|1\\|1\\|0",
      "verify:1\\|1\\|1\\|1",
    ]) {
      expect(preflight).toContain(state);
    }
    const postflight =
      stepByName(
        "Verify ledger catalog ACL runtime lint health and stopped safety",
      ).run ?? "";
    for (const state of [
      "typed-input:1\\|1\\|0\\|0",
      "grok-persistence:1\\|1\\|1\\|0",
      "planning-failure:1\\|1\\|1\\|1",
      "verify:1\\|1\\|1\\|1",
    ]) {
      expect(postflight).toContain(state);
    }
  });

  it("stages and applies exactly one file in one locked forward-only transaction", () => {
    const step = stepByName("Apply exactly one ordered forward migration");
    expect(step.if).toBe(
      "${{ inputs.scope == 'typed-input' || inputs.scope == 'grok-persistence' || inputs.scope == 'planning-failure' }}",
    );
    const command = step.run ?? "";
    for (const evidence of [
      "typed-input)",
      "VERSION=20260830000900",
      "grok-persistence)",
      "VERSION=20260830001000",
      "planning-failure)",
      "VERSION=20260830001200",
      "STAGE_DIR=$(mktemp -d)",
      'find "$STAGE_DIR" -maxdepth 1 -type f',
      "plpgsql_check_function_tb",
      "finding.level in ('error','warning','extra')",
      "EXTENSION_BASELINE",
      "EXTENSION_RESIDUE",
      "--single-transaction",
      "set local lock_timeout='15s'",
      "set local statement_timeout='10min'",
      "lock table supabase_migrations.schema_migrations in share row exclusive mode",
      "lock table public.organizations,public.projects,public.phase1c_workers,public.graph_runs,public.agent_runs in share mode",
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

  it("strongly verifies typed identity and the Grok catalog ACL audit runtime and lint", () => {
    const postflight =
      stepByName(
        "Verify ledger catalog ACL runtime lint health and stopped safety",
      ).run ?? "";
    for (const evidence of [
      "0aff039a853c2c99fe733a72e9388f92",
      "b6ab6fa949a205887ac36d96442c9969",
      "02bb1e7b35782fad9f6024c080bd149f7ade4edb9d68326fd3b04ff94ba589ad",
      "ac9bde8fc1cdd21e735f02b1fa7d940ab680c2bde8c1ec24d704d42c59045a09",
      "graph_run_not_found",
      "count(oid)=7",
      "state.relrowsecurity and state.relforcerowsecurity",
      "not has_table_privilege('service_role'",
      "attribute.attacl is not null",
      "EXPECTED_GROK_FUNCTIONS=16",
      "EXPECTED_GROK_FUNCTIONS=17",
      "pg_get_userbyid(proowner)='postgres'",
      "lanname=language_name",
      "prosecdef",
      "proconfig=array['search_path=pg_catalog']",
      "aclexplode",
      "acldefault('r',state.relowner)",
      "launch_grok_graph_for_session",
      "launch_grok_full_lifecycle_as_server",
      "grok_graph_launches",
      "grok_control_intents",
      "public.has_organization_role",
      "organization owner access is required",
      "public.create_graph_from_plan",
      "public.create_graph_from_plan_with_release_identity_as_server",
      "perform public.set_graph_pause_as_member",
      "workerWoken",
      "executionStarted",
      "insert into public.graph_runs",
      "insert into public.node_runs",
      "insert into public.agent_runs",
      "fail-closed execution boundary",
      "trigger_row.tgfoid='public.reject_grok_evidence_mutation()'",
      "grok_sessions_title_no_secret",
      "grok_messages_content_no_secret",
      "grok_events_payload_no_secret",
      "grok_session_not_found",
      "public.record_grok_planning_failure_as_server(uuid,uuid,uuid,text,text,bigint)",
      "session.planning_failed",
      "grok.planning_error",
      "MISSING_CODEX_AGENT",
      "planning-failure exact replay drifted",
      "planning-failure tenant mismatch did not refuse",
      "plpgsql_check_function_tb",
      "Postflight linked-database lint",
    ]) {
      expect(postflight).toContain(evidence);
    }
    expect(postflight).toContain("count(*) from pg_policy policy");
    expect(postflight).toContain("not constraint_row.convalidated");
    expect(postflight).toContain("not index_row.indisvalid");
    expect(postflight).toContain("not index_row.indisready");
    expect(postflight).toContain("not index_row.indislive");
    for (const sourceHash of [
      "20f0ed5db994773371be8cb167fb2cf3",
      "be9cd7bb75766b9f05c898665ca91797",
      "fc25a54b07539b1e94477a0f482f9d11",
      "9a429e1ce48d9caf4a1dc604c4f5aaf4",
      "bd952acdffd457e1ac03e64380284bec",
      "49438e7ef00cf0d7034e0016e75f74f8",
      "6a2c4bc103081a22672c9821c228665f",
      "d5056a47bac42c495dff7b0593cbf1a9",
      "148341fdd59b01103e22687813d2e3ba",
    ]) {
      expect(postflight).toContain(sourceHash);
    }
    expect(postflight).not.toContain("source_md5 is null");
    expect(postflight).toContain(
      "('public.record_grok_planning_failure_as_server(uuid,uuid,uuid,text,text,bigint)','service_role','148341fdd59b01103e22687813d2e3ba','v','plpgsql')",
    );
    expect(postflight).toContain(
      `('${canonicalGrokLauncher}','service_role','49438e7ef00cf0d7034e0016e75f74f8','v','plpgsql')`,
    );
  });

  it("admits only the exact service launcher and keeps its canonical graph paused", () => {
    const apply =
      stepByName("Apply exactly one ordered forward migration").run ?? "";
    const postflight =
      stepByName(
        "Verify ledger catalog ACL runtime lint health and stopped safety",
      ).run ?? "";

    expect(apply).toContain(`('${canonicalGrokLauncher}',null)`);
    expect(postflight).toContain(`('${canonicalGrokLauncher}',null)`);
    expect(postflight).toContain(
      `routine.oid=to_regprocedure('${canonicalGrokLauncher}')`,
    );
    expect(postflight).toContain(
      "strpos(routine.prosrc,'public.create_graph_from_plan_with_release_identity_as_server')>0)=1",
    );
    expect(postflight).toContain(
      "routine.oid<>to_regprocedure('public.launch_grok_full_lifecycle_as_server",
    );
    expect(postflight).toContain(
      "strpos(routine.prosrc,'perform public.set_graph_pause_as_member')>0",
    );
    expect(postflight).toContain(
      "strpos(lower(routine.prosrc),'insert into public.graph_runs')=0",
    );
    expect(postflight).toContain(
      "to_regprocedure('public.launch_grok_graph_for_session",
    );
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
});
