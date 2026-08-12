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
 * the caller's own JWT so RLS applies, bound the row count, and return
 * no-store. Writing that five times invites five different mistakes, so the
 * routes below supply only their table, columns, ordering, and browser shape.
 *
 * `select` is always an explicit column list — never `*` — so a future column
 * cannot silently start reaching the browser.
 */

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

type TenantContext = Awaited<ReturnType<typeof requireActiveOrganization>>;

type TenantListConfig<Row> = {
  request: Request;
  table: string;
  columns: string;
  orderColumn: string;
  ascending?: boolean;
  /** Stable machine-readable code for the failure envelope. */
  unavailableCode: string;
  unavailableMessage: string;
  /** Maps raw rows to the browser shape; may run further tenant-scoped reads. */
  shape: (
    rows: Row[],
    context: TenantContext,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
};

export async function tenantListResponse<Row>({
  request,
  table,
  columns,
  orderColumn,
  ascending = false,
  unavailableCode,
  unavailableMessage,
  shape,
}: TenantListConfig<Row>): Promise<Response> {
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
    const { data, error } = await context.client
      .from(table)
      .select(columns)
      .eq("organization_id", context.activeOrganization.id)
      .order(orderColumn, { ascending })
      .limit(parsed.data.limit);
    if (error) return databaseErrorResponse(error);

    return jsonNoStore({
      activeOrganizationId: context.activeOrganization.id,
      ...(await shape((data ?? []) as Row[], context)),
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

/**
 * Resolves display names for referenced rows without exposing anything beyond
 * an id and a label. Returns an empty map when there is nothing to look up so
 * callers never issue an `in ()` query with no values.
 */
export async function lookupNames(
  context: TenantContext,
  table: string,
  ids: (string | null)[],
  labelColumn = "name",
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const { data } = await context.client
    .from(table)
    .select(`id,${labelColumn}`)
    .eq("organization_id", context.activeOrganization.id)
    .in("id", unique);
  // The column list is built at runtime, so the query builder cannot infer a
  // row type for it; the shape is guaranteed by the select above.
  const rows = (data ?? []) as unknown as Record<string, string>[];
  return new Map(rows.map((row) => [row.id, row[labelColumn]]));
}
