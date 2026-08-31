// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMigratedDatabase } from "../support/migrated-database";

const ownerId = "00000000-0000-4000-8000-00000000c101";
const memberId = "00000000-0000-4000-8000-00000000c102";
const organizationId = "10000000-0000-4000-8000-00000000c101";
const projectId = "20000000-0000-4000-8000-00000000c101";
const connectionId = "30000000-0000-4000-8000-00000000c101";
const unlinkedConnectionId = "30000000-0000-4000-8000-00000000c102";

type ApplicationRole = "anon" | "authenticated" | "service_role";

async function assumeRole(db: PGlite, role: ApplicationRole, userId: string | null = null) {
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

function implicitItems(extra: readonly Record<string, unknown>[] = []) {
  return [
    { kind: "project", label: "Context Project", media_type: null, source_url: null,
      repository_path: null, integration_id: null, content_text: null, byte_size: 0, state: "reference_only" },
    { kind: "repository", label: "factory/context", media_type: null, source_url: null,
      repository_path: "main", integration_id: null, content_text: null, byte_size: 0, state: "reference_only" },
    ...extra,
  ];
}

describe("Grok context envelopes", () => {
  let db: PGlite;
  let key = 0;

  async function createSession() {
    key += 1;
    await assumeRole(db, "authenticated", ownerId);
    const session = await db.query<{ id: string; last_event_sequence: number }>(
      "select * from public.create_grok_session($1::uuid,$2::uuid,$3::text,$4::text)",
      [organizationId, projectId, `Context session ${key}`, `context-session-${key.toString().padStart(4, "0")}`],
    );
    const message = await db.query<{ id: string }>(
      "select * from public.append_grok_user_message($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text,0,null)",
      [organizationId, session.rows[0].id, "Review the attached context", { schemaVersion: 1, kind: "grok.user_prompt" }, `context-user-${key.toString().padStart(4, "0")}`],
    );
    return { sessionId: session.rows[0].id, messageId: message.rows[0].id };
  }

  async function recordAsServer(input: {
    sessionId: string;
    messageId: string;
    items: readonly Record<string, unknown>[];
    idempotencyKey: string;
    expectedEventSequence: number;
  }) {
    await assumeRole(db, "service_role");
    const result = await db.query<{ result: Record<string, unknown> }>(
      `select public.record_grok_context_envelope_as_server(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::jsonb,$7::text,$8::bigint,false
      ) as result`,
      [organizationId, ownerId, projectId, input.sessionId, input.messageId,
        JSON.stringify(input.items), input.idempotencyKey, input.expectedEventSequence],
    );
    return result.rows[0].result;
  }

  beforeAll(async () => {
    db = await createMigratedDatabase();
    await db.exec(`
      insert into auth.users (id, email) values
        ('${ownerId}', 'context-owner@example.com'),
        ('${memberId}', 'context-member@example.com');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Context Organization', 'context-organization', '${ownerId}');
      insert into public.organization_members (organization_id, user_id, role, created_by)
      values ('${organizationId}', '${memberId}', 'member', '${ownerId}')
      on conflict (organization_id, user_id) do update set role = excluded.role;
      insert into public.projects (
        id, organization_id, name, status, github_repository, default_branch, created_by
      ) values (
        '${projectId}', '${organizationId}', 'Context Project', 'active',
        'factory/context', 'main', '${ownerId}'
      );
      insert into public.connections (
        id, organization_id, name, provider, status, secret_reference, created_by
      ) values
        ('${connectionId}', '${organizationId}', 'Linked GitHub', 'github', 'connected', 'env://CONTEXT_GITHUB', '${ownerId}'),
        ('${unlinkedConnectionId}', '${organizationId}', 'Unlinked GitHub', 'github', 'connected', 'env://OTHER_GITHUB', '${ownerId}');
      insert into public.project_connections (
        organization_id, project_id, connection_id, is_primary, created_by
      ) values ('${organizationId}', '${projectId}', '${connectionId}', true, '${ownerId}');
    `);
  });

  afterAll(async () => {
    await db?.close();
  });

  it("records bounded multi-kind context, immutable audit, safe preview, and exact replay", async () => {
    const identity = await createSession();
    const items = implicitItems([
      { kind: "file", label: "requirements.md", media_type: "text/markdown", source_url: null,
        repository_path: null, integration_id: null, content_text: "# Requirements", byte_size: 14, state: "captured" },
      { kind: "url", label: "Design", media_type: null, source_url: "https://docs.example.com/design",
        repository_path: null, integration_id: null, content_text: null, byte_size: 0, state: "reference_only" },
      { kind: "image", label: "Wireframe", media_type: null, source_url: "https://images.example.com/wireframe.png",
        repository_path: null, integration_id: null, content_text: null, byte_size: 0, state: "reference_only" },
      { kind: "repository", label: "Route", media_type: null, source_url: null,
        repository_path: "app/api/route.ts", integration_id: null, content_text: null, byte_size: 0, state: "reference_only" },
      { kind: "integration", label: "GitHub source", media_type: null, source_url: null,
        repository_path: null, integration_id: connectionId, content_text: null, byte_size: 0, state: "reference_only" },
    ]);
    const first = await recordAsServer({ ...identity, items, idempotencyKey: "context-envelope-0001", expectedEventSequence: 2 });
    const replay = await recordAsServer({ ...identity, items, idempotencyKey: "context-envelope-0001", expectedEventSequence: 2 });
    expect(first).toMatchObject({ replayed: false, envelope: { item_count: 7, total_bytes: 14 } });
    expect(replay).toMatchObject({ replayed: true, envelope: { id: (first.envelope as { id: string }).id } });

    await assumeRole(db, "authenticated", ownerId);
    const listed = await db.query<{ context: Array<Record<string, unknown>> }>(
      "select public.list_grok_context_envelopes($1::uuid,$2::uuid,64) as context",
      [organizationId, identity.sessionId],
    );
    expect(listed.rows[0].context).toEqual([
      expect.objectContaining({
        item_count: 7,
        items: expect.arrayContaining([
          expect.objectContaining({ kind: "file", text_preview: "# Requirements" }),
          expect.objectContaining({ kind: "image", state: "reference_only", text_preview: null }),
        ]),
      }),
    ]);
    await resetRole(db);
    const event = await db.query<{ event_type: string; payload: Record<string, unknown> }>(
      "select event_type,payload from public.grok_events where session_id=$1 and event_type='context.recorded'",
      [identity.sessionId],
    );
    expect(event.rows).toHaveLength(1);
    expect(event.rows[0].payload).toMatchObject({ itemCount: 7, totalBytes: 14, workerWoken: false, executionStarted: false });
    expect(JSON.stringify(event.rows[0].payload)).not.toContain("Requirements");
  });

  it("atomically appends a follow-up and marks the immutable-plan replan boundary", async () => {
    const identity = await createSession();
    await recordAsServer({ ...identity, items: implicitItems(), idempotencyKey: "context-envelope-0002", expectedEventSequence: 2 });
    await assumeRole(db, "service_role");
    const assistant = await db.query<{ id: string }>(
      "select * from public.append_grok_message_as_server($1::uuid,$2::uuid,'assistant',$3::text,$4::jsonb,$5::text,1,$6::uuid)",
      [organizationId, identity.sessionId, "The immutable plan is recorded.", { schemaVersion: 1, kind: "grok.plan", plan: {} }, "context-plan-0002", identity.messageId],
    );
    await assumeRole(db, "authenticated", ownerId);
    const followUp = await db.query<{ result: Record<string, unknown> }>(
      `select public.append_grok_follow_up_context(
        $1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::text,2,4,$7::uuid
      ) as result`,
      [organizationId, projectId, identity.sessionId, "Use the newer requirements.",
        JSON.stringify(implicitItems()), "context-followup-0002", assistant.rows[0].id],
    );
    expect(followUp.rows[0].result).toMatchObject({
      plan_changed: false,
      replan_required: true,
      message: { sequence_no: 3, role: "user", content: "Use the newer requirements." },
      envelope: { replan_required: true },
    });
    const replay = await db.query<{ result: Record<string, unknown> }>(
      `select public.append_grok_follow_up_context(
        $1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::text,2,4,$7::uuid
      ) as result`,
      [organizationId, projectId, identity.sessionId, "Use the newer requirements.",
        JSON.stringify(implicitItems()), "context-followup-0002", assistant.rows[0].id],
    );
    expect(replay.rows[0].result).toMatchObject({ replayed: true, plan_changed: false, replan_required: true });
    await resetRole(db);
    const session = await db.query<{ last_message_sequence: number; last_event_sequence: number }>(
      "select last_message_sequence,last_event_sequence from public.grok_sessions where id=$1",
      [identity.sessionId],
    );
    expect(session.rows[0]).toEqual({ last_message_sequence: 3, last_event_sequence: 6 });
  });

  it("fails closed on non-owner access, secrets, unlinked integration, changed replay, and direct mutation", async () => {
    const identity = await createSession();
    const safe = implicitItems();
    await recordAsServer({ ...identity, items: safe, idempotencyKey: "context-envelope-0003", expectedEventSequence: 2 });

    await assumeRole(db, "authenticated", memberId);
    await expect(db.query(
      "select public.list_grok_context_envelopes($1::uuid,$2::uuid,64)",
      [organizationId, identity.sessionId],
    )).rejects.toThrow(/not_found/i);
    await expect(db.query(
      "select * from public.grok_context_envelopes where session_id=$1",
      [identity.sessionId],
    )).rejects.toThrow(/permission denied/i);

    await expect(recordAsServer({ ...identity, items: implicitItems([{
      kind: "file", label: "env.txt", media_type: "text/plain", source_url: null,
      repository_path: null, integration_id: null, content_text: "API_KEY=sk-abcdefghijklmnopqrstuv",
      byte_size: 30, state: "captured",
    }]), idempotencyKey: "context-secret-0003", expectedEventSequence: 3 })).rejects.toThrow(/secret-shaped/i);
    await expect(recordAsServer({ ...identity, items: implicitItems([{
      kind: "integration", label: "Other", media_type: null, source_url: null,
      repository_path: null, integration_id: unlinkedConnectionId, content_text: null,
      byte_size: 0, state: "reference_only",
    }]), idempotencyKey: "context-link-0003", expectedEventSequence: 3 })).rejects.toThrow(/does not match/i);
    await expect(recordAsServer({ ...identity, items: [
      { ...safe[0], label: "Changed project" }, safe[1],
    ], idempotencyKey: "context-envelope-0003", expectedEventSequence: 3 })).rejects.toThrow(/different input/i);

    await resetRole(db);
    await expect(db.query(
      "update public.grok_context_envelopes set replan_required=true where session_id=$1",
      [identity.sessionId],
    )).rejects.toThrow(/immutable/i);
  });
});
