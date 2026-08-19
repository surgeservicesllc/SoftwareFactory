import { z } from "zod";

import { compileCustomTemplate, customTemplateSchema } from "@/lib/graph/custom-templates";
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
 * One custom pipeline template: edit it (version bumps, compile re-checked)
 * or delete it (audit-evented; graphs planned from it keep their rows). The
 * database enforces owner/admin on both.
 */

const updateSchema = customTemplateSchema.omit({ slug: true });

function invalidTemplateId() {
  return jsonNoStore(
    { error: { code: "invalid_template_id", message: "The template identifier is invalid." } },
    { status: 400 },
  );
}

export async function PATCH(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    assertSameOriginRequest(request);
    const { templateId } = await params;
    if (!z.string().uuid().safeParse(templateId).success) return invalidTemplateId();

    const parsed = updateSchema.safeParse(await readBoundedJson(request, 64 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_template", message: "Give the template a name, summary, category, capability, and 1-12 areas with unique ids." } },
        { status: 400 },
      );
    }
    // Compile with a placeholder key: the key does not affect topology.
    const compiled = compileCustomTemplate({ ...parsed.data, slug: "custom_template" });
    if (!compiled.ok) {
      return jsonNoStore(
        { error: { code: "template_does_not_compile", message: "The template does not compile.", details: compiled.errors } },
        { status: 422 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client
      .rpc("update_pipeline_template", {
        p_organization_id: activeOrganization.id,
        p_template_id: templateId,
        p_name: parsed.data.name,
        p_summary: parsed.data.summary,
        p_category: parsed.data.category,
        p_capability: parsed.data.capability,
        p_areas: parsed.data.areas,
        p_topology: compiled.preview.topology,
      })
      .single();
    if (error) return databaseErrorResponse(error);

    const row = data as { template_id: string; slug: string; version: number };
    return jsonNoStore({ template: { id: row.template_id, slug: row.slug, version: row.version } });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "template_update_failed", message: "The template could not be updated safely." } },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    assertSameOriginRequest(request);
    const { templateId } = await params;
    if (!z.string().uuid().safeParse(templateId).success) return invalidTemplateId();

    const { activeOrganization, client } = await requireActiveOrganization();
    const { error } = await client.rpc("delete_pipeline_template", {
      p_organization_id: activeOrganization.id,
      p_template_id: templateId,
    });
    if (error) return databaseErrorResponse(error);

    return jsonNoStore({ deleted: true });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "template_delete_failed", message: "The template could not be deleted safely." } },
      { status: 500 },
    );
  }
}
