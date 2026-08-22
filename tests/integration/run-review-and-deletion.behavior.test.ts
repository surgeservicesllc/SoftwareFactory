// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Editing and deleting a run, against the real migrated schema.
 *
 * Two questions run through all of this. What may a person change about a run,
 * and what happens to everything else when a run is removed?
 *
 * The first answer is narrow on purpose: the triage status and note, and
 * nothing that records what actually happened. The second is the reason these
 * tests exist at all — ten tables reference `agent_runs`, and a delete that
 * did not think about each of them would either fail on a foreign key or
 * quietly orphan a pull request that still exists on GitHub.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");
const latestMigration = "20260821000400_command_factory_routing.sql";

const ownerId = "00000000-0000-4000-8000-0000000003a1";
const adminId = "00000000-0000-4000-8000-0000000003a2";
const memberId = "00000000-0000-4000-8000-0000000003a3";
const outsiderId = "00000000-0000-4000-8000-0000000003a4";
const organizationId = "10000000-0000-4000-8000-0000000003a1";
const projectId = "20000000-0000-4000-8000-0000000003a1";
const connectionId = "30000000-0000-4000-8000-0000000003a1";
const installationId = "40000000-0000-4000-8000-0000000003a1";
const repositoryId = "50000000-0000-4000-8000-0000000003a1";
const agentId = "60000000-0000-4000-8000-0000000003a1";
const taskId = "70000000-0000-4000-8000-0000000003a1";
const commandId = "80000000-0000-4000-8000-0000000003a1";
const runId = "90000000-0000-4000-8000-0000000003a1";

let db: PGlite;

