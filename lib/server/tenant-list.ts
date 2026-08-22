import "server-only";

import { z } from "zod";

import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

/**
 * Shared boundary for tenant-scoped list reads.
 *
 * Every one of these routes has to do the same five things correctly:
 * authenticate the caller, resolve the exact active organization, read through
 * the caller's own JWT so the RPC can enforce membership, bound the row count, and return
 * no-store. Writing that five times invites five different mistakes, so the
 * routes below supply only a narrow safe-projection RPC and browser shape.
 */

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

type TenantRpcListConfig<Row> = {
  request: Request;
  rpc: string;
  /**
   * Temporary rollout compatibility for an additive list RPC. The fallback
   * is attempted only when PostgREST reports that the primary function does
   * not exist; authorization, validation, and every other database failure
   * remain failures rather than silently switching read contracts.
   */
  fallbackRpc?: string;
  /** Stable machine-readable code for the failure envelope. */
  unavailableCode: string;
  unavailableMessage: string;
  shape: (rows: Row[]) => Record<string, unknown>;
};

export async function tenantRpcListResponse<Row>({
  request,
  rpc,
  fallbackRpc,
  unavailableCode,
  unavailableMessage,
  shape,
}: TenantRpcListConfig<Row>): Promise<Response> {
  try {
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_query", message: "The query is invalid." } },
        { status: 400 },
      );
    }

    const context = await requireActiveOrganization();
    const parameters = {
      p_limit: parsed.data.limit,
      p_organization_id: context.activeOrganization.id,
    };
    let result = await context.client.rpc(rpc, parameters);
    if (result.error?.code === "PGRST202" && fallbackRpc) {
      result = await context.client.rpc(fallbackRpc, parameters);
    }
    if (result.error) return databaseErrorResponse(result.error);

    return jsonNoStore({
      activeOrganizationId: context.activeOrganization.id,
      ...shape((result.data ?? []) as Row[]),
    });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: unavailableCode, message: unavailableMessage } },
      { status: 500 },
    );
  }
}
