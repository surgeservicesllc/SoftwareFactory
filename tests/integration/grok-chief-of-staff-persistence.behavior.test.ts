// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { budgetForTemplate, findTemplate } from "@/lib/graph/templates";
import { createPhase1CExecutionPlan } from "@/lib/orchestration/plan";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000e101";
const memberId = "00000000-0000-4000-8000-00000000e103";
const outsiderId = "00000000-0000-4000-8000-00000000e102";
const organizationId = "10000000-0000-4000-8000-00000000e101";
const outsiderOrganizationId = "10000000-0000-4000-8000-00000000e102";
const projectId = "40000000-0000-4000-8000-00000000e101";
const connectionId = "20000000-0000-4000-8000-00000000e101";
const installationId = "30000000-0000-4000-8000-00000000e101";
const repositoryId = "50000000-0000-4000-8000-00000000e101";
const baseSha = "a".repeat(40);
const requiredChecks = [
  "Lint, typecheck, test, and build",
  "Browser and accessibility tests 1/3",
  "Browser and accessibility tests 2/3",
  "Browser and accessibility tests 3/3",
] as const;

type ApplicationRole = "anon" | "authenticated" | "service_role";

type SessionRow = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  last_message_sequence: number;
  last_event_sequence: number;
  version: number;
  closed_at: string | null;
};

type MessageRow = {
  id: string;
  session_id: string;
  sequence_no: number;
  role: string;
  content: string;
  metadata: Record<string, unknown>;
};

async function assumeRole(
  db: PGlite,
  role: ApplicationRole,
  userId: string | null = null,
) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.query(
    "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', $2::text)::text, false)",
    [userId ?? "", role],
  );
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.query("select set_config('request.jwt.claims', '{}', false)");
}

