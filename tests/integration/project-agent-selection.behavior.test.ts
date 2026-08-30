// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Including logical agents in a project's AI Factory, checked against the
 * real migration chain.
 *
 * The owner asked for the agents on /solutions/agents to be selectable into
 * the factory. Selectable means it sticks: many agents per project, the
 * selection survives, and another surface reads the same records back. And
 * sticking is only worth anything if it fails closed: a plain member cannot
 * select, an outsider cannot read, anonymous gets nothing, and an agent
 * bound to a different project cannot be smuggled in.
 */

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000005a1";
const memberId = "00000000-0000-4000-8000-0000000005a2";
const outsiderId = "00000000-0000-4000-8000-0000000005a3";
const organizationId = "10000000-0000-4000-8000-0000000005b1";
const otherOrganizationId = "10000000-0000-4000-8000-0000000005b2";
const projectId = "40000000-0000-4000-8000-0000000005c1";
const secondProjectId = "40000000-0000-4000-8000-0000000005c2";
const archivedProjectId = "40000000-0000-4000-8000-0000000005c3";
const rosterAgentId = "50000000-0000-4000-8000-0000000005d1";
const secondRosterAgentId = "50000000-0000-4000-8000-0000000005d2";
const boundAgentId = "50000000-0000-4000-8000-0000000005d3";
const otherProjectAgentId = "50000000-0000-4000-8000-0000000005d4";
const foreignAgentId = "50000000-0000-4000-8000-0000000005d5";

type SelectionRow = {
  selection_id: string;
  selection_agent_id: string;
  selection_created: boolean;
};

