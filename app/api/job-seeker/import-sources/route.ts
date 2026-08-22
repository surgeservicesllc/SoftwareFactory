import { listImportAdapters } from "@/lib/job-seeker/import-adapters";
import { jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The import-source registry, as it actually is: each adapter with whether
 * its configuration exists and exactly what it needs. Secret VALUES never
 * travel here — only the names of what is missing.
 */
export async function GET() {
  try {
    await requireActiveOrganization();
    return jsonNoStore({
      sources: listImportAdapters().map((adapter) => ({
        key: adapter.key,
        name: adapter.name,
        summary: adapter.summary,
        mode: adapter.mode,
        identifierLabel: adapter.identifierLabel ?? null,
        identifierHint: adapter.identifierHint ?? null,
        configured: adapter.configured,
        requiredConfiguration: adapter.requiredConfiguration,
      })),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "import_sources_unavailable", message: "Import sources could not be listed." } },
      { status: 500 },
    );
  }
}
