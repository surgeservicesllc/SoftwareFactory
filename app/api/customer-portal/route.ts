import {
  toPortalSummaryView,
  type CrmPortalSummaryRow,
} from "@/lib/services/crm";
import { jsonNoStore } from "@/lib/server/http";
import { portalErrorResponse, requirePortalUser } from "@/lib/server/customer-portal";

export const runtime = "nodejs";

/**
 * The customer's landing read: who they are, what they owe, and when
 * somebody is next coming.
 */
export async function GET() {
  try {
    const { client, identity } = await requirePortalUser();

    const { data, error } = await client.rpc("crm_portal_summary");
    if (error) throw error;

    const row = ((data ?? []) as CrmPortalSummaryRow[])[0];
    if (!row) {
      // A live portal link whose account has gone. Nothing to show, and
      // saying so is more honest than an empty dashboard of zeroes.
      return jsonNoStore(
        { error: { code: "portal_account_unavailable", message: "This account is no longer available." } },
        { status: 404 },
      );
    }

    // Records the visit on the caller's own row. A failure here is not the
    // customer's problem — the page is still correct without it.
    await client.rpc("crm_portal_touch");

    return jsonNoStore({
      role: identity.role,
      summary: toPortalSummaryView(row),
    });
  } catch (error) {
    return portalErrorResponse(error, "portal_summary_unavailable", "Your account could not be loaded.");
  }
}
