import { CRM_EXPORT_TABLES } from "@/lib/services/data-export";
import { jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/** The manifest: every table the export covers, with the caller's own row count. */
export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const counts = await Promise.all(
      CRM_EXPORT_TABLES.map(async (table) => {
        const result = await client
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("organization_id", activeOrganization.id);
        return { table, rows: result.error ? null : (result.count ?? 0), error: result.error?.message ?? null };
      }),
    );
    return jsonNoStore({
      tables: counts,
      totalRows: counts.reduce((sum, entry) => sum + (entry.rows ?? 0), 0),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore({ error: { code: "crm_export_unavailable", message: "The export manifest could not be read." } }, { status: 500 });
  }
}
