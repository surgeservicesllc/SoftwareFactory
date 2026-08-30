// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPhase1CExecutionPlan } from "@/lib/orchestration/plan";

/**
 * Stopping and deleting the pipelines somebody ticked, against real
 * PostgreSQL.
 *
 * Selecting a pipeline now stops it: a queued or running command is cancelled
 * before it is removed, because the earlier rule — inherited from the
 * whole-list clear — was protecting rows that could never finish. What naming
 * rows explicitly still does not buy is authority over evidence: run history
 * needs the explicit flag, a command the improvement ledger cites is never
 * deleted, an analysis graph outlives its command, and an id from another
 * organization is counted rather than acted on.
 */

const migrationsRoot = resolve(import.meta.dirname, "../../supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000e001";
const memberId = "00000000-0000-4000-8000-00000000e002";
const organizationId = "10000000-0000-4000-8000-00000000e001";
const otherOrganizationId = "10000000-0000-4000-8000-00000000e002";
const projectId = "40000000-0000-4000-8000-00000000e001";
const otherProjectId = "40000000-0000-4000-8000-00000000e002";
const agentId = "50000000-0000-4000-8000-00000000e001";

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
 * The parameters come from the application's own plan builder, so the two
 * Phase 1C triggers (20260813000900 and 20260813001000) accept the row for
 * the same reasons production rows are accepted, rather than from a
 * hand-copied shape that drifts from the trigger it must satisfy.
 */
async function makeCommand(
  status = "succeeded",
  scope: { organizationId: string; projectId: string } = { organizationId, projectId },
): Promise<string> {
  const plan = createPhase1CExecutionPlan("other", {});
  const result = await db.query<{ id: string }>(
    `insert into public.commands (organization_id, project_id, submitted_by, prompt, status, parameters)
     values ($1, $2, $3, 'Do the thing', $4::public.command_status, $5::jsonb) returning id`,
    [
      scope.organizationId,
      scope.projectId,
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
        repositoryBinding: {
          appId: 4582606,
          baseBranch: "main",
          baseSha: "0123456789abcdef0123456789abcdef01234567",
          connectionId: "60000000-0000-4000-8000-00000000e001",
          externalInstallationId: 12345678,
          externalRepositoryId: 87654321,
          installationId: "60000000-0000-4000-8000-00000000e002",
          repositoryId: "60000000-0000-4000-8000-00000000e003",
        },
        riskAssessment: { factors: [], reasons: [], requestedRisk: "green" },
      }),
    ],
  );
  return result.rows[0].id;
}

/**
 * A command, its task and a run on that task — the full two-hop chain the
 * cascade would walk. The planning triggers are suspended only while it is
 * built, for the same narrow reason the clear suite documents: `command_id`
 * is immutable on tasks, so the link can only be made at insert, and the
 * planner that runs then is a rule about submitting work, not deleting it.
 */
async function makeCommandChain(): Promise<{ commandId: string; taskId: string }> {
  await db.exec("reset role");
  await db.exec(`
    alter table public.tasks disable trigger tasks_phase1c_plan;
    alter table public.tasks disable trigger tasks_phase1c_queue;
  `);
  try {
    const commandId = await makeCommand("succeeded");
    const task = await db.query<{ id: string }>(
      `insert into public.tasks (organization_id, project_id, command_id, title, status, created_by)
       values ($1, $2, $3, 'A work item', 'completed'::public.task_status, $4) returning id`,
      [organizationId, projectId, commandId, ownerId],
    );
    const taskId = task.rows[0].id;
    await db.query(
      `insert into public.agent_runs (organization_id, project_id, task_id, agent_id, status)
       values ($1, $2, $3, $4, 'succeeded'::public.run_status)`,
      [organizationId, projectId, taskId, agentId],
    );
    return { commandId, taskId };
  } finally {
    await db.exec(`
      alter table public.tasks enable trigger tasks_phase1c_plan;
      alter table public.tasks enable trigger tasks_phase1c_queue;
    `);
  }
}

type DeleteOutcome = {
  deleted_count: number;
  stopped_count: number;
  kept_with_runs: number;
  kept_with_evidence: number;
  not_found: number;
  unlinked_analyses: number;
};

