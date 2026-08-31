// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260831001100_grok_context_envelopes.sql",
);

describe("Grok context-envelope migration contract", () => {
  let sql: string;
  let normalized: string;

  beforeAll(async () => {
    sql = await readFile(migrationPath, "utf8");
    normalized = sql.replace(/\s+/g, " ").toLowerCase();
  });

  it("keeps both append-only tables forced behind RLS with no table grants", () => {
    for (const table of ["grok_context_envelopes", "grok_context_items"]) {
      expect(normalized).toContain(`create table public.${table}`);
      expect(normalized).toContain(`'${table}'`);
      expect(normalized).toContain(`before update or delete on public.${table}`);
      expect(normalized).toContain(`before truncate on public.${table}`);
    }
    expect(normalized).toContain("alter table public.%i enable row level security");
    expect(normalized).toContain("alter table public.%i force row level security");
    expect(normalized).toContain("revoke all on table public.%i from public, anon, authenticated, service_role");
    expect(normalized).not.toMatch(/grant (select|insert|update|delete|truncate) on (table )?public\.grok_context/i);
  });

  it("exposes only an owner follow-up/read boundary and a service-only initial writer", () => {
    expect(normalized).toContain("grant execute on function public.append_grok_follow_up_context(");
    expect(normalized).toContain("grant execute on function public.list_grok_context_envelopes(");
    expect(normalized).toContain("to authenticated");
    expect(normalized).toContain("grant execute on function public.record_grok_context_envelope_as_server(");
    expect(normalized).toContain("to service_role");
    expect(normalized).not.toMatch(/grant execute on function public\.record_grok_context_envelope_internal[\s\S]*?to /i);
    expect(normalized).toContain("array['owner'::public.organization_member_role]");
  });

  it("binds tenant, project, session, message and linked-integration identity", () => {
    expect(normalized).toContain("references public.grok_sessions(id, organization_id, project_id)");
    expect(normalized).toContain("references public.grok_messages(id, organization_id, session_id)");
    expect(normalized).toContain("references public.connections(id, organization_id)");
    expect(normalized).toContain("from public.project_connections link");
    expect(normalized).toContain("link.project_id = p_project_id");
    expect(normalized).toContain("session.created_by is distinct from p_created_by");
  });

  it("enforces secret, item, file, session and public-URL bounds", () => {
    expect(normalized).toContain("not public.text_has_likely_secret(content_text)");
    expect(normalized).toContain("public.project_production_url_is_safe(v_source_url)");
    expect(normalized).toContain("jsonb_array_length(p_items) not between 2 and 12");
    expect(normalized).toContain("v_total_bytes > 49152");
    expect(normalized).toContain("v_existing_count + pg_catalog.jsonb_array_length(p_items) > 64");
    expect(normalized).toContain("v_existing_bytes + v_total_bytes > 262144");
    expect(normalized).toContain("content_text is null");
  });

  it("records a content-free immutable audit event and starts no execution", () => {
    const event = normalized.slice(normalized.indexOf("'context.recorded'"));
    expect(event).toContain("'workerwoken', false");
    expect(event).toContain("'executionstarted', false");
    expect(event).not.toContain("insert into public.graph_runs");
    expect(event).not.toContain("insert into public.node_runs");
    expect(sql).not.toMatch(/worker.*dispatch/i);
  });

  it("checks exact replay before the event-sequence CAS", () => {
    const body = normalized.slice(
      normalized.indexOf("create function public.record_grok_context_envelope_internal"),
      normalized.indexOf("revoke all on function public.record_grok_context_envelope_internal"),
    );
    expect(body.indexOf("idempotency_key = p_idempotency_key")).toBeGreaterThan(-1);
    expect(body.indexOf("idempotency_key = p_idempotency_key")).toBeLessThan(
      body.indexOf("stale_grok_context_event_sequence"),
    );
    expect(body).toContain("input_sha256 is distinct from v_input_sha256");
  });

  it("ends with an explicit catalog and ACL postflight", () => {
    const postflight = normalized.slice(normalized.indexOf("do $grok_context_postflight$"));
    expect(postflight).toContain("grok context relation postflight failed");
    expect(postflight).toContain("grok context policy postflight failed");
    expect(postflight).toContain("grok context trigger postflight failed");
    expect(postflight).toContain("grok context function identity postflight failed");
    expect(postflight).toContain("grok context function acl postflight failed");
    expect(postflight).toContain("relation.relforcerowsecurity");
    expect(postflight).toContain("information_schema.role_table_grants");
    expect(postflight).toContain("pg_catalog.has_function_privilege");
  });
});
