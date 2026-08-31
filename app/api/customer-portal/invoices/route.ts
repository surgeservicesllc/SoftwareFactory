import {
  toPortalInvoiceView,
  type CrmPortalInvoiceRow,
} from "@/lib/services/crm";
import { jsonNoStore } from "@/lib/server/http";
import { portalErrorResponse, requirePortalUser } from "@/lib/server/customer-portal";

export const runtime = "nodejs";

/**
 * The customer's invoices. Drafts are absent from the projection: an
 * invoice that has not been issued has not been issued to anybody.
 */
export async function GET() {
  try {
    const { client } = await requirePortalUser();
    const { data, error } = await client.rpc("crm_portal_invoices");
    if (error) throw error;

    const invoices = ((data ?? []) as CrmPortalInvoiceRow[]).map((row) => toPortalInvoiceView(row));

    return jsonNoStore({
      invoices,
      counts: {
        total: invoices.length,
        open: invoices.filter((invoice) => invoice.status === "open").length,
        overdue: invoices.filter((invoice) => invoice.overdue).length,
        balanceCents: invoices.reduce((sum, invoice) => sum + invoice.balanceCents, 0),
      },
      /*
       * There is no card processor connected to this project, so the
       * portal states the balance and stops. A "Pay now" button that could
       * not take a payment would be worse than no button.
       */
      payment: { available: false, label: "Not Connected" },
    });
  } catch (error) {
    return portalErrorResponse(error, "portal_invoices_unavailable", "Your invoices could not be loaded.");
  }
}
