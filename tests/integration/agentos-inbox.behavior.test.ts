// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Inbox behaviour, against the real migrated schema.
 *
 * `docs/AGENTOS_SPEC.md` §22 asks for two: a reply resumes a waiting session
 * with the answer in context, and a multiple-choice message stores the
 * selected choice. The rest of these cover the states that make "resume on
 * answer" well defined at all.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-00000000b001";
const outsiderId = "00000000-0000-4000-8000-00000000b002";
const organizationId = "10000000-0000-4000-8000-00000000b001";
const otherOrganizationId = "10000000-0000-4000-8000-00000000b002";
const projectId = "40000000-0000-4000-8000-00000000b001";

let agentId = "";
let runId = "";

async function assumeRole(db: PGlite, role: "anon" | "authenticated" | "service_role", userId: string | null = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

async function ask(db: PGlite, body: string, choices: string[] = []) {
  const kind = choices.length > 0 ? "multiple_choice" : "text";
  const { rows } = await db.query<{ id: string }>(
    `insert into public.agentos_inbox_messages
       (organization_id, author, kind, agent_id, agent_run_id, body, choices)
     values ($1, 'agent', $2::public.agentos_inbox_kind, $3, $4, $5, $6::text[])
     returning id`,
    [organizationId, kind, agentId, runId, body, choices],
  );
  return rows[0].id;
}

describe("AgentOS inbox", { timeout: 120_000 }, () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`
      create schema if not exists auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create or replace function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
      $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);

    const files = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Inbox Factory', 'inbox-factory', '${ownerId}'),
        ('${otherOrganizationId}', 'Other', 'other-inbox', '${outsiderId}');
      insert into public.projects (id, organization_id, name, status, default_branch, created_by)
      values ('${projectId}', '${organizationId}', 'Storefront', 'active', 'main', '${ownerId}');
    `);

    const agent = await db.query<{ id: string }>(
      `insert into public.agents (organization_id, name, role, description, status, created_by)
       values ('${organizationId}', 'plan', 'orchestrator', 'Plans', 'idle', '${ownerId}')
       returning id`,
    );
    agentId = agent.rows[0].id;

    const task = await db.query<{ id: string }>(
      `insert into public.tasks (organization_id, project_id, title, status, risk_level, created_by)
       values ('${organizationId}', '${projectId}', 'Add a table', 'in_progress', 'green', '${ownerId}')
       returning id`,
    );

    const run = await db.query<{ id: string }>(
      `insert into public.agent_runs (organization_id, project_id, task_id, agent_id, status)
       values ('${organizationId}', '${projectId}', '${task.rows[0].id}', '${agentId}', 'running')
       returning id`,
    );
    runId = run.rows[0].id;
  });

  afterAll(async () => {
    await db.close();
  });

  it("holds a run to one open question so resuming is unambiguous", async () => {
    await resetRole(db);
    await ask(db, "Which database should this use?");

    // A second open question would make "answering resumes the session"
    // undefined: answering one says nothing about whether to continue.
    await expect(ask(db, "And which region?")).rejects.toThrow(/one_open_question_per_run/);

    await db.exec("delete from public.agentos_inbox_messages");
  });

  it("reports a run with an open question as waiting", async () => {
    await resetRole(db);
    const messageId = await ask(db, "Should I use the existing table or add one?");

    await assumeRole(db, "authenticated", ownerId);
    const before = await db.query<{ state: { waitingOnHuman: boolean; openQuestionCount: number } }>(
      "select public.agentos_run_inbox_state($1::uuid) as state",
      [runId],
    );
    expect(before.rows[0].state).toMatchObject({ waitingOnHuman: true, openQuestionCount: 1 });

    await db.query("select public.agentos_answer_inbox_message($1::uuid, $2, null)", [
      messageId,
      "Add a new table.",
    ]);

    const after = await db.query<{
      state: { waitingOnHuman: boolean; latestAnswer: { answerBody: string; question: string } };
    }>("select public.agentos_run_inbox_state($1::uuid) as state", [runId]);
    await resetRole(db);

    // The answer comes back with the question, so a resumed session has the
    // context rather than a bare string.
    expect(after.rows[0].state.waitingOnHuman).toBe(false);
    expect(after.rows[0].state.latestAnswer).toMatchObject({
      answerBody: "Add a new table.",
      question: "Should I use the existing table or add one?",
    });

    await resetRole(db);
    await db.exec("delete from public.agentos_inbox_messages");
  });

  it("stores a multiple choice selection and resolves it to its label", async () => {
    await resetRole(db);
    const messageId = await ask(db, "Which branch strategy?", ["trunk", "release-branch", "git-flow"]);

    await assumeRole(db, "authenticated", ownerId);
    await db.query("select public.agentos_answer_inbox_message($1::uuid, null, $2::smallint)", [
      messageId,
      1,
    ]);

    const { rows } = await db.query<{ state: { latestAnswer: { selectedChoice: string } } }>(
      "select public.agentos_run_inbox_state($1::uuid) as state",
      [runId],
    );
    await resetRole(db);

    // The label, not the index. A runner should never re-derive what 1 meant.
    expect(rows[0].state.latestAnswer.selectedChoice).toBe("release-branch");

    const stored = await db.query<{ selected_choice_index: number }>(
      "select selected_choice_index from public.agentos_inbox_messages where id = $1",
      [messageId],
    );
    expect(stored.rows[0].selected_choice_index).toBe(1);

    await db.exec("delete from public.agentos_inbox_messages");
  });

  it("refuses a choice that was never offered", async () => {
    await resetRole(db);
    const messageId = await ask(db, "Pick one", ["a", "b"]);

    await assumeRole(db, "authenticated", ownerId);
    // Out of range in both directions, and the free-text answer to a radio
    // question that would otherwise resume with an option nobody presented.
    await expect(db.query(
      "select public.agentos_answer_inbox_message($1::uuid, null, $2::smallint)",
      [messageId, 2],
    )).rejects.toThrow(/was not offered/);
    await expect(db.query(
      "select public.agentos_answer_inbox_message($1::uuid, null, $2::smallint)",
      [messageId, -1],
    )).rejects.toThrow(/was not offered/);
    await expect(db.query(
      "select public.agentos_answer_inbox_message($1::uuid, $2, null)",
      [messageId, "something else entirely"],
    )).rejects.toThrow(/a choice must be selected/);
    await resetRole(db);

    await db.exec("delete from public.agentos_inbox_messages");
  });

  it("refuses a second answer", async () => {
    await resetRole(db);
    const messageId = await ask(db, "Proceed?");

    await assumeRole(db, "authenticated", ownerId);
    await db.query("select public.agentos_answer_inbox_message($1::uuid, $2, null)", [messageId, "Yes"]);
    // A second answer would resume a session that has already moved on.
    await expect(db.query(
      "select public.agentos_answer_inbox_message($1::uuid, $2, null)",
      [messageId, "Actually no"],
    )).rejects.toThrow(/no longer open/);
    await resetRole(db);

    await db.exec("delete from public.agentos_inbox_messages");
  });

  it("refuses shapes that would render as an unanswerable question", async () => {
    await resetRole(db);
    // Choices on a text message.
    await expect(db.query(
      `insert into public.agentos_inbox_messages (organization_id, author, kind, body, choices)
       values ($1, 'agent', 'text', 'Hi', array['a','b'])`,
      [organizationId],
    )).rejects.toThrow(/choices_match_kind/);

    // A single-option or empty radio question.
    await expect(db.query(
      `insert into public.agentos_inbox_messages (organization_id, author, kind, body, choices)
       values ($1, 'agent', 'multiple_choice', 'Pick', array['only'])`,
      [organizationId],
    )).rejects.toThrow(/choices_match_kind/);

    // A human message cannot be an open question addressed to itself.
    await expect(db.query(
      `insert into public.agentos_inbox_messages (organization_id, author, kind, body, status)
       values ($1, 'human', 'text', 'Note', 'open')`,
      [organizationId],
    )).rejects.toThrow(/human_message_not_open/);
  });

  it("keeps credentials out of the channel", async () => {
    await resetRole(db);
    await expect(db.query(
      `insert into public.agentos_inbox_messages (organization_id, author, kind, body)
       values ($1, 'agent', 'text', $2)`,
      [organizationId, 'Use this token: ghp_abcdefghijklmnopqrstuvwxyz012345'],
    )).rejects.toThrow(/body_no_secret/);
  });

  it("refuses to answer or inspect another organization's message", async () => {
    await resetRole(db);
    const messageId = await ask(db, "Internal question");

    await assumeRole(db, "authenticated", outsiderId);
    await expect(db.query(
      "select public.agentos_answer_inbox_message($1::uuid, $2, null)",
      [messageId, "peeking"],
    )).rejects.toThrow(/membership is required/);
    await expect(db.query(
      "select public.agentos_run_inbox_state($1::uuid)",
      [runId],
    )).rejects.toThrow(/membership is required/);

    // And RLS hides the row entirely.
    const visible = await db.query("select id from public.agentos_inbox_messages");
    expect(visible.rows).toEqual([]);
    await resetRole(db);

    await db.exec("delete from public.agentos_inbox_messages");
  });

  it("gives browsers read-only access and no service_role table grants", async () => {
    await resetRole(db);
    const { rows } = await db.query<{ ins: boolean; upd: boolean; del: boolean; svc: boolean }>(`
      select pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT') as ins,
             pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE') as upd,
             pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE') as del,
             pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT') as svc
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'agentos_inbox_messages'
    `);

    expect(rows[0]).toMatchObject({ ins: false, upd: false, del: false, svc: false });
  });
});
