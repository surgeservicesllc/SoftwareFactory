
import {
  compileCustomTemplate,
  customTemplateSchema,
  isBuiltInTemplateKey,
  parseStoredDefinition,
} from "@/lib/graph/custom-templates";
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
 * Custom pipeline templates. Reads go through the member-scoped RLS SELECT
 * the table has carried since the graph engine landed; writes go through the
 * owner/admin definer functions, and a definition the compiler refuses is
 * refused here with the compiler's own errors — every stored template stays
 * genuinely runnable.
 */

type TemplateRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  definition: unknown;
  version: number;
  is_archived: boolean;
  updated_at: string;
};

export async function GET() {
  try {
    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client
      .from("graph_templates")
      .select("id,slug,name,description,definition,version,is_archived,updated_at")
      .eq("organization_id", activeOrganization.id)
      .eq("is_archived", false)
      .order("name", { ascending: true })
      .limit(100);
    if (error) return databaseErrorResponse(error);

    const templates = ((data ?? []) as TemplateRow[]).flatMap((row) => {
      const input = parseStoredDefinition(row.slug, row.name, row.description ?? "", row.definition);
      if (!input) {
        // A row this route cannot parse is reported as itself, not hidden
        // and not guessed at.
        return [{
          id: row.id,
          slug: row.slug,
          name: row.name,
          summary: row.description ?? "",
          version: row.version,
          editable: false,
          compiles: false,
          errors: ["This template's stored definition is not in a shape this console can edit."],
        }];
      }
      const compiled = compileCustomTemplate(input);
      return [{
        id: row.id,
        slug: row.slug,
        name: row.name,
        summary: input.summary,
        category: input.category,
        capability: input.capability,
        areas: input.areas,
        version: row.version,
        editable: true,
        compiles: compiled.ok,
        topology: compiled.ok ? compiled.preview.topology : null,
        nodeCount: compiled.ok ? compiled.preview.nodes.length : null,
        maxParallelism: compiled.ok ? compiled.preview.maxParallelism : null,
        anchorNodeCount: compiled.ok ? compiled.preview.anchorNodeCount : null,
        errors: compiled.ok ? [] : compiled.errors,
      }];
    });

    return jsonNoStore({
      templates,
      canManage: (["owner", "admin"] as const).includes(activeOrganization.role as "owner" | "admin"),
    });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "templates_unavailable", message: "Custom templates could not be loaded." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = customTemplateSchema.safeParse(await readBoundedJson(request, 64 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_template", message: "Give the template a key, name, summary, category, capability, and 1-12 areas with unique ids." } },
        { status: 400 },
      );
    }
    if (isBuiltInTemplateKey(parsed.data.slug)) {
      return jsonNoStore(
        { error: { code: "template_key_reserved", message: "That key belongs to a built-in template. Pick another key — built-ins are edited as code." } },
        { status: 409 },
      );
    }
    const compiled = compileCustomTemplate(parsed.data);
    if (!compiled.ok) {
      return jsonNoStore(
        { error: { code: "template_does_not_compile", message: "The template does not compile.", details: compiled.errors } },
        { status: 422 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client
      .rpc("create_pipeline_template", {
        p_organization_id: activeOrganization.id,
        p_slug: parsed.data.slug,
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
    return jsonNoStore(
      { template: { id: row.template_id, slug: row.slug, version: row.version } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "template_creation_failed", message: "The template could not be created safely." } },
      { status: 500 },
    );
  }
}
