// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 1E boundary contracts.
 *
 * The behavioral suite proves the database enforces the pipeline. These
 * contracts guard the properties a future edit could quietly remove: the
 * same-origin and role checks on every mutation, the absence of any executor,
 * and the preserved Phase 1D interlocks.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");

function source(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

const migration = source("supabase/migrations/20260812002800_phase1e_production_operations.sql");

const mutationRoutes = [
  "app/api/operations/monitors/route.ts",
  "app/api/operations/monitors/[monitorId]/run/route.ts",
  "app/api/operations/incidents/[incidentId]/diagnose/route.ts",
  "app/api/operations/incidents/[incidentId]/repair/route.ts",
  "app/api/operations/incidents/[incidentId]/rollback/route.ts",
  "app/api/operations/incidents/[incidentId]/resolve/route.ts",
  "app/api/operations/controls/route.ts",
  "app/api/operations/events/route.ts",
  "app/api/operations/reports/route.ts",
  "app/api/operations/synthetics/route.ts",
] as const;

const readRoutes = [
  "app/api/operations/overview/route.ts",
  "app/api/operations/projects/[projectId]/route.ts",
] as const;

describe("Phase 1E route boundaries", () => {
  it("requires a same-origin request for every mutation route", () => {
    for (const route of mutationRoutes) {
      expect(source(route), `${route} must assert same origin`).toMatch(/assertSameOriginRequest\(request\)/);
    }
  });

  it("resolves the caller's exact active organization on every operations route", () => {
    for (const route of [...mutationRoutes, ...readRoutes]) {
      expect(source(route), `${route} must resolve the active organization`).toMatch(/operationsContext\(\)/);
    }
  });

  it("restricts rollback decisions and emergency resume/stop to the organization owner", () => {
    expect(source("app/api/operations/incidents/[incidentId]/rollback/route.ts")).toMatch(/requireOwner\(context\)/);
    const controls = source("app/api/operations/controls/route.ts");
    expect(controls).toMatch(/requireOwner\(context\)/);
    // Freezing only subtracts authority, so an administrator may do it.
    expect(controls).toMatch(/requireManager\(context\)/);
  });

  it("requires owner or administrator access for every other mutation", () => {
    for (const route of mutationRoutes.filter(
      (candidate) => !candidate.includes("rollback"),
    )) {
      expect(source(route), `${route} must check management role`).toMatch(
        /require(Manager|Owner)\(context\)/,
      );
    }
  });

  it("repeats the execution truth in every operations response", () => {
    for (const route of [...mutationRoutes, ...readRoutes]) {
      expect(source(route), `${route} must carry the execution envelope`).toMatch(
        /OPERATIONS_EXECUTION_ENVELOPE/,
      );
    }
    const envelope = source("lib/operations/route.ts");
    expect(envelope).toMatch(/executionAllowed:\s*false/);
    expect(envelope).toMatch(/deploymentExecutor:\s*"not_connected"/);
    expect(envelope).toMatch(/rollbackExecutor:\s*"not_connected"/);
    expect(envelope).toMatch(/repairWorker:\s*"not_connected"/);
  });

  it("contains no deployment, merge, or rollback executor anywhere in the operations surface", () => {
    for (const route of [...mutationRoutes, ...readRoutes]) {
      const contents = source(route);
      expect(contents, `${route} must not call a provider deployment API`).not.toMatch(
        /api\.vercel\.com|\/deployments\b.*fetch|createDeployment|rollbackDeployment|mergePullRequest/,
      );
    }
    const rollbackRoute = source("app/api/operations/incidents/[incidentId]/rollback/route.ts");
    expect(rollbackRoute).toMatch(/executed:\s*false/);
    expect(rollbackRoute).toMatch(/PHASE_1E_ROLLBACK_EXECUTOR_CONNECTED/);
    expect(source("lib/operations/rollback.ts")).toMatch(
      /PHASE_1E_ROLLBACK_EXECUTOR_CONNECTED\s*=\s*false/,
    );
    expect(source("lib/operations/repair.ts")).toMatch(
      /PHASE_1E_REPAIR_WORKER_CONNECTED\s*=\s*false/,
    );
  });

  it("never issues a synthetic write against production", () => {
    const runner = source("lib/operations/journey.ts");
    expect(runner).toMatch(/step\.method === "POST"/);
    expect(runner).toMatch(/outcome: "skipped"/);
    expect(runner).toMatch(/not executed/);
    // Every executed step goes through the same validated probe.
    expect(runner).toMatch(/probeHttpTarget\(/);
    expect(runner).toMatch(/validateMonitorTarget\(url\)/);
  });

  it("validates synthetic journey safety in the database, not only in the route", () => {
    const journeyMigration = source(
      "supabase/migrations/20260813000200_phase1e_synthetic_journeys.sql",
    );
    expect(journeyMigration).toMatch(/synthetic_journeys_steps_are_safe/);
    expect(journeyMigration).toMatch(/synthetic_journeys_profile_covered/);
    expect(journeyMigration).toMatch(/delete\|destroy\|purge\|drop\|truncate/);
    expect(journeyMigration).toMatch(/reversal_note/);
    expect(journeyMigration).not.toMatch(/grant[\s\S]{0,200}on\s+table[\s\S]{0,200}to\s+service_role/i);
  });

  it("keeps the outbound probe restricted to validated public HTTPS targets", () => {
    const probe = source("lib/operations/probe.ts");
    expect(probe).toMatch(/validateMonitorTarget\(options\.targetUrl\)/);
    expect(probe).toMatch(/redirect:\s*"manual"/);
    // The probe must never read or forward a production response body.
    expect(probe).not.toMatch(/response\.(text|json|blob|arrayBuffer)\(/);
  });
});

describe("Phase 1E database boundaries", () => {
  it("grants service_role no new table privileges", () => {
    expect(migration).not.toMatch(/grant[\s\S]{0,200}on\s+table[\s\S]{0,200}to\s+service_role/i);
    expect(migration).toMatch(/revoke all on function[\s\S]*service_role/);
  });

  it("puts every new table under RLS with FORCE RLS and no browser writes", () => {
    expect(migration).toMatch(/enable row level security/);
    expect(migration).toMatch(/force row level security/);
    expect(migration).toMatch(/revoke all on table public\.%I from anon, authenticated/);
    expect(migration).toMatch(/grant select on table public\.%I to authenticated/);
    expect(migration).not.toMatch(/grant\s+insert[^;]*to\s+authenticated/i);
    expect(migration).not.toMatch(/grant\s+update[^;]*to\s+authenticated/i);
    expect(migration).not.toMatch(/grant\s+delete[^;]*to\s+authenticated/i);
  });

  it("keeps the incident resolution gate and the failed-rollback escalation in the schema", () => {
    expect(migration).toMatch(/incidents_resolution_requires_cause/);
    expect(migration).toMatch(/rollback_operations_failure_escalates/);
    expect(migration).toMatch(/state <> 'failed' or escalated/);
    expect(migration).toMatch(/production is still failing its own monitors/);
    expect(migration).toMatch(/prevention or follow-up reference/);
  });

  it("cannot enable a monitor whose adapter is not connected", () => {
    expect(migration).toMatch(/production_monitors_enabled_requires_connection/);
    expect(migration).toMatch(/not enabled or connection_state = 'connected'/);
  });

  it("keeps the unconditional executor blocker on release authority", () => {
    expect(migration).toMatch(/found_blockers \|\| 'EXECUTOR_NOT_CONNECTED'::text/);
    expect(migration).toMatch(/return query select false, found_blockers/);
  });

  it("keeps every operations evidence table append-only", () => {
    for (const table of [
      "monitor_observations",
      "project_health_snapshots",
      "production_diagnoses",
      "operations_audit_events",
    ]) {
      expect(migration, `${table} must be append-only`).toMatch(
        new RegExp(`create trigger ${table}_append_only`),
      );
    }
    expect(migration).toMatch(/operations evidence rows are append-only/);
  });
});

describe("Phase 1D interlocks survive Phase 1E", () => {
  it("does not relax the Phase 1D project constraint or the kill switch", () => {
    expect(migration).not.toMatch(/drop constraint projects_phase1d_green_observation_only/);
    expect(migration).not.toMatch(/organizations_phase1d_kill_switch_active/);
    expect(migration).not.toMatch(/auto_rollback\s*=\s*true/);
    expect(migration).not.toMatch(/autonomous_mode\s*=\s*true/);
  });

  it("still contains no autonomous deployment or rollback route", () => {
    for (const absent of [
      "app/api/deployments/route.ts",
      "app/api/rollbacks/route.ts",
      "app/api/operations/deploy/route.ts",
    ]) {
      expect(() => source(absent)).toThrow();
    }
  });

  it("tells the operator plainly that execution is Not Connected", () => {
    const page = source("app/operations/page.tsx");
    expect(page).toMatch(/Not Connected/);
    expect(page).toMatch(/cannot deploy, roll back, or run a fix/i);
  });
});
