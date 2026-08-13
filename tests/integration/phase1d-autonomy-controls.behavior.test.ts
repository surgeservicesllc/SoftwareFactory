// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

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

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, file), "utf8"));
    }

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

  describe("nothing was relaxed", () => {
    it.each(ACTION_COLUMNS)("refuses to enable projects.%s", async (column) => {
      await db.exec("reset role");
      const message = await rejects(() =>
        db.exec(`update public.projects set ${column} = true where id = '${projectId}'`),
      );

      expect(message).toMatch(/scaffold-only|projects_phase1d_green_observation_only/i);
    });

    it.each(ACTION_COLUMNS)("refuses to enable organizations.%s", async (column) => {
      await db.exec("reset role");
      const message = await rejects(() =>
        db.exec(`update public.organizations set ${column} = true where id = '${organizationId}'`),
      );

      expect(message).toMatch(/scaffold-only|organizations_phase1d_green_observation_only/i);
    });

    it("refuses to raise either risk ceiling", async () => {
      await db.exec("reset role");
      for (const [table, id] of [["projects", projectId], ["organizations", organizationId]] as const) {
        const message = await rejects(() =>
          db.exec(`update public.${table} set maximum_autonomous_risk = 'red' where id = '${id}'`),
        );
        expect(message, `${table} must refuse a raised ceiling`).toMatch(
          /scaffold-only|green_observation_only/i,
        );
      }
    });

    it("refuses to switch autonomous mode on at either scope", async () => {
      await db.exec("reset role");
      for (const [table, id] of [["projects", projectId], ["organizations", organizationId]] as const) {
        const message = await rejects(() =>
          db.exec(`update public.${table} set autonomous_mode = true where id = '${id}'`),
        );
        expect(message).toMatch(/scaffold-only|green_observation_only/i);
      }
    });

    it("refuses to release the global kill switch", async () => {
      await db.exec("reset role");
      const message = await rejects(() =>
        db.exec(
          `update public.organizations set autonomy_kill_switch_active = false
           where id = '${organizationId}'`,
        ),
      );

      expect(message).toMatch(/kill switch|organizations_phase1d_kill_switch_active/i);
    });

    it("refuses a new project that tries to be born with authority", async () => {
      await db.exec("reset role");
      const message = await rejects(() =>
        db.exec(
          `insert into public.projects (organization_id, name, status, default_branch, created_by, auto_merge)
           values ('${organizationId}', 'Sneaky', 'active', 'main', '${ownerId}', true)`,
        ),
      );

      expect(message).toMatch(/scaffold-only|green_observation_only/i);
    });

    it("refuses a new organization that tries to be born with authority", async () => {
      await db.exec("reset role");
      const message = await rejects(() =>
        db.exec(
          `insert into public.organizations (name, slug, created_by, auto_deploy)
           values ('Sneaky Org', 'sneaky-org', '${ownerId}', true)`,
        ),
      );

      expect(message).toMatch(/scaffold-only|green_observation_only/i);
    });

    it("keeps both constraints validated rather than merely declared", async () => {
      await db.exec("reset role");
      const { rows } = await db.query<{ conname: string; convalidated: boolean }>(
        `select conname, convalidated from pg_constraint
         where conname in (
           'projects_phase1d_green_observation_only',
           'organizations_phase1d_green_observation_only'
         )`,
      );

      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.convalidated, `${row.conname} must be validated`).toBe(true);
      }
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
