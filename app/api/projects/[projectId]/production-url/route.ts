import { z } from "zod";

import {
  MAX_PROJECT_PRODUCTION_URL_LENGTH,
  normalizeProjectProductionUrl,
} from "@/lib/projects/production-url";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const updateProductionUrlSchema = z
  .object({
    productionUrl: z.string().trim().max(MAX_PROJECT_PRODUCTION_URL_LENGTH).nullable(),
  })
  .strict();

function invalidProductionUrlResponse(message?: string) {
  return jsonNoStore(
    {
      error: {
        code: "invalid_production_url",
        message: message
          ?? "Use a public HTTPS URL without credentials, query parameters, fragments, private hosts, localhost, or non-standard ports.",
      },
    },
    { status: 400 },
  );
}

/**
 * Set or clear the stable public URL used by Full Lifecycle Step 10. The
 * request boundary rejects obvious invalid/secret-bearing input for a useful
 * response; the SECURITY DEFINER RPC independently repeats authorization and
 * target validation before the forced-RLS project row changes.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { projectId } = await params;
    if (!z.string().uuid().safeParse(projectId).success) {
      return jsonNoStore(
        { error: { code: "invalid_project_id", message: "Project id must be a UUID." } },
        { status: 400 },
      );
    }

    const parsed = updateProductionUrlSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) return invalidProductionUrlResponse();
    if (findSensitiveData(parsed.data.productionUrl)) {
      return jsonNoStore(
        {
          error: {
            code: "sensitive_data_rejected",
            message: "A production URL may not contain credentials or likely secret material.",
          },
        },
        { status: 400 },
      );
    }

    const normalized = normalizeProjectProductionUrl(parsed.data.productionUrl);
    if (normalized.error) return invalidProductionUrlResponse(normalized.error);

    const { activeOrganization, client } = await requireActiveOrganization();
    if (!(["owner", "admin"] as const).includes(
      activeOrganization.role as "owner" | "admin",
    )) {
      return jsonNoStore(
        {
          error: {
            code: "project_management_forbidden",
            message: "Organization owner or administrator access is required.",
          },
        },
        { status: 403 },
      );
    }

    const { data, error } = await client
      .rpc("set_project_production_url", {
        p_organization_id: activeOrganization.id,
        p_project_id: projectId,
        p_production_url: normalized.productionUrl,
      })
      .single();
    if (error) return databaseErrorResponse(error);

    const row = data as {
      project_id: string;
      production_url: string | null;
      updated_at: string;
    };
    return jsonNoStore({
      project: {
        id: row.project_id,
        productionUrl: row.production_url,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      {
        error: {
          code: "production_url_update_failed",
          message: "The project production URL could not be changed safely.",
        },
      },
      { status: 500 },
    );
  }
}
