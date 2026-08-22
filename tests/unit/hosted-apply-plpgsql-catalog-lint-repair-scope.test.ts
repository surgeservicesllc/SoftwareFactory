// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const workflowPath = resolve(repositoryRoot, ".github/workflows/apply-hosted-migrations.yml");
const scope = "factory-any-model-record-only";
const protectedStepName =
  "Apply the exact factory any-model record-only chain (scope=factory-any-model-record-only)";

const files = {
  contract: "supabase/migrations/20260822000300_contract_bot_mutator_acls.sql",
  jobResume: "supabase/migrations/20260822000400_job_seeker_resume_extraction.sql",
  jobGrants: "supabase/migrations/20260822000500_job_seeker_extraction_grant_contract.sql",
  modelRepair: "supabase/migrations/20260822000600_route_bots_onto_the_executable_model.sql",
  clearTypes: "supabase/migrations/20260822000700_clear_surface_activity_types.sql",
  clearFunctions: "supabase/migrations/20260822000800_clear_backlog_and_pipelines.sql",
  hostedFunctionAcl:
    "supabase/migrations/20260822000850_normalize_hosted_pre_repair_function_acls.sql",
  repair: "supabase/migrations/20260822000900_repair_hosted_plpgsql_catalog_and_lint.sql",
  recordOnly: "supabase/migrations/20260822001000_factory_any_model_record_only.sql",
  functionAcl: "supabase/migrations/20260822001100_contract_resume_extraction_function_acl.sql",
  clearFunctionAcl: "supabase/migrations/20260822001200_contract_clear_function_acls.sql",
} as const;

const hashes = {
  contract: "79914bc97660eef908b6a0fa0c90abfdd15da1683b383ad568e34bf3bd32c5f7",
  jobResume: "0faa6d4174f01a43abffda463d4dbe9dc60d82be54d9207011e4c064c4f0b465",
  jobGrants: "c5709783bdaa3919e65809493345b4cfbc527121c2bf44a3a7fe98e0e7e9b1ee",
  modelRepair: "c76448dfb29a60dfcc792d00a7853bebbe97acfb2002b440f12565b93fde78f0",
  clearTypes: "184b942ef3511d1774ba6a26b9e93daf19326804d41e507ad6c48f1f6447b42b",
  clearFunctions: "e85444206c1e9c290d305e60812d47f32e9342dfd920749116ab7df143532a5a",
  hostedFunctionAcl: "8cb197e922294234035e8abfb6864bb695bd9dbef021c05464519054e2e5abce",
  repair: "64bb2754bd87bac747e7924f338bb7ed91df575845e7ff4ce6eb8a4273c0b49f",
  recordOnly: "b09a07b28ec3429e60f373b01d257c7ad16afd0767bc921f6dd645f81a6c1255",
  functionAcl: "dd4bb8ed59d5a46cea66b213fe53b0ad101da18244c161bae543999ae49af789",
  clearFunctionAcl: "ed90ededc30117434bacadebfffb47e35d39d26c0abf31725a96bc7f829bf87e",
} as const;

const lintedSignatures = [
  "public.agentos_resolved_agent_grants(uuid)",
  "public.agentos_list_agent_grants(uuid,integer)",
  "public.agentos_export_project_config(uuid,uuid)",
  "public.agentos_apply_project_config(uuid,uuid,jsonb,boolean)",
  "public.record_claim_anchoring(uuid,public.anchored_claim,uuid[])",
  "public.claim_provider_connect_session(text,text)",
  "public.normalize_bot_assignment_configuration(jsonb)",
  "public.capture_improvement_baseline(uuid)",
  "public.audit_factory_health(uuid)",
  "public.validate_pipeline_template_areas(jsonb)",
  "public.list_factory_command_routing_candidates(uuid,uuid,text)",
  "public.list_factory_commands(uuid,integer,uuid)",
  "public.submit_factory_command(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)",
  "public.submit_factory_command_routing_internal(uuid,uuid,uuid,uuid,text,public.risk_level,jsonb,text)",
  "public.submit_command(uuid,text,public.risk_level,jsonb,text)",
  "public.submit_command_phase1c_normalized_internal(uuid,text,public.risk_level,jsonb,text)",
  "public.normalize_phase1c_command()",
  "public.plan_phase1c_task_and_run()",
  "public.queue_phase1c_run_for_task()",
  "public.record_provider_run(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)",
  "public.record_provider_run_phase1c_compatibility_internal(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)",
  "public.record_provider_run_phase2a_internal(uuid,uuid,uuid,uuid,text,public.risk_level,text,text,text,text,text,text,jsonb,jsonb,text,public.run_status,text,jsonb,jsonb,jsonb,integer,text,jsonb)",
] as const;

