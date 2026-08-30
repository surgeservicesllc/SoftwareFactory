// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsRoot = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000e101";
const memberId = "00000000-0000-4000-8000-00000000e103";
const outsiderId = "00000000-0000-4000-8000-00000000e102";
const organizationId = "10000000-0000-4000-8000-00000000e101";
const outsiderOrganizationId = "10000000-0000-4000-8000-00000000e102";
const projectId = "40000000-0000-4000-8000-00000000e101";

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
      insert into public.projects (id, organization_id, name, status, created_by) values
        ('${projectId}', '${organizationId}', 'Chief of Staff', 'active', '${ownerId}');
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

  it("persists a blocked plan without exposing a custom launcher or dispatching work", async () => {
    const { session } = await createSession("Plan without dispatch");
    await assumeRole(db, "authenticated", ownerId);
    const message = await db.query<MessageRow>(
      `select * from public.append_grok_user_message(
         $1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text,0,null
       )`,
      [organizationId, session.id, "Build the portal", "{}", "blocked-user-message-0001"],
    );
    await assumeRole(db, "service_role");
    await db.query<MessageRow>(
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
        "blocked-assistant-message-0001", message.rows[0].id],
    );

    await assumeRole(db, "authenticated", ownerId);
    const listed = await db.query<{ session_id: string; status: string }>(
      "select * from public.list_grok_sessions($1::uuid,$2::uuid,50,null,null)",
      [organizationId, projectId],
    );
    expect(listed.rows.find((row) => row.session_id === session.id)?.status).toBe("blocked");
    await expect(db.query(
      "select public.launch_grok_graph_for_session()",
    )).rejects.toThrow(/does not exist/i);

    await resetRole(db);
    const residue = await db.query<{
      graphs: number;
      graph_runs: number;
      node_runs: number;
      launches: number;
      links: number;
    }>(
      `select
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
           where session_id = $2) as links`,
      [projectId, session.id],
    );
    expect(residue.rows[0]).toEqual({
      graphs: 0,
      graph_runs: 0,
      node_runs: 0,
      launches: 0,
      links: 0,
    });
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
