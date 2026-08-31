// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const preflight = readFileSync(resolve(root, ".github/grok-release/grok-causal-acceptance-preflight.sql"), "utf8");
const start = readFileSync(resolve(root, ".github/grok-release/grok-causal-acceptance-start.sql"), "utf8");
const finish = readFileSync(resolve(root, ".github/grok-release/grok-causal-acceptance-finish.sql"), "utf8");
const persistentMutation = /^\s*(?:insert|update|delete|truncate|alter|create|drop|grant|revoke|notify)\b/im;

describe("Grok causal production acceptance SQL contract", () => {
  it("keeps every database verifier read-only", () => {
    expect(preflight).not.toMatch(persistentMutation);
    expect(start).not.toMatch(persistentMutation);
    expect(finish).not.toMatch(persistentMutation);
  });

  it("fails closed on exact ledger, catalog, project, owner, and safety identity", () => {
    for (const proof of [
      "20260831002000", "20260831002100",
      "resolve_graph_execution_target_as_worker(uuid,integer)",
      "claim_planned_graph_by_target_v4(text,text[],jsonb,integer)",
      "prosecdef", "search_path=pg_catalog", "has_function_privilege",
      "service_role", "authenticated", "anon", "aclexplode",
      "member.role = 'owner'", "project_connections", "github_installations",
      "autonomy_kill_switch_active is distinct from true",
      "auto_plan", "auto_code", "auto_test", "auto_repair", "auto_review",
      "auto_approve", "auto_merge", "auto_deploy", "auto_rollback",
    ]) expect(preflight).toContain(proof);
  });

  it("proves a new immutable plan, roster, context, exact wake receipt, Claude nodes, and Phase 1C PR", () => {
    for (const proof of [
      "grok_messages", "planner,version", "grok_context_envelopes", "item_count = 3",
      "grok_specialist_admissions", "grok_specialist_admission_hash",
      "grok_execution_admissions", "grok_current_execution_admission_hash",
      "grok_graph_wake_intents", "grok_graph_wake_dispatch_attempts",
      "grok_graph_wake_receipts", "protocol_version = 1", "capability_version = 1",
      "provider = 'anthropic'", "provider = 'openai'", "model = 'gpt-5.3-codex'",
      "attempt_number = 1",
      "phase1c_run_validations", "PULL_REQUEST_RECORDED", "status = 'draft'",
      "Lint, typecheck, test, and build", "Browser and accessibility tests 3/3",
    ]) expect(start).toContain(proof);
  });

  it("proves the exact run chain, merge, READY deployment lineage, terminal artifacts, and validation", () => {
    for (const proof of [
      "start_release_sha", "initial_graph_run_id", "draft_graph_run_id",
      "start_graph_run_ids", "start_claude_node_run_ids",
      "wake_receipt_id", "bridge_id", "agent_run_id",
      "pull.status = 'merged'", "pull.merge_commit_sha", "deployment.external_reference",
      "deployment.status = 'succeeded'", "monitor_observations", "signal_outcome",
      "graph-production-validator-v3", "post-deploy-v1", "deployment_validation_state",
      "production_http_probe", "observationWindowComplete", "terminalGraphRunId",
      "terminalArtifactId", "run.state = 'COMPLETED'",
      "nodes.completed_with_artifact_count = graph_nodes.total",
    ]) expect(finish).toContain(proof);
  });

  it("never accepts automatic action or a disabled kill switch", () => {
    for (const sql of [preflight, finish]) {
      expect(sql).toContain("autonomy_kill_switch_active is distinct from true");
      expect(sql).not.toMatch(/autonomy_kill_switch_active\s*=\s*false/i);
      expect(sql).not.toMatch(/(?:auto_merge|auto_deploy|auto_approve)\s*=\s*true/i);
    }
  });
});
