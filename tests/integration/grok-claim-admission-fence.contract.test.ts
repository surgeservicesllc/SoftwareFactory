// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationPath = resolve(
  repositoryRoot,
  "supabase/migrations/20260831000900_grok_claim_admission_fence.sql",
);

describe("Grok claim admission fence migration contract", () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(migrationPath, "utf8");
  });

  it("revalidates the immutable launch identity at every resume and v3 claim", () => {
    expect(sql).toMatch(
      /create function public\.assert_current_grok_execution_admissions\(\s*p_graph_id uuid\s*\)[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i,
    );
    for (const relation of [
      "grok_graph_launches", "grok_execution_admissions", "bot_assignments", "bots",
      "bot_roles", "ai_accounts", "provider_credentials",
    ]) {
      expect(sql).toMatch(new RegExp(`from public\\.${relation}[\\s\\S]{0,900}for update`, "i"));
    }
    expect(sql).toContain("public.grok_current_execution_admission_hash(v_admission)");
    expect(sql).toMatch(
      /create function public\.grok_current_execution_admission_hash\([\s\S]*?language sql[\s\S]*?immutable[\s\S]*?public\.grok_execution_admission_hash\(p_admission\)/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.grok_current_execution_admission_hash\([\s\S]*?from public, anon, authenticated, service_role/i,
    );
    expect(sql).toContain("public.ai_account_bot_credential_ref(");
    expect(sql).toContain("grok execution admission identity mismatch");
    expect(sql).toContain("grok assignment admission is stale");
    expect(sql).toContain("grok AI account admission is stale");
    expect(sql).toContain("grok sealed credential admission is stale");
  });

  it("keeps legacy non-Grok graph and Phase 1C claims compatible but marks them explicitly", () => {
    const graphProjection = sql.slice(
      sql.indexOf("create function public.attach_current_grok_admissions_to_claim"),
      sql.indexOf("create function public.claim_planned_graph_v3"),
    );
    expect(graphProjection).toContain("'grok_admission_required', false");
    expect(sql).not.toMatch(/\bpg_catalog\.coalesce\s*\(/i);
    const phase1cProjection = sql.slice(
      sql.indexOf("create function public.attach_current_grok_admission_to_phase1c_claim"),
      sql.indexOf("create function public.claim_phase1c_run_v3"),
    );
    expect(phase1cProjection).toMatch(
      /v_grok_admission_required := public\.assert_current_grok_execution_admissions\(v_bridge\.graph_id\);[\s\S]*?if not v_grok_admission_required then[\s\S]*?return p_claim;/i,
    );
  });

  it("projects only bounded admission identity and reads only the exact admitted envelope", () => {
    const projection = sql.slice(
      sql.indexOf("create function public.grok_execution_admission_projection"),
      sql.indexOf("create function public.attach_current_grok_admissions_to_claim"),
    );
    expect(projection).toContain("'admission_sha256'");
    expect(projection).toContain("'credential_ref'");
    expect(projection).not.toContain("sealed_envelope");

    const reader = sql.slice(
      sql.indexOf("create function public.read_grok_execution_credential_as_worker"),
      sql.indexOf("create function public.apply_grok_graph_control_v2_as_owner"),
    );
    expect(reader).toContain("admission.id = p_admission_id");
    expect(reader).toContain("p_admission_sha256 is distinct from v_admission.admission_sha256");
    expect(reader).toContain("credential.id = v_admission.provider_credential_id");
    expect(reader).toContain("credential.rotated_at = v_admission.provider_credential_rotated_at");
    expect(reader).toMatch(
      /grant execute on function public\.read_grok_execution_credential_as_worker\([\s\S]*?to service_role/i,
    );
  });

  it("authorizes tenant callers before the private admission validator", () => {
    const ownerWrapper = sql.slice(
      sql.indexOf("create function public.apply_grok_graph_control_v2_as_owner"),
      sql.indexOf("create function public.set_graph_pause_as_member_v2"),
    );
    expect(ownerWrapper.indexOf("public.has_organization_role")).toBeGreaterThan(-1);
    expect(ownerWrapper.indexOf("public.assert_current_grok_execution_admissions")).toBeGreaterThan(
      ownerWrapper.indexOf("public.has_organization_role"),
    );
    expect(ownerWrapper).toContain("launch.graph_id = p_graph_id");
    expect(ownerWrapper).toContain("session.id = p_session_id");

    const memberWrapper = sql.slice(
      sql.indexOf("create function public.set_graph_pause_as_member_v2"),
      sql.indexOf("create function public.assert_grok_graph_admission_as_member"),
    );
    expect(memberWrapper.indexOf("public.is_organization_member")).toBeGreaterThan(-1);
    expect(memberWrapper.indexOf("public.assert_current_grok_execution_admissions")).toBeGreaterThan(
      memberWrapper.indexOf("public.is_organization_member"),
    );
  });

  it("cuts service workers over to v3 and leaves no public validator or legacy mutator grant", () => {
    for (const signature of [
      "claim_planned_graph_v2(text, text[], text, jsonb, integer)",
      "claim_planned_graph_by_id_v2(text, text[], text, jsonb, uuid, integer)",
      "claim_phase1c_run_v2(text, text, text, integer, integer)",
      "claim_phase1c_run_by_command_v2(text, text, text, integer, uuid, integer)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature}`);
    }
    expect(sql).toMatch(
      /grant execute on function public\.claim_planned_graph_v3\([\s\S]*?to service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.claim_phase1c_run_v3\([\s\S]*?to service_role/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.assert_current_grok_execution_admissions\(uuid\)\s+from public, anon, authenticated, service_role/i,
    );
    expect(sql).not.toMatch(/grant execute on function public\.assert_current_grok_execution_admissions/i);
  });

  it("carries one exact admitted OpenAI model through guarded submission, queue, and claim", () => {
    expect(sql).toMatch(/create table public\.grok_phase1c_submission_guards[\s\S]*?grok_phase1c_submission_guard_project_fk[\s\S]*?grok_phase1c_submission_guard_bridge_fk[\s\S]*?grok_phase1c_submission_guard_admission_fk/i);
    expect(sql).toMatch(/alter table public\.grok_phase1c_submission_guards enable row level security;[\s\S]*?force row level security;[\s\S]*?revoke all on table public\.grok_phase1c_submission_guards/i);
    expect(sql).toMatch(/is_current_grok_phase1c_submission_authorized\([\s\S]*?guard\.organization_id = p_organization_id[\s\S]*?p_idempotency_key = 'graph-phase1c:' \|\| bridge\.id::text[\s\S]*?guard\.authorized_parameters = p_parameters[\s\S]*?assert_current_grok_execution_admissions/i);
    expect(sql).toContain("p_parameters ? '_grokPhase1CAuthorization'");
    expect(sql).toMatch(/coalesce\(v_grok_token, ''\) !~/i);
    expect(sql).toMatch(/provider_text is distinct from 'openai'/i);
    expect(sql).toMatch(/model_text is distinct from 'gpt-5\.3-codex'/i);
    expect(sql).toMatch(/create or replace function public\.queue_phase1c_run_for_task\([\s\S]*?validate_current_grok_phase1c_command_route/i);
    expect(sql).toMatch(/create or replace function public\.attach_graph_phase1c_command_for_approved_gate\([\s\S]*?validate_current_grok_phase1c_command_route/i);
    expect(sql).toContain("softwarefactory.phase1c_claim_scope");
    expect(sql).toContain("Grok Phase 1C run does not match its exact admission");
  });

  it("pins every new guard and function object in the migration postflight", () => {
    const postflight = sql.slice(sql.lastIndexOf("do $postflight$"));
    expect(postflight).toContain("v_function_count <> 25");
    expect(postflight).toContain("grok_phase1c_submission_guard_bridge_unique");
    expect(postflight).toContain("grok_phase1c_submission_guards_project_expiry_idx");
    expect(postflight).toContain("relation.relrowsecurity");
    expect(postflight).toContain("relation.relforcerowsecurity");
    expect(postflight).toContain("routine.provolatile = v_expected.volatility");
    expect(postflight).toContain("privilege.grantor <> routine.proowner");
    expect(postflight).toContain("pg_catalog.obj_description");
  });

  it("does not enable execution, autonomy, automatic actions, or weaken the kill switch", () => {
    expect(sql).not.toMatch(/update\s+public\.runtime_control/i);
    expect(sql).not.toMatch(/worker_enabled\s*=\s*true/i);
    expect(sql).not.toMatch(/autonom(?:y|ous_mode)\s*=\s*true/i);
    expect(sql).not.toMatch(/automatic_actions?\s*=\s*true/i);
    expect(sql).not.toMatch(/kill_switch(?:_enabled)?\s*=\s*false/i);
  });
});
