// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPhase1CExecutionPlan } from "@/lib/orchestration/plan";

/**
 * The two bulk-clear controls, against real PostgreSQL.
 *
 * What is worth testing here is not that a delete deletes. It is the four
 * things these functions refuse, because the foreign keys cascade
 * `commands -> tasks -> agent_runs` and a naive clear would take run history
 * with it — walking past every rule `delete_agent_run` exists to enforce.
 */

const migrationsRoot = resolve(import.meta.dirname, "../../supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000c001";
const memberId = "00000000-0000-4000-8000-00000000c002";
const organizationId = "10000000-0000-4000-8000-00000000c001";
const projectId = "40000000-0000-4000-8000-00000000c001";
const agentId = "50000000-0000-4000-8000-00000000c001";

let db: PGlite;

async function asUser(userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1::text, false)", [userId]);
  await db.query(
    "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)",
    [userId],
  );
}

/**
 * A command must satisfy two triggers before it exists at all: the Phase 1C
 * plan shape (20260813001000) and the execution configuration boundary
 * (20260813000900), which pins provider, model, role, budget and plan so
 * browser input cannot widen them.
 *
 * The parameters therefore come from the application's own plan builder rather
 * than being hand-copied — the same choice the AI Factory journey suite makes,
 * and for the same reason: a hand-written copy drifts from the trigger and the
 * test then fails on its fixture instead of on its subject.
 */
async function makeCommand(status = "succeeded"): Promise<string> {
  const plan = createPhase1CExecutionPlan("other", {});
  const result = await db.query<{ id: string }>(
    `insert into public.commands (organization_id, project_id, submitted_by, prompt, status, parameters)
     values ($1, $2, $3, 'Do the thing', $4::public.command_status, $5::jsonb) returning id`,
    [
      organizationId,
      projectId,
      ownerId,
      status,
      JSON.stringify({
        acceptanceCriteria: ["The thing is done"],
        agentRole: plan.agentRole,
        budget: plan.budget,
        commandType: "other",
        dependencyTaskIds: [],
        executionMode: "manual",
        model: plan.model,
        plan: plan.plan,
        provider: plan.provider,
        /*
         * The binding trigger (20260813000900:1010-1023) checks shape only —
         * uuid and numeric-string regexes on the JSON, no rows looked up — so
         * a well-formed synthetic binding satisfies it without dragging a
         * GitHub connection, installation and repository into this file.
         */
        repositoryBinding: {
          appId: 4582606,
          baseBranch: "main",
          baseSha: "0123456789abcdef0123456789abcdef01234567",
          connectionId: "60000000-0000-4000-8000-00000000c001",
          externalInstallationId: 12345678,
          externalRepositoryId: 87654321,
          installationId: "60000000-0000-4000-8000-00000000c002",
          repositoryId: "60000000-0000-4000-8000-00000000c003",
        },
        riskAssessment: { factors: [], reasons: [], requestedRisk: "green" },
      }),
    ],
  );
  return result.rows[0].id;
}

