// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260831000100_grok_provider_admission.sql",
);

describe("Grok provider admission migration contract", () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(migrationPath, "utf8");
  });

  it("keeps immutable admission evidence forced behind RLS with no table grant", () => {
    expect(sql).toContain("create table public.grok_execution_admissions");
    expect(sql).toContain("alter table public.grok_execution_admissions enable row level security");
    expect(sql).toContain("alter table public.grok_execution_admissions force row level security");
    expect(sql).toMatch(
      /revoke all on table public\.grok_execution_admissions\s+from public, anon, authenticated, service_role/i,
    );
    expect(sql).not.toMatch(
      /grant\s+(?:select|insert|update|delete|truncate)[\s\S]{0,100}grok_execution_admissions/i,
    );
    expect(sql).toContain("grok_execution_admissions_immutable");
    expect(sql).toContain("grok_execution_admissions_no_truncate");
    expect(sql).toContain("provider_credential_id uuid not null");
    expect(sql).toContain("provider_credential_rotated_at timestamptz not null");
    expect(sql).toContain("agent_max_model_tier text not null");
    expect(sql).toContain("public.reject_grok_evidence_mutation()");
  });

  it("binds tenant, session, launch and exact graph node with catalog FKs", () => {
    for (const fragment of [
      "references public.grok_sessions(id, organization_id, project_id)",
      "references public.grok_graph_launches (",
      "references public.graph_nodes(id, organization_id, graph_id, node_key)",
      "unique (graph_id, node_key)",
    ]) {
      expect(sql).toContain(fragment);
    }
    expect(sql).toContain("Assignment, bot, role, account and credential ids are immutable validated");
    expect(sql).not.toMatch(
      /foreign key \((?:assignment_id|bot_id|role_id|ai_account_id|provider_credential_id), organization_id\)/i,
    );
  });

  it("separates direct graph MODEL admission from the Phase 1C writer handoff", () => {
    expect(sql).toContain("lane in ('graph_model', 'phase1c')");
    expect(sql).toContain("lane = 'graph_model' and provider = 'anthropic'");
    expect(sql).toContain("lane = 'phase1c'");
    expect(sql).toContain("node_key = 'implement'");
    expect(sql).toContain("capability = 'implementation'");
    expect(sql).toContain("v_node_input ->> 'executor' is distinct from 'MODEL'");
    expect(sql).toContain("v_node_input ->> 'executor' is distinct from 'ANCHOR'");
    expect(sql).toContain("every canonical provider lane requires exactly one admission");
  });

  it("locks and re-derives every planner-selected mutable identity before insert", () => {
    const start = sql.indexOf("create function public.launch_grok_full_lifecycle_v2_as_server");
    const body = sql.slice(start);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = pg_catalog");
    for (const relation of ["bot_assignments", "bots", "bot_roles", "ai_accounts"]) {
      expect(body).toMatch(new RegExp(`from public\\.${relation}[\\s\\S]{0,500}for update`, "i"));
    }
    expect(body).toMatch(
      /from public\.bot_assignments assignment[\s\S]{0,250}assignment\.organization_id = p_organization_id[\s\S]{0,250}assignment\.project_id = p_project_id/i,
    );
    for (const relation of ["bot", "role_definition", "account", "credential"]) {
      expect(body).toMatch(new RegExp(
        `from public\\.[a-z_]+ ${relation}[\\s\\S]{0,250}${relation}\\.organization_id = p_organization_id`,
        "i",
      ));
    }
    for (const field of [
      "assignmentRevision", "botRevision", "roleUpdatedAt", "agentCapabilities",
      "agentMaxModelTier",
      "accountUpdatedAt", "credentialPurpose", "credentialRef", "providerIdentity",
    ]) {
      expect(body).toContain(`'${field}'`);
    }
    expect(body).toContain("v_message.metadata #> '{plan,dag,tasks}'");
    expect(body).toContain("v_message.metadata #>> '{plan,planner,version}' is distinct from '2'");
    // The database independently repeats the exact application alias map,
    // sorts/de-duplicates it, and refuses a planner snapshot that differs.
    expect(body).toContain("selected grok role identity changed before admission");
    expect(body).toContain("when 'security' then 'security_review'");
    expect(body).toContain("when 'testing' then 'qa'");
    expect(body).toContain("v_role_normalized_capabilities is distinct from v_agent_capabilities");
    expect(body).toContain("when 'low' then 'ECONOMY'");
    expect(body).toContain("when 'medium' then 'STANDARD'");
    expect(body).toContain("when 'high' then 'STRONG'");
    expect(body).toContain("when 'max' then 'STRONG'");
    expect(body).toContain("v_node_input ->> 'model_tier'");
    expect(sql).toContain("'agentMaxModelTier', (p_admission).agent_max_model_tier");
    expect(body).toContain("v_agent_capabilities @> pg_catalog.jsonb_build_array(v_capability)");
    expect(body).toContain("selected grok AI account identity changed or is not connected");
    expect(body).toContain("public.ai_account_bot_credential_ref(");
    expect(body).toContain("from public.provider_credentials credential");
    expect(body).toContain("v_new_admission.provider_credential_id := v_credential.id");
    expect(body).toContain("v_new_admission.provider_credential_rotated_at := v_credential.rotated_at");
    expect(sql).toContain("'providerCredentialId', (p_admission).provider_credential_id");
    expect(sql).toContain("'providerCredentialRotatedAt', (p_admission).provider_credential_rotated_at");
    expect(body).not.toContain("sealed_envelope");
  });

  it("wraps the old paused launch atomically, hashes evidence, and never starts work", () => {
    const start = sql.indexOf("create function public.launch_grok_full_lifecycle_v2_as_server");
    const body = sql.slice(start, sql.indexOf("$function$;", start) + "$function$;".length);
    const oldLaunch = body.indexOf("public.launch_grok_full_lifecycle_as_server(");
    const insert = body.indexOf("insert into public.grok_execution_admissions");
    expect(oldLaunch).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(oldLaunch);
    expect(body).toContain("public.grok_execution_admission_hash(v_new_admission)");
    expect(body).toContain("grok launch predates immutable provider admission evidence");
    expect(body).not.toMatch(/insert into public\.(?:graph_runs|node_runs)/i);
    expect(sql).not.toMatch(/(?:credential_value|access_token|refresh_token|sealed_envelope)\s+(?:text|jsonb)/i);
  });

  it("leaves service_role only the v2 launch boundary", () => {
    expect(sql).toMatch(
      /revoke all on function public\.launch_grok_full_lifecycle_as_server\([\s\S]*?\) from public, anon, authenticated, service_role;/i,
    );
    const grants = [...sql.matchAll(
      /grant execute on function public\.(launch_grok_full_lifecycle(?:_v2)?_as_server)\([\s\S]*?\) to (\w+);/gi,
    )].map((match) => [match[1], match[2]]);
    expect(grants).toEqual([["launch_grok_full_lifecycle_v2_as_server", "service_role"]]);
    expect(sql).toMatch(
      /revoke all on function public\.grok_execution_admission_hash\([\s\S]*?\) from public, anon, authenticated, service_role;/i,
    );
  });
});
