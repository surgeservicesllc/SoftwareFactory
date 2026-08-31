// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20260831001700_grok_read_only_research_runtime.sql",
), "utf8").replace(/\r\n/g, "\n");
const route = readFileSync(resolve(
  process.cwd(),
  "app/api/grok/sessions/route.ts",
), "utf8");
const admission = readFileSync(resolve(
  process.cwd(),
  "lib/grok/provider-admission.ts",
), "utf8");

describe("Grok read-only research runtime contract", () => {
  it("exposes only the service-only, owner-attributed exact-plan launcher", () => {
    expect(migration).toMatch(
      /create function public\.launch_grok_read_only_research_v1_as_server\([\s\S]*?security definer\s+set search_path = pg_catalog/i,
    );
    expect(migration).toMatch(/member\.role = 'owner'::public\.organization_member_role/i);
    expect(migration).toContain("v_session.created_by is distinct from p_requested_by");
    expect(migration).toContain("{plan,intent,kind}' is distinct from 'research'");
    expect(migration).toContain("{plan,graphLaunch,nodes}' is distinct from p_nodes");
    expect(migration).toContain("{plan,graphLaunch,edges}' is distinct from p_edges");
    expect(migration).toMatch(
      /revoke all on function public\.launch_grok_read_only_research_v1_as_server\([\s\S]*?from public, anon, authenticated, service_role;[\s\S]*?grant execute on function public\.launch_grok_read_only_research_v1_as_server\([\s\S]*?to service_role;/i,
    );
  });

  it("admits the exact selected Claude posting for every read-only task", () => {
    expect(admission).toContain("export function buildGrokReadOnlyIntentAdmissions");
    expect(admission).toContain("plan.intent.kind !== \"research\"");
    expect(admission).toContain("rosterByAssignment.get(task.assignmentId)");
    expect(migration).toContain("v_task ->> 'assignmentId' is distinct from v_entry ->> 'assignmentId'");
    expect(migration).toContain("v_task ->> 'model' is distinct from v_entry ->> 'model'");
    expect(migration).toContain("public.grok_specialist_admission_hash(v_specialist)");
    expect(migration).toContain("public.grok_current_execution_admission_hash(v_new)");
    expect(migration).toContain("public.assert_current_grok_execution_admissions(v_graph.id)");
  });

  it("records a paused DAG and never starts, claims, wakes, or mutates repository work", () => {
    expect(migration).toContain("node.value ->> 'executor' is distinct from 'MODEL'");
    expect(migration).toContain("node.value -> 'writes' is distinct from '[]'::jsonb");
    expect(migration).toContain("coalesce((edge.value ->> 'is_feedback')::boolean, false)");
    expect(migration).toContain("public.create_graph_from_plan(");
    expect(migration).toContain("public.set_graph_pause_as_member(p_organization_id, v_graph.id, true)");
    expect(migration).toContain("public.link_grok_task_as_server(");
    expect(migration).toContain("'workerWoken', false");
    expect(migration).toContain("'executionStarted', false");
    expect(migration).not.toMatch(/\b(start_graph_run|claim_planned_graph|wake_phase1c|dispatch)\s*\(/i);
    expect(migration).not.toMatch(/\b(update|insert into)\s+public\.(organizations|autonomy_settings|workers|worker_heartbeats)\b/i);
  });

  it("routes research to its exact graph while deploy stays fail-closed", () => {
    expect(route).toContain("plan.intent.kind === \"deploy\"");
    expect(route).toContain("grok_intent_runtime_bridge_required");
    expect(route).toContain("plan.intent.kind === \"research\"");
    expect(route).toContain("buildGrokReadOnlyIntentAdmissions(");
    expect(route).toContain("\"launch_grok_read_only_research_v1_as_server\"");
    expect(route).toContain("p_nodes: plan.graphLaunch.nodes");
    expect(route).toContain("bridge: plan.intent.kind === \"research\"");
  });
});
