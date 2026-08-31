// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20260831001800_grok_deploy_readiness_runtime.sql",
), "utf8").replace(/\r\n/g, "\n");
const route = readFileSync(resolve(
  process.cwd(),
  "app/api/grok/sessions/route.ts",
), "utf8");
const admission = readFileSync(resolve(
  process.cwd(),
  "lib/grok/provider-admission.ts",
), "utf8");
const graphWorker = readFileSync(resolve(
  process.cwd(),
  "scripts/graph-worker.mts",
), "utf8");
const claudeExecutor = readFileSync(resolve(
  process.cwd(),
  "lib/worker/claude-node-executor.ts",
), "utf8");

describe("Grok deploy-readiness runtime contract", () => {
  it("exposes one service-only owner-attributed forward boundary", () => {
    expect(migration).toMatch(
      /create function public\.launch_grok_deploy_readiness_v1_as_server\([\s\S]*?security definer\s+set search_path = pg_catalog/i,
    );
    expect(migration).toMatch(/member\.role = 'owner'::public\.organization_member_role/i);
    expect(migration).toContain("v_session.created_by is distinct from p_requested_by");
    expect(migration).toMatch(
      /revoke all on function public\.launch_grok_deploy_readiness_v1_as_server\([\s\S]*?from public, anon, authenticated, service_role;[\s\S]*?grant execute on function public\.launch_grok_deploy_readiness_v1_as_server\([\s\S]*?to service_role;/i,
    );
    expect(migration).toContain("public.record_grok_specialist_roster_v2_as_server(");
    expect(migration).not.toContain("public.record_grok_specialist_roster_v1_as_server(");
  });

  it("proves the source plan remains RED and excludes only its HUMAN delivery handoff", () => {
    expect(migration).toContain("{intent,kind}' is distinct from 'deploy'");
    expect(migration).toContain("{intent,risk}' is distinct from 'RED'");
    expect(migration).toContain("{graphLaunch,riskLevel}' is distinct from 'red'");
    expect(migration).toContain("{graphLaunch,requiresOwnerApproval}' is distinct from 'true'");
    expect(migration).toContain("{delivery,mode}' is distinct from 'HANDOFF_ONLY'");
    expect(migration).toContain("{delivery,taskId}' is distinct from 'delivery'");
    expect(migration).toContain("{delivery,ownerApprovalRequired}' is distinct from 'true'");
    expect(migration).toContain("v_message.sequence_no is distinct from 2::bigint");
    expect(migration).toContain("v_message.content is distinct from");
    expect(migration).toContain("pg_catalog.btrim(v_user_message.content) is distinct from v_plan #>> '{intent,prompt}'");
    expect(migration).toContain("task.value ->> 'job' is distinct from case task.value ->> 'id'");
    expect(migration).toContain("node.value ->> 'job' is distinct from case node.value ->> 'node_key'");
    expect(migration).toContain("'input_schema', node.value -> 'input_schema'");
    expect(migration).toContain("when 'verification_fan_in' then 'cf53dc6e3d1892c9f72d5afd8d7c1071a2b79eed4aa41f0fcc80fa5ec189bd95'");
    expect(migration).toContain("where node.value ->> 'node_key' is distinct from 'delivery'");
    expect(migration).toContain("'excludedTasks', pg_catalog.jsonb_build_array('delivery')");
    expect(migration).toContain("'sourcePlanSha256', v_plan_sha256");
  });

  it("admits exactly four Claude MODEL inspections with no resources, writes, or gates", () => {
    expect(admission).toContain("export function buildGrokDeployReadinessProjection");
    expect(admission).toContain("export function buildGrokDeployReadinessAdmissions");
    expect(admission).toContain("node.reads.length > 0 || node.writes.length > 0 || node.gate_kind !== null");
    expect(migration).toContain("pg_catalog.jsonb_array_length(p_nodes) is distinct from 4");
    expect(migration).toContain("node.value ->> 'executor' is distinct from 'MODEL'");
    expect(migration).toContain("node.value -> 'reads' is distinct from '[]'::jsonb");
    expect(migration).toContain("node.value -> 'writes' is distinct from '[]'::jsonb");
    expect(migration).toContain("node.value -> 'gate_kind' is distinct from 'null'::jsonb");
    expect(migration).toContain("contract.reads is distinct from '[]'::jsonb");
    expect(migration).toContain("contract.writes is distinct from '[]'::jsonb");
    expect(migration).toContain("from public.graph_gates gate");
    expect(migration).toContain("v_admission_count is distinct from 4");
  });

  it("uses null-safe protocol checks and exact specialist/admission hashes", () => {
    expect(migration).toContain("admission.value ->> 'version' is distinct from '2'");
    expect(migration).toContain("v_entry ->> 'version' is distinct from '2'");
    expect(migration).not.toMatch(/->>\s*'version'\s*<>/i);
    expect(migration).not.toMatch(/jsonb_typeof\([^\n]+\)\s*<>/i);
    expect(migration).toContain("v_task ->> 'assignmentId' is distinct from v_entry ->> 'assignmentId'");
    expect(migration).toContain("v_task ->> 'model' is distinct from v_entry ->> 'model'");
    expect(migration).toContain("public.grok_specialist_admission_hash(v_specialist)");
    expect(migration).toContain("public.grok_current_execution_admission_hash(v_new)");
    expect(migration).toContain("public.assert_current_grok_execution_admissions(v_graph.id)");
  });

  it("records one paused graph without a run, wake, merge, or deployment", () => {
    expect(migration).toContain("public.create_graph_from_plan(");
    expect(migration).toContain("public.set_graph_pause_as_member(p_organization_id, v_graph.id, true)");
    expect(migration).toContain("public.link_grok_task_as_server(");
    expect(migration).toContain("'workerWoken', false");
    expect(migration).toContain("'executionStarted', false");
    expect(migration).toContain("'productionChanged', false");
    expect(migration).not.toMatch(/\b(start_graph_run|claim_planned_graph|wake_phase1c|dispatch)\s*\(/i);
    expect(migration).not.toMatch(/\b(update|insert into)\s+public\.(organizations|autonomy_settings|workers|worker_heartbeats)\b/i);
    expect(graphWorker).toContain("parsed.graph.goal === GROK_DEPLOY_READINESS_GOAL");
    expect(graphWorker).toContain("? { allowedTools: [] as const }");
    expect(claudeExecutor).toContain("allowedTools: options.allowedTools ?? [\"Read\", \"Glob\", \"Grep\"]");
  });

  it("routes deploy to the dedicated projection without resolving release mutation identity", () => {
    expect(route).toContain("buildGrokDeployReadinessProjection(plan)");
    expect(route).toContain("buildGrokDeployReadinessAdmissions(plan, readiness.nodes)");
    expect(route).toContain('"launch_grok_deploy_readiness_v1_as_server"');
    expect(route).toContain("p_nodes: readiness.nodes");
    expect(route).toContain('"deploy_readiness_v1"');
  });
});
