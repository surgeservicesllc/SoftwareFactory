import { z } from "zod";

import { findTemplate } from "@/lib/graph/templates";
import { isBuiltInTemplateKey } from "@/lib/graph/custom-templates";
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
 * Which pipeline templates each project runs.
 *
 * Pressing Use on a template card writes here, and the AI Factory journey
 * reads here — which is what makes a selection survive closing the overlay,
 * a refresh, and a move to another surface. Selection is routing intent
 * recorded by a person: nothing on this route dispatches a bot, claims work,
 * or spends a token.
 *
 * Reads are member-scoped and writes are owner/administrator-scoped, both
 * enforced in the database by the definer functions, under the caller's own
 * identity. The route never widens that.
 *
 * PGRST202 — the definer function does not exist on this database yet —
 * is reported as itself rather than smoothed into an empty list. "Nothing is
 * selected" and "selections cannot be recorded here" look identical to a
 * person pressing Use, and only one of them is true; saying the wrong one
 * would make a button that does nothing look like a button that worked.
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
        code: "pipeline_selection_not_connected",
        message:
          "Pipeline selection is Not Connected: this database does not yet have the "
          + "project_pipelines migration applied.",
      },
    },
    { status: 503 },
  );
}

const selectionSchema = z.object({
  projectId: z.string().uuid(),
  templateKey: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
}).strict();

type SelectionRow = {
  pipeline_id: string;
  pipeline_project_id: string;
  pipeline_template_key: string;
  pipeline_template_id: string | null;
  pipeline_selected_at: string;
  pipeline_template_name: string | null;
};

/**
 * A key names a built-in (which lives in source, versioned by review) or a
 * custom template row — and nothing else. Without this check a typo would
 * store happily and then render as a built-in that does not exist, because a
 * built-in is exactly the case with no row to point at.
 */
async function templateKeyExists(
  client: Awaited<ReturnType<typeof requireActiveOrganization>>["client"],
  organizationId: string,
  templateKey: string,
): Promise<boolean> {
  if (isBuiltInTemplateKey(templateKey)) return true;
  const { data, error } = await client
    .from("graph_templates")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("slug", templateKey)
    .eq("is_archived", false)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

function unknownTemplate() {
  return jsonNoStore(
    {
      error: {
        code: "template_not_found",
        message: "That template is neither a built-in nor a template in this workspace.",
      },
    },
    { status: 404 },
  );
}

export async function GET() {
  try {
    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client.rpc("list_project_pipelines", {
      p_organization_id: activeOrganization.id,
    });
    if (isMissingFunction(error)) {
      return jsonNoStore({ available: false, canManage: false, pipelines: [] });
    }
    if (error) return databaseErrorResponse(error);

    const pipelines = ((data ?? []) as SelectionRow[]).map((row) => {
      const builtIn = row.pipeline_template_id === null ? findTemplate(row.pipeline_template_key) : null;
      return {
        id: row.pipeline_id,
        projectId: row.pipeline_project_id,
        templateKey: row.pipeline_template_key,
        templateId: row.pipeline_template_id,
        kind: row.pipeline_template_id === null ? ("built_in" as const) : ("custom" as const),
        // The authoritative name for each kind: code for a built-in, the row
        // for a custom one. Nothing is stored twice, so nothing can drift.
        name: builtIn?.name ?? row.pipeline_template_name ?? row.pipeline_template_key,
        summary: builtIn?.summary ?? null,
        selectedAt: row.pipeline_selected_at,
      };
    });

    return jsonNoStore({
      available: true,
      canManage: (["owner", "admin"] as const).includes(activeOrganization.role as "owner" | "admin"),
      pipelines,
    });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "pipelines_unavailable", message: "Selected pipelines could not be loaded." } },
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
        {
          error: {
            code: "invalid_selection",
            message: "Give a project and a template key.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (!(await templateKeyExists(client, activeOrganization.id, parsed.data.templateKey))) {
      return unknownTemplate();
    }

    const { data, error } = await client
      .rpc("select_project_pipeline", {
        p_organization_id: activeOrganization.id,
        p_project_id: parsed.data.projectId,
        p_template_key: parsed.data.templateKey,
      })
      .single();
    if (isMissingFunction(error)) return selectionNotConnected();
    if (error) return databaseErrorResponse(error);

    const row = data as {
      pipeline_id: string;
      pipeline_template_key: string;
      pipeline_template_id: string | null;
      pipeline_selected_at: string;
      pipeline_created: boolean;
    };
    return jsonNoStore({
      pipeline: {
        id: row.pipeline_id,
        projectId: parsed.data.projectId,
        templateKey: row.pipeline_template_key,
        templateId: row.pipeline_template_id,
        selectedAt: row.pipeline_selected_at,
      },
      // Pressing Use twice is one intention, so a repeat is a success that
      // reports it changed nothing rather than a conflict.
      created: row.pipeline_created,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "pipeline_select_failed", message: "The pipeline could not be selected safely." } },
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
      templateKey: url.searchParams.get("templateKey") ?? "",
    });
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_selection",
            message: "Give a project and a template key.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client
      .rpc("deselect_project_pipeline", {
        p_organization_id: activeOrganization.id,
        p_project_id: parsed.data.projectId,
        p_template_key: parsed.data.templateKey,
      })
      .single();
    if (isMissingFunction(error)) return selectionNotConnected();
    if (error) return databaseErrorResponse(error);

    return jsonNoStore({ removed: Boolean((data as { pipeline_removed?: boolean } | null)?.pipeline_removed) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "pipeline_deselect_failed", message: "The pipeline could not be removed safely." } },
      { status: 500 },
    );
  }
}
