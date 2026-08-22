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
  "supabase/migrations/20260822000150_normalize_legacy_bot_function_acls.sql";
const migrationPath = resolve(repositoryRoot, migrationRelativePath);
const scope = "bot-legacy-acl-normalization";
const frozenSha256 =
  "6b24b6ebb57e59b9c4398c3e439221c27c300663a7b6932ff192996ffe6bcd93";

interface WorkflowStep {
  readonly name: string;
  readonly if?: string;
  readonly run?: string;
}

interface HostedApplyWorkflow {
  readonly on: {
    readonly workflow_dispatch: {
      readonly inputs: {
        readonly scope: {
          readonly default: string;
          readonly options: readonly string[];
        };
      };
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
  expect(
    matches,
    `expected exactly one workflow step named ${name}`,
  ).toHaveLength(1);
  return matches[0]!;
}

function normalizationStep(): WorkflowStep {
  return stepByName(
    "Normalize exact legacy bot ACLs (scope=bot-legacy-acl-normalization)",
  );
}

function canRunForNormalization(step: WorkflowStep): boolean {
  const guard = step.if ?? "";
  if (/\bfalse\b/.test(guard)) return false;
  const excludedScopes = [
    ...guard.matchAll(/inputs\.scope\s*!=\s*'([^']+)'/g),
  ].map((match) => match[1]);
  if (excludedScopes.includes(scope)) return false;

  const includedScopes = [
    ...guard.matchAll(/inputs\.scope\s*==\s*'([^']+)'/g),
  ].map((match) => match[1]);
  if (includedScopes.length > 0) return includedScopes.includes(scope);
  return true;
}

function writesHostedMigrationState(step: WorkflowStep): boolean {
  const command = step.run ?? "";
  return (
    /\bsupabase\s+migration\s+repair\b/.test(command) ||
    /\bsupabase(?:@\S+)?\s+(?:db\s+push|migration\s+up)\b/.test(command) ||
    /\bpsql\b[\s\S]*?(?:^|\s)-f(?:\s|$)/m.test(command)
  );
}

const legacyRoutines = [
  [
    "public.register_bot(uuid,text,public.bot_provider,text,text,text,text)",
    "797dcd842e22e5f0ae6b8299f744b0b4",
    "658e04bf56902695f8da49b0b62827d8",
  ],
  [
    "public.assign_bot(uuid,uuid,uuid,uuid)",
    "80b547b7b722c57a9d2a262b67698be8",
    "f6f66a20b1848121d45f08ffe716466e",
  ],
  [
    "public.assign_bots_to_project(uuid,uuid,jsonb)",
    "23b260247a4be4f4a8d8aa2497e1b6a2",
    "509ff97d6dd6ccecfc6a0b559f6402ab",
  ],
  [
    "public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)",
    "daecfeb964d863373a2072cc62e1033e",
    "f399bc01e734509765a9955d6ea12d3f",
  ],
  [
    "public.set_bot_assignment_execution(uuid,uuid,text,text)",
    "55ec15132d903ace0300f2cbe32db6bd",
    "09868603f1251c9b3c0e714585c470a6",
  ],
  [
    "public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)",
    "0aaec47295f86adbeec784d288f24400",
    "15df08b5f10d11f2eb75939bd24ff471",
  ],
  [
    "public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)",
    "7f51999309b645832d471ccebea94a9c",
    "25a69b2727d3e8c038411fcdfa7f9ae3",
  ],
] as const;

