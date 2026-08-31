// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260830001100_grok_planning_failure.sql",
);

describe("Grok planning-failure migration contract", () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(migrationPath, "utf8");
  });

  it("adds blocked as readable nonclosed evidence and admits only active to blocked", () => {
    expect(sql).toContain(
      "status in ('active', 'blocked', 'completed', 'cancelled', 'archived')",
    );
    expect(sql).toContain(
      "(status in ('active', 'blocked') and closed_at is null)",
    );
    expect(sql).toContain(
      "(old.status = 'active' and new.status in ('blocked', 'completed', 'cancelled', 'archived'))",
    );
    expect(sql).not.toMatch(/old\.status\s*=\s*'blocked'[\s\S]{0,80}new\.status/i);
    expect(sql).toMatch(
      /when p_status = 'blocked' then null[\s\S]*else coalesce\(closed_at, pg_catalog\.now\(\)\)/i,
    );
  });

  it("preserves the status RPC boundary while adding exact blocked replay", () => {
    const setter = sql.slice(
      sql.indexOf("create or replace function public.set_grok_session_status_as_server"),
      sql.indexOf("create function public.record_grok_planning_failure_as_server"),
    );
    expect(setter).toMatch(/returns public\.grok_sessions[\s\S]*security definer/i);
    expect(setter).toContain("set search_path = pg_catalog");
    expect(setter).toContain(
      "if p_status not in ('blocked', 'completed', 'cancelled', 'archived')",
    );
    expect(setter.indexOf("if v_session.status = p_status")).toBeLessThan(
      setter.indexOf("if v_session.version <> p_expected_version"),
    );
    expect(setter).toMatch(
      /revoke all on function public\.set_grok_session_status_as_server\([\s\S]*from public, anon, authenticated, service_role/i,
    );
    expect(setter).toMatch(
      /grant execute on function public\.set_grok_session_status_as_server\([\s\S]*to service_role/i,
    );
  });

  it("installs one service-only atomic RPC with bounded six-code evidence", () => {
    const atomic = sql.slice(
      sql.indexOf("create function public.record_grok_planning_failure_as_server"),
      sql.indexOf("do $grok_planning_failure_postflight$"),
    );
    expect(atomic).toMatch(
      /record_grok_planning_failure_as_server\(\s*p_organization_id uuid,\s*p_session_id uuid,\s*p_user_message_id uuid,\s*p_error_code text,\s*p_idempotency_key text,\s*p_expected_version bigint\s*\)/i,
    );
    expect(atomic).toMatch(/returns jsonb[\s\S]*security definer[\s\S]*set search_path = pg_catalog/i);
    for (const code of [
      "INVALID_INPUT",
      "SENSITIVE_DATA",
      "NO_CONFIGURED_AGENTS",
      "MISSING_CLAUDE_AGENT",
      "MISSING_CODEX_AGENT",
      "GRAPH_INVALID",
    ]) {
      expect(atomic).toContain(`when '${code}'`);
    }
    expect(atomic).not.toMatch(/p_(?:content|metadata|payload|detail)\b/i);
    expect(atomic).toContain("'kind', 'grok.planning_error'");
    expect(atomic).toContain("'code', p_error_code");
    expect(atomic).toContain("'workerWoken', false");
    expect(atomic).toContain("'executionStarted', false");
    expect(atomic).toMatch(
      /revoke all on function public\.record_grok_planning_failure_as_server\([\s\S]*from public, anon, authenticated, service_role/i,
    );
    expect(atomic).toMatch(
      /grant execute on function public\.record_grok_planning_failure_as_server\([\s\S]*to service_role/i,
    );
  });

  it("checks exact replay before CAS and records message, failure, then blocked atomically", () => {
    const atomic = sql.slice(
      sql.indexOf("create function public.record_grok_planning_failure_as_server"),
      sql.indexOf("revoke all on function public.record_grok_planning_failure_as_server"),
    );
    const replayLookup = atomic.indexOf("and message.idempotency_key = p_idempotency_key");
    const activeCas = atomic.indexOf("if v_session.status <> 'active'");
    const versionCas = atomic.indexOf("if v_session.version <> p_expected_version");
    expect(replayLookup).toBeGreaterThan(-1);
    expect(replayLookup).toBeLessThan(activeCas);
    expect(replayLookup).toBeLessThan(versionCas);
    expect(atomic).toContain("v_session.version <> 5");
    expect(atomic).not.toContain(
      "v_session.version <> p_expected_version + 3 then\n      raise exception using errcode = '55000', message = 'grok planning failure replay status mismatch'",
    );

    const append = atomic.indexOf("public.append_grok_message_internal(");
    const failureEvent = atomic.indexOf("public.record_grok_event_as_server(");
    const blocked = atomic.indexOf("public.set_grok_session_status_as_server(");
    expect(append).toBeGreaterThan(versionCas);
    expect(append).toBeLessThan(failureEvent);
    expect(failureEvent).toBeLessThan(blocked);
    expect(atomic).toContain("'session.planning_failed'");
    expect(atomic).toContain("'blocked'");
    expect(atomic).not.toMatch(/create_graph|graph_run|node_run|dispatch_worker/i);
  });
});
