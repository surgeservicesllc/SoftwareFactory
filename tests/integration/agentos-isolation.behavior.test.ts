// @vitest-environment node


import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedDatabase } from "../support/migrated-database";

/**
 * AgentOS least-privilege behaviour, against the real migrated schema.
 *
 * `docs/AGENTOS_SPEC.md` §5 states these are product requirements, not
 * suggestions, and §22 asks for them as automated tests. They are asserted
 * against the database rather than against application code because the point
 * of the model is that "this agent cannot do that" survives a caller that
 * forgets to check.
 */


const ownerId = "00000000-0000-4000-8000-00000000a001";
const outsiderId = "00000000-0000-4000-8000-00000000a002";
const organizationId = "10000000-0000-4000-8000-00000000a001";
const otherOrganizationId = "10000000-0000-4000-8000-00000000a002";

let supportAgentId = "";
let planAgentId = "";
let ungrantedAgentId = "";

async function assumeRole(db: PGlite, role: "anon" | "authenticated" | "service_role", userId: string | null = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`set role ${role}`);
}

async function resetRole(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}

describe("AgentOS isolation model", { timeout: 120_000 }, () => {
  let db: PGlite;

  beforeAll(async () => {
    // The chain, restored from a snapshot rather than replayed; the
    // helper keys its cache on the CONTENT of every migration, and
    // asserts coverage of the whole directory.
    db = await createMigratedDatabase();

    await db.exec(`
      insert into auth.users (id) values ('${ownerId}'), ('${outsiderId}');
      insert into public.organizations (id, name, slug, created_by) values
        ('${organizationId}', 'AgentOS Factory', 'agentos-factory', '${ownerId}'),
        ('${otherOrganizationId}', 'Other Factory', 'other-agentos', '${outsiderId}');
    `);

    const agents = await db.query<{ id: string; name: string }>(
      `insert into public.agents (organization_id, name, role, description, status, created_by)
       values
         ('${organizationId}', 'customer-support', 'custom', 'Support only', 'idle', '${ownerId}'),
         ('${organizationId}', 'plan', 'orchestrator', 'Planning only', 'idle', '${ownerId}'),
         ('${organizationId}', 'ungranted', 'custom', 'Nothing granted', 'idle', '${ownerId}')
       returning id, name`,
    );
    supportAgentId = agents.rows.find((r) => r.name === "customer-support")!.id;
    planAgentId = agents.rows.find((r) => r.name === "plan")!.id;
    ungrantedAgentId = agents.rows.find((r) => r.name === "ungranted")!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it("treats an unconfigured agent as denied rather than unrestricted", async () => {
    await assumeRole(db, "authenticated", ownerId);
    const { rows } = await db.query<{ grants: Record<string, unknown> }>(
      "select public.agentos_resolved_agent_grants($1::uuid) as grants",
      [ungrantedAgentId],
    );
    await resetRole(db);

    const grants = rows[0].grants as Record<string, never> & {
      configured: boolean;
      inboxAccess: boolean;
      environment: { networking: string; configured: boolean };
      mcpConnections: unknown[];
      repos: unknown[];
      filesystem: unknown[];
      collaborators: unknown[];
    };

    // "Not configured" and "not allowed" must behave identically. An agent with
    // no grant row is the most common state, and the dangerous reading of it is
    // "no restrictions recorded".
    expect(grants.configured).toBe(false);
    expect(grants.inboxAccess).toBe(false);
    expect(grants.environment.networking).toBe("limited");
    expect(grants.environment.configured).toBe(false);
    expect(grants.mcpConnections).toEqual([]);
    expect(grants.repos).toEqual([]);
    expect(grants.filesystem).toEqual([]);
    expect(grants.collaborators).toEqual([]);
  });

  it("keeps a limited environment closed unless a host is named", async () => {
    await resetRole(db);
    // An empty allowlist under `limited` reaches nothing.
    await db.exec(`
      insert into public.agentos_environments (organization_id, name, networking, allowed_hosts, created_by)
      values ('${organizationId}', 'support-only', 'limited', array['api.front.com'], '${ownerId}');
    `);

    // An `open` environment may not carry an allowlist that implies a
    // restriction it does not apply.
    await expect(db.exec(`
      insert into public.agentos_environments (organization_id, name, networking, allowed_hosts, created_by)
      values ('${organizationId}', 'contradictory', 'open', array['api.front.com'], '${ownerId}');
    `)).rejects.toThrow(/open_has_no_allowlist/);

    // A scheme or wildcard cannot be enforced by a host proxy, so it is refused.
    for (const host of ["https://api.front.com", "*.front.com", "api.front.com:443", "api.front.com/v1"]) {
      await expect(db.query(
        `insert into public.agentos_environments (organization_id, name, networking, allowed_hosts, created_by)
         values ($1, $2, 'limited', array[$3], $4)`,
        [organizationId, `env-${host}`, host, ownerId],
      )).rejects.toThrow(/hosts_are_hostnames/);
    }
  });

  it("refuses a filesystem grant that would mislead a reader", async () => {
    await resetRole(db);

    // A row granting nothing reads as a grant at a glance.
    await expect(db.exec(`
      insert into public.agentos_agent_filesystem_grants
        (organization_id, agent_id, folder_path, can_read, can_write, can_delete)
      values ('${organizationId}', '${supportAgentId}', '/agents/support', false, false, false);
    `)).rejects.toThrow(/grants_something/);

    // Delete without read, and write without read, are not capabilities anyone
    // means to grant.
    await expect(db.exec(`
      insert into public.agentos_agent_filesystem_grants
        (organization_id, agent_id, folder_path, can_read, can_write, can_delete)
      values ('${organizationId}', '${supportAgentId}', '/agents/support', false, false, true);
    `)).rejects.toThrow(/delete_implies_read/);

    // Path escape is refused at the schema, not at whichever caller builds it.
    await expect(db.exec(`
      insert into public.agentos_agent_filesystem_grants
        (organization_id, agent_id, folder_path, can_read, can_write, can_delete)
      values ('${organizationId}', '${supportAgentId}', '/agents/../etc', true, false, false);
    `)).rejects.toThrow(/no_traversal/);
  });

  it("separates write from delete on a real grant", async () => {
    await resetRole(db);
    await db.exec(`
      insert into public.agentos_agent_filesystem_grants
        (organization_id, agent_id, folder_path, can_read, can_write, can_delete)
      values ('${organizationId}', '${supportAgentId}', '/agents/customer-support', true, true, false);
    `);

    await assumeRole(db, "authenticated", ownerId);
    const { rows } = await db.query<{ grants: { filesystem: Array<Record<string, boolean | string>> } }>(
      "select public.agentos_resolved_agent_grants($1::uuid) as grants",
      [supportAgentId],
    );
    await resetRole(db);

    const folder = rows[0].grants.filesystem[0];
    // The spec is explicit: "can write" must never imply "can delete".
    expect(folder).toMatchObject({ canRead: true, canWrite: true, canDelete: false });
  });

  it("never stores a credential value, and refuses privileged references", async () => {
    await resetRole(db);

    for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "GITHUB_APP_PRIVATE_KEY", "VERCEL_TOKEN"]) {
      await expect(db.query(
        `insert into public.agentos_mcp_connections
           (organization_id, name, display_name, transport, credential_env_var, created_by)
         values ($1, $2, 'X', 'http', $3, $4)`,
        [organizationId, `mcp-${name.toLowerCase()}`, name, ownerId],
      )).rejects.toThrow(/not_privileged/);
    }

    // A NEXT_PUBLIC_ variable reaches the browser by definition.
    await expect(db.query(
      `insert into public.agentos_mcp_connections
         (organization_id, name, display_name, transport, credential_env_var, created_by)
       values ($1, 'mcp-public', 'X', 'http', 'NEXT_PUBLIC_SOMETHING', $2)`,
      [organizationId, ownerId],
    )).rejects.toThrow(/not_public/);

    // An http endpoint must be HTTPS.
    await expect(db.query(
      `insert into public.agentos_mcp_connections
         (organization_id, name, display_name, transport, endpoint, created_by)
       values ($1, 'mcp-plain', 'X', 'http', 'http://api.front.com', $2)`,
      [organizationId, ownerId],
    )).rejects.toThrow(/endpoint_https/);
  });

  it("gives a support agent its own tool without granting anyone else's", async () => {
    await resetRole(db);
    const front = await db.query<{ id: string }>(
      `insert into public.agentos_mcp_connections
         (organization_id, name, display_name, transport, credential_env_var, created_by)
       values ($1, 'front', 'Front', 'http', 'FRONT_API_KEY', $2) returning id`,
      [organizationId, ownerId],
    );
    const github = await db.query<{ id: string }>(
      `insert into public.agentos_mcp_connections
         (organization_id, name, display_name, transport, created_by)
       values ($1, 'github', 'GitHub', 'builtin', $2) returning id`,
      [organizationId, ownerId],
    );

    // Only Front is granted to support. GitHub exists on the project.
    await db.query(
      `insert into public.agentos_agent_mcp_grants (organization_id, agent_id, mcp_connection_id)
       values ($1, $2, $3)`,
      [organizationId, supportAgentId, front.rows[0].id],
    );

    await assumeRole(db, "authenticated", ownerId);
    const { rows } = await db.query<{ grants: { mcpConnections: Array<{ name: string; credentialConfigured: boolean }> } }>(
      "select public.agentos_resolved_agent_grants($1::uuid) as grants",
      [supportAgentId],
    );
    await resetRole(db);

    const names = rows[0].grants.mcpConnections.map((c) => c.name);
    // The spec is explicit that support must never hold GitHub, and that a
    // connection existing on the project is not a grant to any agent.
    expect(names).toEqual(["front"]);
    expect(names).not.toContain("github");
    expect(github.rows[0].id).toBeTruthy();

    // Presence only — the value is never surfaced.
    expect(rows[0].grants.mcpConnections[0].credentialConfigured).toBe(true);
    expect(JSON.stringify(rows[0].grants)).not.toContain("FRONT_API_KEY");
  });

  it("makes the collaboration list the only spawn path, and refuses self-spawn", async () => {
    await resetRole(db);
    await expect(db.query(
      `insert into public.agentos_agent_collaborators (organization_id, agent_id, collaborator_agent_id)
       values ($1, $2, $2)`,
      [organizationId, planAgentId],
    )).rejects.toThrow(/not_self/);

    await db.query(
      `insert into public.agentos_agent_collaborators (organization_id, agent_id, collaborator_agent_id)
       values ($1, $2, $3)`,
      [organizationId, planAgentId, supportAgentId],
    );

    await assumeRole(db, "authenticated", ownerId);
    const { rows } = await db.query<{ grants: { collaborators: string[] } }>(
      "select public.agentos_resolved_agent_grants($1::uuid) as grants",
      [planAgentId],
    );
    await resetRole(db);

    expect(rows[0].grants.collaborators).toEqual([supportAgentId]);
    // The support agent has no list at all, so it can spawn nothing.
    await assumeRole(db, "authenticated", ownerId);
    const support = await db.query<{ grants: { collaborators: string[] } }>(
      "select public.agentos_resolved_agent_grants($1::uuid) as grants",
      [supportAgentId],
    );
    await resetRole(db);
    expect(support.rows[0].grants.collaborators).toEqual([]);
  });

  it("refuses to resolve grants for another organization's agent", async () => {
    await assumeRole(db, "authenticated", outsiderId);
    await expect(db.query(
      "select public.agentos_resolved_agent_grants($1::uuid)",
      [supportAgentId],
    )).rejects.toThrow(/membership is required/);
    await resetRole(db);
  });

  it("keeps every new table under RLS with FORCE RLS and no service_role grants", async () => {
    await resetRole(db);
    const { rows } = await db.query<{
      relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; svc: boolean;
    }>(`
      select c.relname,
             c.relrowsecurity,
             c.relforcerowsecurity,
             pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT')
               or pg_catalog.has_table_privilege('service_role', c.oid, 'INSERT')
               or pg_catalog.has_table_privilege('service_role', c.oid, 'UPDATE')
               or pg_catalog.has_table_privilege('service_role', c.oid, 'DELETE') as svc
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'agentos\\_%'
       order by c.relname
    `);

    expect(rows.length).toBeGreaterThanOrEqual(9);
    expect(rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity)).toEqual([]);
    // The verified migration-026 ACL matrix must be unchanged by this work.
    expect(rows.filter((r) => r.svc)).toEqual([]);
  });

  it("gives browsers read-only access and no write path", async () => {
    await resetRole(db);
    const { rows } = await db.query<{ relname: string; ins: boolean; upd: boolean; del: boolean }>(`
      select c.relname,
             pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT') as ins,
             pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE') as upd,
             pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE') as del
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'agentos\\_%'
    `);

    expect(rows.filter((r) => r.ins || r.upd || r.del)).toEqual([]);
  });
});
