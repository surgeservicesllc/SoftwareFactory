// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

import { AUTOMATIC_ACTIONS } from "@/lib/autonomy/controls";

/**
 * Executable proof that the Phase 1D control model is complete and still
 * fail-closed.
 *
 * The claim this migration makes is narrow and worth checking rather than
 * asserting textually: it completes the nine-action model at two scopes while
 * relaxing nothing. So this applies the whole migration chain to a real
 * PostgreSQL and tries, from every direction, to switch something on.
 */


const ownerId = "00000000-0000-4000-8000-00000000d001";
const memberId = "00000000-0000-4000-8000-00000000d002";
const organizationId = "10000000-0000-4000-8000-00000000d001";
const projectId = "40000000-0000-4000-8000-00000000d001";

/** Column names for the nine automatic actions, at either scope. */
const ACTION_COLUMNS = AUTOMATIC_ACTIONS.map((action) => `auto_${action}`);

async function rejects(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the statement to be rejected");
}

describe("Phase 1D autonomy controls", () => {
  let db: PGlite;

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}');
      insert into public.organizations (id, name, slug, created_by)
        values ('${organizationId}', 'Control Factory', 'control-factory', '${ownerId}');
      insert into public.projects (id, organization_id, name, status, default_branch, created_by)
        values ('${projectId}', '${organizationId}', 'Storefront', 'active', 'main', '${ownerId}');
    `);
  }, 180_000);

  afterAll(async () => {
    await db?.close();
  });

  describe("the model is complete", () => {
    it("carries all nine automatic actions on projects", async () => {
      await db.exec("reset role");
      const { rows } = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'projects'
           and column_name like 'auto\\_%'`,
      );

      expect(rows.map((row) => row.column_name).sort()).toEqual([...ACTION_COLUMNS].sort());
    });

    it("carries the same nine on organizations, plus mode and ceiling", async () => {
      await db.exec("reset role");
      const { rows } = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'organizations'
           and (column_name like 'auto\\_%'
                or column_name in ('autonomous_mode', 'maximum_autonomous_risk'))`,
      );

      const names = rows.map((row) => row.column_name);
      for (const column of ACTION_COLUMNS) expect(names).toContain(column);
      expect(names).toContain("autonomous_mode");
      expect(names).toContain("maximum_autonomous_risk");
    });

    it("defaults every action off at both scopes", async () => {
      await db.exec("reset role");
      for (const table of ["projects", "organizations"] as const) {
        const columns = ACTION_COLUMNS.join(", ");
        const { rows } = await db.query<Record<string, boolean>>(
          `select ${columns} from public.${table} limit 1`,
        );
        for (const column of ACTION_COLUMNS) {
          expect(rows[0][column], `${table}.${column} must default off`).toBe(false);
        }
      }
    });

    it("defaults both scopes to mode off and a GREEN ceiling", async () => {
      await db.exec("reset role");
      const { rows } = await db.query<{ pm: boolean; pr: string; om: boolean; orisk: string }>(
        `select p.autonomous_mode as pm, p.maximum_autonomous_risk::text as pr,
                o.autonomous_mode as om, o.maximum_autonomous_risk::text as orisk
         from public.projects p join public.organizations o on o.id = p.organization_id`,
      );

      expect(rows[0]).toEqual({ pm: false, pr: "green", om: false, orisk: "green" });
    });
  });

  describe("the owner-operated contract (ADR-080)", () => {
    async function asOwner() {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
      await db.exec("set role authenticated");
    }
    async function asNobody() {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
    }

    it.each(ACTION_COLUMNS)("refuses an unattributed enable of projects.%s", async (column) => {
      await asNobody();
      const message = await rejects(() =>
        db.exec(`update public.projects set ${column} = true where id = '${projectId}'`),
      );
      expect(message).toMatch(/only an organization owner/i);
    });

    it.each(ACTION_COLUMNS)("refuses an unattributed enable of organizations.%s", async (column) => {
      await asNobody();
      const message = await rejects(() =>
        db.exec(`update public.organizations set ${column} = true where id = '${organizationId}'`),
      );
      expect(message).toMatch(/only the organization owner/i);
    });

    it("refuses a RED ceiling at either scope, for anyone", async () => {
      for (const [table, id] of [["projects", projectId], ["organizations", organizationId]] as const) {
        await asNobody();
        const message = await rejects(() =>
          db.exec(`update public.${table} set maximum_autonomous_risk = 'red' where id = '${id}'`),
        );
        expect(message, `${table} must refuse a RED ceiling`).toMatch(/never be RED/i);
      }
    });

    it("refuses an unattributed kill-switch release", async () => {
      await asNobody();
      const message = await rejects(() =>
        db.exec(
          `update public.organizations set autonomy_kill_switch_active = false
           where id = '${organizationId}'`,
        ),
      );
      expect(message).toMatch(/only the organization owner/i);
    });

    it("refuses a release without a reason, then releases and re-engages for the owner with audit events", async () => {
      await asOwner();
      const refusal = await rejects(() =>
        db.query(
          `select * from public.set_autonomy_kill_switch($1::uuid, false, null)`,
          [organizationId],
        ),
      );
      expect(refusal).toMatch(/a reason is required/i);

      const { rows: released } = await db.query<{ kill_switch_active: boolean }>(
        `select * from public.set_autonomy_kill_switch($1::uuid, false, 'Supervised GREEN pilot')`,
        [organizationId],
      );
      expect(released[0].kill_switch_active).toBe(false);

      const { rows: engaged } = await db.query<{ kill_switch_active: boolean }>(
        `select * from public.set_autonomy_kill_switch($1::uuid, true, null)`,
        [organizationId],
      );
      expect(engaged[0].kill_switch_active).toBe(true);

      await db.exec("reset role");
      const { rows: events } = await db.query<{ count: string }>(
        `select count(*) as count from public.activity_events
         where organization_id = $1 and event_type = 'autonomy.kill_switch_changed'`,
        [organizationId],
      );
      expect(Number(events[0].count)).toBe(2);
    });

    it("lets the owner enable an action through the controls operation, audit-evented", async () => {
      await asOwner();
      const { rows } = await db.query<{ auto_plan: boolean }>(
        `select auto_plan from public.set_organization_autonomy_controls(
           $1::uuid, p_auto_plan => true, p_reason => 'Pilot: planning only')`,
        [organizationId],
      );
      expect(rows[0].auto_plan).toBe(true);

      await db.exec("reset role");
      const { rows: events } = await db.query<{ count: string }>(
        `select count(*) as count from public.activity_events
         where organization_id = $1 and event_type = 'autonomy.controls_changed'`,
        [organizationId],
      );
      expect(Number(events[0].count)).toBeGreaterThanOrEqual(1);

      // Put it back so later resolution tests read the fail-closed default.
      await asOwner();
      await db.query(
        `select * from public.set_organization_autonomy_controls(
           $1::uuid, p_auto_plan => false, p_reason => 'Pilot ended')`,
        [organizationId],
      );
      await db.exec("reset role");
    });

    it("refuses the RED ceiling through the owner operation too", async () => {
      await asOwner();
      const message = await rejects(() =>
        db.query(
          `select * from public.set_organization_autonomy_controls(
             $1::uuid, p_maximum_autonomous_risk => 'red')`,
          [organizationId],
        ),
      );
      expect(message).toMatch(/never be RED/i);
      await db.exec("reset role");
    });

    it("still refuses a new project or organization born with authority", async () => {
      await asNobody();
      const projectMessage = await rejects(() =>
        db.exec(
          `insert into public.projects (organization_id, name, status, default_branch, created_by, auto_merge)
           values ('${organizationId}', 'Sneaky', 'active', 'main', '${ownerId}', true)`,
        ),
      );
      expect(projectMessage).toMatch(/born fail-closed/i);

      const organizationMessage = await rejects(() =>
        db.exec(
          `insert into public.organizations (name, slug, created_by, auto_deploy)
           values ('Sneaky Org', 'sneaky-org', '${ownerId}', true)`,
        ),
      );
      expect(organizationMessage).toMatch(/born fail-closed/i);
    });

    it("replaced the scaffold constraints with the RED-ceiling refusals", async () => {
      await db.exec("reset role");
      const { rows } = await db.query<{ conname: string }>(
        `select conname from pg_constraint
         where conname in (
           'projects_phase1d_green_observation_only',
           'organizations_phase1d_green_observation_only',
           'organizations_phase1d_kill_switch_active',
           'projects_autonomy_ceiling_below_red',
           'organizations_autonomy_ceiling_below_red'
         )`,
      );
      const names = rows.map((row) => row.conname).sort();
      expect(names).toEqual([
        "organizations_autonomy_ceiling_below_red",
        "projects_autonomy_ceiling_below_red",
      ]);
    });
  });

  describe("resolved_autonomy_controls", () => {
    it("resolves every action off while no executor is connected", async () => {
      await db.exec("reset role");
      const { rows } = await db.query<Record<string, boolean | string>>(
        `select * from public.resolved_autonomy_controls('${projectId}'::uuid)`,
      );

      expect(rows).toHaveLength(1);
      for (const column of ACTION_COLUMNS) {
        expect(rows[0][column], `${column} must resolve off`).toBe(false);
      }
      expect(rows[0].executor_connected).toBe(false);
      expect(rows[0].kill_switch_active).toBe(true);
      expect(rows[0].autonomous_mode).toBe(false);
    });

    it("reports the GREEN ceiling and which scope supplied it", async () => {
      await db.exec("reset role");
      const { rows } = await db.query<{ maximum_autonomous_risk: string; risk_ceiling_source: string }>(
        `select maximum_autonomous_risk::text, risk_ceiling_source
         from public.resolved_autonomy_controls('${projectId}'::uuid)`,
      );

      expect(rows[0].maximum_autonomous_risk).toBe("green");
      // Equal ceilings resolve to the organization: a project never widens.
      expect(rows[0].risk_ceiling_source).toBe("organization");
    });

    it("reports the owner emergency stop distinctly from an automatic freeze", async () => {
      await db.exec("reset role");
      const { rows } = await db.query<{ emergency_stop_active: boolean; release_frozen: boolean }>(
        `select emergency_stop_active, release_frozen
         from public.resolved_autonomy_controls('${projectId}'::uuid)`,
      );

      // Both start false, and they are separate signals: an owner's deliberate
      // stop and an automatic SEV1 freeze need different words and different
      // actions to clear.
      expect(rows[0].emergency_stop_active).toBe(false);
      expect(rows[0].release_frozen).toBe(false);
    });

    it("returns nothing for a project that does not exist", async () => {
      await db.exec("reset role");
      const { rows } = await db.query(
        `select * from public.resolved_autonomy_controls('40000000-0000-4000-8000-00000000dead'::uuid)`,
      );

      expect(rows).toHaveLength(0);
    });

    it("is callable by an authenticated member and not by anon", async () => {
      await db.exec("reset role");
      const { rows } = await db.query<{ has: boolean }>(
        `select has_function_privilege('authenticated', 'public.resolved_autonomy_controls(uuid)', 'execute') as has`,
      );
      expect(rows[0].has).toBe(true);

      const { rows: anonRows } = await db.query<{ has: boolean }>(
        `select has_function_privilege('anon', 'public.resolved_autonomy_controls(uuid)', 'execute') as has`,
      );
      expect(anonRows[0].has).toBe(false);
    });

    it("reads the caller's own visibility rather than bypassing it", async () => {
      await db.exec("reset role");
      const { rows } = await db.query<{ prosecdef: boolean }>(
        `select prosecdef from pg_proc where proname = 'resolved_autonomy_controls'`,
      );

      // security invoker: a member cannot use it to see another tenant.
      expect(rows[0].prosecdef).toBe(false);
    });
  });


  describe("decisions are auditable", () => {
    it("records a decision through the function and returns its id", async () => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
      await db.exec("set role authenticated");

      const { rows } = await db.query<{ record_autonomy_decision: string }>(
        `select public.record_autonomy_decision(
           $1::uuid, 'merge', 'APPROVED_AUTOMATICALLY', 'green'::public.risk_level,
           '{}'::text[], 'phase1d-decision-v1', 'abc1234', $2::uuid, $3::uuid, false, 'merge'
         )`,
        [projectId, ownerId, memberId],
      );

      expect(rows[0].record_autonomy_decision).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("refuses an approval whose approver is its author", async () => {
      const message = await rejects(() =>
        db.query(
          `select public.record_autonomy_decision(
             $1::uuid, 'merge', 'APPROVED_AUTOMATICALLY', 'green'::public.risk_level,
             '{}'::text[], 'phase1d-decision-v1', 'abc1234', $2::uuid, $2::uuid, false, 'merge'
           )`,
          [projectId, ownerId],
        ),
      );

      expect(message).toMatch(/no_self_approval/i);
    });

    it("refuses an approval that claims a blocker", async () => {
      const message = await rejects(() =>
        db.query(
          `select public.record_autonomy_decision(
             $1::uuid, 'merge', 'APPROVED_AUTOMATICALLY', 'green'::public.risk_level,
             '{GATES_NOT_SATISFIED}'::text[], 'phase1d-decision-v1', null, null, null, false, null
           )`,
          [projectId],
        ),
      );

      expect(message).toMatch(/blockers_match_decision/i);
    });

    it("refuses a refusal with no named blocker", async () => {
      const message = await rejects(() =>
        db.query(
          `select public.record_autonomy_decision(
             $1::uuid, 'merge', 'NOT_APPROVED', 'green'::public.risk_level,
             '{}'::text[], 'phase1d-decision-v1', null, null, null, false, null
           )`,
          [projectId],
        ),
      );

      expect(message).toMatch(/blockers_match_decision/i);
    });

    it("is append-only: a recorded decision cannot be edited or deleted", async () => {
      await db.exec("reset role");

      const update = await rejects(() =>
        db.exec("update public.autonomy_decisions set decision = 'NOT_APPROVED'"),
      );
      const remove = await rejects(() => db.exec("delete from public.autonomy_decisions"));

      for (const message of [update, remove]) {
        expect(message).toMatch(/append-only/i);
      }
    });

    it("keeps RLS and FORCE RLS on, with no browser write path", async () => {
      await db.exec("reset role");
      const { rows } = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `select relrowsecurity, relforcerowsecurity from pg_class
         where relname = 'autonomy_decisions' and relnamespace = 'public'::regnamespace`,
      );
      expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

      for (const role of ["anon", "authenticated"] as const) {
        for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
          const { rows: grants } = await db.query<{ has: boolean }>(
            `select has_table_privilege($1, 'public.autonomy_decisions', $2) as has`,
            [role, privilege],
          );
          expect(grants[0].has, `${role} must not ${privilege}`).toBe(false);
        }
      }
    });

    it("lets an anonymous caller neither read nor record", async () => {
      await db.exec("reset role");
      const { rows } = await db.query<{ has: boolean }>(
        `select has_function_privilege('anon',
           'public.record_autonomy_decision(uuid, text, text, public.risk_level, text[], text, text, uuid, uuid, boolean, text)',
           'execute') as has`,
      );
      expect(rows[0].has).toBe(false);

      const { rows: reads } = await db.query<{ has: boolean }>(
        `select has_table_privilege('anon', 'public.autonomy_decisions', 'SELECT') as has`,
      );
      expect(reads[0].has).toBe(false);
    });
  });

  describe("the browser cannot write controls", () => {
    it.each(["projects", "organizations"] as const)(
      "grants anon no write on %s",
      async (table) => {
        await db.exec("reset role");
        for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
          const { rows } = await db.query<{ has: boolean }>(
            `select has_table_privilege('anon', 'public.${table}', $1) as has`,
            [privilege],
          );
          expect(rows[0].has, `anon must not ${privilege} ${table}`).toBe(false);
        }
      },
    );
  });
});