describe("the hosted legacy bot ACL normalization scope", () => {
  it("is a distinct choice and excludes shared repair and every other write path", () => {
    const scopeInput = workflow.on.workflow_dispatch.inputs.scope;
    const repair = stepByName("Repair stale ledger rows (idempotent)");
    const reachableWrites = steps
      .filter(canRunForNormalization)
      .filter(writesHostedMigrationState)
      .map((step) => step.name);

    expect(scopeInput.options.filter((value) => value === scope)).toEqual([
      scope,
    ]);
    expect(scopeInput.default).toBe("probe");
    expect(normalizationStep().if).toBe(
      "${{ inputs.scope == 'bot-legacy-acl-normalization' }}",
    );
    expect(repair.if).toContain(
      "inputs.scope != 'bot-legacy-acl-normalization'",
    );
    expect(reachableWrites).toEqual([
      "Normalize exact legacy bot ACLs (scope=bot-legacy-acl-normalization)",
    ]);
  });

  it("pins exactly migration 20260822000150 and its real frozen SHA-256", () => {
    const command = normalizationStep().run ?? "";
    const referencedMigrations =
      command.match(/supabase\/migrations\/[A-Za-z0-9_.-]+\.sql/g) ?? [];
    const declaredHashes =
      command.match(/(?<=EXPECTED_SHA256=)[a-f0-9]{64}/g) ?? [];
    const actualHash = createHash("sha256")
      .update(readFileSync(migrationPath))
      .digest("hex");

    expect(referencedMigrations).toEqual([migrationRelativePath]);
    expect(declaredHashes).toEqual([frozenSha256]);
    expect(actualHash).toBe(frozenSha256);
  });

  it("requires the exact predecessor-only ledger state before catalog proof or DDL", () => {
    const command = normalizationStep().run ?? "";
    const historyStart = command.indexOf("HISTORY=");
    const catalogStart = command.indexOf("LEGACY_OVERGRANT_EXACT=");
    const applyStart = command.indexOf(
      'psql "$DB_URL" -v ON_ERROR_STOP=1 -X --single-transaction -q',
    );
    const historyGate = command.slice(historyStart, catalogStart);

    expect(historyStart).toBeGreaterThanOrEqual(0);
    expect(catalogStart).toBeGreaterThan(historyStart);
    expect(applyStart).toBeGreaterThan(catalogStart);
    expect(historyGate).toContain("-v ON_ERROR_STOP=1 -X -Atq -F '|'");
    for (const version of [
      "20260822000100",
      "20260822000150",
      "20260822000200",
      "20260822000300",
    ]) {
      expect(historyGate).toContain(
        `count(*) filter (where version = '${version}')`,
      );
      expect(historyGate).toContain(`'${version}'`);
    }
    expect(historyGate).toContain('if [ "$HISTORY" != "1|0|0|0" ]');
    expect(historyGate).toContain(
      "predecessor-once/normalizer-absent/EXPAND-absent/CONTRACT-absent",
    );
  });

  it("proves the exact seven-function source, contract, owner, and ACL catalog", () => {
    const command = normalizationStep().run ?? "";
    const catalogStart = command.indexOf("LEGACY_OVERGRANT_EXACT=");
    const applyStart = command.indexOf('echo "Applying ${FILE}');
    const catalog = command.slice(catalogStart, applyStart);

    expect(catalogStart).toBeGreaterThanOrEqual(0);
    expect(applyStart).toBeGreaterThan(catalogStart);
    for (const [signature, sourceHash, contractHash] of legacyRoutines) {
      expect(catalog).toContain(signature);
      expect(catalog).toContain(sourceHash);
      expect(catalog).toContain(contractHash);
    }
    for (const invariant of [
      "count(oid) = 7",
      "md5(replace(replace(routine.prosrc, E'\\r\\n', E'\\n'), E'\\r', E'\\n'))",
      "actual_contract_md5",
      "jsonb_build_array",
      "prokind = 'f'",
      "provolatile = 'v'",
      "prosecdef",
      "search_path=pg_catalog",
      "pg_get_userbyid(proowner) = 'postgres'",
      "aclexplode(proacl)",
      "(select count(*) from aclexplode(proacl)) = 3",
      "has_function_privilege('authenticated', signature, 'EXECUTE')",
      "has_function_privilege('service_role', signature, 'EXECUTE')",
      "not has_function_privilege('anon', signature, 'EXECUTE')",
      "select count(*) = 7",
    ]) {
      expect(catalog).toContain(invariant);
    }
    expect(catalog).not.toMatch(/md5\(routine\.prosrc\)/);
    expect(catalog).not.toContain("pg_get_functiondef");
  });

  it("applies the one file and records its ledger row in one transaction", () => {
    const command = normalizationStep().run ?? "";
    const atomicApply =
      command.match(
        /psql "\$DB_URL" -v ON_ERROR_STOP=1 -X --single-transaction -q \\\s+-f "\$FILE" \\\s+-c "insert into supabase_migrations\.schema_migrations \(version\) values \('20260822000150'\);"/g,
      ) ?? [];

    expect(atomicApply).toHaveLength(1);
    expect(command.match(/\s-f\s+"\$FILE"/g)).toHaveLength(1);
    expect(
      command.match(
        /insert into supabase_migrations\.schema_migrations \(version\) values \('20260822000150'\)/g,
      ),
    ).toHaveLength(1);
  });

  it("postflights the normalized ACLs and exact ledger after the atomic write", () => {
    const command = normalizationStep().run ?? "";
    const ledgerWrite = command.indexOf(
      "insert into supabase_migrations.schema_migrations (version) values ('20260822000150')",
    );
    const postflightStart = command.indexOf("NORMALIZED=");
    const postflight = command.slice(postflightStart);

    expect(ledgerWrite).toBeGreaterThanOrEqual(0);
    expect(postflightStart).toBeGreaterThan(ledgerWrite);
    for (const [signature, sourceHash] of legacyRoutines) {
      expect(postflight).toContain(signature);
      expect(postflight).toContain(sourceHash);
    }
    for (const invariant of [
      "count(routine.oid) = 7",
      "routine.prosecdef",
      "search_path=pg_catalog",
      "pg_get_userbyid(routine.proowner) = 'postgres'",
      "(select count(*) from aclexplode(routine.proacl)) = 2",
      "has_function_privilege('authenticated', expected.signature, 'EXECUTE')",
      "not has_function_privilege('anon', expected.signature, 'EXECUTE')",
      "not has_function_privilege('service_role', expected.signature, 'EXECUTE')",
      "where version = '20260822000150'",
      "where version in ('20260822000200', '20260822000300')",
    ]) {
      expect(postflight).toContain(invariant);
    }
    expect(postflight).toContain('if [ "$NORMALIZED" != "t" ]');
    expect(postflight).toContain(
      "stop and contain only with a new forward migration",
    );
  });

  it("contains no destructive, repair, looped, or broad migration path", () => {
    const command = normalizationStep().run ?? "";

    expect(command).not.toMatch(/\bmigration\s+repair\b/);
    expect(command).not.toMatch(
      /\bsupabase(?:@\S+)?\s+(?:db\s+push|migration\s+up|db\s+reset)\b/,
    );
    expect(command).not.toMatch(/\bfor\s+FILE\b/);
    expect(command).not.toMatch(/\bdrop\s+(?:database|schema)\b/i);
    expect(command).not.toMatch(
      /\b(?:delete|update)\s+(?:from\s+)?supabase_migrations\.schema_migrations\b/i,
    );
    expect(command).not.toMatch(
      /supabase\/migrations\/20260822000(?:200|300)_[A-Za-z0-9_.-]+\.sql/,
    );
  });

  it("makes EXPAND require predecessor and normalizer once with both targets absent", () => {
    const expand =
      stepByName(
        "Apply the exact bot account binding (scope=bot-account-binding)",
      ).run ?? "";
    const gateStart = expand.indexOf("PREDECESSOR=");
    const catalogStart = expand.indexOf("LEGACY_CATALOG_READY=");
    const gate = expand.slice(gateStart, catalogStart);

    expect(gateStart).toBeGreaterThanOrEqual(0);
    expect(catalogStart).toBeGreaterThan(gateStart);
    expect(gate).toContain("version = '20260822000100'");
    expect(gate).toContain("version = '20260822000150'");
    expect(gate).toContain("version = '20260822000200'");
    expect(gate).toContain("version = '20260822000300'");
    expect(gate).toContain(
      'if [ "$PREDECESSOR" != "1" ] || [ "$NORMALIZER" != "1" ] || [ "$TARGET" != "0" ] || [ "$CONTRACT" != "0" ]',
    );
    expect(expand.indexOf('-f "$FILE"')).toBeGreaterThan(catalogStart);
  });

  it("retires standalone CONTRACT and requires it absent in the atomic chain", () => {
    const options = workflow.on.workflow_dispatch.inputs.scope.options;
    const retired = stepByName(
      "Apply the exact bot mutator CONTRACT (scope=bot-account-binding-contract)",
    );
    const refusal = stepByName(
      "Refuse the retired standalone bot mutator CONTRACT scope",
    );
    const contract = stepByName(
      "Apply the exact factory any-model record-only chain (scope=factory-any-model-record-only)",
    ).run ?? "";
    const historyStart = contract.indexOf("HISTORY=");
    const precontractStart = contract.indexOf("PRECONTRACT_READY=");

    expect(options).not.toContain("bot-account-binding-contract");
    expect(retired.if).toBe(
      "${{ false && inputs.scope == 'bot-account-binding-contract' }}",
    );
    expect(refusal.run).toContain("scope=factory-any-model-record-only");
    expect(historyStart).toBeGreaterThanOrEqual(0);
    expect(precontractStart).toBeGreaterThan(historyStart);
    expect(contract).toContain(
      'if [ "$HISTORY" != "1|1|0|1|1|1|1|1|0|0|0" ]',
    );
    expect(contract.indexOf('-f "$CONTRACT_FILE"')).toBeGreaterThan(precontractStart);
  });

  it("makes scope=all prove normalizer, EXPAND, and CONTRACT once before push", () => {
    const broadStep = stepByName("Push the outstanding migrations (scope=all)");
    const command = broadStep.run ?? "";
    const gateStart = command.indexOf("PROTECTED_NORMALIZER=");
    const catalogStart = command.indexOf("PROTECTED_CATALOG_READY=");
    const push = command.search(/\bsupabase(?:@\S+)?\s+db\s+push\b/);
    const gate = command.slice(gateStart, catalogStart);

    expect(broadStep.if).toBe("${{ inputs.scope == 'all' }}");
    expect(gateStart).toBeGreaterThanOrEqual(0);
    expect(catalogStart).toBeGreaterThan(gateStart);
    expect(push).toBeGreaterThan(catalogStart);
    for (const [variable, version, dedicatedScope] of [
      [
        "PROTECTED_NORMALIZER",
        "20260822000150",
        "bot-legacy-acl-normalization",
      ],
      ["PROTECTED_EXPAND", "20260822000200", "bot-account-binding"],
      ["PROTECTED_CONTRACT", "20260822000300", "factory-any-model-record-only"],
    ]) {
      expect(gate).toContain(
        `select count(*) from supabase_migrations.schema_migrations where version = '${version}'`,
      );
      expect(gate).toContain(`if [ "$${variable}" != "1" ]`);
      expect(gate).toContain(`scope=${dedicatedScope}`);
    }
  });
});