async function deleteSelected(
  ids: readonly string[],
  reason = "removing the pipelines I picked",
  includeRuns = false,
) {
  return db.query<DeleteOutcome>(
    "select * from public.delete_selected_pipelines($1::uuid, $2::uuid[], $3::text, $4::boolean)",
    [organizationId, ids as string[], reason, includeRuns],
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
  const migrationFiles = (await readdir(migrationsRoot))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
  expect(migrationFiles.at(-1)).toBe("20260830000500_specialist_capability_stage_map.sql");
  for (const file of migrationFiles) {
    await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
  }

  await db.exec(`
    insert into auth.users (id) values ('${ownerId}'), ('${memberId}');
    insert into public.organizations (id, name, slug, created_by) values
      ('${organizationId}', 'Select Co', 'select-co', '${ownerId}'),
      ('${otherOrganizationId}', 'Other Co', 'other-co', '${ownerId}');
    insert into public.projects (id, organization_id, name, status, created_by) values
      ('${projectId}', '${organizationId}', 'Select Project', 'active', '${ownerId}'),
      ('${otherProjectId}', '${otherOrganizationId}', 'Other Project', 'active', '${ownerId}');
  `);
  for (const [organization, userId, role] of [
    [organizationId, ownerId, "owner"],
    [organizationId, memberId, "member"],
    [otherOrganizationId, ownerId, "owner"],
  ] as const) {
    await db.query(
      `insert into public.organization_members (organization_id, user_id, role)
       values ($1, $2, $3) on conflict (organization_id, user_id) do update set role = $3`,
      [organization, userId, role],
    );
  }
  await db.query(
    `insert into public.agents (id, organization_id, name, role, status, created_by)
     values ($1, $2, 'Select Agent', 'backend'::public.agent_role, 'idle'::public.agent_status, $3)`,
    [agentId, organizationId, ownerId],
  );
}, 180_000);

// Each case starts from an empty board — these are functions about counts.
// Activity events are deliberately NOT swept: they are append-only by design
// (reject_activity_event_mutation), so the audit case identifies its own event
// by the reason it passed rather than by being the only row in the table.
beforeEach(async () => {
  await db.exec("reset role");
  // Routes are cleared through the same announced permission the audited
  // delete uses, because they are immutable to everyone else and their
  // RESTRICT foreign key would otherwise block the command sweep below.
  await db.exec(`
    delete from public.agent_runs;
    delete from public.tasks;
    select set_config('softwarefactory.pipeline_delete', 'on', false);
    delete from public.factory_command_routes;
    select set_config('softwarefactory.pipeline_delete', 'off', false);
    delete from public.commands;
  `);
});

afterAll(async () => {
  await db?.close();
});

