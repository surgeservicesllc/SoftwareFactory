// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const workflowPath = resolve(
  repositoryRoot,
  ".github/workflows/apply-hosted-migrations.yml",
);
const migrationRelativePath =
  "supabase/migrations/20260822000300_contract_bot_mutator_acls.sql";
const migrationPath = resolve(repositoryRoot, migrationRelativePath);
const scope = "bot-account-binding-contract";
const frozenSha256 =
  "79914bc97660eef908b6a0fa0c90abfdd15da1683b383ad568e34bf3bd32c5f7";

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

function contractStep(): WorkflowStep {
  const matches = steps.filter((step) =>
    step.name.includes("scope=bot-account-binding-contract")
  );
  expect(matches, "the workflow must contain exactly one CONTRACT step").toHaveLength(1);
  return matches[0]!;
}

function canRunForContract(step: WorkflowStep): boolean {
  const guard = step.if ?? "";
  const exclusions = [...guard.matchAll(/inputs\.scope\s*!=\s*'([^']+)'/g)]
    .map((match) => match[1]);
  if (exclusions.includes(scope)) return false;
  const inclusions = [...guard.matchAll(/inputs\.scope\s*==\s*'([^']+)'/g)]
    .map((match) => match[1]);
  return inclusions.length === 0 || inclusions.includes(scope);
}

function writesMigrationState(step: WorkflowStep): boolean {
  const command = step.run ?? "";
  return /\bsupabase\s+migration\s+repair\b/.test(command)
    || /\bsupabase(?:@\S+)?\s+(?:db\s+push|migration\s+up)\b/.test(command)
    || /\bpsql\b[\s\S]*?(?:^|\s)-f(?:\s|$)/m.test(command);
}

