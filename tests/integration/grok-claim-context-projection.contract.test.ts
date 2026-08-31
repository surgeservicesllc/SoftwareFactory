import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260831001500_grok_claim_context_projection.sql",
), "utf8");
const sql = migration.toLowerCase().replace(/\s+/g, " ");

describe("Grok protocol-v3 context projection migration", () => {
  it("keeps the projection private and pins the existing claim identities before replacement", () => {
    expect(sql).toContain("create function public.grok_initial_context_claim_projection");
    expect(sql).toMatch(/grok_initial_context_claim_projection\([\s\S]*?security definer[\s\S]*?set search_path = pg_catalog/i);
    expect(sql).toContain("revoke all on function public.grok_initial_context_claim_projection(uuid) from public, anon, authenticated, service_role");
    expect(sql).not.toMatch(/grant execute on function public\.grok_initial_context_claim_projection/i);
    for (const digest of [
      "427294dac55a06b5ca1f9a1c89b0cdfa",
      "48f84aba274b2e6316331de8e3fca796",
      "4a6da8bed8d1fdda17f11df00d549817",
      "f83873aa19703d2c61553026d4141a4c",
      "ef8803cb5ec809266b8fdf6f048b1a2f",
      "14c204c6c9d8da1ed6038d0f56942be8",
    ]) expect(sql).toContain(digest);
  });

  it("selects only the immutable initial user envelope through the exact plan reply chain", () => {
    expect(sql).toContain("message.sequence_no = 2");
    expect(sql).toContain("message.metadata ->> 'kind' = 'grok.plan'");
    expect(sql).toContain("message.id = v_plan_message.reply_to_message_id");
    expect(sql).toContain("message.sequence_no = 1");
    expect(sql).toContain("and not envelope.replan_required");
    expect(sql).not.toContain("where envelope.replan_required");
  });

  it("recomputes bounds, file and envelope hashes before attaching context after admission", () => {
    expect(sql).toContain("item.content_sha256 is distinct from pg_catalog.encode");
    expect(sql).toContain("v_envelope.input_sha256 is distinct from v_input_sha256");
    expect(sql).toContain("v_total_bytes not between 0 and 49152");
    expect(sql).toContain("public.text_has_likely_secret(");
    const graphAttach = sql.slice(sql.indexOf("create or replace function public.attach_current_grok_admissions_to_claim"));
    expect(graphAttach.indexOf("assert_current_grok_execution_admissions")).toBeGreaterThan(-1);
    expect(graphAttach.indexOf("grok_initial_context_claim_projection")).toBeGreaterThan(
      graphAttach.indexOf("assert_current_grok_execution_admissions"),
    );
    expect(graphAttach).toContain("'initial_context', v_context");
  });

  it("leaves public v3 signatures and legacy/non-Grok projections unchanged", () => {
    expect(sql).not.toMatch(/create or replace function public\.claim_(?:planned_graph|phase1c_run).*_v3/i);
    expect(sql).toContain("return p_claim || pg_catalog.jsonb_build_object('grok_admission_required', false)");
    expect(sql).toContain("if not v_grok_admission_required then return p_claim");
    expect(sql).not.toMatch(/worker_enabled|autonomous_mode|kill_switch|http_|net\./i);
  });

  it("postflights exact relations, FORCE RLS, policies, grants, triggers, and function authority", () => {
    const postflight = sql.slice(sql.indexOf("do $grok_claim_context_postflight$"));
    expect(postflight).toContain("relation.relkind = 'r'");
    expect(postflight).toContain("relation.relforcerowsecurity");
    expect(postflight).toContain("information_schema.role_table_grants");
    expect(postflight).toContain("grok_context_envelopes_select_member");
    expect(postflight).toContain("grok_context_items_select_member");
    expect(postflight).toContain("grok_context_envelopes_immutable");
    expect(postflight).toContain("grok_context_items_no_truncate");
    expect(postflight).toContain("has_function_privilege('service_role', routine.oid, 'execute')");
  });
});
