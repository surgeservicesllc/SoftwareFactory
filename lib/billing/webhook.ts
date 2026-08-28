import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { planForPriceId } from "@/lib/billing/plans";

/**
 * Mirror Stripe subscription state into billing_subscriptions.
 *
 * The webhook is the only writer of subscription rows, and Stripe is the only
 * source: nothing in this codebase ever *decides* an organization is paid —
 * it repeats what Stripe said, keyed by ids, idempotent by event id. The four
 * event families handled here are the complete set that changes who may use
 * what; everything else is acknowledged and recorded as unhandled.
 */

type ServiceClient = Pick<SupabaseClient, "from" | "rpc">;

export type WebhookOutcome = {
  /** What happened, for the route's log line and the tests. */
  readonly outcome:
    | "duplicate"
    | "subscription_mirrored"
    | "subscription_canceled"
    | "checkout_recorded"
    | "ignored"
    | "unresolvable";
  readonly organizationId: string | null;
};

type StripeSubscription = {
  id?: unknown;
  status?: unknown;
  customer?: unknown;
  cancel_at_period_end?: unknown;
  current_period_end?: unknown;
  metadata?: { organization_id?: unknown };
  items?: { data?: Array<{ price?: { id?: unknown } }> };
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function organizationForCustomer(
  client: ServiceClient,
  customerId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("billing_customers")
    .select("organization_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) throw new Error(`The customer mapping could not be read: ${error.message}`);
  return (data as { organization_id?: string } | null)?.organization_id ?? null;
}

async function alreadyProcessed(client: ServiceClient, eventId: string): Promise<boolean> {
  const { data, error } = await client
    .from("billing_events")
    .select("id")
    .eq("stripe_event_id", eventId)
    .maybeSingle();
  if (error) throw new Error(`The event ledger could not be read: ${error.message}`);
  return data !== null;
}

async function recordEvent(
  client: ServiceClient,
  input: { eventId: string; eventType: string; organizationId: string | null; summary: string },
): Promise<void> {
  const { error } = await client.from("billing_events").insert({
    stripe_event_id: input.eventId,
    event_type: input.eventType,
    organization_id: input.organizationId,
    summary: input.summary,
  });
  // A duplicate insert means a concurrent delivery won the race; the mirror
  // upserts are idempotent, so the second processing changed nothing.
  if (error && !/duplicate|unique/i.test(error.message)) {
    throw new Error(`The event could not be recorded: ${error.message}`);
  }
}

async function recordActivity(
  client: ServiceClient,
  organizationId: string,
  description: string,
): Promise<void> {
  // Through the definer boundary, not a table grant: activity_events holds
  // zero service_role privileges, like every other audited surface.
  const { error } = await client.rpc("record_billing_activity", {
    p_organization_id: organizationId,
    p_description: description,
  });
  if (error) throw new Error(`The audit event could not be written: ${error.message}`);
}

export async function handleStripeEvent(
  client: ServiceClient,
  event: Record<string, unknown>,
): Promise<WebhookOutcome> {
  const eventId = str(event.id);
  const eventType = str(event.type);
  if (!eventId || !eventType || !/^evt_[A-Za-z0-9]{1,64}$/.test(eventId)) {
    return { outcome: "unresolvable", organizationId: null };
  }
  if (await alreadyProcessed(client, eventId)) {
    return { outcome: "duplicate", organizationId: null };
  }

  const object = (event.data as { object?: unknown } | undefined)?.object as
    | Record<string, unknown>
    | undefined;

  if (eventType.startsWith("customer.subscription.")) {
    const subscription = (object ?? {}) as StripeSubscription;
    const subscriptionId = str(subscription.id);
    const customerId = str(subscription.customer);
    const status = str(subscription.status);
    if (!subscriptionId || !/^sub_[A-Za-z0-9]{1,64}$/.test(subscriptionId) || !status) {
      return { outcome: "unresolvable", organizationId: null };
    }

    const metadataOrg = str(subscription.metadata?.organization_id);
    const organizationId =
      (metadataOrg && UUID_PATTERN.test(metadataOrg) ? metadataOrg : null)
      ?? (customerId ? await organizationForCustomer(client, customerId) : null);
    if (!organizationId) {
      // A subscription this deployment cannot attribute is recorded, never
      // guessed at: attributing revenue to the wrong organization is worse
      // than attributing it to nobody.
      await recordEvent(client, {
        eventId,
        eventType,
        organizationId: null,
        summary: `Subscription ${subscriptionId} could not be matched to an organization.`,
      });
      return { outcome: "unresolvable", organizationId: null };
    }

    const deleted = eventType === "customer.subscription.deleted";
    const effectiveStatus = deleted ? "canceled" : status;

    const priceId = str(subscription.items?.data?.[0]?.price?.id);
    const known = priceId ? planForPriceId(priceId) : null;
    // A price this deployment does not know keeps the previous plan_key on
    // update (the upsert below only overwrites plan fields when known).
    const periodEndSeconds =
      typeof subscription.current_period_end === "number" ? subscription.current_period_end : null;

    const row: Record<string, unknown> = {
      organization_id: organizationId,
      stripe_subscription_id: subscriptionId,
      status: effectiveStatus,
      cancel_at_period_end: subscription.cancel_at_period_end === true,
      current_period_end: periodEndSeconds
        ? new Date(periodEndSeconds * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    };
    if (known) {
      row.plan_key = known.plan;
      row.cadence = known.cadence;
    } else if (!deleted) {
      // An insert needs a plan; an unknown price on a brand-new subscription
      // is recorded as such and skipped rather than invented.
      const { data } = await client
        .from("billing_subscriptions")
        .select("id")
        .eq("stripe_subscription_id", subscriptionId)
        .maybeSingle();
      if (data === null) {
        await recordEvent(client, {
          eventId,
          eventType,
          organizationId,
          summary: `Subscription ${subscriptionId} uses a price this deployment does not know; not mirrored.`,
        });
        return { outcome: "unresolvable", organizationId };
      }
    }

    const { error } = await client
      .from("billing_subscriptions")
      .upsert(row, { onConflict: "stripe_subscription_id" });
    if (error) throw new Error(`The subscription could not be mirrored: ${error.message}`);

    const description = deleted
      ? "The organization's subscription was canceled."
      : `The organization's subscription is ${effectiveStatus}${known ? ` on the ${known.plan} plan` : ""}.`;
    await recordActivity(client, organizationId, description);
    await recordEvent(client, {
      eventId,
      eventType,
      organizationId,
      summary: description,
    });
    return {
      outcome: deleted ? "subscription_canceled" : "subscription_mirrored",
      organizationId,
    };
  }

  if (eventType === "checkout.session.completed") {
    const session = (object ?? {}) as { client_reference_id?: unknown; customer?: unknown };
    const reference = str(session.client_reference_id);
    const customerId = str(session.customer);
    const organizationId =
      (reference && UUID_PATTERN.test(reference) ? reference : null)
      ?? (customerId ? await organizationForCustomer(client, customerId) : null);
    await recordEvent(client, {
      eventId,
      eventType,
      organizationId,
      summary: "Checkout completed; the subscription events carry the plan state.",
    });
    return { outcome: "checkout_recorded", organizationId };
  }

  await recordEvent(client, {
    eventId,
    eventType,
    organizationId: null,
    summary: `Event type ${eventType} is not one this deployment acts on.`,
  });
  return { outcome: "ignored", organizationId: null };
}
