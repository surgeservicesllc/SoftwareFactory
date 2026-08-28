import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A deliberately thin Stripe client: three calls (create customer, create
 * checkout session, create portal session) and a webhook verifier, over
 * Stripe's documented form-encoded REST surface.
 *
 * Thin on purpose. The full SDK would be a fourth provider dependency for
 * three endpoints, and every request here must be inspectable in a test —
 * the fake transport below is the whole seam. No Stripe call ever runs in
 * the browser; this file is server-only and the publishable key does not
 * exist in this codebase at all (Checkout is Stripe-hosted, reached by
 * redirect).
 */

const STRIPE_API = "https://api.stripe.com/v1";

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("Payments are not connected: the Stripe secret key is not configured.");
    this.name = "StripeNotConfiguredError";
  }
}

export class StripeRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "StripeRequestError";
    this.status = status;
  }
}

export type StripeTransport = (
  path: string,
  body: URLSearchParams,
  secretKey: string,
) => Promise<{ status: number; json: unknown }>;

const realTransport: StripeTransport = async (path, body, secretKey) => {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
};

function secretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new StripeNotConfiguredError();
  return key;
}

async function post(
  path: string,
  fields: Record<string, string>,
  transport: StripeTransport,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(fields);
  const { status, json } = await transport(path, body, secretKey());
  if (status >= 400 || json === null || typeof json !== "object") {
    const message =
      json !== null && typeof json === "object" && "error" in json
        && typeof (json as { error?: { message?: string } }).error?.message === "string"
        ? (json as { error: { message: string } }).error.message
        : `Stripe returned ${status}.`;
    throw new StripeRequestError(status, message);
  }
  return json as Record<string, unknown>;
}

/** Create a Stripe customer carrying the organization id as metadata. */
export async function createStripeCustomer(
  input: { organizationId: string; organizationName: string; email: string },
  transport: StripeTransport = realTransport,
): Promise<string> {
  const customer = await post(
    "/customers",
    {
      name: input.organizationName,
      email: input.email,
      "metadata[organization_id]": input.organizationId,
    },
    transport,
  );
  const id = customer.id;
  if (typeof id !== "string" || !id.startsWith("cus_")) {
    throw new StripeRequestError(502, "Stripe did not return a customer id.");
  }
  return id;
}

/** Create a subscription Checkout Session; the caller redirects to its url. */
export async function createCheckoutSession(
  input: {
    customerId: string;
    priceId: string;
    organizationId: string;
    successUrl: string;
    cancelUrl: string;
  },
  transport: StripeTransport = realTransport,
): Promise<string> {
  const session = await post(
    "/checkout/sessions",
    {
      mode: "subscription",
      customer: input.customerId,
      "line_items[0][price]": input.priceId,
      "line_items[0][quantity]": "1",
      client_reference_id: input.organizationId,
      "subscription_data[metadata][organization_id]": input.organizationId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    },
    transport,
  );
  const url = session.url;
  if (typeof url !== "string" || !url.startsWith("https://")) {
    throw new StripeRequestError(502, "Stripe did not return a checkout URL.");
  }
  return url;
}

/** Create a customer-portal session so a customer can manage or cancel. */
export async function createPortalSession(
  input: { customerId: string; returnUrl: string },
  transport: StripeTransport = realTransport,
): Promise<string> {
  const session = await post(
    "/billing_portal/sessions",
    { customer: input.customerId, return_url: input.returnUrl },
    transport,
  );
  const url = session.url;
  if (typeof url !== "string" || !url.startsWith("https://")) {
    throw new StripeRequestError(502, "Stripe did not return a portal URL.");
  }
  return url;
}

/**
 * Verify a Stripe webhook signature (the `Stripe-Signature` header scheme:
 * `t=<unix>,v1=<hmac>` where the hmac is SHA-256 over `<t>.<raw body>`).
 *
 * Returns the parsed event on success and null on any failure — a webhook
 * endpoint must never leak *why* verification failed. Tolerance bounds the
 * replay window the scheme is designed to close.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  signingSecret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): Record<string, unknown> | null {
  if (!signatureHeader) return null;

  let timestamp: number | null = null;
  const candidates: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key?.trim() === "t" && value && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    if (key?.trim() === "v1" && value && /^[0-9a-f]{64}$/.test(value)) candidates.push(value);
  }
  if (timestamp === null || candidates.length === 0) return null;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return null;

  const expected = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const matches = candidates.some((candidate) => {
    const candidateBuffer = Buffer.from(candidate, "hex");
    return candidateBuffer.length === expectedBuffer.length
      && timingSafeEqual(candidateBuffer, expectedBuffer);
  });
  if (!matches) return null;

  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
