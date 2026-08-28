import "server-only";

import {
  PLAN_AMOUNTS_CENTS,
  PRICE_LOOKUP_KEYS,
  resetPriceLookupCache,
  type BillingCadence,
} from "@/lib/billing/plans";
import {
  createStripePrice,
  createStripeProduct,
  createStripeWebhookEndpoint,
  listPricesByLookupKeys,
  listWebhookEndpoints,
  type StripeTransport,
} from "@/lib/billing/stripe";

/**
 * One idempotent pass that makes a bare Stripe account able to sell the
 * advertised plans: the Basic and Pro products with their four lookup-keyed
 * recurring prices, and the webhook endpoint pointed at this deployment.
 *
 * Everything is find-first: a price whose lookup key already exists is kept,
 * a webhook already aimed at the deployment's URL is kept, and running the
 * pass twice changes nothing. The one show-once value — the webhook signing
 * secret Stripe returns only at creation — travels in the response to the
 * super administrator's screen and nowhere else: not logged, not stored.
 */

export const WEBHOOK_EVENTS = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "checkout.session.completed",
] as const;

export type BootstrapResult = {
  readonly prices: ReadonlyArray<{
    readonly lookupKey: string;
    readonly priceId: string;
    readonly created: boolean;
  }>;
  readonly webhook: {
    readonly url: string;
    readonly created: boolean;
    /** Present only when the endpoint was created in this pass. Show once. */
    readonly signingSecret?: string;
  };
};

export async function bootstrapStripeCatalog(
  origin: string,
  transport?: StripeTransport,
): Promise<BootstrapResult> {
  const transportArgs = transport ? ([transport] as const) : ([] as const);

  const existing = new Map(
    (await listPricesByLookupKeys(Object.values(PRICE_LOOKUP_KEYS), ...transportArgs)).map(
      (row) => [row.lookupKey, row.id],
    ),
  );

  const prices: Array<{ lookupKey: string; priceId: string; created: boolean }> = [];
  const productIds = new Map<string, string>();

  for (const plan of ["basic", "pro"] as const) {
    for (const cadence of ["monthly", "yearly"] as const) {
      const lookupKey = PRICE_LOOKUP_KEYS[`${plan}:${cadence}`];
      const found = existing.get(lookupKey);
      if (found) {
        prices.push({ lookupKey, priceId: found, created: false });
        continue;
      }
      let productId = productIds.get(plan);
      if (!productId) {
        productId = await createStripeProduct(
          { name: plan === "basic" ? "Basic" : "Pro", planKey: plan },
          ...transportArgs,
        );
        productIds.set(plan, productId);
      }
      const priceId = await createStripePrice(
        {
          productId,
          unitAmountCents: PLAN_AMOUNTS_CENTS[plan][cadence as BillingCadence],
          interval: cadence === "monthly" ? "month" : "year",
          lookupKey,
        },
        ...transportArgs,
      );
      prices.push({ lookupKey, priceId, created: true });
    }
  }

  const webhookUrl = `${origin}/api/billing/webhook`;
  const endpoints = await listWebhookEndpoints(...transportArgs);
  const already = endpoints.find((endpoint) => endpoint.url === webhookUrl);

  let webhook: BootstrapResult["webhook"];
  if (already) {
    webhook = { url: webhookUrl, created: false };
  } else {
    const created = await createStripeWebhookEndpoint(
      { url: webhookUrl, events: WEBHOOK_EVENTS },
      ...transportArgs,
    );
    webhook = { url: webhookUrl, created: true, signingSecret: created.secret };
  }

  // New prices exist now; the next resolution pass must see them.
  resetPriceLookupCache();

  return { prices, webhook };
}
