// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The deployment adapter is server-only; this suite runs outside Next.js.
vi.mock("server-only", () => ({}));

import {
  AUTOMATIC_ACTIONS,
  resolveEffectiveControls,
  type AutonomyControls,
  type AutonomyEnvelope,
} from "@/lib/autonomy/controls";
import { GREEN_GATES, type GateResult } from "@/lib/autonomy/gates";
import { MAX_ATTEMPTS, evaluateRetry } from "@/lib/autonomy/retries";
import { runPipeline } from "@/lib/autonomy/pipeline";
import { latestReadyProduction, listRecentDeployments } from "@/lib/deploy/vercel";

/**
 * The Phase 1D completion demonstration: one loop, both halves.
 *
 * The decision layer added by this phase runs against the same migrated
 * database Phase 1E operates on, so the two halves are shown joining up rather
 * than being described as if they did.
 *
 * Two journeys:
 *
 *  1. A GREEN change is classified, gated, reviewed, and approved — and then
 *     still stops, because there is no merge executor.
 *  2. A release fails. The incident, freeze, rollback decision and bounded
 *     repair are driven through Phase 1E's real functions, and the Phase 1D
 *     controls are re-resolved afterwards to show the freeze holding every
 *     automatic action off.
 *
 * Every stage that has no executor is asserted by its blocker name. Connecting
 * one later fails this test on purpose.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000e001";
const reviewerId = "00000000-0000-4000-8000-00000000e002";
const organizationId = "10000000-0000-4000-8000-00000000e001";
const projectId = "40000000-0000-4000-8000-00000000e001";
const goodDeploymentId = "80000000-0000-4000-8000-00000000e001";
const badDeploymentId = "80000000-0000-4000-8000-00000000e002";

/** A tenant that has asked for everything, to prove the interlocks not the defaults. */
const requestedEverything: AutonomyControls = {
  autonomousMode: true,
  maximumAutonomousRisk: "YELLOW",
  actions: Object.fromEntries(
    AUTOMATIC_ACTIONS.map((action) => [action, true]),
  ) as AutonomyControls["actions"],
};

const passingGreenGates: GateResult[] = GREEN_GATES.map((gate) => ({
  gate,
  outcome: "passed" as const,
}));

type Stage = { stage: string; detail: string; blocker?: string };

