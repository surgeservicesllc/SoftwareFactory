// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260827000210_contain_legacy_graph_artifact_payloads.sql",
);
const sql = readFileSync(migrationPath, "utf8");

describe("legacy graph artifact payload containment migration contract", () => {
  it("accepts only the hosted pre-lineage or clean-replay ledger identities", () => {
    expect(sql).toMatch(/where version = '20260827000150'/i);
    expect(sql).toMatch(/where version = '20260827000200'/i);
    expect(sql).toMatch(/where version = '20260827000210'/i);
    expect(sql).toMatch(/ledger_state not in \('1\|0\|0', '1\|1\|0'\)/i);
    expect(sql).toContain("graph artifact containment ledger identity is not exact");
  });

  it("requires the exact legacy ACL fence in every ledger and no-ledger catalog state", () => {
    expect(sql).toMatch(
      /v2_present := pg_catalog\.to_regprocedure\([\s\S]*?claim_planned_graph_v2\(text,text\[\],text,jsonb,integer\)[\s\S]*?\) is not null/i,
    );
    expect(sql).toMatch(
      /with expected\(signature, owner_gate\) as \(values[\s\S]*?decide_node_gate\(uuid,boolean,text\)', true[\s\S]*?select pg_catalog\.count\(routine\) = 9/i,
    );
    expect(sql).toMatch(
      /not pg_catalog\.has_function_privilege\('anon', routine, 'EXECUTE'\)[\s\S]*?not pg_catalog\.has_function_privilege\('service_role', routine, 'EXECUTE'\)[\s\S]*?when v2_present and owner_gate then\s+pg_catalog\.has_function_privilege\('authenticated', routine, 'EXECUTE'\)[\s\S]*?else\s+not pg_catalog\.has_function_privilege\('authenticated', routine, 'EXECUTE'\)/i,
    );
    expect(sql).toMatch(
      /if not legacy_fence_exact then[\s\S]*?legacy graph protocol authority fence is not committed/i,
    );
    expect(sql).not.toMatch(/ledger_state\s*=\s*'1\|0\|0'\s+and\s*\([\s\S]*?not legacy_fence_exact/i);
    expect(sql).not.toMatch(/ledger_state is null[\s\S]*?and not legacy_fence_exact/i);
    for (const ownerGateMarker of [
      "routine.prosecdef",
      "search_path=pg_catalog",
      "full lifecycle release gates require evidence-bound approval",
      "owner or admin role is required to decide a gate",
      "automatic gate approval is worker-only and evidence-bound",
    ]) {
      expect(sql).toContain(ownerGateMarker);
    }
  });

  it("locks the artifact surface and fails closed unless execution is fully stopped", () => {
    expect(sql).toMatch(
      /lock table public\.graph_artifacts, public\.graph_verifications\s+in access exclusive mode/i,
    );
    for (const predicate of [
      "organization.autonomous_mode",
      "not organization.autonomy_kill_switch_active",
      "organization.auto_rollback",
      "project.autonomous_mode",
      "project.auto_rollback",
      "worker.status in ('active', 'draining')",
      "state = 'RUNNING'::public.graph_run_state",
      "status = 'running'::public.run_status",
    ]) {
      expect(sql).toContain(predicate);
    }
    expect(sql).toContain("graph artifact containment requires the fully stopped safety state");
    expect(sql).not.toMatch(
      /last_heartbeat_at\s*<=\s*pg_catalog\.now\(\)\s*\+\s*interval/i,
    );
    expect(
      sql.match(
        /worker\.status in \('active', 'draining'\)[\s\S]{0,180}?worker\.last_heartbeat_at > pg_catalog\.now\(\) - interval '5 minutes'/gi,
      )?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
  });

  it("refuses contradictory identities, duplicate product slots, and unsafe verification evidence", () => {
    expect(sql).toContain("legacy graph artifact has contradictory node/run identity");
    expect(sql).toMatch(
      /group by artifact\.node_run_id, artifact\.kind\s+having pg_catalog\.count\(\*\) > 1/i,
    );
    expect(sql).toContain("legacy graph artifact product slot is ambiguous");
    expect(sql).toContain("legacy graph verification has contradictory subject/run identity");
    for (const boundary of [
      "pg_catalog.pg_column_size(verification.evidence) > 32768",
      "pg_catalog.jsonb_array_length(verification.evidence) > 64",
      "public.jsonb_has_sensitive_keys(verification.evidence)",
      "pg_catalog.char_length(item.value #>> '{}') > 1000",
    ]) {
      expect(sql).toContain(boundary);
    }
    expect(sql).toContain("legacy graph verification evidence is unsafe");
  });

  it("records only a one-way digest and bounded classification before writing an exact tombstone", () => {
    const tableDefinition = sql.match(
      /create table public\.graph_artifact_payload_containments \(([\s\S]*?)\n\);/i,
    )?.[1] ?? "";
    expect(tableDefinition).toContain("original_payload_sha256 text not null");
    expect(tableDefinition).toContain("original_payload_octets bigint not null");
    expect(tableDefinition).toContain("sensitive_data_detected boolean not null");
    expect(tableDefinition).toContain("size_limit_exceeded boolean not null");
    expect(tableDefinition).not.toMatch(/\bpayload\s+jsonb\b/i);
    expect(tableDefinition).not.toMatch(/\breferences\b/i);

    expect(sql).toMatch(
      /pg_catalog\.encode\(\s*pg_catalog\.sha256\(pg_catalog\.convert_to\(artifact\.payload::text, 'UTF8'\)\),\s*'hex'\s*\)/i,
    );
    expect(sql).toMatch(
      /where public\.jsonb_has_sensitive_keys\(artifact\.payload\)\s+or pg_catalog\.octet_length\(artifact\.payload::text\) > 1048576/i,
    );
    expect(sql).toMatch(
      /set payload = pg_catalog\.jsonb_build_object\(\s*'contained', true,\s*'containmentEvidenceId', containment\.id,\s*'reason', 'legacy_artifact_policy_violation'\s*\)/i,
    );
  });

  it("keeps containment evidence private and immutable without granting a service bypass", () => {
    expect(sql).toMatch(
      /alter table public\.graph_artifact_payload_containments enable row level security/i,
    );
    expect(sql).toMatch(
      /alter table public\.graph_artifact_payload_containments force row level security/i,
    );
    expect(sql).toMatch(
      /revoke all on table public\.graph_artifact_payload_containments\s+from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /create or replace function public\.enforce_graph_artifact_payload_containment_immutable\(\)[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.enforce_graph_artifact_payload_containment_immutable\(\)\s+from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /before update or delete or truncate on public\.graph_artifact_payload_containments\s+for each statement/i,
    );
    expect(sql).not.toMatch(/grant\s+[^;]*graph_artifact_payload_containments/i);
  });

  it("closes and validates both payload guards before declaring convergence", () => {
    expect(sql).toMatch(
      /add constraint graph_artifacts_payload_size_bounded\s+check \(pg_catalog\.octet_length\(payload::text\) <= 1048576\) not valid/i,
    );
    expect(sql).toMatch(
      /validate constraint graph_artifacts_payload_no_sensitive_data/i,
    );
    expect(sql).toMatch(
      /validate constraint graph_artifacts_payload_size_bounded/i,
    );
    expect(sql).toContain("legacy graph artifact payload containment did not converge");
    expect(sql).toContain("contained graph artifact does not reference exact audit evidence");
    expect(sql).toContain("graph artifact update immutability is not installed");
  });

  it("verifies every private-audit and mutation ACL invariant inside the migration transaction", () => {
    const postflight = sql.match(
      /do \$graph_artifact_payload_containment_postflight\$([\s\S]*?)\$graph_artifact_payload_containment_postflight\$;/i,
    )?.[1] ?? "";
    expect(postflight).toContain("graph_artifact_payload_containments");
    expect(postflight).toContain("relrowsecurity");
    expect(postflight).toContain("relforcerowsecurity");
    expect(postflight).toContain("graph_artifact_payload_containments_immutable");
    expect(postflight).toContain("enforce_graph_artifact_payload_containment_immutable");
    expect(postflight).toContain("graph_artifacts_update_immutable");
    expect(postflight).toContain("public.graph_artifacts");
    expect(postflight).toContain("public.graph_verifications");
    expect(postflight).toMatch(/has_table_privilege/i);
    expect(postflight).toMatch(/has_function_privilege/i);
    expect(postflight).toContain("pg_catalog.aclexplode");
    expect(postflight).not.toContain("pg_catalog.coalesce(");
    expect(postflight).toMatch(/privilege\.grantee\s*<>\s*(?:relation|routine)\.\w*owner/i);
    expect(postflight).toMatch(
      /trigger_catalog\.tgfoid\s*=\s*pg_catalog\.to_regprocedure\(\s*'public\.enforce_graph_artifact_payload_containment_immutable\(\)'/i,
    );
    expect(postflight).toMatch(
      /pg_catalog\.pg_get_userbyid\(routine\.proowner\)\s*=\s*'postgres'/i,
    );
    expect(postflight).toMatch(/routine\.prosecdef/i);
    expect(postflight).toMatch(
      /routine\.proconfig\s*=\s*array\['search_path=pg_catalog'\]::text\[\]/i,
    );
    expect(postflight).toContain(
      "graph artifact payload containment evidence is immutable",
    );
    expect(postflight).toMatch(/routine\.proacl is not null/i);
    expect(postflight).toMatch(
      /pg_catalog\.count\(\*\)[\s\S]*?pg_catalog\.aclexplode\(routine\.proacl\)[\s\S]*?= 1/i,
    );
    expect(postflight).toMatch(
      /privilege\.grantor\s*=\s*routine\.proowner[\s\S]*?privilege\.grantee\s*=\s*routine\.proowner[\s\S]*?privilege\.privilege_type\s*=\s*'EXECUTE'[\s\S]*?not privilege\.is_grantable/i,
    );
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(postflight).toContain(`'${role}'`);
    }
    for (const privilege of [
      "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER",
    ]) {
      expect(postflight.toUpperCase()).toContain(privilege);
    }
  });
});