describe("project agent selection", () => {
  let db: PGlite;

  async function asUser(userId: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function asAnonymous() {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await db.exec("set role anon");
  }

  async function asSuperuser() {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }

  async function select(organization: string, project: string, agent: string) {
    return db.query<SelectionRow>(
      "select * from public.select_project_agent($1, $2, $3)",
      [organization, project, agent],
    );
  }

  async function deselect(organization: string, project: string, agent: string) {
    return db.query<{ selection_removed: boolean }>(
      "select * from public.deselect_project_agent($1, $2, $3)",
      [organization, project, agent],
    );
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

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(migrationFiles.at(-1)).toBe("20260830000400_specialist_capability_stage_map.sql");
    for (const migrationFile of migrationFiles) {
      await db.exec(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
    }

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Agent Tenant', 'agent-tenant', '${ownerId}'),
        ('${otherOrganizationId}', 'Other Tenant', 'other-agent-tenant', '${outsiderId}');
      insert into public.organization_members (organization_id, user_id, role) values
        ('${organizationId}', '${memberId}', 'member')
      on conflict do nothing;
      insert into public.projects (id, organization_id, name, status, github_repository, default_branch, created_by) values
        ('${projectId}', '${organizationId}', 'Factory One', 'active', 'tenant/one', 'main', '${ownerId}'),
        ('${secondProjectId}', '${organizationId}', 'Factory Two', 'active', 'tenant/two', 'main', '${ownerId}'),
        ('${archivedProjectId}', '${organizationId}', 'Retired', 'archived', 'tenant/retired', 'main', '${ownerId}');
      insert into public.agents (id, organization_id, project_id, name, role, created_by) values
        ('${rosterAgentId}', '${organizationId}', null, 'Orchestrator', 'orchestrator', '${ownerId}'),
        ('${secondRosterAgentId}', '${organizationId}', null, 'QA', 'qa', '${ownerId}'),
        ('${boundAgentId}', '${organizationId}', '${projectId}', 'Factory One Reviewer', 'qa', '${ownerId}'),
        ('${otherProjectAgentId}', '${organizationId}', '${secondProjectId}', 'Factory Two Reviewer', 'qa', '${ownerId}'),
        ('${foreignAgentId}', '${otherOrganizationId}', null, 'Elsewhere', 'qa', '${outsiderId}');
    `);
    await db.exec("reset role");
  }, 240_000);

  afterAll(async () => {
    await db.close();
  });

  it("records an inclusion and reports that it created one", async () => {
    await asUser(ownerId);
    const first = await select(organizationId, projectId, rosterAgentId);

    expect(first.rows[0]?.selection_created).toBe(true);
    expect(first.rows[0]?.selection_agent_id).toBe(rosterAgentId);
  });

  it("keeps many inclusions for one project and reads them back with names", async () => {
    await asUser(ownerId);
    await select(organizationId, projectId, secondRosterAgentId);
    await select(organizationId, projectId, boundAgentId);

    const listed = await db.query<{ agent_name: string; agent_role: string }>(
      "select agent_name, agent_role from public.list_project_agents($1) where selection_project_id = $2",
      [organizationId, projectId],
    );
    expect(listed.rows.map((row) => row.agent_name).sort()).toEqual([
      "Factory One Reviewer",
      "Orchestrator",
      "QA",
    ]);
    expect(listed.rows.every((row) => row.agent_role.length > 0)).toBe(true);
  });

  it("treats a second press of the toggle as the same intention, not an error", async () => {
    await asUser(ownerId);
    const again = await select(organizationId, projectId, rosterAgentId);

    expect(again.rows[0]?.selection_created).toBe(false);
    const count = await db.query<{ total: number }>(
      "select count(*)::int as total from public.list_project_agents($1) where selection_project_id = $2 and selection_agent_id = $3",
      [organizationId, projectId, rosterAgentId],
    );
    expect(count.rows[0]?.total).toBe(1);
  });

  it("writes one activity event per real change and none for a repeat", async () => {
    await asSuperuser();
    const events = await db.query<{ event_type: string; entity_type: string }>(
      `select event_type::text as event_type, entity_type
       from public.activity_events
       where project_id = $1 and event_type::text like 'agent.%'
       order by occurred_at asc`,
      [projectId],
    );
    expect(events.rows).toHaveLength(3);
    expect(events.rows.every((row) => row.entity_type === "project_agent")).toBe(true);
    expect(events.rows.every((row) => row.event_type === "agent.selected")).toBe(true);
  });

  it("scopes an inclusion to its own project", async () => {
    await asUser(ownerId);
    await select(organizationId, secondProjectId, rosterAgentId);

    const listed = await db.query<{ selection_project_id: string; selection_agent_id: string }>(
      "select selection_project_id, selection_agent_id from public.list_project_agents($1)",
      [organizationId],
    );
    const forSecond = listed.rows.filter((row) => row.selection_project_id === secondProjectId);
    expect(forSecond.map((row) => row.selection_agent_id)).toEqual([rosterAgentId]);
    expect(listed.rows.filter((row) => row.selection_project_id === projectId)).toHaveLength(3);
  });

  it("removes an inclusion and says so, and says nothing changed when it was absent", async () => {
    await asUser(ownerId);
    const removed = await deselect(organizationId, projectId, secondRosterAgentId);
    expect(removed.rows[0]?.selection_removed).toBe(true);

    const absent = await deselect(organizationId, projectId, secondRosterAgentId);
    expect(absent.rows[0]?.selection_removed).toBe(false);

    await asSuperuser();
    const events = await db.query<{ total: number }>(
      `select count(*)::int as total from public.activity_events
       where project_id = $1 and event_type::text = 'agent.deselected'`,
      [projectId],
    );
    expect(events.rows[0]?.total).toBe(1);
  });

  it("refuses an agent bound to a different project", async () => {
    await asUser(ownerId);
    await expect(select(organizationId, projectId, otherProjectAgentId)).rejects.toThrow(
      /agent bound to another project cannot be included/i,
    );
  });

  it("refuses an agent from another organization as simply not found", async () => {
    await asUser(ownerId);
    await expect(select(organizationId, projectId, foreignAgentId)).rejects.toThrow(
      /agent was not found/i,
    );
  });

  it("refuses an archived project, which cannot change what it runs", async () => {
    await asUser(ownerId);
    await expect(select(organizationId, archivedProjectId, rosterAgentId)).rejects.toThrow(
      /archived project cannot change its agents/i,
    );
  });

  it("refuses a project id that does not belong to the organization it was given", async () => {
    await asUser(ownerId);
    await expect(select(otherOrganizationId, projectId, rosterAgentId)).rejects.toThrow(
      /project was not found/i,
    );
  });

  it("refuses a member who is not an owner or administrator", async () => {
    await asUser(memberId);
    await expect(select(organizationId, projectId, secondRosterAgentId)).rejects.toThrow(
      /owner or administrator access is required/i,
    );
    await expect(deselect(organizationId, projectId, rosterAgentId)).rejects.toThrow(
      /owner or administrator access is required/i,
    );
  });

  it("lets that same member read what the owner included", async () => {
    await asUser(memberId);
    const listed = await db.query<{ agent_name: string }>(
      "select agent_name from public.list_project_agents($1) where selection_project_id = $2",
      [organizationId, projectId],
    );
    expect(listed.rows.map((row) => row.agent_name).sort()).toEqual([
      "Factory One Reviewer",
      "Orchestrator",
    ]);
  });

  it("refuses an unrelated user entirely, in both directions", async () => {
    await asUser(outsiderId);
    await expect(select(organizationId, projectId, rosterAgentId)).rejects.toThrow(
      /owner or administrator access is required/i,
    );
    await expect(
      db.query("select * from public.list_project_agents($1)", [organizationId]),
    ).rejects.toThrow(/organization membership is required/i);
  });

  it("refuses anonymous, and gives it no table to read either", async () => {
    await asAnonymous();
    await expect(select(organizationId, projectId, rosterAgentId)).rejects.toThrow();
    await expect(
      db.query("select * from public.list_project_agents($1)", [organizationId]),
    ).rejects.toThrow();
    await expect(db.query("select * from public.project_agents")).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("gives no direct write path to a browser role, only the audited function", async () => {
    await asUser(ownerId);
    await expect(
      db.query(
        `insert into public.project_agents (organization_id, project_id, agent_id, selected_by)
         values ($1, $2, $3, $4)`,
        [organizationId, projectId, secondRosterAgentId, ownerId],
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("keeps an archived project's inclusions as the record of what it ran", async () => {
    await asUser(ownerId);
    await select(organizationId, secondProjectId, secondRosterAgentId);
    await db.query("select * from public.archive_project($1, $2)", [secondProjectId, "retired by the owner"]);

    const kept = await db.query<{ selection_agent_id: string }>(
      "select selection_agent_id from public.list_project_agents($1) where selection_project_id = $2",
      [organizationId, secondProjectId],
    );
    expect(kept.rows.map((row) => row.selection_agent_id).sort()).toEqual(
      [rosterAgentId, secondRosterAgentId].sort(),
    );
    await expect(select(organizationId, secondProjectId, boundAgentId)).rejects.toThrow(
      /archived project cannot change its agents/i,
    );
  });
});
