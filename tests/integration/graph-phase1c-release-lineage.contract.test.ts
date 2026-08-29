// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260827000200_graph_phase1c_release_lineage.sql",
);
const sql = readFileSync(migrationPath, "utf8");

describe("graph Phase 1C release lineage migration contract", () => {
  it("adds exact graph, PR, and deployment-observation identities", () => {
    for (const column of [
      "template_key",
      "template_version",
      "template_plan_sha256",
      "github_repository_id",
      "base_branch",
      "base_sha",
    ]) {
      expect(sql).toMatch(new RegExp(`add column if not exists ${column}\\b`, "i"));
    }
    expect(sql).toMatch(/alter table public\.pull_requests[\s\S]*head_sha text[\s\S]*merge_commit_sha text/i);
    expect(sql).toMatch(/alter table public\.monitor_observations[\s\S]*deployment_id uuid/i);
    expect(sql).toMatch(/monitor_observations_deployment_fk[\s\S]*references public\.deployments\(id, organization_id\)/i);
    expect(sql).toMatch(/alter table public\.graph_runs[\s\S]*phase1c_bridge_id uuid/i);
    expect(sql).toMatch(
      /graph_runs_phase1c_bridge_fk[\s\S]*foreign key \(phase1c_bridge_id, organization_id\)[\s\S]*references public\.graph_phase1c_bridges\(id, organization_id\)/i,
    );
    expect(sql).toMatch(/graph run Phase 1C bridge identity is write-once/i);
    expect(sql).toMatch(/full_lifecycle v2 plan does not match its canonical digest/i);
    expect(sql).toMatch(
      /if tg_op = 'UPDATE'\s+and new\.phase1c_bridge_id is distinct from old\.phase1c_bridge_id/i,
    );
  });

  it("defines a tenant-scoped, RLS-forced, read-only bridge", () => {
    expect(sql).toMatch(/create table public\.graph_phase1c_bridges/i);
    expect(sql).toMatch(/alter table public\.graph_phase1c_bridges enable row level security/i);
    expect(sql).toMatch(/alter table public\.graph_phase1c_bridges force row level security/i);
    expect(sql).toMatch(/for select to authenticated[\s\S]*is_organization_member\(organization_id\)/i);
    expect(sql).toMatch(/revoke all on table public\.graph_phase1c_bridges[\s\S]*service_role/i);
    expect(sql).toMatch(/grant select on table public\.graph_phase1c_bridges to authenticated/i);
    expect(sql).not.toMatch(/grant\s+(?:insert|update|delete|all)[^;]*graph_phase1c_bridges/i);

    expect(sql).toMatch(/create table public\.graph_release_gate_approval_intents/i);
    expect(sql).toMatch(/alter table public\.graph_release_gate_approval_intents enable row level security/i);
    expect(sql).toMatch(/alter table public\.graph_release_gate_approval_intents force row level security/i);
    expect(sql).toMatch(
      /revoke all on table public\.graph_release_gate_approval_intents[\s\S]*?from public, anon, authenticated, service_role/i,
    );
    expect(sql).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)[^;]*graph_release_gate_approval_intents/i,
    );
  });

  it("makes artifact payloads update-immutable while retaining cascade-only deletion", () => {
    expect(sql).toMatch(
      /create or replace function public\.enforce_graph_artifact_update_immutable\(\)[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i,
    );
    expect(sql).toMatch(
      /create trigger graph_artifacts_update_immutable\s+before update on public\.graph_artifacts\s+for each row execute function public\.enforce_graph_artifact_update_immutable\(\)/i,
    );
    expect(sql).not.toMatch(
      /create trigger graph_artifacts_update_immutable\s+before update or delete/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.enforce_graph_artifact_update_immutable\(\)\s+from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /revoke all on table public\.graph_artifacts from public, anon, service_role/i,
    );
    expect(sql).toMatch(
      /revoke insert, update, delete, truncate, references, trigger\s+on table public\.graph_artifacts from authenticated/i,
    );
    expect(sql).toMatch(
      /graph_release_gate_intents_artifact_fk[\s\S]*?references public\.graph_artifacts\(id, organization_id\) on delete restrict/i,
    );
  });

  it("binds release intents to immutable exact artifact digests", () => {
    expect(sql).toMatch(/evidence_sha256 text not null check \(evidence_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
    expect(sql).toMatch(
      /create trigger graph_release_gate_intents_immutable\s+before update or delete on public\.graph_release_gate_approval_intents/i,
    );
    expect(sql).toMatch(
      /new\.evidence_sha256 is distinct from old\.evidence_sha256[\s\S]*?release gate approval intent identity is immutable/i,
    );
    expect(sql).toMatch(
      /insert into public\.graph_release_gate_approval_intents \([\s\S]*?evidence_artifact_id, evidence_sha256[\s\S]*?artifact_record\.id, artifact_sha256/i,
    );
    expect(sql).toMatch(/TEST approval artifact digest no longer matches the owner intent/i);
    expect(sql).toMatch(/DEPLOYMENT approval artifact digest no longer matches the owner intent/i);
  });

  it("canonicalizes every digest timestamp in UTC independently of session TimeZone", () => {
    expect(sql).toMatch(
      /create or replace function public\.canonical_digest_timestamp\(input_value timestamptz\)[\s\S]*?immutable[\s\S]*?strict[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog[\s\S]*?pg_catalog\.timezone\('UTC', input_value\)[\s\S]*?'YYYY-MM-DD"T"HH24:MI:SS\.US"Z"'/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.canonical_digest_timestamp\(timestamptz\)\s+from public, anon, authenticated, service_role/i,
    );
    expect(sql.match(/public\.canonical_digest_timestamp\(/gi)?.length ?? 0)
      .toBeGreaterThanOrEqual(8);
  });

  it("cuts both worker claim lanes over to an exact protocol-v2 surface", () => {
    expect(sql).toMatch(
      /create or replace function public\.claim_planned_graph_v2\(\s*p_worker_id text,\s*p_supported_executors text\[\],\s*p_repository_full_name text,\s*p_required_check_names jsonb,\s*p_protocol_version integer\s*\)[\s\S]*?p_protocol_version is distinct from 2[\s\S]*?graph worker protocol version 2 is required/i,
    );
    expect(sql).toMatch(
      /create or replace function public\.claim_phase1c_run_v2\(\s*p_worker_id text,\s*p_provider text,\s*p_model text,\s*p_lease_seconds integer,\s*p_protocol_version integer\s*\)[\s\S]*?p_protocol_version is distinct from 2[\s\S]*?Phase 1C worker protocol version 2 is required/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.claim_planned_graph_internal\(text, text\[\], text, jsonb\)\s+from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.claim_phase1c_run\(text, text, text, integer\)\s+from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.claim_planned_graph_v2\(text, text\[\], text, jsonb, integer\)\s+to service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.claim_phase1c_run_v2\(\s*text, text, text, integer, integer\s*\) to service_role/i,
    );
  });

  it("versions queue diagnosis over the same repository, policy, and bridge scope", () => {
    expect(sql).toMatch(
      /create or replace function public\.diagnose_graph_queue_as_worker_v2\(\s*p_worker_id text,\s*p_repository_full_name text,\s*p_required_check_names jsonb,\s*p_target_graph_id uuid,\s*p_protocol_version integer\s*\)[\s\S]*?p_protocol_version is distinct from 2/i,
    );
    expect(sql).toMatch(/repository_scope_matches boolean[\s\S]*?required_check_policy_matches boolean[\s\S]*?phase1c_resume_ready boolean/i);
    for (const predicate of [
      "connection.status = 'connected'",
      "installation.suspended_at is null",
      "repository.selected",
      "not repository.archived",
      "not repository.disabled",
      "graph.required_check_names = p_required_check_names",
      "PULL_REQUEST_RECORDED",
    ]) {
      expect(sql.toLowerCase()).toContain(predicate.toLowerCase());
    }
    expect(sql).toMatch(
      /revoke all on function public\.diagnose_graph_queue_as_worker\(text\)\s+from public, anon, authenticated, service_role/i,
    );
    expect(sql).not.toMatch(/grant execute on function public\.diagnose_graph_queue_as_worker\(text\)/i);
    expect(sql).toMatch(
      /grant execute on function public\.diagnose_graph_queue_as_worker_v2\(\s*text, text, jsonb, uuid, integer\s*\) to service_role/i,
    );
  });

  it("keeps required-check policy and canonical TEST evidence on one safe name domain", () => {
    expect(sql).toMatch(
      /graph_required_check_policy_is_safe[\s\S]*?char_length\(check_name #>> '\{\}'\) not between 1 and 160[\s\S]*?strpos\(check_name #>> '\{\}', '\|'\) > 0/i,
    );
    expect(sql).toMatch(
      /char_length\(pg_catalog\.btrim\(check_item->>'name'\)\) not between 1 and 160[\s\S]*?strpos\(check_item->>'name', '\|'\) > 0/i,
    );
  });

  it("requires canonical exact-head successful CI at TEST intent and consumption", () => {
    expect(sql).toMatch(
      /create or replace function public\.assert_canonical_graph_test_anchor\(\s*p_payload jsonb,\s*p_expected_head_sha text,\s*p_expected_repository text,\s*p_expected_check_names jsonb,\s*p_node_started_at timestamptz,\s*p_artifact_created_at timestamptz,\s*p_gate_opened_at timestamptz\s*\)[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i,
    );
    for (const requiredField of [
      "observation", "sha", "repository", "total", "checks", "failing",
      "observedAt", "latencyMs",
    ]) {
      expect(sql).toContain(`'${requiredField}'`);
    }
    expect(sql).toMatch(/p_payload->>'observation' is distinct from 'ci_check_runs'/i);
    expect(sql).toMatch(/check_item->>'conclusion' is distinct from 'success'/i);
    expect(sql).toMatch(/jsonb_array_length\(p_payload->'failing'\) <> 0/i);
    expect(sql).toMatch(/total_value <> pg_catalog\.jsonb_array_length\(p_expected_check_names\)/i);
    expect(sql).toMatch(/TEST gate requires the exact persisted required-check policy/i);
    expect(sql).toMatch(/p_artifact_created_at > p_gate_opened_at/i);
    expect(sql).toMatch(/TEST gate requires canonical exact-head successful CI evidence/i);
    expect(sql.match(/perform public\.assert_canonical_graph_test_anchor\(/gi)).toHaveLength(2);
    expect(sql).toMatch(
      /revoke all on function public\.assert_canonical_graph_test_anchor\(\s*jsonb, text, text, jsonb, timestamptz, timestamptz, timestamptz\s*\) from public, anon, authenticated, service_role/i,
    );
  });

  it("bounds worker evidence and rejects secret-shaped transition reasons", () => {
    expect(sql).toMatch(
      /create or replace function public\.graph_verification_evidence_is_safe\(\s*input_value jsonb\s*\)[\s\S]*?jsonb_typeof\(input_value\) <> 'array'[\s\S]*?pg_column_size\(input_value\) > 32768[\s\S]*?jsonb_array_length\(input_value\) > 64[\s\S]*?jsonb_has_sensitive_keys\(input_value\)/i,
    );
    expect(sql).toMatch(
      /create or replace function public\.record_graph_verification_internal\([\s\S]*?graph_verification_evidence_is_safe\(normalized_evidence\)[\s\S]*?verification evidence is invalid, oversized, or sensitive/i,
    );
    expect(sql).toMatch(
      /create or replace function public\.record_node_state_as_worker\([\s\S]*?text_has_likely_secret\(p_detail\)[\s\S]*?node transition detail contains secret-shaped material/i,
    );
    expect(sql).toMatch(
      /create or replace function public\.decide_node_gate\([\s\S]*?text_has_likely_secret\(normalized_reason\)[\s\S]*?gate reason is invalid or sensitive/i,
    );
    expect(sql).toMatch(
      /create or replace function public\.approve_full_lifecycle_gate_internal\([\s\S]*?text_has_likely_secret\(normalized_reason\)[\s\S]*?gate reason is invalid or sensitive/i,
    );
  });

  it("binds verification evidence to an exact completed verifier node run", () => {
    expect(sql).toMatch(
      /alter table public\.graph_verifications\s+add column if not exists verifier_node_run_id uuid/i,
    );
    expect(sql).toMatch(
      /graph_verifications_verifier_node_run_fk[\s\S]*?foreign key \(verifier_node_run_id, organization_id, graph_run_id\)[\s\S]*?references public\.node_runs\(id, organization_id, graph_run_id\)/i,
    );
    expect(sql).toMatch(
      /graph_verifications_subject_run_fk[\s\S]*?foreign key \(subject_node_run_id, organization_id, graph_run_id\)[\s\S]*?references public\.node_runs\(id, organization_id, graph_run_id\)/i,
    );
    expect(sql).toMatch(
      /graph_verifications_verifier_subject_lens_unique[\s\S]*?verifier_node_run_id,[\s\S]*?subject_node_run_id,[\s\S]*?lens/i,
    );
    expect(sql).toMatch(
      /create or replace function public\.record_graph_verification_internal\(\s*p_worker_id text,\s*p_verifier_node_run_id uuid,\s*p_subject_node_run_id uuid,\s*p_lens public\.verification_lens,\s*p_verdict public\.verification_verdict,\s*p_evidence jsonb default '\[\]'::jsonb\s*\)/i,
    );
    expect(sql).toMatch(
      /node_run\.id in \(p_verifier_node_run_id, p_subject_node_run_id\)[\s\S]*?node_run\.graph_run_id = graph_run_record\.id[\s\S]*?node_run\.organization_id = graph_run_record\.organization_id/i,
    );
    expect(sql).toMatch(/verification subject must be completed/i);
    expect(sql).toMatch(/verification author must be completed/i);
    expect(sql).toMatch(/p_verifier_node_run_id = p_subject_node_run_id[\s\S]*?self_verification_forbidden/i);
    expect(sql).toMatch(
      /when 'review' then 'correctness'::public\.verification_lens[\s\S]*?when 'security_review' then 'security'::public\.verification_lens[\s\S]*?when 'qa' then 'acceptance_criteria'::public\.verification_lens/i,
    );
    expect(sql).toMatch(
      /verifier_agent_id,[\s\S]*?verifier_provider[\s\S]*?verifier_record\.id,[\s\S]*?verifier_agent_id,[\s\S]*?verifier_record\.provider/i,
    );
    expect(sql).toMatch(/verification replay does not match durable evidence/i);
    expect(sql).toMatch(
      /revoke all on function public\.record_verification_as_worker\(\s*text, uuid, public\.verification_lens, public\.verification_verdict,\s*jsonb, uuid, text, boolean\s*\) from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.record_graph_verification_internal\(\s*text, uuid, uuid, public\.verification_lens, public\.verification_verdict, jsonb\s*\) from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /create or replace function public\.complete_reviewer_with_verifications_as_worker\([\s\S]*?p_artifact_payload jsonb[\s\S]*?reviewer verification batch must exactly match completed incoming subjects[\s\S]*?reviewer completion replay does not match durable evidence[\s\S]*?verification_id := public\.record_graph_verification_internal\(/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.complete_reviewer_with_verifications_as_worker\(\s*text, uuid, jsonb, text, text, integer, jsonb\s*\) to service_role/i,
    );
    expect(sql).toMatch(
      /node_capability in \('review', 'security_review', 'qa'\)[\s\S]*?reviewer_completion_requires_atomic_verifications/i,
    );
    expect(sql).toMatch(
      /create or replace function public\.read_prior_node_results_as_worker_v2\([\s\S]*?provider text,[\s\S]*?model text[\s\S]*?p_protocol_version is distinct from 2/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.read_prior_node_results_as_worker\(text, uuid\)\s+from public, anon, authenticated, service_role/i,
    );
  });

  it("makes identity write-once, state monotonic, and transitions auditable", () => {
    for (const state of [
      "GRAPH_READY",
      "COMMAND_RECORDED",
      "PHASE1C_BOUND",
      "PULL_REQUEST_RECORDED",
      "MERGE_RECORDED",
      "DEPLOYMENT_RECORDED",
      "MONITORING_RECORDED",
      "VALIDATED",
    ]) {
      expect(sql).toContain(`'${state}'`);
    }
    expect(sql).toMatch(/graph Phase 1C bridge state must advance exactly one step/i);
    expect(sql).toMatch(/graph Phase 1C bridge evidence identity is write-once/i);
    expect(sql).toMatch(/insert into public\.activity_events/i);
  });

  it("exposes only narrow service-role RPCs with hardened search paths", () => {
    for (const routine of [
      "bind_graph_phase1c_run_by_command_as_worker",
      "diagnose_graph_queue_as_worker_v2",
      "complete_phase1c_run_with_graph_bridge_as_worker",
      "approve_graph_phase1c_test_gate_as_worker",
      "approve_graph_phase1c_deployment_gate_as_worker",
      "complete_graph_run_with_phase1c_bridge_as_worker",
      "abort_graph_run_as_worker",
    ]) {
      expect(sql).toMatch(new RegExp(
        `create or replace function public\\.${routine}\\s*\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = pg_catalog`,
        "i",
      ));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${routine}\\s*\\(`, "i"));
    }

    for (const routine of [
      "create_graph_phase1c_bridge_as_worker",
      "create_graph_phase1c_bridge_for_approved_gate",
      "attach_graph_phase1c_command_for_approved_gate",
      "bind_graph_phase1c_run_as_worker",
      "record_graph_phase1c_pull_request_as_worker",
      "record_graph_phase1c_merge_as_worker",
      "record_graph_phase1c_github_merge_as_worker",
      "record_graph_phase1c_deployment_as_worker",
      "record_graph_phase1c_github_deployment_as_worker",
      "record_graph_phase1c_monitor_as_worker",
      "record_graph_phase1c_validation_as_worker",
      "diagnose_graph_queue_as_worker",
      "approve_full_lifecycle_gate_internal",
    ]) {
      expect(sql).toMatch(new RegExp(
        `create or replace function public\\.${routine}\\s*\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = pg_catalog`,
        "i",
      ));
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${routine}\\s*\\(`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${routine}\\s*\\(`, "i"));
    }

    expect(sql).toMatch(
      /create or replace function public\.approve_graph_phase1c_architecture_gate\([\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.approve_graph_phase1c_architecture_gate\([\s\S]*?to authenticated/i,
    );
    expect(sql).toMatch(/organization owner access is required/i);
    expect(sql).toMatch(/opened_by_run_id[\s\S]*architecture answer artifact/i);
    expect(sql).toMatch(
      /create or replace function public\.attach_graph_phase1c_command_for_approved_gate\([\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.attach_graph_phase1c_command_for_approved_gate\(uuid, uuid, uuid\)[\s\S]*?from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(/never infer a bridge from a[\s\S]*project, prompt, or graph id/i);
    expect(sql).toMatch(
      /create or replace function public\.submit_and_attach_graph_phase1c_command\([\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.submit_and_attach_graph_phase1c_command\(uuid, jsonb\)[\s\S]*?to authenticated/i,
    );
    expect(sql).toMatch(/approved architecture intent digest does not match stored evidence/i);
    expect(sql).toMatch(
      /create or replace function public\.request_graph_release_gate_approval\([\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.request_graph_release_gate_approval\(uuid, uuid, uuid, text\)[\s\S]*?to authenticated/i,
    );
    expect(sql).toMatch(/exact pending owner TEST approval intent is required/i);
    expect(sql).toMatch(/exact pending owner DEPLOYMENT approval intent is required/i);
    expect(sql).toMatch(
      /create or replace function public\.approve_graph_phase1c_test_gate_as_worker\(\s*p_intent_id uuid,\s*p_consume_nonce uuid,\s*p_external_number integer,\s*p_head_sha text,\s*p_head_branch text,\s*p_base_branch text,\s*p_merge_commit_sha text,\s*p_merged_at timestamptz\s*\)/i,
    );
    expect(sql).toMatch(
      /create or replace function public\.approve_graph_phase1c_deployment_gate_as_worker\(\s*p_intent_id uuid,\s*p_consume_nonce uuid,\s*p_github_repository_id uuid,\s*p_external_deployment_id bigint,\s*p_environment text,\s*p_commit_sha text,\s*p_status text,\s*p_url text,\s*p_started_at timestamptz,\s*p_completed_at timestamptz\s*\)/i,
    );
    expect(sql).toMatch(
      /create or replace function public\.create_graph_from_plan_with_release_identity_as_server\([\s\S]*?p_requested_by uuid[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i,
    );
    expect(sql).toMatch(
      /p_required_check_names jsonb[\s\S]*?graph_required_check_policy_is_safe\(required_check_names_value\)[\s\S]*?exact repository-owned required-check policy is required/i,
    );
    expect(sql).toMatch(/exact built-in full_lifecycle v2 launch identity is required/i);
    expect(sql).toMatch(
      /grant execute on function public\.create_graph_from_plan_with_release_identity_as_server\([\s\S]*?to service_role/i,
    );
    expect(sql).toMatch(/release-identity graph launch RPC ACL is not server-only/i);
    expect(sql).toMatch(/persisted graph launch identity does not match the requested bridge/i);
    expect(sql).toMatch(/full lifecycle release gates require evidence-bound approval/i);
    expect(sql).toMatch(
      /revoke all on function public\.complete_phase1c_run\([\s\S]*?from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.complete_graph_run_as_worker\([\s\S]*?from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /alter function public\.complete_graph_run_as_worker\(\s*text, uuid, public\.graph_run_state, boolean, bigint, bigint, text, text\s*\) set search_path = pg_catalog/i,
    );
    expect(sql).toMatch(
      /create or replace function public\.complete_graph_run_with_phase1c_bridge_as_worker\([\s\S]*?p_budget_action text default null,\s*p_closure_note text default null[\s\S]*?run_record\.closure_note is distinct from normalized_closure_note[\s\S]*?complete_graph_run_as_worker\([\s\S]*?normalized_closure_note/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.complete_graph_run_with_phase1c_bridge_as_worker\(\s*text, uuid, public\.graph_run_state, boolean, bigint, bigint, text, text\s*\) to service_role/i,
    );
  });

  it("holds only exact full_lifecycle claims and projects bounded Phase 1C evidence", () => {
    expect(sql).toMatch(
      /pg_catalog\.lower\(repository\.full_name\)\s*=\s*pg_catalog\.lower\(p_repository_full_name\)/i,
    );
    expect(sql).toMatch(/g\.required_check_names = p_required_check_names/i);
    expect(sql).toMatch(/repository\.full_name as project_repository/i);
    expect(sql).toMatch(/repository\.default_branch as project_default_branch/i);
    expect(sql).toMatch(/'project_repository',\s*v_graph\.project_repository/i);
    expect(sql).toMatch(/'project_default_branch',\s*v_graph\.project_default_branch/i);
    expect(sql).toMatch(/for update of g, project, link, connection, installation, repository skip locked/i);
    expect(sql).toMatch(/connection\.status = 'connected'/i);
    expect(sql).toMatch(/installation\.status = 'active'[\s\S]*?installation\.suspended_at is null[\s\S]*?installation\.deleted_at is null/i);
    expect(sql).toMatch(/repository\.selected[\s\S]*?not repository\.archived[\s\S]*?not repository\.disabled/i);
    expect(sql).not.toMatch(/'project_repository',\s*\(\s*select p\.github_repository/i);
    expect(sql).toMatch(/g\.template_key is distinct from 'full_lifecycle'/i);
    expect(sql).toMatch(/architecture_gate\.stage = 'ARCHITECTURE'/i);
    expect(sql).toMatch(/graph_phase1c_bridge_state_rank\(bridge\.state\)[\s\S]*PULL_REQUEST_RECORDED/i);
    for (const key of [
      "template_key",
      "template_version",
      "base_branch",
      "base_sha",
      "required_check_names",
      "required_checks_sha256",
      "phase1c_state",
      "phase1c_head_sha",
      "pull_request_number",
      "pull_request_url",
      "validation_evidence",
      "merge_commit_sha",
      "deployment_id",
      "deployment_url",
    ]) {
      expect(sql).toContain(`'${key}'`);
    }
    expect(sql).toMatch(/limit 50/i);
    expect(sql).toMatch(
      /insert into public\.graph_runs \([\s\S]*phase1c_bridge_id[\s\S]*v_bridge\.id/i,
    );
    expect(sql).toMatch(
      /complete_graph_run_with_phase1c_bridge_as_worker\([\s\S]*bridge\.id = run_record\.phase1c_bridge_id[\s\S]*bridge\.project_id = graph_record\.project_id/i,
    );
  });

  it("atomically contains unusable claim projections with exact abort replay", () => {
    expect(sql).toMatch(
      /create or replace function public\.abort_graph_run_as_worker\([\s\S]*?p_state public\.graph_run_state,[\s\S]*?p_detail text default null[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i,
    );
    expect(sql).toMatch(
      /from public\.graph_runs run[\s\S]*?for update;[\s\S]*?from public\.node_runs node_run[\s\S]*?order by node_run\.id[\s\S]*?for update;/i,
    );
    expect(sql).toMatch(/graph abort requires an unstarted all-PENDING child set/i);
    expect(sql).toMatch(
      /with cancelled as \([\s\S]*?set state = 'CANCELLED'[\s\S]*?insert into public\.graph_events[\s\S]*?'node_cancelled'[\s\S]*?'run_abort_requested'[\s\S]*?complete_graph_run_with_phase1c_bridge_as_worker/i,
    );
    expect(sql).toMatch(/graph abort replay does not match durable evidence/i);
    expect(sql).toMatch(
      /run_record\.closure_note is distinct from normalized_detail[\s\S]*?complete_graph_run_with_phase1c_bridge_as_worker\([\s\S]*?normalized_detail/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.abort_graph_run_as_worker\(\s*text, uuid, public\.graph_run_state, text\s*\) from public, anon, authenticated, service_role;[\s\S]*?grant execute on function public\.abort_graph_run_as_worker\([\s\S]*?to service_role/i,
    );
  });

  it("does not enable autonomy, workers, merge, or external deployment", () => {
    expect(sql).not.toMatch(/update\s+public\.projects[\s\S]*autonomous_mode/i);
    expect(sql).not.toMatch(/update\s+public\.phase1c_workers/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.pull_requests/i);
    expect(sql).toMatch(
      /record_graph_phase1c_github_deployment_as_worker\([\s\S]*?insert into public\.deployments[\s\S]*?'github'[\s\S]*?'succeeded'/i,
    );
    expect(sql).toMatch(/never creates an external deployment/i);
    expect(sql).toMatch(/enabled, expected_status_code[\s\S]*?'connected'[\s\S]*?false/i);
  });
});