async function makeTask(status = "backlog", commandId: string | null = null): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into public.tasks (organization_id, project_id, command_id, title, status, created_by)
     values ($1, $2, $3, 'A work item', $4::public.task_status, $5) returning id`,
    [organizationId, projectId, commandId, status, ownerId],
  );
  return result.rows[0].id;
}

/**
 * A command, its task and a run on that task — the full two-hop chain.
 *
 * The two Phase 1C planning triggers are suspended while this is built, and
 * restored immediately after. That is a deliberate, narrow choice:
 *
 * `command_id` is immutable on tasks, so the link can only be made at insert;
 * and inserting a linked task runs a planner that demands a queued status and
 * a repository binding it re-validates against real GitHub connection,
 * installation and repository rows. Those are rules about SUBMITTING work.
 * This file is about DELETING it, and standing up a GitHub installation to
 * test a delete would make the fixture the subject.
 *
 * What is not weakened: the rows this produces are exactly the rows production
 * holds — a terminal command, its terminal task, and a run — which is all the
 * clear functions read.
 */
async function makeCommandChain(): Promise<{ commandId: string; taskId: string }> {
  await db.exec("reset role");
  await db.exec(`
    alter table public.tasks disable trigger tasks_phase1c_plan;
    alter table public.tasks disable trigger tasks_phase1c_queue;
  `);
  try {
    const commandId = await makeCommand("succeeded");
    const taskId = await makeTask("completed", commandId);
    await makeRun(taskId);
    return { commandId, taskId };
  } finally {
    await db.exec(`
      alter table public.tasks enable trigger tasks_phase1c_plan;
      alter table public.tasks enable trigger tasks_phase1c_queue;
    `);
  }
}

async function makeRun(taskId: string): Promise<void> {
  await db.query(
    `insert into public.agent_runs (organization_id, project_id, task_id, agent_id, status)
     values ($1, $2, $3, $4, 'succeeded'::public.run_status)`,
    [organizationId, projectId, taskId, agentId],
  );
}

async function clearBacklog(reason = "clearing stale planning rows", includeRuns = false) {
  return db.query<{ deleted_count: number; kept_running: number; kept_with_runs: number }>(
    "select * from public.clear_backlog_tasks($1::uuid, $2::text, $3::boolean)",
    [organizationId, reason, includeRuns],
  );
}

async function clearPipelines(reason = "clearing stale pipeline rows", includeRuns = false) {
  return db.query<{ deleted_count: number; kept_running: number; kept_with_runs: number }>(
    "select * from public.clear_all_pipelines($1::uuid, $2::text, $3::boolean)",
    [organizationId, reason, includeRuns],
  );
}

async function counts(): Promise<{ tasks: number; commands: number; runs: number }> {
  await db.exec("reset role");
  const result = await db.query<{ tasks: number; commands: number; runs: number }>(`
    select (select count(*)::int from public.tasks) as tasks,
           (select count(*)::int from public.commands) as commands,
           (select count(*)::int from public.agent_runs) as runs`);
  return result.rows[0];
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
  for (const file of (await readdir(migrationsRoot)).filter((n) => /^\d+.*\.sql$/.test(n)).sort()) {
    await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
  }

  await db.exec(`
    insert into auth.users (id) values ('${ownerId}'), ('${memberId}');
    insert into public.organizations (id, name, slug, created_by) values
      ('${organizationId}', 'Clear Co', 'clear-co', '${ownerId}');
    insert into public.projects (id, organization_id, name, status, created_by) values
      ('${projectId}', '${organizationId}', 'Clear Project', 'active', '${ownerId}');
  `);
  for (const [userId, role] of [[ownerId, "owner"], [memberId, "member"]] as const) {
    await db.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, $3) on conflict (organization_id, user_id) do update set role = $3`,
      [organizationId, userId, role],
    );
  }
  await db.query(
    `insert into public.agents (id, organization_id, name, role, status, created_by)
     values ($1, $2, 'Clear Agent', 'backend'::public.agent_role, 'idle'::public.agent_status, $3)`,
    [agentId, organizationId, ownerId],
  );
}, 180_000);

// Each case starts from an empty board: these functions are about counts, and
// a leftover row from the previous test changes every number.
beforeEach(async () => {
  await db.exec("reset role");
  await db.exec(`
    delete from public.agent_runs;
    delete from public.tasks;
    delete from public.commands;
  `);
});

afterAll(async () => {
  await db?.close();
});

