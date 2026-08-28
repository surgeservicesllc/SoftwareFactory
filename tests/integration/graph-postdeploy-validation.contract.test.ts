import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260828000300_graph_postdeploy_validation.sql",
);
const sql = readFileSync(migrationPath, "utf8");

describe("graph post-deploy validation migration contract", () => {
  it("replaces only the exact prior lifecycle digest and preserves launch guards", () => {
    expect(sql).toContain("ac9bde8fc1cdd21e735f02b1fa7d940ab680c2bde8c1ec24d704d42c59045a09");
    expect(sql).toContain("0ec1e97b80dc8696872d88162c5271f9ea822e7dea79556c5470730a025d3b49");
    expect(sql).toMatch(/old_digest_count <> 1/i);
    expect(sql).toContain("d6e614af6d985a9b6a9adaddc1c1d3ba");
    expect(sql).toContain("878b6df53f450d723a4ef7da9dd677b2");
    expect(sql).toMatch(/pg_catalog\.pg_get_userbyid\(routine\.proowner\) as owner_name/i);
    expect(sql).toMatch(/function_record\.owner_name <> 'postgres'/i);
    expect(sql).toMatch(/launch_record\.owner_name <> 'postgres'/i);
    expect(sql).toMatch(/launch_record\.source_md5 <> '878b6df53f450d723a4ef7da9dd677b2'/i);
    expect(sql).toMatch(/pg_catalog\.replace\(\s*function_record\.definition, old_digest, new_digest/i);
    for (const guard of [
      "exact built-in full_lifecycle v2 launch identity is required",
      "graph does not match the built-in full_lifecycle v2 structural contract",
      "graph edges do not match the built-in full_lifecycle v2 structural contract",
      "valid_anchor_nodes <> 6",
      "connected selected GitHub default-branch identity is required",
    ]) {
      expect(sql).toContain(guard);
    }
    expect(sql).toMatch(
      /revoke all on function public\.create_graph_from_plan_with_release_identity_as_server\([\s\S]*?from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.create_graph_from_plan_with_release_identity_as_server\([\s\S]*?to service_role/i,
    );
  });

  it("exposes one service-role-only hardened completion boundary", () => {
    expect(sql).toMatch(
      /create or replace function public\.complete_graph_run_with_validated_release_as_worker\([\s\S]*?language plpgsql[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.complete_graph_run_with_validated_release_as_worker\([\s\S]*?from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.complete_graph_run_with_validated_release_as_worker\([\s\S]*?to service_role/i,
    );
    expect(sql).toMatch(/has_function_privilege\(\s*'service_role'/i);
    expect(sql).toMatch(/has_function_privilege\(\s*'authenticated'/i);
    expect(sql).toMatch(/has_function_privilege\(\s*'anon'/i);
    expect(sql).toMatch(/function_record\.owner_name <> 'postgres'/i);
  });

  it("locks and verifies the exact v2 run, child set, bridge, and release", () => {
    expect(sql).toMatch(/from public\.graph_runs run[\s\S]*?for update/i);
    expect(sql).toMatch(
      /graph_record\.template_key is distinct from 'full_lifecycle'[\s\S]*?graph_record\.template_version is distinct from 2/i,
    );
    expect(sql).toMatch(
      /graph_record\.template_version is distinct from 2[\s\S]*?graph_record\.template_plan_sha256 is distinct from[\s\S]*?0ec1e97b80dc8696872d88162c5271f9ea822e7dea79556c5470730a025d3b49/i,
    );
    expect(sql).toMatch(
      /return public\.complete_graph_run_with_phase1c_bridge_as_worker\([\s\S]*?p_worker_id, p_graph_run_id/i,
    );
    expect(sql).toMatch(
      /from public\.node_runs node_run[\s\S]*?order by node_run\.id[\s\S]*?for update/i,
    );
    expect(sql).toMatch(/node_run_count <> graph_node_count/i);
    expect(sql).toMatch(/node_run\.state <> 'COMPLETED'::public\.graph_node_state/i);
    expect(sql).toMatch(/bridge_record\.state <> 'DEPLOYMENT_RECORDED'/i);
    expect(sql).toMatch(
      /deployment_record\.status <> 'succeeded'::public\.deployment_status[\s\S]*?deployment_record\.commit_sha[\s\S]*?bridge_record\.merge_commit_sha/i,
    );
    expect(sql).toMatch(
      /from public\.deployments deployment[\s\S]*?deployment\.id = bridge_record\.deployment_id[\s\S]*?for share/i,
    );
    expect(sql).toMatch(
      /from public\.projects project[\s\S]*?project\.id = bridge_record\.project_id[\s\S]*?for share/i,
    );
    expect(sql).toMatch(/public_url = deployment_url/i);
  });

  it("requires one bounded five-stage passing monitor artifact", () => {
    expect(sql).toMatch(/monitor_node_count <> 1 or monitor_artifact_count <> 1/i);
    expect(sql).toMatch(/pg_catalog\.octet_length\(artifact_record\.payload::text\) > 32768/i);
    expect(sql).toMatch(/public\.jsonb_has_sensitive_keys\(artifact_record\.payload\)/i);
    expect(sql).toMatch(/postDeployValidation' is distinct from 'passed'/i);
    expect(sql).toMatch(/observationWindowComplete' is distinct from 'true'::jsonb/i);
    expect(sql).toMatch(/jsonb_array_length\(artifact_record\.payload -> 'checks'\) <> 5/i);
    for (const stage of [
      "identity",
      "availability",
      "data_integration",
      "quality_security",
      "observation",
    ]) {
      expect(sql).toContain(`'${stage}'`);
    }
    expect(sql).toMatch(/required_stage_count <> 5 or invalid_check_count <> 0/i);
    expect(sql).toMatch(/validation_started_at < deployment_record\.completed_at/i);
    expect(sql).toMatch(/validation_completed_at < observed_at/i);
  });

  it("writes evidence and closes atomically without enabling automation", () => {
    const closeAt = sql.indexOf("run_record := public.complete_graph_run_as_worker");
    const observationAt = sql.indexOf("insert into public.monitor_observations");
    const validationAt = sql.indexOf("insert into public.deployment_validations");
    const monitorBridgeAt = sql.indexOf("record_graph_phase1c_monitor_as_worker");
    const validationBridgeAt = sql.indexOf("record_graph_phase1c_validation_as_worker");
    expect(closeAt).toBeGreaterThan(0);
    expect(observationAt).toBeGreaterThan(closeAt);
    expect(validationAt).toBeGreaterThan(observationAt);
    expect(monitorBridgeAt).toBeGreaterThan(observationAt);
    expect(validationBridgeAt).toBeGreaterThan(validationAt);
    expect(sql).toMatch(
      /insert into public\.production_monitors[\s\S]*?'connected'::public\.monitor_connection_state,\s*false/i,
    );
    expect(sql).not.toMatch(/set\s+(autonomous_mode|enabled)\s*=\s*true/i);
  });

  it("makes lost-response replay prove complete validation lineage", () => {
    expect(sql).toMatch(/terminal graph run does not match exact validated completion replay/i);
    expect(sql).toMatch(/bridge_record\.state <> 'VALIDATED'/i);
    expect(sql).toMatch(/join public\.monitor_observations observation/i);
    expect(sql).toMatch(/join public\.production_monitors monitor/i);
    expect(sql).toMatch(/observation\.correlation_id = validation\.correlation_id/i);
    expect(sql).toMatch(/validation\.baseline_reference = 'release:' \|\| bridge_record\.merge_commit_sha/i);
    expect(sql).toMatch(/terminal lifecycle replay has no exact passing validation lineage/i);
  });
});
