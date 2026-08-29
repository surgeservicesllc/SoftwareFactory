import { createClient } from "@supabase/supabase-js";

import { verifyStripeSignature } from "@/lib/billing/stripe";
import { handleStripeEvent } from "@/lib/billing/webhook";
import { getSupabaseServiceRoleKey } from "@/lib/github/config";
import { jsonNoStore } from "@/lib/server/http";
import { getSupabasePublicEnvironment } from "@/lib/supabase/env";

export const runtime = "nodejs";

const MAX_EVENT_BYTES = 256 * 1024;

/**
 * Stripe's webhook endpoint: the only writer of subscription state.
 *
 * Verification before parsing, service-role only after verification, and a
 * uniform 400 for anything unverifiable — the response never explains which
 * check failed. This is the same posture as the GitHub webhook one directory
 * over, and it reuses that route's service-role guard so a misconfigured
 * key fails closed here too.
 */
export async function POST(request: Request) {
  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!signingSecret || !signingSecret.startsWith("whsec_")) {
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

  const rawBody = await request.text();
  if (rawBody.length > MAX_EVENT_BYTES) {
    return jsonNoStore({ error: { code: "payload_too_large" } }, { status: 413 });
  }

  const event = verifyStripeSignature(
    rawBody,
    request.headers.get("stripe-signature"),
    signingSecret,
  );
  if (!event) {
    return jsonNoStore({ error: { code: "invalid_signature" } }, { status: 400 });
  }

  try {
    const { url } = getSupabasePublicEnvironment();
    const client = createClient(url, getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const result = await handleStripeEvent(client, event);
    return jsonNoStore({ received: true, outcome: result.outcome });
  } catch {
    // A processing failure must return non-2xx so Stripe retries the
    // delivery; the ledger's idempotency makes the retry safe.
    return jsonNoStore({ error: { code: "processing_failed" } }, { status: 500 });
  }
}