async function actAs(userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

/**
 * A completed run, written directly rather than through `submit_command`.
 *
 * The command path is exercised elsewhere; here the run needs to be in a
 * terminal state with evidence attached, which is where deletion actually
 * has to make decisions.
 */
async function seed(runStatus = "failed", leaseExpiresAt: string | null = null) {
  await db.exec("reset role");
  await db.exec(`
    insert into auth.users (id) values
      ('${ownerId}'), ('${adminId}'), ('${memberId}'), ('${outsiderId}');
    insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Run Factory', 'run-review-factory', '${ownerId}');
    insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${adminId}', 'admin'),
             ('${organizationId}', '${memberId}', 'member');
    insert into public.projects (
      id, organization_id, name, status, github_repository, default_branch, created_by
    ) values (
      '${projectId}', '${organizationId}', 'Storefront', 'active',
      'surgeservicesllc/storefront', 'main', '${ownerId}'
    );
    insert into public.connections (
      id, organization_id, name, provider, status, external_account_label,
      secret_reference, created_by
    ) values (
      '${connectionId}', '${organizationId}', 'GitHub App', 'github', 'connected',
      'surgeservicesllc', 'env://GITHUB_APP', '${ownerId}'
    );
    insert into public.github_installations (
      id, organization_id, connection_id, external_installation_id, app_id,
      app_slug, account_id, account_login, account_type, target_type,
      repository_selection, status, installed_at, created_by
    ) values (
      '${installationId}', '${organizationId}', '${connectionId}', 153445938, 4573846,
      'softwarefactory', 839271, 'surgeservicesllc', 'Organization', 'Organization',
      'selected', 'active', now(), '${ownerId}'
    );
    insert into public.github_repositories (
      id, organization_id, installation_id, external_repository_id, owner_login,
      name, full_name, default_branch, html_url, private, visibility, selected,
      github_updated_at
    ) values (
      '${repositoryId}', '${organizationId}', '${installationId}', 99887761,
      'surgeservicesllc', 'storefront', 'surgeservicesllc/storefront', 'main',
      'https://github.com/surgeservicesllc/storefront', true, 'private', true, now()
    );
    insert into public.agents (id, organization_id, name, role, status, created_by)
      values ('${agentId}', '${organizationId}', 'QA', 'qa', 'idle', '${ownerId}');
    -- commands_phase1c_normalize rejects a command whose parameters do not
    -- describe a real manual Phase 1C plan, so the fixture supplies one rather
    -- than working around the guard.
    insert into public.commands (
      id, organization_id, project_id, submitted_by, prompt, requested_risk, status,
      command_type, parameters
    ) values (
      '${commandId}', '${organizationId}', '${projectId}', '${ownerId}',
      'Audit the storefront checkout copy.', 'green', 'succeeded', 'audit',
      jsonb_build_object(
        -- The trigger reads the command type out of the parameters, not the
        -- column, and derives the required agent role from it. Omitting it here
        -- silently made this an 'other' command needing an orchestrator.
        'commandType', 'audit',
        'executionMode', 'manual',
        'acceptanceCriteria', jsonb_build_array('The checkout copy is verified.'),
        'provider', 'openai', 'model', 'gpt-5.3-codex', 'agentRole', 'qa',
        'budget', jsonb_build_object(
          'ciTimeoutMs', 900000, 'maximumDurationMs', 2700000,
          'maximumInputTokens', 200000, 'maximumOutputTokens', 50000,
          'maximumRepairAttempts', 1, 'maximumTurns', 4
        ),
        'plan', jsonb_build_object(
          'requiresDraftPullRequest', true,
          'stages', jsonb_build_array('inspect','implement','validate','policy_scan',
            'commit','draft_pull_request','ci','report'),
          'workflow', 'codex_draft_pr'
        ),
        'riskAssessment', jsonb_build_object()
      )
    );
    -- Inserted without a command_id so tasks_phase1c_plan returns early: that
    -- trigger exists to queue a new run, and this fixture is a run that has
    -- already finished.
    insert into public.tasks (
      id, organization_id, project_id, assigned_agent_id, title, status, risk_level, created_by
    ) values (
      '${taskId}', '${organizationId}', '${projectId}', '${agentId}',
      'Audit the storefront checkout copy', 'completed', 'green', '${ownerId}'
    );
    insert into public.agent_runs (
      id, organization_id, project_id, task_id, agent_id, command_id, status,
      provider, model, risk_level, connection_id, github_repository_id,
      base_branch, base_sha, attempt_number, max_attempts, started_at, completed_at,
      lease_expires_at
    ) values (
      '${runId}', '${organizationId}', '${projectId}', '${taskId}', '${agentId}',
      '${commandId}', '${runStatus}', 'openai', 'gpt-5.3-codex', 'green',
      '${connectionId}', '${repositoryId}', 'main', '${"a".repeat(40)}', 1, 2,
      now() - interval '5 minutes', now() - interval '1 minute',
      ${leaseExpiresAt === null ? "null" : `'${leaseExpiresAt}'`}
    );
    insert into public.phase1c_run_events (
      organization_id, run_id, attempt_number, event_type, message
    ) values
      ('${organizationId}', '${runId}', 1, 'claimed', 'Worker claimed the run.'),
      ('${organizationId}', '${runId}', 1, 'failed', 'The run failed safely.');
    insert into public.phase1c_run_artifacts (
      organization_id, run_id, attempt_number, artifact_type, reference
    ) values ('${organizationId}', '${runId}', 1, 'branch', 'factory/audit-checkout');
    insert into public.phase1c_run_validations (
      organization_id, run_id, attempt_number, validation_round, name, command,
      status, output_summary, duration_ms
    ) values (
      '${organizationId}', '${runId}', 1, 1, 'lint', 'npm run lint', 'failed',
      'Lint reported one error.', 4200
    );
  `);
}

describe("run review and deletion", { timeout: 180_000 }, () => {
  beforeEach(async () => {
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
    const migrations = (await readdir(migrationsRoot))
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();
    expect(migrations.at(-1)).toBe(latestMigration);
    for (const migration of migrations) {
      await db.exec(await readFile(resolve(migrationsRoot, migration), "utf8"));
    }
  });

  afterEach(async () => {
    await db.close();
  });

  it("records a review with its author and time, and shows it on the detail", async () => {
    await seed();
    await actAs(ownerId);

    const { rows } = await db.query<{ review_note: string; review_status: string }>(
      `select review_status, review_note from public.update_agent_run_review(
         $1::uuid, $2::uuid, 'investigating', $3)`,
      [organizationId, runId, "Lint failure looks like a flaky formatter, checking."],
    );
    expect(rows[0]).toMatchObject({ review_status: "investigating" });
    expect(rows[0].review_note).toContain("flaky formatter");

    await db.exec("reset role");
    const stored = await db.query<{ reviewed_at: string | null; reviewed_by: string | null }>(
      "select reviewed_at, reviewed_by::text from public.agent_runs where id = $1",
      [runId],
    );
    // An assertion with no author is not a review.
    expect(stored.rows[0].reviewed_at).not.toBeNull();
    expect(stored.rows[0].reviewed_by).toBe(ownerId);

    await actAs(ownerId);
    const detail = await db.query<{ detail: Record<string, unknown> }>(
      "select detail from public.get_agent_run_detail($1::uuid, $2::uuid)",
      [organizationId, runId],
    );
    expect(detail.rows[0].detail).toMatchObject({
      deletable: true,
      reviewStatus: "investigating",
    });
  });

  it("clears the note and the attribution when the status goes back to unreviewed", async () => {
    await seed();
    await actAs(ownerId);
    await db.query(
      `select * from public.update_agent_run_review($1::uuid, $2::uuid, 'resolved', $3)`,
      [organizationId, runId, "Re-ran and it passed."],
    );
    await db.query(
      `select * from public.update_agent_run_review($1::uuid, $2::uuid, 'unreviewed', null)`,
      [organizationId, runId],
    );

    await db.exec("reset role");
    const { rows } = await db.query<{
      review_note: string | null;
      review_status: string;
      reviewed_at: string | null;
      reviewed_by: string | null;
    }>(
      `select review_status, review_note, reviewed_at, reviewed_by::text
       from public.agent_runs where id = $1`,
      [runId],
    );
    // A note that outlived the finding it described would be worse than none.
    expect(rows[0]).toEqual({
      review_note: null,
      review_status: "unreviewed",
      reviewed_at: null,
      reviewed_by: null,
    });
  });

  it("refuses a note that looks like a credential, and an unknown status", async () => {
    await seed();
    await actAs(ownerId);

    await expect(
      db.query(
        `select * from public.update_agent_run_review($1::uuid, $2::uuid, 'acknowledged', $3)`,
        [organizationId, runId, `The worker used sk-${"a".repeat(48)} for this run.`],
      ),
    ).rejects.toThrow(/cannot contain a credential/);

    await expect(
      db.query(
        `select * from public.update_agent_run_review($1::uuid, $2::uuid, 'wontfix', null)`,
        [organizationId, runId],
      ),
    ).rejects.toThrow(/unknown review status/);
  });

  it("lets an admin review but refuses a plain member and an outsider", async () => {
    await seed();

    await actAs(adminId);
    const { rows } = await db.query<{ review_status: string }>(
      `select review_status from public.update_agent_run_review(
         $1::uuid, $2::uuid, 'acknowledged', 'Seen, no action needed.')`,
      [organizationId, runId],
    );
    expect(rows[0].review_status).toBe("acknowledged");

    for (const userId of [memberId, outsiderId]) {
      await actAs(userId);
      await expect(
        db.query(
          `select * from public.update_agent_run_review($1::uuid, $2::uuid, 'ignored', null)`,
          [organizationId, runId],
        ),
      ).rejects.toThrow(/owner or administrator/);
    }
  });

  it("deletes a finished run, its own evidence, and nothing else", async () => {
    await seed();
    await actAs(ownerId);

    const { rows } = await db.query<{
      deleted_artifacts: number;
      deleted_events: number;
      deleted_validations: number;
    }>(
      `select deleted_events, deleted_artifacts, deleted_validations
       from public.delete_agent_run($1::uuid, $2::uuid, $3)`,
      [organizationId, runId, "Duplicate of an earlier audit run."],
    );
    expect(rows[0]).toEqual({
      deleted_artifacts: 1,
      deleted_events: 2,
      deleted_validations: 1,
    });

    await db.exec("reset role");
    const remaining = await db.query("select 1 from public.agent_runs where id = $1", [runId]);
    expect(remaining.rows).toHaveLength(0);

    // The task, command, project and agent are separate records of separate
    // things and are untouched by removing one run.
    for (const [table, id] of [
      ["tasks", taskId], ["commands", commandId], ["projects", projectId], ["agents", agentId],
    ] as const) {
      const survivor = await db.query(`select 1 from public.${table} where id = $1`, [id]);
      expect(survivor.rows, `${table} should survive`).toHaveLength(1);
    }
  });

  it("records the deletion before performing it, and the record outlives the run", async () => {
    await seed();
    await actAs(ownerId);
    await db.query(
      "select * from public.delete_agent_run($1::uuid, $2::uuid, $3)",
      [organizationId, runId, "Removing a duplicate audit run."],
    );

    await db.exec("reset role");
    const { rows } = await db.query<{
      description: string;
      entity_id: string;
      metadata: Record<string, unknown>;
    }>(
      `select description, entity_id::text, metadata from public.activity_events
       where event_type = 'run.deleted'`,
    );
    expect(rows).toHaveLength(1);
    // The row names the run that no longer exists, and says why it went.
    expect(rows[0].entity_id).toBe(runId);
    expect(rows[0].metadata).toMatchObject({
      model: "gpt-5.3-codex",
      provider: "openai",
      reason: "Removing a duplicate audit run.",
      runStatus: "failed",
    });
  });

  it("keeps the append-only scheduling decision, with the id of the deleted run", async () => {
    await seed();
    await db.exec("reset role");
    await db.query(
      `insert into public.scheduling_decisions (
         organization_id, decision, project_id, run_id, task_id, agent_id,
         worker_id, provider, model, effective_priority, reason
       ) values ($1, 'assigned', $2, $3, $4, $5, 'worker-a', 'openai',
         'gpt-5.3-codex', 2, 'Highest effective priority P2.')`,
      [organizationId, projectId, runId, taskId, agentId],
    );

    await actAs(ownerId);
    await db.query(
      "select * from public.delete_agent_run($1::uuid, $2::uuid, $3)",
      [organizationId, runId, "Cleaning up a superseded run."],
    );

    await db.exec("reset role");
    const { rows } = await db.query<{ run_id: string }>(
      "select run_id::text from public.scheduling_decisions",
    );
    // The scheduler really did assign that run to that worker, and deleting the
    // run does not make it untrue. An audit row that vanished with its subject
    // would not be an audit row.
    expect(rows).toHaveLength(1);
    expect(rows[0].run_id).toBe(runId);
  });

  it("refuses a queued run and a run holding a live lease", async () => {
    await seed("queued");
    await actAs(ownerId);
    await expect(
      db.query("select * from public.delete_agent_run($1::uuid, $2::uuid, $3)", [
        organizationId, runId, "Trying to remove queued work.",
      ]),
    ).rejects.toThrow(/queued for execution; cancel it/);

    await db.exec("reset role");
    await db.query(
      `update public.agent_runs set status = 'running',
         lease_worker_id = 'worker-a', lease_token = gen_random_uuid(),
         lease_expires_at = now() + interval '2 minutes'
       where id = $1`,
      [runId],
    );
    await actAs(ownerId);
    await expect(
      db.query("select * from public.delete_agent_run($1::uuid, $2::uuid, $3)", [
        organizationId, runId, "Trying to remove a live run.",
      ]),
    ).rejects.toThrow(/live worker lease/);
  });

  it("refuses a run that produced a pull request, and says what is bound", async () => {
    await seed();
    await db.exec("reset role");
    await db.query(
      `insert into public.pull_requests (
         organization_id, project_id, agent_run_id, repository, external_number,
         title, url, status, head_branch, base_branch
       ) values ($1, $2, $3, 'surgeservicesllc/storefront', 41,
         'Audit checkout copy', 'https://github.com/surgeservicesllc/storefront/pull/41',
         'draft', 'factory/audit-checkout', 'main')`,
      [organizationId, projectId, runId],
    );

    await actAs(ownerId);
    await expect(
      db.query("select * from public.delete_agent_run($1::uuid, $2::uuid, $3)", [
        organizationId, runId, "Removing without thinking about the PR.",
      ]),
    ).rejects.toThrow(/1 pull request\(s\).*delete it with detachment/);

    // Nothing was removed by the refusal.
    await db.exec("reset role");
    const survived = await db.query("select 1 from public.agent_runs where id = $1", [runId]);
    expect(survived.rows).toHaveLength(1);
  });

  it("keeps the pull request and unlinks it when the owner asks for detachment", async () => {
    await seed();
    await db.exec("reset role");
    await db.query(
      `insert into public.pull_requests (
         organization_id, project_id, agent_run_id, repository, external_number,
         title, url, status, head_branch, base_branch
       ) values ($1, $2, $3, 'surgeservicesllc/storefront', 41,
         'Audit checkout copy', 'https://github.com/surgeservicesllc/storefront/pull/41',
         'draft', 'factory/audit-checkout', 'main')`,
      [organizationId, projectId, runId],
    );

    await actAs(ownerId);
    const { rows } = await db.query<{ detached_pull_requests: number }>(
      `select detached_pull_requests from public.delete_agent_run(
         $1::uuid, $2::uuid, $3, true)`,
      [organizationId, runId, "Superseded; keeping the pull request."],
    );
    expect(rows[0].detached_pull_requests).toBe(1);

    await db.exec("reset role");
    const pull = await db.query<{ agent_run_id: string | null; external_number: number }>(
      "select agent_run_id::text, external_number from public.pull_requests",
    );
    // The pull request on GitHub exists whatever this database does, so the row
    // stays and simply stops claiming a run that is gone.
    expect(pull.rows).toHaveLength(1);
    expect(pull.rows[0]).toEqual({ agent_run_id: null, external_number: 41 });
  });

  it("refuses deletion without a reason, and refuses everyone but the owner", async () => {
    await seed();

    await actAs(ownerId);
    await expect(
      db.query("select * from public.delete_agent_run($1::uuid, $2::uuid, $3)", [
        organizationId, runId, "   ",
      ]),
    ).rejects.toThrow(/reason is required/);

    for (const userId of [adminId, memberId, outsiderId]) {
      await actAs(userId);
      await expect(
        db.query("select * from public.delete_agent_run($1::uuid, $2::uuid, $3)", [
          organizationId, runId, "Not mine to delete.",
        ]),
        `${userId} must not delete`,
      ).rejects.toThrow(/only an organization owner/);
    }

    await db.exec("reset role");
    const survived = await db.query("select 1 from public.agent_runs where id = $1", [runId]);
    expect(survived.rows).toHaveLength(1);
  });

  it("tells a non-owner the run is not deletable, so the console can hide the control", async () => {
    await seed();
    await actAs(adminId);
    const { rows } = await db.query<{ detail: Record<string, unknown> }>(
      "select detail from public.get_agent_run_detail($1::uuid, $2::uuid)",
      [organizationId, runId],
    );
    expect(rows[0].detail).toMatchObject({ deletable: false });
  });

  it("keeps evidence append-only for everything except the run being deleted", async () => {
    await seed();
    const otherRunId = "90000000-0000-4000-8000-0000000003b9";
    await db.exec("reset role");
    await db.query(
      `insert into public.agent_runs (
         id, organization_id, project_id, task_id, agent_id, command_id, status,
         provider, model, risk_level, base_branch, attempt_number, max_attempts
       ) values ($1, $2, $3, $4, $5, $6, 'failed', 'openai', 'gpt-5.3-codex',
         'green', 'main', 1, 2)`,
      [otherRunId, organizationId, projectId, taskId, agentId, commandId],
    );
    await db.query(
      `insert into public.phase1c_run_events (
         organization_id, run_id, attempt_number, event_type, message
       ) values ($1, $2, 1, 'failed', 'A different run failed.')`,
      [organizationId, otherRunId],
    );

    // An update is refused unconditionally: the exception is for removing a
    // run outright, never for rewriting what it recorded.
    await expect(
      db.query("update public.phase1c_run_events set message = 'rewritten'"),
    ).rejects.toThrow(/append-only/);

    // And the exception is keyed to one exact run. Announcing one run does not
    // open the door to another's evidence.
    await db.query("select set_config('softwarefactory.deleting_run_id', $1, false)", [runId]);
    await expect(
      db.query("delete from public.phase1c_run_events where run_id = $1", [otherRunId]),
    ).rejects.toThrow(/append-only/);
    await db.query("select set_config('softwarefactory.deleting_run_id', '', false)");

    // A browser session cannot reach the trigger at all, announcement or not.
    await actAs(ownerId);
    await db.query("select set_config('softwarefactory.deleting_run_id', $1, false)", [runId]);
    await expect(
      db.query("delete from public.phase1c_run_events where run_id = $1", [runId]),
    ).rejects.toThrow(/permission denied/);
  });

  it("withdraws the announcement, so it cannot outlive the deletion in one transaction", async () => {
    await seed();
    await actAs(ownerId);
    await db.query(
      "select * from public.delete_agent_run($1::uuid, $2::uuid, $3)",
      [organizationId, runId, "Removing a superseded run."],
    );

    await db.exec("reset role");
    const { rows } = await db.query<{ announced: string | null }>(
      "select nullif(current_setting('softwarefactory.deleting_run_id', true), '') as announced",
    );
    expect(rows[0].announced).toBeNull();
  });

  it("grants service_role nothing on either new function", async () => {
    await db.exec("reset role");
    const { rows } = await db.query<{ delete_run: boolean; update_review: boolean }>(`
      select
        pg_catalog.has_function_privilege(
          'service_role', 'public.delete_agent_run(uuid,uuid,text,boolean)', 'EXECUTE'
        ) as delete_run,
        pg_catalog.has_function_privilege(
          'service_role', 'public.update_agent_run_review(uuid,uuid,text,text)', 'EXECUTE'
        ) as update_review
    `);
    // A worker's service role executes runs; it does not get to edit the
    // record of what it did, or remove it.
    expect(rows[0]).toEqual({ delete_run: false, update_review: false });
  });
});