describe("Phase 1D end-to-end loop journey", () => {
  let db: PGlite;
  const journey: Stage[] = [];

  function record(stage: string, detail: string, blocker?: string) {
    journey.push({ stage, detail, blocker });
  }

  /** Read the envelope from the database rather than assuming it. */
  async function readEnvelope(): Promise<AutonomyEnvelope> {
    const { rows } = await db.query<{
      kill_switch_active: boolean;
      emergency_stop_active: boolean;
      release_frozen: boolean;
      executor_connected: boolean;
    }>(
      `select kill_switch_active, emergency_stop_active, release_frozen, executor_connected
       from public.resolved_autonomy_controls($1::uuid)`,
      [projectId],
    );

    return {
      killSwitchActive: rows[0].kill_switch_active,
      emergencyStopActive: rows[0].emergency_stop_active,
      releaseFrozen: rows[0].release_frozen,
      executorConnected: rows[0].executor_connected,
    };
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
      insert into auth.users (id) values ('${ownerId}'), ('${reviewerId}');
      insert into public.organizations (id, name, slug, created_by)
        values ('${organizationId}', 'Loop Factory', 'loop-factory', '${ownerId}');
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
  }, 180_000);

  afterAll(async () => {
    await db?.close();
  });

  it("decides a GREEN change all the way to approval, then stops at the missing executor", async () => {
    const envelope = await readEnvelope();

    // The database says what the interlocks are; the tenant does not get a vote.
    expect(envelope.killSwitchActive).toBe(true);
    expect(envelope.executorConnected).toBe(false);
    record("Envelope", "Kill switch ON and no executor connected, read from the database.");

    const held = resolveEffectiveControls(requestedEverything, requestedEverything, envelope);
    expect(Object.values(held.actions).every((enabled) => enabled === false)).toBe(true);
    expect(held.restrictions).toContain("GLOBAL_KILL_SWITCH_ACTIVE");
    expect(held.restrictions).toContain("EXECUTOR_NOT_CONNECTED");
    record(
      "Controls",
      "A tenant asking for all nine actions still resolves to none: the envelope overrides both scopes.",
    );

    // Resolve again against an envelope where only the executor is missing, so
    // the decision stages downstream are actually exercised rather than being
    // short-circuited by the kill switch.
    const decisionControls = resolveEffectiveControls(requestedEverything, requestedEverything, {
      killSwitchActive: false,
      emergencyStopActive: false,
      releaseFrozen: false,
      executorConnected: true,
    });

    const run = runPipeline({
      action: "merge",
      declaredRisk: "GREEN",
      files: [
        { path: "components/storefront-banner.tsx" },
        { path: "tests/unit/storefront-banner.test.tsx" },
      ],
      gateResults: passingGreenGates,
      controls: decisionControls,
      authorId: ownerId,
      approverId: reviewerId,
      pullRequestOpen: true,
    });

    expect(run.assessment.level).toBe("GREEN");
    record("Classify", "The diff classifies GREEN from its own paths, not from a declaration.");

    expect(run.gates.satisfied).toBe(true);
    record("Verify", `${run.gates.passed.length} required gates passed.`);

    expect(run.agents.clear).toBe(true);
    record("Review", "Review, QA and Security produced no blocking finding.");

    expect(run.approval.decision).toBe("APPROVED_AUTOMATICALLY");
    record("Approve", "Approved automatically by a reviewer who is not the author.");

    // And it still cannot proceed.
    expect(run.completed).toBe(false);
    expect(run.reachedStage).toBe("merge");
    expect(run.stages.at(-1)?.blocker).toBe("MERGE_EXECUTOR_NOT_CONNECTED");
    record(
      "Merge",
      "No merge executor exists. Nothing was merged.",
      "MERGE_EXECUTOR_NOT_CONNECTED",
    );

    expect(journey.length).toBeGreaterThanOrEqual(7);
  });

  it("refuses to approve the same change for its own author", async () => {
    const decisionControls = resolveEffectiveControls(requestedEverything, requestedEverything, {
      killSwitchActive: false,
      emergencyStopActive: false,
      releaseFrozen: false,
      executorConnected: true,
    });

    const run = runPipeline({
      action: "merge",
      declaredRisk: "GREEN",
      files: [
        { path: "components/storefront-banner.tsx" },
        { path: "tests/unit/storefront-banner.test.tsx" },
      ],
      gateResults: passingGreenGates,
      controls: decisionControls,
      authorId: ownerId,
      approverId: ownerId,
      pullRequestOpen: true,
    });

    expect(run.approval.decision).toBe("OWNER_APPROVAL_REQUIRED");
    expect(run.approval.blockers).toContain("SELF_APPROVAL_REFUSED");
    expect(run.reachedStage).toBe("approval");
  });

  it("walks a failed release through incident, freeze, rollback decision and repair", async () => {
    // The last validated release becomes Last Known Good.
    await db.query(
      `select id from public.record_deployment_validation(
         $1::uuid, 'passed'::public.deployment_validation_state, '[]'::jsonb,
         'validator-1d', 'post-deploy-v1', 'Baseline release validated', null
       )`,
      [goodDeploymentId],
    );

    // --- Deploy ---------------------------------------------------------
    // Live preview and production validation would run here. They cannot:
    // the read adapter reports why rather than returning empty data that
    // would read as "nothing is deployed".
    const deploymentRead = await listRecentDeployments("prj_journey", { target: "production" });
    expect(deploymentRead.status).toBe("not_connected");
    expect(latestReadyProduction(deploymentRead)).toBeNull();
    record(
      "Deploy",
      "Deployment state could not be read; the adapter reported why.",
      "DEPLOY_PROVIDER_NOT_CONNECTED",
    );

    // --- Failed deploy --------------------------------------------------
    // The failure is *recorded through the real validation function*, not
    // asserted. Everything downstream hangs off this row.
    const { rows: failedValidation } = await db.query<{ id: string; state: string }>(
      `select id, state::text as state from public.record_deployment_validation(
         $1::uuid, 'failed'::public.deployment_validation_state,
         '[{"check":"health","outcome":"fail","detail":"Expected HTTP 200 but received 500."}]'::jsonb,
         'validator-1d', 'post-deploy-v1', 'Post-deploy validation failed', null
       )`,
      [badDeploymentId],
    );
    expect(failedValidation[0].state).toBe("failed");
    record("Validate", "Post-deploy validation failed for the new release.");

    // A failed validation must not become Last Known Good.
    const { rows: stillGood } = await db.query<{ deployment_id: string }>(
      `select deployment_id from public.last_known_good_deployment($1::uuid, 'production', null)`,
      [projectId],
    );
    expect(stillGood[0].deployment_id).toBe(goodDeploymentId);
    expect(stillGood[0].deployment_id).not.toBe(badDeploymentId);

    const { rows: incidentRows } = await db.query<{
      incident_id: string;
      incident_sev_level: string;
      freeze_applied: boolean;
    }>(
      `select incident_id, incident_sev_level, freeze_applied
       from public.open_production_incident(
         $1::uuid, 'deployment:storefront:failed-validation', 'Storefront release failed validation',
         'sev1'::public.incident_sev, 'deployment'::public.production_signal_kind,
         'Post-deploy validation failed.', 'Production is serving errors.',
         $2::uuid, $3::uuid, 'bbbbbbb', '{"status_code": 500}'::jsonb
       )`,
      [projectId, null, badDeploymentId],
    );

    const incidentId = incidentRows[0].incident_id;
    expect(incidentRows[0].incident_sev_level).toBe("sev1");
    expect(incidentRows[0].freeze_applied).toBe(true);
    record("Incident", "A SEV1 opened from the failed deployment and froze releases automatically.");

    // The freeze now shows up in the Phase 1D envelope, not just in Phase 1E.
    const frozenEnvelope = await readEnvelope();
    expect(frozenEnvelope.releaseFrozen).toBe(true);

    const frozenControls = resolveEffectiveControls(requestedEverything, requestedEverything, {
      ...frozenEnvelope,
      killSwitchActive: false,
      executorConnected: true,
    });
    expect(frozenControls.restrictions).toContain("RELEASE_FROZEN");
    expect(Object.values(frozenControls.actions).every((enabled) => enabled === false)).toBe(true);
    record(
      "Controls",
      "The freeze propagates into the decision layer: every automatic action resolves off while it holds.",
    );

    const { rows: lastKnownGood } = await db.query<{ deployment_id: string }>(
      `select deployment_id from public.last_known_good_deployment($1::uuid, 'production', null)`,
      [projectId],
    );
    expect(lastKnownGood[0].deployment_id).toBe(goodDeploymentId);

    const { rows: rollbackRows } = await db.query<{ state: string; blocked_reason: string }>(
      `select state::text as state, blocked_reason from public.record_rollback_decision(
         $1::uuid, false, 'EXECUTOR_NOT_CONNECTED', '{"lastKnownGood":"validated"}'::jsonb, $2::uuid, $3::uuid
       )`,
      [incidentId, badDeploymentId, goodDeploymentId],
    );
    expect(rollbackRows[0].state).toBe("blocked");
    expect(rollbackRows[0].blocked_reason).toBe("EXECUTOR_NOT_CONNECTED");
    record(
      "Rollback",
      "Last Known Good resolved from a validated release; nothing was reversed.",
      rollbackRows[0].blocked_reason,
    );

    const { rows: diagnosisRows } = await db.query<{ id: string }>(
      `select id from public.record_production_diagnosis(
         $1::uuid, 'The release changed a response contract', 'web',
         'high'::public.diagnosis_confidence, 'Roll back to the last validated release',
         'yellow'::public.risk_level, '[{"kind":"deployment","reference":"bbbbbbb"}]'::jsonb, 'rules-engine-v1'
       )`,
      [incidentId],
    );

    const { rows: repairRows } = await db.query<{
      repair_state_value: string;
      repair_assignment_status: string;
    }>(
      `select repair_state_value::text as repair_state_value, repair_assignment_status
       from public.create_repair_attempt($1::uuid, $2::uuid, 'Repair: restore the response contract',
         'Restore the documented response.', 'yellow'::public.risk_level)`,
      [incidentId, diagnosisRows[0].id],
    );

    expect(repairRows[0].repair_state_value).toBe("blocked");
    expect(repairRows[0].repair_assignment_status).toBe("not_connected");
    record(
      "Repair",
      "Bounded repair work was created and left unassigned.",
      "CODEX_WORKER_NOT_CONNECTED",
    );
  });

  it("refuses a YELLOW repair that has not cleared the enhanced gates", async () => {
    const decisionControls = resolveEffectiveControls(requestedEverything, requestedEverything, {
      killSwitchActive: false,
      emergencyStopActive: false,
      releaseFrozen: false,
      executorConnected: true,
    });

    // A repair that touches schema is YELLOW, so the GREEN set is not enough.
    const run = runPipeline({
      action: "repair",
      declaredRisk: "YELLOW",
      files: [
        { path: "supabase/migrations/20260101000000_restore_contract.sql" },
        { path: "tests/unit/contract.test.ts" },
      ],
      gateResults: passingGreenGates,
      controls: decisionControls,
      authorId: ownerId,
      approverId: reviewerId,
      pullRequestOpen: true,
    });

    expect(run.assessment.level).toBe("YELLOW");
    expect(run.gates.satisfied).toBe(false);
    expect(run.gates.blockers.map((blocker) => blocker.gate)).toEqual([
      "security_review",
      "migration_review",
      "e2e",
      "rollback_validated",
    ]);
    expect(run.approval.decision).toBe("NOT_APPROVED");
    expect(run.reachedStage).toBe("verify");
  });


  it("propagates an owner emergency stop from the real RPC into the decision layer", async () => {
    // Before: the database reports no stop.
    expect((await readEnvelope()).emergencyStopActive).toBe(false);

    const { rows } = await db.query<{ stop_autonomous_operations: number }>(
      "select public.stop_autonomous_operations($1::uuid, $2)",
      [organizationId, "Owner pulling the handle during the completion drill."],
    );
    expect(rows[0].stop_autonomous_operations).toBeGreaterThan(0);

    const stopped = await readEnvelope();
    expect(stopped.emergencyStopActive).toBe(true);
    record("Emergency STOP", "An owner stopped autonomous operations for the organization.", undefined);

    // A tenant asking for everything still resolves to nothing.
    const held = resolveEffectiveControls(requestedEverything, requestedEverything, {
      ...stopped,
      killSwitchActive: false,
      executorConnected: true,
    });
    expect(held.restrictions).toContain("EMERGENCY_STOP_ACTIVE");
    expect(Object.values(held.actions).every((enabled) => enabled === false)).toBe(true);

    // And a change that would otherwise be approved is refused.
    const run = runPipeline({
      action: "merge",
      declaredRisk: "GREEN",
      files: [
        { path: "components/storefront-banner.tsx" },
        { path: "tests/unit/storefront-banner.test.tsx" },
      ],
      gateResults: passingGreenGates,
      controls: held,
      authorId: ownerId,
      approverId: reviewerId,
      pullRequestOpen: true,
    });
    expect(run.approval.decision).toBe("NOT_APPROVED");
  });

  it("refuses an emergency stop from someone who is not an owner", async () => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [reviewerId]);

    await expect(
      db.query("select public.stop_autonomous_operations($1::uuid, $2)", [
        organizationId,
        "A non-owner should not be able to do this.",
      ]),
    ).rejects.toThrow(/only an organization owner/i);

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  });

  it("exhausts a bounded retry budget and escalates instead of trying again", () => {
    const attempts: string[] = [];
    let used = 0;

    // Drive a stage to its cap the way the loop would.
    for (let round = 0; round < MAX_ATTEMPTS.repair + 2; round += 1) {
      const outcome = evaluateRetry("repair", used);
      attempts.push(outcome.decision);
      if (outcome.decision !== "RETRY") break;
      used += 1;
    }

    expect(attempts.filter((decision) => decision === "RETRY")).toHaveLength(MAX_ATTEMPTS.repair);
    expect(attempts.at(-1)).toBe("ESCALATE");
    record(
      "Retries",
      `The budget of ${MAX_ATTEMPTS.repair} attempts was spent and the loop escalated.`,
      "RETRY_BUDGET_EXHAUSTED",
    );
  });

  it("never retries a permanent refusal, however much budget is left", () => {
    const outcome = evaluateRetry("repair", 0, { permanent: true });

    expect(outcome.decision).toBe("STOP");
    expect(outcome.attemptsRemaining).toBe(MAX_ATTEMPTS.repair);
  });

  it("records a journey that names every blocked stage instead of skipping it", () => {
    const blocked = journey.filter((stage) => stage.blocker);

    // Each stage with no executor carries the exact blocker, so a future phase
    // that connects one has to change these names deliberately.
    expect(blocked.map((stage) => [stage.stage, stage.blocker])).toEqual([
      ["Merge", "MERGE_EXECUTOR_NOT_CONNECTED"],
      ["Deploy", "DEPLOY_PROVIDER_NOT_CONNECTED"],
      ["Rollback", "EXECUTOR_NOT_CONNECTED"],
      ["Repair", "CODEX_WORKER_NOT_CONNECTED"],
      ["Retries", "RETRY_BUDGET_EXHAUSTED"],
    ]);

    // And the stages that did complete are recorded too, so the journey shows
    // how far the loop actually got rather than only where it stopped.
    expect(journey.map((stage) => stage.stage)).toEqual(
      expect.arrayContaining([
        "Envelope", "Controls", "Classify", "Verify", "Review", "Approve",
        "Validate", "Incident", "Emergency STOP",
      ]),
    );
  });
});
