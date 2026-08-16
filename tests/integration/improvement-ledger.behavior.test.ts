// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Phase 3's improvement ledger, proven against the migrated schema.
 *
 * The claim under test is the audit's central sentence: "An AI recommendation
 * is NOT improvement." The ledger's boundary refuses a proposal without a
 * baseline, refuses implementation and evaluation before acceptance, refuses
 * a second decision or evaluation (score shopping), and holds every recorded
 * entry immutable — for the most privileged role included.
 */

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000003a1";
const outsiderId = "00000000-0000-4000-8000-0000000003a2";
const organizationId = "10000000-0000-4000-8000-0000000003b1";
const projectId = "40000000-0000-4000-8000-0000000003c1";
const commandId = "50000000-0000-4000-8000-0000000003d1";

describe("the improvement ledger", () => {
  let db: PGlite;

  async function asRole(role: string, userId: string | null = null) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
    await db.exec(`set role ${role}`);
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
    for (const migrationFile of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by)
        values ('${organizationId}', 'Improvement Tenant', 'improvement-tenant', '${ownerId}');
      insert into public.projects (id, organization_id, name, status, github_repository, default_branch, created_by)
        values ('${projectId}', '${organizationId}', 'Improvement Project', 'active', 'tenant/app', 'main', '${ownerId}');
      insert into public.commands (id, organization_id, project_id, prompt, requested_risk, status, submitted_by, parameters)
        values ('${commandId}', '${organizationId}', '${projectId}',
          'Implement the accepted improvement through the ordinary path.', 'green', 'submitted', '${ownerId}',
          '{
            "acceptanceCriteria": ["The improvement is implemented as accepted."],
            "agentRole": "orchestrator",
            "budget": {"ciTimeoutMs": 900000, "maximumDurationMs": 2700000, "maximumInputTokens": 200000,
                       "maximumOutputTokens": 50000, "maximumRepairAttempts": 1, "maximumTurns": 4},
            "commandType": "other",
            "executionMode": "manual",
            "model": "gpt-5.3-codex",
            "plan": {"requiresDraftPullRequest": true,
                     "stages": ["inspect","implement","validate","policy_scan","commit","draft_pull_request","ci","report"],
                     "workflow": "codex_draft_pr"},
            "provider": "openai",
            "riskAssessment": {}
          }'::jsonb);
    `);
    await db.exec("reset role");
  }, 240_000);

  afterAll(async () => {
    await db.close();
  });

  it("refuses a proposal without a baseline, by name", async () => {
    await asRole("authenticated", ownerId);
    for (const baseline of ["{}", null]) {
      await expect(
        db.query(
          `select public.record_improvement_proposal(
             $1::uuid, 'Faster validation', 'Cache the validation toolchain between runs.',
             'Median validation stage drops below four minutes.', $2::jsonb,
             '["Validation median under 4 minutes for a week"]'::jsonb,
             'factory-constitution-v1'
           )`,
          [projectId, baseline],
        ),
      ).rejects.toThrow(/recommendation, not an improvement/);
    }
  });

  it("records the full lifecycle in order, and refuses every shortcut", async () => {
    await asRole("authenticated", ownerId);
    const proposal = await db.query<{ id: string }>(
      `select public.record_improvement_proposal(
         $1::uuid, 'Faster validation', 'Cache the validation toolchain between runs.',
         'Median validation stage drops below four minutes.',
         '{"validationMedianMs": 372000, "sampleRuns": 18}'::jsonb,
         '["Validation median under 4 minutes for a week"]'::jsonb,
         'factory-constitution-v1'
       ) as id`,
      [projectId],
    );
    const proposalId = proposal.rows[0]!.id;

    // No implementation and no evaluation before an accepted decision.
    await expect(
      db.query("select public.record_improvement_implementation($1::uuid, $2::uuid)", [
        proposalId, commandId,
      ]),
    ).rejects.toThrow(/requires an accepted decision/);
    await expect(
      db.query(
        `select public.record_improvement_evaluation(
           $1::uuid, '{"validationMedianMs": 210000}'::jsonb, 'improved', 'Cache hit rate carried the gain.'
         )`,
        [proposalId],
      ),
    ).rejects.toThrow(/requires an accepted decision/);

    await db.query(
      "select public.record_improvement_decision($1::uuid, 'accepted', 'Prediction is falsifiable and the baseline is real.')",
      [proposalId],
    );
    // The ledger does not re-decide.
    await expect(
      db.query(
        "select public.record_improvement_decision($1::uuid, 'rejected', 'Changed my mind.')",
        [proposalId],
      ),
    ).rejects.toThrow(/already decided/);

    await db.query("select public.record_improvement_implementation($1::uuid, $2::uuid)", [
      proposalId, commandId,
    ]);

    await db.query(
      `select public.record_improvement_evaluation(
         $1::uuid, '{"validationMedianMs": 214000, "sampleRuns": 12}'::jsonb,
         'improved', 'The cache carried the gain; the prediction held with margin.'
       )`,
      [proposalId],
    );
    // A second evaluation is score shopping.
    await expect(
      db.query(
        `select public.record_improvement_evaluation(
           $1::uuid, '{"validationMedianMs": 190000}'::jsonb, 'improved', 'Trying for a better number.'
         )`,
        [proposalId],
      ),
    ).rejects.toThrow(/score shopping/);

    const lifecycle = await db.query<{ entry_type: string }>(
      `select entry_type from public.improvement_ledger
       where proposal_id = $1 order by created_at`,
      [proposalId],
    );
    expect(lifecycle.rows.map((row) => row.entry_type)).toEqual([
      "proposal", "decision", "implementation", "evaluation",
    ]);

    // The lifecycle left an audit trail in activity_events.
    await db.exec("reset role");
    const events = await db.query<{ event_type: string }>(
      `select event_type::text from public.activity_events
       where entity_type = 'improvement' and entity_id = $1 order by created_at`,
      [proposalId],
    );
    expect(events.rows.map((row) => row.event_type)).toEqual([
      "improvement.proposed", "improvement.decided", "improvement.evaluated",
    ]);
  });

  it("holds every entry immutable, for the most privileged role included", async () => {
    await db.exec("reset role");
    await expect(
      db.query("update public.improvement_ledger set outcome = 'improved' where entry_type = 'evaluation'"),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query("delete from public.improvement_ledger"),
    ).rejects.toThrow(/append-only/);
  });

  it("shows outsiders nothing and refuses their writes generically", async () => {
    await asRole("authenticated", outsiderId);
    const visible = await db.query("select 1 from public.improvement_ledger");
    expect(visible.rows).toHaveLength(0);
    await expect(
      db.query(
        `select public.record_improvement_proposal(
           $1::uuid, 'Not mine', 'An outsider proposes an improvement.',
           'It will not be recorded either way.', '{"metric": 1}'::jsonb,
           '["never"]'::jsonb, 'factory-constitution-v1'
         )`,
        [projectId],
      ),
    ).rejects.toThrow(/project not found/);

    await asRole("anon");
    await expect(
      db.query("select 1 from public.improvement_ledger"),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });

  it("accepts a factory-wide proposal with no project, recorded at organization level", async () => {
    await asRole("authenticated", ownerId);
    const proposal = await db.query<{ id: string }>(
      `select public.record_improvement_proposal(
         null, 'Retire a flaky suite', 'Replace the flakiest integration suite with a deterministic one.',
         'Zero retry-passes in CI for two weeks.',
         '{"retryPassesLastTwoWeeks": 7}'::jsonb,
         '["No retry-pass in fourteen consecutive days"]'::jsonb,
         'factory-constitution-v1'
       ) as id`,
    );
    const row = await db.query<{ project_id: string | null }>(
      "select project_id from public.improvement_ledger where id = $1",
      [proposal.rows[0]!.id],
    );
    expect(row.rows[0]!.project_id).toBeNull();
    await db.exec("reset role");
  });

  it("captures a baseline from real telemetry, naming what it cannot measure", async () => {
    await asRole("authenticated", ownerId);
    const captured = await db.query<{ baseline: {
      metrics: Record<string, number>;
      unavailable: string[];
      window: { days: number };
    } }>(
      "select public.capture_improvement_baseline($1::uuid) as baseline",
      [projectId],
    );
    const baseline = captured.rows[0]!.baseline;

    // Streams nothing has ever written are named, never zeroed.
    expect(baseline.unavailable.sort()).toEqual(["deployments", "runs", "validations"]);
    expect(baseline.metrics).not.toHaveProperty("runsTotal");
    // Zero open incidents is a real measurement: the table exists and is empty
    // in the honest sense, unlike a telemetry stream with no writer yet.
    expect(baseline.metrics.incidentsOpen).toBe(0);
    expect(baseline.metrics.schedulingWithheld).toBe(0);
    expect(baseline.window.days).toBe(14);
    await db.exec("reset role");
  });

  it("derives the outcome from telemetry, and refuses to guess when nothing compares", async () => {
    await asRole("authenticated", ownerId);
    // A proposal whose baseline claims two open incidents: current telemetry
    // says zero, so the derived outcome is an improvement.
    const improvedProposal = await db.query<{ id: string }>(
      `select public.record_improvement_proposal(
         $1::uuid, 'Close out incident backlog', 'Resolve the two open production incidents.',
         'Open incidents drop to zero and stay there.',
         '{"metrics": {"incidentsOpen": 2}}'::jsonb,
         '["Zero open incidents"]'::jsonb, 'factory-constitution-v1'
       ) as id`,
      [projectId],
    );
    await db.query(
      "select public.record_improvement_decision($1::uuid, 'accepted', 'Baseline is the incident table itself.')",
      [improvedProposal.rows[0]!.id],
    );
    const evaluated = await db.query<{ outcome: string }>(
      `select outcome from public.evaluate_improvement_from_telemetry(
         $1::uuid, 'The backlog cleared and the telemetry showed it without hands on the numbers.'
       )`,
      [improvedProposal.rows[0]!.id],
    );
    expect(evaluated.rows[0]!.outcome).toBe("improved");

    // A proposal whose baseline names only a stream nothing has written:
    // nothing is comparable, and the machinery refuses to invent an outcome.
    const incomparable = await db.query<{ id: string }>(
      `select public.record_improvement_proposal(
         $1::uuid, 'Cut failed runs', 'Reduce failed worker runs.',
         'Failed runs drop by half.',
         '{"metrics": {"runsFailed": 6}}'::jsonb,
         '["Failed runs halve"]'::jsonb, 'factory-constitution-v1'
       ) as id`,
      [projectId],
    );
    await db.query(
      "select public.record_improvement_decision($1::uuid, 'accepted', 'Worth trying.')",
      [incomparable.rows[0]!.id],
    );
    await expect(
      db.query(
        "select outcome from public.evaluate_improvement_from_telemetry($1::uuid, 'No lesson yet.')",
        [incomparable.rows[0]!.id],
      ),
    ).rejects.toThrow(/nothing can be compared/);
    await db.exec("reset role");
  });

  it("reports a regression as a regression, with the lesson recorded", async () => {
    // The world gets worse between baseline and evaluation: an incident opens.
    await asRole("authenticated", ownerId);
    const proposal = await db.query<{ id: string }>(
      `select public.record_improvement_proposal(
         $1::uuid, 'Keep incidents at zero', 'Tighten the deploy validation gate.',
         'Open incidents stay at zero.',
         '{"metrics": {"incidentsOpen": 0}}'::jsonb,
         '["No new incidents"]'::jsonb, 'factory-constitution-v1'
       ) as id`,
      [projectId],
    );
    await db.query(
      "select public.record_improvement_decision($1::uuid, 'accepted', 'The gate is worth tightening.')",
      [proposal.rows[0]!.id],
    );

    await db.exec("reset role");
    await db.query(
      `insert into public.incidents (organization_id, project_id, title, severity, status)
       values ($1, $2, 'Health endpoint failing', 'high', 'open')`,
      [organizationId, projectId],
    );

    await asRole("authenticated", ownerId);
    const evaluated = await db.query<{ outcome: string; compared: unknown }>(
      `select outcome, compared from public.evaluate_improvement_from_telemetry(
         $1::uuid, 'The gate did not hold; the incident opened anyway. The validation set needs the probe case.'
       )`,
      [proposal.rows[0]!.id],
    );
    expect(evaluated.rows[0]!.outcome).toBe("regressed");

    const lifecycle = await db.query<{ outcome: string | null; lesson: string | null }>(
      `select outcome, lesson from public.improvement_ledger
       where proposal_id = $1 and entry_type = 'evaluation'`,
      [proposal.rows[0]!.id],
    );
    expect(lifecycle.rows[0]!.outcome).toBe("regressed");
    expect(lifecycle.rows[0]!.lesson).toContain("did not hold");
    await db.exec("reset role");
  });

  it("audits its own health from real telemetry, scoring only what it can see", async () => {
    // State at this point in the suite: one open incident (from the
    // regression test above), no terminal runs, no validations, no
    // deployments, no repairs, no autonomy decisions, nothing queued, and no
    // open breakers. The audit must score exactly the two domains that hold
    // evidence and name every domain it cannot measure.
    await asRole("authenticated", ownerId);
    const audited = await db.query<{ report: {
      policyVersion: string;
      domains: Record<string, { measured: boolean; reason?: string; score?: number; open?: number }>;
      score: { value: number | null; measuredDomains: number; totalDomains: number; confidence?: number; abstained: boolean };
    } }>(
      "select public.audit_factory_health($1::uuid) as report",
      [projectId],
    );
    const report = audited.rows[0]!.report;

    expect(report.policyVersion).toBe("factory-self-audit-v1");
    for (const domain of ["runs", "validations", "verifier", "repairs", "deployments", "queue"]) {
      expect(report.domains[domain]!.measured).toBe(false);
      expect(report.domains[domain]!.reason).toBeTruthy();
    }
    expect(report.domains.incidents).toMatchObject({ measured: true, open: 1, score: 75 });
    expect(report.domains.breakers).toMatchObject({ measured: true, open: 0, score: 100 });

    // The score is the mean of the two measured domains, and the confidence
    // says how little of the factory was actually visible.
    expect(report.score).toMatchObject({
      abstained: false, measuredDomains: 2, totalDomains: 8, value: 87.5,
    });
    expect(report.score.confidence).toBe(0.25);
    await db.exec("reset role");
  });

  it("refuses a self-audit to outsiders and the unauthenticated", async () => {
    await asRole("authenticated", outsiderId);
    await expect(
      db.query("select public.audit_factory_health($1::uuid)", [projectId]),
    ).rejects.toThrow(/project not found/);
    await asRole("anon");
    await expect(
      db.query("select public.audit_factory_health($1::uuid)", [projectId]),
    ).rejects.toThrow(/authentication is required|permission denied/);
    await db.exec("reset role");
  });
});
