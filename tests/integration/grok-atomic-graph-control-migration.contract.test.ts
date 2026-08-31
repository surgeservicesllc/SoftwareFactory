// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260830010000_atomic_grok_graph_control.sql",
);

describe("Grok atomic graph-control migration contract", () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(migrationPath, "utf8");
  });

  it("exposes one owner-only atomic definer RPC and no table grants", () => {
    expect(sql).toMatch(
      /create function public\.apply_grok_graph_control_as_owner\([\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i,
    );
    expect(sql).toContain("public.has_organization_role(");
    expect(sql).toContain("array['owner'::public.organization_member_role]");
    expect(sql).toMatch(
      /revoke all on function public\.apply_grok_graph_control_as_owner\([\s\S]*?from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.apply_grok_graph_control_as_owner\([\s\S]*?to authenticated/i,
    );
    expect(sql).not.toMatch(/grant\s+(?:select|insert|update|delete|truncate)\s+on/i);
  });

  it("locks the scoped session before exact request resolution or graph mutation", () => {
    expect(sql).toContain("session.id = p_session_id");
    expect(sql).toContain("session.organization_id = p_organization_id");
    expect(sql).toContain("graph.project_id = v_session.project_id");
    expect(sql).toContain("from public.grok_graph_launches launch");
    expect(sql).toContain("launch.session_id = p_session_id");
    expect(sql).toContain("launch.graph_id = p_graph_id");
    expect(sql).toContain("intent.organization_id = p_organization_id");
    expect(sql).toContain("intent.session_id = p_session_id");
    expect(sql).toContain("intent.idempotency_key = p_idempotency_key");
    const sessionLock = sql.indexOf("from public.grok_sessions session");
    const request = sql.indexOf("public.request_grok_control_intent(");
    const graphAction = sql.indexOf("public.set_graph_pause_as_member(");
    expect(sessionLock).toBeGreaterThan(-1);
    expect(sessionLock).toBeLessThan(request);
    expect(request).toBeLessThan(graphAction);
    expect(sql.indexOf("from public.grok_graph_launches launch")).toBeLessThan(request);
  });

  it("rejects later graph controls by immutable event sequence, never wall-clock ordering", () => {
    expect(sql).toContain("event.event_type = 'control.requested'");
    expect(sql).toContain("later_event.event_type = 'control.requested'");
    expect(sql).toContain("later_event.sequence_no > v_request_sequence");
    expect(sql).toContain("later_intent.target_kind = 'graph'");
    expect(sql).toContain("later_intent.graph_id = p_graph_id");
    expect(sql).not.toContain("later.requested_at");
    expect(sql).not.toContain("later.id) >");
  });

  it("mutates and resolves the requested intent inside the same function", () => {
    expect(sql).toContain("public.set_graph_pause_as_member(");
    expect(sql).toContain("public.withdraw_graph_as_member(");
    expect(sql).toContain("public.resolve_grok_control_intent_as_server(");
    expect(sql).toContain("v_intent.state = 'applied'");
    expect(sql).toContain("v_intent.state <> 'requested'");
  });

  it("validates durable graph state before applied replay and makes requested recovery resolution-only", () => {
    const graphLock = sql.indexOf("from public.graphs graph");
    const appliedReplay = sql.indexOf("if v_intent.state = 'applied' then");
    expect(graphLock).toBeGreaterThan(-1);
    expect(graphLock).toBeLessThan(appliedReplay);
    expect(sql).toContain(
      "when 'pause' then v_graph.pause_requested_at is not null and v_graph.withdrawn_at is null",
    );
    expect(sql).toContain(
      "when 'resume' then v_graph.pause_requested_at is null and v_graph.withdrawn_at is null",
    );
    expect(sql).toContain("when 'withdraw' then v_graph.withdrawn_at is not null");

    const recoveryStart = sql.indexOf("-- Requested replay recovery is resolution-only.");
    const recoveryEnd = sql.indexOf("select resolved.*", recoveryStart);
    const recovery = sql.slice(recoveryStart, recoveryEnd);
    const replayBranchEnd = recovery.indexOf("  else");
    expect(recoveryStart).toBeGreaterThan(-1);
    expect(recovery).toContain("grok_control_recovery_ambiguous");
    expect(recovery.slice(0, replayBranchEnd)).not.toContain("perform public.set_graph_pause_as_member");
    expect(recovery.slice(0, replayBranchEnd)).not.toContain("perform public.withdraw_graph_as_member");
  });
});
