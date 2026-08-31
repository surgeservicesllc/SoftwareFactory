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
