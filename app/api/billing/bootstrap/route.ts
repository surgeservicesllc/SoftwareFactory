import { isSuperAdmin } from "@/lib/auth/super-admin";
import { bootstrapStripeCatalog } from "@/lib/billing/bootstrap";
import { billingSecretConfigured } from "@/lib/billing/plans";
import { StripeRequestError } from "@/lib/billing/stripe";
import { ApiRequestError, jsonNoStore, requestErrorResponse } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * One click of Stripe account setup, for the deployment's super
 * administrator only.
 *
 * Organization owners cannot reach this: the Stripe account belongs to the
 * platform, not to a tenant, and a tenant owner clicking "set up payments"
 * would be writing products into someone else's account. `isSuperAdmin`
 * (SUPER_ADMIN_EMAILS, confirmed email) is the same authority the admin
 * page uses.
 *
 * Idempotent by construction — see lib/billing/bootstrap.ts. The response
 * may carry the webhook signing secret exactly once (when the endpoint was
 * created in this pass); it goes to the caller's screen and is never logged
 * or stored server-side.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const { user } = await requireActiveOrganization();
    if (!isSuperAdmin(user.email, Boolean(user.email_confirmed_at))) {
      return jsonNoStore(
        {
          error: {
            code: "super_admin_required",
            message: "Only the deployment's super administrator can set up payments.",
          },
        },
        { status: 403 },
      );
    }

    if (!billingSecretConfigured()) {
      return jsonNoStore(
        {
          error: {
            code: "billing_not_connected",
            message:
              "Add STRIPE_SECRET_KEY to the deployment first; the bootstrap uses it to create everything else.",
          },
        },
        { status: 503 },
      );
    }

    const origin = new URL(request.url).origin;
    const result = await bootstrapStripeCatalog(origin);
    return jsonNoStore(result);
  } catch (error) {
    if (error instanceof StripeRequestError) {
      return jsonNoStore(
        { error: { code: "stripe_error", message: error.message } },
        { status: 502 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "billing_unavailable", message: "Billing is unavailable right now." } },
      { status: 500 },
    );
  }
}