describe("clearing the backlog", () => {
  it("removes work items that carry no run history", async () => {
    await makeTask("backlog");
    await makeTask("completed");
    await asUser(ownerId);

    const result = await clearBacklog();
    expect(result.rows[0].deleted_count).toBe(2);
    expect((await counts()).tasks).toBe(0);
  });

  it("leaves running and queued work alone, and counts it", async () => {
    /*
     * There is no flag for this one. A worker may hold a lease on an
     * in-progress task, and deleting the row underneath it corrupts an
     * execution that is currently happening.
     */
    await makeTask("in_progress");
    await makeTask("queued");
    await makeTask("backlog");
    await asUser(ownerId);

    const result = await clearBacklog();
    expect(result.rows[0].deleted_count).toBe(1);
    expect(result.rows[0].kept_running).toBe(2);
    expect((await counts()).tasks).toBe(2);
  });

  it("keeps work that would take run history with it, by default", async () => {
    /*
     * The load-bearing refusal. agent_runs.task_id is ON DELETE CASCADE, so
     * deleting this task silently deletes its runs — past every guard in
     * delete_agent_run. The default has to be to keep it.
     */
    const withRuns = await makeTask("completed");
    await makeRun(withRuns);
    await makeTask("backlog");
    await asUser(ownerId);

    const result = await clearBacklog();
    expect(result.rows[0].deleted_count).toBe(1);
    expect(result.rows[0].kept_with_runs).toBe(1);

    const after = await counts();
    expect(after.tasks).toBe(1);
    expect(after.runs).toBe(1);
  });

  it("removes it anyway when the caller opts in explicitly", async () => {
    const withRuns = await makeTask("completed");
    await makeRun(withRuns);
    await asUser(ownerId);

    const result = await clearBacklog("owner asked for a full reset", true);
    expect(result.rows[0].deleted_count).toBe(1);
    expect(result.rows[0].kept_with_runs).toBe(0);
    // The cascade is real, which is exactly why it is not the default.
    expect((await counts()).runs).toBe(0);
  });

  it("records an audit row naming the reason and the counts", async () => {
    await makeTask("backlog");
    await asUser(ownerId);
    await clearBacklog("tidying the planning list");

    await db.exec("reset role");
    const events = await db.query<{ event_type: string; metadata: Record<string, unknown> }>(
      `select event_type, metadata from public.activity_events
        where event_type = 'task.backlog_cleared' order by created_at desc limit 1`,
    );
    expect(events.rows[0].metadata.reason).toBe("tidying the planning list");
    expect(events.rows[0].metadata.deleted_count).toBe(1);
  });

  it("records the attempt even when it deleted nothing", async () => {
    // A clear that refused everything is still a thing someone did.
    // Counted as a delta, because activity_events is append-only and every
    // earlier case in this file has left its own row behind.
    await db.exec("reset role");
    const before = await db.query<{ count: number }>(
      `select count(*)::int as count from public.activity_events
        where event_type = 'task.backlog_cleared'`,
    );

    await makeTask("in_progress");
    await asUser(ownerId);
    const result = await clearBacklog();
    expect(result.rows[0].deleted_count).toBe(0);

    await db.exec("reset role");
    const after = await db.query<{ count: number }>(
      `select count(*)::int as count from public.activity_events
        where event_type = 'task.backlog_cleared'`,
    );
    expect(after.rows[0].count).toBe(before.rows[0].count + 1);
  });
});

describe("what clearing the backlog refuses", () => {
  it("refuses a member who is not an owner or admin", async () => {
    await makeTask("backlog");
    await asUser(memberId);
    await expect(clearBacklog()).rejects.toThrow(/only an owner or admin/);
    expect((await counts()).tasks).toBe(1);
  });

  it("refuses an anonymous caller", async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await expect(clearBacklog()).rejects.toThrow(/authentication is required/);
  });

  it("refuses a reason that says nothing", async () => {
    await asUser(ownerId);
    await expect(clearBacklog("oops")).rejects.toThrow(/at least 10 characters/);
  });
});

describe("clearing all pipelines", () => {
  it("removes commands with no run history behind them", async () => {
    await makeCommand("succeeded");
    await makeCommand("failed");
    await asUser(ownerId);

    const result = await clearPipelines();
    expect(result.rows[0].deleted_count).toBe(2);
    expect((await counts()).commands).toBe(0);
  });

  it("leaves running and queued pipelines alone", async () => {
    await makeCommand("running");
    await makeCommand("queued");
    await makeCommand("succeeded");
    await asUser(ownerId);

    const result = await clearPipelines();
    expect(result.rows[0].deleted_count).toBe(1);
    expect(result.rows[0].kept_running).toBe(2);
  });

  it("keeps a pipeline whose deletion would cascade two hops into run history", async () => {
    /*
     * commands -> tasks -> agent_runs. Deleting this command deletes its task,
     * and that task's run. Two hops rather than one, same rule.
     */
    await makeCommandChain();
    await asUser(ownerId);

    const result = await clearPipelines();
    expect(result.rows[0].deleted_count).toBe(0);
    expect(result.rows[0].kept_with_runs).toBe(1);

    const after = await counts();
    expect(after.commands).toBe(1);
    expect(after.tasks).toBe(1);
    expect(after.runs).toBe(1);
  });

  it("takes the whole chain when the caller opts in", async () => {
    await makeCommandChain();
    await asUser(ownerId);

    const result = await clearPipelines("owner asked for a full reset", true);
    expect(result.rows[0].deleted_count).toBe(1);

    const after = await counts();
    expect(after.commands).toBe(0);
    expect(after.tasks).toBe(0);
    expect(after.runs).toBe(0);
  });

  it("refuses a member, an anonymous caller, and an empty reason", async () => {
    await makeCommand("succeeded");

    await asUser(memberId);
    await expect(clearPipelines()).rejects.toThrow(/only an owner or admin/);

    await asUser(ownerId);
    await expect(clearPipelines("nope")).rejects.toThrow(/at least 10 characters/);

    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await expect(clearPipelines()).rejects.toThrow(/authentication is required/);

    expect((await counts()).commands).toBe(1);
  });
});

