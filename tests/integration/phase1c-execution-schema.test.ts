// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const OWNER_ID = "00000000-0000-4000-8000-000000000201";
const ADMIN_ID = "00000000-0000-4000-8000-000000000202";

type Fixture = {
  db: PGlite;
  organizationId: string;
  projectId: string;
  agentId: string;
};

let fixture: Fixture;

async function applyAllMigrations(db: PGlite) {
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
    create role service_role nologin;
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
  }

  return files;
}

async function actAs(db: PGlite, userId: string) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false);`);
}

beforeAll(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await applyAllMigrations(db);

  await db.exec(`insert into auth.users (id) values ('${OWNER_ID}'), ('${ADMIN_ID}');`);
  await actAs(db, OWNER_ID);

  const organization = await db.query<{ id: string }>(
    `insert into public.organizations (name, slug, created_by)
     values ('Execution Factory', 'execution-factory', '${OWNER_ID}') returning id`,
  );
  const organizationId = organization.rows[0]!.id;

  const project = await db.query<{ id: string }>(
    `insert into public.projects (organization_id, name, status, github_repository, default_branch, created_by)
     values ('${organizationId}', 'SoftwareFactory', 'active', 'surgeservicesllc/SoftwareFactory', 'main', '${OWNER_ID}')
     returning id`,
  );

  await db.query(`select public.ensure_default_agents('${organizationId}')`);
  const agent = await db.query<{ id: string }>(
    `select id from public.agents where organization_id = '${organizationId}' and role = 'frontend'`,
  );

  fixture = {
    db,
    organizationId,
    projectId: project.rows[0]!.id,
    agentId: agent.rows[0]!.id,
  };
}, 120_000);

async function seedRun(options: {
  risk?: "green" | "yellow" | "red";
  status?: string;
  projectId?: string;
} = {}) {
  const { db, organizationId, projectId, agentId } = fixture;
  const task = await db.query<{ id: string }>(
    `insert into public.tasks (organization_id, project_id, title, status, risk_level, created_by)
     values ('${organizationId}', '${options.projectId ?? projectId}', 'Seeded task', 'queued',
             '${options.risk ?? "green"}', '${OWNER_ID}')
     returning id`,
  );
  const run = await db.query<{ id: string }>(
    `insert into public.agent_runs (organization_id, project_id, task_id, agent_id, status)
     values ('${organizationId}', '${options.projectId ?? projectId}', '${task.rows[0]!.id}',
             '${agentId}', '${options.status ?? "queued"}')
     returning id`,
  );
  return { runId: run.rows[0]!.id, taskId: task.rows[0]!.id };
}

/** Releases leases left behind by earlier cases so a test can assert claim behavior in isolation. */
async function releaseAllLeases() {
  await fixture.db.exec(
    `update public.agent_runs set lease_owner = null, lease_expires_at = null
     where lease_owner is not null`,
  );
}

async function leaseRun(runId: string, worker = "worker-test") {
  await fixture.db.query(
    `update public.agent_runs
     set lease_owner = '${worker}', lease_expires_at = now() + interval '5 minutes', status = 'running'
     where id = '${runId}'`,
  );
}

describe("Phase 1C execution schema", () => {
  it("applies every migration and keeps RLS and FORCE RLS on all public tables", async () => {
    const tables = await fixture.db.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `);

    expect(tables.rows.length).toBeGreaterThanOrEqual(26);
    const unprotected = tables.rows.filter(
      (row) => !row.relrowsecurity || !row.relforcerowsecurity,
    );
    expect(unprotected.map((row) => row.relname)).toEqual([]);
  });

  it("keeps the durable worker boundary revoked from anon and authenticated", async () => {
    const grants = await fixture.db.query<{ routine_name: string; grantee: string }>(`
      select p.proname as routine_name, r.rolname as grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(p.proacl) acl
      join pg_roles r on r.oid = acl.grantee
      where n.nspname = 'public'
        and p.proname in (
          'claim_agent_runs', 'heartbeat_agent_run', 'finish_agent_run',
          'record_run_event', 'record_run_workspace', 'record_run_result',
          'record_run_pull_request'
        )
        and r.rolname in ('anon', 'authenticated')
    `);

    expect(grants.rows).toEqual([]);
  });

  it("seeds the built-in agent roster idempotently", async () => {
    const before = await fixture.db.query<{ n: number }>(
      `select count(*)::int as n from public.agents where organization_id = '${fixture.organizationId}'`,
    );
    await fixture.db.query(`select public.ensure_default_agents('${fixture.organizationId}')`);
    const after = await fixture.db.query<{ n: number }>(
      `select count(*)::int as n from public.agents where organization_id = '${fixture.organizationId}'`,
    );

    expect(before.rows[0]!.n).toBe(11);
    expect(after.rows[0]!.n).toBe(11);
  });

  it("defaults commanded execution to OFF and requires an owner to change it", async () => {
    const settings = await fixture.db.query<{ execution_enabled: boolean }>(
      `select * from public.get_organization_settings('${fixture.organizationId}')`,
    );
    expect(settings.rows[0]!.execution_enabled).toBe(false);

    await fixture.db.exec(`
      insert into public.organization_members (organization_id, user_id, role, created_by)
      values ('${fixture.organizationId}', '${ADMIN_ID}', 'admin', '${OWNER_ID}')
      on conflict do nothing;
    `);
    await actAs(fixture.db, ADMIN_ID);
    await expect(
      fixture.db.query(
        `select * from public.update_organization_settings('${fixture.organizationId}', null, null, true)`,
      ),
    ).rejects.toThrow(/only an organization owner/i);
    await actAs(fixture.db, OWNER_ID);
  });

  it("never claims work while commanded execution is disabled", async () => {
    const { runId } = await seedRun();
    const claimed = await fixture.db.query<{ id: string }>(
      `select * from public.claim_agent_runs('worker-off', 5, 300)`,
    );
    expect(claimed.rows.some((row) => row.id === runId)).toBe(false);

    await fixture.db.query(
      `select * from public.update_organization_settings('${fixture.organizationId}', null, null, true)`,
    );
    const afterEnable = await fixture.db.query<{ id: string; lease_owner: string; attempt: number }>(
      `select * from public.claim_agent_runs('worker-on', 1, 300)`,
    );
    expect(afterEnable.rows).toHaveLength(1);
    expect(afterEnable.rows[0]!.lease_owner).toBe("worker-on");
    expect(afterEnable.rows[0]!.attempt).toBe(1);

    await fixture.db.query(
      `select * from public.finish_agent_run('${afterEnable.rows[0]!.id}', 'worker-on', 'succeeded', null, null, null)`,
    );
  });

  it("never claims unapproved RED work", async () => {
    const { runId } = await seedRun({ risk: "red" });
    const claimed = await fixture.db.query<{ id: string }>(
      `select * from public.claim_agent_runs('worker-red', 10, 300)`,
    );
    expect(claimed.rows.some((row) => row.id === runId)).toBe(false);
  });

  it("decomposes a command into dependent tasks and supersedes the intake task", async () => {
    const command = await fixture.db.query<{ command_id: string }>(
      `select * from public.submit_command('${fixture.projectId}', 'Improve mobile navigation', 'green', '{}'::jsonb, null)`,
    );
    const commandId = command.rows[0]!.command_id;

    const planned = await fixture.db.query<{
      command_state: string;
      task_ids: string[];
      run_ids: string[];
    }>(`select * from public.persist_command_plan('${commandId}', $1::jsonb)`, [
      JSON.stringify({
        summary: "Repair mobile navigation",
        tasks: [
          { key: "audit", title: "Audit mobile navigation", agentRole: "frontend", risk: "green" },
          { key: "fix", title: "Repair mobile navigation", agentRole: "frontend", risk: "green", dependsOn: "audit" },
        ],
      }),
    ]);

    expect(planned.rows[0]!.task_ids).toHaveLength(2);
    expect(planned.rows[0]!.run_ids).toHaveLength(2);
    expect(planned.rows[0]!.command_state).toBe("queued");

    const intake = await fixture.db.query<{ status: string }>(
      `select status from public.tasks where command_id = '${commandId}' and source = 'owner'`,
    );
    expect(intake.rows[0]!.status).toBe("superseded");

    const plannedTasks = await fixture.db.query<{ status: string }>(
      `select status from public.tasks
       where command_id = '${commandId}' and source = 'orchestrator' order by created_at`,
    );
    expect(plannedTasks.rows.map((row) => row.status)).toEqual(["queued", "blocked"]);

    await expect(
      fixture.db.query(`select * from public.persist_command_plan('${commandId}', $1::jsonb)`, [
        JSON.stringify({ tasks: [] }),
      ]),
    ).rejects.toThrow(/already has a persisted plan/i);
  });

  it("refuses dependent work until its dependency completes", async () => {
    const command = await fixture.db.query<{ command_id: string }>(
      `select * from public.submit_command('${fixture.projectId}', 'Sequential delivery work', 'green', '{}'::jsonb, null)`,
    );
    const planned = await fixture.db.query<{ run_ids: string[] }>(
      `select * from public.persist_command_plan('${command.rows[0]!.command_id}', $1::jsonb)`,
      [
        JSON.stringify({
          tasks: [
            { key: "one", title: "First", agentRole: "backend", risk: "green" },
            { key: "two", title: "Second", agentRole: "backend", risk: "green", dependsOn: "one" },
          ],
        }),
      ],
    );
    const [firstRunId, secondRunId] = planned.rows[0]!.run_ids;

    const firstClaim = await fixture.db.query<{ id: string }>(
      `select * from public.claim_agent_runs('worker-seq', 10, 300)`,
    );
    expect(firstClaim.rows.some((row) => row.id === firstRunId)).toBe(true);
    expect(firstClaim.rows.some((row) => row.id === secondRunId)).toBe(false);

    await fixture.db.query(
      `select * from public.finish_agent_run('${firstRunId}', 'worker-seq', 'succeeded', null, null, null)`,
    );

    const secondClaim = await fixture.db.query<{ id: string }>(
      `select * from public.claim_agent_runs('worker-seq', 10, 300)`,
    );
    expect(secondClaim.rows.some((row) => row.id === secondRunId)).toBe(true);
    await fixture.db.query(
      `select * from public.finish_agent_run('${secondRunId}', 'worker-seq', 'succeeded', null, null, null)`,
    );
  });

  it("keeps run events append-only, sequenced, and free of likely secrets", async () => {
    const { runId } = await seedRun();
    await leaseRun(runId);

    await fixture.db.query(
      `select public.record_run_event('${runId}', 'workspace.created', 'Isolated branch created.', '{}'::jsonb)`,
    );
    await fixture.db.query(
      `select public.record_run_event('${runId}', 'implementation.started', 'Provider work started.', '{}'::jsonb)`,
    );

    const events = await fixture.db.query<{ sequence: string }>(
      `select sequence from public.run_events where agent_run_id = '${runId}' order by sequence`,
    );
    expect(events.rows.map((row) => Number(row.sequence))).toEqual([1, 2]);

    await expect(
      fixture.db.exec(`update public.run_events set message = 'tampered' where agent_run_id = '${runId}'`),
    ).rejects.toThrow(/append-only/i);

    await expect(
      fixture.db.query(`select public.record_run_event('${runId}', 'file.modified', $1, '{}'::jsonb)`, [
        "leaked ghp_abcdefghijklmnopqrstuvwxyz012345",
      ]),
    ).rejects.toThrow();
  });

  it("rejects a worker that no longer holds the lease", async () => {
    const { runId } = await seedRun();
    await leaseRun(runId, "worker-holder");

    await expect(
      fixture.db.query(`select * from public.heartbeat_agent_run('${runId}', 'worker-thief', null, 300)`),
    ).rejects.toThrow(/lease is no longer held/i);
    await expect(
      fixture.db.query(
        `select * from public.finish_agent_run('${runId}', 'worker-thief', 'succeeded', null, null, null)`,
      ),
    ).rejects.toThrow(/lease is no longer held/i);
  });

  it("retries only transient failures and never retries a policy failure", async () => {
    const transient = await seedRun();
    await leaseRun(transient.runId, "worker-retry");
    await fixture.db.query(
      `update public.agent_runs set attempt = 1, max_attempts = 3 where id = '${transient.runId}'`,
    );
    await fixture.db.query(
      `select * from public.finish_agent_run('${transient.runId}', 'worker-retry', 'failed', 'provider_rate_limit', 'rate limited', 60)`,
    );
    const retried = await fixture.db.query<{ status: string; next_attempt_at: string | null }>(
      `select status, next_attempt_at from public.agent_runs where id = '${transient.runId}'`,
    );
    expect(retried.rows[0]!.status).toBe("queued");
    expect(retried.rows[0]!.next_attempt_at).not.toBeNull();

    const policy = await seedRun();
    await leaseRun(policy.runId, "worker-policy");
    await fixture.db.query(
      `select * from public.finish_agent_run('${policy.runId}', 'worker-policy', 'failed', 'protected_resource', 'protected path', 60)`,
    );
    const blocked = await fixture.db.query<{ status: string; failure_kind: string }>(
      `select status, failure_kind from public.agent_runs where id = '${policy.runId}'`,
    );
    expect(blocked.rows[0]!.status).toBe("failed");
    expect(blocked.rows[0]!.failure_kind).toBe("protected_resource");
  });

  it("cancels a queued run immediately and stops a leased run before further effects", async () => {
    const queued = await seedRun();
    await fixture.db.query(`select * from public.request_run_cancellation('${queued.runId}', 'Not needed')`);
    const queuedResult = await fixture.db.query<{ status: string; lease_owner: string | null }>(
      `select status, lease_owner from public.agent_runs where id = '${queued.runId}'`,
    );
    expect(queuedResult.rows[0]!.status).toBe("cancelled");
    expect(queuedResult.rows[0]!.lease_owner).toBeNull();

    const leased = await seedRun();
    await leaseRun(leased.runId, "worker-cancel");
    await fixture.db.query(`select * from public.request_run_cancellation('${leased.runId}', 'Stop now')`);
    const leasedResult = await fixture.db.query<{ status: string; cancel_requested_at: string | null }>(
      `select status, cancel_requested_at from public.agent_runs where id = '${leased.runId}'`,
    );
    expect(leasedResult.rows[0]!.status).toBe("cancelling");
    expect(leasedResult.rows[0]!.cancel_requested_at).not.toBeNull();

    const cancelledClaim = await fixture.db.query<{ id: string }>(
      `select * from public.claim_agent_runs('worker-after-cancel', 10, 300)`,
    );
    expect(cancelledClaim.rows.some((row) => row.id === leased.runId)).toBe(false);
  });

  it("holds new work at the organization concurrency ceiling", async () => {
    await releaseAllLeases();
    const first = await seedRun();
    const second = await seedRun();
    const third = await seedRun();

    const claimed = await fixture.db.query<{ id: string }>(
      `select * from public.claim_agent_runs('worker-concurrency', 10, 300)`,
    );
    const claimedIds = claimed.rows.map((row) => row.id);

    // max_concurrent_runs defaults to 2, so the third run waits.
    expect(claimedIds).toHaveLength(2);
    expect([first.runId, second.runId, third.runId].filter((id) => claimedIds.includes(id))).toHaveLength(2);

    await releaseAllLeases();
  });

  it("reclaims an expired lease instead of stranding the run", async () => {
    await releaseAllLeases();
    const { runId } = await seedRun();
    await fixture.db.query(
      `update public.agent_runs
       set status = 'running', lease_owner = 'worker-dead', lease_expires_at = now() - interval '1 minute'
       where id = '${runId}'`,
    );

    const reclaimed = await fixture.db.query<{ id: string; lease_owner: string }>(
      `select * from public.claim_agent_runs('worker-fresh', 10, 300)`,
    );
    expect(reclaimed.rows.some((row) => row.id === runId)).toBe(true);

    const events = await fixture.db.query<{ event_type: string }>(
      `select event_type from public.run_events where agent_run_id = '${runId}'`,
    );
    expect(events.rows.map((row) => row.event_type)).toContain("run.lease_expired");
    await fixture.db.query(
      `select * from public.finish_agent_run('${runId}', 'worker-fresh', 'succeeded', null, null, null)`,
    );
  });

  it("stores structured results and a draft pull request without secret material", async () => {
    const { runId, taskId } = await seedRun();
    await leaseRun(runId, "worker-result");

    await fixture.db.query(`select * from public.record_run_result('${runId}', 'worker-result', $1::jsonb)`, [
      JSON.stringify({
        summary: "Repaired the mobile drawer focus trap.",
        filesChanged: 2,
        additions: 30,
        deletions: 4,
        testsOutcome: "passed",
        lintOutcome: "passed",
        riskLevel: "green",
      }),
    ]);
    const result = await fixture.db.query<{ files_changed: number; tests_outcome: string }>(
      `select files_changed, tests_outcome from public.run_results where agent_run_id = '${runId}'`,
    );
    expect(result.rows[0]!.files_changed).toBe(2);
    expect(result.rows[0]!.tests_outcome).toBe("passed");

    await expect(
      fixture.db.query(`select * from public.record_run_result('${runId}', 'worker-result', $1::jsonb)`, [
        JSON.stringify({ summary: "ok", apiKey: "sk-abcdefghijklmnopqrstuvwxyz0123" }),
      ]),
    ).rejects.toThrow();

    const pullRequest = await fixture.db.query<{ status: string }>(
      `select * from public.record_run_pull_request(
        '${runId}', 'worker-result', 'surgeservicesllc/SoftwareFactory', 4242,
        'Repair mobile navigation', 'https://github.com/surgeservicesllc/SoftwareFactory/pull/4242',
        'factory/${runId}-mobile', 'main', 'green')`,
    );
    expect(pullRequest.rows[0]!.status).toBe("draft");

    const linked = await fixture.db.query<{ pull_request_id: string | null }>(
      `select pull_request_id from public.tasks where id = '${taskId}'`,
    );
    expect(linked.rows[0]!.pull_request_id).not.toBeNull();
  });

  it("keeps one isolated working branch per run", async () => {
    const first = await seedRun();
    await leaseRun(first.runId, "worker-ws");
    await fixture.db.query(`
      select * from public.record_run_workspace(
        '${first.runId}', 'worker-ws', 'surgeservicesllc/SoftwareFactory', 12345, 'main',
        '${"a".repeat(40)}', 'factory/${first.runId}-slug', 'openai_codex', 'gpt-5-codex')
    `);

    const second = await seedRun();
    await leaseRun(second.runId, "worker-ws");
    await expect(
      fixture.db.query(`
        select * from public.record_run_workspace(
          '${second.runId}', 'worker-ws', 'surgeservicesllc/SoftwareFactory', 12345, 'main',
          '${"b".repeat(40)}', 'factory/${first.runId}-slug', 'openai_codex', 'gpt-5-codex')
      `),
    ).rejects.toThrow();
  });

  it("preserves the Phase 1D interlocks", async () => {
    await expect(
      fixture.db.exec(`update public.projects set autonomous_mode = true where id = '${fixture.projectId}'`),
    ).rejects.toThrow();
    await expect(
      fixture.db.exec(
        `update public.organizations set autonomy_kill_switch_active = false where id = '${fixture.organizationId}'`,
      ),
    ).rejects.toThrow();
  });
});
