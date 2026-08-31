// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260830001000_grok_chief_of_staff_persistence.sql",
);

const tables = [
  "grok_sessions",
  "grok_messages",
  "grok_task_links",
  "grok_graph_launches",
  "grok_events",
  "grok_artifact_links",
  "grok_control_intents",
] as const;

const browserFunctions = [
  "create_grok_session",
  "list_grok_sessions",
  "read_grok_session",
  "append_grok_user_message",
  "request_grok_control_intent",
] as const;

const serverFunctions = [
  "append_grok_message_as_server",
  "link_grok_task_as_server",
  "record_grok_event_as_server",
  "launch_grok_full_lifecycle_as_server",
  "link_grok_artifact_as_server",
  "resolve_grok_control_intent_as_server",
  "set_grok_session_status_as_server",
] as const;

describe("Grok Chief-of-Staff migration contract", () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(migrationPath, "utf8");
  });

  it("keeps every persistence and launch-evidence table forced behind RLS", () => {
    for (const table of tables) {
      expect(sql).toMatch(new RegExp(`'${table}'`));
    }
    expect(sql).toMatch(/alter table public\.%I enable row level security/i);
    expect(sql).toMatch(/alter table public\.%I force row level security/i);
    expect(sql).toMatch(
      /revoke all on table public\.%I from public, anon, authenticated, service_role/i,
    );
    expect(sql).not.toMatch(/grant\s+(?:select|insert|update|delete|truncate)[\s\S]{0,100}grok_/i);
  });

  it("pins every exposed function to a definer boundary and exact role", () => {
    for (const name of [...browserFunctions, ...serverFunctions]) {
      expect(sql).toMatch(new RegExp(
        `create function public\\.${name}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = pg_catalog`,
        "i",
      ));
      expect(sql).toMatch(new RegExp(
        `revoke all on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated, service_role`,
        "i",
      ));
    }
    for (const name of browserFunctions) {
      expect(sql).toMatch(new RegExp(
        `grant execute on function public\\.${name}\\([\\s\\S]*?\\) to authenticated`,
        "i",
      ));
    }
    for (const name of serverFunctions) {
      expect(sql).toMatch(new RegExp(
        `grant execute on function public\\.${name}\\([\\s\\S]*?\\) to service_role`,
        "i",
      ));
    }
    for (const name of serverFunctions) {
      const grants = [...sql.matchAll(new RegExp(
        `grant execute on function public\\.${name}\\([\\s\\S]*?\\)\\s+to\\s+(\\w+);`,
        "gi",
      ))];
      expect(grants.map((match) => match[1])).toEqual(["service_role"]);
    }
  });

  it("requires owner authorization inside every authenticated Grok RPC", () => {
    for (let index = 0; index < browserFunctions.length; index += 1) {
      const name = browserFunctions[index];
      const start = sql.indexOf(`create function public.${name}`);
      const nextName = browserFunctions[index + 1];
      const nextBrowser = nextName ? sql.indexOf(`create function public.${nextName}`, start + 1) : -1;
      const nextFunction = sql.indexOf("create function public.", start + 1);
      const end = nextBrowser > start ? nextBrowser : nextFunction > start ? nextFunction : sql.length;
      const body = sql.slice(start, end);
      expect(start, `${name} is absent`).toBeGreaterThan(-1);
      expect(body, `${name} must enforce the owner role`).toContain("public.has_organization_role(");
      expect(body, `${name} must name only owner authorization`).toContain(
        "array['owner'::public.organization_member_role]",
      );
    }
  });

  it("launches only canonical Full Lifecycle v2 and atomically pauses it without a run", () => {
    expect(sql).not.toMatch(/create function public\.launch_grok_graph_for_session\s*\(/i);
    expect(sql).not.toMatch(/grant execute on function public\.launch_grok_graph_for_session\s*\(/i);
    const start = sql.indexOf("create function public.launch_grok_full_lifecycle_as_server");
    const end = sql.indexOf("create function public.link_grok_artifact_as_server", start);
    const body = sql.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("public.create_graph_from_plan_with_release_identity_as_server(");
    expect(body).toMatch(/'full_lifecycle',\s*2,/i);
    expect(body).toContain("public.set_graph_pause_as_member(");
    expect(body.indexOf("public.set_graph_pause_as_member(")).toBeLessThan(
      body.indexOf("insert into public.grok_graph_launches"),
    );
    expect(body).toContain("public.link_grok_task_as_server(");
    expect(body).toContain("v_graph.pause_requested_at is null");
    expect(body).toContain("select 1 from public.graph_runs");
    expect(sql).not.toMatch(/insert into public\.graphs/i);
    expect(sql).not.toMatch(/insert into public\.graph_runs/i);
    expect(sql).not.toMatch(/insert into public\.node_runs/i);
    expect(sql).not.toMatch(/grant\s+.*on table public\.grok_graph_launches/i);
  });

  it("checks exact message and event replay before stale sequence CAS", () => {
    const append = sql.slice(
      sql.indexOf("create function public.append_grok_message_internal"),
      sql.indexOf("create function public.append_grok_user_message"),
    );
    expect(append.indexOf("idempotency_key = p_idempotency_key")).toBeGreaterThan(-1);
    expect(append.indexOf("idempotency_key = p_idempotency_key")).toBeLessThan(
      append.indexOf("stale_grok_message_sequence"),
    );
    expect(append).toContain("errcode = '22023'");

    const event = sql.slice(
      sql.indexOf("create function public.record_grok_event_as_server"),
      sql.indexOf("create function public.link_grok_artifact_as_server"),
    );
    expect(event.indexOf("correlation_id = p_correlation_id")).toBeGreaterThan(-1);
    expect(event.indexOf("correlation_id = p_correlation_id")).toBeLessThan(
      event.indexOf("stale_grok_event_sequence"),
    );
    expect(event).toContain("errcode = '22023'");
  });

  it("returns the route's snake-case transcript contract and safe artifacts", () => {
    const read = sql.slice(
      sql.indexOf("create function public.read_grok_session"),
      sql.indexOf("create function public.append_grok_message_internal"),
    );
    for (const key of [
      "session", "messages", "task_links", "events", "artifact_links",
      "control_intents", "message_sequence", "event_sequence",
    ]) {
      expect(read).toContain(`'${key}'`);
    }
    expect(read).toContain("'kind'");
    expect(read).toContain("'label'");
    expect(read).toContain("'uri'");
    expect(read).not.toContain("taskLinks");
    expect(read).not.toContain("artifactLinks");
    expect(sql).toContain("closed_at timestamptz");
    expect(sql).toContain("reply_to_message_id uuid");
  });

  it("keeps transcript, launch and artifacts append-only and control state monotonic", () => {
    for (const table of [
      "grok_messages", "grok_task_links", "grok_graph_launches",
      "grok_events", "grok_artifact_links",
    ]) {
      expect(sql).toContain(`'${table}'`);
    }
    expect(sql).toContain("grok workspace evidence is immutable");
    expect(sql).toContain("before truncate");
    expect(sql).toContain("invalid grok control intent transition");
    expect(sql).toContain("A row is intent only and never performs the target action");
  });
});
