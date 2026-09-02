// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { withGuardFiles } from "../support/hosted-apply-guards";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const workflowPath = resolve(
  repositoryRoot,
  ".github/workflows/apply-hosted-migrations.yml",
);
const migrationRelativePath =
  "supabase/migrations/20260822000300_contract_bot_mutator_acls.sql";
const migrationPath = resolve(repositoryRoot, migrationRelativePath);
const retiredScope = "bot-account-binding-contract";
const protectedScope = "factory-any-model-record-only";
const frozenSha256 =
  "79914bc97660eef908b6a0fa0c90abfdd15da1683b383ad568e34bf3bd32c5f7";
const protectedStepName =
  "Apply the exact factory any-model record-only chain (scope=factory-any-model-record-only)";

interface WorkflowStep {
  readonly env?: Readonly<Record<string, string>>;
  readonly name: string;
  readonly if?: string;
  readonly run?: string;
}

interface HostedApplyWorkflow {
  readonly permissions: Readonly<Record<string, string>>;
  readonly on: {
    readonly workflow_dispatch: {
      readonly inputs: Readonly<Record<string, {
        readonly default?: string;
        readonly description?: string;
        readonly options?: readonly string[];
      }>>;
    };
  };
  readonly jobs: {
    readonly apply: { readonly steps: readonly WorkflowStep[] };
  };
}

const source = readFileSync(workflowPath, "utf8");
const workflow = parse(source) as HostedApplyWorkflow;
const steps = workflow.jobs.apply.steps;

function stepByName(name: string): WorkflowStep {
  const matches = steps.filter((step) => step.name === name);
  expect(matches, `the workflow must contain exactly one ${name} step`).toHaveLength(1);
  return matches[0]!;
}

function protectedStep(): WorkflowStep {
  return stepByName(protectedStepName);
}

function canRunForRetiredScope(step: WorkflowStep): boolean {
  const guard = step.if ?? "";
  if (/\bfalse\b/.test(guard)) return false;
  const exclusions = [...guard.matchAll(/inputs\.scope\s*!=\s*'([^']+)'/g)]
    .map((match) => match[1]);
  if (exclusions.includes(retiredScope)) return false;
  const inclusions = [...guard.matchAll(/inputs\.scope\s*==\s*'([^']+)'/g)]
    .map((match) => match[1]);
  return inclusions.length === 0 || inclusions.includes(retiredScope);
}

function writesMigrationState(step: WorkflowStep): boolean {
  const command = step.run ?? "";
  return /\bsupabase\s+migration\s+repair\b/.test(command)
    || /\bsupabase(?:@\S+)?\s+(?:db\s+push|migration\s+up)\b/.test(command)
    || /\bpsql\b[\s\S]*?(?:^|\s)-f(?:\s|$)/m.test(command);
}

