import { z } from "zod";

import { PROVIDER_IDS } from "@/lib/providers/types";
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

const assignmentSchema = z
  .object({
    provider: z.enum(PROVIDER_IDS).nullable(),
    model: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
      .nullable()
      .default(null),
  })
  .strict()
  .refine((value) => value.provider !== null || value.model === null, {
    message: "A model cannot be assigned without a provider.",
  });

/**
 * Bind a logical agent to a provider and model, or clear the binding so the
 * agent falls back to project policy and automatic routing.
 *
 * The assignment names a provider, never a provider account: agent identity
 * and provider credentials stay separate concepts.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    assertSameOriginRequest(request);

    const { agentId } = await params;
    if (!z.string().uuid().safeParse(agentId).success) {
      return jsonNoStore(
        { error: { code: "invalid_agent", message: "The agent identifier is invalid." } },
        { status: 400 },
      );
    }

    const parsed = assignmentSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_assignment",
            message: "The provider assignment is invalid.",
            fields: z.flattenError(parsed.error).fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    // Prove the agent belongs to the caller's exact active tenant through the
    // existing bounded member projection before entering the mutation RPC.
    // The mutation independently re-checks owner/admin authority in SQL.
    const { client, activeOrganization } = await requireActiveOrganization();

    const { data: projectedAssignment, error: projectionError } = await client.rpc(
      "get_provider_agent_assignment",
      {
        p_agent_id: agentId,
        p_organization_id: activeOrganization.id,
      },
    );
    if (projectionError) return databaseErrorResponse(projectionError);
    if (!Array.isArray(projectedAssignment) || projectedAssignment.length !== 1) {
      return jsonNoStore(
        { error: { code: "agent_not_found", message: "The agent is not available in this workspace." } },
        { status: 404 },
      );
    }

    const { data, error } = await client
      .rpc("set_agent_provider_assignment", {
        p_agent_id: agentId,
        p_provider: parsed.data.provider,
        p_model: parsed.data.model,
      })
      .single();

    if (error) return databaseErrorResponse(error);

    const agent = data as { id: string; name: string; provider: string | null; model: string | null };
    return jsonNoStore({
      agent: {
        id: agent.id,
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;

    return jsonNoStore(
      { error: { code: "internal_error", message: "The agent assignment failed safely." } },
      { status: 500 },
    );
  }
}
