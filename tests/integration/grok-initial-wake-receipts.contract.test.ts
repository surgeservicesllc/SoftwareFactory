// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const sql = readFileSync(resolve(
  root,
  "supabase/migrations/20260831002100_grok_initial_wake_receipts.sql",
), "utf8");
const route = readFileSync(resolve(
  root,
  "app/api/grok/sessions/[sessionId]/control/route.ts",
), "utf8");
const worker = readFileSync(resolve(root, "scripts/graph-worker.mts"), "utf8");
const workflow = readFileSync(resolve(root, ".github/workflows/graph-worker.yml"), "utf8");

describe("Grok initial Resume wake receipt contract", () => {
  it("records one immutable tenant/session/graph/revision wake intent in the Resume transaction", () => {
    expect(sql).toMatch(/create table public\.grok_graph_wake_intents[\s\S]*?organization_id uuid not null[\s\S]*?session_id uuid not null[\s\S]*?graph_id uuid not null[\s\S]*?control_revision bigint not null/i);
    expect(sql).toContain("grok_graph_wake_intents_control_unique unique (control_intent_id)");
    expect(sql).toContain("grok_graph_wake_intents_revision_unique unique (session_id, control_revision)");
    const apply = sql.slice(
      sql.indexOf("create or replace function public.apply_grok_graph_control_v2_as_owner"),
      sql.indexOf("create function public.apply_grok_graph_control_v3_as_owner"),
    );
    expect(apply).toContain("insert into public.grok_graph_wake_intents");
    expect(apply).toContain("'graph.wake_requested'");
    expect(apply).toContain("'workerWoken', false");
    expect(apply).not.toContain("v_session.goal");
  });

  it("separates GitHub acceptance from a real worker acknowledgement", () => {
    expect(sql).toContain("check (outcome in ('accepted', 'failed'))");
    expect(sql).toContain("'graph.wake_dispatch_' || p_outcome");
    expect(sql).toContain("'workerAcknowledged', false");
    expect(sql).toContain("create function public.acknowledge_grok_graph_wake_as_worker");
    expect(sql).toContain("'graph.wake_acknowledged'");
    expect(sql).toContain("'workerAcknowledged', true");
    expect(sql).toContain("'workerWoken', true");
    expect(route).toContain("dispatchAccepted");
    expect(route).toContain("workerWoken: workerAcknowledged");
    expect(route).toContain("not marked woken until it claims this graph");
  });

  it("receipts only the exact current claim and rejects missing, stale, or replayed identity", () => {
    const receipt = sql.slice(
      sql.indexOf("create function public.acknowledge_grok_graph_wake_as_worker"),
      sql.indexOf("create function public.read_grok_graph_wake_state_as_owner"),
    );
    for (const identity of [
      "p_wake_intent_id", "p_control_revision", "p_graph_id", "p_graph_run_id",
      "p_worker_id", "p_protocol_version", "p_capability_version",
    ]) expect(receipt).toContain(identity);
    expect(receipt).toContain("perform public.assert_current_grok_graph_wake_intent(v_intent)");
    expect(receipt).toContain("attempt.outcome = 'accepted'");
    expect(receipt).toContain("run.state = 'RUNNING'");
    expect(receipt).toContain("node_run.state = 'PENDING'");
    expect(receipt).toContain("receipt replay conflicts with exact worker identity");
    expect(sql).toContain("never resolves a wake identity");
  });

  it("places the receipt gate after claim and repository validation but before compile/provider", () => {
    const claim = worker.indexOf("const claim = await store.claimPlannedGraph()");
    const repository = worker.indexOf("const mismatch = repositoryMismatch");
    const receipt = worker.indexOf("await store.acknowledgeGrokWake");
    const absenceGuard = worker.indexOf("await store.assertNoGrokWakePayloadRequired");
    const compile = worker.indexOf("const compiled = compileClaimedGraph");
    const provider = worker.indexOf("const executor = buildClaudeNodeExecutor");
    expect(claim).toBeGreaterThan(-1);
    expect(repository).toBeGreaterThan(claim);
    expect(receipt).toBeGreaterThan(repository);
    expect(absenceGuard).toBeGreaterThan(repository);
    expect(compile).toBeGreaterThan(receipt);
    expect(provider).toBeGreaterThan(compile);
    expect(worker).toContain("The exact Grok wake intent and control revision must be supplied together.");
  });

  it("passes only opaque wake identity through the disabled-by-default workflow", () => {
    expect(workflow).toContain("SOFTWAREFACTORY_GROK_WAKE_INTENT_ID: ${{ github.event.client_payload.wake_intent_id || '' }}");
    expect(workflow).toContain("SOFTWAREFACTORY_GROK_CONTROL_REVISION: ${{ github.event.client_payload.control_revision || '' }}");
    expect(workflow).toContain("vars.SOFTWAREFACTORY_GRAPH_WORKER_ENABLED == 'true'");
    expect(workflow).not.toMatch(/SOFTWAREFACTORY_GROK_(?:GOAL|PROMPT|SESSION_TEXT)/i);
  });

  it("keeps evidence forced-RLS, append-only, and mutation functions service-role-only", () => {
    for (const table of [
      "grok_graph_wake_intents",
      "grok_graph_wake_dispatch_attempts",
      "grok_graph_wake_receipts",
    ]) {
      expect(sql).toContain(`'${table}'`);
    }
    expect(sql).toContain("alter table public.%I enable row level security");
    expect(sql).toContain("alter table public.%I force row level security");
    expect(sql).toContain("execute function public.reject_grok_evidence_mutation()");
    for (const functionName of [
      "record_grok_graph_wake_dispatch_as_server",
      "acknowledge_grok_graph_wake_as_worker",
      "assert_no_grok_graph_wake_payload_required_as_worker",
    ]) {
      expect(sql).toMatch(new RegExp(
        `grant execute on function public\\.${functionName}\\([\\s\\S]*?to service_role`,
        "i",
      ));
    }
    expect(sql).not.toMatch(/update\s+public\.runtime_control/i);
    expect(sql).not.toMatch(/autonom(?:y|ous_mode)\s*=\s*true/i);
    expect(sql).not.toMatch(/kill_switch(?:_enabled)?\s*=\s*false/i);
  });
});
