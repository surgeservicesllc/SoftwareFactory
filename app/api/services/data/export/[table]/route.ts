import { EXPORT_PAGE, EXPORT_ROW_CEILING, isExportTable } from "@/lib/services/data-export";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * One table, every row the caller may read, as a JSON file. Paged by id
 * inside the route so the caller gets one document, and capped so one
 * download cannot run forever — the cap is reported when it is hit rather
 * than silently truncating.
 */
export async function GET(_request: Request, context: { params: Promise<{ table: string }> }) {
  try {
    const { table } = await context.params;
    if (!isExportTable(table)) {
      return jsonNoStore({ error: { code: "not_exportable", message: "That table is not part of the export." } }, { status: 404 });
    }
    const { client, activeOrganization } = await requireActiveOrganization();

    const rows: Record<string, unknown>[] = [];
    let after: string | null = null;
    let truncated = false;
    for (;;) {
      let query = client
        .from(table)
        .select("*")
        .eq("organization_id", activeOrganization.id)
        .order("id", { ascending: true })
        .limit(EXPORT_PAGE);
      if (after !== null) query = query.gt("id", after);
      const page = await query;
      if (page.error) return databaseErrorResponse(page.error);
      const batch = (page.data ?? []) as Record<string, unknown>[];
      rows.push(...batch);
      if (batch.length < EXPORT_PAGE) break;
      after = String(batch[batch.length - 1].id);
      if (rows.length >= EXPORT_ROW_CEILING) {
        truncated = true;
        break;
      }
    }

    const body = JSON.stringify({
      table,
      organizationId: activeOrganization.id,
      exportedAt: new Date().toISOString(),
      rowCount: rows.length,
      truncatedAt: truncated ? EXPORT_ROW_CEILING : null,
      rows,
    });
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${table}.json"`,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "crm_export_failed", message: "The table could not be exported." } }, { status: 500 });
  }
}
