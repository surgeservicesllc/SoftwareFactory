import {
  toPortalInspectionView,
  toPortalSafetyView,
  type CrmPortalInspectionRow,
  type CrmPortalSafetyRow,
} from "@/lib/services/crm";
import { jsonNoStore } from "@/lib/server/http";
import { portalErrorResponse, requirePortalUser } from "@/lib/server/customer-portal";

export const runtime = "nodejs";

/**
 * The binder: what was applied here and where its safety sheet is, and
 * what the completed inspections said. Two reads because an auditor asks
 * for them together and a page that loaded one without the other would
 * look complete while being half an answer.
 */
export async function GET() {
  try {
    const { client } = await requirePortalUser();

    const [safetyResult, inspectionResult] = await Promise.all([
      client.rpc("crm_portal_safety_library"),
      client.rpc("crm_portal_inspections"),
    ]);
    if (safetyResult.error) throw safetyResult.error;
    if (inspectionResult.error) throw inspectionResult.error;

    const products = ((safetyResult.data ?? []) as CrmPortalSafetyRow[]).map(toPortalSafetyView);
    const inspections = ((inspectionResult.data ?? []) as CrmPortalInspectionRow[]).map(
      toPortalInspectionView,
    );

    return jsonNoStore({
      products,
      inspections,
      counts: {
        products: products.length,
        restricted: products.filter((product) => product.restrictedUse).length,
        /*
         * Products applied here with no safety sheet recorded. Naming the
         * gap is the whole value of the library — an auditor will find it
         * either way, and finding it here first is the point.
         */
        missingSds: products.filter((product) => product.sdsUrl === null).length,
        inspections: inspections.length,
        signed: inspections.filter((inspection) => inspection.hasSignature).length,
      },
    });
  } catch (error) {
    return portalErrorResponse(error, "portal_compliance_unavailable", "Your compliance records could not be loaded.");
  }
}
