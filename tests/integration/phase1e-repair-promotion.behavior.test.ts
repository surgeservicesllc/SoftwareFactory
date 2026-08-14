// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PHASE_1C_PARAMETER_KEYS,
  buildRepairCommand,
  type RepairDiagnosis,
} from "@/lib/operations/promotion";

/**
 * Proof that a Phase 1E repair can enter the Phase 1C execution path.
 *
 * The previous attempt at this failed because Phase 1C validates command
 * parameters against an exact-key allowlist, so a hand-written object was
 * rejected outright. This asserts the assembled command against the *real*
 * `submit_command` in the migrated schema — the same function every other
 * command goes through — rather than against a copy of the rule.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000d001";
const organizationId = "10000000-0000-4000-8000-00000000d001";
const projectId = "40000000-0000-4000-8000-00000000d001";
const connectionId = "20000000-0000-4000-8000-00000000d001";
const installationId = "30000000-0000-4000-8000-00000000d001";
const repositoryId = "50000000-0000-4000-8000-00000000d001";

const binding = {
  appId: 4582606,
  baseBranch: "main",
  baseSha: "a".repeat(40),
  connectionId,
  externalInstallationId: 153479019,
  externalRepositoryId: 600001,
  installationId,
  repositoryId,
};

const diagnosis: RepairDiagnosis = {
  likelyCause: "The most recent release changed the health endpoint contract",
  affectedSubsystem: "web",
  recommendedAction: "Restore the documented response shape and add a contract test",
  riskLevel: "yellow",
};

describe("Phase 1E repair promotion into Phase 1C", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);

    const migrationFiles = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}');
      insert into public.organizations (id, name, slug, created_by)
        values ('${organizationId}', 'Promotion Factory', 'promotion-factory', '${ownerId}');
      insert into public.projects (id, organization_id, name, status, github_repository, default_branch, created_by)
        values ('${projectId}', '${organizationId}', 'Storefront', 'active', 'surgeservicesllc/SoftwareFactory', 'main', '${ownerId}');
      insert into public.connections (id, organization_id, name, provider, status, external_account_label, secret_reference, created_by)
        values ('${connectionId}', '${organizationId}', 'GitHub', 'github', 'connected', 'surgeservicesllc', 'env://GITHUB_APP', '${ownerId}');
      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id, app_slug,
        account_id, account_login, account_type, target_type, repository_selection, status, installed_at, created_by
      ) values (
        '${installationId}', '${organizationId}', '${connectionId}', 153479019, 4582606, 'surge-softwarefactory-next',
        800001, 'surgeservicesllc', 'User', 'User', 'selected', 'active', now(), '${ownerId}'
      );
      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id, owner_login, name, full_name,
        default_branch, html_url, private, visibility, selected, github_updated_at
      ) values (
        '${repositoryId}', '${organizationId}', '${installationId}', 600001, 'surgeservicesllc', 'SoftwareFactory',
        'surgeservicesllc/SoftwareFactory', 'main', 'https://github.com/surgeservicesllc/SoftwareFactory',
        true, 'private', true, now()
      );
      insert into public.project_connections (organization_id, project_id, connection_id, github_repository_id, is_primary, created_by)
        values ('${organizationId}', '${projectId}', '${connectionId}', '${repositoryId}', true, '${ownerId}');
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("assembles exactly the key set Phase 1C's allowlist compares against", () => {
    const command = buildRepairCommand({ diagnosis, binding, repairAttemptId: "repair-1", environment: {} });
    expect(Object.keys(command.parameters).sort()).toEqual([...PHASE_1C_PARAMETER_KEYS].sort());
  });

  it("is accepted by the real submit_command, creating a claimable command and task", async () => {
    const command = buildRepairCommand({ diagnosis, binding, repairAttemptId: "repair-1", environment: {} });

    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
    await db.exec("set role authenticated");

    const { rows } = await db.query<{
      command_id: string;
      task_id: string;
      command_state: string;
      task_state: string;
      requires_owner_approval: boolean;
      was_created: boolean;
    }>(
      `select command_id, task_id, command_state, task_state, requires_owner_approval, was_created
       from public.submit_command($1::uuid, $2::text, $3::public.risk_level, $4::jsonb, $5::text)`,
      [projectId, command.prompt, command.effectiveRisk, JSON.stringify(command.parameters), command.idempotencyKey],
    );

    expect(rows[0].was_created).toBe(true);
    expect(rows[0].command_id).toBeTruthy();
    // A real command and task now exist — the thing a repair attempt never had.
    expect(rows[0].task_id).toBeTruthy();
  });

  it("yields one command per repair attempt however often promotion is retried", async () => {
    const command = buildRepairCommand({ diagnosis, binding, repairAttemptId: "repair-1", environment: {} });

    const { rows } = await db.query<{ was_created: boolean; command_id: string }>(
      `select was_created, command_id
       from public.submit_command($1::uuid, $2::text, $3::public.risk_level, $4::jsonb, $5::text)`,
      [projectId, command.prompt, command.effectiveRisk, JSON.stringify(command.parameters), command.idempotencyKey],
    );
    expect(rows[0].was_created).toBe(false);

    // Browsers have no direct SELECT on commands; read the stored shape through
    // a privileged connection purely to assert it.
    await db.exec("reset role");
    const { rows: countRows } = await db.query<{ count: string }>(
      `select count(*)::text as count from public.commands where organization_id = $1::uuid`,
      [organizationId],
    );
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
    await db.exec("set role authenticated");
    expect(Number(countRows[0].count)).toBe(1);
  });

  it("forces a security-shaped repair to RED, so it cannot slip past owner approval", async () => {
    const securityDiagnosis: RepairDiagnosis = {
      likelyCause: "The release weakened an authentication boundary and exposed a credential path",
      affectedSubsystem: "authentication",
      recommendedAction: "Restore the authorization check on the affected route",
      riskLevel: "yellow",
    };
    const command = buildRepairCommand({
      diagnosis: securityDiagnosis, binding, repairAttemptId: "repair-security", environment: {},
    });

    const { rows } = await db.query<{ requires_owner_approval: boolean; command_state: string }>(
      `select requires_owner_approval, command_state::text as command_state
       from public.submit_command($1::uuid, $2::text, $3::public.risk_level, $4::jsonb, $5::text)`,
      [projectId, command.prompt, command.effectiveRisk, JSON.stringify(command.parameters), command.idempotencyKey],
    );

    // Repair work enters the ordinary gates; it does not get a privileged lane.
    expect(rows[0].requires_owner_approval).toBe(true);
    expect(rows[0].command_state).toBe("awaiting_approval");
  });
});
