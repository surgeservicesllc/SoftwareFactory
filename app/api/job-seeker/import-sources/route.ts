import { listImportAdapters, listSearchAdapters } from "@/lib/job-seeker/import-adapters";
import { jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The discovery-source registry, as it actually is: each adapter with whether
 * its configuration exists and exactly what it needs. Secret VALUES never
 * travel here — only the names of what is missing.
 *
 * `sources` are board reads, keyed by a company identifier; `searchSources`
 * are keyword searches. They are two lists rather than one filtered by
 * `mode` so the page cannot render a search adapter with an identifier box
 * by forgetting a filter — the shape of the answer carries the distinction.
 */
export async function GET() {
  try {
    await requireActiveOrganization();
    const describe = (adapter: ReturnType<typeof listImportAdapters>[number]) => ({
      key: adapter.key,
      name: adapter.name,
      summary: adapter.summary,
      mode: adapter.mode,
      identifierLabel: adapter.identifierLabel ?? null,
      identifierHint: adapter.identifierHint ?? null,
      configured: adapter.configured,
      requiredConfiguration: adapter.requiredConfiguration,
    });
    return jsonNoStore({
      sources: listImportAdapters().map(describe),
      searchSources: listSearchAdapters().map(describe),
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
