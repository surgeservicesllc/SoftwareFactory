// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseProjectConfig, serializeProjectConfig } from "@/lib/agentos/project-config";

/**
 * `agentos.yml` push and pull, against the real migrated schema.
 *
 * `docs/AGENTOS_SPEC.md` §22: "a YAML file pushed from CLI produces the same
 * agents+template you can see in the UI, and `pull` is a no-op after `push`".
 *
 * The unit tests prove the file format round trips through itself. This proves
 * the harder half — that it round trips through PostgreSQL, where ordering,
 * absent columns, and enum coercions all get a fresh chance to break it.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");

const ownerId = "00000000-0000-4000-8000-0000000000c1";
const memberId = "00000000-0000-4000-8000-0000000000c2";
const outsiderId = "00000000-0000-4000-8000-0000000000c3";
const organizationId = "10000000-0000-4000-8000-0000000000c1";
const otherOrganizationId = "10000000-0000-4000-8000-0000000000c2";
const projectId = "40000000-0000-4000-8000-0000000000c1";
const otherProjectId = "40000000-0000-4000-8000-0000000000c2";
const otherAgentId = "50000000-0000-4000-8000-0000000000c1";

const configText = `
project: Storefront
environments:
  - name: sandbox
    allowedHosts:
      - api.github.com
      - registry.npmjs.org
  - name: open-lab
    networking: open
mcpConnections:
  - name: linear_v2
    displayName: Linear
    transport: http
    endpoint: https://mcp.linear.app/sse
    credentialEnvVar: LINEAR_MCP_TOKEN
    allowedOperations:
      - list_issues
skills:
  - slug: brand-voice
    name: Brand voice
    kind: prompt
    body: Write plainly.
agents:
  - name: builder
    role: backend
    description: Writes the change.
    environment: sandbox
    runner: cloud
    mcpConnections:
      - linear_v2
    skills:
      - brand-voice
    filesystem:
      - folderPath: /agents/builder
        read: true
        write: true
    collaborators:
      - reviewer
  - name: reviewer
    role: qa
    environment: open-lab
    inboxAccess: true
    skills:
      - brand-voice
    mcpConnections:
      - linear_v2
templates:
  - name: ship-it
    displayName: Ship it
    variables:
      - issue
    steps:
      - name: Plan
        agent: builder
        prompt: Plan {{issue}}
      - name: Review
        agent: reviewer
        prompt: Review the plan
      - name: Sign off
        agent: human
        prompt: Approve
        approvalGate: true
        humanStep: true
`;

async function assumeRole(db: PGlite, userId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

async function push(db: PGlite, config: unknown, prune = false) {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    "select public.agentos_apply_project_config($1::uuid, $2::uuid, $3::jsonb, $4) as result",
    [organizationId, projectId, JSON.stringify(config), prune],
  );
  return rows[0].result;
}

async function pull(db: PGlite) {
  const { rows } = await db.query<{ document: unknown }>(
    "select public.agentos_export_project_config($1::uuid, $2::uuid) as document",
    [organizationId, projectId],
  );
  return rows[0].document;
}

describe("agentos.yml push and pull", { timeout: 180_000 }, () => {
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
      insert into auth.users (id) values ('${ownerId}'), ('${memberId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'Config Factory', 'config-factory', '${ownerId}'),
        ('${otherOrganizationId}', 'Other', 'other-config', '${outsiderId}');
      insert into public.projects (id, organization_id, name, status, default_branch, created_by)
      values ('${projectId}', '${organizationId}', 'Storefront', 'active', 'main', '${ownerId}');
    `);

    // The owner membership row is created by the organization trigger; the
    // plain member is added explicitly so the role boundary can be exercised.
    await db.exec(`
      insert into public.organization_members (organization_id, user_id, role)
      values ('${organizationId}', '${memberId}', 'member')
      on conflict do nothing;
    `);

    // A bystander in another organization, holding a grant no push of ours
    // ever names. If a delete in the apply function is unscoped, this is what
    // it destroys, and nothing inside our own organization would reveal it.
    await db.exec(`
      insert into public.projects (id, organization_id, name, status, default_branch, created_by)
      values ('${otherProjectId}', '${otherOrganizationId}', 'Bystander', 'active', 'main', '${outsiderId}');
      insert into public.agents (id, organization_id, project_id, name, role, created_by)
      values ('${otherAgentId}', '${otherOrganizationId}', '${otherProjectId}', 'bystander', 'custom', '${outsiderId}');
      insert into public.agentos_agent_filesystem_grants
        (organization_id, agent_id, folder_path, can_read)
      values ('${otherOrganizationId}', '${otherAgentId}', '/agents/bystander', true);
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("applies a file and reports what it wrote", async () => {
    await assumeRole(db, ownerId);
    const result = await push(db, parseProjectConfig(configText));
    await resetRole(db);

    expect(result.applied).toMatchObject({
      environments: 2, mcpConnections: 1, skills: 1, agents: 2, templates: 1,
    });
    expect(result.pruned).toBe(0);
  });

  it("is a no-op on pull, which is the acceptance the spec names", async () => {
    await assumeRole(db, ownerId);
    const exported = await pull(db);
    await resetRole(db);

    // Through the same parser and serializer the CLI uses, because that is
    // what an author would actually compare against their file.
    const pushed = serializeProjectConfig(parseProjectConfig(configText));
    const pulled = serializeProjectConfig(parseProjectConfig(JSON.stringify(exported)));

    expect(pulled).toBe(pushed);
  });

  it("is idempotent: pushing the pulled file changes nothing", async () => {
    await assumeRole(db, ownerId);
    const first = await pull(db);
    await push(db, first);
    const second = await pull(db);
    await resetRole(db);

    expect(second).toEqual(first);
  });

  it("replaces one agent's grants without touching another's", async () => {
    // The bug this exists for: a local variable named `agent_id` shadows the
    // column, `where agent_id = agent_id` becomes a tautology, and one agent's
    // push deletes every agent's grants in the database.
    const config = parseProjectConfig(configText);
    const narrowed = {
      ...config,
      agents: config.agents.map((agent) =>
        agent.name === "builder" ? { ...agent, skills: [], mcpConnections: [] } : agent),
    };

    await assumeRole(db, ownerId);
    await push(db, narrowed);
    await resetRole(db);
    const { rows } = await db.query<{ name: string; inbox_access: boolean }>(
      `select a.name, g.inbox_access
         from public.agents a
         join public.agentos_agent_grants g on g.agent_id = a.id
        where a.organization_id = $1 order by a.name`,
      [organizationId],
    );
    const collaborators = await db.query<{ count: string }>(
      "select count(*) as count from public.agentos_agent_collaborators where organization_id = $1",
      [organizationId],
    );
    const reviewerGrants = await db.query<{ skills: string; connections: string }>(
      `select
         (select count(*) from public.agentos_agent_skill_grants s where s.agent_id = a.id) as skills,
         (select count(*) from public.agentos_agent_mcp_grants m where m.agent_id = a.id) as connections
       from public.agents a where a.name = 'reviewer' and a.organization_id = $1`,
      [organizationId],
    );

    // The reviewer kept everything the file still says about it. Under the
    // tautology these both read zero: builder's push wiped the whole table.
    expect(rows.find((r) => r.name === "reviewer")?.inbox_access).toBe(true);
    expect(Number(reviewerGrants.rows[0].skills)).toBe(1);
    expect(Number(reviewerGrants.rows[0].connections)).toBe(1);
    // And builder's collaborator edge survived, because the file still has it.
    expect(Number(collaborators.rows[0].count)).toBe(1);

    // Put the fixture back for the tests that follow.
    await assumeRole(db, ownerId);
    await push(db, parseProjectConfig(configText));
    await resetRole(db);
  });

  it("never reaches another organization's grants", async () => {
    // The sharpest form of the shadowing bug. Inside one organization a
    // later agent in the same push rewrites what an earlier one wiped, so the
    // damage is invisible; a bystander in another organization is not rewritten
    // by anything and keeps the evidence.
    await assumeRole(db, ownerId);
    await push(db, parseProjectConfig(configText));
    await resetRole(db);

    const { rows } = await db.query<{ count: string }>(
      "select count(*) as count from public.agentos_agent_filesystem_grants where agent_id = $1",
      [otherAgentId],
    );

    expect(Number(rows[0].count)).toBe(1);
  });

  it("removes a capability when the file removes the line", async () => {
    const config = parseProjectConfig(configText);
    const stripped = {
      ...config,
      agents: config.agents.map((agent) =>
        agent.name === "builder" ? { ...agent, skills: [] } : agent),
    };

    await assumeRole(db, ownerId);
    await push(db, stripped);
    await resetRole(db);
    const { rows } = await db.query<{ count: string }>(
      `select count(*) as count
         from public.agentos_agent_skill_grants s
         join public.agents a on a.id = s.agent_id
        where a.name = 'builder'`,
    );

    // Deleting a line is how an author revokes a capability. Merging instead
    // of replacing would make revocation impossible from the file.
    expect(Number(rows[0].count)).toBe(0);

    await assumeRole(db, ownerId);
    await push(db, parseProjectConfig(configText));
    await resetRole(db);
  });

  describe("deleting is off by default", () => {
    it("reports drift instead of removing it", async () => {
      const config = parseProjectConfig(configText);
      const withoutReviewer = { ...config, agents: config.agents.filter((a) => a.name !== "builder") };

      await assumeRole(db, ownerId);
      const result = await push(db, withoutReviewer);
      await resetRole(db);
      const stillThere = await db.query<{ count: string }>(
        "select count(*) as count from public.agents where organization_id = $1 and name = 'builder'",
        [organizationId],
      );

      // A push that silently deleted an agent because someone edited a file on
      // a laptop is the destructive default the policy forbids.
      expect((result.extra as Record<string, string[]>).agents).toContain("builder");
      expect(result.pruned).toBe(0);
      expect(Number(stillThere.rows[0].count)).toBe(1);

      await assumeRole(db, ownerId);
      await push(db, parseProjectConfig(configText));
      await resetRole(db);
    });

    it("removes only when the caller asks explicitly", async () => {
      const config = parseProjectConfig(configText);
      const withoutBuilder = {
        ...config,
        agents: config.agents
          .filter((a) => a.name !== "builder")
          .map((a) => ({ ...a, collaborators: [] })),
      };

      await assumeRole(db, ownerId);
      const result = await push(db, withoutBuilder, true);
      await resetRole(db);
      const gone = await db.query<{ count: string }>(
        "select count(*) as count from public.agents where organization_id = $1 and name = 'builder'",
        [organizationId],
      );

      expect(result.pruned as number).toBeGreaterThan(0);
      expect(Number(gone.rows[0].count)).toBe(0);

      await assumeRole(db, ownerId);
      await push(db, parseProjectConfig(configText));
      await resetRole(db);
    });
  });

  describe("what a file is not allowed to do", () => {
    it("refuses a plain member", async () => {
      await assumeRole(db, memberId);
      await expect(push(db, parseProjectConfig(configText)))
        .rejects.toThrow(/owner or admin role is required/);
      await resetRole(db);
    });

    it("refuses another organization's caller entirely", async () => {
      await assumeRole(db, outsiderId);
      await expect(push(db, parseProjectConfig(configText))).rejects.toThrow();
      await expect(pull(db)).rejects.toThrow(/membership is required/);
      await resetRole(db);
    });

    it("refuses to redefine a builtin template, and never exports one", async () => {
      await assumeRole(db, ownerId);
      await db.query("select public.agentos_seed_compound_engineer_template($1::uuid)",
        [organizationId]);

      const exported = await pull(db) as { templates?: { name: string }[] };
      // Exporting it would hand back a file that could not be pushed.
      expect((exported.templates ?? []).map((t) => t.name)).not.toContain("compound-engineer-workflow");

      const config = parseProjectConfig(configText);
      await expect(push(db, {
        ...config,
        templates: [{ ...config.templates[0], name: "compound-engineer-workflow" }],
      })).rejects.toThrow(/builtin and cannot be redefined/);
      await resetRole(db);
    });

    it("refuses a repository the installation never granted", async () => {
      const config = parseProjectConfig(configText);
      const invented = {
        ...config,
        agents: config.agents.map((agent) => agent.name === "builder"
          ? { ...agent, repos: [{ repository: "acme/not-installed", mountPath: "/r/x", permission: "git_read" as const }] }
          : agent),
      };

      await assumeRole(db, ownerId);
      // Otherwise a YAML edit would be a way to widen repository access.
      await expect(push(db, invented)).rejects.toThrow(/is not installed for this organization/);
      await resetRole(db);
    });

    it("refuses an environment the file never defined", async () => {
      await assumeRole(db, ownerId);
      await expect(push(db, {
        project: "Storefront",
        environments: [],
        mcpConnections: [], skills: [], templates: [],
        agents: [{ name: "ghost", role: "custom", environment: "nowhere", runner: "inherit",
                   inboxAccess: false, mcpConnections: [], skills: [], repos: [],
                   filesystem: [], collaborators: [] }],
      })).rejects.toThrow(/which does not exist/);
      await resetRole(db);
    });

    it("is unreachable by the machine role", async () => {
      await resetRole(db);
      await db.exec("set role service_role");
      await expect(db.query(
        "select public.agentos_export_project_config($1::uuid, $2::uuid)",
        [organizationId, projectId],
      )).rejects.toThrow(/permission denied/i);
      await resetRole(db);
    });
  });

  it("records an audit event carrying counts, not prompt bodies", async () => {
    await assumeRole(db, ownerId);
    await push(db, parseProjectConfig(configText));
    await resetRole(db);

    const { rows } = await db.query<{ description: string; metadata: Record<string, unknown> }>(
      `select description, metadata from public.activity_events
        where organization_id = $1 and entity_type = 'agentos_project_config'
        order by occurred_at desc limit 1`,
      [organizationId],
    );

    expect(rows[0].description).toContain("Applied agentos.yml");
    expect(rows[0].metadata).toHaveProperty("applied");
    // The file carries prompts and a credential variable name; the audit row
    // carries neither.
    const serialized = JSON.stringify(rows[0].metadata);
    expect(serialized).not.toContain("Plan {{issue}}");
    expect(serialized).not.toContain("LINEAR_MCP_TOKEN");
  });

  it("never exports a credential value, only the variable name", async () => {
    await assumeRole(db, ownerId);
    const exported = await pull(db) as { mcpConnections: { credentialEnvVar?: string }[] };
    await resetRole(db);

    expect(exported.mcpConnections[0].credentialEnvVar).toBe("LINEAR_MCP_TOKEN");
    expect(JSON.stringify(exported)).not.toMatch(/ghp_|sk-|eyJ/);
  });
});
