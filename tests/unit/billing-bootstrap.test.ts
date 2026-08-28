// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { bootstrapStripeCatalog, WEBHOOK_EVENTS } from "@/lib/billing/bootstrap";
import {
  PRICE_LOOKUP_KEYS,
  resetPriceLookupCache,
  resolvePriceId,
  resolvePurchasablePlans,
} from "@/lib/billing/plans";
import type { StripeTransport } from "@/lib/billing/stripe";

/**
 * The self-service Stripe setup: idempotent by lookup key and webhook URL,
 * the signing secret surfaces only on creation, and afterwards the price
 * resolver finds everything with zero per-price environment variables.
 */

const ORIGIN = "https://www.theagoras.com";

type Call = { path: string; method: string; fields: Record<string, string> };

/** A fake Stripe account: starts with the given prices/webhooks, accepts creates. */
function fakeStripe(initial: {
  pricesByLookupKey?: Record<string, string>;
  webhookUrls?: string[];
} = {}) {
  const prices = { ...(initial.pricesByLookupKey ?? {}) };
  const webhooks = [...(initial.webhookUrls ?? [])];
  const calls: Call[] = [];
  let sequence = 0;

  const transport: StripeTransport = async (path, body, _secret, method = "POST") => {
    const fields = Object.fromEntries(body.entries());
    calls.push({ path, method, fields });

    if (method === "GET" && path === "/prices") {
      const wanted = Object.entries(fields)
        .filter(([key]) => key.startsWith("lookup_keys"))
        .map(([, value]) => value);
      return {
        status: 200,
        json: {
          data: wanted
            .filter((key) => prices[key])
            .map((key) => ({ id: prices[key], lookup_key: key })),
        },
      };
    }
    if (method === "GET" && path === "/webhook_endpoints") {
      return {
        status: 200,
        json: { data: webhooks.map((url, index) => ({ id: `we_${index}`, url })) },
      };
    }
    if (path === "/products") {
      return { status: 200, json: { id: `prod_${++sequence}` } };
    }
    if (path === "/prices") {
      const id = `price_New${++sequence}`;
      prices[fields.lookup_key] = id;
      return { status: 200, json: { id } };
    }
    if (path === "/webhook_endpoints") {
      webhooks.push(fields.url);
      return { status: 200, json: { id: `we_new${++sequence}`, secret: "whsec_shownOnce123456" } };
    }
    throw new Error(`Unexpected Stripe call ${method} ${path}`);
  };

  return { transport, calls, prices, webhooks };
}

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abcdefgh12345678");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_abcdefgh12345678");
  for (const name of [
    "STRIPE_PRICE_BASIC_MONTHLY", "STRIPE_PRICE_BASIC_YEARLY",
    "STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_PRO_YEARLY",
  ]) vi.stubEnv(name, "");
  resetPriceLookupCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetPriceLookupCache();
});

describe("bootstrapStripeCatalog", () => {
  it("creates two products, four prices, and the webhook on a bare account", async () => {
    const stripe = fakeStripe();
    const result = await bootstrapStripeCatalog(ORIGIN, stripe.transport);

    expect(result.prices).toHaveLength(4);
    expect(result.prices.every((price) => price.created)).toBe(true);
    expect(new Set(result.prices.map((price) => price.lookupKey)))
      .toEqual(new Set(Object.values(PRICE_LOOKUP_KEYS)));

    expect(result.webhook.created).toBe(true);
    expect(result.webhook.url).toBe(`${ORIGIN}/api/billing/webhook`);
    expect(result.webhook.signingSecret).toBe("whsec_shownOnce123456");

    const productCreates = stripe.calls.filter(
      (call) => call.path === "/products" && call.method === "POST",
    );
    expect(productCreates).toHaveLength(2);

    const webhookCreate = stripe.calls.find(
      (call) => call.path === "/webhook_endpoints" && call.method === "POST",
    );
    WEBHOOK_EVENTS.forEach((event, index) => {
      expect(webhookCreate?.fields[`enabled_events[${index}]`]).toBe(event);
    });
  });

  it("is idempotent: a second pass finds everything and creates nothing", async () => {
    const stripe = fakeStripe();
    await bootstrapStripeCatalog(ORIGIN, stripe.transport);
    const before = stripe.calls.length;

    const second = await bootstrapStripeCatalog(ORIGIN, stripe.transport);
    expect(second.prices.every((price) => !price.created)).toBe(true);
    expect(second.webhook.created).toBe(false);
    // The show-once secret does not resurface on the found path.
    expect(second.webhook.signingSecret).toBeUndefined();

    const creates = stripe.calls.slice(before).filter((call) => call.method === "POST");
    expect(creates).toHaveLength(0);
  });

  it("fills only the gaps when part of the catalog already exists", async () => {
    const stripe = fakeStripe({
      pricesByLookupKey: {
        factory_basic_monthly: "price_KeptBasicM",
        factory_pro_monthly: "price_KeptProM",
      },
      webhookUrls: [`${ORIGIN}/api/billing/webhook`],
    });
    const result = await bootstrapStripeCatalog(ORIGIN, stripe.transport);

    const kept = result.prices.filter((price) => !price.created);
    expect(kept.map((price) => price.priceId).sort())
      .toEqual(["price_KeptBasicM", "price_KeptProM"]);
    expect(result.prices.filter((price) => price.created)).toHaveLength(2);
    expect(result.webhook.created).toBe(false);
  });
});

describe("lookup-key price resolution", () => {
  it("finds bootstrap-created prices with zero per-price env vars, and caches", async () => {
    const stripe = fakeStripe();
    await bootstrapStripeCatalog(ORIGIN, stripe.transport);

    const id = await resolvePriceId("pro", "monthly", stripe.transport);
    expect(id).toMatch(/^price_New/);

    const listsBefore = stripe.calls.filter((call) => call.method === "GET" && call.path === "/prices").length;
    await resolvePriceId("basic", "yearly", stripe.transport);
    const listsAfter = stripe.calls.filter((call) => call.method === "GET" && call.path === "/prices").length;
    expect(listsAfter).toBe(listsBefore); // served from the cache

    const { connected, purchasable } = await resolvePurchasablePlans(stripe.transport);
    expect(connected).toBe(true);
    expect(purchasable.pro.monthly).toBe(true);
  });

  it("prefers an env-var price over the lookup", async () => {
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_FromEnv123");
    const stripe = fakeStripe();
    expect(await resolvePriceId("pro", "monthly", stripe.transport)).toBe("price_FromEnv123");
    expect(stripe.calls).toHaveLength(0);
  });

  it("degrades to not-purchasable when the lookup fails, never to a crash", async () => {
    const failing: StripeTransport = async () => ({ status: 500, json: { error: { message: "down" } } });
    expect(await resolvePriceId("pro", "monthly", failing)).toBeNull();
  });
});