describe("delete_selected_pipelines", () => {
  it("deletes exactly the selected pipelines and leaves the rest standing", async () => {
    const keep = await makeCommand();
    const first = await makeCommand();
    const second = await makeCommand();

    await asUser(ownerId);
    const result = await deleteSelected([first, second]);

    expect(result.rows[0]).toMatchObject({
      deleted_count: 2,
      stopped_count: 0,
      kept_with_runs: 0,
      kept_with_evidence: 0,
      not_found: 0,
    });
    await db.exec("reset role");
    const remaining = await db.query<{ id: string }>("select id from public.commands");
    expect(remaining.rows.map((row) => row.id)).toEqual([keep]);
  });

  it("counts a repeated id once rather than deleting twice", async () => {
    const only = await makeCommand();

    await asUser(ownerId);
    const result = await deleteSelected([only, only, only]);

    expect(result.rows[0]).toMatchObject({ deleted_count: 1, not_found: 0 });
    expect((await counts()).commands).toBe(0);
  });

  it("stops live work rather than refusing it, then deletes it", async () => {
    const queued = await makeCommand("queued");
    const running = await makeCommand("running");
    const done = await makeCommand("succeeded");

    await asUser(ownerId);
    const result = await deleteSelected([queued, running, done]);

    // All three go, and the two live ones are reported as stopped first —
    // this is the rule the owner's two hours-old queued rows needed.
    expect(result.rows[0]).toMatchObject({ deleted_count: 3, stopped_count: 2 });
    expect((await counts()).commands).toBe(0);
  });

  it("cancels the tasks and runs under a live pipeline before removing it", async () => {
    const { commandId, taskId } = await makeCommandChain();
    await db.exec("reset role");
    // Put the chain back into flight: a queued command with a running run,
    // which is the state a worker holds mid-execution.
    await db.query("update public.commands set status = 'running'::public.command_status where id = $1", [commandId]);
    await db.query("update public.tasks set status = 'in_progress'::public.task_status where id = $1", [taskId]);
    await db.query("update public.agent_runs set status = 'running'::public.run_status where task_id = $1", [taskId]);

    await asUser(ownerId);
    // Without the flag the rows are kept (run history) — but stopping still
    // happens, because a selected pipeline should not be left running.
    const kept = await deleteSelected([commandId]);
    expect(kept.rows[0]).toMatchObject({ deleted_count: 0, stopped_count: 1, kept_with_runs: 1 });

    await db.exec("reset role");
    const state = await db.query<{ command: string; task: string; run: string }>(`
      select (select status::text from public.commands where id = $1) as command,
             (select status::text from public.tasks where id = $2) as task,
             (select status::text from public.agent_runs where task_id = $2) as run`,
      [commandId, taskId]);
    expect(state.rows[0]).toEqual({ command: "cancelled", task: "cancelled", run: "cancelled" });
  });

  it("will not take run history by surprise, and does take it when told", async () => {
    const { commandId } = await makeCommandChain();

    await asUser(ownerId);
    const refused = await deleteSelected([commandId]);
    expect(refused.rows[0]).toMatchObject({ deleted_count: 0, kept_with_runs: 1 });
    expect(await counts()).toMatchObject({ commands: 1, tasks: 1, runs: 1 });

    await asUser(ownerId);
    const included = await deleteSelected([commandId], "removing this one and its runs", true);
    expect(included.rows[0]).toMatchObject({ deleted_count: 1, kept_with_runs: 0 });
    expect(await counts()).toMatchObject({ commands: 0, tasks: 0, runs: 0 });
  });

  it("counts an id from another organization as not found and deletes nothing", async () => {
    const foreign = await makeCommand("succeeded", {
      organizationId: otherOrganizationId,
      projectId: otherProjectId,
    });

    await asUser(ownerId);
    const result = await deleteSelected([foreign]);

    expect(result.rows[0]).toMatchObject({ deleted_count: 0, not_found: 1 });
    expect((await counts()).commands).toBe(1);
  });

  it("refuses a member who does not manage the organization", async () => {
    const target = await makeCommand();

    await asUser(memberId);
    await expect(deleteSelected([target])).rejects.toThrow(/only an owner or admin may delete pipelines/);
    expect((await counts()).commands).toBe(1);
  });

  it("refuses a reason shorter than ten characters", async () => {
    const target = await makeCommand();

    await asUser(ownerId);
    await expect(deleteSelected([target], "too short")).rejects.toThrow(/at least 10 characters/);
    expect((await counts()).commands).toBe(1);
  });

  it("refuses an empty selection", async () => {
    await makeCommand();

    await asUser(ownerId);
    await expect(deleteSelected([])).rejects.toThrow(/select at least one pipeline/);
    expect((await counts()).commands).toBe(1);
  });

  it("refuses a selection larger than the page could hold", async () => {
    const target = await makeCommand();
    const padding = Array.from({ length: 200 }, (_, index) => {
      const suffix = String(index).padStart(4, "0");
      return `10000000-0000-4000-8000-0000000f${suffix}`;
    });

    await asUser(ownerId);
    await expect(deleteSelected([target, ...padding])).rejects.toThrow(/200 pipelines or fewer/);
    expect((await counts()).commands).toBe(1);
  });

  it("records one audit event naming the selection and what it kept", async () => {
    const done = await makeCommand("succeeded");
    const running = await makeCommand("running");

    await asUser(ownerId);
    await deleteSelected([done, running], "tidying the pipelines list");

    await db.exec("reset role");
    const events = await db.query<{ description: string; metadata: Record<string, unknown> }>(
      `select description, metadata from public.activity_events
        where event_type = 'command.pipelines_cleared'::public.activity_event_type
          and metadata ->> 'reason' = 'tidying the pipelines list'`,
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].description).toContain("2 removed of 2 selected");
    expect(events.rows[0].description).toContain("1 stopped first");
    expect(events.rows[0].metadata).toMatchObject({
      scope: "selection",
      reason: "tidying the pipelines list",
      selected_count: 2,
      deleted_count: 2,
      stopped_count: 1,
      kept_with_runs: 0,
      kept_with_evidence: 0,
      not_found: 0,
      unlinked_analyses: 0,
      included_commands_with_runs: false,
    });
  });

  it("removes the analysis link but keeps the graph, its run and its artifacts", async () => {
    const commandId = await makeCommand("queued");
    await db.exec("reset role");
    // The link 20260823000100 creates, and a graph carrying a completed run —
    // exactly the shape the owner's two stuck pipelines were in.
    const graph = await db.query<{ id: string }>(
      `insert into public.graphs (organization_id, project_id, goal, topology, risk_level, created_by)
       values ($1, $2, 'Fix high-priority bugs', 'DAG'::public.graph_topology,
               'green'::public.risk_level, $3) returning id`,
      [organizationId, projectId, ownerId],
    );
    const graphId = graph.rows[0].id;
    const run = await db.query<{ id: string }>(
      `insert into public.graph_runs (organization_id, graph_id, state, created_by)
       values ($1, $2, 'COMPLETED'::public.graph_run_state, $3) returning id`,
      [organizationId, graphId, ownerId],
    );
    await db.query(
      `insert into public.command_analysis_graphs (organization_id, command_id, graph_id, created_by)
       values ($1, $2, $3, $4)`,
      [organizationId, commandId, graphId, ownerId],
    );

    await asUser(ownerId);
    const result = await deleteSelected([commandId], "removing the request, keeping the findings");

    // The restrict foreign key would have refused the delete outright had the
    // link not been removed first.
    expect(result.rows[0]).toMatchObject({
      deleted_count: 1,
      stopped_count: 1,
      unlinked_analyses: 1,
    });
    await db.exec("reset role");
    const survivors = await db.query<{ graphs: number; runs: number; links: number }>(`
      select (select count(*)::int from public.graphs where id = $1) as graphs,
             (select count(*)::int from public.graph_runs where id = $2) as runs,
             (select count(*)::int from public.command_analysis_graphs) as links`,
      [graphId, run.rows[0].id]);
    expect(survivors.rows[0]).toEqual({ graphs: 1, runs: 1, links: 0 });
  });

  it("releases immutable routing evidence so a routed pipeline can be deleted at all", async () => {
    const commandId = await makeCommand("queued");
    await db.exec("reset role");
    // The exact shape 20260821000400 records when a command is routed. Its
    // table carries a BEFORE UPDATE OR DELETE trigger that raises
    // unconditionally, and its command foreign key is ON DELETE RESTRICT —
    // together they made a routed command undeletable by anybody, which is
    // the wall the owner hit on 2026-08-23.
    await db.query(
      `insert into public.factory_command_routes (
         organization_id, project_id, command_id, project_pipeline_id,
         pipeline_template_key, assignment_id, bot_id, role_id,
         routing_snapshot, created_by
       ) values ($1, $2, $3, gen_random_uuid(), 'security_audit',
                 gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                 '{"why":"fixture"}'::jsonb, $4)`,
      [organizationId, projectId, commandId, ownerId],
    );

    await asUser(ownerId);
    const result = await deleteSelected([commandId], "removing a routed pipeline");

    expect(result.rows[0]).toMatchObject({ deleted_count: 1, stopped_count: 1 });
    expect((await counts()).commands).toBe(0);
    const routes = await db.query<{ count: number }>(
      "select count(*)::int as count from public.factory_command_routes",
    );
    expect(routes.rows[0].count).toBe(0);
  });

  it("still refuses to edit routing evidence, and refuses to delete it outside the audited path", async () => {
    const commandId = await makeCommand("succeeded");
    await db.exec("reset role");
    await db.query(
      `insert into public.factory_command_routes (
         organization_id, project_id, command_id, project_pipeline_id,
         pipeline_template_key, assignment_id, bot_id, role_id,
         routing_snapshot, created_by
       ) values ($1, $2, $3, gen_random_uuid(), 'security_audit',
                 gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                 '{"why":"fixture"}'::jsonb, $4)`,
      [organizationId, projectId, commandId, ownerId],
    );

    // An UPDATE is refused under every caller, permission or not.
    await expect(db.query(
      "update public.factory_command_routes set pipeline_template_key = 'other'",
    )).rejects.toThrow(/routing evidence is immutable/);

    // A bare DELETE is refused too: the permission is transaction-local and
    // only the audited delete sets it.
    await expect(db.query(
      "delete from public.factory_command_routes where command_id = $1",
      [commandId],
    )).rejects.toThrow(/routing evidence is immutable/);
  });

  it("gives no client role a direct path to the routing table", async () => {
    await db.exec("reset role");
    const acl = await db.query<{ anon: boolean; auth: boolean; service: boolean }>(`
      select has_table_privilege('anon', 'public.factory_command_routes', 'DELETE') as anon,
             has_table_privilege('authenticated', 'public.factory_command_routes', 'DELETE') as auth,
             has_table_privilege('service_role', 'public.factory_command_routes', 'DELETE') as service`);
    expect(acl.rows[0]).toEqual({ anon: false, auth: false, service: false });
  });

  it("is callable by a signed-in member only — never anon or service_role", async () => {
    await db.exec("reset role");
    const acl = await db.query<{ anon: boolean; service: boolean; authenticated: boolean }>(`
      select has_function_privilege('anon', 'public.delete_selected_pipelines(uuid,uuid[],text,boolean)', 'EXECUTE') as anon,
             has_function_privilege('service_role', 'public.delete_selected_pipelines(uuid,uuid[],text,boolean)', 'EXECUTE') as service,
             has_function_privilege('authenticated', 'public.delete_selected_pipelines(uuid,uuid[],text,boolean)', 'EXECUTE') as authenticated`);
    expect(acl.rows[0]).toEqual({ anon: false, service: false, authenticated: true });
  });
});
