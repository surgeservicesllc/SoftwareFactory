import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
let migration = "";
let graphStore = "";
let phaseStore = "";
let graphWorkflow = "";
let phaseWorkflow = "";

beforeAll(async () => {
  [migration, graphStore, phaseStore, graphWorkflow, phaseWorkflow] = await Promise.all([
    readFile(resolve(
      repositoryRoot,
      "supabase/migrations/20260828000200_target_bound_worker_claims.sql",
    ), "utf8"),
    readFile(resolve(repositoryRoot, "lib/worker/graph-store.ts"), "utf8"),
    readFile(resolve(repositoryRoot, "lib/worker/supabase-store.ts"), "utf8"),
    readFile(resolve(repositoryRoot, ".github/workflows/graph-worker.yml"), "utf8"),
    readFile(resolve(repositoryRoot, ".github/workflows/codex-worker.yml"), "utf8"),
  ]);
});

describe("target-bound worker claim contract", () => {
  it("filters the authoritative graph selector by the dispatched immutable id", () => {
    expect(migration).toMatch(
      /create or replace function public\.claim_planned_graph_by_id_v2\([\s\S]*?p_target_graph_id uuid[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i,
    );
    expect(migration).toMatch(
      /create or replace function public\.claim_planned_graph_target_internal\([\s\S]*?p_target_graph_id uuid[\s\S]*?where \(p_target_graph_id is null or g\.id = p_target_graph_id\)/i,
    );
    expect(migration).toMatch(
      /claimed := public\.claim_planned_graph_target_internal\([\s\S]*?p_target_graph_id[\s\S]*?claimed ->> 'graph_id'[\s\S]*?is distinct from p_target_graph_id/i,
    );
    expect(migration).toMatch(
      /project\.production_url[\s\S]*?'project_production_url', project_production_url/i,
    );
    expect(migration).toMatch(
      /project\.production_url as project_production_url[\s\S]*?'project_production_url', v_graph\.project_production_url/i,
    );
    expect(migration).toMatch(
      /'template_plan_sha256', v_graph\.template_plan_sha256/i,
    );
    expect(migration).toMatch(
      /create or replace function public\.claim_planned_graph_internal\([\s\S]*?return public\.claim_planned_graph_target_internal\(/i,
    );
    expect(migration).not.toMatch(/'deployment_url', project_production_url/i);
  });

  it("filters every authoritative Phase 1C selector by the dispatched command id", () => {
    expect(migration).toMatch(
      /create or replace function public\.claim_phase1c_run_by_command_v2\([\s\S]*?p_target_command_id uuid[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i,
    );
    expect(migration).toMatch(
      /create or replace function public\.claim_phase1c_run_target_budget_internal\([\s\S]*?p_target_command_id uuid[\s\S]*?where \(p_target_command_id is null or run\.command_id = p_target_command_id\)[\s\S]*?select run\.id, portfolio_priority\.value/i,
    );
    expect(migration).toMatch(
      /from public\.claim_phase1c_run_target_internal\([\s\S]*?p_target_command_id[\s\S]*?assert_phase1c_claim_target\(\s*claimed\.command_id,\s*p_target_command_id/i,
    );
    expect(migration).toMatch(
      /authoritative selector can terminalize an exhausted\/stale exact[\s\S]*?return;/i,
    );
    expect(migration).not.toMatch(/target Phase 1C command is not claimable/i);
  });

  it("refuses to replace an unreviewed global selector or weakened legacy API", () => {
    expect(migration).toContain("fdd3eee3e61c083789ffeb4808ed0a47");
    expect(migration).toContain("5933952d71f9da90a2a80a05ce6e0378");
    expect(migration).toMatch(/routine\.prosrc[\s\S]*?source identity mismatch/i);
    expect(migration).toContain(
      "public.claim_planned_graph_v2(text,text[],text,jsonb,integer)",
    );
    expect(migration).toContain(
      "public.claim_phase1c_run_v2(text,text,text,integer,integer)",
    );
    expect(migration).toMatch(/routine\.prosecdef/i);
    expect(migration).toMatch(
      /routine\.proconfig = array\['search_path=pg_catalog'\]::text\[\]/i,
    );
    expect(migration).toMatch(
      /pg_catalog\.pg_get_userbyid\(routine\.proowner\) = 'postgres'/i,
    );
    expect(migration).toMatch(
      /has_function_privilege\('service_role', routine_oid, 'EXECUTE'\)/i,
    );
  });

  it("keeps new claims service-role-only without changing the established APIs", () => {
    for (const signature of [
      "claim_planned_graph_by_id_v2",
      "claim_phase1c_run_by_command_v2",
    ]) {
      expect(migration).toMatch(new RegExp(
        `revoke all on function public\\.${signature}\\([\\s\\S]*?from public, anon, authenticated, service_role`,
        "i",
      ));
      expect(migration).toMatch(new RegExp(
        `grant execute on function public\\.${signature}\\([\\s\\S]*?to service_role`,
        "i",
      ));
    }
    expect(migration).not.toMatch(/revoke all on function public\.claim_planned_graph_v2\(/i);
    expect(migration).not.toMatch(/revoke all on function public\.claim_phase1c_run_v2\(/i);
    for (const signature of [
      "claim_planned_graph_target_internal",
      "claim_planned_graph_internal",
      "claim_phase1c_run_target_budget_internal",
      "claim_phase1c_run_budget_internal",
      "claim_phase1c_run_target_internal",
    ]) {
      expect(migration).toMatch(new RegExp(
        `public\\.${signature}\\(`,
        "i",
      ));
    }
    expect(migration).toMatch(/private target\/global claim metadata or ACL postflight failed/i);
    expect(migration).toMatch(/service-role target\/global claim metadata or ACL postflight failed/i);
  });

  it("routes target-bearing stores through the target-bound RPCs", () => {
    expect(graphStore).toMatch(
      /this\.exactTarget[\s\S]*?claim_planned_graph_by_target_v4[\s\S]*?p_expected_target: graphExecutionTargetClaim\(this\.exactTarget\)/,
    );
    expect(phaseStore).toMatch(
      /this\.targetCommandId[\s\S]*?claim_phase1c_run_by_command_v3[\s\S]*?p_target_command_id: this\.targetCommandId/,
    );
  });

  it("requires dispatch/manual targets while leaving disabled schedules unchanged", () => {
    expect(graphWorkflow).toMatch(/workflow_dispatch:[\s\S]*?graph_id:[\s\S]*?required: true/);
    expect(graphWorkflow).toContain("github.event_name != 'schedule'");
    expect(graphWorkflow).toContain("npx tsx scripts/graph-worker.mts --once");
    expect(graphWorkflow).not.toContain("--drain");
    expect(graphWorkflow).not.toContain("SOFTWAREFACTORY_GRAPH_WORKER_SCHEDULED");
    expect(phaseWorkflow).toMatch(/workflow_dispatch:[\s\S]*?command_id:[\s\S]*?required: true/);
    expect(phaseWorkflow).toContain("SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED == 'true'");
    expect(phaseWorkflow).toContain("github.event_name != 'schedule'");
  });
});
