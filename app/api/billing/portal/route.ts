import { createPortalSession, StripeRequestError } from "@/lib/billing/stripe";
import { billingConnected } from "@/lib/billing/plans";
import { ApiRequestError, jsonNoStore, requestErrorResponse } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Open the Stripe customer portal for the active organization, where the
 * customer updates cards, changes plans, and cancels. Cancellation living on
 * Stripe's portal rather than behind a custom flow is deliberate: the state
 * this application holds is a mirror, and the mirror must never be the only
 * place a customer can stop paying.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    if (!billingConnected()) {
      return jsonNoStore(
        {
          error: {
            code: "billing_not_connected",
            message: "Payments are Not Connected on this deployment.",
          },
        },
        { status: 503 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (!(["owner", "admin"] as const).includes(activeOrganization.role as "owner" | "admin")) {
      return jsonNoStore(
        {
          error: {
            code: "billing_management_forbidden",
            message: "Organization owner or administrator access is required to manage billing.",
          },
        },
        { status: 403 },
      );
    }

    const { data, error } = await client
      .from("billing_customers")
      .select("stripe_customer_id")
      .eq("organization_id", activeOrganization.id)
      .maybeSingle();
    if (error) {
      return jsonNoStore(
        { error: { code: "billing_read_failed", message: "Billing state could not be read." } },
        { status: 500 },
      );
    }
    const customerId = (data as { stripe_customer_id?: string } | null)?.stripe_customer_id;
    if (!customerId) {
      return jsonNoStore(
        {
          error: {
            code: "billing_customer_missing",
            message: "This organization has no billing customer yet. Choose a plan first.",
          },
        },
        { status: 409 },
      );
    }

    const origin = new URL(request.url).origin;
    const url = await createPortalSession({
      customerId,
      returnUrl: `${origin}/solutions/billing`,
    });
    return jsonNoStore({ url });
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
