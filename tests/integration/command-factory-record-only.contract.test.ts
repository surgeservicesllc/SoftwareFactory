// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260822001000_factory_any_model_record_only.sql",
);

describe("factory any-model record-only migration contract", () => {
  let migration = "";

  beforeAll(async () => {
    migration = await readFile(migrationPath, "utf8");
  });

  function functionDefinition(name: string): string {
    return migration.match(
      new RegExp(
        `create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`,
        "i",
      ),
    )?.[0] ?? "";
  }

  it("keeps the normalized implementation private behind the original public signature", () => {
    expect(migration).toMatch(
      /alter function public\.submit_command\([\s\S]*?rename to submit_command_phase1c_normalized_internal/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.submit_command_phase1c_normalized_internal\([\s\S]*?from public, anon, authenticated, service_role/i,
    );
    const publicSubmit = functionDefinition("submit_command");
    expect(publicSubmit).toMatch(
      /from public\.submit_command_phase1c_normalized_internal\(/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.submit_command\([\s\S]*?to authenticated/i,
    );
  });

  it("gates the frozen 00900 input catalog before the first durable change", () => {
    const preflight = migration.indexOf("do $preflight$");
    const durableChange = migration.indexOf(
      "create table public.factory_record_only_submission_guards",
    );
    expect(preflight).toBeGreaterThan(0);
    expect(durableChange).toBeGreaterThan(preflight);
    expect(migration.slice(0, durableChange)).toMatch(
      /2ac0a2a4d51e54d1b0d89f49cf33ba87[\s\S]*?7addf177418dea367bce655815915e61[\s\S]*?adb50eb74e1721274f23d0d69b79e2e8/i,
    );
    expect(migration.slice(0, durableChange)).toMatch(
      /pg_catalog\.pg_depend[\s\S]*?refobjid[\s\S]*?refuses to rename a function with catalog dependents/i,
    );
    expect(migration.slice(0, durableChange)).toMatch(
      /_sf_20260822001000_trigger_expectations[\s\S]*?commands_phase1c_normalize[\s\S]*?tasks_phase1c_queue[\s\S]*?agent_runs_red_execution_gate/i,
    );
    expect(migration.slice(0, durableChange)).toContain(
      "01000 agent_runs RLS, ACL, or policy boundary mismatch",
    );
  });

  it("pins one canonical non-executing plan for every bounded non-Codex identity", () => {
    const normalize = functionDefinition("normalize_phase1c_command");
    const factorySubmit = functionDefinition("submit_factory_command");
    for (const body of [normalize, factorySubmit]) {
      expect(body).toMatch(/'executionMode', 'record_only'|execution_mode_value = 'record_only'/i);
      expect(body).toMatch(/'requiresDraftPullRequest', false/i);
      expect(body).toMatch(/'stages', (?:pg_catalog\.)?jsonb_build_array\('record'\)/i);
      expect(body).toMatch(/'workflow', 'factory_record_only'/i);
    }
    expect(normalize).toMatch(
      /char_length\(btrim\(coalesce\(new\.parameters ->> 'provider', ''\)\)\) not between 1 and 40/i,
    );
    expect(normalize).toMatch(
      /char_length\(btrim\(coalesce\(new\.parameters ->> 'model', ''\)\)\) not between 1 and 128/i,
    );
  });

  it("derives provider and model from the locked selected posting", () => {
    const factorySubmit = functionDefinition("submit_factory_command");
    const authenticationGate = factorySubmit.indexOf("if v_caller is null then");
    const ownerGate = factorySubmit.indexOf(
      "public.is_organization_owner(p_organization_id)",
    );
    const assignmentRead = factorySubmit.indexOf(
      "from public.bot_assignments assignment",
    );
    const guardInsert = factorySubmit.indexOf(
      "insert into public.factory_record_only_submission_guards",
    );
    expect(authenticationGate).toBeGreaterThan(0);
    expect(ownerGate).toBeGreaterThan(authenticationGate);
    expect(assignmentRead).toBeGreaterThan(ownerGate);
    expect(guardInsert).toBeGreaterThan(assignmentRead);
    expect(factorySubmit).toMatch(
      /from public\.bot_assignments assignment[\s\S]*?for update/i,
    );
    expect(factorySubmit).toMatch(/from public\.bots bot[\s\S]*?for update/i);
    expect(factorySubmit).toMatch(
      /v_resolved_model := coalesce\(v_assignment\.model, v_bot\.model\)/i,
    );
    expect(factorySubmit).toMatch(/'provider', v_bot\.provider::text/i);
    expect(factorySubmit).toMatch(/'model', v_resolved_model/i);
    expect(factorySubmit).toMatch(
      /from public\.submit_factory_command_routing_internal\(/i,
    );
    expect(functionDefinition("submit_factory_command_routing_internal")).toMatch(
      /public\.is_organization_owner\(p_organization_id\)/i,
    );
  });

  it("uses a one-use, table-denied capability and never persists its token", () => {
    expect(migration).toMatch(
      /create table public\.factory_record_only_submission_guards\s*\(/i,
    );
    expect(migration).toMatch(
      /alter table public\.factory_record_only_submission_guards enable row level security/i,
    );
    expect(migration).toMatch(
      /alter table public\.factory_record_only_submission_guards force row level security/i,
    );
    expect(migration).toMatch(
      /revoke all on table public\.factory_record_only_submission_guards\s+from public, anon, authenticated, service_role/i,
    );

    const publicSubmit = functionDefinition("submit_command");
    expect(publicSubmit).toMatch(
      /delete from public\.factory_record_only_submission_guards guard[\s\S]*?and guard\.authorized_parameters = v_parameters;\s*if not found then/i,
    );
    expect(publicSubmit).toMatch(
      /v_parameters jsonb := coalesce\(p_parameters, '\{\}'::jsonb\)\s+- '_factoryRecordOnlyAuthorization'/i,
    );
    expect(publicSubmit).toContain("Phase 1C execution configuration is not supported");
  });

  it("verifies the repository before stopping record-only task planning", () => {
    const planTask = functionDefinition("plan_phase1c_task_and_run");
    const repositoryCheck = planTask.indexOf(
      "Phase 1C repository binding changed before queueing",
    );
    const recordOnlyReturn = planTask.indexOf(
      "if execution_mode_value = 'record_only' then",
    );
    const agentLookup = planTask.indexOf("from public.agents agent");
    expect(repositoryCheck).toBeGreaterThan(0);
    expect(recordOnlyReturn).toBeGreaterThan(repositoryCheck);
    expect(agentLookup).toBeGreaterThan(recordOnlyReturn);
    expect(planTask).toMatch(/new\.assigned_agent_id := null;\s+return new;/i);
  });

  it("returns before agent_run creation but preserves the manual Codex insert", () => {
    const queueRun = functionDefinition("queue_phase1c_run_for_task");
    const recordOnlyReturn = queueRun.indexOf(
      "command_record.parameters ->> 'executionMode' = 'record_only'",
    );
    const runInsert = queueRun.indexOf("insert into public.agent_runs");
    expect(recordOnlyReturn).toBeGreaterThan(0);
    expect(runInsert).toBeGreaterThan(recordOnlyReturn);
    expect(queueRun).toMatch(/command_record\.parameters ->> 'provider'/i);
    expect(queueRun).toMatch(/command_record\.parameters ->> 'model'/i);
    expect(queueRun).toMatch(/'queued'::public\.run_status/i);
  });

  it("excludes record-only history from both executable capacity decisions", () => {
    const candidates = functionDefinition("list_factory_command_routing_candidates");
    const atomicSubmit = functionDefinition(
      "submit_factory_command_routing_internal",
    );
    expect(
      candidates.match(
        /coalesce\(command\.parameters ->> 'executionMode', ''\) <> 'record_only'/gi,
      ),
    ).toHaveLength(2);
    expect(
      atomicSubmit.match(
        /coalesce\(command\.parameters ->> 'executionMode', ''\) <> 'record_only'/gi,
      ),
    ).toHaveLength(1);
    expect(atomicSubmit).toMatch(
      /if v_execution_mode <> 'record_only'[\s\S]*?v_in_flight >= v_assignment\.max_concurrent_tasks then[\s\S]*selected bot assignment is at its concurrency limit/i,
    );
  });

  it("keeps only exact OpenAI Codex executable and canonicalizes every other model", () => {
    const factorySubmit = functionDefinition("submit_factory_command");
    expect(factorySubmit).toMatch(
      /not \([\s\S]*?v_bot\.provider = 'openai'::public\.bot_provider[\s\S]*?v_resolved_model = 'gpt-5\.3-codex'[\s\S]*?\) then/i,
    );
    expect(factorySubmit).toMatch(/'executionMode', 'record_only'/i);
  });

  it("does not demand write or pull-request authority for non-executing work", () => {
    const atomicSubmit = functionDefinition("submit_factory_command_routing_internal");
    expect(atomicSubmit).toMatch(
      /v_execution_mode <> 'record_only'[\s\S]*?repository_access <> 'write'/i,
    );
    expect(atomicSubmit).toMatch(
      /v_execution_mode <> 'record_only'[\s\S]*?not v_assignment\.can_open_pull_request/i,
    );
    expect(atomicSubmit).toMatch(
      /pipeline_access not in \('assigned', 'all'\)/i,
    );
  });

  it("publishes only the safe execution disposition needed for truthful Step 9", () => {
    expect(migration).toMatch(
      /create function public\.list_factory_commands\([\s\S]*?execution_mode text[\s\S]*?command\.parameters ->> 'executionMode' = 'record_only'[\s\S]*?from public\.commands command/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.list_factory_commands\(uuid, integer, uuid\)[\s\S]*?from public, anon, authenticated, service_role[\s\S]*?grant execute on function public\.list_factory_commands\(uuid, integer, uuid\)[\s\S]*?to authenticated/i,
    );
    expect(migration).toContain(
      "01000 safe command disposition list catalog, source, or ACL mismatch",
    );
  });

  it("carries the 00400 lint-clean routing bodies forward", () => {
    const candidates = functionDefinition("list_factory_command_routing_candidates");
    const publicSubmit = functionDefinition("submit_factory_command");
    const internalSubmit = functionDefinition(
      "submit_factory_command_routing_internal",
    );
    for (const body of [candidates, publicSubmit, internalSubmit]) {
      expect(body).not.toMatch(/v_project public\.projects%rowtype/i);
      expect(body).not.toMatch(/select project\.\* into v_project/i);
    }
    expect(candidates).toMatch(
      /perform 1\s+from public\.projects project[\s\S]*?active project was not found for this organization/i,
    );
    expect(internalSubmit).toMatch(
      /perform 1\s+from public\.projects project[\s\S]*?active project was not found for this organization/i,
    );
  });

  it("blocks the separate provider-run producer before its private INSERT delegate", () => {
    const providerRun = functionDefinition("record_provider_run");
    const recordOnlyGate = providerRun.indexOf(
      "task_execution_mode = 'record_only'",
    );
    const privateDelegate = providerRun.indexOf(
      "from public.record_provider_run_phase1c_compatibility_internal(",
    );
    expect(recordOnlyGate).toBeGreaterThan(0);
    expect(privateDelegate).toBeGreaterThan(recordOnlyGate);
    expect(providerRun).toContain("record-only tasks cannot create provider runs");
    expect(providerRun).toMatch(/command\.parameters ->> 'executionMode'/i);
    expect(providerRun).toMatch(/left join public\.commands command/i);
    expect(migration).toMatch(
      /alter function public\.record_provider_run\([\s\S]*?rename to record_provider_run_phase1c_compatibility_internal/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.record_provider_run_phase1c_compatibility_internal\([\s\S]*?from public, anon, authenticated, service_role/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.record_provider_run\([\s\S]*?grant execute on function public\.record_provider_run\([\s\S]*?to authenticated/i,
    );
  });

  it("postflights exact OIDs, source/catalog/ACL, trigger bindings, and run producers", () => {
    const postflight = migration.slice(migration.indexOf("do $postflight$"));
    expect(postflight).not.toBe("");
    expect(postflight).toContain("_sf_20260822001000_function_guard");
    expect(postflight).toContain("catalog_without_name_source_defaults_acl");
    expect(postflight).toContain("pg_get_expr(procedure.proargdefaults, 0)");
    expect(postflight).toContain("procedure.oid is distinct from input_guard.routine_oid");
    expect(postflight).toContain("01000 output function catalog, source, OID, or ACL mismatch");
    expect(postflight).toContain("01000 changed a protected trigger or rule binding");
    expect(postflight).toContain("01000 agent_run producer identity changed");
    expect(postflight).toContain("01000 record-only guard table postflight mismatch");
    expect(postflight).toMatch(
      /_sf_20260822001000_output_expectations[\s\S]*?record_provider_run_phase2a_internal/i,
    );
  });

  it("does not touch claim, worker, autonomy, or automatic-action state", () => {
    expect(migration).not.toMatch(/create or replace function public\.claim_phase1c_run/i);
    expect(migration).not.toMatch(
      /(?:insert into|update|delete from)\s+public\.phase1c_workers/i,
    );
    expect(migration).not.toMatch(
      /(?:insert into|update|delete from)\s+public\.autonomy_decisions/i,
    );
    expect(migration).not.toMatch(
      /update\s+public\.(?:organizations|projects)[\s\S]{0,300}(?:autonom|auto_|kill_switch)/i,
    );
  });
});
