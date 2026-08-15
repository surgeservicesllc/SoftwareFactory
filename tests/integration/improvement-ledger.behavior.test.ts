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
});
