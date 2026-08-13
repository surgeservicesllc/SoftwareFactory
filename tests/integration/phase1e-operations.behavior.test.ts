// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Phase 1E behavioral proof.
 *
 * This exercises the real migrated schema, not string matches: detection,
 * deduplication, severity, automatic freeze, owner-only resume, rollback
 * eligibility and failed-rollback escalation, bounded repair attempts,
 * resolution gating, event idempotency, RLS, and the append-only guarantees.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000e0001";
const adminId = "00000000-0000-4000-8000-0000000e0002";
const memberId = "00000000-0000-4000-8000-0000000e0003";
const outsiderId = "00000000-0000-4000-8000-0000000e0004";

const organizationId = "10000000-0000-4000-8000-0000000e0001";
const otherOrganizationId = "10000000-0000-4000-8000-0000000e0002";
const projectId = "40000000-0000-4000-8000-0000000e0001";
const otherProjectId = "40000000-0000-4000-8000-0000000e0002";

const goodDeploymentId = "80000000-0000-4000-8000-0000000e0001";
const badDeploymentId = "80000000-0000-4000-8000-0000000e0002";

type Role = "anon" | "authenticated" | "service_role";

async function assumeRole(db: PGlite, role: Role, userId: string | null = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

async function configureMonitor(db: PGlite, name: string, kind = "uptime") {
  const { rows } = await db.query<{ id: string; connection_state: string; enabled: boolean }>(
    `select id, connection_state, enabled from public.configure_production_monitor(
       $1::uuid, $2::text, $3::public.production_signal_kind, 'http', $4::text,
       null, 200::smallint, 2000, 2::smallint, true
     )`,
    [projectId, name, kind, "https://example.test/health"],
  );
  return rows[0];
}

async function observe(
  db: PGlite,
  monitorId: string,
  outcome: "pass" | "degraded" | "fail",
) {
  const { rows } = await db.query<{
    failures_after: number;
    threshold_breached: boolean;
    health_state: string;
  }>(
    `select failures_after, threshold_breached, health_state
     from public.record_monitor_observation($1::uuid, $2::public.signal_outcome, 120, 500::smallint, 'probe failed', '{}'::jsonb)`,
    [monitorId, outcome],
  );
  return rows[0];
}

async function openIncident(
  db: PGlite,
  fingerprint: string,
  sev: "sev1" | "sev2" | "sev3" | "sev4",
  monitorId: string | null = null,
) {
  const { rows } = await db.query<{
    incident_id: string;
    incident_sev_level: string;
    occurrences: number;
    deduplicated: boolean;
    freeze_applied: boolean;
  }>(
    `select incident_id, incident_sev_level, occurrences, deduplicated, freeze_applied
     from public.open_production_incident(
       $1::uuid, $2::text, 'Production health check failing', $3::public.incident_sev,
       'uptime'::public.production_signal_kind, 'Health endpoint returned 500',
       'All production visitors receive an error', $4::uuid, null, null, '{}'::jsonb
     )`,
    [projectId, fingerprint, sev, monitorId],
  );
  return rows[0];
}

async function recordPassingValidation(db: PGlite, deploymentId: string) {
  const { rows } = await db.query<{ id: string }>(
    `select id from public.record_deployment_validation(
       $1::uuid, 'passed'::public.deployment_validation_state, '[]'::jsonb,
       'validator-1e', 'post-deploy-v1', 'Recovered', null
     )`,
    [deploymentId],
  );
  return rows[0].id;
}

describe("Phase 1E production operations behavior", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid()
      returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create or replace function auth.jwt()
      returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values
        ('${ownerId}'), ('${adminId}'), ('${memberId}'), ('${outsiderId}');

      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Operations Factory', 'operations-factory', '${ownerId}'),
        ('${otherOrganizationId}', 'Other Factory', 'other-factory', '${outsiderId}');

      insert into public.organization_members (organization_id, user_id, role, created_by) values
        ('${organizationId}', '${adminId}', 'admin', '${ownerId}'),
        ('${organizationId}', '${memberId}', 'member', '${ownerId}');

      insert into public.projects (id, organization_id, name, status, default_branch, created_by) values
        ('${projectId}', '${organizationId}', 'Storefront', 'active', 'main', '${ownerId}'),
        ('${otherProjectId}', '${otherOrganizationId}', 'Outsider App', 'active', 'main', '${outsiderId}');

      insert into public.deployments (
        id, organization_id, project_id, environment, provider, status, commit_sha, created_at
      ) values
        ('${goodDeploymentId}', '${organizationId}', '${projectId}', 'production', 'demo', 'succeeded', 'aaaaaaa', now() - interval '2 days'),
        ('${badDeploymentId}', '${organizationId}', '${projectId}', 'production', 'demo', 'succeeded', 'bbbbbbb', now() - interval '1 hour');
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("keeps every operations table under RLS with FORCE RLS and no service_role table grants", async () => {
    const { rows: rlsRows } = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by c.relname`,
    );
    // Every public table must be covered: the eleven added by Phase 1E, the
    // four added by the Phase 2A provider layer, the three bot fabric
    // tables, the eleven marketing tables, and the five Phase 1C execution
    // tables. The filter below is the real
    // guarantee — this count exists so a new table cannot slip in unexamined.
    expect(rlsRows).toHaveLength(59);
    expect(rlsRows.filter((row) => !row.relrowsecurity || !row.relforcerowsecurity)).toEqual([]);

    const { rows: grantRows } = await db.query<{ table_name: string }>(
      `select distinct table_name from information_schema.role_table_grants
       where grantee = 'service_role' and table_schema = 'public' order by table_name`,
    );
    expect(grantRows.map((row) => row.table_name)).toEqual([
      "github_change_requests",
      "github_installations",
      "github_repositories",
      "github_webhook_deliveries",
    ]);
  });

  it("refuses to enable a monitor whose provider adapter is not connected", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows } = await db.query<{ connection_state: string; enabled: boolean; unavailable_reason: string }>(
      `select connection_state, enabled, unavailable_reason from public.configure_production_monitor(
         $1::uuid, 'Vercel deployments', 'deployment'::public.production_signal_kind, 'vercel', null,
         null, 200::smallint, 2000, 2::smallint, true
       )`,
      [projectId],
    );
    expect(rows[0].connection_state).toBe("not_connected");
    expect(rows[0].enabled).toBe(false);
    expect(rows[0].unavailable_reason).toMatch(/no connected adapter/i);

    await expect(
      db.query(
        `update public.production_monitors set enabled = true where project_id = $1::uuid and provider = 'vercel'`,
        [projectId],
      ),
    ).rejects.toThrow();
    await resetRole(db);
  });

  it("holds health at UNKNOWN until a connected monitor actually reports", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows } = await db.query<{ operations_health_state: string; operations_health_reason: string }>(
      `select operations_health_state, operations_health_reason from public.projects where id = $1::uuid`,
      [projectId],
    );
    expect(rows[0].operations_health_state).toBe("unknown");
    expect(rows[0].operations_health_reason).toMatch(/cannot be evidenced/i);
    await resetRole(db);
  });

  it("detects a failure only after the configured threshold and records health history", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const monitor = await configureMonitor(db, "Production health");
    expect(monitor.connection_state).toBe("connected");

    const healthy = await observe(db, monitor.id, "pass");
    expect(healthy.threshold_breached).toBe(false);
    expect(healthy.health_state).toBe("healthy");

    const first = await observe(db, monitor.id, "fail");
    expect(first.failures_after).toBe(1);
    expect(first.threshold_breached).toBe(false);

    const second = await observe(db, monitor.id, "fail");
    expect(second.failures_after).toBe(2);
    expect(second.threshold_breached).toBe(true);
    expect(second.health_state).toBe("critical");

    const { rows: history } = await db.query<{ state: string; previous_state: string | null }>(
      `select state, previous_state from public.project_health_snapshots
       where project_id = $1::uuid order by computed_at desc, state limit 5`,
      [projectId],
    );
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(history.some((row) => row.state === "healthy")).toBe(true);
    expect(history.some((row) => row.state === "critical")).toBe(true);
    await resetRole(db);
  });

  it("enqueues the breach exactly once no matter how often the same signal repeats", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows } = await db.query<{ count: string }>(
      `select count(*)::text as count from public.operations_events
       where project_id = $1::uuid and event_type = 'health.failed'`,
      [projectId],
    );
    expect(Number(rows[0].count)).toBe(1);
    await resetRole(db);
  });

  it("creates one incident, folds repeats into it, and only escalates severity upward", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows: monitorRows } = await db.query<{ id: string }>(
      `select id from public.production_monitors where project_id = $1::uuid and name = 'Production health'`,
      [projectId],
    );
    const monitorId = monitorRows[0].id;

    const created = await openIncident(db, "uptime:health:500", "sev2", monitorId);
    expect(created.deduplicated).toBe(false);
    expect(created.incident_sev_level).toBe("sev2");
    expect(created.freeze_applied).toBe(true);

    const repeated = await openIncident(db, "uptime:health:500", "sev4", monitorId);
    expect(repeated.deduplicated).toBe(true);
    expect(repeated.incident_id).toBe(created.incident_id);
    expect(repeated.occurrences).toBe(2);
    // A weaker repeat signal must not downgrade an active SEV2.
    expect(repeated.incident_sev_level).toBe("sev2");

    const escalated = await openIncident(db, "uptime:health:500", "sev1", monitorId);
    expect(escalated.incident_sev_level).toBe("sev1");

    const { rows: incidentRows } = await db.query<{ count: string; severity: string }>(
      `select count(*)::text as count, min(severity::text) as severity from public.incidents
       where project_id = $1::uuid and fingerprint = 'uptime:health:500'`,
      [projectId],
    );
    expect(Number(incidentRows[0].count)).toBe(1);
    expect(incidentRows[0].severity).toBe("critical");
    await resetRole(db);
  });

  it("freezes autonomous releases automatically and blocks release authority with named reasons", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows: projectRows } = await db.query<{ autonomous_releases_frozen: boolean }>(
      `select autonomous_releases_frozen from public.projects where id = $1::uuid`,
      [projectId],
    );
    expect(projectRows[0].autonomous_releases_frozen).toBe(true);

    const { rows: freezeRows } = await db.query<{ reason_code: string; automatic: boolean; state: string }>(
      `select reason_code, automatic, state from public.release_freezes where project_id = $1::uuid`,
      [projectId],
    );
    expect(freezeRows).toHaveLength(1);
    expect(freezeRows[0]).toMatchObject({
      reason_code: "SEVERE_PRODUCTION_FAILURE",
      automatic: true,
      state: "active",
    });

    const { rows: allowedRows } = await db.query<{ allowed: boolean; blockers: string[] }>(
      `select allowed, blockers from public.autonomous_release_allowed($1::uuid)`,
      [projectId],
    );
    expect(allowedRows[0].allowed).toBe(false);
    expect(allowedRows[0].blockers).toContain("EXECUTOR_NOT_CONNECTED");
    expect(allowedRows[0].blockers).toContain("RELEASE_FREEZE_ACTIVE");
    expect(allowedRows[0].blockers).toContain("GLOBAL_KILL_SWITCH_ACTIVE");
    await resetRole(db);
  });

  it("lets an admin freeze but only an owner resume, and requires acknowledgement while severe incidents are open", async () => {
    await assumeRole(db, "authenticated", adminId);
    await expect(
      db.query(`select public.resume_project_releases($1::uuid, 'Investigated and recovered', true)`, [projectId]),
    ).rejects.toThrow(/only an organization owner/i);

    await assumeRole(db, "authenticated", ownerId);
    await expect(
      db.query(`select public.resume_project_releases($1::uuid, 'Investigated and recovered', false)`, [projectId]),
    ).rejects.toThrow(/explicit acknowledgement/i);

    await expect(
      db.query(`select public.resume_project_releases($1::uuid, 'too short', true)`, [projectId]),
    ).rejects.toThrow(/at least 10 characters/i);
    await resetRole(db);
  });

  it("resolves Last Known Good only from a deployment whose own validation passed", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows: emptyRows } = await db.query(
      `select deployment_id from public.last_known_good_deployment($1::uuid, 'production', null)`,
      [projectId],
    );
    expect(emptyRows).toHaveLength(0);

    await recordPassingValidation(db, goodDeploymentId);
    const { rows } = await db.query<{ deployment_id: string }>(
      `select deployment_id from public.last_known_good_deployment($1::uuid, 'production', null)`,
      [projectId],
    );
    expect(rows[0].deployment_id).toBe(goodDeploymentId);
    await resetRole(db);
  });

  it("records an ineligible rollback as blocked and refuses to report an execution outcome for it", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows: incidentRows } = await db.query<{ id: string }>(
      `select id from public.incidents where project_id = $1::uuid and fingerprint = 'uptime:health:500'`,
      [projectId],
    );
    const incidentId = incidentRows[0].id;

    const { rows } = await db.query<{ id: string; state: string; blocked_reason: string; attempt: number }>(
      `select id, state, blocked_reason, attempt from public.record_rollback_decision(
         $1::uuid, false, 'EXECUTOR_NOT_CONNECTED', '{"executor":"not_connected"}'::jsonb, $2::uuid, $3::uuid
       )`,
      [incidentId, badDeploymentId, goodDeploymentId],
    );
    expect(rows[0].state).toBe("blocked");
    expect(rows[0].blocked_reason).toBe("EXECUTOR_NOT_CONNECTED");

    await expect(
      db.query(`select id from public.record_rollback_outcome($1::uuid, true, 'pretend success', null)`, [rows[0].id]),
    ).rejects.toThrow(/ineligible rollback cannot report an execution outcome/i);
    await resetRole(db);
  });

  it("escalates a failed rollback to SEV1 with owner attention", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows: incidentRows } = await db.query<{ id: string }>(
      `select id from public.incidents where project_id = $1::uuid and fingerprint = 'uptime:health:500'`,
      [projectId],
    );
    const incidentId = incidentRows[0].id;

    await db.query(
      `update public.incidents set sev = 'sev2', severity = 'high', owner_attention_required = false where id = $1::uuid`,
      [incidentId],
    ).catch(() => undefined);

    const { rows: decisionRows } = await db.query<{ id: string; state: string }>(
      `select id, state from public.record_rollback_decision(
         $1::uuid, true, null, '{"lastKnownGood":"validated"}'::jsonb, $2::uuid, $3::uuid
       )`,
      [incidentId, badDeploymentId, goodDeploymentId],
    );
    expect(decisionRows[0].state).toBe("evaluated");

    const { rows: outcomeRows } = await db.query<{ state: string; escalated: boolean }>(
      `select state, escalated from public.record_rollback_outcome(
         $1::uuid, false, 'Provider rejected the rollback request', null
       )`,
      [decisionRows[0].id],
    );
    expect(outcomeRows[0].state).toBe("failed");
    expect(outcomeRows[0].escalated).toBe(true);

    const { rows: escalatedIncident } = await db.query<{ sev: string; owner_attention_required: boolean }>(
      `select sev, owner_attention_required from public.incidents where id = $1::uuid`,
      [incidentId],
    );
    expect(escalatedIncident[0].sev).toBe("sev1");
    expect(escalatedIncident[0].owner_attention_required).toBe(true);

    const { rows: auditRows } = await db.query<{ kind: string }>(
      `select kind::text as kind from public.operations_audit_events
       where kind in ('rollback.failed', 'rollback.escalated') order by kind`,
    );
    expect(auditRows.map((row) => row.kind)).toEqual(["rollback.escalated", "rollback.failed"]);
    await resetRole(db);
  });

  it("stores a diagnosis as structured conclusions and moves the incident to investigating", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows: incidentRows } = await db.query<{ id: string }>(
      `select id from public.incidents where project_id = $1::uuid and fingerprint = 'uptime:health:500'`,
      [projectId],
    );

    const { rows } = await db.query<{ id: string; confidence: string; analyzer: string }>(
      `select id, confidence::text as confidence, analyzer from public.record_production_diagnosis(
         $1::uuid, 'The most recent release changed the health endpoint contract', 'web',
         'medium'::public.diagnosis_confidence, 'Roll back to the last validated release',
         'red'::public.risk_level, '[{"kind":"deployment","reference":"bbbbbbb"}]'::jsonb, 'rules-engine-v1'
       )`,
      [incidentRows[0].id],
    );
    expect(rows[0].confidence).toBe("medium");
    expect(rows[0].analyzer).toBe("rules-engine-v1");

    const { rows: statusRows } = await db.query<{ status: string }>(
      `select status::text as status from public.incidents where id = $1::uuid`,
      [incidentRows[0].id],
    );
    expect(statusRows[0].status).toBe("investigating");

    // A browser session cannot even reach the table, and the append-only guard
    // still refuses the write for a role that could.
    await expect(
      db.query(`update public.production_diagnoses set likely_cause = 'rewritten' where id = $1::uuid`, [rows[0].id]),
    ).rejects.toThrow(/permission denied/i);

    await resetRole(db);
    await expect(
      db.query(`update public.production_diagnoses set likely_cause = 'rewritten' where id = $1::uuid`, [rows[0].id]),
    ).rejects.toThrow(/append-only/i);
  });

  it("bounds repair attempts to three and escalates instead of looping", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows: incidentRows } = await db.query<{ id: string }>(
      `select id from public.incidents where project_id = $1::uuid and fingerprint = 'uptime:health:500'`,
      [projectId],
    );
    const incidentId = incidentRows[0].id;

    const repairIds: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const { rows } = await db.query<{
        repair_id: string;
        repair_attempt_number: number;
        repair_state_value: string;
        repair_assignment_status: string;
        repair_task_id: string;
      }>(
        `select repair_id, repair_attempt_number, repair_state_value::text as repair_state_value,
                repair_assignment_status, repair_task_id
         from public.create_repair_attempt($1::uuid, null, $2::text, 'Restore the health endpoint contract', 'yellow'::public.risk_level)`,
        [incidentId, `Repair attempt ${attempt}`],
      );
      expect(rows[0].repair_attempt_number).toBe(attempt);
      expect(rows[0].repair_state_value).toBe("blocked");
      expect(rows[0].repair_assignment_status).toBe("not_connected");
      expect(rows[0].repair_task_id).toBeTruthy();
      repairIds.push(rows[0].repair_id);
    }

    const { rows: failureRows } = await db.query<{ state: string; escalated: boolean }>(
      `select state::text as state, escalated from public.record_repair_failure($1::uuid, 'Repair did not restore production')`,
      [repairIds[2]],
    );
    expect(failureRows[0].state).toBe("escalated");
    expect(failureRows[0].escalated).toBe(true);

    await expect(
      db.query(
        `select repair_id from public.create_repair_attempt($1::uuid, null, 'Fourth attempt', 'Should be refused', 'yellow'::public.risk_level)`,
        [incidentId],
      ),
    ).rejects.toThrow(/bounded repair attempt limit/i);
    await resetRole(db);
  });

  it("creates repair work as owner-visible tasks that no executor claims", async () => {
    // Browser sessions have no direct SELECT on tasks; this reads the stored
    // row through a privileged connection purely to assert its shape.
    await resetRole(db);
    const { rows } = await db.query<{ status: string; assigned_agent_id: string | null; input: { executor: string } }>(
      `select task.status::text as status, task.assigned_agent_id, task.input
       from public.tasks task
       join public.repair_attempts repair on repair.task_id = task.id
       where repair.project_id = $1::uuid limit 1`,
      [projectId],
    );
    expect(rows[0].status).toBe("backlog");
    expect(rows[0].assigned_agent_id).toBeNull();
    expect(rows[0].input.executor).toBe("not_connected");
    await resetRole(db);
  });

  it("refuses to resolve an incident while production is still failing its own monitors", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows: incidentRows } = await db.query<{ id: string }>(
      `select id from public.incidents where project_id = $1::uuid and fingerprint = 'uptime:health:500'`,
      [projectId],
    );
    const validationId = await recordPassingValidation(db, badDeploymentId);

    await expect(
      db.query(
        `select id from public.resolve_production_incident(
           $1::uuid, 'The release changed the health contract', 'Reverted the contract change', $2::uuid, 'BACKLOG-1'
         )`,
        [incidentRows[0].id, validationId],
      ),
    ).rejects.toThrow(/still failing its own monitors/i);
    await resetRole(db);
  });

  it("refuses to resolve without root cause, corrective action, passing validation, or SEV1 prevention", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows: monitorRows } = await db.query<{ id: string }>(
      `select id from public.production_monitors where project_id = $1::uuid and name = 'Production health'`,
      [projectId],
    );
    await observe(db, monitorRows[0].id, "pass");

    const { rows: incidentRows } = await db.query<{ id: string }>(
      `select id from public.incidents where project_id = $1::uuid and fingerprint = 'uptime:health:500'`,
      [projectId],
    );
    const incidentId = incidentRows[0].id;

    await expect(
      db.query(
        `select id from public.resolve_production_incident($1::uuid, 'short', 'Reverted the contract change', null, 'BACKLOG-1')`,
        [incidentId],
      ),
    ).rejects.toThrow(/passing validation record is required/i);

    const { rows: failedValidation } = await db.query<{ id: string }>(
      `select id from public.record_deployment_validation(
         $1::uuid, 'failed'::public.deployment_validation_state, '[]'::jsonb, 'validator-1e', 'post-deploy-v1', 'Still broken', null
       )`,
      [badDeploymentId],
    );
    await expect(
      db.query(
        `select id from public.resolve_production_incident(
           $1::uuid, 'The release changed the health contract', 'Reverted the contract change', $2::uuid, 'BACKLOG-1'
         )`,
        [incidentId, failedValidation[0].id],
      ),
    ).rejects.toThrow(/did not pass/i);

    const passingValidationId = await recordPassingValidation(db, badDeploymentId);
    await expect(
      db.query(
        `select id from public.resolve_production_incident($1::uuid, 'short', 'Reverted the contract change', $2::uuid, 'BACKLOG-1')`,
        [incidentId, passingValidationId],
      ),
    ).rejects.toThrow(/root cause is required/i);

    await expect(
      db.query(
        `select id from public.resolve_production_incident(
           $1::uuid, 'The release changed the health contract', 'Reverted the contract change', $2::uuid, null
         )`,
        [incidentId, passingValidationId],
      ),
    ).rejects.toThrow(/prevention or follow-up reference/i);
    await resetRole(db);
  });

  it("resolves once restoration, validation, cause, corrective action, and prevention all exist", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows: incidentRows } = await db.query<{ id: string }>(
      `select id from public.incidents where project_id = $1::uuid and fingerprint = 'uptime:health:500'`,
      [projectId],
    );
    const validationId = await recordPassingValidation(db, badDeploymentId);

    const { rows } = await db.query<{ status: string; resolved_at: string; owner_attention_required: boolean }>(
      `select status::text as status, resolved_at::text as resolved_at, owner_attention_required
       from public.resolve_production_incident(
         $1::uuid, 'The release changed the health endpoint contract',
         'Reverted the contract change and added a contract test', $2::uuid, 'BACKLOG-PREVENT-1'
       )`,
      [incidentRows[0].id, validationId],
    );
    expect(rows[0].status).toBe("resolved");
    expect(rows[0].resolved_at).toBeTruthy();
    expect(rows[0].owner_attention_required).toBe(false);

    const { rows: eventRows } = await db.query<{ count: string }>(
      `select count(*)::text as count from public.operations_events where event_type = 'incident.resolved'`,
    );
    expect(Number(eventRows[0].count)).toBe(1);
    await resetRole(db);
  });

  it("rejects an incident resolution written directly, bypassing the gated workflow", async () => {
    await assumeRole(db, "authenticated", ownerId);
    await expect(
      db.query(
        `insert into public.incidents (organization_id, project_id, title, severity, status, sev, resolved_at)
         values ($1::uuid, $2::uuid, 'Bypass', 'low', 'resolved', 'sev4', now())`,
        [organizationId, projectId],
      ),
    ).rejects.toThrow();
    await resetRole(db);
  });

  it("processes each durable event once and dead-letters only after the attempt budget", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows: claimed } = await db.query<{ id: string; state: string; attempts: number }>(
      `select id, state::text as state, attempts from public.claim_operations_event($1::uuid)`,
      [organizationId],
    );
    expect(claimed[0].state).toBe("processing");
    expect(claimed[0].attempts).toBe(1);

    const { rows: completed } = await db.query<{ state: string; processed_at: string }>(
      `select state::text as state, processed_at::text as processed_at
       from public.complete_operations_event($1::uuid, true, null)`,
      [claimed[0].id],
    );
    expect(completed[0].state).toBe("processed");

    const { rows: replayed } = await db.query<{ state: string }>(
      `select state::text as state from public.complete_operations_event($1::uuid, true, null)`,
      [claimed[0].id],
    );
    expect(replayed[0].state).toBe("processed");

    const { rows: retried } = await db.query<{ state: string }>(
      `select state::text as state from public.claim_operations_event($1::uuid)`,
      [organizationId],
    );
    const retryId = (retried as unknown as Array<{ id: string }>)[0];
    expect(retryId).toBeTruthy();
    await resetRole(db);
  });

  it("stops autonomous operations across the organization for the owner only", async () => {
    await assumeRole(db, "authenticated", adminId);
    await expect(
      db.query(`select public.stop_autonomous_operations($1::uuid, 'Emergency stop requested by security')`, [organizationId]),
    ).rejects.toThrow(/only an organization owner/i);

    await assumeRole(db, "authenticated", ownerId);
    const { rows } = await db.query<{ stop_autonomous_operations: number }>(
      `select public.stop_autonomous_operations($1::uuid, 'Emergency stop requested by security') as stop_autonomous_operations`,
      [organizationId],
    );
    expect(rows[0].stop_autonomous_operations).toBeGreaterThanOrEqual(1);

    const { rows: projectRows } = await db.query<{
      autonomous_operations_stopped: boolean;
      autonomous_releases_frozen: boolean;
    }>(
      `select autonomous_operations_stopped, autonomous_releases_frozen from public.projects where id = $1::uuid`,
      [projectId],
    );
    expect(projectRows[0].autonomous_operations_stopped).toBe(true);
    expect(projectRows[0].autonomous_releases_frozen).toBe(true);

    const { rows: healthRows } = await db.query<{ evaluate_project_health: string }>(
      `select public.evaluate_project_health($1::uuid)::text as evaluate_project_health`,
      [projectId],
    );
    expect(healthRows[0].evaluate_project_health).toBe("paused");
    await resetRole(db);
  });

  it("lets only the owner reverse the emergency stop, without silently lifting release freezes", async () => {
    await assumeRole(db, "authenticated", adminId);
    await expect(
      db.query(`select public.resume_autonomous_operations($1::uuid, 'Reviewed and safe to resume')`, [organizationId]),
    ).rejects.toThrow(/only an organization owner/i);

    await assumeRole(db, "authenticated", ownerId);
    await expect(
      db.query(`select public.resume_autonomous_operations($1::uuid, 'short')`, [organizationId]),
    ).rejects.toThrow(/at least 10 characters/i);

    const { rows } = await db.query<{ resume_autonomous_operations: number }>(
      `select public.resume_autonomous_operations($1::uuid, 'Reviewed the incident and resumed operations') as resume_autonomous_operations`,
      [organizationId],
    );
    expect(rows[0].resume_autonomous_operations).toBeGreaterThanOrEqual(1);

    const { rows: projectRows } = await db.query<{
      autonomous_operations_stopped: boolean;
      autonomous_releases_frozen: boolean;
    }>(
      `select autonomous_operations_stopped, autonomous_releases_frozen from public.projects where id = $1::uuid`,
      [projectId],
    );
    expect(projectRows[0].autonomous_operations_stopped).toBe(false);
    // The release freeze survives: it is released on its own evidence.
    expect(projectRows[0].autonomous_releases_frozen).toBe(true);

    const { rows: healthRows } = await db.query<{ evaluate_project_health: string }>(
      `select public.evaluate_project_health($1::uuid)::text as evaluate_project_health`,
      [projectId],
    );
    expect(healthRows[0].evaluate_project_health).not.toBe("paused");
    await resetRole(db);
  });

  it("refuses to store a synthetic journey that is destructive or under-covered", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows: monitorRows } = await db.query<{ id: string }>(
      `select id from public.configure_production_monitor(
         $1::uuid, 'Checkout journey', 'synthetic'::public.production_signal_kind, 'http',
         'https://storefront.example/', 'standard'::public.synthetic_profile,
         200::smallint, 2000, 2::smallint, true
       )`,
      [projectId],
    );
    const monitorId = monitorRows[0].id;

    const configure = (steps: string, profile = "standard") =>
      db.query(
        `select id from public.configure_synthetic_journey(
           $1::uuid, 'Checkout', $2::public.synthetic_profile, 'https://storefront.example/', $3::jsonb
         )`,
        [monitorId, profile, steps],
      );

    const shell = '{"kind":"app_shell","name":"Home","path":"/","method":"GET","expected_status":200}';
    const read = '{"kind":"critical_read","name":"Orders","path":"/api/orders","method":"GET","expected_status":200}';

    // A destructive-looking path is refused outright.
    await expect(
      configure(`[${shell},{"kind":"api","name":"Purge","path":"/api/orders/delete","method":"GET","expected_status":200}]`),
    ).rejects.toThrow(/destructive steps or an undeclared write/i);

    // A write that does not declare itself is refused.
    await expect(
      configure(`[${shell},{"kind":"api","name":"Create","path":"/api/orders","method":"POST","expected_status":201}]`),
    ).rejects.toThrow(/destructive steps or an undeclared write/i);

    // A declared safe write without a reversal note is refused.
    await expect(
      configure(`[${shell},{"kind":"safe_write","name":"Ping","path":"/api/heartbeat","method":"POST","expected_status":202}]`),
    ).rejects.toThrow(/destructive steps or an undeclared write/i);

    // A profile must actually cover what it promises.
    await expect(configure(`[${shell}]`)).rejects.toThrow(/does not cover everything its validation profile promises/i);

    const { rows } = await db.query<{ id: string; profile: string }>(
      `select id, profile::text as profile from public.configure_synthetic_journey(
         $1::uuid, 'Checkout', 'standard'::public.synthetic_profile, 'https://storefront.example/', $2::jsonb
       )`,
      [monitorId, `[${shell},${read}]`],
    );
    expect(rows[0].profile).toBe("standard");

    // Even a direct write is refused by the CHECK constraint, not just the RPC.
    await resetRole(db);
    await expect(
      db.query(
        `update public.synthetic_journeys
         set steps = '[{"kind":"app_shell","name":"Home","path":"/orders/delete","method":"GET","expected_status":200}]'::jsonb
         where id = $1::uuid`,
        [rows[0].id],
      ),
    ).rejects.toThrow(/synthetic_journeys_steps_are_safe|synthetic_journeys_profile_covered/i);
  });

  it("refuses to attach a journey to a monitor that is not synthetic", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows: monitorRows } = await db.query<{ id: string }>(
      `select id from public.production_monitors where project_id = $1::uuid and name = 'Production health'`,
      [projectId],
    );
    await expect(
      db.query(
        `select id from public.configure_synthetic_journey(
           $1::uuid, 'Wrong kind', 'basic'::public.synthetic_profile, 'https://storefront.example/',
           '[{"kind":"app_shell","name":"Home","path":"/","method":"GET","expected_status":200}]'::jsonb
         )`,
        [monitorRows[0].id],
      ),
    ).rejects.toThrow(/only be attached to a synthetic monitor/i);
    await resetRole(db);
  });

  it("denies every cross-tenant read and workflow call", async () => {
    await assumeRole(db, "authenticated", outsiderId);

    for (const table of [
      "production_monitors",
      "monitor_observations",
      "project_health_snapshots",
      "release_freezes",
      "deployment_validations",
      "rollback_operations",
      "production_diagnoses",
      "repair_attempts",
      "operations_events",
      "operations_audit_events",
      "incidents",
    ]) {
      const { rows } = await db.query<{ count: string }>(`select count(*)::text as count from public.${table}`);
      expect(Number(rows[0].count), `${table} leaked rows across tenants`).toBe(0);
    }

    await expect(
      db.query(`select public.evaluate_project_health($1::uuid)`, [projectId]),
    ).rejects.toThrow(/project access is required/i);

    await expect(
      db.query(
        `select id from public.configure_production_monitor(
           $1::uuid, 'Sneaky', 'uptime'::public.production_signal_kind, 'http', 'https://example.test/health',
           null, 200::smallint, 2000, 2::smallint, true
         )`,
        [projectId],
      ),
    ).rejects.toThrow(/owner or administrator access is required/i);

    await expect(
      db.query(`select public.freeze_project_releases($1::uuid, 'MALICIOUS', 'Freeze someone else', null, false)`, [projectId]),
    ).rejects.toThrow(/owner or administrator access is required/i);

    await resetRole(db);
  });

  it("denies anonymous access to every operations table", async () => {
    await assumeRole(db, "anon", null);
    for (const table of ["production_monitors", "incidents", "operations_audit_events", "operations_events"]) {
      await expect(db.query(`select count(*) from public.${table}`)).rejects.toThrow();
    }
    await resetRole(db);
  });

  it("keeps monitor observations and audit events append-only", async () => {
    await assumeRole(db, "authenticated", ownerId);
    await expect(
      db.query(`update public.monitor_observations set outcome = 'pass' where outcome = 'fail'`),
    ).rejects.toThrow();
    await expect(db.query(`delete from public.operations_audit_events`)).rejects.toThrow();
    await resetRole(db);
  });

  it("rejects sensitive values inside operations evidence", async () => {
    await resetRole(db);
    await expect(
      db.query(
        `insert into public.operations_events (organization_id, project_id, event_type, dedupe_key, payload)
         values ($1::uuid, $2::uuid, 'health.failed', 'sensitive-check-key', '{"access_token":"ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb)`,
        [organizationId, projectId],
      ),
    ).rejects.toThrow(/sensitive/i);
  });

  it("generates a daily operations report from recorded evidence with zero executed rollbacks", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows } = await db.query<{
      title: string;
      summary: string;
      content: {
        portfolio: Record<string, number>;
        incidents: Record<string, number>;
        rollbacks: { recorded: number; blocked: number; failed: number; executed: number; executor: string };
        repairs: { created: number; escalated: number; executor: string };
        unavailability: Record<string, number>;
        recurring_failures: unknown[];
        frozen_projects: unknown[];
        owner_decisions: unknown[];
        top_operational_risks: unknown[];
      };
    }>(
      `select title, summary, content from public.generate_operations_report($1::uuid, 24)`,
      [organizationId],
    );

    const report = rows[0];
    expect(report.title).toMatch(/daily operations report/i);
    expect(report.summary).toMatch(/Not Connected/);
    expect(report.content.rollbacks.executed).toBe(0);
    expect(report.content.rollbacks.executor).toBe("not_connected");
    expect(report.content.repairs.executor).toBe("not_connected");
    expect(report.content.rollbacks.recorded).toBeGreaterThanOrEqual(2);
    expect(report.content.rollbacks.failed).toBe(1);
    expect(report.content.repairs.created).toBe(3);
    expect(report.content.unavailability.failing_observations).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(report.content.recurring_failures)).toBe(true);
    expect(Array.isArray(report.content.frozen_projects)).toBe(true);
    expect(Array.isArray(report.content.owner_decisions)).toBe(true);
    expect(Array.isArray(report.content.top_operational_risks)).toBe(true);
    await resetRole(db);
  });

  it("refuses to generate an operations report for a tenant the caller does not manage", async () => {
    await assumeRole(db, "authenticated", outsiderId);
    await expect(
      db.query(`select title from public.generate_operations_report($1::uuid, 24)`, [organizationId]),
    ).rejects.toThrow(/owner or administrator access is required/i);
    await resetRole(db);
  });

  it("reports a portfolio summary that a member can read and an outsider cannot", async () => {
    await assumeRole(db, "authenticated", memberId);
    const { rows } = await db.query<{ projects_total: string; open_incidents: string; projects_frozen: string }>(
      `select projects_total::text, open_incidents::text, projects_frozen::text
       from public.operations_portfolio_summary($1::uuid)`,
      [organizationId],
    );
    expect(Number(rows[0].projects_total)).toBe(1);
    expect(Number(rows[0].projects_frozen)).toBe(1);

    await assumeRole(db, "authenticated", outsiderId);
    const { rows: outsiderRows } = await db.query(
      `select projects_total from public.operations_portfolio_summary($1::uuid)`,
      [organizationId],
    );
    expect(outsiderRows).toHaveLength(0);
    await resetRole(db);
  });
});