const listFactoryCommandsCatalog = {
  signature: "public.list_factory_commands(uuid,integer,uuid)",
  source: "ba62f4f5357cec647d3ff582107710a7",
  contract: "6abaeb0d885d1335a6c4bb0029497051",
} as const;

interface WorkflowStep {
  readonly name: string;
  readonly if?: string;
  readonly run?: string;
}

interface HostedApplyWorkflow {
  readonly on: {
    readonly workflow_dispatch: {
      readonly inputs: {
        readonly scope: { readonly default: string; readonly options: readonly string[] };
      };
    };
  };
  readonly jobs: { readonly apply: { readonly steps: readonly WorkflowStep[] } };
}

const source = readFileSync(workflowPath, "utf8");
const hostedFunctionAclSource = readFileSync(
  resolve(repositoryRoot, files.hostedFunctionAcl),
  "utf8",
);
const repairSource = readFileSync(resolve(repositoryRoot, files.repair), "utf8");
const recordOnlySource = readFileSync(resolve(repositoryRoot, files.recordOnly), "utf8");
const workflow = parse(source) as HostedApplyWorkflow;
const steps = workflow.jobs.apply.steps;

function protectedStep(): WorkflowStep {
  const matches = steps.filter((step) => step.name === protectedStepName);
  expect(matches, "the workflow must contain one exact protected-chain step").toHaveLength(1);
  return matches[0]!;
}

function canRunForProtectedScope(step: WorkflowStep): boolean {
  const guard = step.if ?? "";
  if (/\bfalse\b/.test(guard)) return false;
  const exclusions = [...guard.matchAll(/inputs\.scope\s*!=\s*'([^']+)'/g)]
    .map((match) => match[1]);
  if (exclusions.includes(scope)) return false;
  const inclusions = [...guard.matchAll(/inputs\.scope\s*==\s*'([^']+)'/g)]
    .map((match) => match[1]);
  return inclusions.length === 0 || inclusions.includes(scope);
}

function writesHostedMigrationState(step: WorkflowStep): boolean {
  const command = step.run ?? "";
  return /\bsupabase\s+migration\s+repair\b/.test(command)
    || /\bsupabase(?:@\S+)?\s+(?:db\s+push|migration\s+up)\b/.test(command)
    || /\bpsql\b[\s\S]*?(?:^|\s)-f(?:\s|$)/m.test(command);
}

