// @vitest-environment node

import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  createStripeCustomer: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  handleStripeEvent: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));
vi.mock("@/lib/billing/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/stripe")>()),
  createStripeCustomer: harness.createStripeCustomer,
  createCheckoutSession: harness.createCheckoutSession,
  createPortalSession: harness.createPortalSession,
}));
vi.mock("@/lib/billing/webhook", () => ({ handleStripeEvent: harness.handleStripeEvent }));
vi.mock("@supabase/supabase-js", () => ({ createClient: harness.createClient }));

import { POST as checkout } from "@/app/api/billing/checkout/route";
import { POST as portal } from "@/app/api/billing/portal/route";
import { POST as webhook } from "@/app/api/billing/webhook/route";

const ORG = "33333333-3333-4333-8333-333333333333";

function connectStripeEnv() {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abcdefgh12345678");
  vi.stubEnv("STRIPE_PRICE_BASIC_MONTHLY", "price_Basic123M");
  vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_Pro123M");
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`https://factory.example${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: new Headers({
      "Content-Type": "application/json",
      Origin: "https://factory.example",
    }),
  });
}

function tenantWith(options: {
  role?: string;
  customerId?: string | null;
  rpcError?: { message: string } | null;
} = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: options.rpcError ?? null });
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({
      data:
        options.customerId === undefined || options.customerId === null
          ? null
          : { stripe_customer_id: options.customerId },
      error: null,
    });
  const client = {
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  };
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: ORG, name: "Acme", role: options.role ?? "owner" },
    client,
    user: { id: "user-1", email: "owner@example.org" },
  });
  return { rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/billing/checkout", () => {
  it("says Not Connected when no Stripe configuration exists", async () => {
    const response = await checkout(jsonRequest("/api/billing/checkout", { plan: "pro", cadence: "monthly" }));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("billing_not_connected");
  });

  it("requires owner or admin", async () => {
    connectStripeEnv();
    tenantWith({ role: "member" });
    const response = await checkout(jsonRequest("/api/billing/checkout", { plan: "pro", cadence: "monthly" }));
    expect(response.status).toBe(403);
  });

  it("creates the customer once, links it through the definer, and returns the checkout url", async () => {
    connectStripeEnv();
    const { rpc } = tenantWith({ customerId: null });
    harness.createStripeCustomer.mockResolvedValue("cus_new1");
    harness.createCheckoutSession.mockResolvedValue("https://checkout.stripe.com/c/cs_1");

    const response = await checkout(jsonRequest("/api/billing/checkout", { plan: "pro", cadence: "monthly" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ url: "https://checkout.stripe.com/c/cs_1" });

    expect(harness.createStripeCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, organizationName: "Acme" }),
    );
    expect(rpc).toHaveBeenCalledWith("ensure_billing_customer", {
      p_organization_id: ORG,
      p_stripe_customer_id: "cus_new1",
    });
    expect(harness.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_new1", priceId: "price_Pro123M" }),
    );
  });

  it("reuses an existing customer without touching Stripe's customer API", async () => {
    connectStripeEnv();
    tenantWith({ customerId: "cus_existing" });
    harness.createCheckoutSession.mockResolvedValue("https://checkout.stripe.com/c/cs_2");

    const response = await checkout(jsonRequest("/api/billing/checkout", { plan: "basic", cadence: "monthly" }));
    expect(response.status).toBe(200);
    expect(harness.createStripeCustomer).not.toHaveBeenCalled();
  });

  it("refuses a cadence with no configured price", async () => {
    connectStripeEnv(); // yearly prices deliberately unset
    tenantWith({});
    const response = await checkout(jsonRequest("/api/billing/checkout", { plan: "pro", cadence: "yearly" }));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("plan_not_purchasable");
  });

  it("rejects plans that are not self-serve at the schema", async () => {
    connectStripeEnv();
    tenantWith({});
    const response = await checkout(jsonRequest("/api/billing/checkout", { plan: "enterprise", cadence: "monthly" }));
    expect(response.status).toBe(400);
  });
});

describe("POST /api/billing/portal", () => {
  it("routes to the customer portal for an organization with a customer", async () => {
    connectStripeEnv();
    tenantWith({ customerId: "cus_existing" });
    harness.createPortalSession.mockResolvedValue("https://billing.stripe.com/p/s_1");

    const response = await portal(jsonRequest("/api/billing/portal", {}));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ url: "https://billing.stripe.com/p/s_1" });
  });

  it("names the missing customer instead of failing opaquely", async () => {
    connectStripeEnv();
    tenantWith({ customerId: null });
    const response = await portal(jsonRequest("/api/billing/portal", {}));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("billing_customer_missing");
  });
});

describe("POST /api/billing/webhook", () => {
  const secret = "whsec_route_secret";

  function signedRequest(body: string, headerSecret = secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    const mac = createHmac("sha256", headerSecret).update(`${timestamp}.${body}`, "utf8").digest("hex");
    return new Request("https://factory.example/api/billing/webhook", {
      method: "POST",
      body,
      headers: new Headers({ "stripe-signature": `t=${timestamp},v1=${mac}` }),
    });
  }

  it("says Not Connected without a signing secret", async () => {
    const response = await webhook(signedRequest("{}"));
    expect(response.status).toBe(503);
  });

  it("rejects a bad signature without explaining which check failed", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
    const response = await webhook(signedRequest(JSON.stringify({ id: "evt_1" }), "whsec_wrong"));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_signature");
    expect(harness.handleStripeEvent).not.toHaveBeenCalled();
  });

  it("processes a verified event through the mirror with a service client", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test1234567890");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test1234567890");
    harness.createClient.mockReturnValue({ from: vi.fn() });
    harness.handleStripeEvent.mockResolvedValue({ outcome: "subscription_mirrored", organizationId: "org" });

    const body = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated", data: { object: {} } });
    const response = await webhook(signedRequest(body));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, outcome: "subscription_mirrored" });
  });

  it("returns 500 on a processing failure so Stripe retries", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test1234567890");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test1234567890");
    harness.createClient.mockReturnValue({ from: vi.fn() });
    harness.handleStripeEvent.mockRejectedValue(new Error("db down"));

    const body = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated", data: { object: {} } });
    const response = await webhook(signedRequest(body));
    expect(response.status).toBe(500);
  });
});
