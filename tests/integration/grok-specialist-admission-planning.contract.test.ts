// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260831001000_grok_specialist_admission_planning.sql",
);

describe("planner-v3 specialist admission migration contract", () => {
  let sql: string;
  let normalized: string;

  beforeAll(async () => {
    sql = await readFile(migrationPath, "utf8");
    normalized = sql.replace(/\s+/g, " ").toLowerCase();
  });

  it("creates append-only forced-RLS roster evidence with no browser or service table grant", () => {
    expect(normalized).toContain("create table public.grok_specialist_admissions");
    expect(normalized).toContain("alter table public.grok_specialist_admissions enable row level security");
    expect(normalized).toContain("alter table public.grok_specialist_admissions force row level security");
    expect(normalized).toContain("before update or delete on public.grok_specialist_admissions");
    expect(normalized).toContain("before truncate on public.grok_specialist_admissions");
    expect(normalized).toContain("revoke all on table public.grok_specialist_admissions from public, anon, authenticated, service_role");
  });

  it("normalizes aliases and expands wildcard only into the fixed canonical vocabulary", () => {
    expect(normalized).toContain("create function public.normalize_grok_role_capabilities");
    expect(normalized).toContain("when '*' then array[");
    for (const capability of [
      "planning", "architecture", "implementation", "extraction", "review",
      "security_review", "qa", "synthesis", "reporting", "discovery",
      "evaluation", "decision",
    ]) expect(normalized).toContain(`'${capability}'`);
    expect(normalized).toContain("or (entry.value -> 'capabilities') @> '[\"*\"]'::jsonb");
  });

  it("serializes and proves the complete current Ready configured project roster", () => {
    expect(normalized).toContain("lock table public.provider_credentials in share mode");
    expect(normalized).toContain("assignment.status <> 'released'::public.bot_assignment_status");
    expect(normalized).toContain("order by assignment.id for update");
    expect(normalized).toContain("for update of bot");
    expect(normalized).toContain("for update of role_definition");
    expect(normalized).toContain("for update of account");
    expect(normalized).toContain("for update of credential");
    expect(normalized).toContain("v_expected_roster_count is distinct from pg_catalog.jsonb_array_length(v_roster)");
    expect(normalized).toContain("grok specialist roster is not the complete current ready configured project roster");
  });

  it("keeps accepted v1 hashing intact and dispatches current assertions by evidence generation", () => {
    expect(normalized).not.toContain("create or replace function public.grok_execution_admission_hash(");
    expect(normalized).toContain("create function public.grok_execution_admission_hash_v2(");
    expect(normalized).toContain("create or replace function public.grok_current_execution_admission_hash(");
    expect(normalized).toContain("if (p_admission).specialist_admission_id is null then return public.grok_execution_admission_hash(p_admission)");
    expect(normalized).toContain("public.grok_specialist_admission_hash(v_specialist)");
    expect(normalized).toContain("return public.grok_execution_admission_hash_v2(p_admission)");
  });

  it("admits only build/fix/test through v3 and revokes older launcher execution", () => {
    expect(normalized).toContain("create function public.launch_grok_full_lifecycle_v3_as_server");
    expect(normalized).toContain("{plan,intent,kind}' not in ('build', 'fix', 'test')");
    expect(normalized).toContain("revoke all on function public.launch_grok_full_lifecycle_v2_as_server(");
    expect(normalized).toContain("grant execute on function public.launch_grok_full_lifecycle_v3_as_server(");
    expect(normalized).toContain("to service_role");
  });

  it("uses the authoritative credential-reference and purpose bounds", () => {
    expect(sql).toContain("credential_purpose ~ '^[a-z][a-z0-9_]{1,62}$'");
    expect(sql).toContain("credential_ref ~ '^[A-Z][A-Z0-9_]{2,63}$'");
  });
});
