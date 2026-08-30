import { buildSeedReport, formatSeedReport } from "@/lib/services/seed-validation";
import { jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The seed's audit, for this workspace, right now: per-table record counts,
 * optional-field coverage, enum spread, relationship integrity and orphan
 * counts, each with a PASS or FAIL.
 *
 * It reads the real rows through the caller's own RLS-scoped session, so
 * what it reports is what the workspace actually holds — not what a seeder
 * believes it wrote. `format=text` returns the same report as a plain table
 * for a terminal or a CI log.
 */

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const report = await buildSeedReport(client, activeOrganization.id);

    if (new URL(request.url).searchParams.get("format") === "text") {
      return new Response(`${formatSeedReport(report)}\n`, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return jsonNoStore({ report });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_seed_report_unavailable", message: "The seed report could not be built." } },
      { status: 500 },
    );
  }
}