describe("the protected factory any-model record-only chain", () => {
  it("is one protected choice and cannot reach shared or broad mutation", () => {
    expect(workflow.on.workflow_dispatch.inputs.scope.options.filter(
      (value) => value === scope,
    )).toEqual([scope]);
    expect(workflow.on.workflow_dispatch.inputs.scope.default).toBe("probe");
    expect(protectedStep().if).toBe("${{ inputs.scope == 'factory-any-model-record-only' }}");

    const reachableWrites = steps.filter(canRunForProtectedScope)
      .filter(writesHostedMigrationState).map((step) => step.name);
    expect(reachableWrites).toEqual([protectedStepName]);
  });

  it("pins immutable prerequisites and the six-file protected chain", () => {
    const command = protectedStep().run ?? "";
    const referenced = command.match(/supabase\/migrations\/[A-Za-z0-9_.-]+\.sql/g) ?? [];
    expect(referenced).toEqual(Object.values(files));
    for (const hash of Object.values(hashes)) expect(command).toContain(hash);
    for (const variable of [
      "CONTRACT_FILE", "JOB_RESUME_FILE", "JOB_GRANTS_FILE", "MODEL_REPAIR_FILE", "CLEAR_TYPES_FILE",
      "CLEAR_FUNCTIONS_FILE", "HOSTED_FUNCTION_ACL_FILE", "REPAIR_FILE", "RECORD_ONLY_FILE", "FUNCTION_ACL_FILE",
      "CLEAR_FUNCTION_ACL_FILE",
    ]) {
      expect(command).toContain(`tr -d '\\r' < "$${variable}" | sha256sum`);
    }
    expect(source).not.toContain("20260822000400_repair_hosted_plpgsql_catalog_and_lint.sql");
    expect(source).not.toContain("plpgsql-catalog-lint-repair");
    expect(command).not.toMatch(/\bsupabase(?:@\S+)?\s+(?:db\s+push|migration\s+up)\b/);
    expect(command).not.toMatch(/\bmigration\s+repair\b|\bdb\s+reset\b|\bdown\b/i);
  });

  it("keeps cross-statement repair guards alive in psql autocommit and cleans them", () => {
    for (const table of [
      "_sf_20260822000900_foundation_state",
      "_sf_20260822000900_function_guard",
    ]) {
      expect(repairSource).toMatch(
        new RegExp(`create temporary table ${table} \\([\\s\\S]*?\\) on commit preserve rows;`),
      );
      expect(repairSource).toContain(`drop table pg_temp.${table};`);
    }
    for (const helper of [
      "_sf_20260822000900_replace_source(text, text, text, integer)",
      "_sf_20260822000900_validate_foundation()",
    ]) {
      expect(repairSource).toContain(`drop function pg_temp.${helper};`);
    }
    expect(repairSource.lastIndexOf("drop table pg_temp.")).toBeGreaterThan(
      repairSource.lastIndexOf("$postflight$;"),
    );
  });

  it("normalizes only the measured hosted ACL cohort and preserves the legacy claim contract", () => {
    for (const signature of [
      "public.claim_provider_connect_session(text,text)",
      "public.normalize_bot_assignment_configuration(jsonb)",
      "public.record_claim_anchoring(uuid,public.anchored_claim,uuid[])",
      "public.validate_pipeline_template_areas(jsonb)",
    ]) {
      expect(hostedFunctionAclSource).toContain(signature);
    }
    for (const identity of [
      "9961e16bbe95da08903caac340633bca",
      "3b2b93799687f2d2de6b154376542759",
      "a7ca5a02b1faa50ebba452c4a4f46195",
    ]) {
      expect(hostedFunctionAclSource).toContain(identity);
      expect(repairSource).toContain(identity);
    }
    expect(hostedFunctionAclSource).toContain("array_agg(oid order by signature)");
    expect(hostedFunctionAclSource).toContain("v_after_oids is distinct from v_before_oids");
    expect(hostedFunctionAclSource).not.toMatch(/\b(?:create|drop)\s+(?:or\s+replace\s+)?function\s+public\./i);
  });

  it("keeps every record-only guard alive in psql autocommit and cleans it", () => {
    for (const table of [
      "_sf_20260822001000_input_expectations",
      "_sf_20260822001000_function_guard",
      "_sf_20260822001000_trigger_guard",
      "_sf_20260822001000_trigger_expectations",
      "_sf_20260822001000_agent_runs_guard",
      "_sf_20260822001000_output_expectations",
    ]) {
      expect(recordOnlySource).toMatch(
        new RegExp(`create temporary table ${table} \\([\\s\\S]*?\\) on commit preserve rows;`),
      );
      expect(recordOnlySource).toContain(`drop table pg_temp.${table};`);
    }
    expect(recordOnlySource.lastIndexOf("drop table pg_temp.")).toBeGreaterThan(
      recordOnlySource.lastIndexOf("$postflight$;"),
    );
  });

  it("requires exact history and applies 00300 -> 00850 -> 00900 -> 01000 -> 01100 -> 01200 atomically", () => {
    const command = protectedStep().run ?? "";
    expect(command).toContain('if [ "$HISTORY" != "1|1|0|1|1|1|1|1|0|0|0|0|0" ]');
    for (const version of [
      "20260822000150", "20260822000200", "20260822000300", "20260822000400",
      "20260822000500", "20260822000600", "20260822000700", "20260822000800",
      "20260822000850", "20260822000900", "20260822001000", "20260822001100",
      "20260822001200",
    ]) {
      expect(command).toContain(version);
    }
    expect(command).toContain("PRECONTRACT_READY=");
    expect(command).toContain("JOB_SEEKER_READY=");

    const rehearsal = command.indexOf("LINT_FINDINGS=");
    const begin = command.indexOf('-c "begin;"', rehearsal);
    const rehearsalContract = command.indexOf('-f "$CONTRACT_FILE"', begin);
    const rehearsalHostedFunctionAcl = command.indexOf('-f "$HOSTED_FUNCTION_ACL_FILE"', rehearsalContract);
    const rehearsalRepair = command.indexOf('-f "$REPAIR_FILE"', rehearsalHostedFunctionAcl);
    const rehearsalRecordOnly = command.indexOf('-f "$RECORD_ONLY_FILE"', rehearsalRepair);
    const rehearsalFunctionAcl = command.indexOf('-f "$FUNCTION_ACL_FILE"', rehearsalRecordOnly);
    const rehearsalClearFunctionAcl = command.indexOf('-f "$CLEAR_FUNCTION_ACL_FILE"', rehearsalFunctionAcl);
    const rollback = command.indexOf('-c "rollback;"', rehearsalClearFunctionAcl);
    const actual = command.indexOf("--single-transaction", rollback);
    const actualContract = command.indexOf('-f "$CONTRACT_FILE"', actual);
    const actualHostedFunctionAcl = command.indexOf('-f "$HOSTED_FUNCTION_ACL_FILE"', actualContract);
    const actualRepair = command.indexOf('-f "$REPAIR_FILE"', actualHostedFunctionAcl);
    const actualRecordOnly = command.indexOf('-f "$RECORD_ONLY_FILE"', actualRepair);
    const actualFunctionAcl = command.indexOf('-f "$FUNCTION_ACL_FILE"', actualRecordOnly);
    const actualClearFunctionAcl = command.indexOf('-f "$CLEAR_FUNCTION_ACL_FILE"', actualFunctionAcl);
    const ledger = command.indexOf("('20260822000300'), ('20260822000850'), ('20260822000900'), ('20260822001000'), ('20260822001100'), ('20260822001200')", actualClearFunctionAcl);

    expect(begin).toBeGreaterThan(rehearsal);
    expect(rehearsalContract).toBeGreaterThan(begin);
    expect(rehearsalHostedFunctionAcl).toBeGreaterThan(rehearsalContract);
    expect(rehearsalRepair).toBeGreaterThan(rehearsalHostedFunctionAcl);
    expect(rehearsalRecordOnly).toBeGreaterThan(rehearsalRepair);
    expect(rehearsalFunctionAcl).toBeGreaterThan(rehearsalRecordOnly);
    expect(rehearsalClearFunctionAcl).toBeGreaterThan(rehearsalFunctionAcl);
    expect(rollback).toBeGreaterThan(rehearsalClearFunctionAcl);
    expect(actual).toBeGreaterThan(rollback);
    expect(actualContract).toBeGreaterThan(actual);
    expect(actualHostedFunctionAcl).toBeGreaterThan(actualContract);
    expect(actualRepair).toBeGreaterThan(actualHostedFunctionAcl);
    expect(actualRecordOnly).toBeGreaterThan(actualRepair);
    expect(actualFunctionAcl).toBeGreaterThan(actualRecordOnly);
    expect(actualClearFunctionAcl).toBeGreaterThan(actualFunctionAcl);
    expect(ledger).toBeGreaterThan(actualClearFunctionAcl);
    for (const variable of [
      "CONTRACT_FILE", "HOSTED_FUNCTION_ACL_FILE", "REPAIR_FILE", "RECORD_ONLY_FILE", "FUNCTION_ACL_FILE",
      "CLEAR_FUNCTION_ACL_FILE",
    ]) {
      expect(command.match(new RegExp(`\\s-f\\s+"\\$${variable}"`, "g"))).toHaveLength(2);
    }
    expect(command).toContain('if [ "$RECORDED" != "1|1|1|1|1|1" ]');
    expect(command).toContain("function_catalog_ready input");
    expect(command).toContain("job_seeker_ready pre");
    expect(command).toContain("job_seeker_ready post");
    expect(command).toContain("clear_controls_ready pre");
    expect(command).toContain("clear_controls_ready post");
    expect(command).toContain("RECORD_ONLY_READY=");
    expect(command).toContain("RECORD_ONLY_BOUNDARY=");
    expect(command).toContain("count(oid) = 12 and count(distinct oid) = 12");
    expect(command).toContain("public.factory_record_only_submission_guards");
    expect(command).toContain("command.parameters ->> 'executionMode' = 'record_only'");
    expect(command).toContain("count(*) = 20 from pg_trigger");
  });

  it("pins pre-CONTRACT legacy plus immutable job-seeker, executable-model, and clear-controls state", () => {
    const command = protectedStep().run ?? "";
    expect(command).toContain("count(oid) = 6");
    expect(command).toContain("count(*) = 6");
    expect(command).toContain("(select count(*) from aclexplode(proacl)) = 2");
    expect(command).toContain("has_function_privilege('authenticated', signature, 'EXECUTE')");
    for (const hash of [
      "a281e579ace481a0dac93f4a81111f01", "a9be04ba92b6f3d989054059e572e002",
      "3fe31b5b7a33afe12df73da7990267df", "2bc4b362facbea54d3fd0b67c2545682",
      "f0b1bd6c32a55077dd010d420cd324ab",
    ]) expect(command).toContain(hash);
    expect(command).toContain("count(*) = 14 from pg_constraint");
    expect(command).toContain("not has_any_column_privilege('service_role'");
    expect(command).toContain("apply_resume_extraction(uuid,text[])");
    expect(command).toContain(hashes.modelRepair);
    expect(command).toContain(files.modelRepair);
    expect(command).toContain("clear_controls_ready() {");
    expect(command).toContain("CLEAR_CONTROLS_READY=");
    expect(command).toContain("case when '$1' = 'pre' then 3 else 2 end");
    expect(command).toContain("has_function_privilege('service_role', signature, 'EXECUTE') is not distinct from ('$1' = 'pre')");
    expect(command).toContain("array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)");
    for (const hash of [
      "bec3779775db79ea9150725a9e5d087f", "cd91f464350f968f5b11a52f10d127bd",
      "dcb23b5217f03e5f74da437fe0c3393f", "295424372a8549485dcc9f7b66dfe025",
    ]) expect(command).toContain(hash);
    expect(command).toContain("task.backlog_cleared");
    expect(command).toContain("command.pipelines_cleared");
  });

  it("lints restored and every touched public/private record-only function before commit", () => {
    const command = protectedStep().run ?? "";
    for (const signature of lintedSignatures) expect(command).toContain(signature);
    for (const identity of Object.values(listFactoryCommandsCatalog)) {
      expect(command).toContain(identity);
    }
    const lint = command.indexOf("LINT_FINDINGS=");
    const create = command.indexOf("create extension if not exists plpgsql_check with schema extensions;", lint);
    const check = command.indexOf("extensions.plpgsql_check_function_tb(", create);
    const rollback = command.indexOf("rollback;", check);
    expect(command.slice(check, rollback)).toContain("false, true, true, false, false, false");
    expect(command.slice(check, rollback)).toContain("finding.level in ('error', 'warning', 'extra')");
    // plpgsql_check raises "missing trigger relation" for a trigger function
    // linted without a relation, so the three trigger rows must carry the
    // relation 01000 pins in trigger_expectations and all others stay null.
    expect(command.slice(check, rollback)).toContain(
      "coalesce(expected.trigger_relation::regclass, 0::regclass)"
    );
    expect(command).toContain("('public.normalize_phase1c_command()', 'public.commands')");
    expect(command).toContain("('public.plan_phase1c_task_and_run()', 'public.tasks')");
    expect(command).toContain("('public.queue_phase1c_run_for_task()', 'public.tasks')");
    expect(command).not.toContain("()', null)");
    expect(command).toContain('if [ -n "$LINT_FINDINGS" ]');
    expect(command).toContain('if [ "$EXTENSION_RESIDUE" != "0|0" ]');
    expect(command).not.toMatch(/drop\s+extension/i);
  });

  it("requires exact main, green CI, and READY Vercel production identity", () => {
    const releaseGate = steps.find((step) =>
      step.name === "Verify exact green application release before protected database preflight"
    );
    expect(releaseGate?.if).toContain("inputs.scope == 'factory-any-model-record-only'");
    const command = releaseGate?.run ?? "";
    expect(command).toContain('GH_REPOSITORY" != "surgeservicesllc/SoftwareFactory');
    expect(command).toContain('GH_REF" != "refs/heads/main');
    expect(command).toContain('GITHUB_SHA" != "$CHECKED_OUT_SHA');
    expect(command).toContain("/commits/${CHECKED_OUT_SHA}/check-runs?per_page=100");
    expect(command).toContain("Lint, typecheck, test, and build");
    expect(command).toContain("Browser and accessibility tests 1/3");
    expect(command).toContain("Browser and accessibility tests 2/3");
    expect(command).toContain("Browser and accessibility tests 3/3");
    expect(command).toContain('LATEST_CHECK_STATE" != "completed|success"');
    expect(command).toContain('.environment == "Production"');
    expect(command).toContain('.creator.login == "vercel[bot]"');
    expect(command).toContain('.[0].state == "success"');
    expect(command).toContain("softwarefactory-[a-z0-9]+-surgeservices-projects");
  });

  it("proves exact tenants, safety state, immutable audit, and disconnected workers twice", () => {
    const command = protectedStep().run ?? "";
    const calls = [...command.matchAll(/^\s*assert_containment\s*$/gm)];
    const actual = command.indexOf("--single-transaction");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.index).toBeLessThan(actual);
    expect(calls[1]!.index).toBeGreaterThan(actual);
    for (const id of [
      "2614f3b2-ac24-4353-bda6-320a8c254d3b", "b1f23696-437e-4d89-b55f-d7a949980e8f",
      "96be00cc-6bf9-42a3-9931-97f9595bda0b", "bd90348c-41f4-487c-9681-6b4a4ca911e4",
      "f8de941d-dc9e-4c66-9d3a-00cd61c2d794", "34afd05b-6550-41ae-a397-913b9f44966a",
    ]) expect(command).toContain(id);
    expect(command).toContain("count(*) = 4 from target_projects");
    expect(command).toContain("count(distinct organization_id) = 2");
    expect(command).toContain("autonomy_kill_switch_active is true");
    expect(command).toContain("executor_connected is false");
    expect(command).toContain("worker.last_heartbeat_at > now() + interval '1 minute'");
    expect(command).toContain("worker.last_heartbeat_at > now() - interval '10 minutes'");
    expect(command).toContain("worker.current_run_id is not null");
    expect(command).not.toContain("worker.status = 'active'");
    expect(command).not.toContain("worker.status = 'draining'");
    expect(command).toContain("autonomy.kill_switch_changed");
    expect(command).toContain("activity_events_append_only");
    expect(command).toContain("reject_activity_event_mutation()");
    expect(command).toContain("not has_table_privilege('service_role', relation.oid, 'UPDATE,DELETE,TRUNCATE')");
  });

  it("preserves origin job/model/clear scopes and blocks broad push through exact 01200 state", () => {
    const resume = steps.find((step) =>
      step.name === "Apply the job-seeker resume extraction migration (scope=job-seeker-resume)"
    );
    const grants = steps.find((step) =>
      step.name === "Contract the resume extraction table's grants (scope=job-seeker-grant-contract)"
    );
    expect(resume?.run).toContain(files.jobResume);
    expect(resume?.run).toContain(hashes.jobResume);
    expect(grants?.run).toContain(files.jobGrants);
    expect(grants?.run).toContain(hashes.jobGrants);
    const model = steps.find((step) =>
      step.name === "Repair bots onto the executable model (scope=executable-model-repair)"
    );
    expect(model?.run).toContain(files.modelRepair);
    expect(model?.run).toContain(hashes.modelRepair);
    const clear = steps.find((step) =>
      step.name === "Apply the Backlog and Pipelines clear controls (scope=clear-controls)"
    );
    expect(clear?.run).toContain(files.clearTypes);
    expect(clear?.run).toContain(hashes.clearTypes);
    expect(clear?.run).toContain(files.clearFunctions);
    expect(clear?.run).toContain(hashes.clearFunctions);

    const broad = steps.find((step) => step.name === "Push the outstanding migrations (scope=all)");
    const command = broad?.run ?? "";
    for (const variable of [
      "PROTECTED_NORMALIZER", "PROTECTED_EXPAND", "PROTECTED_CONTRACT",
      "PROTECTED_EXECUTABLE_MODEL", "PROTECTED_HOSTED_FUNCTION_ACL", "PROTECTED_REPAIR", "PROTECTED_RECORD_ONLY",
      "PROTECTED_RESUME_FUNCTION_ACL", "PROTECTED_CLEAR_FUNCTION_ACL",
    ]) expect(command).toContain(`if [ "$${variable}"`);
    expect(command).toContain('if [ "$PROTECTED_JOB_RESUME" != "1" ] || [ "$PROTECTED_JOB_GRANTS" != "1" ]');
    expect(command).toContain('if [ "$PROTECTED_CLEAR_TYPES" != "1" ] || [ "$PROTECTED_CLEAR_FUNCTIONS" != "1" ]');
    expect(command).toContain("version = '20260822000850'");
    expect(command).toContain("version = '20260822000900'");
    expect(command).toContain("version = '20260822001000'");
    expect(command).toContain("version = '20260822001100'");
    expect(command).toContain("version = '20260822001200'");
    const resumeAclLedgerGate = command.indexOf('if [ "$PROTECTED_RESUME_FUNCTION_ACL" != "1" ]');
    const resumeAclCatalogGate = command.indexOf("PROTECTED_RESUME_FUNCTION_ACL_READY=", resumeAclLedgerGate);
    expect(resumeAclLedgerGate).toBeGreaterThanOrEqual(0);
    expect(resumeAclCatalogGate).toBeGreaterThan(resumeAclLedgerGate);
    expect(command).toContain('if [ "$PROTECTED_RESUME_FUNCTION_ACL_READY" != "t" ]');
    expect(command.slice(resumeAclCatalogGate)).toContain("not has_function_privilege('service_role', oid, 'EXECUTE')");
    const clearAclLedgerGate = command.indexOf('if [ "$PROTECTED_CLEAR_FUNCTION_ACL" != "1" ]');
    expect(clearAclLedgerGate).toBeGreaterThan(resumeAclLedgerGate);
    expect(command).toContain("PROTECTED_CLEAR_CATALOG_READY=");
    expect(command).toContain("protected_repair_function_catalog_ready()");
    expect(command).toContain("protected_repair_function_catalog_ready post");
    expect(command).toContain("PROTECTED_FOUNDATION_READY=");
    expect(command).toContain("PROTECTED_RECORD_ONLY_READY=");
    expect(command).toContain("scope=factory-any-model-record-only");
    expect(command.search(/\bsupabase\s+db\s+push\b/)).toBeGreaterThan(
      clearAclLedgerGate,
    );
  });
});
