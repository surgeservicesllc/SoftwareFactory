// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The Phase 1E completion demonstration, run as one ordered journey.
 *
 * Production failure -> Detect -> Incident -> Freeze -> Rollback decision ->
 * Diagnose -> Repair work -> Validate -> Resolve, plus the failed-rollback
 * escalation path on a second incident.
 *
 * Two stages of the stated target are deliberately absent and asserted as
 * blocked rather than faked: the Codex fix (no execution worker) and the
 * deploy (no deployment adapter). The journey records those blockers instead
 * of skipping past them.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000f0001";
const organizationId = "10000000-0000-4000-8000-0000000f0001";
const projectId = "40000000-0000-4000-8000-0000000f0001";
const goodDeploymentId = "80000000-0000-4000-8000-0000000f0001";
const badDeploymentId = "80000000-0000-4000-8000-0000000f0002";

type JourneyStage = { stage: string; detail: string };

describe("Phase 1E end-to-end incident journey", () => {
  let db: PGlite;
  const journey: JourneyStage[] = [];

  function record(stage: string, detail: string) {
    journey.push({ stage, detail });
  }

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
      insert into auth.users (id) values ('${ownerId}');
      insert into public.organizations (id, name, slug, created_by)
        values ('${organizationId}', 'Journey Factory', 'journey-factory', '${ownerId}');
      insert into public.projects (id, organization_id, name, status, default_branch, created_by)
        values ('${projectId}', '${organizationId}', 'Storefront', 'active', 'main', '${ownerId}');
      insert into public.deployments (
        id, organization_id, project_id, environment, provider, status, commit_sha, created_at
      ) values
        ('${goodDeploymentId}', '${organizationId}', '${projectId}', 'production', 'demo', 'succeeded', 'aaaaaaa', now() - interval '3 days'),
        ('${badDeploymentId}', '${organizationId}', '${projectId}', 'production', 'demo', 'succeeded', 'bbbbbbb', now() - interval '30 minutes');
    `);

    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
    await db.exec("set role authenticated");
  });

  afterAll(async () => {
    await db.close();
  });

  it("walks the full journey from a real failing signal to a gated resolution", async () => {
    // --- Monitor -------------------------------------------------------
    const { rows: monitorRows } = await db.query<{ id: string; connection_state: string }>(
      `select id, connection_state from public.configure_production_monitor(
         $1::uuid, 'Production health', 'uptime'::public.production_signal_kind, 'http',
         'https://storefront.example/health', null, 200::smallint, 2000, 2::smallint, true
       )`,
      [projectId],
    );
    const monitorId = monitorRows[0].id;
    expect(monitorRows[0].connection_state).toBe("connected");
    record("Monitor", "One connected HTTPS monitor is enabled for the project.");

    // The last validated release becomes Last Known Good.
    const { rows: goodValidation } = await db.query<{ id: string }>(
      `select id from public.record_deployment_validation(
         $1::uuid, 'passed'::public.deployment_validation_state, '[]'::jsonb,
         'validator-1e', 'post-deploy-v1', 'Baseline release validated', null
       )`,
      [goodDeploymentId],
    );
    expect(goodValidation[0].id).toBeTruthy();

    // --- Detect --------------------------------------------------------
    const observe = async (outcome: "pass" | "fail") => {
      const { rows } = await db.query<{ threshold_breached: boolean; health_state: string; failures_after: number }>(
        `select threshold_breached, health_state, failures_after
         from public.record_monitor_observation($1::uuid, $2::public.signal_outcome, 90, 503::smallint, 'Expected HTTP 200 but received 503.', '{}'::jsonb)`,
        [monitorId, outcome],
      );
      return rows[0];
    };

    expect((await observe("pass")).health_state).toBe("healthy");
    expect((await observe("fail")).threshold_breached).toBe(false);
    const breach = await observe("fail");
    expect(breach.threshold_breached).toBe(true);
    expect(breach.health_state).toBe("critical");
    record("Detect", "Two consecutive failures breached the threshold; health became CRITICAL.");

    // --- Classify and open the incident --------------------------------
    const { rows: incidentRows } = await db.query<{
      incident_id: string;
      incident_sev_level: string;
      freeze_applied: boolean;
      deduplicated: boolean;
    }>(
      `select incident_id, incident_sev_level, freeze_applied, deduplicated
       from public.open_production_incident(
         $1::uuid, 'uptime:storefront:status-503', 'Storefront health is failing',
         'sev1'::public.incident_sev, 'uptime'::public.production_signal_kind,
         'Expected HTTP 200 but received 503.', 'Production is unavailable for all users.',
         $2::uuid, $3::uuid, 'bbbbbbb', '{"status_code": 503}'::jsonb
       )`,
      [projectId, monitorId, badDeploymentId],
    );
    const incidentId = incidentRows[0].incident_id;
    expect(incidentRows[0].incident_sev_level).toBe("sev1");
    expect(incidentRows[0].deduplicated).toBe(false);
    record("Incident", "One SEV1 incident opened, attributed to the failing deployment.");

    // --- Protect -------------------------------------------------------
    expect(incidentRows[0].freeze_applied).toBe(true);
    const { rows: frozen } = await db.query<{ autonomous_releases_frozen: boolean }>(
      `select autonomous_releases_frozen from public.projects where id = $1::uuid`,
      [projectId],
    );
    expect(frozen[0].autonomous_releases_frozen).toBe(true);
    record("Freeze", "Autonomous releases were frozen automatically by the SEV1.");

    // --- Rollback decision ---------------------------------------------
    const { rows: lastKnownGood } = await db.query<{ deployment_id: string }>(
      `select deployment_id from public.last_known_good_deployment($1::uuid, 'production', null)`,
      [projectId],
    );
    expect(lastKnownGood[0].deployment_id).toBe(goodDeploymentId);

    const { rows: rollbackRows } = await db.query<{ id: string; state: string; blocked_reason: string }>(
      `select id, state::text as state, blocked_reason from public.record_rollback_decision(
         $1::uuid, false, 'EXECUTOR_NOT_CONNECTED', '{"lastKnownGood":"validated"}'::jsonb, $2::uuid, $3::uuid
       )`,
      [incidentId, badDeploymentId, goodDeploymentId],
    );
    expect(rollbackRows[0].state).toBe("blocked");
    expect(rollbackRows[0].blocked_reason).toBe("EXECUTOR_NOT_CONNECTED");
    record(
      "Rollback",
      "Last Known Good was resolved from a validated deployment; the decision was recorded as blocked because no executor exists.",
    );

    // --- Diagnose ------------------------------------------------------
    const { rows: diagnosisRows } = await db.query<{ id: string; confidence: string }>(
      `select id, confidence::text as confidence from public.record_production_diagnosis(
         $1::uuid, 'The most recent release changed the health endpoint contract', 'web',
         'high'::public.diagnosis_confidence, 'Roll back to the last validated release',
         'yellow'::public.risk_level, '[{"kind":"deployment","reference":"bbbbbbb"}]'::jsonb, 'rules-engine-v1'
       )`,
      [incidentId],
    );
    const diagnosisId = diagnosisRows[0].id;
    const { rows: investigating } = await db.query<{ status: string }>(
      `select status::text as status from public.incidents where id = $1::uuid`,
      [incidentId],
    );
    expect(investigating[0].status).toBe("investigating");
    record("Diagnose", "The investigator recorded a high-confidence cause and moved the incident to investigating.");

    // --- Repair work ---------------------------------------------------
    const { rows: repairRows } = await db.query<{
      repair_id: string;
      repair_state_value: string;
      repair_assignment_status: string;
      repair_task_id: string;
    }>(
      `select repair_id, repair_state_value::text as repair_state_value, repair_assignment_status, repair_task_id
       from public.create_repair_attempt($1::uuid, $2::uuid, 'Repair: restore the health endpoint contract',
         'Restore the documented health response.', 'yellow'::public.risk_level)`,
      [incidentId, diagnosisId],
    );
    expect(repairRows[0].repair_state_value).toBe("blocked");
    expect(repairRows[0].repair_assignment_status).toBe("not_connected");
    record(
      "Repair task",
      "Bounded repair work was created as an owner-visible task and left unassigned: the Codex fix stage is Not Connected.",
    );

    // --- Codex fix / PR / 1D gates / Deploy ----------------------------
    const { rows: authority } = await db.query<{ allowed: boolean; blockers: string[] }>(
      `select allowed, blockers from public.autonomous_release_allowed($1::uuid)`,
      [projectId],
    );
    expect(authority[0].allowed).toBe(false);
    expect(authority[0].blockers).toContain("EXECUTOR_NOT_CONNECTED");
    expect(authority[0].blockers).toContain("GLOBAL_KILL_SWITCH_ACTIVE");
    expect(authority[0].blockers).toContain("RELEASE_FREEZE_ACTIVE");
    record(
      "Codex fix / PR / gates / deploy",
      `Not reached. Autonomous release authority is blocked by: ${authority[0].blockers.join(", ")}.`,
    );

    // --- Validate ------------------------------------------------------
    // Recovery is proven by the monitor, then by a post-deploy validation.
    // The monitor passing again is not enough on its own: the project stays
    // CRITICAL while the SEV1 incident is still open.
    expect((await observe("pass")).health_state).toBe("critical");
    const { rows: recoveryValidation } = await db.query<{ id: string }>(
      `select id from public.record_deployment_validation(
         $1::uuid, 'passed'::public.deployment_validation_state,
         '[{"check":"health","result":"passed"}]'::jsonb, 'validator-1e', 'post-deploy-v1',
         'Health endpoint restored', null
       )`,
      [badDeploymentId],
    );
    record("Validate", "The monitor returned to passing and a post-deploy validation was recorded as passed.");

    // --- Resolve -------------------------------------------------------
    // A SEV1 additionally requires a prevention reference.
    await expect(
      db.query(
        `select id from public.resolve_production_incident(
           $1::uuid, 'The release changed the health endpoint contract',
           'Restored the documented response shape', $2::uuid, null
         )`,
        [incidentId, recoveryValidation[0].id],
      ),
    ).rejects.toThrow(/prevention or follow-up reference/i);

    const { rows: resolved } = await db.query<{ status: string; root_cause: string; prevention_reference: string }>(
      `select status::text as status, root_cause, prevention_reference
       from public.resolve_production_incident(
         $1::uuid, 'The release changed the health endpoint contract',
         'Restored the documented response shape and added a contract test',
         $2::uuid, 'BACKLOG-HEALTH-CONTRACT'
       )`,
      [incidentId, recoveryValidation[0].id],
    );
    expect(resolved[0].status).toBe("resolved");
    expect(resolved[0].prevention_reference).toBe("BACKLOG-HEALTH-CONTRACT");

    // Only now, with the incident closed and the monitor passing, is the
    // project healthy again.
    const { rows: healthAfter } = await db.query<{ operations_health_state: string }>(
      `select operations_health_state from public.projects where id = $1::uuid`,
      [projectId],
    );
    expect(healthAfter[0].operations_health_state).toBe("healthy");
    record("Resolve", "The incident resolved only with restoration, validation, cause, corrective action, and prevention.");

    // The journey is ordered and complete.
    expect(journey.map((entry) => entry.stage)).toEqual([
      "Monitor",
      "Detect",
      "Incident",
      "Freeze",
      "Rollback",
      "Diagnose",
      "Repair task",
      "Codex fix / PR / gates / deploy",
      "Validate",
      "Resolve",
    ]);

    // Every stage left immutable audit evidence.
    const { rows: auditKinds } = await db.query<{ kind: string }>(
      `select distinct kind::text as kind from public.operations_audit_events
       where organization_id = $1::uuid order by kind`,
      [organizationId],
    );
    const kinds = auditKinds.map((row) => row.kind);
    for (const expected of [
      "monitor.configured",
      "monitor.observed",
      "health.changed",
      "incident.created",
      "freeze.activated",
      "rollback.blocked",
      "diagnosis.recorded",
      "repair.created",
      "validation.recorded",
      "incident.resolved",
    ]) {
      expect(kinds, `missing audit evidence for ${expected}`).toContain(expected);
    }
  });

  it("escalates a failed rollback on a second incident instead of retrying it", async () => {
    const { rows: incidentRows } = await db.query<{ incident_id: string }>(
      `select incident_id from public.open_production_incident(
         $1::uuid, 'database:storefront:timeout', 'Storefront database is timing out',
         'sev2'::public.incident_sev, 'database'::public.production_signal_kind,
         'Queries exceed the statement timeout.', 'Checkout fails for signed-in customers.',
         null, $2::uuid, 'bbbbbbb', '{}'::jsonb
       )`,
      [projectId, badDeploymentId],
    );
    const incidentId = incidentRows[0].incident_id;

    const { rows: decision } = await db.query<{ id: string; state: string }>(
      `select id, state::text as state from public.record_rollback_decision(
         $1::uuid, true, null, '{"ownerApproved":true}'::jsonb, $2::uuid, $3::uuid
       )`,
      [incidentId, badDeploymentId, goodDeploymentId],
    );
    expect(decision[0].state).toBe("evaluated");

    const { rows: outcome } = await db.query<{ state: string; escalated: boolean }>(
      `select state::text as state, escalated from public.record_rollback_outcome(
         $1::uuid, false, 'The provider rejected the rollback request', null
       )`,
      [decision[0].id],
    );
    expect(outcome[0].state).toBe("failed");
    expect(outcome[0].escalated).toBe(true);

    const { rows: escalated } = await db.query<{ sev: string; owner_attention_required: boolean }>(
      `select sev::text as sev, owner_attention_required from public.incidents where id = $1::uuid`,
      [incidentId],
    );
    expect(escalated[0].sev).toBe("sev1");
    expect(escalated[0].owner_attention_required).toBe(true);

    const { rows: projectRows } = await db.query<{ owner_attention_required: boolean }>(
      `select owner_attention_required from public.projects where id = $1::uuid`,
      [projectId],
    );
    expect(projectRows[0].owner_attention_required).toBe(true);

    // A terminal rollback cannot be quietly re-reported as a success.
    await expect(
      db.query(`select id from public.record_rollback_outcome($1::uuid, true, 'second try', null)`, [decision[0].id]),
    ).rejects.toThrow(/already has a terminal outcome/i);
  });

  it("refuses to resolve the escalated incident just because a later deployment succeeded", async () => {
    const { rows: incidentRows } = await db.query<{ id: string }>(
      `select id from public.incidents where fingerprint = 'database:storefront:timeout'`,
    );
    const { rows: validation } = await db.query<{ id: string }>(
      `select id from public.record_deployment_validation(
         $1::uuid, 'passed'::public.deployment_validation_state, '[]'::jsonb,
         'validator-1e', 'post-deploy-v1', 'A later deployment succeeded', null
       )`,
      [badDeploymentId],
    );

    // No root cause recorded yet: a green deployment is not evidence of a fix.
    await expect(
      db.query(
        `select id from public.resolve_production_incident($1::uuid, 'ok', 'ok', $2::uuid, 'BACKLOG-1')`,
        [incidentRows[0].id, validation[0].id],
      ),
    ).rejects.toThrow(/root cause is required/i);
  });
});