describe("both functions", () => {
  it("are callable by members and never by anon", async () => {
    await db.exec("reset role");
    const acl = await db.query<{ name: string; auth: boolean; anon: boolean }>(`
      select routine.proname as name,
             has_function_privilege('authenticated', routine.oid, 'EXECUTE') as auth,
             has_function_privilege('anon', routine.oid, 'EXECUTE') as anon
        from pg_proc routine
        join pg_namespace space on space.oid = routine.pronamespace
       where space.nspname = 'public'
         and routine.proname in ('clear_backlog_tasks', 'clear_all_pipelines')
       order by 1`);
    expect(acl.rows).toEqual([
      { name: "clear_all_pipelines", auth: true, anon: false },
      { name: "clear_backlog_tasks", auth: true, anon: false },
    ]);
  });

  it("removes the hosted service_role default grant without changing runtime behavior", async () => {
    /*
     * Hosted Supabase applies ALTER DEFAULT PRIVILEGES to new functions. The
     * immutable 00800 migration revoked PUBLIC and anon, but did not name the
     * resulting direct service_role grant. Reproduce that exact residual
     * state, prove replaying 00800 cannot remove it, then apply the new
     * forward-only ACL contraction.
     */
    await db.exec(`
      grant execute on function public.clear_backlog_tasks(uuid, text, boolean) to service_role;
      grant execute on function public.clear_all_pipelines(uuid, text, boolean) to service_role;
    `);

    const hostedInput = await db.query<{ name: string; service_execute: boolean }>(`
      select routine.proname as name,
             has_function_privilege('service_role', routine.oid, 'EXECUTE') as service_execute
        from pg_proc routine
        join pg_namespace space on space.oid = routine.pronamespace
       where space.nspname = 'public'
         and routine.proname in ('clear_backlog_tasks', 'clear_all_pipelines')
       order by 1`);
    expect(hostedInput.rows, "the hosted function defaults were not reproduced").toEqual([
      { name: "clear_all_pipelines", service_execute: true },
      { name: "clear_backlog_tasks", service_execute: true },
    ]);

    await db.exec(
      await readFile(
        resolve(migrationsRoot, "20260822000800_clear_backlog_and_pipelines.sql"),
        "utf8",
      ),
    );
    const afterOriginalMigration = await db.query<{ name: string; service_execute: boolean }>(`
      select routine.proname as name,
             has_function_privilege('service_role', routine.oid, 'EXECUTE') as service_execute
        from pg_proc routine
        join pg_namespace space on space.oid = routine.pronamespace
       where space.nspname = 'public'
         and routine.proname in ('clear_backlog_tasks', 'clear_all_pipelines')
       order by 1`);
    expect(
      afterOriginalMigration.rows,
      "the hosted 00800 residual grants must be faithfully reproduced",
    ).toEqual([
      { name: "clear_all_pipelines", service_execute: true },
      { name: "clear_backlog_tasks", service_execute: true },
    ]);

    await db.exec(
      await readFile(
        resolve(migrationsRoot, "20260822001200_contract_clear_function_acls.sql"),
        "utf8",
      ),
    );
    const contracted = await db.query<{
      name: string;
      acl_entries: number;
      auth_execute: boolean;
      anon_execute: boolean;
      service_execute: boolean;
    }>(`
      select routine.proname as name,
             (select count(*)::int from aclexplode(routine.proacl)) as acl_entries,
             has_function_privilege('authenticated', routine.oid, 'EXECUTE') as auth_execute,
             has_function_privilege('anon', routine.oid, 'EXECUTE') as anon_execute,
             has_function_privilege('service_role', routine.oid, 'EXECUTE') as service_execute
        from pg_proc routine
        join pg_namespace space on space.oid = routine.pronamespace
       where space.nspname = 'public'
         and routine.proname in ('clear_backlog_tasks', 'clear_all_pipelines')
       order by 1`);
    expect(contracted.rows).toEqual([
      {
        name: "clear_all_pipelines",
        acl_entries: 2,
        auth_execute: true,
        anon_execute: false,
        service_execute: false,
      },
      {
        name: "clear_backlog_tasks",
        acl_entries: 2,
        auth_execute: true,
        anon_execute: false,
        service_execute: false,
      },
    ]);

    // The containment changes only ACLs: both owner workflows still execute.
    await makeTask("backlog");
    await makeCommand("succeeded");
    await asUser(ownerId);
    expect((await clearBacklog()).rows[0].deleted_count).toBe(1);
    expect((await clearPipelines()).rows[0].deleted_count).toBe(1);
    expect(await counts()).toEqual({ tasks: 0, commands: 0, runs: 0 });
  });
});
