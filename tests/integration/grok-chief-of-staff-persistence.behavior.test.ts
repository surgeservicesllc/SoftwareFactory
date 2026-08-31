// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { budgetForTemplate, findTemplate } from "@/lib/graph/templates";

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

    // Service authority cannot substitute a member for the session's owner.
    await assumeRole(db, "service_role");
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
    await assumeRole(db, "service_role");
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
    await db.query("select * from public.set_graph_pause_as_member($1::uuid,$2::uuid,true)", [
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
      `select * from public.apply_grok_graph_control_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Pause in one atomic boundary", "atomic-pause-0001"],
    );
    expect(applied.rows).toHaveLength(1);
    expect(applied.rows[0]).toMatchObject({ replayed: false, state: "applied" });
    const replay = await db.query<{ intent_id: string; replayed: boolean; state: string }>(
      `select * from public.apply_grok_graph_control_as_owner(
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
      `select * from public.apply_grok_graph_control_as_owner(
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
      `select * from public.apply_grok_graph_control_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'resume',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Resume requested before later pause", "ordered-resume-0001"],
    )).rejects.toThrow(/grok_control_superseded/i);
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
    await db.query("select * from public.set_graph_pause_as_member($1::uuid,$2::uuid,true)", [
      organizationId, graph.id,
    ]);
    await expect(db.query(
      `select * from public.apply_grok_graph_control_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'resume',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Resume before a direct pause", "ambiguous-resume-0001"],
    )).rejects.toThrow(/grok_control_recovery_ambiguous/i);

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

  it("resolves a requested intent without rerunning an already-committed action", async () => {
    const { session } = await createSession("Resolution-lost recovery");
    const graph = await createControlGraph(session.id, "Resolve the committed resume");
    await assumeRole(db, "authenticated", ownerId);
    await db.query("select * from public.set_graph_pause_as_member($1::uuid,$2::uuid,true)", [
      organizationId, graph.id,
    ]);
    const requested = await db.query<{ id: string }>(
      `select * from public.request_grok_control_intent(
         $1::uuid,$2::uuid,'graph',$3::uuid,'resume',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Resume committed before resolution", "committed-resume-0001"],
    );
    await db.query("select * from public.set_graph_pause_as_member($1::uuid,$2::uuid,false)", [
      organizationId, graph.id,
    ]);
    const recovered = await db.query<{ intent_id: string; replayed: boolean; state: string }>(
      `select * from public.apply_grok_graph_control_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'resume',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Resume committed before resolution", "committed-resume-0001"],
    );
    expect(recovered.rows[0]).toMatchObject({
      intent_id: requested.rows[0].id, replayed: true, state: "applied",
    });

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
    expect(state.rows[0]).toEqual({
      pause_requested_at: null, state: "applied", pause_events: 2, applied_events: 1,
    });
  });

  it("rejects applied replay after an opposite direct Pause or Resume", async () => {
    const { session } = await createSession("Applied replay state guard");
    const graph = await createControlGraph(session.id, "Reject superseded applied keys");
    await assumeRole(db, "authenticated", ownerId);
    await db.query(
      `select * from public.apply_grok_graph_control_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id, "Atomic pause", "state-pause-0001"],
    );
    await db.query("select * from public.set_graph_pause_as_member($1::uuid,$2::uuid,false)", [
      organizationId, graph.id,
    ]);
    await expect(db.query(
      `select * from public.apply_grok_graph_control_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id, "Atomic pause", "state-pause-0001"],
    )).rejects.toThrow(/grok_control_superseded/i);

    await db.query("select * from public.set_graph_pause_as_member($1::uuid,$2::uuid,true)", [
      organizationId, graph.id,
    ]);
    await db.query(
      `select * from public.apply_grok_graph_control_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'resume',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id, "Atomic resume", "state-resume-0001"],
    );
    await db.query("select * from public.set_graph_pause_as_member($1::uuid,$2::uuid,true)", [
      organizationId, graph.id,
    ]);
    await expect(db.query(
      `select * from public.apply_grok_graph_control_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'resume',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id, "Atomic resume", "state-resume-0001"],
    )).rejects.toThrow(/grok_control_superseded/i);
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
      `select * from public.apply_grok_graph_control_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id, "Pause before stopping", "withdrawn-pause-0001"],
    );
    await db.query("select * from public.withdraw_graph_as_member($1::uuid,$2::uuid,$3::text)", [
      organizationId, graph.id, "Permanently stop after pausing",
    ]);
    await expect(db.query(
      `select * from public.apply_grok_graph_control_as_owner(
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
      `select * from public.apply_grok_graph_control_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, wrong.session.id, graph.id,
        "Wrong session cannot pause", "wrong-session-pause-0001"],
    )).rejects.toThrow(/grok_control_target_not_found/i);
    await expect(db.query(
      `select * from public.apply_grok_graph_control_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'pause',$4::text,$5::text
       )`,
      [organizationId, linked.session.id, unlinked.rows[0].id,
        "Unlinked graph cannot pause", "unlinked-graph-pause-0001"],
    )).rejects.toThrow(/grok_control_target_not_found/i);

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
      `select * from public.apply_grok_graph_control_as_owner(
         $1::uuid,$2::uuid,$3::uuid,'resume',$4::text,$5::text
       )`,
      [organizationId, session.id, graph.id,
        "Fresh resume is unavailable", "unavailable-resume-0001"],
    )).rejects.toThrow(/grok_control_not_available/i);
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
      "select * from public.apply_grok_graph_control_as_owner($1::uuid,$2::uuid,$3::uuid,'pause',$4,$5)",
      [organizationId, session.id, graph.id, "Member pause denied", "member-pause-0001"],
    )).rejects.toThrow(/owner access is required/i);
    await assumeRole(db, "authenticated", outsiderId);
    await expect(db.query(
      "select * from public.apply_grok_graph_control_as_owner($1::uuid,$2::uuid,$3::uuid,'pause',$4,$5)",
      [organizationId, session.id, graph.id, "Outsider pause denied", "outsider-pause-0001"],
    )).rejects.toThrow(/owner access is required/i);
    await expect(db.query(
      "select * from public.apply_grok_graph_control_as_owner($1::uuid,$2::uuid,$3::uuid,'pause',$4,$5)",
      [outsiderOrganizationId, session.id, graph.id,
        "Cross tenant pause denied", "cross-tenant-pause-0001"],
    )).rejects.toThrow(/not_found/i);
    await assumeRole(db, "anon");
    await expect(db.query(
      "select * from public.apply_grok_graph_control_as_owner($1::uuid,$2::uuid,$3::uuid,'pause',$4,$5)",
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
       where proc.oid = 'public.apply_grok_graph_control_as_owner(uuid,uuid,uuid,text,text,text)'::regprocedure
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
        has_function_privilege('anon', 'public.apply_grok_graph_control_as_owner(uuid,uuid,uuid,text,text,text)', 'EXECUTE')
          as anon_execute,
        has_function_privilege('authenticated', 'public.apply_grok_graph_control_as_owner(uuid,uuid,uuid,text,text,text)', 'EXECUTE')
          as authenticated_execute,
        has_function_privilege('service_role', 'public.apply_grok_graph_control_as_owner(uuid,uuid,uuid,text,text,text)', 'EXECUTE')
          as service_execute
    `);
    expect(acl.rows[0]).toEqual({
      anon_execute: false,
      authenticated_execute: true,
      service_execute: false,
    });
  });

  it("keeps every table private even from the BYPASSRLS service role", async () => {
    const tables = [
      "grok_sessions", "grok_messages", "grok_task_links", "grok_graph_launches",
      "grok_events", "grok_artifact_links", "grok_control_intents",
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
