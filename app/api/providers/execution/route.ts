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

const executionRequestSchema = z
  .object({
    enabled: z.boolean(),
    confirmation: z.string().optional(),
  })
  .strict();

/**
 * Owner switch for outbound AI provider execution.
 *
 * Turning this on authorizes SoftwareFactory to spend money at an external
 * provider, so enabling requires an explicit typed confirmation while
 * disabling never does. Authorization is enforced again in the database.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const parsed = executionRequestSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_request",
            message: "An explicit enabled value is required.",
            fields: z.flattenError(parsed.error).fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    if (parsed.data.enabled && parsed.data.confirmation !== "ENABLE PROVIDER EXECUTION") {
      return jsonNoStore(
        {
          error: {
            code: "confirmation_required",
            message:
              "Enabling outbound provider execution requires the confirmation phrase ENABLE PROVIDER EXECUTION.",
          },
        },
        { status: 400 },
      );
    }

    const { client, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .rpc("set_provider_execution_enabled", {
        p_organization_id: activeOrganization.id,
        p_enabled: parsed.data.enabled,
      })
      .single();

    if (error) return databaseErrorResponse(error);

    const result = data as { ai_provider_execution_enabled: boolean };
    return jsonNoStore({
      executionEnabled: result.ai_provider_execution_enabled,
      message: result.ai_provider_execution_enabled
        ? "Outbound provider execution is enabled. Runs remain advisory and cannot change a repository."
        : "Outbound provider execution is disabled. No provider request will be made.",
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;

    return jsonNoStore(
      { error: { code: "internal_error", message: "The provider execution switch failed safely." } },
      { status: 500 },
    );
  }
}
