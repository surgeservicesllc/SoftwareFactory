// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migrationPath =
  "supabase/migrations/20260827000210_contain_legacy_graph_artifact_payloads.sql";
const exactMigrationHash =
  "7697eda24fef53b89ee3c3dbc9b7f7bc0c60ec2f8f0d23c73a7cf607652a1bfc";
const lineageMigrationPath =
  "supabase/migrations/20260827000200_graph_phase1c_release_lineage.sql";
const exactLineageMigrationHash =
  "23197552df3f442ae8264bf71bd28a7c479e09a64bf6e298c615b767a96572be";
const workflowSource = readFileSync(
  resolve(root, ".github/workflows/graph-artifact-containment.yml"),
  "utf8",
);
const migrationSource = readFileSync(
  resolve(root, migrationPath),
  "utf8",
).replace(/\r\n?/g, "\n");
const lineageMigrationSource = readFileSync(
  resolve(root, lineageMigrationPath),
  "utf8",
).replace(/\r\n?/g, "\n");
const workflow = parse(workflowSource) as {
  on: {
    workflow_dispatch: {
      inputs: {
        operation: {
          default: string;
          options: string[];
          required: boolean;
          type: string;
        };
        expected_manifest_sha256: { required: boolean; type: string };
        expected_count: { required: boolean; type: string };
      };
    };
  };
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: {
    containment: {
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

const steps = workflow.jobs.containment.steps;

function stepByName(name: string) {
  const step = steps.find((candidate) => candidate.name === name);
  expect(step).toBeDefined();
  return step!;
}

describe("legacy graph artifact containment workflow", () => {
  it("is manual, one-shot, read-only at GitHub, and serialized", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch.inputs.operation).toMatchObject({
      default: "probe",
      required: true,
      type: "choice",
    });
    expect(workflow.on.workflow_dispatch.inputs.operation.options).toEqual([
      "probe",
      "contain",
      "lineage",
    ]);
    expect(
      workflow.on.workflow_dispatch.inputs.expected_manifest_sha256,
    ).toEqual({
      description: expect.any(String),
      required: false,
      type: "string",
    });
    expect(workflow.on.workflow_dispatch.inputs.expected_count).toEqual({
      description: expect.any(String),
      required: false,
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
    expect(workflow.jobs.containment["timeout-minutes"]).toBe(15);
    expect(workflow.jobs.containment.env.PROJECT_REF).toBe(
      "qpuofpmagrmyamahqwxw",
    );
  });

  it("requires exact main, all four green checks, exact Vercel production, and a stopped worker fleet", () => {
    const gate =
      stepByName(
        "Verify exact green production and stopped execution workflows",
      ).run ?? "";
    for (const evidence of [
      "surgeservicesllc/SoftwareFactory",
      "refs/heads/main",
      "Lint, typecheck, test, and build",
      "Browser and accessibility tests 1/3",
      "Browser and accessibility tests 2/3",
      "Browser and accessibility tests 3/3",
      'environment=="Production"',
      'creator.login=="vercel[bot]"',
      "graph-worker.yml",
      "codex-worker.yml",
      "claude-worker.yml",
      "graph-live-canary.yml",
      "handoff-canary.yml",
      'select(.status != "completed")',
    ]) {
      expect(gate).toContain(evidence);
    }
    expect(gate).toContain('$GITHUB_SHA" != "$SHA');
    expect(gate).toContain(".sha==$sha and .ref==$sha");
  });

  it("requires the exact configured release actor for production mutation", () => {
    const authorization = stepByName("Authorize production mutation");
    expect(authorization.env).toEqual({
      AUTHORIZED_ACTOR: "${{ vars.PRODUCTION_RELEASE_ACTOR }}",
      OPERATION: "${{ inputs.operation }}",
    });
    const run = authorization.run ?? "";
    expect(run).toContain('[ "$OPERATION" != "probe" ]');
    expect(run).toContain('[ -z "$AUTHORIZED_ACTOR" ]');
    expect(run).toContain('[ "$GITHUB_ACTOR" != "$AUTHORIZED_ACTOR" ]');
    expect(run).toContain("exact configured release actor");
  });

  it("probes a payload-free deterministic manifest and refuses unresolved identity blockers", () => {
    const diagnose = stepByName(
      "Diagnose payload-free candidate manifest and next blockers",
    );
    expect(diagnose.if).toBe("${{ inputs.operation != 'lineage' }}");
    const diagnoseRun = diagnose.run ?? "";
    for (const evidence of [
      "payload_sha256",
      "payload_octets",
      "sensitive_count",
      "oversized_count",
      "max_octets",
      "manifest_sha256",
      "string_agg",
      "order by id::text",
    ]) {
      expect(diagnoseRun).toContain(evidence);
    }
    expect(diagnoseRun).toContain("No payload or row identifier was logged.");
    expect(diagnoseRun).toContain('echo "count=$COUNT" >> "$GITHUB_OUTPUT"');
    expect(diagnoseRun).toContain(
      'echo "manifest_sha256=$MANIFEST_SHA" >> "$GITHUB_OUTPUT"',
    );
    expect(diagnoseRun).toContain(
      'echo "blockers=$BLOCKERS" >> "$GITHUB_OUTPUT"',
    );

    const apply = stepByName("Apply the exact forward containment");
    expect(apply.if).toBe("${{ inputs.operation == 'contain' }}");
    const run = apply.run ?? "";
    expect(run).toContain('if [ "$LIVE_COUNT" != "$EXPECTED_COUNT" ]');
    expect(run).toContain(
      '[ "$LIVE_MANIFEST_SHA256" != "$EXPECTED_MANIFEST_SHA256" ]',
    );
    expect(run).toContain('if [ "$NEXT_BLOCKERS" != "0|0|0|0" ]');
  });

  it("pins and stages exactly the reviewed migration and rechecks the manifest under lock", () => {
    const run = stepByName("Apply the exact forward containment").run ?? "";
    const actualHash = createHash("sha256")
      .update(migrationSource)
      .digest("hex");
    expect(actualHash).toBe(exactMigrationHash);
    expect(run.match(/(?<=EXPECTED_FILE_SHA256=)[a-f0-9]{64}/g)).toEqual([
      exactMigrationHash,
    ]);
    expect(run.match(/supabase\/migrations\/[A-Za-z0-9_.-]+\.sql/g)).toEqual([
      migrationPath,
    ]);
    expect(run).toContain("STAGE_DIR=$(mktemp -d)");
    expect(run).toContain('find "$STAGE_DIR" -maxdepth 1 -type f');
    expect(run).toContain("--single-transaction -q");
    expect(run.match(/-f "\$STAGED_FILE"/g)).toHaveLength(1);
    expect(run).toMatch(
      /lock table public\.graph_artifacts,\s*public\.graph_verifications in access exclusive mode/,
    );
    expect(run).toContain("public.agent_runs,public.node_runs in share mode");
    expect(run).toContain("locked graph artifact candidate manifest mismatch");
    expect(run).toContain(
      "insert into supabase_migrations.schema_migrations(version) values ('20260827000210')",
    );

    const lock = run.search(
      /lock table public\.graph_artifacts,\s*public\.graph_verifications in access exclusive mode/,
    );
    const manifest = run.indexOf(
      "locked graph artifact candidate manifest mismatch",
    );
    const migration = run.indexOf('-f "$STAGED_FILE"');
    const ledger = run.indexOf(
      "insert into supabase_migrations.schema_migrations(version) values ('20260827000210')",
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(manifest).toBeGreaterThan(lock);
    expect(migration).toBeGreaterThan(manifest);
    expect(ledger).toBeGreaterThan(migration);
  });

  it("isolates 00210 between the committed fence and still-unapplied lineage with exact safety postflight", () => {
    const run = stepByName("Apply the exact forward containment").run ?? "";
    expect(run).toContain('if [ "$LEDGER" != "1|1|0|0|true" ]');
    for (const evidence of [
      "version='20260827000150'",
      "version='20260827000200'",
      "version='20260827000210'",
      "graph_artifact_payload_containments",
      "graph_artifacts_payload_no_sensitive_data",
      "graph_artifacts_payload_size_bounded",
      "relrowsecurity and relforcerowsecurity",
      "not has_table_privilege('anon'",
      "not has_table_privilege('authenticated'",
      "not has_table_privilege('service_role'",
      "contype='f'",
      "graph_artifact_payload_containments_immutable",
      "graph_artifacts_update_immutable",
      "autonomy_kill_switch_active",
      "phase1c_workers",
      "graph_runs",
      "agent_runs",
    ]) {
      expect(run).toContain(evidence);
    }
    expect(run).toContain("00200 remains unapplied");
    expect(run).not.toMatch(
      /last_heartbeat_at\s*<=\s*now\(\)\s*\+\s*interval/i,
    );
    expect(
      run.match(
        /phase1c_workers[\s\S]{0,180}?status in \('active','draining'\)[\s\S]{0,180}?last_heartbeat_at\s*>\s*now\(\)-interval '5 minutes'/gi,
      )?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(run).not.toMatch(/supabase\s+(?:db\s+push|migration\s+repair)/);
    expect(workflowSource).not.toMatch(
      /\bgh\s+workflow\s+run\b|\/dispatches\b/,
    );
    expect(workflowSource).not.toMatch(
      /(?:autonomous_mode|auto_(?:plan|code|test|repair|review|approve|merge|deploy|rollback))\s*=\s*true/i,
    );
    expect(workflowSource).not.toMatch(
      /autonomy_kill_switch_active\s*=\s*false/i,
    );
  });

  it("verifies the exact immutable audit trigger, function, owner, and raw ACL contract", () => {
    const containmentRun =
      stepByName("Apply the exact forward containment").run ?? "";
    const lineageRun =
      stepByName(
        "Install the unchanged graph Phase 1C lineage after containment",
      ).run ?? "";

    for (const run of [containmentRun, lineageRun]) {
      expect(run).toMatch(
        /tgfoid\s*=\s*to_regprocedure\(\s*'public\.enforce_graph_artifact_payload_containment_immutable\(\)'/i,
      );
      expect(run).toMatch(
        /pg_get_userbyid\(routine\.proowner\)\s*=\s*'postgres'/i,
      );
      expect(run).toMatch(/routine\.prosecdef/i);
      expect(run).toMatch(
        /routine\.proconfig\s*=\s*array\['search_path=pg_catalog'\]::text\[\]/i,
      );
      expect(run).toContain(
        "graph artifact payload containment evidence is immutable",
      );
      expect(run).toMatch(/routine\.proacl is not null/i);
      expect(run).toMatch(
        /privilege\.grantor\s*=\s*routine\.proowner[\s\S]*?privilege\.grantee\s*=\s*routine\.proowner[\s\S]*?privilege\.privilege_type\s*=\s*'EXECUTE'[\s\S]*?not privilege\.is_grantable/i,
      );
    }
  });

  it("pins and atomically gates unchanged 00200 if the manual lineage operation is exposed", () => {
    const options = workflow.on.workflow_dispatch.inputs.operation.options;
    const lineageSteps = steps.filter((step) =>
      step.if?.includes("inputs.operation == 'lineage'"),
    );
    if (!options.includes("lineage")) {
      expect(lineageSteps).toEqual([]);
      return;
    }

    expect(lineageSteps).toHaveLength(1);
    const lineageStep = lineageSteps[0];
    expect(lineageStep.env).toEqual({
      EXPECTED_COUNT: "${{ inputs.expected_count }}",
      EXPECTED_MANIFEST_SHA256: "${{ inputs.expected_manifest_sha256 }}",
    });
    const run = lineageStep.run ?? "";
    expect(
      createHash("sha256").update(lineageMigrationSource).digest("hex"),
    ).toBe(exactLineageMigrationHash);
    expect(run.match(/supabase\/migrations\/[A-Za-z0-9_.-]+\.sql/g)).toEqual([
      lineageMigrationPath,
    ]);
    expect(run.match(/(?<=EXPECTED_FILE_SHA256=)[a-f0-9]{64}/g)).toEqual([
      exactLineageMigrationHash,
    ]);
    expect(run).toContain("STAGE_DIR=$(mktemp -d)");
    expect(run).toContain('find "$STAGE_DIR" -maxdepth 1 -type f');
    expect(run).toContain("--single-transaction");
    expect(run.match(/-f "\$STAGED_FILE"/g)).toHaveLength(1);
    expect(run).toContain(
      "insert into supabase_migrations.schema_migrations(version) values ('20260827000200')",
    );
    expect(run).toContain('if [ "$LEDGER" != "1|1|0|1|true" ]');
    expect(run).toContain("<> '1|1|0|1'");
    expect(run).toContain('if [ "$AUDIT_COUNT" != "$EXPECTED_COUNT" ]');
    expect(run).toContain(
      '[ "$AUDIT_MANIFEST_SHA256" != "$EXPECTED_MANIFEST_SHA256" ]',
    );
    expect(run).toContain(
      "locked containment manifest or tombstone identity mismatch",
    );
    expect(run).toContain("version='20260827000150'");
    expect(run).toContain("version='20260827000200'");
    expect(run).toContain("version='20260827000210'");
    expect(run).toContain("public.graph_artifact_payload_containments");

    for (const strictGate of [
      "pg_stat_activity",
      "pg_locks",
      "phase1c_workers",
      "graph_runs",
      "agent_runs",
      "autonomy_kill_switch_active",
      "claim_planned_graph_v2",
      "diagnose_graph_queue_as_worker_v2",
      "abort_graph_run_as_worker",
      "relrowsecurity",
      "relforcerowsecurity",
      "graph_artifact_payload_containments_immutable",
      "graph_artifacts_update_immutable",
    ]) {
      expect(run).toContain(strictGate);
    }
    expect(run).not.toMatch(
      /last_heartbeat_at\s*<=\s*now\(\)\s*\+\s*interval/i,
    );
    expect(
      run.match(
        /phase1c_workers[\s\S]{0,180}?status in \('active','draining'\)[\s\S]{0,180}?last_heartbeat_at\s*>\s*now\(\)-interval '5 minutes'/gi,
      )?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
    expect(run).not.toMatch(/supabase\s+(?:db\s+push|migration\s+repair)/);
    expect(run).not.toMatch(/revoke all on function public\.decide_node_gate/i);

    const transaction = run.indexOf("--single-transaction");
    const migration = run.indexOf('-f "$STAGED_FILE"');
    const ledger = run.indexOf(
      "insert into supabase_migrations.schema_migrations(version) values ('20260827000200')",
    );
    expect(transaction).toBeGreaterThanOrEqual(0);
    expect(migration).toBeGreaterThan(transaction);
    expect(ledger).toBeGreaterThan(migration);

    const lockedGuard = run.slice(transaction, migration);
    for (const lockedTable of [
      "public.organizations in share mode",
      "public.projects in share mode",
      "public.phase1c_workers in share mode",
      "public.graph_artifact_payload_containments in access exclusive mode",
      "public.graph_runs in exclusive mode",
      "public.graphs in exclusive mode",
      "public.node_runs in exclusive mode",
      "public.graph_gates in exclusive mode",
      "public.graph_artifacts in exclusive mode",
      "public.graph_handoffs in exclusive mode",
      "public.graph_verifications in exclusive mode",
      "public.agent_runs in exclusive mode",
    ]) {
      expect(lockedGuard).toContain(lockedTable);
    }
    for (const lockedInvariant of [
      "locked lineage ledger identity mismatch",
      "locked lineage safety state is not stopped",
      "locked legacy graph artifact containment is incomplete",
      "locked containment RLS ACL or audit boundary is not exact",
      "locked containment manifest or tombstone identity mismatch",
    ]) {
      expect(lockedGuard).toContain(lockedInvariant);
    }

    const verified = run.slice(run.indexOf("VERIFIED=$(psql"));
    for (const postflight of [
      "count(routine)=8",
      "public.decide_node_gate(uuid,boolean,text)",
      "full lifecycle release gates require evidence-bound approval",
      "claim_planned_graph_v2",
      "claim_phase1c_run_v2",
      "diagnose_graph_queue_as_worker_v2",
      "abort_graph_run_as_worker",
      "public.graph_artifact_payload_containments",
      "public.graph_artifacts",
      "public.graph_verifications",
      "INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER",
      "graph_artifact_payload_containments_immutable",
      "graph_artifacts_update_immutable",
      "version='20260827000150'",
      "version='20260827000200'",
      "version='20260827000210'",
      "phase1c_workers",
    ]) {
      expect(verified).toContain(postflight);
    }

    const aclPostflightStart = run.indexOf("lineage_acl_postflight");
    const aclPostflightEnd = run.indexOf(
      "lineage_acl_postflight",
      aclPostflightStart + 1,
    );
    const aclPostflight = run.slice(aclPostflightStart, aclPostflightEnd);
    expect(aclPostflight).not.toBe("");
    const privateAclBlock = aclPostflight.slice(
      aclPostflight.indexOf("'start_graph_run(uuid)'"),
      aclPostflight.indexOf(
        "routine_oid:=to_regprocedure('public.decide_node_gate",
      ),
    );
    const ownerGateAclBlock = aclPostflight.slice(
      aclPostflight.indexOf(
        "routine_oid:=to_regprocedure('public.decide_node_gate",
      ),
      aclPostflight.indexOf("'claim_planned_graph_v2"),
    );
    const workerAclBlock = aclPostflight.slice(
      aclPostflight.indexOf("'claim_planned_graph_v2"),
    );
    expect(privateAclBlock).toMatch(
      /pg_get_userbyid\(routine\.proowner\)\s*<>\s*'postgres'/i,
    );
    expect(ownerGateAclBlock).toMatch(
      /pg_get_userbyid\(routine\.proowner\)\s*=\s*'postgres'/i,
    );
    expect(workerAclBlock).toMatch(
      /pg_get_userbyid\(routine\.proowner\)\s*=\s*'postgres'/i,
    );
    expect(
      aclPostflight.match(/routine\.proacl is null/gi)?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
    expect(
      aclPostflight.match(
        /select count\(\*\) from aclexplode\(routine\.proacl\)/gi,
      )?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
    expect(
      aclPostflight.match(
        /privilege\.grantor\s*=\s*routine\.proowner\s+and privilege\.grantee\s*=\s*routine\.proowner\s+and privilege\.privilege_type\s*=\s*'EXECUTE'\s+and not privilege\.is_grantable/gi,
      )?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
    expect(aclPostflight).toMatch(
      /select count\(\*\) from aclexplode\(routine\.proacl\)\)\s*<>\s*2[\s\S]*?privilege\.grantee\s*=\s*authenticated_oid/i,
    );
    expect(aclPostflight).toMatch(
      /select count\(\*\) from aclexplode\(routine\.proacl\)\)\s*<>\s*2[\s\S]*?privilege\.grantee\s*=\s*service_role_oid/i,
    );
  });
});
