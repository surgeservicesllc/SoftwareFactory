import {
  buildManifest,
  EXPORT_LIMIT,
  EXPORT_TABLES,
  exportFilename,
  type TableOutcome,
} from "@/lib/job-seeker/export";
import { jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Your data is yours (ADR-247): one JSON document holding every row the
 * Job Seeker keeps about the caller, read under their own RLS through the
 * same client every page uses. Each table is read independently; one that
 * cannot be read is reported in the manifest by name with the reason, and
 * the export still answers with everything else. Nothing is written.
 */
export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const now = new Date();
    const data: Record<string, unknown[]> = {};
    const outcomes: TableOutcome[] = [];
    for (const entry of EXPORT_TABLES) {
      try {
        const { data: rows, error } = await client
          .from(entry.table)
          .select(entry.columns)
          .eq("organization_id", activeOrganization.id)
          .order(entry.orderBy, { ascending: true })
          .limit(EXPORT_LIMIT + 1);
        if (error || !Array.isArray(rows)) {
          data[entry.table] = [];
          outcomes.push({ table: entry.table, label: entry.label, rows: 0, truncated: false, error: "This table could not be read." });
          continue;
        }
        const kept = rows.slice(0, EXPORT_LIMIT);
        data[entry.table] = kept;
        outcomes.push({
          table: entry.table,
          label: entry.label,
          rows: kept.length,
          truncated: rows.length > EXPORT_LIMIT,
          error: null,
        });
      } catch {
        data[entry.table] = [];
        outcomes.push({ table: entry.table, label: entry.label, rows: 0, truncated: false, error: "This table could not be read." });
      }
    }
    const body = JSON.stringify({ manifest: buildManifest(outcomes, now), data }, null, 2);
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename(now)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "export_unavailable", message: "The export could not be composed." } },
      { status: 500 },
    );
  }
}
