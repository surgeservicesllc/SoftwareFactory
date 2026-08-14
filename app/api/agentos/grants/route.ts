import { tenantRpcListResponse } from "@/lib/server/tenant-list";

export const runtime = "nodejs";

/**
 * What each agent is allowed to do.
 *
 * Read through the safe projection rather than the grant tables, so the shape
 * the browser receives is stated in one place. Counts, not contents: a console
 * listing needs to show that an agent holds three MCP connections without
 * naming which credential variables back them.
 */
type Row = {
  agent_id: string;
  agent_name: string;
  configured: boolean;
  inbox_access: boolean;
  runner_preference: string;
  environment_name: string | null;
  networking: string;
  allowed_host_count: number;
  mcp_count: number;
  skill_count: number;
  repo_count: number;
  filesystem_grant_count: number;
  collaborator_count: number;
};

export async function GET(request: Request) {
  return tenantRpcListResponse<Row>({
    request,
    rpc: "agentos_list_agent_grants",
    unavailableCode: "agentos_grants_unavailable",
    unavailableMessage: "Agent permissions could not be loaded.",
    shape: (rows) => ({
      agentGrants: rows.map((row) => ({
        agentId: row.agent_id,
        agentName: row.agent_name,
        // An agent with no grant row holds nothing. The console shows that as
        // a real state rather than an empty-looking configured one.
        configured: row.configured,
        inboxAccess: row.inbox_access,
        runnerPreference: row.runner_preference,
        environment: {
          name: row.environment_name,
          networking: row.networking,
          allowedHostCount: row.allowed_host_count,
        },
        counts: {
          mcpConnections: row.mcp_count,
          skills: row.skill_count,
          repos: row.repo_count,
          filesystemGrants: row.filesystem_grant_count,
          collaborators: row.collaborator_count,
        },
      })),
    }),
  });
}
