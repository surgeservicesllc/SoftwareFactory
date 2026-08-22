import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Which logical agents each project's AI Factory includes.
 *
 * Pressing "Include in AI Factory" on an agent card writes here, and the AI
 * Factory journey reads here — which is what makes a selection survive
 * closing the overlay, a refresh, and a move to another surface. Selection
 * is routing intent recorded by a person: nothing on this route dispatches
 * a bot, claims work, or spends a token.
 *
 * Reads are member-scoped and writes are owner/administrator-scoped, both
 * enforced in the database by the definer functions, under the caller's own
 * identity. The route never widens that.
 *
 * PGRST202 — the definer function does not exist on this database yet — is
 * reported as itself rather than smoothed into an empty list: "nothing is
 * selected" and "selections cannot be recorded here" look identical to a
 * person pressing the toggle, and only one of them is true.
 */

/** PostgREST's code for "no such function", i.e. the migration is unapplied. */
function isMissingFunction(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && (error as { code?: unknown }).code === "PGRST202";
}

function selectionNotConnected() {
  return jsonNoStore(
    {
      error: {
        code: "agent_selection_not_connected",
        message:
          "Agent selection is Not Connected: this database does not yet have the "
          + "project_agents migration applied.",
      },
    },
    { status: 503 },
  );
}

const selectionSchema = z.object({
  projectId: z.string().uuid(),
  agentId: z.string().uuid(),
}).strict();

type SelectionRow = {
  selection_id: string;
  selection_project_id: string;
  selection_agent_id: string;
  selection_selected_at: string;
  agent_name: string;
  agent_role: string;
};

export async function GET() {
  try {
    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client.rpc("list_project_agents", {
      p_organization_id: activeOrganization.id,
    });
    if (isMissingFunction(error)) {
      return jsonNoStore({ available: false, canManage: false, selections: [] });
    }
    if (error) return databaseErrorResponse(error);

    return jsonNoStore({
      available: true,
      canManage: (["owner", "admin"] as const).includes(activeOrganization.role as "owner" | "admin"),
      selections: ((data ?? []) as SelectionRow[]).map((row) => ({
        id: row.selection_id,
        projectId: row.selection_project_id,
        agentId: row.selection_agent_id,
        agentName: row.agent_name,
        agentRole: row.agent_role,
        selectedAt: row.selection_selected_at,
      })),
    });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "agent_selections_unavailable", message: "Selected agents could not be loaded." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = selectionSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_selection", message: "Give a project and an agent." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client
      .rpc("select_project_agent", {
        p_organization_id: activeOrganization.id,
        p_project_id: parsed.data.projectId,
        p_agent_id: parsed.data.agentId,
      })
      .single();
    if (isMissingFunction(error)) return selectionNotConnected();
    if (error) return databaseErrorResponse(error);

    const row = data as {
      selection_id: string;
      selection_agent_id: string;
      selection_selected_at: string;
      selection_created: boolean;
    };
    return jsonNoStore({
      selection: {
        id: row.selection_id,
        projectId: parsed.data.projectId,
        agentId: row.selection_agent_id,
        selectedAt: row.selection_selected_at,
      },
      // Pressing the toggle twice is one intention, so a repeat is a success
      // that reports it changed nothing rather than a conflict.
      created: row.selection_created,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "agent_select_failed", message: "The agent could not be included safely." } },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request);
    const url = new URL(request.url);
    const parsed = selectionSchema.safeParse({
      projectId: url.searchParams.get("projectId") ?? "",
      agentId: url.searchParams.get("agentId") ?? "",
    });
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_selection", message: "Give a project and an agent." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client
      .rpc("deselect_project_agent", {
        p_organization_id: activeOrganization.id,
        p_project_id: parsed.data.projectId,
        p_agent_id: parsed.data.agentId,
      })
      .single();
    if (isMissingFunction(error)) return selectionNotConnected();
    if (error) return databaseErrorResponse(error);

    return jsonNoStore({ removed: Boolean((data as { selection_removed?: boolean } | null)?.selection_removed) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "agent_deselect_failed", message: "The agent could not be removed safely." } },
      { status: 500 },
    );
  }
}
