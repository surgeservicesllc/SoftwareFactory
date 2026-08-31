// @vitest-environment node

import { createHash } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

/**
 * Goal rails, against the real migrated schema.
 *
 * `docs/AGENTOS_SPEC.md` §22 asks for two: each rail sets its own `stopped_*`
 * state and refuses to spawn, and a goal will not spawn before its definition
 * of done is approved.
 *
 * The rails exist because of the spec's own anecdote — a goal left running
 * overnight without a cap that cost $1000 — so "did it actually stop" is
 * asserted rather than assumed.
 */


const ownerId = "00000000-0000-4000-8000-00000000d001";
const memberId = "00000000-0000-4000-8000-00000000d002";
const organizationId = "10000000-0000-4000-8000-00000000d001";
const projectId = "40000000-0000-4000-8000-00000000d001";

const fingerprint = (seed: string) => createHash("sha256").update(seed).digest("hex");

async function assumeRole(db: PGlite, role: "authenticated", userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

describe("AgentOS goal rails", { timeout: 120_000 }, () => {
  let db: PGlite;

  async function newGoal(options: {
    items?: number;
    maxDurationMinutes?: number | null;
    stuckThreshold?: number;
  } = {}) {
    const { items = 2, maxDurationMinutes = null, stuckThreshold = 19 } = options;
    await resetRole(db);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.agentos_goals
         (organization_id, project_id, title, spec, status, max_duration_minutes,
          stuck_threshold, created_by)
       values ($1, $2, 'Ship search', 'Add search to the storefront.',
               'awaiting_dod_approval', $3, $4, $5)
       returning id`,
      [organizationId, projectId, maxDurationMinutes, stuckThreshold, ownerId],
    );
    const goalId = rows[0].id;
    for (let index = 1; index <= items; index += 1) {
      await db.query(
        `insert into public.agentos_goal_dod_items
           (organization_id, goal_id, item_index, description)
         values ($1, $2, $3, $4)`,
        [organizationId, goalId, index, `Checkbox ${index}`],
      );
    }
    return goalId;
  }

  async function decision(goalId: string) {
    await assumeRole(db, "authenticated", ownerId);
    const { rows } = await db.query<{ d: { blockers: string[]; maySpawn: boolean; repeatedFingerprintCount: number } }>(
      "select public.agentos_goal_spawn_decision($1::uuid) as d",
      [goalId],
    );
    await resetRole(db);
    return rows[0].d;
  }

  async function goalRow(goalId: string) {
    await resetRole(db);
    const { rows } = await db.query<{ status: string; stopped_reason: string | null; spent_usd: string }>(
      "select status, stopped_reason, spent_usd from public.agentos_goals where id = $1",
      [goalId],
    );
    return rows[0];
  }

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}');
      insert into public.organizations (id, name, slug, created_by)
      values ('${organizationId}', 'Goal Factory', 'goal-factory', '${ownerId}');
      insert into public.organization_members (organization_id, user_id, role, created_by)
      values ('${organizationId}', '${memberId}', 'member', '${ownerId}');
      insert into public.projects (id, organization_id, name, status, default_branch, created_by)
      values ('${projectId}', '${organizationId}', 'Storefront', 'active', 'main', '${ownerId}');
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("will not spawn before the definition of done is approved", async () => {
    const goalId = await newGoal();
    expect((await decision(goalId)).blockers).toContain("DOD_NOT_APPROVED");
  });

  it("requires a cap, or an explicit decision to run without one", async () => {
    const goalId = await newGoal();
    await assumeRole(db, "authenticated", ownerId);

    // Silence is not consent. The spec asks that a cap be hard to forget.
    await expect(db.query(
      "select public.agentos_approve_goal_dod($1::uuid, null, false)",
      [goalId],
    )).rejects.toThrow(/set a spend cap, or explicitly accept/);

    // Accepting uncapped is allowed, but records who chose it.
    await db.query("select public.agentos_approve_goal_dod($1::uuid, null, true)", [goalId]);
    const { rows } = await db.query<{ uncapped_spend_acknowledged_by: string }>(
      "select uncapped_spend_acknowledged_by from public.agentos_goals where id = $1",
      [goalId],
    );
    await resetRole(db);
    expect(rows[0].uncapped_spend_acknowledged_by).toBe(ownerId);
  });

  it("refuses to approve an empty definition of done", async () => {
    await resetRole(db);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.agentos_goals
         (organization_id, project_id, title, spec, status, created_by)
       values ($1, $2, 'Empty', 'No checkboxes.', 'awaiting_dod_approval', $3)
       returning id`,
      [organizationId, projectId, ownerId],
    );

    await assumeRole(db, "authenticated", ownerId);
    // Approving an empty definition means "finished" is immediately true and
    // the loop completes having done nothing.
    await expect(db.query(
      "select public.agentos_approve_goal_dod($1::uuid, 10.00, false)",
      [rows[0].id],
    )).rejects.toThrow(/at least one item/);
    await resetRole(db);
  });

  it("lets only an owner or administrator approve", async () => {
    const goalId = await newGoal();
    await assumeRole(db, "authenticated", memberId);
    await expect(db.query(
      "select public.agentos_approve_goal_dod($1::uuid, 10.00, false)",
      [goalId],
    )).rejects.toThrow(/only an owner or administrator/);
    await resetRole(db);
  });

  it("stops on the spend cap and reports it", async () => {
    const goalId = await newGoal();
    await assumeRole(db, "authenticated", ownerId);
    await db.query("select public.agentos_approve_goal_dod($1::uuid, 5.00, false)", [goalId]);

    await db.query(
      "select public.agentos_record_goal_iteration($1::uuid, 'senior-dev', 'Worked a bit', $2, 2.00)",
      [goalId, fingerprint("a")],
    );
    expect((await goalRow(goalId)).status).toBe("active");

    await assumeRole(db, "authenticated", ownerId);
    await db.query(
      "select public.agentos_record_goal_iteration($1::uuid, 'senior-dev', 'Worked more', $2, 3.50)",
      [goalId, fingerprint("b")],
    );
    await resetRole(db);

    const row = await goalRow(goalId);
    // Stopped at the moment it overran, not at the next spawn attempt, so a
    // human looking later sees a stopped goal rather than an active one.
    expect(row.status).toBe("stopped_spend");
    expect(row.stopped_reason).toMatch(/reached the cap/);
    expect((await decision(goalId)).blockers).toContain("GOAL_STOPPED_SPEND");
  });

  it("stops when the same iteration repeats to the threshold", async () => {
    const goalId = await newGoal({ stuckThreshold: 3 });
    await assumeRole(db, "authenticated", ownerId);
    await db.query("select public.agentos_approve_goal_dod($1::uuid, 100.00, false)", [goalId]);

    const stuck = fingerprint("no-movement");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await assumeRole(db, "authenticated", ownerId);
      await db.query(
        "select public.agentos_record_goal_iteration($1::uuid, 'plan', 'Same again', $2, 0.10)",
        [goalId, stuck],
      );
    }
    await resetRole(db);

    const row = await goalRow(goalId);
    expect(row.status).toBe("stopped_stuck");
    expect(row.stopped_reason).toMatch(/identical iterations/);
  });

  it("does not call genuine progress stuck", async () => {
    const goalId = await newGoal({ stuckThreshold: 3 });
    await assumeRole(db, "authenticated", ownerId);
    await db.query("select public.agentos_approve_goal_dod($1::uuid, 100.00, false)", [goalId]);

    for (const seed of ["step-1", "step-2", "step-3", "step-4"]) {
      await assumeRole(db, "authenticated", ownerId);
      await db.query(
        "select public.agentos_record_goal_iteration($1::uuid, 'plan', 'Moved forward', $2, 0.10)",
        [goalId, fingerprint(seed)],
      );
    }
    await resetRole(db);

    // Four iterations past a threshold of three, all distinct: the loop is
    // working, and stopping it here would be the rail misfiring.
    expect((await goalRow(goalId)).status).toBe("active");
  });

  it("stops on elapsed time", async () => {
    const goalId = await newGoal({ maxDurationMinutes: 60 });
    await assumeRole(db, "authenticated", ownerId);
    await db.query("select public.agentos_approve_goal_dod($1::uuid, 100.00, false)", [goalId]);
    await resetRole(db);

    // Backdate the start rather than waiting an hour.
    await db.query(
      "update public.agentos_goals set started_at = now() - interval '90 minutes' where id = $1",
      [goalId],
    );

    await assumeRole(db, "authenticated", ownerId);
    await db.query(
      "select public.agentos_record_goal_iteration($1::uuid, 'plan', 'Still going', $2, 0.10)",
      [goalId, fingerprint("t")],
    );
    await resetRole(db);

    const row = await goalRow(goalId);
    expect(row.status).toBe("stopped_time");
    expect(row.stopped_reason).toMatch(/against a limit of 60/);
  });

  it("completes when every checkbox is satisfied", async () => {
    const goalId = await newGoal({ items: 2 });
    await assumeRole(db, "authenticated", ownerId);
    await db.query("select public.agentos_approve_goal_dod($1::uuid, 100.00, false)", [goalId]);
    await resetRole(db);

    await db.query(
      `update public.agentos_goal_dod_items
          set satisfied = true, satisfied_at = now(), satisfied_by_iteration = 1
        where goal_id = $1`,
      [goalId],
    );

    await assumeRole(db, "authenticated", ownerId);
    await db.query(
      "select public.agentos_record_goal_iteration($1::uuid, 'senior-dev', 'Finished', $2, 1.00)",
      [goalId, fingerprint("done")],
    );
    await resetRole(db);

    expect((await goalRow(goalId)).status).toBe("completed");
    expect((await decision(goalId)).blockers).toContain("DEFINITION_OF_DONE_SATISFIED");
  });

  it("reports every tripped rail, not just the first", async () => {
    const goalId = await newGoal();
    // Unapproved and no runner: a caller fixing only the first would
    // otherwise be surprised by the next.
    const d = await decision(goalId);
    expect(d.maySpawn).toBe(false);
    expect(d.blockers).toEqual(expect.arrayContaining([
      "DOD_NOT_APPROVED", "GOAL_RUNNER_NOT_CONNECTED",
    ]));
  });

  it("never claims it may spawn, because nothing dispatches work yet", async () => {
    const goalId = await newGoal();
    await assumeRole(db, "authenticated", ownerId);
    await db.query("select public.agentos_approve_goal_dod($1::uuid, 100.00, false)", [goalId]);
    await resetRole(db);

    const d = await decision(goalId);
    expect(d.maySpawn).toBe(false);
    expect(d.blockers).toContain("GOAL_RUNNER_NOT_CONNECTED");
  });

  it("refuses iterations on a stopped goal", async () => {
    const goalId = await newGoal();
    await assumeRole(db, "authenticated", ownerId);
    await db.query("select public.agentos_approve_goal_dod($1::uuid, 1.00, false)", [goalId]);
    await db.query(
      "select public.agentos_record_goal_iteration($1::uuid, 'plan', 'Overrun', $2, 5.00)",
      [goalId, fingerprint("x")],
    );
    await expect(db.query(
      "select public.agentos_record_goal_iteration($1::uuid, 'plan', 'More', $2, 1.00)",
      [goalId, fingerprint("y")],
    )).rejects.toThrow(/does not accept iterations/);
    await resetRole(db);
  });

  it("keeps the progress log append-only", async () => {
    const goalId = await newGoal();
    await assumeRole(db, "authenticated", ownerId);
    await db.query("select public.agentos_approve_goal_dod($1::uuid, 100.00, false)", [goalId]);
    await db.query(
      "select public.agentos_record_goal_iteration($1::uuid, 'plan', 'One', $2, 0.10)",
      [goalId, fingerprint("p")],
    );
    await resetRole(db);

    // A loop that can rewrite its own history cannot be audited, and stuck
    // detection reads exactly this table.
    await expect(db.query(
      "update public.agentos_goal_progress set summary = 'rewritten' where goal_id = $1",
      [goalId],
    )).rejects.toThrow(/append-only/);
    await expect(db.query(
      "delete from public.agentos_goal_progress where goal_id = $1",
      [goalId],
    )).rejects.toThrow(/append-only/);
  });

  it("keeps goal tables read-only for browsers with no service_role grants", async () => {
    await resetRole(db);
    const { rows } = await db.query<{ ins: boolean; upd: boolean; del: boolean; svc: boolean }>(`
      select bool_or(pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT')) as ins,
             bool_or(pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE')) as upd,
             bool_or(pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE')) as del,
             bool_or(pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT')) as svc
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and c.relname in ('agentos_goals','agentos_goal_dod_items','agentos_goal_progress')
    `);
    expect(rows[0]).toMatchObject({ ins: false, upd: false, del: false, svc: false });
  });
});
