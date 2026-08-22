// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260821000400_command_factory_routing.sql",
);

describe("command factory routing migration contract", () => {
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

  it("adds one immutable, tenant/project-scoped route per command", () => {
    expect(migration).toMatch(/create table public\.factory_command_routes\s*\(/i);
    expect(migration).toMatch(
      /foreign key \(command_id, project_id, organization_id\)[\s\S]*references public\.commands \(id, project_id, organization_id\) on delete restrict/i,
    );
    expect(migration).toMatch(
      /constraint factory_command_routes_one_route_per_command unique \(command_id\)/i,
    );
    expect(migration).toMatch(/check \(jsonb_typeof\(routing_snapshot\) = 'object'\)/i);
    expect(migration).toMatch(/check \(not public\.jsonb_has_sensitive_keys\(routing_snapshot\)\)/i);
  });

  it("keeps route history independent of mutable selections and roster rows", () => {
    const tableDefinition = migration.match(
      /create table public\.factory_command_routes \(([\s\S]*?)\n\);/i,
    )?.[1] ?? "";
    expect(tableDefinition).not.toMatch(/references public\.project_pipelines/i);
    expect(tableDefinition).not.toMatch(/references public\.bot_assignments/i);
    expect(tableDefinition).not.toMatch(/references public\.bots/i);
    expect(tableDefinition).not.toMatch(/references public\.bot_roles/i);
    expect(tableDefinition).not.toMatch(/references public\.graph_templates/i);
  });

  it("forces RLS, removes table ACLs, and rejects update or delete", () => {
    expect(migration).toMatch(/alter table public\.factory_command_routes enable row level security/i);
    expect(migration).toMatch(/alter table public\.factory_command_routes force row level security/i);
    expect(migration).toMatch(
      /revoke all on table public\.factory_command_routes\s+from public, anon, authenticated, service_role/i,
    );
    expect(migration).toMatch(
      /create trigger factory_command_routes_immutable\s+before update or delete/i,
    );
    expect(migration).toMatch(/factory command routing evidence is immutable/i);
  });

  it("exposes only bounded authenticated definer RPCs with pinned search paths", () => {
    for (const name of [
      "list_factory_command_routing_candidates",
      "submit_factory_command",
      "resolve_factory_command_replay",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `create or replace function public\\.${name}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = pg_catalog`,
          "i",
        ),
      );
      expect(migration).toMatch(
        new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to authenticated`, "i"),
      );
    }
  });

  it("revalidates every server-only gate before delegating to submit_command", () => {
    const submitBody = functionDefinition("submit_factory_command");
    const delegatedAt = submitBody.indexOf("from public.submit_command(");
    expect(delegatedAt).toBeGreaterThan(0);
    for (const gate of [
      "selected bot assignment is not configured",
      "selected bot assignment cannot write the repository",
      "selected bot assignment cannot open pull requests",
      "selected bot assignment cannot run this pipeline",
      "selected bot does not match command execution provider and model",
      "selected bot is not ready",
    ]) {
      const gateAt = submitBody.indexOf(gate);
      expect(gateAt, gate).toBeGreaterThan(0);
      expect(gateAt, gate).toBeLessThan(delegatedAt);
    }
    expect(submitBody).toMatch(/from public\.bot_assignments assignment[\s\S]*for update/i);
    for (const mutableSource of ["bots bot", "bot_roles role_definition", "ai_accounts account", "graph_templates template"]) {
      expect(submitBody).toMatch(
        new RegExp(`from public\\.${mutableSource}[\\s\\S]*?for update`, "i"),
      );
    }
    expect(submitBody).toMatch(/v_assignment\.model is null/i);
    expect(submitBody).toMatch(/v_assignment\.work_effort = 'medium'/i);
    expect(submitBody).toMatch(
      /pg_catalog\.btrim\(coalesce\(v_assignment\.instructions, ''\)\) = ''/i,
    );
    expect(submitBody).toMatch(
      /v_bot\.ai_account_id is not null[\s\S]*coalesce\(v_account_status, ''\) <> 'connected'/i,
    );
  });

  it("gates the role against submit_command's persisted effective risk", () => {
    const submitBody = functionDefinition("submit_factory_command");
    const delegatedAt = submitBody.indexOf("from public.submit_command(");
    const persistedRiskAt = submitBody.indexOf(
      "select command.requested_risk into v_effective_risk",
    );
    const snapshotRiskAt = submitBody.indexOf("'effectiveRisk', v_effective_risk::text");
    const replayAt = submitBody.indexOf("if v_existing_route.organization_id");
    const legacyAt = submitBody.indexOf("if not v_submission.was_created::boolean then");
    const riskGateAt = submitBody.indexOf("if v_role.risk_ceiling < v_effective_risk then");
    const capacityAt = submitBody.indexOf(
      "if v_in_flight >= v_assignment.max_concurrent_tasks",
    );

    expect(persistedRiskAt).toBeGreaterThan(delegatedAt);
    expect(snapshotRiskAt).toBeGreaterThan(persistedRiskAt);
    expect(replayAt).toBeGreaterThan(snapshotRiskAt);
    expect(legacyAt).toBeGreaterThan(replayAt);
    expect(riskGateAt).toBeGreaterThan(legacyAt);
    expect(capacityAt).toBeGreaterThan(riskGateAt);
    expect(submitBody).not.toMatch(
      /v_role\.risk_ceiling\s*<\s*coalesce\(p_requested_risk/i,
    );
  });

  it("resolves exact replays without consulting mutable routing or base state", () => {
    const replayBody = functionDefinition("resolve_factory_command_replay");

    expect(replayBody).toMatch(
      /returns table \([\s\S]*command_id uuid,[\s\S]*routing_snapshot jsonb,\s+command_parameters jsonb,\s+repository_full_name text\s*\)/i,
    );
    expect(replayBody).toMatch(/public\.is_organization_owner\(p_organization_id\)/i);
    expect(replayBody).toMatch(/command\.submitted_by = v_caller/i);
    expect(replayBody).toMatch(/command\.idempotency_key = v_idempotency_key/i);
    expect(replayBody).toMatch(/if not found then\s+return;/i);
    expect(replayBody).toMatch(
      /v_command\.parameters #>> '\{riskAssessment,requestedRisk\}'[\s\S]*p_requested_risk::text/i,
    );
    expect(replayBody).toMatch(
      /v_route\.pipeline_template_key <> v_pipeline_template_key/i,
    );
    expect(replayBody).toContain(
      "idempotency key was already used for a different factory command intent",
    );
    expect(replayBody).toContain("idempotent command predates factory routing evidence");
    expect(replayBody).toMatch(/pg_catalog\.left\(repository\.full_name, 201\)/i);
    expect(replayBody).not.toMatch(/from public\.bot_assignments/i);
    expect(replayBody).not.toMatch(/from public\.bots/i);
    expect(replayBody).not.toMatch(/from public\.project_pipelines/i);
    expect(replayBody).not.toMatch(/max_concurrent_tasks|base_sha|default_branch/i);
  });

  it("returns both the resolved execution model and the raw posting override", () => {
    expect(migration).toMatch(
      /provider public\.bot_provider,\s+model text,\s+assignment_model text,\s+work_effort text/i,
    );
    expect(migration).toMatch(
      /coalesce\(assignment\.model, bot\.model\),\s+assignment\.model,\s+assignment\.work_effort/i,
    );
  });

  it("treats null and whitespace-only instructions as the same default", () => {
    expect(migration.match(
      /pg_catalog\.btrim\(coalesce\((?:assignment|v_assignment)\.instructions, ''\)\) = ''/gi,
    )).toHaveLength(2);
    expect(migration).not.toMatch(/(?:assignment|v_assignment)\.instructions is null/i);
  });

  it("verifies an existing immutable route before applying capacity to a new one", () => {
    const replayAt = migration.indexOf("if v_existing_route.organization_id");
    const capacityAt = migration.indexOf("if v_in_flight >= v_assignment.max_concurrent_tasks");
    expect(replayAt).toBeGreaterThan(0);
    expect(capacityAt).toBeGreaterThan(replayAt);
    expect(migration).toContain("idempotent factory command routing evidence conflicts");
    expect(migration).toMatch(
      /if not v_submission\.was_created::boolean then[\s\S]*idempotent command predates factory routing evidence/i,
    );
  });

  it("does not touch a worker or change autonomy controls", () => {
    expect(migration).not.toMatch(
      /(?:insert into|update|delete from)\s+public\.(?:phase1c_workers|autonomy_decisions)/i,
    );
    expect(migration).not.toMatch(
      /update\s+public\.(?:organizations|projects)[\s\S]{0,300}(?:autonom|auto_|kill_switch)/i,
    );
    expect(migration).not.toMatch(/public\.claim_phase1c_run\s*\(/i);
  });
});
