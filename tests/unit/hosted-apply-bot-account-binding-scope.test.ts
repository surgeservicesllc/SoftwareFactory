// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

/**
 * This is a protected, one-file production scope. A bot-account-binding
 * dispatch must never inherit the workflow's broad `scope=all` behavior or a
 * shared ledger repair: the authorization for this release names one frozen
 * migration, and the hash check has to happen before its only database write.
 */
const repositoryRoot = resolve(import.meta.dirname, "../..");
const workflowPath = resolve(
  repositoryRoot,
  ".github/workflows/apply-hosted-migrations.yml",
);
const migrationRelativePath =
  "supabase/migrations/20260822000200_register_bot_for_ai_account.sql";
const migrationPath = resolve(repositoryRoot, migrationRelativePath);
const scope = "bot-account-binding";
const frozenSha256 =
  "658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf";

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

function canRunForProtectedScope(step: WorkflowStep): boolean {
  const guard = step.if ?? "";
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
  return /\bsupabase\s+migration\s+repair\b/.test(command)
    || /\bsupabase(?:@\S+)?\s+(?:db\s+push|migration\s+up)\b/.test(command)
    || /\bpsql\b[\s\S]*?(?:^|\s)-f(?:\s|$)/m.test(command);
}

function protectedStep(): WorkflowStep {
  const matches = steps.filter((step) =>
    step.name === "Apply the exact bot account binding (scope=bot-account-binding)"
  );
  expect(matches, "the workflow must contain exactly one named protected scope step").toHaveLength(1);
  return matches[0]!;
}

