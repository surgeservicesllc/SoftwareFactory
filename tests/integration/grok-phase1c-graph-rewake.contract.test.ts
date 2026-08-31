// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const sql = readFileSync(resolve(
  root,
  "supabase/migrations/20260831001600_grok_phase1c_graph_rewake.sql",
), "utf8");
const workflow = readFileSync(resolve(root, ".github/workflows/codex-worker.yml"), "utf8");

describe("Grok Phase 1C exact graph re-wake contract", () => {
  it("creates one durable intent in the exact PR-recorded bridge transaction", () => {
    expect(sql).toMatch(
      /create table public\.grok_graph_rewake_intents[\s\S]*?grok_graph_rewake_intents_bridge_unique unique \(bridge_id\)[\s\S]*?grok_graph_rewake_intents_command_unique unique \(command_id\)[\s\S]*?grok_graph_rewake_intents_run_unique unique \(phase1c_run_id\)/i,
    );
    expect(sql).toMatch(
      /create trigger graph_phase1c_bridge_enqueue_grok_rewake[\s\S]*?after update of state on public\.graph_phase1c_bridges/i,
    );
    expect(sql).toMatch(
      /old\.state = new\.state[\s\S]*?new\.state <> 'PULL_REQUEST_RECORDED'[\s\S]*?old\.state <> 'PHASE1C_BOUND'/i,
    );
    expect(sql).toContain("public.assert_current_grok_execution_admissions(new.graph_id)");
    expect(sql).toContain("on conflict on constraint grok_graph_rewake_intents_bridge_unique do nothing");
    expect(sql).toContain("grok graph re-wake replay conflicts with exact identity");
  });

  it("revalidates graph, bridge, run, pull request, admission, and repository identity", () => {
    const validator = sql.slice(
      sql.indexOf("create function public.assert_current_grok_graph_rewake_intent"),
      sql.indexOf("create function public.enqueue_grok_graph_rewake_after_phase1c"),
    );
    for (const relation of [
      "graphs", "grok_graph_launches", "grok_sessions", "graph_phase1c_bridges",
      "agent_runs", "pull_requests", "projects", "project_connections",
      "connections", "github_installations", "github_repositories",
    ]) {
      expect(validator).toContain(`public.${relation}`);
    }
    expect(validator).toContain("public.assert_current_grok_execution_admissions(v_graph.id)");
    expect(validator).toContain("v_graph.withdrawn_at is not null");
    expect(validator).toContain("v_graph.pause_requested_at is not null");
    expect(validator).toContain("v_run.status is distinct from 'succeeded'::public.run_status");
    expect(validator).toContain("v_run.github_repository_id is distinct from p_intent.github_repository_id");
    expect(validator).toContain("v_pull_request.head_sha is distinct from p_intent.head_sha");
    expect(validator).toContain("v_target.repository_id is distinct from p_intent.github_repository_id");
  });

  it("leases only to a fresh non-disabled worker and makes delivery replay exact", () => {
    const claim = sql.slice(
      sql.indexOf("create function public.claim_grok_graph_rewake_as_worker"),
      sql.indexOf("create function public.record_grok_graph_rewake_delivery_as_worker"),
    );
    expect(claim).toContain("v_worker.status not in ('active', 'idle')");
    expect(claim).toContain("v_worker.current_run_id is not null");
    expect(claim).toContain("interval '5 minutes'");
    expect(claim).toContain("interval '10 minutes'");
    expect(claim).toContain("v_intent.lease_expires_at > pg_catalog.now()");
    expect(claim).toContain("v_intent.delivery_attempts >= 8");

    const delivery = sql.slice(sql.indexOf(
      "create function public.record_grok_graph_rewake_delivery_as_worker",
    ));
    expect(delivery).toContain("if v_intent.state = 'delivered'");
    expect(delivery).toContain("if p_accepted then return true");
    expect(delivery).toContain("v_intent.lease_worker_id is distinct from p_worker_id");
    expect(delivery).toContain("v_intent.lease_token is distinct from p_lease_token");
    expect(delivery).toContain("delivery_attempts = delivery_attempts + 1");
  });

  it("keeps durable evidence forced-RLS, append-only, and worker functions least privilege", () => {
    for (const table of ["grok_graph_rewake_intents", "grok_graph_rewake_attempts"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
      expect(sql).toMatch(new RegExp(
        `revoke all on table public\\.${table}[\\s\\S]{0,100}service_role`, "i",
      ));
    }
    expect(sql).toContain("grok_graph_rewake_attempts are append-only");
    expect(sql).toContain("grok graph re-wake identity is immutable");
    expect(sql).toMatch(
      /grant execute on function public\.claim_grok_graph_rewake_as_worker\([\s\S]*?to service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.record_grok_graph_rewake_delivery_as_worker\([\s\S]*?to service_role/i,
    );
  });

  it("runs the exact-target re-wake immediately after Phase 1C without adding authority", () => {
    const executeIndex = workflow.indexOf("- name: Claim and execute one durable run");
    const rewakeIndex = workflow.indexOf(
      "- name: Re-wake the exact canonical graph after admitted completion",
    );
    expect(rewakeIndex).toBeGreaterThan(executeIndex);
    const rewake = workflow.slice(rewakeIndex);
    expect(rewake).toContain("always()");
    expect(rewake).toContain("vars.SOFTWAREFACTORY_GRAPH_WORKER_ENABLED == 'true'");
    expect(rewake).toContain("SOFTWAREFACTORY_TARGET_COMMAND_ID");
    expect(rewake).toContain("npm run worker:rewake");
    expect(rewake).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(rewake).toContain("GITHUB_APP_PRIVATE_KEY_BASE64");
    expect(rewake).not.toContain("SOFTWAREFACTORY_CODEX_AUTH_JSON");
    expect(rewake).not.toContain("OPENAI_API_KEY");
  });

  it("does not enable workers, autonomy, automatic actions, or weaken the kill switch", () => {
    expect(sql).not.toMatch(/update\s+public\.runtime_control/i);
    expect(sql).not.toMatch(/worker_enabled\s*=\s*true/i);
    expect(sql).not.toMatch(/autonom(?:y|ous_mode)\s*=\s*true/i);
    expect(sql).not.toMatch(/automatic_actions?\s*=\s*true/i);
    expect(sql).not.toMatch(/kill_switch(?:_enabled)?\s*=\s*false/i);
  });
});