describe("the hosted bot mutator CONTRACT scope", () => {
  it("is a distinct protected choice that cannot reach another mutation step", () => {
    expect(workflow.on.workflow_dispatch.inputs.scope?.options?.filter(
      (value) => value === scope,
    )).toEqual([scope]);
    expect(contractStep().if).toBe(
      "${{ inputs.scope == 'bot-account-binding-contract' }}",
    );

    const reachableWrites = steps
      .filter(canRunForContract)
      .filter(writesMigrationState)
      .map((step) => step.name);
    expect(reachableWrites).toEqual([
      "Apply the exact bot mutator CONTRACT (scope=bot-account-binding-contract)",
    ]);
  });

  it("pins exactly one migration file and its real SHA-256", () => {
    const command = contractStep().run ?? "";
    const referenced = command.match(
      /supabase\/migrations\/[A-Za-z0-9_.-]+\.sql/g,
    ) ?? [];
    const declared = command.match(/(?<=EXPECTED_SHA256=)[a-f0-9]{64}/g) ?? [];
    const actual = createHash("sha256")
      .update(readFileSync(migrationPath))
      .digest("hex");

    expect(referenced).toEqual([migrationRelativePath]);
    expect(declared).toEqual([frozenSha256]);
    expect(actual).toBe(frozenSha256);
    expect(command.match(/\s-f\s+"\$FILE"/g)).toHaveLength(1);
    expect(command.match(
      /psql\s+"\$DB_URL"[\s\S]*?--single-transaction[\s\S]*?-f\s+"\$FILE"\s+\\[\s\S]*?-c\s+"insert into supabase_migrations\.schema_migrations \(version\) values \('20260822000300'\);"/g,
    )).toHaveLength(1);
    expect(command).not.toMatch(/\bsupabase(?:@\S+)?\s+(?:db\s+push|migration\s+up)\b/);
    expect(command).not.toMatch(/\bfor\s+FILE\b/);
  });

  it("machine-gates exact main/Vercel deployment identity and manual acceptance before database access", () => {
    const acceptanceStepIndex = steps.findIndex((candidate) =>
      candidate.name === "Verify exact application acceptance before CONTRACT preflight"
    );
    const connectionStepIndex = steps.findIndex((candidate) =>
      candidate.name === "Choose the connection"
    );
    const acceptanceStep = steps[acceptanceStepIndex];
    const step = contractStep();
    const command = step.run ?? "";
    const appGate = command.indexOf("CHECKED_OUT_SHA=$(git rev-parse HEAD)");
    const acceptanceGate = command.indexOf(
      'if [ "$CONTRACT_ACCEPTANCE" != "exact-app-vercel-accepted" ]',
    );
    const databaseUse = command.indexOf('psql "$DB_URL"');

    expect(acceptanceStepIndex).toBeGreaterThanOrEqual(0);
    expect(connectionStepIndex).toBeGreaterThan(acceptanceStepIndex);
    expect(acceptanceStep?.if).toBe(
      "${{ inputs.scope == 'bot-account-binding-contract' }}",
    );
    expect(acceptanceStep?.env).toMatchObject({
      CONTRACT_ACCEPTANCE: "${{ inputs.contract_acceptance }}",
      CONTRACT_APP_SHA: "${{ inputs.contract_app_sha }}",
      GH_REF: "${{ github.ref }}",
      GH_REPOSITORY: "${{ github.repository }}",
      GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    });
    expect(workflow.permissions).toEqual({ contents: "read", deployments: "read" });
    expect(acceptanceStep?.run).toContain("CHECKED_OUT_SHA=$(git rev-parse HEAD)");
    expect(acceptanceStep?.run).toContain("exact-app-vercel-accepted");
    expect(acceptanceStep?.run).toContain('if [ "$GH_REF" != "refs/heads/main" ]');
    expect(acceptanceStep?.run).toContain("/deployments?environment=Production&per_page=100");
    expect(acceptanceStep?.run).toContain("LATEST_VERCEL_DEPLOYMENT=");
    expect(acceptanceStep?.run).toContain('.sha == $sha and .ref == $sha');
    expect(acceptanceStep?.run).toContain('.task == "deploy"');
    expect(acceptanceStep?.run).toContain('.creator.login == "vercel[bot]"');
    expect(acceptanceStep?.run).toContain('.[0].state == "success"');
    expect(acceptanceStep?.run).toContain(".vercel\\\\.app");
    expect(step.env).toMatchObject({
      CONTRACT_ACCEPTANCE: "${{ inputs.contract_acceptance }}",
      CONTRACT_APP_SHA: "${{ inputs.contract_app_sha }}",
    });
    expect(workflow.on.workflow_dispatch.inputs.contract_app_sha?.description)
      .toContain("exact 40-character application SHA");
    expect(workflow.on.workflow_dispatch.inputs.contract_acceptance?.description)
      .toContain("exact-app-vercel-accepted");
    expect(appGate).toBeGreaterThanOrEqual(0);
    expect(acceptanceGate).toBeGreaterThan(appGate);
    expect(databaseUse).toBeGreaterThan(acceptanceGate);
    expect(command).toContain("healthy Vercel production deployment");
    expect(command).toContain("signed-in owner acceptance");
  });

  it("requires EXPAND exactly once, CONTRACT absent, then records CONTRACT exactly once", () => {
    const command = contractStep().run ?? "";
    const predecessor = command.indexOf(
      "where version = '20260822000200'",
    );
    const target = command.indexOf("where version = '20260822000300'");
    const apply = command.indexOf('-f "$FILE"');
    const ledgerInsert = command.indexOf(
      "insert into supabase_migrations.schema_migrations (version) values ('20260822000300')",
    );

    expect(predecessor).toBeGreaterThanOrEqual(0);
    expect(target).toBeGreaterThan(predecessor);
    expect(apply).toBeGreaterThan(target);
    expect(command).toContain(
      'if [ "$NORMALIZER" != "1" ] || [ "$PREDECESSOR" != "1" ] || [ "$TARGET" != "0" ]',
    );
    expect(ledgerInsert).toBeGreaterThan(apply);
    expect(command).not.toMatch(/migration\s+repair\s+--status\s+applied\s+20260822000300/);
    expect(command).toContain('if [ "$RECORDED" != "1" ]');
  });

  it("stops unless the complete frozen EXPAND catalog is exact", () => {
    const command = contractStep().run ?? "";
    const catalog = command.indexOf("CATALOG_READY=");
    const apply = command.indexOf('-f "$FILE"');
    expect(catalog).toBeGreaterThanOrEqual(0);
    expect(apply).toBeGreaterThan(catalog);
    expect(command.slice(catalog, apply)).toContain("count(oid) = 16");
    for (const identity of [
      "public.ai_account_bot_credential_ref(public.bot_provider,text)",
      "public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)",
      "public.assign_bots_to_project_checked(uuid,uuid,jsonb)",
      "public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)",
      "public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)",
      "public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)",
      "public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)",
      "bots_revision_positive",
      "bot_assignments_revision_positive",
      "bots_ai_account_binding_coherent",
      "bots_increment_revision",
      "bot_assignments_increment_revision",
    ]) {
      expect(command.slice(catalog, apply)).toContain(identity);
    }
    expect(command.slice(catalog, apply)).toContain(
      "md5(replace(replace(routine.prosrc, E'\\r\\n', E'\\n'), E'\\r', E'\\n'))",
    );
    expect(command.slice(catalog, apply)).not.toMatch(/md5\(routine\.prosrc\)/);
    expect(command.slice(catalog, apply)).toContain("actual_contract_md5");
    expect(command.slice(catalog, apply)).toContain("trigger_row.tgtype = expected.trigger_type");
    expect(command.slice(catalog, apply)).toContain("search_path=pg_catalog");
    expect(command.slice(catalog, apply)).toContain("aclexplode(proacl)");
    expect(command.slice(catalog, apply)).toContain("count(default_row.oid) = 2");
    expect(command.slice(catalog, apply)).toContain("coalesce(");
  });

  it("preserves legacy definitions and closes authenticated/public/anon/service_role execution", () => {
    const command = contractStep().run ?? "";
    const migration = readFileSync(migrationPath, "utf8");
    expect(command).toContain("DEFINITIONS_BEFORE=");
    expect(command).toContain("DEFINITIONS_AFTER=");
    expect(command).toContain('if [ "$DEFINITIONS_AFTER" != "$DEFINITIONS_BEFORE" ]');
    expect(command).toContain("ACLS_CLOSED=");
    expect(command).toContain("has_function_privilege('authenticated'");
    expect(command).toContain("has_function_privilege('anon'");
    expect(command).toContain("has_function_privilege('service_role'");
    expect(command).toContain("acl.grantee = 0");

    const aclStatements = [...migration.matchAll(/execute '([^']+)'/g)]
      .map((match) => match[1]);
    expect(aclStatements).toHaveLength(6);
    expect(aclStatements.every((statement) => statement.endsWith(
      "from public, anon, authenticated, service_role",
    ))).toBe(true);
    expect(migration).toContain("20260822000200 function catalog");
    expect(migration).toContain("20260822000200 revision column or constraint catalog");
    expect(migration).toContain("20260822000200 trigger catalog");
    expect(migration).toContain("legacy bot mutator CONTRACT verification failed");
  });

  it("makes scope=all prove both ledgers and the exact live contracted catalog before push", () => {
    const broad = steps.find((step) =>
      step.name === "Push the outstanding migrations (scope=all)"
    );
    const command = broad?.run ?? "";
    const expand = command.indexOf("where version = '20260822000200'");
    const contract = command.indexOf("where version = '20260822000300'");
    const catalog = command.indexOf("PROTECTED_CATALOG_READY=");
    const push = command.search(/\bsupabase\s+db\s+push\b/);

    expect(expand).toBeGreaterThanOrEqual(0);
    expect(contract).toBeGreaterThan(expand);
    expect(command).toContain('if [ "$PROTECTED_EXPAND" != "1" ]');
    expect(command).toContain('if [ "$PROTECTED_CONTRACT" != "1" ]');
    expect(command).toContain("scope=bot-account-binding-contract after exact-app Vercel acceptance");
    expect(catalog).toBeGreaterThan(contract);
    expect(command).toContain('if [ "$PROTECTED_CATALOG_READY" != "t" ]');
    expect(command.slice(catalog, push)).toContain("count(default_row.oid) = 2");
    expect(command.slice(catalog, push)).toContain("count(trigger_row.oid) = 3");
    expect(command.slice(catalog, push)).toContain("actual_source_md5 = source_md5");
    expect(command.slice(catalog, push)).toContain("actual_contract_md5 = contract_md5");
    expect(command.slice(catalog, push)).toContain("provolatile::text = volatility");
    expect(command.slice(catalog, push)).toContain("execute_role = 'none'");
    expect(push).toBeGreaterThan(catalog);
  });
});
