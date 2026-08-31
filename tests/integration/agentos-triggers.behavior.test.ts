// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

/**
 * Trigger behaviour against the real migrated schema.
 *
 * `docs/AGENTOS_SPEC.md` §22 asks that a bad secret produce nothing and a good
 * one produce a task. The rest cover what a public endpoint invites: replays,
 * deliveries to a disabled trigger, and payloads that carry credentials.
 */


const ownerId = "00000000-0000-4000-8000-00000000e001";
const outsiderId = "00000000-0000-4000-8000-00000000e002";
const organizationId = "10000000-0000-4000-8000-00000000e001";
const otherOrganizationId = "10000000-0000-4000-8000-00000000e002";
const projectId = "40000000-0000-4000-8000-00000000e001";

let agentId = "";
let triggerId = "";

async function asServiceRole(db: PGlite) {
  await db.exec("reset role");
  await db.exec("set role service_role");
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

async function deliver(db: PGlite, options: {
  deliveryId: string;
  signatureValid?: boolean;
  payload?: Record<string, unknown>;
}) {
  const { deliveryId, signatureValid = true, payload = {} } = options;
  await asServiceRole(db);
  const { rows } = await db.query<{ r: { status: string; taskId: string | null; sessionStarted: boolean; blocker: string } }>(
    "select public.agentos_record_trigger_delivery($1::uuid, $2, $3::jsonb, $4) as r",
    [triggerId, deliveryId, JSON.stringify(payload), signatureValid],
  );
  await resetRole(db);
  return rows[0].r;
}

async function taskCount(db: PGlite) {
  await resetRole(db);
  const { rows } = await db.query<{ count: string }>(
    "select count(*) as count from public.tasks where assigned_agent_id = $1",
    [agentId],
  );
  return Number(rows[0].count);
}

describe("AgentOS triggers", { timeout: 120_000 }, () => {
  let db: PGlite;

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Trigger Factory', 'trigger-factory', '${ownerId}'),
        ('${otherOrganizationId}', 'Other', 'other-trigger', '${outsiderId}');
      insert into public.projects (id, organization_id, name, status, default_branch, created_by)
      values ('${projectId}', '${organizationId}', 'Storefront', 'active', 'main', '${ownerId}');
    `);

    const agent = await db.query<{ id: string }>(
      `insert into public.agents (organization_id, name, role, description, status, created_by)
       values ('${organizationId}', 'customer-support', 'custom', 'Support', 'idle', '${ownerId}')
       returning id`,
    );
    agentId = agent.rows[0].id;

    const trigger = await db.query<{ id: string }>(
      `insert into public.agentos_triggers
         (organization_id, project_id, agent_id, name, display_name, public_slug,
          secret_env_var, job_prompt, enabled, created_by)
       values ($1, $2, $3, 'support-inbound', 'Support inbound', $4,
               'SUPPORT_WEBHOOK_SECRET', 'Read the conversation and assign an owner.',
               true, $5)
       returning id`,
      [organizationId, projectId, agentId, "a".repeat(32), ownerId],
    );
    triggerId = trigger.rows[0].id;
  });

  afterAll(async () => {
    await db.close();
  });

  it("creates a task for a valid delivery and starts no session", async () => {
    const before = await taskCount(db);
    const result = await deliver(db, { deliveryId: "d-1", payload: { subject: "Refund" } });

    expect(result.status).toBe("accepted");
    expect(result.taskId).toBeTruthy();
    expect(await taskCount(db)).toBe(before + 1);
    // Nothing dispatches work in this phase, and it says so rather than
    // leaving a caller to infer it.
    expect(result.sessionStarted).toBe(false);
    expect(result.blocker).toBe("TRIGGER_RUNNER_NOT_CONNECTED");
  });

  it("assigns the work to the trigger's own agent, and no other", async () => {
    const result = await deliver(db, { deliveryId: "d-2" });
    await resetRole(db);
    const { rows } = await db.query<{ assigned_agent_id: string }>(
      "select assigned_agent_id from public.tasks where id = $1",
      [result.taskId],
    );
    // A public endpoint cannot widen what runs: the scoped agent is fixed on
    // the trigger, not chosen by the sender.
    expect(rows[0].assigned_agent_id).toBe(agentId);
  });

  it("produces nothing for a bad signature", async () => {
    const before = await taskCount(db);
    const result = await deliver(db, { deliveryId: "d-3", signatureValid: false });

    expect(result.status).toBe("rejected_signature");
    expect(result.taskId).toBeNull();
    expect(await taskCount(db)).toBe(before);
  });

  it("records a replay as a duplicate rather than doing the work twice", async () => {
    await deliver(db, { deliveryId: "replay-1" });
    const before = await taskCount(db);
    const second = await deliver(db, { deliveryId: "replay-1" });

    expect(second.status).toBe("duplicate");
    expect(second.taskId).toBeNull();
    expect(await taskCount(db)).toBe(before);
  });

  it("refuses a correctly signed delivery to a disabled trigger", async () => {
    await resetRole(db);
    await db.query("update public.agentos_triggers set enabled = false where id = $1", [triggerId]);

    const before = await taskCount(db);
    const result = await deliver(db, { deliveryId: "d-disabled" });
    expect(result.status).toBe("rejected_disabled");
    expect(await taskCount(db)).toBe(before);

    await resetRole(db);
    await db.query("update public.agentos_triggers set enabled = true where id = $1", [triggerId]);
  });

  it("refuses to store a payload that still carries a credential key", async () => {
    // The stored payload is what a prompt will quote. A sensitive key here
    // means sanitization was skipped upstream.
    await asServiceRole(db);
    await expect(db.query(
      "select public.agentos_record_trigger_delivery($1::uuid, $2, $3::jsonb, true)",
      [triggerId, "d-secret", JSON.stringify({ api_key: "abcdef1234567890" })],
    )).rejects.toThrow(/payload_no_secret/);
    await resetRole(db);
  });

  it("refuses a privileged or browser-visible signing secret reference", async () => {
    await resetRole(db);
    const privileged = ["SUPABASE_SERVICE_ROLE_KEY", "GITHUB_APP_PRIVATE_KEY", "NEXT_PUBLIC_THING"];
    for (const [index, name] of privileged.entries()) {
      await expect(db.query(
        `insert into public.agentos_triggers
           (organization_id, project_id, agent_id, name, display_name, public_slug,
            secret_env_var, job_prompt, created_by)
         values ($1, $2, $3, $4, 'X', $5, $6, 'Do a thing', $7)`,
        // A distinct slug each time, so uniqueness cannot mask the constraint
        // actually under test.
        [organizationId, projectId, agentId, `t-privileged-${index}`,
         `b${index}`.padEnd(32, "c"), name, ownerId],
      ), name).rejects.toThrow(/secret_not_privileged/);
    }
  });

  it("requires an automation to name work it can actually do", async () => {
    await resetRole(db);
    // Neither a template nor an agent-with-prompt: it would fire into nothing.
    await expect(db.query(
      `insert into public.agentos_automations
         (organization_id, project_id, name, display_name, cron_expression, created_by)
       values ($1, $2, 'empty', 'Empty', '0 9 * * 1', $3)`,
      [organizationId, projectId, ownerId],
    )).rejects.toThrow(/has_work/);

    // An agent without a prompt is equally unrunnable.
    await expect(db.query(
      `insert into public.agentos_automations
         (organization_id, project_id, agent_id, name, display_name, cron_expression, created_by)
       values ($1, $2, $3, 'half', 'Half', '0 9 * * 1', $4)`,
      [organizationId, projectId, agentId, ownerId],
    )).rejects.toThrow(/has_work/);

    // A complete one is accepted.
    await db.query(
      `insert into public.agentos_automations
         (organization_id, project_id, agent_id, name, display_name, cron_expression,
          job_prompt, created_by)
       values ($1, $2, $3, 'weekly-summary', 'Weekly summary', '0 9 * * 1',
               'Summarize the inbox.', $4)`,
      [organizationId, projectId, agentId, ownerId],
    );
  });

  it("hides another organization's triggers and deliveries", async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [outsiderId]);
    await db.exec("set role authenticated");

    expect((await db.query("select id from public.agentos_triggers")).rows).toEqual([]);
    expect((await db.query("select id from public.agentos_trigger_deliveries")).rows).toEqual([]);
    await resetRole(db);
  });

  it("keeps trigger tables read-only for browsers", async () => {
    await resetRole(db);
    const { rows } = await db.query<{ ins: boolean; upd: boolean; del: boolean }>(`
      select bool_or(pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT')) as ins,
             bool_or(pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE')) as upd,
             bool_or(pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE')) as del
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and c.relname in ('agentos_triggers','agentos_trigger_deliveries','agentos_automations')
    `);
    expect(rows[0]).toMatchObject({ ins: false, upd: false, del: false });
  });
});
