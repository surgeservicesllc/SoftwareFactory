// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  billingConnected,
  describeBillingConfiguration,
  PLANS,
  planByKey,
  planForPriceId,
  priceIdFor,
} from "@/lib/billing/plans";

/**
 * The catalog's obligations: it covers exactly the plans the storefront has
 * advertised since 20260813000500, prices come only from the environment, and
 * "connected" is true only when a charge could actually happen.
 */

const PRICE_VARS = [
  "STRIPE_PRICE_BASIC_MONTHLY",
  "STRIPE_PRICE_BASIC_YEARLY",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_PRO_YEARLY",
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

function clearBillingEnv() {
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
  for (const name of PRICE_VARS) vi.stubEnv(name, "");
}

describe("the plan catalog", () => {
  it("carries every advertised marketing slug", () => {
    expect(Object.keys(PLANS).sort()).toEqual(["basic", "enterprise", "free", "pro"]);
  });

  it("keeps free within the published matrix: 1 user, 1 project", () => {
    expect(PLANS.free.entitlements.maxSeats).toBe(1);
    expect(PLANS.free.entitlements.maxProjects).toBe(1);
    expect(PLANS.free.selfServe).toBe(false);
  });

  it("orders paid entitlements strictly above free", () => {
    for (const key of ["basic", "pro"] as const) {
      const paid = PLANS[key].entitlements;
      expect(paid.maxProjects).toBeGreaterThan(PLANS.free.entitlements.maxProjects);
      expect(paid.graphLaunchesPerMonth).toBeGreaterThan(PLANS.free.entitlements.graphLaunchesPerMonth);
      expect(paid.maxSeats).toBeGreaterThan(PLANS.free.entitlements.maxSeats);
    }
    expect(PLANS.pro.entitlements.graphLaunchesPerMonth)
      .toBeGreaterThan(PLANS.basic.entitlements.graphLaunchesPerMonth);
  });

  it("rejects unknown keys", () => {
    expect(planByKey("platinum")).toBeNull();
    expect(planByKey("")).toBeNull();
  });
});

describe("price resolution", () => {
  it("returns null for unset or malformed price env vars", () => {
    clearBillingEnv();
    expect(priceIdFor("basic", "monthly")).toBeNull();
    vi.stubEnv("STRIPE_PRICE_BASIC_MONTHLY", "not-a-price-id");
    expect(priceIdFor("basic", "monthly")).toBeNull();
  });

  it("resolves and reverse-resolves a configured price", () => {
    clearBillingEnv();
    vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", "price_123ProYearly");
    expect(priceIdFor("pro", "yearly")).toBe("price_123ProYearly");
    expect(planForPriceId("price_123ProYearly")).toEqual({ plan: "pro", cadence: "yearly" });
    expect(planForPriceId("price_unknown")).toBeNull();
  });

  it("never sells free or enterprise", () => {
    expect(priceIdFor("free", "monthly")).toBeNull();
    expect(priceIdFor("enterprise", "monthly")).toBeNull();
  });
});

describe("billingConnected", () => {
  it("is false with no secret key, a malformed key, or no prices", () => {
    clearBillingEnv();
    expect(billingConnected()).toBe(false);

    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_realEnoughKey123");
    expect(billingConnected()).toBe(false); // no prices

    clearBillingEnv();
    vi.stubEnv("STRIPE_SECRET_KEY", "not-a-stripe-key");
    vi.stubEnv("STRIPE_PRICE_BASIC_MONTHLY", "price_abc123");
    expect(billingConnected()).toBe(false);
  });

  it("stays false without the webhook secret: charging while the mirror is deaf takes money without granting", () => {
    clearBillingEnv();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abcdefgh12345678");
    vi.stubEnv("STRIPE_PRICE_BASIC_MONTHLY", "price_abc123");
    expect(billingConnected()).toBe(false);
  });

  it("is true with secret key, webhook secret, and at least one price", () => {
    clearBillingEnv();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abcdefgh12345678");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_abcdefgh12345678");
    vi.stubEnv("STRIPE_PRICE_BASIC_MONTHLY", "price_abc123");
    expect(billingConnected()).toBe(true);
  });
});

describe("describeBillingConfiguration", () => {
  it("names each missing or malformed piece without ever echoing a value", () => {
    clearBillingEnv();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const empty = describeBillingConfiguration();
    expect(empty.secretKey).toBe("missing");
    expect(empty.webhookSecret).toBe("missing");
    expect(empty.prices.pro.monthly).toBe(false);

    // The classic paste failure: quotes travel into Vercel with the value.
    vi.stubEnv("STRIPE_SECRET_KEY", '"sk_live_abcdefgh12345678"');
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_abcdefgh12345678");
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_Pro123");
    const quoted = describeBillingConfiguration();
    expect(quoted.secretKey).toBe("malformed");
    expect(quoted.webhookSecret).toBe("ok");
    expect(quoted.prices.pro.monthly).toBe(true);

    // A publishable key where the secret belongs is malformed, not ok.
    vi.stubEnv("STRIPE_SECRET_KEY", "pk_live_abcdefgh12345678");
    expect(describeBillingConfiguration().secretKey).toBe("malformed");

    vi.stubEnv("STRIPE_SECRET_KEY", "rk_live_abcdefgh12345678");
    expect(describeBillingConfiguration().secretKey).toBe("ok");

    // Never a value, only shapes.
    expect(JSON.stringify(describeBillingConfiguration())).not.toContain("rk_live");
  });
});
