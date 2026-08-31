// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

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
  let taskId: string;

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();

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
    taskId = rows[0].task_id;
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

  it("links a promoted repair, refuses a second promotion, and needs a diagnosis", async () => {
    // A monitor and incident, then a diagnosis and a repair attempt to promote.
    const { rows: monitorRows } = await db.query<{ id: string }>(
      `select id from public.configure_production_monitor(
         $1::uuid, 'Health', 'uptime'::public.production_signal_kind, 'http',
         'https://example.test/health', null, 200::smallint, 2000, 2::smallint, true)`,
      [projectId],
    );
    const { rows: incidentRows } = await db.query<{ incident_id: string }>(
      `select incident_id from public.open_production_incident(
         $1::uuid, 'uptime:link:503', 'Linkable failure', 'sev3'::public.incident_sev,
         'uptime'::public.production_signal_kind, 'symptom', 'impact', $2::uuid, null, null, '{}'::jsonb)`,
      [projectId, monitorRows[0].id],
    );
    const incidentId = incidentRows[0].incident_id;

    // Without a diagnosis, promotion is refused rather than guessed at.
    const { rows: undiagnosed } = await db.query<{ repair_id: string }>(
      `select repair_id from public.create_repair_attempt($1::uuid, null, 'Blind repair',
         'No diagnosis behind this.', 'yellow'::public.risk_level)`,
      [incidentId],
    );
    const { rows: blocked } = await db.query<{ linked: boolean; blocked_reason: string }>(
      `select linked, blocked_reason from public.link_repair_promotion($1::uuid, $2::uuid)`,
      [undiagnosed[0].repair_id, taskId],
    );
    expect(blocked[0].linked).toBe(false);
    expect(blocked[0].blocked_reason).toMatch(/no diagnosis/i);

    const { rows: diagnosisRows } = await db.query<{ id: string }>(
      `select id from public.record_production_diagnosis(
         $1::uuid, 'The release changed the health endpoint contract', 'web',
         'high'::public.diagnosis_confidence, 'Restore the documented response shape',
         'yellow'::public.risk_level, '[]'::jsonb, 'rules-engine-v1')`,
      [incidentId],
    );
    const { rows: repairRows } = await db.query<{ repair_id: string; repair_assignment_status: string }>(
      `select repair_id, repair_assignment_status
       from public.create_repair_attempt($1::uuid, $2::uuid, 'Repair the health endpoint',
         'Restore the documented response.', 'yellow'::public.risk_level)`,
      [incidentId, diagnosisRows[0].id],
    );
    expect(repairRows[0].repair_assignment_status).toBe("not_connected");

    const { rows: linked } = await db.query<{ linked: boolean; assignment_status: string; state: string }>(
      `select linked, assignment_status, state::text as state
       from public.link_repair_promotion($1::uuid, $2::uuid)`,
      [repairRows[0].repair_id, taskId],
    );
    expect(linked[0].linked).toBe(true);
    expect(linked[0].assignment_status).toBe("pending");
    expect(linked[0].state).toBe("assigned");

    // Promoting twice is refused rather than queueing the same repair again.
    const { rows: again } = await db.query<{ linked: boolean; blocked_reason: string }>(
      `select linked, blocked_reason from public.link_repair_promotion($1::uuid, $2::uuid)`,
      [repairRows[0].repair_id, taskId],
    );
    expect(again[0].linked).toBe(false);
    expect(again[0].blocked_reason).toMatch(/already promoted/i);
  });

  it("blocks promotion under the emergency stop but not under a release freeze", async () => {
    const { rows: incidentRows } = await db.query<{ incident_id: string }>(
      `select incident_id from public.open_production_incident(
         $1::uuid, 'uptime:frozen:503', 'Failure during freeze', 'sev2'::public.incident_sev,
         'uptime'::public.production_signal_kind, 'symptom', 'impact', null, null, null, '{}'::jsonb)`,
      [projectId],
    );
    const { rows: diagnosisRows } = await db.query<{ id: string }>(
      `select id from public.record_production_diagnosis(
         $1::uuid, 'A dependency regressed', 'backend', 'medium'::public.diagnosis_confidence,
         'Pin the dependency', 'yellow'::public.risk_level, '[]'::jsonb, 'rules-engine-v1')`,
      [incidentRows[0].incident_id],
    );
    const { rows: repairRows } = await db.query<{ repair_id: string }>(
      `select repair_id from public.create_repair_attempt($1::uuid, $2::uuid, 'Pin it',
         'Pin the regressed dependency.', 'yellow'::public.risk_level)`,
      [incidentRows[0].incident_id, diagnosisRows[0].id],
    );

    // The SEV2 already froze releases. A freeze must NOT block repair: that is
    // the whole reason freezing removes only release authority.
    const { rows: frozen } = await db.query<{ autonomous_releases_frozen: boolean }>(
      `select autonomous_releases_frozen from public.projects where id = $1::uuid`,
      [projectId],
    );
    expect(frozen[0].autonomous_releases_frozen).toBe(true);

    const { rows: duringFreeze } = await db.query<{ linked: boolean }>(
      `select linked from public.link_repair_promotion($1::uuid, $2::uuid)`,
      [repairRows[0].repair_id, taskId],
    );
    expect(duringFreeze[0].linked).toBe(true);

    // The emergency stop does block it.
    await db.query(
      `select public.stop_autonomous_operations($1::uuid, 'Owner stopped operations for this test')`,
      [organizationId],
    );
    const { rows: nextRepair } = await db.query<{ repair_id: string }>(
      `select repair_id from public.create_repair_attempt($1::uuid, $2::uuid, 'Second attempt',
         'Try again after the stop.', 'yellow'::public.risk_level)`,
      [incidentRows[0].incident_id, diagnosisRows[0].id],
    );
    const { rows: stopped } = await db.query<{ linked: boolean; blocked_reason: string }>(
      `select linked, blocked_reason from public.link_repair_promotion($1::uuid, $2::uuid)`,
      [nextRepair[0].repair_id, taskId],
    );
    expect(stopped[0].linked).toBe(false);
    expect(stopped[0].blocked_reason).toMatch(/operations are stopped/i);

    await db.query(
      `select public.resume_autonomous_operations($1::uuid, 'Resuming after the stop test')`,
      [organizationId],
    );
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
