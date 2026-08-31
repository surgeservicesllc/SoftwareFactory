// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";


const ownerId = "00000000-0000-4000-8000-00000000e101";
const organizationId = "10000000-0000-4000-8000-00000000e101";
const projectId = "20000000-0000-4000-8000-00000000e101";
const graphId = "30000000-0000-4000-8000-00000000e101";
const graphRunId = "40000000-0000-4000-8000-00000000e101";
const implementationNodeId = "50000000-0000-4000-8000-00000000e101";
const monitorNodeId = "50000000-0000-4000-8000-00000000e102";
const implementationNodeRunId = "60000000-0000-4000-8000-00000000e101";
const monitorNodeRunId = "60000000-0000-4000-8000-00000000e102";
const monitorArtifactId = "70000000-0000-4000-8000-00000000e101";
const bridgeId = "80000000-0000-4000-8000-00000000e101";
const deploymentId = "90000000-0000-4000-8000-00000000e101";
const architectureGateId = "81000000-0000-4000-8000-00000000e101";
const architectureArtifactId = "82000000-0000-4000-8000-00000000e101";
const commandId = "83000000-0000-4000-8000-00000000e101";
const taskId = "84000000-0000-4000-8000-00000000e101";
const agentRunId = "85000000-0000-4000-8000-00000000e101";
const pullRequestId = "86000000-0000-4000-8000-00000000e101";
const agentId = "87000000-0000-4000-8000-00000000e101";
const mergeSha = "c".repeat(40);
const deploymentUrl = "https://deploy.factory.test";
const publicUrl = "https://www.factory.test";
const legacyPlanDigest = "ac9bde8fc1cdd21e735f02b1fa7d940ab680c2bde8c1ec24d704d42c59045a09";
const priorPostdeployPlanDigest = "0ec1e97b80dc8696872d88162c5271f9ea822e7dea79556c5470730a025d3b49";
const validatedPlanDigest = "02bb1e7b35782fad9f6024c080bd149f7ade4edb9d68326fd3b04ff94ba589ad";

type FixtureOptions = {
  readonly artifactReleaseSha?: string;
  readonly conflictingMonitor?: boolean;
  readonly legacyPlan?: boolean;
  readonly priorPostdeployPlan?: boolean;
};

