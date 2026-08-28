// @vitest-environment node

import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createCheckoutSession,
  createPortalSession,
  createStripeCustomer,
  StripeNotConfiguredError,
  StripeRequestError,
  verifyStripeSignature,
  type StripeTransport,
} from "@/lib/billing/stripe";

afterEach(() => {
  vi.unstubAllEnvs();
});

function sign(body: string, secret: string, timestamp: number): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

describe("verifyStripeSignature", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated" });
  const now = 1_756_000_000;

  it("accepts a correctly signed, fresh payload", () => {
    const event = verifyStripeSignature(body, sign(body, secret, now), secret, now);
    expect(event).toEqual({ id: "evt_1", type: "customer.subscription.updated" });
  });

  it("rejects a missing header, a bad signature, and a tampered body", () => {
    expect(verifyStripeSignature(body, null, secret, now)).toBeNull();
    expect(verifyStripeSignature(body, sign(body, "whsec_other", now), secret, now)).toBeNull();
    expect(
      verifyStripeSignature(body.replace("evt_1", "evt_2"), sign(body, secret, now), secret, now),
    ).toBeNull();
  });

  it("rejects a replay outside the tolerance window in either direction", () => {
    expect(verifyStripeSignature(body, sign(body, secret, now - 301), secret, now)).toBeNull();
    expect(verifyStripeSignature(body, sign(body, secret, now + 301), secret, now)).toBeNull();
    expect(verifyStripeSignature(body, sign(body, secret, now - 299), secret, now)).not.toBeNull();
  });

  it("accepts any valid v1 candidate among several (key-roll window)", () => {
    const stale = sign(body, "whsec_old", now).split(",")[1];
    const good = sign(body, secret, now);
    const header = `${good.split(",")[0]},${stale},${good.split(",")[1]}`;
    expect(verifyStripeSignature(body, header, secret, now)).not.toBeNull();
  });

  it("rejects a signed payload that is not a JSON object", () => {
    const arrayBody = JSON.stringify([1, 2, 3]);
    expect(verifyStripeSignature(arrayBody, sign(arrayBody, secret, now), secret, now)).toBeNull();
  });
});

describe("the thin Stripe client", () => {
  function transportReturning(json: unknown, status = 200): StripeTransport & {
    calls: Array<{ path: string; body: URLSearchParams }>;
  } {
    const calls: Array<{ path: string; body: URLSearchParams }> = [];
    const transport: StripeTransport = async (path, body) => {
      calls.push({ path, body });
      return { status, json };
    };
    return Object.assign(transport, { calls });
  }

  it("refuses to call Stripe with no secret key", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    await expect(
      createStripeCustomer(
        { organizationId: "org", organizationName: "Org", email: "o@example.org" },
        transportReturning({ id: "cus_1" }),
      ),
    ).rejects.toBeInstanceOf(StripeNotConfiguredError);
  });

  it("creates a customer carrying the organization id as metadata", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abcdefgh12345678");
    const transport = transportReturning({ id: "cus_42" });
    const id = await createStripeCustomer(
      { organizationId: "11111111-1111-4111-8111-111111111111", organizationName: "Acme", email: "a@example.org" },
      transport,
    );
    expect(id).toBe("cus_42");
    expect(transport.calls[0].path).toBe("/customers");
    expect(transport.calls[0].body.get("metadata[organization_id]"))
      .toBe("11111111-1111-4111-8111-111111111111");
  });

  it("creates a subscription checkout session and returns its url", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abcdefgh12345678");
    const transport = transportReturning({ url: "https://checkout.stripe.com/c/pay/cs_1" });
    const url = await createCheckoutSession(
      {
        customerId: "cus_42",
        priceId: "price_1",
        organizationId: "org-1",
        successUrl: "https://app.example/billing?checkout=success",
        cancelUrl: "https://app.example/pricing",
      },
      transport,
    );
    expect(url).toContain("https://checkout.stripe.com/");
    const body = transport.calls[0].body;
    expect(transport.calls[0].path).toBe("/checkout/sessions");
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("line_items[0][price]")).toBe("price_1");
    expect(body.get("subscription_data[metadata][organization_id]")).toBe("org-1");
  });

  it("creates a portal session", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abcdefgh12345678");
    const transport = transportReturning({ url: "https://billing.stripe.com/p/session_1" });
    const url = await createPortalSession(
      { customerId: "cus_42", returnUrl: "https://app.example/billing" },
      transport,
    );
    expect(url).toBe("https://billing.stripe.com/p/session_1");
  });

  it("surfaces Stripe's own error message on a 4xx", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abcdefgh12345678");
    const transport = transportReturning({ error: { message: "No such price: price_x" } }, 400);
    await expect(
      createPortalSession({ customerId: "cus_42", returnUrl: "https://app.example" }, transport),
    ).rejects.toMatchObject({ message: "No such price: price_x", status: 400 });
  });

  it("treats a 200 with no url as an upstream fault, not a success", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abcdefgh12345678");
    await expect(
      createPortalSession(
        { customerId: "cus_42", returnUrl: "https://app.example" },
        transportReturning({}),
      ),
    ).rejects.toBeInstanceOf(StripeRequestError);
  });
});