describe("the hosted bot-account-binding apply scope", () => {
  it("is a distinct choice guarded only by its exact scope name", () => {
    expect(workflow.on.workflow_dispatch.inputs.scope.options.filter((value) => value === scope))
      .toEqual([scope]);
    expect(protectedStep().if).toBe("${{ inputs.scope == 'bot-account-binding' }}");
    expect(workflow.on.workflow_dispatch.inputs.scope.default).toBe("probe");
  });

  it("pins one migration path and its real frozen SHA-256", () => {
    const command = protectedStep().run ?? "";
    const referencedMigrations = command.match(/supabase\/migrations\/[A-Za-z0-9_.-]+\.sql/g) ?? [];
    const declaredHashes = command.match(/(?<=EXPECTED_SHA256=)[a-f0-9]{64}/g) ?? [];
    const actualHash = createHash("sha256")
      .update(readFileSync(migrationPath))
      .digest("hex");

    expect(referencedMigrations).toEqual([migrationRelativePath]);
    expect(declaredHashes).toEqual([frozenSha256]);
    expect(actualHash).toBe(frozenSha256);
  });

  it("cannot fall through to scope=all or another migration mutation", () => {
    const reachableWrites = steps
      .filter(canRunForProtectedScope)
      .filter(writesHostedMigrationState)
      .map((step) => step.name);

    expect(
      reachableWrites,
      "A bot-account-binding dispatch may mutate only its exact protected step. "
        + "Guard shared ledger repairs and broad migration pushes out of this scope.",
    ).toEqual(["Apply the exact bot account binding (scope=bot-account-binding)"]);
  });

  it("applies and records only version 20260822000200 without a broad push", () => {
    const command = protectedStep().run ?? "";
    expect(command).not.toMatch(/migration\s+repair\s+--status\s+applied\s+20260822000200/);
    expect(command.match(/\s-f\s+"\$FILE"/g)).toHaveLength(1);
    expect(command.match(
      /psql\s+"\$DB_URL"[\s\S]*?--single-transaction[\s\S]*?-f\s+"\$FILE"\s+\\[\s\S]*?-c\s+"insert into supabase_migrations\.schema_migrations \(version\) values \('20260822000200'\);"/g,
    )).toHaveLength(1);
    expect(command).not.toMatch(/\bsupabase(?:@\S+)?\s+(?:db\s+push|migration\s+up)\b/);
    expect(command).not.toMatch(/\bfor\s+FILE\b/);
  });

  it("makes the broad scope prove the protected version already landed", () => {
    const broad = steps.find((step) => step.name === "Push the outstanding migrations (scope=all)");
    expect(broad?.if).toBe("${{ inputs.scope == 'all' }}");
    const command = broad?.run ?? "";
    const gate = command.indexOf(
      "select count(*) from supabase_migrations.schema_migrations where version = '20260822000200'",
    );
    const push = command.search(/\bsupabase\s+db\s+push\b/);

    expect(gate).toBeGreaterThanOrEqual(0);
    expect(command).toContain('if [ "$PROTECTED_EXPAND" != "1" ]');
    expect(command).toContain("Apply it only through scope=bot-account-binding");
    expect(push).toBeGreaterThan(gate);
  });

  it("prints the frozen register_bot source hash in the read-only probe", () => {
    const probe = steps.find((step) =>
      step.name === "Report what the database already has (scope=probe)"
    );
    const command = probe?.run ?? "";
    expect(probe?.if).toBe("${{ inputs.scope == 'probe' }}");
    expect(command).toContain(
      "public.register_bot(uuid,text,public.bot_provider,text,text,text,text)",
    );
    expect(command).toContain(
      "md5(replace(replace(routine.prosrc, E'\\r\\n', E'\\n'), E'\\r', E'\\n')) as source_md5",
    );
    expect(command).not.toMatch(/md5\(routine\.prosrc\)/);
    expect(command).toContain("797dcd842e22e5f0ae6b8299f744b0b4");
    expect(command).not.toContain("md5(pg_get_functiondef(routine.oid))");
    expect(command).not.toMatch(/migration\s+repair|supabase\s+db\s+push/);
    expect(command).not.toContain("insert into supabase_migrations.schema_migrations");
  });

  it("normalizes every PostgreSQL function source hash across the workflow", () => {
    const normalizedHash =
      "md5(replace(replace(routine.prosrc, E'\\r\\n', E'\\n'), E'\\r', E'\\n'))";
    const sourceUses = source.split("routine.prosrc").length - 1;
    const normalizedUses = source.split(normalizedHash).length - 1;

    expect(sourceUses).toBeGreaterThan(0);
    expect(normalizedUses).toBe(sourceUses);
    expect(source).not.toMatch(/md5\(routine\.prosrc\)/);
  });

  it("verifies the expand-only atomic posting contract and preserves every legacy mutator ACL", () => {
    const command = protectedStep().run ?? "";
    const migration = readFileSync(migrationPath, "utf8");

    expect(command).toContain("bots_revision_positive");
    expect(command).toContain("bots_increment_revision");
    expect(command).toContain("public.increment_bot_revision()");
    expect(command).toContain("bot_assignments_revision_positive");
    expect(command).toContain("bot_assignments_increment_revision");
    expect(command).toContain("public.increment_bot_assignment_revision()");
    expect(command).toContain("public.assign_bots_to_project_checked(uuid,uuid,jsonb)");
    expect(command).toContain(
      "public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)",
    );
    expect(command).toContain(
      "public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)",
    );
    expect(command).toContain(
      "public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)",
    );
    expect(command).toContain(
      "public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)",
    );
    expect(command).toMatch(/has_function_privilege\(\s*'service_role',[\s\S]*record_bot_readiness_preserving_disabled/);
    expect(command).toContain("public.assign_bot(uuid,uuid,uuid,uuid)");
    expect(command).toContain("legacy(signature)");
    expect(command).toContain("MUTATORS_BEFORE=");
    expect(command).toContain("LEGACY_ACLS_BEFORE=");
    expect(command).toContain("coalesce(array_to_string(routine.proacl, ','), '')");
    expect(command).toContain(
      "not has_function_privilege('authenticated', legacy.signature, 'EXECUTE')",
    );
    expect(command).toContain('if [ "$MUTATORS_AFTER" != "$MUTATORS_BEFORE" ]');

    expect(migration).toContain("EXPAND-phase compatibility");
    for (const legacyName of [
      "assign_bot",
      "assign_bots_to_project",
      "update_bot_assignment_configuration",
      "update_bot_assignment",
      "set_bot_assignment_execution",
      "record_bot_readiness",
    ]) {
      expect(migration).not.toMatch(
        new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${legacyName}\\(`, "i"),
      );
    }
  });

  it("pins the exact seven legacy routine definitions and catalog posture before EXPAND DDL", () => {
    const command = protectedStep().run ?? "";
    const migration = readFileSync(migrationPath, "utf8");
    const workflowGuard = command.indexOf("LEGACY_CATALOG_READY=");
    const workflowApply = command.indexOf('-f "$FILE"');
    const migrationGuard = migration.indexOf("do $catalog_preflight$");
    const firstDdl = migration.search(/^(?:create|alter|drop|grant|revoke)\b/im);
    const migrationPreamble = migration.slice(migrationGuard, firstDdl);

    expect(workflowGuard).toBeGreaterThanOrEqual(0);
    expect(workflowApply).toBeGreaterThan(workflowGuard);
    expect(migrationGuard).toBeGreaterThanOrEqual(0);
    expect(firstDdl).toBeGreaterThan(migrationGuard);
    for (const [signature, sourceHash] of [
      ["public.register_bot(uuid,text,public.bot_provider,text,text,text,text)", "797dcd842e22e5f0ae6b8299f744b0b4"],
      ["public.assign_bot(uuid,uuid,uuid,uuid)", "80b547b7b722c57a9d2a262b67698be8"],
      ["public.assign_bots_to_project(uuid,uuid,jsonb)", "23b260247a4be4f4a8d8aa2497e1b6a2"],
      ["public.record_bot_readiness(uuid,uuid,public.bot_readiness,text)", "daecfeb964d863373a2072cc62e1033e"],
      ["public.set_bot_assignment_execution(uuid,uuid,text,text)", "55ec15132d903ace0300f2cbe32db6bd"],
      ["public.update_bot_assignment(uuid,uuid,public.bot_assignment_status)", "0aaec47295f86adbeec784d288f24400"],
      ["public.update_bot_assignment_configuration(uuid,uuid,jsonb,uuid,public.bot_assignment_status)", "7f51999309b645832d471ccebea94a9c"],
    ]) {
      expect(command.slice(workflowGuard, workflowApply)).toContain(signature);
      expect(command.slice(workflowGuard, workflowApply)).toContain(sourceHash);
      expect(migrationPreamble).toContain(signature);
      expect(migrationPreamble).toContain(sourceHash);
    }
    for (const invariant of [
      "prosrc", "prorettype", "proallargtypes", "procost",
      "pg_get_userbyid", "pg_language", "lanname",
      "prokind", "provolatile", "prosecdef", "search_path=pg_catalog",
      "aclexplode", "is_grantable",
    ]) {
      expect(command.slice(workflowGuard, workflowApply)).toContain(invariant);
      expect(migrationPreamble).toContain(invariant);
    }
    expect(command.slice(workflowGuard, workflowApply)).toContain("count(oid) = 7");
    expect(migrationPreamble).toContain("unexpected legacy bot routine overload exists before EXPAND");
    expect(migrationPreamble).toContain("auth_method is distinct from 'subscription'");
  });

  it("uses migration-local and workflow postflights to reject inherited ACL/catalog drift", () => {
    const command = protectedStep().run ?? "";
    const migration = readFileSync(migrationPath, "utf8");
    const apply = command.indexOf('-f "$FILE"');
    const workflowPostflight = command.indexOf("EXPAND_FUNCTIONS_EXACT=");
    const ledgerWrite = command.indexOf(
      "insert into supabase_migrations.schema_migrations (version) values ('20260822000200')",
    );
    const migrationPostflight = migration.indexOf("do $expand_postflight$");
    const lastGrant = migration.lastIndexOf("grant execute on function");

    expect(ledgerWrite).toBeGreaterThan(apply);
    expect(workflowPostflight).toBeGreaterThan(ledgerWrite);
    expect(migrationPostflight).toBeGreaterThan(lastGrant);
    for (const source of [
      command.slice(workflowPostflight),
      migration.slice(migrationPostflight),
    ]) {
      expect(source).toContain("prosrc");
      expect(source).toContain("prorettype");
      expect(source).toContain("proallargtypes");
      expect(source).toContain("procost");
      expect(source).toContain("pg_get_userbyid");
      expect(source).toContain("pg_language");
      expect(source).toContain("prokind");
      expect(source).toContain("provolatile");
      expect(source).toContain("prosecdef");
      expect(source).toContain("search_path=pg_catalog");
      expect(source).toContain("aclexplode");
      expect(source).toContain("is_grantable");
      expect(source).toContain("acl.grantee <>");
      expect(source).toMatch(/case\s+when\s+(?:expected\.)?execute_role\s*=\s*'none'\s+then\s+1\s+else\s+2\s+end/);
    }
    expect(command.slice(workflowPostflight)).toContain("count(oid) = 10");
    expect(command.slice(workflowPostflight)).toContain("trigger_row.tgtype = 23");
    expect(migration.slice(migrationPostflight)).toContain("trigger_row.tgtype <> expected.trigger_type");
    expect(migration.slice(migrationPostflight)).toContain("default_row.oid is null");
    expect(migration.slice(migrationPostflight)).toContain("new EXPAND trigger catalog is not exact");
  });

  it("refuses pre-existing new objects before CREATE OR REPLACE or DROP TRIGGER can hide drift", () => {
    const command = protectedStep().run ?? "";
    const migration = readFileSync(migrationPath, "utf8");
    const guard = command.indexOf("CATALOG_DRIFT_BEFORE=");
    const apply = command.indexOf('-f "$FILE"');
    const migrationGuard = migration.indexOf("do $catalog_preflight$");
    const firstReplacement = migration.search(/^(?:create or replace function|drop trigger)/im);
    const migrationPreamble = migration.slice(migrationGuard, firstReplacement);

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(apply).toBeGreaterThan(guard);
    expect(migrationGuard).toBeGreaterThanOrEqual(0);
    expect(firstReplacement).toBeGreaterThan(migrationGuard);
    expect(command.slice(guard, apply)).toContain("routine.proname = expected.function_name");
    expect(migrationPreamble).toContain("routine.proname = expected.function_name");
    for (const signature of [
      "public.ai_account_bot_credential_ref(public.bot_provider,text)",
      "public.enforce_bot_ai_account_binding()",
      "public.ensure_ai_account_bot(uuid,uuid,public.bot_provider,text,text,boolean,text,text)",
      "public.increment_bot_revision()",
      "public.increment_bot_assignment_revision()",
      "public.assign_bots_to_project_checked(uuid,uuid,jsonb)",
      "public.update_bot_assignment_configuration_checked(uuid,uuid,uuid,bigint,jsonb,uuid,public.bot_assignment_status)",
      "public.update_bot_assignment_checked(uuid,uuid,uuid,bigint,public.bot_assignment_status)",
      "public.set_bot_assignment_execution_checked(uuid,uuid,uuid,bigint,text,text)",
      "public.record_bot_readiness_preserving_disabled(uuid,uuid,uuid,bigint,uuid,public.bot_provider,text,text,text,public.bot_readiness,text)",
    ]) {
      expect(command.slice(guard, apply)).toContain(signature);
      expect(migrationPreamble).toContain(signature);
    }
    for (const trigger of [
      "bots_ai_account_binding_coherent",
      "bots_increment_revision",
      "bot_assignments_increment_revision",
    ]) {
      expect(command.slice(guard, apply)).toContain(trigger);
      expect(migrationPreamble).toContain(trigger);
    }
  });

  it("states the post-apply runtime, lint, health, and containment gates it does not prove", () => {
    const command = protectedStep().run ?? "";

    expect(command).toContain("Runtime create/bind/assign/configure/readiness/audit behavior");
    expect(command).toContain("linked database lint");
    expect(command).toContain("application health");
    expect(command).toContain("kill-switch/autonomy/worker containment");
    expect(command).toContain("mandatory post-apply release gates");
  });
});