describe("the hosted bot mutator CONTRACT release path", () => {
  it("retires the standalone scope before connection and makes its old mutator unreachable", () => {
    const options = workflow.on.workflow_dispatch.inputs.scope?.options ?? [];
    expect(options).not.toContain(retiredScope);
    expect(options.filter((value) => value === protectedScope)).toEqual([protectedScope]);

    const checkoutIndex = steps.findIndex((step) => step.name === "Check out the migrations");
    const refusalIndex = steps.findIndex((step) =>
      step.name === "Refuse the retired standalone bot mutator CONTRACT scope"
    );
    const connectionIndex = steps.findIndex((step) => step.name === "Choose the connection");
    const refusal = steps[refusalIndex];
    const retiredMutator = stepByName(
      "Apply the exact bot mutator CONTRACT (scope=bot-account-binding-contract)",
    );

    expect(refusalIndex).toBeGreaterThan(checkoutIndex);
    expect(connectionIndex).toBeGreaterThan(refusalIndex);
    expect(refusal?.if).toBe("${{ inputs.scope == 'bot-account-binding-contract' }}");
    expect(refusal?.run).toContain("scope=factory-any-model-record-only");
    expect(refusal?.run).toMatch(/exit 1\s*$/);
    expect(retiredMutator.if).toBe(
      "${{ false && inputs.scope == 'bot-account-binding-contract' }}",
    );

    const reachableWrites = steps.filter(canRunForRetiredScope)
      .filter(writesMigrationState).map((step) => step.name);
    expect(reachableWrites).toEqual([]);
  });

  it("pins CONTRACT only inside the exact atomic protected chain", () => {
    const command = protectedStep().run ?? "";
    const actual = createHash("sha256")
      .update(readFileSync(migrationPath))
      .digest("hex");

    expect(actual).toBe(frozenSha256);
    expect(command).toContain(`CONTRACT_FILE=${migrationRelativePath}`);
    expect(command).toContain(`CONTRACT_SHA256=${frozenSha256}`);
    expect(command.match(/\s-f\s+"\$CONTRACT_FILE"/g)).toHaveLength(2);
    expect(command).toContain(
      "('20260822000300'), ('20260822000850'), ('20260822000900'), ('20260822001000'), ('20260822001100'), ('20260822001200')",
    );
    expect(command).not.toMatch(/\bsupabase(?:@\S+)?\s+(?:db\s+push|migration\s+up)\b/);
  });

  it("machine-gates exact green CI and Vercel release before every database-capable step", () => {
    const releaseGateIndex = steps.findIndex((step) =>
      step.name === "Verify exact green application release before protected database preflight"
    );
    const firstDatabaseIndex = steps.findIndex((step) =>
      /\b(?:psql|supabase(?:@\S+)?\s+(?:link|migration|db))\b/.test(step.run ?? "")
    );
    const releaseGate = steps[releaseGateIndex];
    const command = releaseGate?.run ?? "";

    expect(releaseGateIndex).toBeGreaterThanOrEqual(0);
    expect(firstDatabaseIndex).toBeGreaterThan(releaseGateIndex);
    expect(releaseGate?.if).toBe(
      "${{ inputs.scope == 'factory-any-model-record-only' }}",
    );
    expect(releaseGate?.env).toEqual({
      GH_REF: "${{ github.ref }}",
      GH_REPOSITORY: "${{ github.repository }}",
      GH_API_URL: "${{ github.api_url }}",
      GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    });
    expect(workflow.permissions).toEqual({
      actions: "read",
      checks: "read",
      contents: "read",
      deployments: "read",
    });
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual(["scope"]);
    expect(source).not.toMatch(/inputs\.(?:confirm|contract_)/);
    expect(source).not.toContain(["exact", "app", "vercel", "accepted"].join("-"));
    expect(command).toContain("CHECKED_OUT_SHA=$(git rev-parse HEAD)");
    expect(command).toContain('[ "$GH_REF" != "refs/heads/main" ]');
    expect(command).toContain("/commits/${CHECKED_OUT_SHA}/check-runs?per_page=100");
    for (const check of [
      "Lint, typecheck, test, and build",
      "Browser and accessibility tests 1/3",
      "Browser and accessibility tests 2/3",
      "Browser and accessibility tests 3/3",
    ]) expect(command).toContain(check);
    expect(command).toContain('.app.slug == "github-actions"');
    expect(command).toContain('LATEST_CHECK_STATE" != "completed|success"');
    expect(command).toContain("/deployments?environment=Production&per_page=100");
    expect(command).toContain("LATEST_VERCEL_DEPLOYMENT=");
    expect(command).toContain(".sha == $sha and .ref == $sha");
    expect(command).toContain('.creator.login == "vercel[bot]"');
    expect(command).toContain('.[0].state == "success"');
    expect(command).toContain(".vercel\\\\.app");
  });

  it("requires EXPAND once and CONTRACT absent before the atomic transaction", () => {
    const command = protectedStep().run ?? "";
    const history = command.indexOf("HISTORY=");
    const precontract = command.indexOf("PRECONTRACT_READY=", history);
    const transaction = command.indexOf("--single-transaction", precontract);

    expect(history).toBeGreaterThanOrEqual(0);
    expect(command).toContain('if [ "$HISTORY" != "1|1|0|1|1|1|1|1|0|0|0|0|0" ]');
    expect(precontract).toBeGreaterThan(history);
    expect(command.slice(precontract, transaction)).toContain("count(oid) = 6");
    expect(command.slice(precontract, transaction)).toContain("aclexplode(proacl)");
    expect(transaction).toBeGreaterThan(precontract);
  });

  it("preserves CONTRACT identity and closes the six legacy mutator ACLs", () => {
    const command = protectedStep().run ?? "";
    const migration = readFileSync(migrationPath, "utf8");

    for (const signature of [
      "public.assign_bot(uuid,uuid,uuid,uuid)",
      "public.assign_bots_to_project(uuid,uuid,jsonb)",
      "public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)",
      "public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)",
      "public.set_bot_assignment_execution(uuid,uuid,text,text)",
      "public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)",
    ]) expect(command).toContain(signature);

    const aclStatements = [...migration.matchAll(/execute '([^']+)'/g)]
      .map((match) => match[1]);
    expect(aclStatements).toHaveLength(6);
    expect(aclStatements.every((statement) => statement.endsWith(
      "from public, anon, authenticated, service_role",
    ))).toBe(true);
    expect(migration).toContain("legacy bot mutator CONTRACT verification failed");
  });

  it("makes broad push prove CONTRACT and the whole protected catalog after the atomic scope", () => {
    const broad = stepByName("Push the outstanding migrations (scope=all)");
    // The protected-catalog check is captured from a guard file; read it as
    // the dispatch will, in place.
    const command = withGuardFiles(broad.run ?? "");
    const contract = command.indexOf("where version = '20260822000300'");
    const hostedFunctionAcl = command.indexOf("where version = '20260822000850'", contract);
    const repair = command.indexOf("where version = '20260822000900'", hostedFunctionAcl);
    const recordOnly = command.indexOf("where version = '20260822001000'", repair);
    const functionAcl = command.indexOf("where version = '20260822001100'", recordOnly);
    const clearFunctionAcl = command.indexOf("where version = '20260822001200'", functionAcl);
    const contractCatalog = command.indexOf("PROTECTED_CATALOG_READY=", clearFunctionAcl);
    const push = command.search(/\bsupabase\s+db\s+push\b/);

    expect(contract).toBeGreaterThanOrEqual(0);
    expect(hostedFunctionAcl).toBeGreaterThan(contract);
    expect(repair).toBeGreaterThan(hostedFunctionAcl);
    expect(recordOnly).toBeGreaterThan(repair);
    expect(functionAcl).toBeGreaterThan(recordOnly);
    expect(clearFunctionAcl).toBeGreaterThan(functionAcl);
    expect(command).toContain('if [ "$PROTECTED_CONTRACT" != "1" ]');
    expect(command).toContain('if [ "$PROTECTED_CLEAR_FUNCTION_ACL" != "1" ]');
    expect(command).toContain("scope=factory-any-model-record-only");
    expect(contractCatalog).toBeGreaterThan(clearFunctionAcl);
    expect(command).toContain('if [ "$PROTECTED_CATALOG_READY" != "t" ]');
    expect(command.slice(contractCatalog, push)).toContain("count(default_row.oid) = 2");
    expect(command.slice(contractCatalog, push)).toContain("count(trigger_row.oid) = 3");
    expect(command.slice(contractCatalog, push)).toContain("actual_source_md5 = source_md5");
    expect(command.slice(contractCatalog, push)).toContain("actual_contract_md5 = contract_md5");
    expect(push).toBeGreaterThan(contractCatalog);
  });
});