describe("Grok Chief-of-Staff persistence", () => {
  let db: PGlite;
  let nextKey = 0;

  async function createSession(title = "Build the durable workspace") {
    nextKey += 1;
    const idempotencyKey = `session-test-${nextKey.toString().padStart(4, "0")}`;
    await assumeRole(db, "authenticated", ownerId);
    const result = await db.query<SessionRow>(
      `select * from public.create_grok_session(
         $1::uuid, $2::uuid, $3::text, $4::text
       )`,
      [organizationId, projectId, title, idempotencyKey],
    );
    return { idempotencyKey, session: result.rows[0] };
  }

  async function createControlGraph(sessionId: string, goal: string) {
    nextKey += 1;
    await resetRole(db);
    const result = await db.query<{ id: string }>(`
      with new_graph as (
        insert into public.graphs (organization_id,project_id,goal,topology,created_by)
        values ($1,$2,$3,'SINGLE_AGENT',$4) returning id
      ), new_link as (
        insert into public.grok_task_links (
          organization_id,project_id,session_id,graph_id,relation
        )
        select $1,$2,$5,new_graph.id,'planned' from new_graph
        returning id,graph_id
      ), new_launch as (
        insert into public.grok_graph_launches (
          organization_id,project_id,session_id,idempotency_key,input_sha256,
          graph_id,task_link_id,created_by
        )
        select $1,$2,$5,$6,repeat('a',64),new_link.graph_id,new_link.id,$4
          from new_link
        returning graph_id
      )
      select graph_id as id from new_launch
    `, [organizationId, projectId, goal, ownerId, sessionId,
      `control-launch-${nextKey.toString().padStart(4, "0")}`]);
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

    for (const file of (await readdir(migrationsRoot))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort()) {
      await db.exec(await readFile(resolve(migrationsRoot, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Grok Workspace Co', 'grok-workspace-co', '${ownerId}'),
        ('${outsiderOrganizationId}', 'Other Workspace Co', 'other-workspace-co', '${outsiderId}');
      insert into public.projects (
        id, organization_id, name, status, github_repository, default_branch, created_by
      ) values (
        '${projectId}', '${organizationId}', 'Chief of Staff', 'active',
        'factory/grok-workspace', 'main', '${ownerId}'
      );
      insert into public.connections (
        id, organization_id, name, provider, status, secret_reference, created_by
      ) values (
        '${connectionId}', '${organizationId}', 'GitHub', 'github', 'connected',
        'env://GITHUB_APP', '${ownerId}'
      );
      insert into public.github_installations (
        id, organization_id, connection_id, external_installation_id, app_id,
        app_slug, account_id, account_login, account_type, target_type,
        repository_selection, status, installed_at, created_by
      ) values (
        '${installationId}', '${organizationId}', '${connectionId}', 910001, 910002,
        'grok-app', 910003, 'factory', 'Organization', 'Organization',
        'selected', 'active', now(), '${ownerId}'
      );
      insert into public.github_repositories (
        id, organization_id, installation_id, external_repository_id,
        owner_login, name, full_name, default_branch, html_url, private,
        visibility, selected, github_updated_at
      ) values (
        '${repositoryId}', '${organizationId}', '${installationId}', 910004,
        'factory', 'grok-workspace', 'factory/grok-workspace', 'main',
        'https://github.com/factory/grok-workspace', true, 'private', true, now()
      );
      insert into public.project_connections (
        organization_id, project_id, connection_id, github_repository_id,
        is_primary, created_by
      ) values (
        '${organizationId}', '${projectId}', '${connectionId}', '${repositoryId}',
        true, '${ownerId}'
      );
      insert into public.organization_members (organization_id, user_id, role) values
        ('${organizationId}', '${ownerId}', 'owner'),
        ('${organizationId}', '${memberId}', 'member'),
        ('${outsiderOrganizationId}', '${outsiderId}', 'owner')
      on conflict (organization_id, user_id) do update set role = excluded.role;
    `);
  }, 180_000);

  afterAll(async () => {
    await db?.close();
  });

  it("creates and lists a tenant-scoped session with exact replay", async () => {
    const { idempotencyKey, session } = await createSession("Plan a customer portal");
    expect(session.last_message_sequence).toBe(0);
    expect(session.last_event_sequence).toBe(1);
    expect(session.status).toBe("active");

    const replay = await db.query<SessionRow>(
      "select * from public.create_grok_session($1::uuid,$2::uuid,$3::text,$4::text)",
      [organizationId, projectId, "Plan a customer portal", idempotencyKey],
    );
    expect(replay.rows[0].id).toBe(session.id);
    await expect(db.query(
      "select * from public.create_grok_session($1::uuid,$2::uuid,$3::text,$4::text)",
      [organizationId, projectId, "Changed body", idempotencyKey],
    )).rejects.toThrow(/different input/i);

    const listed = await db.query<{
      session_id: string;
      project_id: string;
      project_name: string;
      title: string;
    }>(
      "select * from public.list_grok_sessions($1::uuid,$2::uuid,50,null,null)",
      [organizationId, projectId],
    );
    expect(listed.rows).toEqual(expect.arrayContaining([expect.objectContaining({
      session_id: session.id,
      project_id: projectId,
      project_name: "Chief of Staff",
      title: "Plan a customer portal",
    })]));

    await assumeRole(db, "authenticated", outsiderId);
    const hidden = await db.query(
      "select * from public.list_grok_sessions($1::uuid,null,50,null,null)",
      [organizationId],
    );
    expect(hidden.rows).toEqual([]);
    await expect(db.query(
      "select public.read_grok_session($1::uuid,$2::uuid,0,0,200)",
      [organizationId, session.id],
    )).rejects.toThrow(/not_found/i);
  });

  it("keeps every authenticated Grok boundary owner-only at the database", async () => {
    const { session } = await createSession("Owner-only workspace");
    await assumeRole(db, "authenticated", memberId);

    await expect(db.query(
      "select * from public.create_grok_session($1::uuid,$2::uuid,$3::text,$4::text)",
      [organizationId, projectId, "Member bypass", "member-session-0001"],
    )).rejects.toThrow(/owner access is required/i);
    const hidden = await db.query(
      "select * from public.list_grok_sessions($1::uuid,null,50,null,null)",
      [organizationId],
    );
    expect(hidden.rows).toEqual([]);
    await expect(db.query(
      "select public.read_grok_session($1::uuid,$2::uuid,0,0,200)",
      [organizationId, session.id],
    )).rejects.toThrow(/not_found/i);
    await expect(db.query(
      `select * from public.append_grok_user_message(
         $1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text,0,null
       )`,
      [organizationId, session.id, "Tamper", "{}", "member-message-0001"],
    )).rejects.toThrow(/owner access is required/i);
    await expect(db.query(
      `select * from public.request_grok_control_intent(
         $1::uuid,$2::uuid,'graph',$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, session.id, "00000000-0000-4000-8000-00000000e199",
        "Member control", "member-control-0001"],
    )).rejects.toThrow(/owner access is required/i);
  });

  it("keeps transcript and event retries resumable after later sequences advance", async () => {
    const { session } = await createSession();
    await assumeRole(db, "authenticated", ownerId);
    const user = await db.query<MessageRow>(
      `select * from public.append_grok_user_message(
         $1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text,$6::bigint,$7::uuid
       )`,
      [organizationId, session.id, "Build it", JSON.stringify({ source: "workspace" }),
        "message-user-0001", 0, null],
    );
    expect(user.rows[0].sequence_no).toBe(1);

    await assumeRole(db, "service_role");
    const assistant = await db.query<MessageRow>(
      `select * from public.append_grok_message_as_server(
         $1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb,$6::text,$7::bigint,$8::uuid
       )`,
      [organizationId, session.id, "assistant", "Here is the plan",
        JSON.stringify({ plan: { layers: [["discover"]] } }),
        "message-assistant-0001", 1, user.rows[0].id],
    );
    expect(assistant.rows[0].sequence_no).toBe(2);

    const planned = await db.query<{ id: string; sequence_no: number }>(
      `select * from public.record_grok_event_as_server(
         $1::uuid,$2::uuid,$3::text,$4::uuid,$5::jsonb,$6::bigint,$7::uuid,$8::uuid
       )`,
      [organizationId, session.id, "session.planned", session.id,
        JSON.stringify({ template: "full_lifecycle" }), 3, assistant.rows[0].id, null],
    );
    expect(planned.rows[0].sequence_no).toBe(4);

    // Both exact retries happen after the session has moved beyond their CAS.
    await assumeRole(db, "authenticated", ownerId);
    const replayUser = await db.query<MessageRow>(
      `select * from public.append_grok_user_message(
         $1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text,$6::bigint,$7::uuid
       )`,
      [organizationId, session.id, "Build it", JSON.stringify({ source: "workspace" }),
        "message-user-0001", 0, null],
    );
    expect(replayUser.rows[0].id).toBe(user.rows[0].id);

    await assumeRole(db, "service_role");
    const replayAssistant = await db.query<MessageRow>(
      `select * from public.append_grok_message_as_server(
         $1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb,$6::text,$7::bigint,$8::uuid
       )`,
      [organizationId, session.id, "assistant", "Here is the plan",
        JSON.stringify({ plan: { layers: [["discover"]] } }),
        "message-assistant-0001", 1, user.rows[0].id],
    );
    expect(replayAssistant.rows[0].id).toBe(assistant.rows[0].id);
    const replayEvent = await db.query<{ id: string }>(
      `select * from public.record_grok_event_as_server(
         $1::uuid,$2::uuid,$3::text,$4::uuid,$5::jsonb,$6::bigint,$7::uuid,$8::uuid
       )`,
      [organizationId, session.id, "session.planned", session.id,
        JSON.stringify({ template: "full_lifecycle" }), 3, assistant.rows[0].id, null],
    );
    expect(replayEvent.rows[0].id).toBe(planned.rows[0].id);
    await expect(db.query(
      `select * from public.record_grok_event_as_server(
         $1::uuid,$2::uuid,$3::text,$4::uuid,$5::jsonb,$6::bigint,$7::uuid,$8::uuid
       )`,
      [organizationId, session.id, "session.planned", session.id,
        JSON.stringify({ template: "changed" }), 4, assistant.rows[0].id, null],
    )).rejects.toThrow(/different input/i);

    await assumeRole(db, "authenticated", ownerId);
    const read = await db.query<{ read_grok_session: Record<string, unknown> }>(
      "select public.read_grok_session($1::uuid,$2::uuid,0,0,200)",
      [organizationId, session.id],
    );
    const body = read.rows[0].read_grok_session as {
      session: SessionRow;
      messages: MessageRow[];
      events: Array<{ event_type: string }>;
      task_links: unknown[];
    };
    expect(body.session.id).toBe(session.id);
    expect(body.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(body.events.map((event) => event.event_type)).toEqual([
      "session.created", "message.appended", "message.appended", "session.planned",
    ]);
    expect(body.task_links).toEqual([]);
  });

  it("atomically records and exactly replays a nonclosed blocked planning failure", async () => {
    const { session } = await createSession("Planning cannot start");
    await assumeRole(db, "authenticated", ownerId);
    const user = await db.query<MessageRow>(
      `select * from public.append_grok_user_message(
         $1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text,0,null
       )`,
      [organizationId, session.id, "Implement the goal", "{}", "planning-user-0001"],
    );
    const failureCall = `select public.record_grok_planning_failure_as_server(
      $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::bigint
    ) as result`;
    const failureParameters = [
      organizationId,
      session.id,
      user.rows[0].id,
      "MISSING_CODEX_AGENT",
      "planning-failure-0001",
      2,
    ] as const;

    await expect(db.query(failureCall, [...failureParameters])).rejects.toThrow(
      /permission denied/i,
    );

    type FailureBundle = {
      session: SessionRow;
      message: MessageRow;
      event: {
        id: string;
        sequence_no: number;
        event_type: string;
        payload: Record<string, unknown>;
      };
    };
    await assumeRole(db, "service_role");
    const failure = await db.query<{ result: FailureBundle }>(
      failureCall,
      [...failureParameters],
    );
    expect(failure.rows[0].result.session).toMatchObject({
      id: session.id,
      status: "blocked",
      closed_at: null,
      last_message_sequence: 2,
      last_event_sequence: 5,
      version: 5,
    });
    expect(failure.rows[0].result.message).toMatchObject({
      sequence_no: 2,
      role: "assistant",
      reply_to_message_id: user.rows[0].id,
      metadata: {
        schemaVersion: 1,
        kind: "grok.planning_error",
        code: "MISSING_CODEX_AGENT",
        workerWoken: false,
        executionStarted: false,
      },
    });
    expect(failure.rows[0].result.event).toMatchObject({
      sequence_no: 4,
      event_type: "session.planning_failed",
      payload: expect.objectContaining({
        schemaVersion: 1,
        code: "MISSING_CODEX_AGENT",
        workerWoken: false,
        executionStarted: false,
      }),
    });

    await resetRole(db);
    const evidence = await db.query<{
      sequence_no: number;
      event_type: string;
    }>(
      `select sequence_no, event_type
         from public.grok_events
        where session_id = $1
        order by sequence_no`,
      [session.id],
    );
    expect(evidence.rows).toEqual([
      { sequence_no: 1, event_type: "session.created" },
      { sequence_no: 2, event_type: "message.appended" },
      { sequence_no: 3, event_type: "message.appended" },
      { sequence_no: 4, event_type: "session.planning_failed" },
      { sequence_no: 5, event_type: "session.blocked" },
    ]);

    // Exact replay ignores a current or otherwise stale expected version only
    // after all immutable evidence and the blocked/nonclosed state match.
    await assumeRole(db, "service_role");
    const replay = await db.query<{ result: FailureBundle }>(
      failureCall,
      [...failureParameters.slice(0, 5), 5],
    );
    expect(replay.rows[0].result).toEqual(failure.rows[0].result);
    await expect(db.query(
      failureCall,
      [
        organizationId,
        session.id,
        user.rows[0].id,
        "GRAPH_INVALID",
        "planning-failure-0001",
        999,
      ],
    )).rejects.toThrow(/reused with different input/i);
    await expect(db.query(
      failureCall,
      [
        organizationId,
        session.id,
        user.rows[0].id,
        "MISSING_CODEX_AGENT",
        "planning-failure-0002",
        5,
      ],
    )).rejects.toThrow(/not active/i);
    await expect(db.query(
      `select * from public.append_grok_message_as_server(
         $1::uuid,$2::uuid,'assistant','late write','{}'::jsonb,$3::text,2,$4::uuid
       )`,
      [organizationId, session.id, "planning-late-0001", user.rows[0].id],
    )).rejects.toThrow(/not_active/i);
    await expect(db.query(
      "select * from public.set_grok_session_status_as_server($1::uuid,$2::uuid,'archived',5)",
      [organizationId, session.id],
    )).rejects.toThrow(/state transition/i);
    const statusReplay = await db.query<SessionRow>(
      "select * from public.set_grok_session_status_as_server($1::uuid,$2::uuid,'blocked',999)",
      [organizationId, session.id],
    );
    expect(statusReplay.rows[0]).toMatchObject({
      status: "blocked",
      closed_at: null,
      last_event_sequence: 5,
      version: 5,
    });

    await resetRole(db);
    const residue = await db.query<{ messages: number; events: number }>(
      `select
         (select count(*)::integer from public.grok_messages where session_id = $1) as messages,
         (select count(*)::integer from public.grok_events where session_id = $1) as events`,
      [session.id],
    );
    expect(residue.rows[0]).toEqual({ messages: 2, events: 5 });

    const direct = await createSession("Direct blocked transition");
    await assumeRole(db, "service_role");
    const directlyBlocked = await db.query<SessionRow>(
      "select * from public.set_grok_session_status_as_server($1::uuid,$2::uuid,'blocked',1)",
      [organizationId, direct.session.id],
    );
    expect(directlyBlocked.rows[0]).toMatchObject({
      status: "blocked",
      closed_at: null,
      last_event_sequence: 2,
      version: 2,
    });
    await expect(db.query(
      "select * from public.set_grok_session_status_as_server($1::uuid,$2::uuid,'completed',2)",
      [organizationId, direct.session.id],
    )).rejects.toThrow(/state transition/i);
  });

  it("atomically links one exact canonical v2 graph paused, with no run or custom-plan execution", async () => {
    const template = findTemplate("full_lifecycle");
    if (!template) throw new Error("full_lifecycle template is absent");
    const built = buildLaunchPlan(
      { ...template, summary: "Build the portal" },
      budgetForTemplate(template),
    );
    if (!built.ok) throw new Error(built.errors.join("; "));

    const { session } = await createSession("Canonical paused release");
    await assumeRole(db, "authenticated", ownerId);
    const message = await db.query<MessageRow>(
      `select * from public.append_grok_user_message(
         $1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text,0,null
       )`,
      [organizationId, session.id, "Build the portal", "{}", "blocked-user-message-0001"],
    );
    await assumeRole(db, "service_role");
    const assistant = await db.query<MessageRow>(
      `select * from public.append_grok_message_as_server(
         $1::uuid,$2::uuid,'assistant',$3::text,$4::jsonb,$5::text,1,$6::uuid
       )`,
      [organizationId, session.id, "The deterministic plan is recorded; execution has not started.",
        JSON.stringify({
          kind: "grok.plan",
          plan: {
            dag: { tasks: [{ id: "implement", provider: "openai", model: "gpt-5.3-codex" }] },
          },
        }),
        "canonical-assistant-message-0001", message.rows[0].id],
    );

    const parameters = [
      organizationId,
      ownerId,
      projectId,
      session.id,
      assistant.rows[0].id,
      "canonical-launch-0001",
      built.plan.goal,
      built.plan.topology,
      JSON.stringify(built.plan.topologyReasons),
      built.plan.riskLevel,
      built.plan.requiresOwnerApproval,
      JSON.stringify(built.plan.nodes),
      JSON.stringify(built.plan.edges),
      JSON.stringify(built.plan.budget),
      repositoryId,
      "main",
      baseSha,
      JSON.stringify(requiredChecks),
    ] as const;
    const call = `select * from public.launch_grok_full_lifecycle_as_server(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,
      $8::public.graph_topology,$9::jsonb,$10::public.risk_level,$11::boolean,
      $12::jsonb,$13::jsonb,$14::jsonb,$15::uuid,$16::text,$17::text,$18::jsonb
    )`;

    // The browser cannot bypass the service-only bridge, even as owner.
    await assumeRole(db, "authenticated", ownerId);
    await expect(db.query(call, [...parameters])).rejects.toThrow(/permission denied/i);

    // The legacy bridge is now private to the admission-enforcing v2 wrapper.
    await assumeRole(db, "service_role");
    await expect(db.query(call, [...parameters])).rejects.toThrow(/permission denied/i);

    // Its unchanged implementation still enforces owner identity when invoked
    // internally by the database-owned v2 wrapper.
    await resetRole(db);
    const memberParameters = [...parameters];
    memberParameters[1] = memberId;
    await expect(db.query(call, memberParameters)).rejects.toThrow(/owner request identity/i);

    // A custom mutation is rejected by the existing exact canonical digest.
    const customParameters = [...parameters];
    customParameters[5] = "custom-launch-0001";
    customParameters[11] = JSON.stringify(built.plan.nodes.map((node, index) =>
      index === 0 ? { ...node, job: `${node.job} (custom)` } : node));
    await expect(db.query(call, customParameters)).rejects.toThrow(/canonical digest/i);

    // Secret material is rejected before any graph can be left behind.
    const secretParameters = [...parameters];
    secretParameters[5] = "secret-launch-0001";
    secretParameters[6] = `Build with sk-${"z".repeat(32)}`;
    await expect(db.query(call, secretParameters)).rejects.toThrow(/likely secret/i);

    await resetRole(db);
    const before = await db.query<{ count: number }>(
      "select count(*)::integer as count from public.graphs where project_id = $1",
      [projectId],
    );
    await resetRole(db);
    const launched = await db.query<{ graph_id: string; task_link_id: string }>(
      call,
      [...parameters],
    );
    const replay = await db.query<{ graph_id: string; task_link_id: string }>(
      call,
      [...parameters],
    );
    expect(replay.rows[0]).toEqual(launched.rows[0]);

    await resetRole(db);
    const residue = await db.query<{
      graph_id: string;
      template_key: string;
      template_version: number;
      template_plan_sha256: string;
      github_repository_id: string;
      base_branch: string;
      base_sha: string;
      pause_requested_at: string | null;
      pause_requested_by: string | null;
      graphs: number;
      graph_runs: number;
      node_runs: number;
      launches: number;
      links: number;
    }>(
      `select graph.id as graph_id, graph.template_key, graph.template_version,
         graph.template_plan_sha256, graph.github_repository_id, graph.base_branch,
         graph.base_sha, graph.pause_requested_at, graph.pause_requested_by,
         (select count(*)::int from public.graphs where project_id = $1) as graphs,
         (select count(*)::int from public.graph_runs run
            join public.graphs graph on graph.id = run.graph_id
           where graph.project_id = $1) as graph_runs,
         (select count(*)::int from public.node_runs node_run
            join public.graph_runs run on run.id = node_run.graph_run_id
            join public.graphs graph on graph.id = run.graph_id
           where graph.project_id = $1) as node_runs,
         (select count(*)::int from public.grok_graph_launches
           where session_id = $2) as launches,
         (select count(*)::int from public.grok_task_links
           where session_id = $2) as links
       from public.graphs graph where graph.id = $3`,
      [projectId, session.id, launched.rows[0].graph_id],
    );
    expect(residue.rows[0]).toMatchObject({
      graph_id: launched.rows[0].graph_id,
      template_key: "full_lifecycle",
      template_version: 2,
      template_plan_sha256: "02bb1e7b35782fad9f6024c080bd149f7ade4edb9d68326fd3b04ff94ba589ad",
      github_repository_id: repositoryId,
      base_branch: "main",
      base_sha: baseSha,
      pause_requested_by: ownerId,
      graphs: before.rows[0].count + 1,
      graph_runs: 0,
      node_runs: 0,
      launches: 1,
      links: 1,
    });
    expect(residue.rows[0].pause_requested_at).not.toBeNull();

    await assumeRole(db, "authenticated", ownerId);
    const listed = await db.query<{ session_id: string; status: string }>(
      "select * from public.list_grok_sessions($1::uuid,$2::uuid,50,null,null)",
      [organizationId, projectId],
    );
    expect(listed.rows.find((row) => row.session_id === session.id)?.status).toBe("paused");
  });

  it("records control intent separately from the real action and resolves truthfully", async () => {
    const { session } = await createSession("Control a graph");
    await resetRole(db);
    const graph = await db.query<{ id: string }>(
      `insert into public.graphs (organization_id,project_id,goal,topology,created_by)
       values ($1,$2,'Control this graph','SINGLE_AGENT',$3) returning id`,
      [organizationId, projectId, ownerId],
    );

    await assumeRole(db, "authenticated", ownerId);
    const requested = await db.query<{ id: string; state: string }>(
      `select * from public.request_grok_control_intent(
         $1::uuid,$2::uuid,'graph',$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.rows[0].id,
        "Pause while I review the plan", "control-pause-0001"],
    );
    expect(requested.rows[0].state).toBe("requested");
    await resetRole(db);
    const before = await db.query<{ pause_requested_at: string | null }>(
      "select pause_requested_at from public.graphs where id = $1",
      [graph.rows[0].id],
    );
    expect(before.rows[0].pause_requested_at).toBeNull();

    await assumeRole(db, "authenticated", ownerId);
    await db.query("select * from public.set_graph_pause_as_member_v2($1::uuid,$2::uuid,true)", [
      organizationId, graph.rows[0].id,
    ]);
    await assumeRole(db, "service_role");
    const applied = await db.query<{ id: string; state: string }>(
      "select * from public.resolve_grok_control_intent_as_server($1::uuid,$2::uuid,'applied',null,null)",
      [organizationId, requested.rows[0].id],
    );
    expect(applied.rows[0].state).toBe("applied");
    const replay = await db.query<{ id: string; state: string }>(
      "select * from public.resolve_grok_control_intent_as_server($1::uuid,$2::uuid,'applied',null,null)",
      [organizationId, requested.rows[0].id],
    );
    expect(replay.rows[0]).toEqual(applied.rows[0]);
    await expect(db.query(
      "select * from public.resolve_grok_control_intent_as_server($1::uuid,$2::uuid,'failed','LATE_FAILURE','changed')",
      [organizationId, requested.rows[0].id],
    )).rejects.toThrow(/transition|conflicts/i);
  });

  it("atomically applies and replays one owner graph control with immutable events", async () => {
    const { session } = await createSession("Atomic graph control");
    const graph = await createControlGraph(session.id, "Apply graph control");

    await assumeRole(db, "authenticated", ownerId);
    const applied = await db.query<{ intent_id: string; replayed: boolean; state: string }>(
      `select * from public.apply_grok_graph_control_v2_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Pause in one atomic boundary", "atomic-pause-0001"],
    );
    expect(applied.rows).toHaveLength(1);
    expect(applied.rows[0]).toMatchObject({ replayed: false, state: "applied" });
    const replay = await db.query<{ intent_id: string; replayed: boolean; state: string }>(
      `select * from public.apply_grok_graph_control_v2_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Pause in one atomic boundary", "atomic-pause-0001"],
    );
    expect(replay.rows[0]).toMatchObject({
      intent_id: applied.rows[0].intent_id,
      replayed: true,
      state: "applied",
    });
    await resetRole(db);
    const residue = await db.query<{
      applied_events: number; pause_requested_at: string | null; requested_events: number; state: string;
    }>(`
      select graph.pause_requested_at,
             intent.state,
             count(*) filter (where event.event_type = 'control.requested')::int as requested_events,
             count(*) filter (where event.event_type = 'control.applied')::int as applied_events
        from public.graphs graph
        join public.grok_control_intents intent on intent.graph_id = graph.id
        join public.grok_events event on event.correlation_id = intent.id
       where graph.id = $1 and intent.id = $2
       group by graph.pause_requested_at, intent.state
    `, [graph.id, applied.rows[0].intent_id]);
    expect(residue.rows[0]).toMatchObject({
      state: "applied",
      requested_events: 1,
      applied_events: 1,
    });
    expect(residue.rows[0].pause_requested_at).not.toBeNull();
  });

  it("uses acquired session event order when wall-clock intent order is inverted", async () => {
    const { session } = await createSession("Atomic control ordering");
    const graph = await createControlGraph(session.id, "Order graph controls");

    await assumeRole(db, "authenticated", ownerId);
    const older = await db.query<{ id: string }>(
      `select * from public.request_grok_control_intent(
         $1::uuid,$2::uuid,'graph',$3::uuid,'resume',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Resume requested before later pause", "ordered-resume-0001"],
    );
    const newer = await db.query<{ intent_id: string }>(
      `select * from public.apply_grok_graph_control_v2_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Pause acquired after requested resume", "ordered-pause-0002"],
    );
    await resetRole(db);
    await db.exec("alter table public.grok_control_intents disable trigger grok_control_intents_guard_update");
    await db.query(
      `update public.grok_control_intents
          set requested_at = case when id = $1 then now() + interval '1 day'
                                  else now() - interval '1 day' end
        where id in ($1,$2)`,
      [older.rows[0].id, newer.rows[0].intent_id],
    );
    await db.exec("alter table public.grok_control_intents enable trigger grok_control_intents_guard_update");
    await assumeRole(db, "authenticated", ownerId);
    await expect(db.query(
      `select * from public.apply_grok_graph_control_v2_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'resume',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Resume requested before later pause", "ordered-resume-0001"],
    )).rejects.toThrow(/grok execution admission set is incomplete/i);
    await resetRole(db);
    const state = await db.query<{ pause_requested_at: string | null; resume_state: string }>(`
      select graph.pause_requested_at, intent.state as resume_state
        from public.graphs graph
        join public.grok_control_intents intent on intent.id = $2
       where graph.id = $1
    `, [graph.id, older.rows[0].id]);
    expect(state.rows[0].pause_requested_at).not.toBeNull();
    expect(state.rows[0].resume_state).toBe("requested");
  });

  it("refuses requested recovery when a direct graph control contradicts the action", async () => {
    const { session } = await createSession("Ambiguous requested recovery");
    const graph = await createControlGraph(session.id, "Keep the later direct pause");
    await assumeRole(db, "authenticated", ownerId);
    const requested = await db.query<{ id: string }>(
      `select * from public.request_grok_control_intent(
         $1::uuid,$2::uuid,'graph',$3::uuid,'resume',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Resume before a direct pause", "ambiguous-resume-0001"],
    );
    await db.query("select * from public.set_graph_pause_as_member_v2($1::uuid,$2::uuid,true)", [
      organizationId, graph.id,
    ]);
    await expect(db.query(
      `select * from public.apply_grok_graph_control_v2_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'resume',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Resume before a direct pause", "ambiguous-resume-0001"],
    )).rejects.toThrow(/grok execution admission set is incomplete/i);

    await resetRole(db);
    const state = await db.query<{
      applied_events: number; pause_events: number; pause_requested_at: string | null;
      requested_events: number; state: string;
    }>(`
      select graph.pause_requested_at, intent.state,
             (select count(*)::int from public.activity_events
               where entity_id = graph.id and event_type = 'graph.pause_changed') as pause_events,
             count(*) filter (where event.event_type = 'control.requested')::int as requested_events,
             count(*) filter (where event.event_type = 'control.applied')::int as applied_events
        from public.graphs graph
        join public.grok_control_intents intent on intent.id = $2
        join public.grok_events event on event.correlation_id = intent.id
       where graph.id = $1
       group by graph.id, graph.pause_requested_at, intent.state
    `, [graph.id, requested.rows[0].id]);
    expect(state.rows[0]).toMatchObject({
      state: "requested", requested_events: 1, applied_events: 0, pause_events: 1,
    });
    expect(state.rows[0].pause_requested_at).not.toBeNull();
  });

  it("refuses a requested Resume before mutation when immutable admissions are missing", async () => {
    const { session } = await createSession("Resolution-lost recovery");
    const graph = await createControlGraph(session.id, "Resolve the committed resume");
    await assumeRole(db, "authenticated", ownerId);
    await db.query("select * from public.set_graph_pause_as_member_v2($1::uuid,$2::uuid,true)", [
      organizationId, graph.id,
    ]);
    const requested = await db.query<{ id: string }>(
      `select * from public.request_grok_control_intent(
         $1::uuid,$2::uuid,'graph',$3::uuid,'resume',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Resume committed before resolution", "committed-resume-0001"],
    );
    await expect(db.query(
      "select * from public.set_graph_pause_as_member_v2($1::uuid,$2::uuid,false)",
      [organizationId, graph.id],
    )).rejects.toThrow(/grok execution admission set is incomplete/i);
    await expect(db.query(
      `select * from public.apply_grok_graph_control_v2_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'resume',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Resume committed before resolution", "committed-resume-0001"],
    )).rejects.toThrow(/grok execution admission set is incomplete/i);

    await resetRole(db);
    const state = await db.query<{
      applied_events: number; pause_events: number; pause_requested_at: string | null; state: string;
    }>(`
      select graph.pause_requested_at, intent.state,
             (select count(*)::int from public.activity_events
               where entity_id = graph.id and event_type = 'graph.pause_changed') as pause_events,
             count(*) filter (where event.event_type = 'control.applied')::int as applied_events
        from public.graphs graph
        join public.grok_control_intents intent on intent.id = $2
        join public.grok_events event on event.correlation_id = intent.id
       where graph.id = $1
       group by graph.id, graph.pause_requested_at, intent.state
    `, [graph.id, requested.rows[0].id]);
    expect(state.rows[0]).toMatchObject({
      state: "requested", pause_events: 1, applied_events: 0,
    });
    expect(state.rows[0].pause_requested_at).not.toBeNull();
  });

  it("keeps a paused graph unchanged when immutable admissions block Resume", async () => {
    const { session } = await createSession("Applied replay state guard");
    const graph = await createControlGraph(session.id, "Reject superseded applied keys");
    await assumeRole(db, "authenticated", ownerId);
    await db.query(
      `select * from public.apply_grok_graph_control_v2_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id, "Atomic pause", "state-pause-0001"],
    );
    await expect(db.query(
      "select * from public.set_graph_pause_as_member_v2($1::uuid,$2::uuid,false)",
      [organizationId, graph.id],
    )).rejects.toThrow(/grok execution admission set is incomplete/i);
    await resetRole(db);
    const state = await db.query<{ pause_requested_at: string | null }>(
      "select pause_requested_at from public.graphs where id = $1", [graph.id],
    );
    expect(state.rows[0].pause_requested_at).not.toBeNull();
  });

  it("rejects an old applied Pause after permanent direct withdrawal", async () => {
    const { session } = await createSession("Pause replay after withdrawal");
    const graph = await createControlGraph(session.id, "Withdrawal supersedes pause");
    await assumeRole(db, "authenticated", ownerId);
    await db.query(
      `select * from public.apply_grok_graph_control_v2_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id, "Pause before stopping", "withdrawn-pause-0001"],
    );
    await db.query("select * from public.withdraw_graph_as_member($1::uuid,$2::uuid,$3::text)", [
      organizationId, graph.id, "Permanently stop after pausing",
    ]);
    await expect(db.query(
      `select * from public.apply_grok_graph_control_v2_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id, "Pause before stopping", "withdrawn-pause-0001"],
    )).rejects.toThrow(/grok_control_superseded/i);

    await resetRole(db);
    const state = await db.query<{
      pause_requested_at: string | null; state: string; withdrawn_at: string | null;
    }>(`
      select graph.pause_requested_at, graph.withdrawn_at, intent.state
        from public.graphs graph
        join public.grok_control_intents intent on intent.graph_id = graph.id
       where graph.id = $1 and intent.idempotency_key = 'withdrawn-pause-0001'
    `, [graph.id]);
    expect(state.rows[0]).toMatchObject({ state: "applied" });
    expect(state.rows[0].pause_requested_at).not.toBeNull();
    expect(state.rows[0].withdrawn_at).not.toBeNull();
  });

  it("requires the graph's exact durable Grok-session launch binding", async () => {
    const linked = await createSession("Linked control session");
    const wrong = await createSession("Wrong control session");
    const graph = await createControlGraph(linked.session.id, "Only the linked session controls this");
    await resetRole(db);
    const unlinked = await db.query<{ id: string }>(
      `insert into public.graphs (organization_id,project_id,goal,topology,created_by)
       values ($1,$2,'Unlinked same-project graph','SINGLE_AGENT',$3) returning id`,
      [organizationId, projectId, ownerId],
    );
    await assumeRole(db, "authenticated", ownerId);
    await expect(db.query(
      `select * from public.apply_grok_graph_control_v2_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, wrong.session.id, graph.id,
        "Wrong session cannot pause", "wrong-session-pause-0001"],
    )).rejects.toThrow(/Grok graph control is not authorized/i);
    await expect(db.query(
      `select * from public.apply_grok_graph_control_v2_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, linked.session.id, unlinked.rows[0].id,
        "Unlinked graph cannot pause", "unlinked-graph-pause-0001"],
    )).rejects.toThrow(/Grok graph control is not authorized/i);

    await resetRole(db);
    const residue = await db.query<{ events: number; intents: number }>(`
      select
        (select count(*)::int from public.grok_control_intents
          where idempotency_key in ('wrong-session-pause-0001','unlinked-graph-pause-0001')) as intents,
        (select count(*)::int from public.grok_events
          where session_id in ($1,$2) and event_type like 'control.%') as events
    `, [linked.session.id, wrong.session.id]);
    expect(residue.rows[0]).toEqual({ intents: 0, events: 0 });
  });

  it("rolls back a fresh unavailable graph control without intent or audit residue", async () => {
    const { session } = await createSession("Unavailable atomic graph control");
    const graph = await createControlGraph(session.id, "Reject unavailable resume");
    await assumeRole(db, "authenticated", ownerId);
    await expect(db.query(
      `select * from public.apply_grok_graph_control_v2_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'resume',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Fresh resume is unavailable", "unavailable-resume-0001"],
    )).rejects.toThrow(/grok execution admission set is incomplete/i);
    await resetRole(db);
    const residue = await db.query<{ events: number; intents: number; pause_requested_at: string | null }>(`
      select graph.pause_requested_at,
             (select count(*)::int from public.grok_control_intents
               where session_id = $1 and idempotency_key = 'unavailable-resume-0001') as intents,
             (select count(*)::int from public.grok_events
               where session_id = $1 and event_type like 'control.%') as events
        from public.graphs graph where graph.id = $2
    `, [session.id, graph.id]);
    expect(residue.rows[0]).toEqual({ pause_requested_at: null, intents: 0, events: 0 });
  });

  it("keeps the atomic graph control owner-only and tenant scoped", async () => {
    const { session } = await createSession("Atomic graph control authority");
    const graph = await createControlGraph(session.id, "Authorize graph controls");

    await assumeRole(db, "authenticated", memberId);
    await expect(db.query(
      "select * from public.apply_grok_graph_control_v2_as_owner($1::uuid,$2::uuid,$3::uuid,'pause',$4,$5)",
      [organizationId, session.id, graph.id, "Member pause denied", "member-pause-0001"],
    )).rejects.toThrow(/Grok graph control is not authorized/i);
    await assumeRole(db, "authenticated", outsiderId);
    await expect(db.query(
      "select * from public.apply_grok_graph_control_v2_as_owner($1::uuid,$2::uuid,$3::uuid,'pause',$4,$5)",
      [organizationId, session.id, graph.id, "Outsider pause denied", "outsider-pause-0001"],
    )).rejects.toThrow(/Grok graph control is not authorized/i);
    await expect(db.query(
      "select * from public.apply_grok_graph_control_v2_as_owner($1::uuid,$2::uuid,$3::uuid,'pause',$4,$5)",
      [outsiderOrganizationId, session.id, graph.id,
        "Cross tenant pause denied", "cross-tenant-pause-0001"],
    )).rejects.toThrow(/Grok graph control is not authorized/i);
    await assumeRole(db, "anon");
    await expect(db.query(
      "select * from public.apply_grok_graph_control_v2_as_owner($1::uuid,$2::uuid,$3::uuid,'pause',$4,$5)",
      [organizationId, session.id, graph.id, "Anonymous pause denied", "anon-pause-0001"],
    )).rejects.toThrow(/permission denied/i);
  });

  it("pins the atomic control catalog owner, search path and authenticated-only ACL", async () => {
    await resetRole(db);
    const catalog = await db.query<{
      owner_name: string; proconfig: string[]; prosecdef: boolean;
    }>(`
      select owner_role.rolname as owner_name, proc.proconfig, proc.prosecdef
        from pg_catalog.pg_proc proc
        join pg_catalog.pg_roles owner_role on owner_role.oid = proc.proowner
       where proc.oid = 'public.apply_grok_graph_control_v2_as_owner(uuid,uuid,uuid,text,text,text)'::regprocedure
    `);
    expect(catalog.rows).toHaveLength(1);
    expect(catalog.rows[0]).toMatchObject({
      owner_name: "postgres",
      prosecdef: true,
      proconfig: ["search_path=pg_catalog"],
    });
    const acl = await db.query<{
      anon_execute: boolean; authenticated_execute: boolean; service_execute: boolean;
    }>(`
      select
        has_function_privilege('anon', 'public.apply_grok_graph_control_v2_as_owner(uuid,uuid,uuid,text,text,text)', 'EXECUTE')
          as anon_execute,
        has_function_privilege('authenticated', 'public.apply_grok_graph_control_v2_as_owner(uuid,uuid,uuid,text,text,text)', 'EXECUTE')
          as authenticated_execute,
        has_function_privilege('service_role', 'public.apply_grok_graph_control_v2_as_owner(uuid,uuid,uuid,text,text,text)', 'EXECUTE')
          as service_execute
    `);
    expect(acl.rows[0]).toEqual({
      anon_execute: false,
      authenticated_execute: true,
      service_execute: false,
    });
  });

  it("atomically admits exact locked provider identities for MODEL and Phase 1C lanes", async () => {
    const claudeAccountId = "71000000-0000-4000-8000-000000000001";
    const codexAccountId = "71000000-0000-4000-8000-000000000002";
    const claudeBotId = "72000000-0000-4000-8000-000000000001";
    const codexBotId = "72000000-0000-4000-8000-000000000002";
    const claudeRoleId = "73000000-0000-4000-8000-000000000001";
    const codexRoleId = "73000000-0000-4000-8000-000000000002";
    const claudeAssignmentId = "74000000-0000-4000-8000-000000000001";
    const codexAssignmentId = "74000000-0000-4000-8000-000000000002";
    const maxLengthAssignmentModel = "m".repeat(128);
    const alternateCodexModel = "gpt-5.4-codex";
    const claudeCapabilities = [
      "architecture", "decision", "discovery", "evaluation",
      "planning", "qa", "review", "security_review", "synthesis",
    ] as const;

    await resetRole(db);
    await db.exec(`
      insert into public.ai_accounts (
        id, organization_id, provider, auth_method, display_name, status,
        credential_purpose, provider_identity, created_by
      ) values
        ('${claudeAccountId}', '${organizationId}', 'anthropic', 'subscription',
         'Grok Claude admission', 'connected', 'claude_71', 'claude-owner', '${ownerId}'),
        ('${codexAccountId}', '${organizationId}', 'openai', 'subscription',
         'Grok Codex admission', 'connected', 'codex_71', 'codex-owner', '${ownerId}');

      insert into public.provider_credentials (
        organization_id, purpose, sealed_envelope, source, created_by
      ) values
        ('${organizationId}', 'claude_71',
         'v1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'connect_session', '${ownerId}'),
        ('${organizationId}', 'codex_71',
         'v1.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'connect_session', '${ownerId}');

      insert into public.bot_roles (
        id, organization_id, name, slug, summary, instructions,
        risk_ceiling, capabilities, created_by
      ) values
        ('${claudeRoleId}', '${organizationId}', 'Grok analyst', 'grok-analyst',
         'Read-only lifecycle analysis', 'Analyze and verify bounded evidence.',
         'red', '["planning","discovery","evaluation","decision","architecture","review","security","testing","synthesis"]',
         '${ownerId}'),
        ('${codexRoleId}', '${organizationId}', 'Grok writer', 'grok-writer',
         'Bounded draft pull request writer', 'Implement only through the Phase 1C bridge.',
         'red', '["implementation"]', '${ownerId}');

      insert into public.bots (
        id, organization_id, name, provider, model, credential_ref,
        readiness, last_checked_at, ai_account_id, created_by
      ) values
        ('${claudeBotId}', '${organizationId}', 'Grok Claude', 'anthropic',
         'claude-opus-5', 'SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_71',
         'ready', now(), '${claudeAccountId}', '${ownerId}'),
        ('${codexBotId}', '${organizationId}', 'Grok Codex', 'openai',
         'gpt-5.3-codex', 'SOFTWAREFACTORY_CODEX_AUTH_JSON_71',
         'ready', now(), '${codexAccountId}', '${ownerId}');

      insert into public.bot_assignments (
        id, organization_id, bot_id, project_id, role_id, status,
        preset, model, work_effort, repository_access, can_open_pull_request,
        can_merge_pull_request, pipeline_access, requires_human_approval,
        created_by
      ) values
        ('${claudeAssignmentId}', '${organizationId}', '${claudeBotId}',
         '${projectId}', '${claudeRoleId}', 'active', 'reviewer',
         '${maxLengthAssignmentModel}', 'high', 'read', false,
         false, 'all', true, '${ownerId}'),
        ('${codexAssignmentId}', '${organizationId}', '${codexBotId}',
         '${projectId}', '${codexRoleId}', 'active', 'developer', '${alternateCodexModel}',
         'high', 'write', true,
         false, 'all', true, '${ownerId}');
    `);

    const snapshots = await db.query<{
      assignment_id: string; assignment_revision: number;
      bot_id: string; bot_revision: number; role_id: string;
      role_updated_at: string; ai_account_id: string; account_updated_at: string;
      provider: "anthropic" | "openai"; model: string;
      credential_purpose: string; credential_ref: string; provider_identity: string;
    }>(`
      select assignment.id as assignment_id, assignment.revision as assignment_revision,
             bot.id as bot_id, bot.revision as bot_revision, role_definition.id as role_id,
             role_definition.updated_at as role_updated_at,
             account.id as ai_account_id, account.updated_at as account_updated_at,
             bot.provider::text as provider, coalesce(assignment.model, bot.model) as model,
             account.credential_purpose, bot.credential_ref,
             account.provider_identity
        from public.bot_assignments assignment
        join public.bots bot on bot.id = assignment.bot_id
        join public.bot_roles role_definition on role_definition.id = assignment.role_id
        join public.ai_accounts account on account.id = bot.ai_account_id
       where assignment.id in ('${claudeAssignmentId}', '${codexAssignmentId}')
       order by bot.provider::text
    `);
    const claude = snapshots.rows.find((row) => row.provider === "anthropic")!;
    const codex = snapshots.rows.find((row) => row.provider === "openai")!;

    const specialistFor = (
      snapshot: typeof claude,
      capabilities: readonly string[],
    ) => ({
      version: 1,
      assignmentId: snapshot.assignment_id,
      assignmentRevision: Number(snapshot.assignment_revision),
      botId: snapshot.bot_id,
      botRevision: Number(snapshot.bot_revision),
      roleId: snapshot.role_id,
      roleUpdatedAt: snapshot.role_updated_at,
      capabilities,
      maxModelTier: "STRONG" as const,
      aiAccountId: snapshot.ai_account_id,
      accountUpdatedAt: snapshot.account_updated_at,
      credentialPurpose: snapshot.credential_purpose,
      credentialRef: snapshot.credential_ref,
      providerIdentity: snapshot.provider_identity,
      provider: snapshot.provider,
      model: snapshot.model,
    });
    const claudeSpecialist = specialistFor(claude, claudeCapabilities);
    const codexSpecialist = specialistFor(codex, ["implementation"]);
    const admissionRoster = [claudeSpecialist, codexSpecialist];

    const template = findTemplate("full_lifecycle");
    if (!template) throw new Error("full_lifecycle template is absent");
    const built = buildLaunchPlan(
      { ...template, summary: "Admit exact provider routes" },
      budgetForTemplate(template),
    );
    if (!built.ok) throw new Error(built.errors.join("; "));

    const admissions = built.plan.nodes.flatMap((node) => {
      const selected = node.executor === "MODEL"
        ? { lane: "graph_model" as const, specialist: claudeSpecialist }
        : node.executor === "ANCHOR" && node.node_key === "implement"
          ? { lane: "phase1c" as const, specialist: codexSpecialist }
          : null;
      if (!selected) return [];
      return [{
        version: 2,
        lane: selected.lane,
        nodeKey: node.node_key,
        sourceRosterAssignmentId: selected.specialist.assignmentId,
        assignmentId: selected.specialist.assignmentId,
        assignmentRevision: selected.specialist.assignmentRevision,
        botId: selected.specialist.botId,
        botRevision: selected.specialist.botRevision,
        roleId: selected.specialist.roleId,
        roleUpdatedAt: selected.specialist.roleUpdatedAt,
        agentCapabilities: selected.specialist.capabilities,
        agentMaxModelTier: selected.specialist.maxModelTier,
        aiAccountId: selected.specialist.aiAccountId,
        accountUpdatedAt: selected.specialist.accountUpdatedAt,
        provider: selected.specialist.provider,
        model: selected.specialist.model,
        credentialPurpose: selected.specialist.credentialPurpose,
        credentialRef: selected.specialist.credentialRef,
        providerIdentity: selected.specialist.providerIdentity,
        capability: node.capability,
      }];
    });

    const { session } = await createSession("Exact provider admission");
    await assumeRole(db, "authenticated", ownerId);
    const user = await db.query<MessageRow>(
      `select * from public.append_grok_user_message(
         $1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text,0,null
       )`,
      [organizationId, session.id, "Admit exact provider routes", "{}",
        "provider-admission-user-0001"],
    );
    await assumeRole(db, "service_role");
    const initialContextText = "# Claim context";
    const initialContextItems = [
      { kind: "project", label: "Chief of Staff", media_type: null, source_url: null,
        repository_path: null, integration_id: null, content_text: null, byte_size: 0, state: "reference_only" },
      { kind: "repository", label: "factory/grok-workspace", media_type: null, source_url: null,
        repository_path: "main", integration_id: null, content_text: null, byte_size: 0, state: "reference_only" },
      { kind: "file", label: "claim-context.md", media_type: "text/markdown", source_url: null,
        repository_path: null, integration_id: null, content_text: initialContextText,
        byte_size: Buffer.byteLength(initialContextText), state: "captured" },
    ];
    const initialContext = await db.query<{ result: { envelope: { id: string; input_sha256: string } } }>(
      `select public.record_grok_context_envelope_as_server(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::jsonb,$7::text,2,false
      ) as result`,
      [organizationId, ownerId, projectId, session.id, user.rows[0].id,
        JSON.stringify(initialContextItems), "provider-admission-context-0001"],
    );
    const assistant = await db.query<MessageRow>(
      `select * from public.append_grok_message_as_server(
         $1::uuid,$2::uuid,'assistant',$3::text,$4::jsonb,$5::text,1,$6::uuid
       )`,
      [organizationId, session.id, "The exact provider plan is recorded.", JSON.stringify({
        kind: "grok.plan",
        plan: {
          planner: { version: 3 },
          intent: { kind: "build" },
          admissionRoster,
          dag: { tasks: [] },
        },
      }), "provider-admission-assistant-0001", user.rows[0].id],
    );

    const rosterCall = `select public.record_grok_specialist_roster_v2_as_server(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::bigint
    ) as result`;

    const { session: nullRosterSession } = await createSession("Null roster version");
    await assumeRole(db, "authenticated", ownerId);
    const nullRosterUser = await db.query<MessageRow>(
      `select * from public.append_grok_user_message(
         $1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text,0,null
       )`,
      [organizationId, nullRosterSession.id, "Reject a null roster version", "{}",
        "provider-admission-null-roster-user-0001"],
    );
    await assumeRole(db, "service_role");
    const nullRosterAssistant = await db.query<MessageRow>(
      `select * from public.append_grok_message_as_server(
         $1::uuid,$2::uuid,'assistant',$3::text,$4::jsonb,$5::text,1,$6::uuid
       )`,
      [organizationId, nullRosterSession.id, "The malformed provider plan is recorded.", JSON.stringify({
        kind: "grok.plan",
        plan: {
          planner: { version: 3 },
          intent: { kind: "build" },
          admissionRoster: admissionRoster.map((entry, index) => index === 0
            ? { ...entry, version: null }
            : entry),
          dag: { tasks: [] },
        },
      }), "provider-admission-null-roster-assistant-0001", nullRosterUser.rows[0].id],
    );
    await expect(db.query(rosterCall, [
      organizationId, ownerId, projectId, nullRosterSession.id,
      nullRosterAssistant.rows[0]!.id, "provider-admission-null-roster-0001", 2,
    ])).rejects.toThrow(/invalid grok specialist roster protocol version/i);

    const rosterParameters = [
      organizationId, ownerId, projectId, session.id, assistant.rows[0].id,
      "provider-admission-roster-0001", 4,
    ] as const;
    const admittedRoster = await db.query<{ result: {
      message_id: string; roster_count: number; roster_sha256: string; replayed: boolean;
    } }>(rosterCall, [...rosterParameters]);
    const replayedRoster = await db.query<{ result: {
      message_id: string; roster_count: number; roster_sha256: string; replayed: boolean;
    } }>(rosterCall, [...rosterParameters]);
    expect(admittedRoster.rows[0]?.result).toMatchObject({
      message_id: assistant.rows[0].id,
      roster_count: 2,
      replayed: false,
    });
    expect(replayedRoster.rows[0]?.result).toMatchObject({
      message_id: assistant.rows[0].id,
      roster_count: 2,
      replayed: true,
    });

    await db.query(`select public.record_grok_event_as_server(
      $1::uuid,$2::uuid,'session.planned',$2::uuid,$3::jsonb,5,$4::uuid,null
    )`, [organizationId, session.id, JSON.stringify({
      schemaVersion: 1,
      detail: "The deterministic chief-of-staff plan was recorded; execution has not started.",
      planMessageId: assistant.rows[0].id,
      plannerVersion: 3,
      taskCount: 0,
      specialistRosterCount: 2,
      specialistRosterSha256: admittedRoster.rows[0]!.result.roster_sha256,
    }), assistant.rows[0].id]);

    const parameters = [
      organizationId, ownerId, projectId, session.id, assistant.rows[0].id,
      "provider-admission-launch-0001", built.plan.goal, built.plan.topology,
      JSON.stringify(built.plan.topologyReasons), built.plan.riskLevel,
      built.plan.requiresOwnerApproval, JSON.stringify(built.plan.nodes),
      JSON.stringify(built.plan.edges), JSON.stringify(built.plan.budget),
      repositoryId, "main", baseSha, JSON.stringify(requiredChecks),
      "provider-admission-roster-0001",
      JSON.stringify(admissions),
    ] as const;
    const call = `select * from public.launch_grok_full_lifecycle_v4_as_server(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,
      $8::public.graph_topology,$9::jsonb,$10::public.risk_level,$11::boolean,
      $12::jsonb,$13::jsonb,$14::jsonb,$15::uuid,$16::text,$17::text,
      $18::jsonb,$19::text,$20::jsonb
    )`;

    const mismatchedAdmissions = admissions.map((entry, index) => index === 0
      ? { ...entry, assignmentRevision: entry.assignmentRevision + 1 }
      : entry);
    const nullVersionAdmissions = admissions.map((entry, index) => index === 0
      ? { ...entry, version: null }
      : entry);
    await expect(
      db.query(call, [
        ...parameters.slice(0, 19),
        JSON.stringify(nullVersionAdmissions),
      ]),
    ).rejects.toThrow(/invalid grok v4 provider admission protocol version/i);
    const mismatchedParameters = [
      ...parameters.slice(0, 19),
      JSON.stringify(mismatchedAdmissions),
    ];
    await expect(
      db.query(call, mismatchedParameters),
    ).rejects.toThrow(/immutable specialist roster|assignment.*revision|identity.*mismatch/i);

    await resetRole(db);
    const rejectedState = await db.query<{
      admissions: number; graphs: number; launches: number;
    }>(`
      select
        (select count(*)::integer
           from public.grok_execution_admissions admission
          where admission.session_id = $1) as admissions,
        (select count(*)::integer
           from public.graphs graph
          where graph.organization_id = $2
            and graph.project_id = $3
            and graph.goal = $4) as graphs,
        (select count(*)::integer
           from public.grok_graph_launches launch
          where launch.session_id = $1) as launches
    `, [session.id, organizationId, projectId, built.plan.goal]);
    expect(rejectedState.rows[0]).toEqual({
      admissions: 0,
      graphs: 0,
      launches: 0,
    });

    const { session: legacySession } = await createSession("Legacy provider admission");
    await assumeRole(db, "authenticated", ownerId);
    const legacyUser = await db.query<MessageRow>(
      `select * from public.append_grok_user_message(
         $1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text,0,null
       )`,
      [organizationId, legacySession.id, "Reject legacy provider admission", "{}",
        "provider-admission-legacy-user-0001"],
    );
    await assumeRole(db, "service_role");
    const legacyAssistant = await db.query<MessageRow>(
      `select * from public.append_grok_message_as_server(
         $1::uuid,$2::uuid,'assistant',$3::text,$4::jsonb,$5::text,1,$6::uuid
       )`,
      [organizationId, legacySession.id, "The legacy plan is recorded.", JSON.stringify({
        kind: "grok.plan",
        plan: { planner: { version: 1 }, dag: { tasks: [] } },
      }), "provider-admission-legacy-assistant-0001", legacyUser.rows[0].id],
    );
    const legacyParameters = [
      ...parameters.slice(0, 3), legacySession.id, legacyAssistant.rows[0].id,
      "provider-admission-legacy-launch-0001", ...parameters.slice(6),
    ];
    await expect(db.query(call, legacyParameters)).rejects.toThrow(
      /grok_plan_v3_roster_not_found/i,
    );

    await resetRole(db);
    const legacyRejectedState = await db.query<{
      admissions: number; graphs: number; launches: number;
    }>(`
      select
        (select count(*)::integer
           from public.grok_execution_admissions admission
          where admission.session_id = $1) as admissions,
        (select count(*)::integer
           from public.graphs graph
          where graph.organization_id = $2
            and graph.project_id = $3
            and graph.goal = $4) as graphs,
        (select count(*)::integer
           from public.grok_graph_launches launch
          where launch.session_id = $1) as launches
    `, [legacySession.id, organizationId, projectId, built.plan.goal]);
    expect(legacyRejectedState.rows[0]).toEqual({
      admissions: 0,
      graphs: 0,
      launches: 0,
    });

    await assumeRole(db, "service_role");
    const launched = await db.query<{ id: string; graph_id: string }>(call, [...parameters]);
    const replay = await db.query<{ id: string; graph_id: string }>(call, [...parameters]);
    expect(replay.rows[0]).toEqual(launched.rows[0]);

    await resetRole(db);
    const currentSequence = await db.query<{
      last_message_sequence: number; last_event_sequence: number;
    }>(
      "select last_message_sequence,last_event_sequence from public.grok_sessions where id=$1",
      [session.id],
    );
    await assumeRole(db, "authenticated", ownerId);
    const followUpText = "This post-plan follow-up must never enter an existing claim.";
    await db.query(
      `select public.append_grok_follow_up_context(
        $1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::text,$7::bigint,$8::bigint,$9::uuid
      )`,
      [organizationId, projectId, session.id, "Use the later note only after an explicit replan.",
        JSON.stringify([
          initialContextItems[0], initialContextItems[1],
          { ...initialContextItems[2], label: "later.md", content_text: followUpText,
            byte_size: Buffer.byteLength(followUpText) },
        ]), "provider-admission-follow-up-0001",
        currentSequence.rows[0]!.last_message_sequence,
        currentSequence.rows[0]!.last_event_sequence,
        assistant.rows[0].id],
    );

    // Exercise the real protocol-v3 target claim without consuming this
    // fixture: unpause, claim, assert, and roll the whole transaction back.
    await db.exec("begin");
    try {
      await db.query(
        "select public.set_graph_pause_as_member_v2($1::uuid,$2::uuid,false)",
        [organizationId, launched.rows[0].graph_id],
      );
      await assumeRole(db, "service_role");
      const graphClaim = await db.query<{ claim: {
        graph_id: string;
        initial_context: {
          envelope_id: string; input_sha256: string;
          items: Array<{ content_text: string | null }>;
        };
      } | null }>(
        `select public.claim_planned_graph_by_id_v3(
          'grok-context-worker', array['DETERMINISTIC','MODEL','ANCHOR']::text[],
          'factory/grok-workspace', $1::jsonb, $2::uuid, 3
        ) as claim`,
        [JSON.stringify(requiredChecks), launched.rows[0].graph_id],
      );
      expect(graphClaim.rows[0]!.claim).toMatchObject({
        graph_id: launched.rows[0].graph_id,
        initial_context: {
          envelope_id: initialContext.rows[0]!.result.envelope.id,
          input_sha256: initialContext.rows[0]!.result.envelope.input_sha256,
        },
      });
      const graphContextJson = JSON.stringify(graphClaim.rows[0]!.claim!.initial_context);
      expect(graphContextJson).toContain(initialContextText);
      expect(graphContextJson).not.toContain(followUpText);
    } finally {
      await db.exec("rollback");
      await db.exec("reset role");
    }

    await db.exec("begin");
    try {
      await db.exec("alter table public.grok_context_envelopes disable trigger grok_context_envelopes_immutable");
      await db.query(
        "update public.grok_context_envelopes set input_sha256=repeat('f',64) where id=$1",
        [initialContext.rows[0]!.result.envelope.id],
      );
      await assumeRole(db, "authenticated", ownerId);
      await db.query(
        "select public.set_graph_pause_as_member_v2($1::uuid,$2::uuid,false)",
        [organizationId, launched.rows[0].graph_id],
      );
      await assumeRole(db, "service_role");
      await expect(db.query(
        `select public.claim_planned_graph_by_id_v3(
          'grok-context-worker', array['DETERMINISTIC','MODEL','ANCHOR']::text[],
          'factory/grok-workspace', $1::jsonb, $2::uuid, 3
        )`,
        [JSON.stringify(requiredChecks), launched.rows[0].graph_id],
      )).rejects.toThrow(/context envelope digest changed/i);
    } finally {
      await db.exec("rollback");
      await db.exec("reset role");
    }
    const rolledBackClaim = await db.query<{ graph_runs: number; digest: string }>(`
      select
        (select count(*)::integer from public.graph_runs where graph_id=$1) as graph_runs,
        (select input_sha256 from public.grok_context_envelopes where id=$2) as digest
    `, [launched.rows[0].graph_id, initialContext.rows[0]!.result.envelope.id]);
    expect(rolledBackClaim.rows[0]).toEqual({
      graph_runs: 0,
      digest: initialContext.rows[0]!.result.envelope.input_sha256,
    });

    await resetRole(db);
    const evidence = await db.query<{
      total: number; graph_model: number; phase1c: number;
      credential_versions_exact: boolean; hashes_valid: boolean;
      specialist_links_exact: boolean; specialist_hashes_valid: boolean;
      max_length_model_admitted: boolean; graph_runs: number;
      pause_requested_at: string | null;
    }>(`
      select count(*)::integer as total,
             count(*) filter (where lane = 'graph_model')::integer as graph_model,
             count(*) filter (where lane = 'phase1c')::integer as phase1c,
             bool_and(admission_sha256 = public.grok_current_execution_admission_hash(admission))
               as hashes_valid,
             bool_and(admission.specialist_admission_id is not null and exists (
               select 1
                 from public.grok_specialist_admissions specialist
                where specialist.id = admission.specialist_admission_id
                  and specialist.organization_id = admission.organization_id
                  and specialist.project_id = admission.project_id
                  and specialist.session_id = admission.session_id
                  and specialist.message_id = admission.message_id
                  and specialist.assignment_id = admission.assignment_id
             )) as specialist_links_exact,
             bool_and(exists (
               select 1
                 from public.grok_specialist_admissions specialist
                where specialist.id = admission.specialist_admission_id
                  and specialist.admission_sha256 =
                    public.grok_specialist_admission_hash(specialist)
             )) as specialist_hashes_valid,
             bool_and(exists (
               select 1
                 from public.provider_credentials credential
                where credential.id = admission.provider_credential_id
                  and credential.organization_id = admission.organization_id
                  and credential.purpose = admission.credential_purpose
                  and credential.rotated_at = admission.provider_credential_rotated_at
             )) as credential_versions_exact,
             bool_or(char_length(admission.model) = 128) as max_length_model_admitted,
             (select count(*)::integer from public.graph_runs run
               where run.graph_id = $1) as graph_runs,
             (select pause_requested_at from public.graphs graph
               where graph.id = $1) as pause_requested_at
        from public.grok_execution_admissions admission
       where admission.graph_id = $1
    `, [launched.rows[0].graph_id]);
    expect(evidence.rows[0]).toMatchObject({
      total: admissions.length,
      graph_model: admissions.filter((entry) => entry.lane === "graph_model").length,
      phase1c: 1,
      credential_versions_exact: true,
      hashes_valid: true,
      specialist_links_exact: true,
      specialist_hashes_valid: true,
      max_length_model_admitted: true,
      graph_runs: 0,
    });
    expect(evidence.rows[0].pause_requested_at).not.toBeNull();

    const graphRunId = "76000000-0000-4000-8000-000000000001";
    const architectureNodeRunId = "76000000-0000-4000-8000-000000000002";
    const architectureArtifactId = "76000000-0000-4000-8000-000000000003";
    const architectureGateId = "76000000-0000-4000-8000-000000000004";
    const architectureNode = await db.query<{ id: string }>(`
      select id from public.graph_nodes
       where graph_id = $1 and node_key = 'architecture'
    `, [launched.rows[0].graph_id]);
    await db.exec(`
      insert into public.graph_runs (
        id, organization_id, graph_id, state, started_at, completed_at, created_by
      ) values (
        '${graphRunId}', '${organizationId}', '${launched.rows[0].graph_id}',
        'RUNNING', now() - interval '10 minutes', null,
        '${ownerId}'
      );
      insert into public.node_runs (
        id, organization_id, graph_run_id, node_id, state, attempt,
        queued_at, started_at, completed_at
      ) values (
        '${architectureNodeRunId}', '${organizationId}', '${graphRunId}',
        '${architectureNode.rows[0]!.id}', 'VERIFYING', 1,
        now() - interval '9 minutes', now() - interval '8 minutes', null
      );
      insert into public.graph_artifacts (
        id, organization_id, graph_run_id, node_run_id, kind, payload, created_at
      ) values (
        '${architectureArtifactId}', '${organizationId}', '${graphRunId}',
        '${architectureNodeRunId}', 'RAW',
        '{"decision":"implement the exact alternate admitted OpenAI route"}'::jsonb,
        now() - interval '3 minutes'
      );
      insert into public.graph_gates (
        id, organization_id, graph_id, node_id, stage, kind, state,
        opened_by_run_id, opened_at, decided_at, decided_by
      ) values (
        '${architectureGateId}', '${organizationId}', '${launched.rows[0].graph_id}',
        '${architectureNode.rows[0]!.id}', 'ARCHITECTURE', 'HUMAN', 'OPEN',
        '${graphRunId}', now() - interval '4 minutes', null, null
      );
      update public.graph_runs
         set state = 'PARTIAL', completed_at = now() - interval '2 minutes'
       where id = '${graphRunId}';
    `);

    await assumeRole(db, "authenticated", ownerId);
    const bridge = await db.query<{ bridge_id: string }>(
      `select bridge_id from public.approve_graph_phase1c_architecture_gate(
         $1::uuid, $2::uuid, 'Exact alternate route reviewed'
       )`,
      [architectureGateId, architectureArtifactId],
    );
    const executionPlan = createPhase1CExecutionPlan("build_feature", {});
    const phase1CParameters = {
      acceptanceCriteria: ["The approved alternate-model architecture is implemented and verified."],
      agentRole: executionPlan.agentRole,
      budget: executionPlan.budget,
      commandType: "build_feature",
      dependencyTaskIds: [] as string[],
      executionMode: "manual",
      model: executionPlan.model,
      plan: executionPlan.plan,
      provider: executionPlan.provider,
      repositoryBinding: {
        appId: 910002,
        baseBranch: "main",
        baseSha,
        connectionId,
        externalInstallationId: 910001,
        externalRepositoryId: 910004,
        installationId,
        repositoryId,
      },
      riskAssessment: { factors: [], reasons: [], requestedRisk: "yellow" },
    };

    await expect(db.query(
      `select * from public.submit_command(
         $1::uuid, $2::text, 'yellow'::public.risk_level, $3::jsonb, $4::text
       )`,
      [projectId, "A direct alternate model must be denied.", JSON.stringify({
        ...phase1CParameters,
        model: alternateCodexModel,
      }), "direct-alternate-model-denied-0001"],
    )).rejects.toThrow(/execution configuration|current.*admission/i);
    await expect(db.query(
      `select * from public.submit_command(
         $1::uuid, $2::text, 'yellow'::public.risk_level, $3::jsonb, $4::text
       )`,
      [projectId, "A null reserved capability must be denied.", JSON.stringify({
        ...phase1CParameters,
        _grokPhase1CAuthorization: null,
      }), "reserved-null-denied-0001"],
    )).rejects.toThrow(/execution configuration/i);
    await expect(db.query(
      `select * from public.submit_command(
         $1::uuid, $2::text, 'yellow'::public.risk_level, $3::jsonb, $4::text
       )`,
      [projectId, "A forged capability must be denied.", JSON.stringify({
        ...phase1CParameters,
        model: alternateCodexModel,
        _grokPhase1CAuthorization: "76000000-0000-4000-8000-000000000099",
      }), "forged-capability-denied-0001"],
    )).rejects.toThrow(/execution configuration/i);

    const submission = await db.query<{
      bridge_id: string; command_id: string; task_id: string;
      command_state: string; task_state: string; was_created: boolean;
    }>(`
      select bridge_id, command_id, task_id, command_state::text,
             task_state::text, was_created
        from public.submit_and_attach_graph_phase1c_command($1::uuid, $2::jsonb)
    `, [bridge.rows[0]!.bridge_id, JSON.stringify(phase1CParameters)]);
    expect(submission.rows[0]).toMatchObject({
      bridge_id: bridge.rows[0]!.bridge_id,
      command_state: "queued",
      task_state: "queued",
      was_created: true,
    });
    const replayedSubmission = await db.query<{
      command_id: string; task_id: string; was_created: boolean;
    }>(`
      select command_id, task_id, was_created
        from public.submit_and_attach_graph_phase1c_command($1::uuid, $2::jsonb)
    `, [bridge.rows[0]!.bridge_id, JSON.stringify(phase1CParameters)]);
    expect(replayedSubmission.rows[0]).toEqual({
      command_id: submission.rows[0]!.command_id,
      task_id: submission.rows[0]!.task_id,
      was_created: false,
    });

    await resetRole(db);
    const persistedRoute = await db.query<{
      command_model: string; run_model: string; provider: string;
      private_fields_absent: boolean; guards: number; residue: number;
    }>(`
      select command.parameters ->> 'model' as command_model,
             run.model as run_model,
             run.provider as provider,
             not command.parameters ? '_grokPhase1CAuthorization'
               and not command.parameters ? '_factoryRecordOnlyAuthorization'
               as private_fields_absent,
             (select count(*)::integer
                from public.grok_phase1c_submission_guards) as guards,
             (select count(*)::integer from public.commands rejected
               where rejected.idempotency_key in (
                 'direct-alternate-model-denied-0001',
                 'reserved-null-denied-0001',
                 'forged-capability-denied-0001'
               )) as residue
        from public.commands command
        join public.agent_runs run on run.command_id = command.id
       where command.id = $1
    `, [submission.rows[0]!.command_id]);
    expect(persistedRoute.rows[0]).toEqual({
      command_model: alternateCodexModel,
      run_model: alternateCodexModel,
      provider: "openai",
      private_fields_absent: true,
      guards: 0,
      residue: 0,
    });

    await assumeRole(db, "service_role");
    await db.query("select * from public.register_phase1c_worker($1,$2,$3::jsonb)", [
      "grok-alternate-model-worker", "1.0.0", JSON.stringify({ providers: ["openai"] }),
    ]);
    const claimed = await db.query<{ claim: {
      command_id: string; model: string; provider: string;
      execution_admission: { id: string; model: string; provider: string };
      initial_context: {
        envelope_id: string; input_sha256: string;
        items: Array<{ content_text: string | null }>;
      };
    } | null }>(`
      select public.claim_phase1c_run_by_command_v3(
        $1, 'openai', 'gpt-5.3-codex', 120, $2::uuid, 3
      ) as claim
    `, ["grok-alternate-model-worker", submission.rows[0]!.command_id]);
    expect(claimed.rows[0]!.claim).toMatchObject({
      command_id: submission.rows[0]!.command_id,
      model: alternateCodexModel,
      provider: "openai",
      execution_admission: {
        model: alternateCodexModel,
        provider: "openai",
      },
      initial_context: {
        envelope_id: initialContext.rows[0]!.result.envelope.id,
        input_sha256: initialContext.rows[0]!.result.envelope.input_sha256,
      },
    });
    const phaseContextJson = JSON.stringify(claimed.rows[0]!.claim!.initial_context);
    expect(phaseContextJson).toContain(initialContextText);
    expect(phaseContextJson).not.toContain(followUpText);

    await resetRole(db);
    const beforeStaleReplay = await db.query<{
      bridges: number; commands: number; guards: number; runs: number; tasks: number;
    }>(`
      select
        (select count(*)::integer from public.graph_phase1c_bridges
          where graph_id = $1) as bridges,
        (select count(*)::integer from public.commands
          where id = $2) as commands,
        (select count(*)::integer from public.grok_phase1c_submission_guards) as guards,
        (select count(*)::integer from public.agent_runs
          where command_id = $2) as runs,
        (select count(*)::integer from public.tasks
          where command_id = $2) as tasks
    `, [launched.rows[0].graph_id, submission.rows[0]!.command_id]);
    await db.query(
      "update public.bot_assignments set model = 'gpt-5.5-codex' where id = $1",
      [codexAssignmentId],
    );
    await assumeRole(db, "authenticated", ownerId);
    await expect(db.query(
      `select * from public.submit_and_attach_graph_phase1c_command($1::uuid, $2::jsonb)`,
      [bridge.rows[0]!.bridge_id, JSON.stringify(phase1CParameters)],
    )).rejects.toThrow(/admission is stale|assignment admission is stale/i);
    await resetRole(db);
    const afterStaleReplay = await db.query<{
      bridges: number; commands: number; guards: number; runs: number; tasks: number;
    }>(`
      select
        (select count(*)::integer from public.graph_phase1c_bridges
          where graph_id = $1) as bridges,
        (select count(*)::integer from public.commands
          where id = $2) as commands,
        (select count(*)::integer from public.grok_phase1c_submission_guards) as guards,
        (select count(*)::integer from public.agent_runs
          where command_id = $2) as runs,
        (select count(*)::integer from public.tasks
          where command_id = $2) as tasks
    `, [launched.rows[0].graph_id, submission.rows[0]!.command_id]);
    expect(afterStaleReplay.rows[0]).toEqual(beforeStaleReplay.rows[0]);

    await expect(db.query(
      "update public.grok_execution_admissions set model = model where graph_id = $1",
      [launched.rows[0].graph_id],
    )).rejects.toThrow(/immutable/i);
  });

  it("keeps every table private even from the BYPASSRLS service role", async () => {
    const tables = [
      "grok_sessions", "grok_messages", "grok_task_links", "grok_graph_launches",
      "grok_events", "grok_artifact_links", "grok_control_intents",
      "grok_execution_admissions", "grok_specialist_admissions",
    ];
    for (const role of ["anon", "authenticated", "service_role"] as const) {
      await assumeRole(db, role, role === "authenticated" ? ownerId : null);
      for (const table of tables) {
        await expect(
          db.query(`select * from public.${table}`),
          `${role} could read ${table} directly`,
        ).rejects.toThrow(/permission denied/i);
      }
    }
  });
});
