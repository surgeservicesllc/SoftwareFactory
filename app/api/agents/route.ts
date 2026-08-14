import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";
import { tenantRpcListResponse } from "@/lib/server/tenant-list";

export const runtime = "nodejs";

/*
 * GET keeps main's hardened safe-projection RPC boundary; POST is the
 * Phase 2A provider-assignment path.
 */
type AgentRow = {
  id: string;
  name: string;
  role: string;
  description: string | null;
  status: string;
  provider: string | null;
  model: string | null;
  last_run_at: string | null;
  capabilities: unknown;
  current_assignment?: string | null;
  provider_connection_status?: string | null;
  project_id?: string | null;
  project_name?: string | null;
};

function shapeAgents(rows: AgentRow[]) {
  return {
    agents: rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      description: row.description,
      // Provider and model are non-secret identifiers such as "openai" or
      // "gpt-4"; no credential is associated with an agent record.
      provider: row.provider,
      model: row.model,
      status: row.status,
      lastRunAt: row.last_run_at,
      currentAssignment: row.current_assignment ?? null,
      providerConnectionStatus: row.provider_connection_status ?? null,
      project: row.project_id
        ? { id: row.project_id, name: row.project_name ?? "Project" }
        : null,
      capabilities: Array.isArray(row.capabilities)
        ? row.capabilities.filter((entry): entry is string => typeof entry === "string")
        : [],
    })),
  };
}

export async function GET(request: Request) {
  return tenantRpcListResponse<AgentRow>({
    request,
    rpc: "list_agents",
    unavailableCode: "agents_unavailable",
    unavailableMessage: "Agents could not be loaded.",
    shape: shapeAgents,
  });
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const { client, activeOrganization } = await requireActiveOrganization();

    const { error } = await client.rpc("ensure_default_agents", {
      p_organization_id: activeOrganization.id,
    });
    if (error) return databaseErrorResponse(error);

    // Direct SELECT on `agents` is deliberately revoked. Re-read the roster
    // through the same bounded caller-member projection used by GET so this
    // mutation cannot accidentally turn into a broad browser read.
    const { data, error: listError } = await client.rpc("list_agents", {
      p_limit: 100,
      p_organization_id: activeOrganization.id,
    });
    if (listError) return databaseErrorResponse(listError);

    return jsonNoStore(
      {
        activeOrganizationId: activeOrganization.id,
        ...shapeAgents((data ?? []) as AgentRow[]),
      },
      { status: 200 },
    );
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;

    return jsonNoStore(
      { error: { code: "internal_error", message: "Agent setup failed safely." } },
      { status: 500 },
    );
  }
}