function validationChecks() {
  return [
    { stage: "identity", name: "exact_release_identity", required: true, result: "pass" },
    { stage: "availability", name: "public_health", required: true, result: "pass" },
    { stage: "data_integration", name: "database_reachable", required: true, result: "pass" },
    { stage: "quality_security", name: "ci_and_security_headers", required: true, result: "pass" },
    { stage: "observation", name: "consecutive_observations", required: true, result: "pass" },
  ];
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

async function createFixture(options: FixtureOptions = {}) {
  const // The chain, restored from a snapshot rather than replayed; the
 // helper keys its cache on the CONTENT of every migration, and
 // asserts coverage of the whole directory.
 db = await createMigratedDatabase();

  const now = Date.now();
  const deploymentStartedAt = new Date(now - 40_000).toISOString();
  const deploymentCompletedAt = new Date(now - 30_000).toISOString();
  const monitorStartedAt = new Date(now - 20_000).toISOString();
  const validationStartedAt = new Date(now - 18_000).toISOString();
  const observedAt = new Date(now - 10_000).toISOString();
  const validationCompletedAt = new Date(now - 5_000).toISOString();
  const artifactCreatedAt = new Date(now - 4_000).toISOString();
  const monitorCompletedAt = new Date(now - 3_000).toISOString();
  const payload = options.legacyPlan
    ? {
        observation: "production_http_probe",
        deploymentId,
        url: deploymentUrl,
        status: 200,
        healthy: true,
        observedAt,
        latencyMs: 42,
        postDeployValidation: "inconclusive",
        observationWindowComplete: false,
        missingValidationStages: ["data_integration", "quality_security", "observation"],
      }
    : {
        observation: "production_http_probe",
        deploymentId,
        deploymentUrl,
        url: publicUrl,
        releaseSha: options.artifactReleaseSha ?? mergeSha,
        status: 200,
        healthy: true,
        postDeployValidation: "passed",
        observationWindowComplete: true,
        startedAt: validationStartedAt,
        observedAt,
        completedAt: validationCompletedAt,
        latencyMs: 42,
        checks: validationChecks(),
      };

  // The fixture installs an already-observed exact release. Foreign-key
  // trigger bypass is limited to this setup so circular graph-run/bridge
  // identities can be planted without invoking any executor or automatic
  // action. Runtime checks and all table constraints remain active afterward.
  await db.exec(`
    set session_replication_role = replica;
    insert into auth.users (id) values ('${ownerId}');
    insert into public.organizations (id, name, slug, created_by)
    values ('${organizationId}', 'Validation Factory', 'validation-factory', '${ownerId}');
    insert into public.organization_members (organization_id, user_id, role, created_by)
    values ('${organizationId}', '${ownerId}', 'owner', '${ownerId}');
    insert into public.projects (
      id, organization_id, name, status, github_repository, default_branch,
      production_url, autonomous_mode, auto_approve, auto_merge, auto_deploy,
      auto_rollback, created_by
    ) values (
      '${projectId}', '${organizationId}', 'Validated Release', 'active',
      'factory/validated-release', 'main', '${publicUrl}', false, false, false,
      false, false, '${ownerId}'
    );
    insert into public.graphs (
      id, organization_id, project_id, goal, topology, risk_level,
      requires_owner_approval, created_by, is_lifecycle, template_key,
      template_version, template_plan_sha256, github_repository_id,
      base_branch, base_sha, required_check_names, required_checks_sha256
    ) values (
      '${graphId}', '${organizationId}', '${projectId}', 'Validate exact release',
      'SEQUENTIAL', 'yellow', false, '${ownerId}', true, 'full_lifecycle', 2,
      '${options.legacyPlan
        ? legacyPlanDigest
        : options.priorPostdeployPlan
          ? priorPostdeployPlanDigest
          : validatedPlanDigest}',
      '${"31000000-0000-4000-8000-00000000e101"}',
      'main', '${"b".repeat(40)}', '["Quality"]'::jsonb,
      encode(sha256(convert_to('["Quality"]'::jsonb::text, 'UTF8')), 'hex')
    );
    insert into public.graph_nodes (
      id, organization_id, graph_id, node_key, job, executor, capability,
      lifecycle_stage, gate_kind
    ) values
      ('${implementationNodeId}', '${organizationId}', '${graphId}', 'implement',
       'Implement exact release', 'ANCHOR', 'implementation', 'IMPLEMENTATION', null),
      ('${monitorNodeId}', '${organizationId}', '${graphId}', 'monitor',
       'Validate exact release', 'ANCHOR', 'synthesis', 'MONITORING', null);
    insert into public.graph_runs (
      id, organization_id, graph_id, phase1c_bridge_id, state, nodes_started,
      started_at, created_by
    ) values (
      '${graphRunId}', '${organizationId}', '${graphId}', '${bridgeId}',
      'RUNNING', 2, '${new Date(now - 60_000).toISOString()}', '${ownerId}'
    );
    insert into public.node_runs (
      id, organization_id, graph_run_id, node_id, state, attempt,
      queued_at, started_at, completed_at
    ) values
      ('${implementationNodeRunId}', '${organizationId}', '${graphRunId}',
       '${implementationNodeId}', 'COMPLETED', 1,
       '${new Date(now - 55_000).toISOString()}',
       '${new Date(now - 50_000).toISOString()}',
       '${new Date(now - 45_000).toISOString()}'),
      ('${monitorNodeRunId}', '${organizationId}', '${graphRunId}',
       '${monitorNodeId}', 'COMPLETED', 1, '${monitorStartedAt}',
       '${monitorStartedAt}', '${monitorCompletedAt}');
    insert into public.deployments (
      id, organization_id, project_id, environment, provider,
      external_reference, commit_sha, url, status, started_at, completed_at
    ) values (
      '${deploymentId}', '${organizationId}', '${projectId}', 'Production',
      'vercel', 'dpl_exact', '${mergeSha}', '${deploymentUrl}', 'succeeded',
      '${deploymentStartedAt}', '${deploymentCompletedAt}'
    );
    insert into public.graph_phase1c_bridges (
      id, organization_id, project_id, graph_id, graph_run_id,
      implementation_node_id, architecture_gate_id, architecture_artifact_id,
      architecture_intent_sha256, command_id, task_id, agent_run_id,
      pull_request_id, head_sha, merge_commit_sha, deployment_id, state,
      created_by
    ) values (
      '${bridgeId}', '${organizationId}', '${projectId}', '${graphId}', '${graphRunId}',
      '${implementationNodeId}', '${architectureGateId}',
      '${architectureArtifactId}', '${"d".repeat(64)}',
      '${commandId}', '${taskId}', '${agentRunId}',
      '${pullRequestId}', '${"e".repeat(40)}',
      '${mergeSha}', '${deploymentId}', 'DEPLOYMENT_RECORDED', '${ownerId}'
    );
    insert into public.graph_artifacts (
      id, organization_id, graph_run_id, node_run_id, kind, payload, created_at
    ) values
    (
      '${architectureArtifactId}', '${organizationId}', '${graphRunId}',
      '${implementationNodeRunId}', 'RAW', '{"architecture":"approved"}'::jsonb,
      '${new Date(now - 44_000).toISOString()}'
    ),
    (
      '${monitorArtifactId}', '${organizationId}', '${graphRunId}',
      '${monitorNodeRunId}', 'ANCHOR', '${JSON.stringify(payload)}'::jsonb,
      '${artifactCreatedAt}'
    );
    insert into public.graph_gates (
      id, organization_id, graph_id, node_id, stage, kind, state,
      anchor_count, opened_by_run_id, opened_at
    ) values (
      '${architectureGateId}', '${organizationId}', '${graphId}',
      '${implementationNodeId}', 'ARCHITECTURE', 'HUMAN', 'OPEN', 1,
      '${graphRunId}', '${new Date(now - 43_000).toISOString()}'
    );
    insert into public.agents (
      id, organization_id, project_id, name, role, status, created_by
    ) values (
      '${agentId}', '${organizationId}', '${projectId}', 'Release validator',
      'backend', 'idle', '${ownerId}'
    );
    insert into public.commands (
      id, organization_id, project_id, submitted_by, prompt, requested_risk,
      status, completed_at
    ) values (
      '${commandId}', '${organizationId}', '${projectId}', '${ownerId}',
      'Validate the exact production release', 'yellow', 'succeeded',
      '${new Date(now - 42_000).toISOString()}'
    );
    insert into public.tasks (
      id, organization_id, project_id, command_id, assigned_agent_id, title,
      status, risk_level, started_at, completed_at, created_by
    ) values (
      '${taskId}', '${organizationId}', '${projectId}', '${commandId}', '${agentId}',
      'Validate release', 'completed', 'yellow',
      '${new Date(now - 42_000).toISOString()}',
      '${new Date(now - 41_000).toISOString()}', '${ownerId}'
    );
    insert into public.agent_runs (
      id, organization_id, project_id, task_id, agent_id, status,
      started_at, completed_at
    ) values (
      '${agentRunId}', '${organizationId}', '${projectId}', '${taskId}', '${agentId}',
      'succeeded', '${new Date(now - 42_000).toISOString()}',
      '${new Date(now - 41_000).toISOString()}'
    );
    insert into public.pull_requests (
      id, organization_id, project_id, agent_run_id, repository,
      external_number, title, url, head_branch, base_branch, status,
      risk_level, opened_at, merged_at, head_sha, merge_commit_sha
    ) values (
      '${pullRequestId}', '${organizationId}', '${projectId}', '${agentRunId}',
      'factory/validated-release', 101, 'Validated release',
      'https://github.com/factory/validated-release/pull/101', 'release/exact',
      'main', 'merged', 'yellow', '${new Date(now - 50_000).toISOString()}',
      '${new Date(now - 41_000).toISOString()}', '${"e".repeat(40)}', '${mergeSha}'
    );
    set session_replication_role = origin;
  `);

  if (options.conflictingMonitor) {
    await db.query(
      `insert into public.production_monitors (
         organization_id, project_id, name, signal_kind, provider, target_url,
         target_reference, connection_state, enabled, expected_status_code,
         created_by
       ) values ($1, $2, 'Conflicting validation monitor', 'uptime', 'http',
         'https://wrong.factory.test', $3, 'connected', false, 200, $4)`,
      [organizationId, projectId, `graph_phase1c_bridge:${bridgeId}`, ownerId],
    );
  }
  return db;
}

async function complete(db: PGlite, tokens = 12) {
  await resetRole(db);
  await db.exec("set role service_role");
  try {
    return await db.query<{ id: string }>(
      `select (public.complete_graph_run_with_validated_release_as_worker(
         'validation-worker', $1, 'COMPLETED', false, $2, 34, null,
         'Validated exact release.'
       )).id as id`,
      [graphRunId, tokens],
    );
  } finally {
    await resetRole(db);
  }
}

async function readWriteState(db: PGlite) {
  return (await db.query<{
    bridge_state: string;
    completed_at: string | null;
    monitor_count: number;
    observation_count: number;
    run_event_count: number;
    run_state: string;
    validation_count: number;
  }>(
    `select
       (select state::text from public.graph_runs where id = $1) as run_state,
       (select completed_at::text from public.graph_runs where id = $1) as completed_at,
       (select state from public.graph_phase1c_bridges where id = $2) as bridge_state,
       (select count(*)::integer from public.production_monitors
         where target_reference = 'graph_phase1c_bridge:' || $2::uuid::text) as monitor_count,
       (select count(*)::integer from public.monitor_observations
         where deployment_id = $3) as observation_count,
       (select count(*)::integer from public.deployment_validations
         where deployment_id = $3) as validation_count,
       (select count(*)::integer from public.graph_events
         where graph_run_id = $1 and event_type = 'run_completed') as run_event_count`,
    [graphRunId, bridgeId, deploymentId],
  )).rows[0];
}

describe("validated lifecycle completion", { timeout: 240_000 }, () => {
  it("atomically records the exact release, reaches VALIDATED, and replays once", async () => {
    const db = await createFixture();
    try {
      expect((await complete(db)).rows).toEqual([{ id: graphRunId }]);
      expect((await complete(db)).rows).toEqual([{ id: graphRunId }]);

      const state = await readWriteState(db);
      expect(state).toMatchObject({
        bridge_state: "VALIDATED",
        monitor_count: 1,
        observation_count: 1,
        run_event_count: 1,
        run_state: "COMPLETED",
        validation_count: 1,
      });
      expect(state.completed_at).not.toBeNull();

      const evidence = await db.query<{
        autonomous_mode: boolean;
        baseline_reference: string;
        correlations_match: boolean;
        enabled: boolean;
        evidence_release_sha: string;
        monitor_url: string;
        validation_state: string;
        validator_version: string;
      }>(
        `select project.autonomous_mode, monitor.enabled,
                monitor.target_url as monitor_url,
                validation.state::text as validation_state,
                validation.validator_version, validation.baseline_reference,
                observation.evidence ->> 'releaseSha' as evidence_release_sha,
                observation.correlation_id = validation.correlation_id as correlations_match
         from public.graph_phase1c_bridges bridge
         join public.projects project on project.id = bridge.project_id
         join public.monitor_observations observation
           on observation.id = bridge.monitor_observation_id
         join public.production_monitors monitor on monitor.id = observation.monitor_id
         join public.deployment_validations validation
           on validation.id = bridge.deployment_validation_id
         where bridge.id = $1`,
        [bridgeId],
      );
      expect(evidence.rows).toEqual([{
        autonomous_mode: false,
        baseline_reference: `release:${mergeSha}`,
        correlations_match: true,
        enabled: false,
        evidence_release_sha: mergeSha,
        monitor_url: publicUrl,
        validation_state: "passed",
        validator_version: "graph-production-validator-v3",
      }]);
    } finally {
      await db.close();
    }
  });

  it("keeps a pre-release v2 graph on its stored legacy monitor contract", async () => {
    const db = await createFixture({ legacyPlan: true });
    try {
      expect((await complete(db)).rows).toEqual([{ id: graphRunId }]);
      expect((await complete(db)).rows).toEqual([{ id: graphRunId }]);

      const state = await readWriteState(db);
      expect(state).toMatchObject({
        bridge_state: "MONITORING_RECORDED",
        monitor_count: 1,
        observation_count: 1,
        run_event_count: 1,
        run_state: "COMPLETED",
        validation_count: 1,
      });
      const legacyEvidence = await db.query<{
        monitor_url: string;
        validation_state: string;
        validator_version: string;
      }>(
        `select monitor.target_url as monitor_url,
                validation.state::text as validation_state,
                validation.validator_version
         from public.graph_phase1c_bridges bridge
         join public.monitor_observations observation
           on observation.id = bridge.monitor_observation_id
         join public.production_monitors monitor on monitor.id = observation.monitor_id
         join public.deployment_validations validation
           on validation.organization_id = observation.organization_id
          and validation.project_id = observation.project_id
          and validation.deployment_id = observation.deployment_id
          and validation.correlation_id = observation.correlation_id
         where bridge.id = $1`,
        [bridgeId],
      );
      expect(legacyEvidence.rows).toEqual([{
        monitor_url: deploymentUrl,
        validation_state: "inconclusive",
        validator_version: "graph-http-probe-v2",
      }]);
    } finally {
      await db.close();
    }
  });

  it("keeps the preceding post-deploy digest on the strong validated completion path", async () => {
    const db = await createFixture({ priorPostdeployPlan: true });
    try {
      expect((await complete(db)).rows).toEqual([{ id: graphRunId }]);

      expect(await readWriteState(db)).toMatchObject({
        bridge_state: "VALIDATED",
        monitor_count: 1,
        observation_count: 1,
        run_event_count: 1,
        run_state: "COMPLETED",
        validation_count: 1,
      });
    } finally {
      await db.close();
    }
  });

  it("rejects mismatched release evidence before writing terminal state", async () => {
    const db = await createFixture({ artifactReleaseSha: "f".repeat(40) });
    try {
      await expect(complete(db)).rejects.toThrow(/exact passing post-deploy evidence/i);
      expect(await readWriteState(db)).toEqual({
        bridge_state: "DEPLOYMENT_RECORDED",
        completed_at: null,
        monitor_count: 0,
        observation_count: 0,
        run_event_count: 0,
        run_state: "RUNNING",
        validation_count: 0,
      });
    } finally {
      await db.close();
    }
  });

  it("refuses a replay after the public release identity changes", async () => {
    const db = await createFixture();
    try {
      await complete(db);
      await db.query(
        "update public.projects set production_url = $2 where id = $1",
        [projectId, "https://moved.factory.test"],
      );
      await expect(complete(db)).rejects.toThrow(/no exact passing validation lineage/i);
      expect(await readWriteState(db)).toMatchObject({
        bridge_state: "VALIDATED",
        monitor_count: 1,
        observation_count: 1,
        run_event_count: 1,
        run_state: "COMPLETED",
        validation_count: 1,
      });
    } finally {
      await db.close();
    }
  });

  it("rolls back the graph close when stored monitor identity conflicts later", async () => {
    const db = await createFixture({ conflictingMonitor: true });
    try {
      await expect(complete(db)).rejects.toThrow(/stored production monitor conflicts/i);
      expect(await readWriteState(db)).toEqual({
        bridge_state: "DEPLOYMENT_RECORDED",
        completed_at: null,
        monitor_count: 1,
        observation_count: 0,
        run_event_count: 0,
        run_state: "RUNNING",
        validation_count: 0,
      });
    } finally {
      await db.close();
    }
  });
});
