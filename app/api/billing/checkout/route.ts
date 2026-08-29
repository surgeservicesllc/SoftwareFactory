import { z } from "zod";

import {
  billingSecretConfigured,
  planByKey,
  resolvePriceId,
  webhookSecretConfigured,
} from "@/lib/billing/plans";
import {
  createCheckoutSession,
  createStripeCustomer,
  StripeRequestError,
} from "@/lib/billing/stripe";
import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const checkoutSchema = z
  .object({
    plan: z.enum(["basic", "pro"]),
    cadence: z.enum(["monthly", "yearly"]),
  })
  .strict();

/**
 * Start a subscription checkout for the active organization.
 *
 * The browser receives one thing: a Stripe-hosted URL to redirect to. No
 * payment detail, card field, or Stripe key ever exists in this
 * application's pages — Checkout is where the money part happens, on
 * Stripe's origin. When payments are not configured the route says so
 * plainly instead of manufacturing a dead redirect.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    // The webhook secret is part of "can charge": a checkout that charges
    // while the mirror cannot hear about it takes money without granting.
    if (!billingSecretConfigured() || !webhookSecretConfigured()) {
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

    const parsed = checkoutSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_checkout", message: "Choose a purchasable plan and cadence." } },
        { status: 400 },
      );
    }

    const plan = planByKey(parsed.data.plan);
    const priceId = plan?.selfServe
      ? await resolvePriceId(plan.key, parsed.data.cadence)
      : null;
    if (!plan || !priceId) {
      return jsonNoStore(
        {
          error: {
            code: "plan_not_purchasable",
            message: "That plan is not purchasable on this deployment.",
          },
        },
        { status: 409 },
      );
    }

    const { activeOrganization, client, user } = await requireActiveOrganization();
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

    // One Stripe customer per organization, recorded through the definer
    // function so the mapping is membership-checked and insert-once.
    const { data: existing, error: readError } = await client
      .from("billing_customers")
      .select("stripe_customer_id")
      .eq("organization_id", activeOrganization.id)
      .maybeSingle();
    if (readError) {
      return jsonNoStore(
        { error: { code: "billing_read_failed", message: "Billing state could not be read." } },
        { status: 500 },
      );
    }

    let customerId = (existing as { stripe_customer_id?: string } | null)?.stripe_customer_id ?? null;
    if (!customerId) {
      customerId = await createStripeCustomer({
        organizationId: activeOrganization.id,
        organizationName: activeOrganization.name,
        email: user.email ?? "",
      });
      const { error: linkError } = await client.rpc("ensure_billing_customer", {
        p_organization_id: activeOrganization.id,
        p_stripe_customer_id: customerId,
      });
      if (linkError) {
        return jsonNoStore(
          {
            error: {
              code: "billing_link_failed",
              message: "The billing customer could not be linked to this organization.",
            },
          },
          { status: 500 },
        );
      }
    }

    const origin = new URL(request.url).origin;
    const url = await createCheckoutSession({
      customerId,
      priceId,
      organizationId: activeOrganization.id,
      successUrl: `${origin}/solutions/billing?checkout=success`,
      cancelUrl: `${origin}/pricing?checkout=cancelled`,
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
