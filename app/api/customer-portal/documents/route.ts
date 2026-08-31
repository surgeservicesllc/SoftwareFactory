import {
  toPortalDocumentView,
  type CrmPortalDocumentRow,
} from "@/lib/services/crm";
import { jsonNoStore } from "@/lib/server/http";
import { portalErrorResponse, requirePortalUser } from "@/lib/server/customer-portal";

export const runtime = "nodejs";

/**
 * The customer's own paperwork. Internal photographs and staff
 * correspondence are not in the projection at all.
 */
export async function GET() {
  try {
    const { client } = await requirePortalUser();
    const { data, error } = await client.rpc("crm_portal_documents");
    if (error) throw error;

    const documents = ((data ?? []) as CrmPortalDocumentRow[]).map(toPortalDocumentView);

    return jsonNoStore({
      documents,
      counts: { total: documents.length },
      /*
       * A storage path is not a link. No object-storage provider is
       * connected to this project, so nothing here can be downloaded yet
       * and the portal says so rather than rendering a dead anchor.
       */
      download: { available: false, label: "Not Connected" },
    });
  } catch (error) {
    return portalErrorResponse(error, "portal_documents_unavailable", "Your documents could not be loaded.");
  }
}
