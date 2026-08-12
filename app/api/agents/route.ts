import { tenantListResponse } from "@/lib/server/tenant-list";

export const runtime = "nodejs";

type AgentRow = {
  id: string;
  name: string;
  role: string;
  description: string | null;
  status: string;
  provider: string | null;
  model: string | null;
  current_assignment: string | null;
  last_run_at: string | null;
  capabilities: unknown;
};

export async function GET(request: Request) {
  return tenantListResponse<AgentRow>({
    request,
    table: "agents",
    columns: "id,name,role,description,status,provider,model,current_assignment,last_run_at,capabilities",
    orderColumn: "created_at",
    ascending: true,
    unavailableCode: "agents_unavailable",
    unavailableMessage: "Agents could not be loaded.",
    shape: (rows) => ({
      agents: rows.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        description: row.description,
        status: row.status,
        // Provider and model are non-secret identifiers such as "openai" or
        // "gpt-4"; no credential is associated with an agent record.
        provider: row.provider,
        model: row.model,
        assignment: row.current_assignment,
        lastRunAt: row.last_run_at,
        capabilities: Array.isArray(row.capabilities)
          ? row.capabilities.filter((entry): entry is string => typeof entry === "string")
          : [],
      })),
    }),
  });
}
