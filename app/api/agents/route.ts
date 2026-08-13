import { listAgents } from "@/lib/providers/service";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/** Logical agents for the active organization, with provider assignments. */
export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    return jsonNoStore({
      organizationRole: activeOrganization.role,
      agents: await listAgents(client, activeOrganization.id),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;

    return jsonNoStore(
      { error: { code: "internal_error", message: "Agents could not be loaded." } },
      { status: 500 },
    );
  }
}

/**
 * Seed the standard logical agent roster. Idempotent: an organization that
 * already has the roster gets the same rows back rather than duplicates.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const { client, activeOrganization } = await requireActiveOrganization();

    const { error } = await client.rpc("ensure_default_agents", {
      p_organization_id: activeOrganization.id,
    });
    if (error) return databaseErrorResponse(error);

    return jsonNoStore({ agents: await listAgents(client, activeOrganization.id) }, { status: 200 });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;

    return jsonNoStore(
      { error: { code: "internal_error", message: "Agent setup failed safely." } },
      { status: 500 },
    );
  }
}
