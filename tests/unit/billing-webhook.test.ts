// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { handleStripeEvent } from "@/lib/billing/webhook";

/**
 * The mirror's obligations: idempotent by event id, attributes revenue only
 * by ids it can prove (metadata uuid or the customer mapping), never invents
 * a plan for a price it does not know, and records every delivery — the ones
 * it acted on and the ones it could not.
 */

type ChainCall = { method: string; args: unknown[] };

function tableChain(resolver: (calls: ChainCall[]) => unknown) {
  const calls: ChainCall[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle", "insert", "upsert"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  (chain as { then: unknown }).then = (
    resolve: (value: unknown) => void,
    reject: (error: unknown) => void,
  ) => {
    try {
      resolve(resolver(calls));
    } catch (error) {
      reject(error);
    }
  };
  return chain;
}

function fakeDb(config: {
  processedEventIds?: string[];
  customerOrg?: Record<string, string>;
  existingSubscriptionIds?: string[];
} = {}) {
  type ServiceClient = Parameters<typeof handleStripeEvent>[0];
  const writes = {
    events: [] as Array<Record<string, unknown>>,
    subscriptions: [] as Array<Record<string, unknown>>,
    activity: [] as Array<Record<string, unknown>>,
  };
  const client = {
    async rpc(functionName: string, args: Record<string, unknown>) {
      if (functionName !== "record_billing_activity") {
        throw new Error(`Unexpected rpc ${functionName}`);
      }
      writes.activity.push(args);
      return { data: null, error: null };
    },
    from(table: string) {
      return tableChain((calls) => {
        const insert = calls.find((call) => call.method === "insert");
        const upsert = calls.find((call) => call.method === "upsert");
        const eqValue = calls.find((call) => call.method === "eq")?.args[1] as string | undefined;
        switch (table) {
          case "billing_events":
            if (insert) {
              writes.events.push(insert.args[0] as Record<string, unknown>);
              return { error: null };
            }
            return {
              data: config.processedEventIds?.includes(eqValue ?? "") ? { id: "seen" } : null,
              error: null,
            };
          case "billing_customers": {
            const organizationId = config.customerOrg?.[eqValue ?? ""] ?? null;
            return { data: organizationId ? { organization_id: organizationId } : null, error: null };
          }
          case "billing_subscriptions":
            if (upsert) {
              writes.subscriptions.push(upsert.args[0] as Record<string, unknown>);
              return { error: null };
            }
            return {
              data: config.existingSubscriptionIds?.includes(eqValue ?? "") ? { id: "row" } : null,
              error: null,
            };
          default:
            throw new Error(`Unexpected table ${table}`);
        }
      });
    },
  } as unknown as ServiceClient;
  return { client, writes };
}

const ORG = "22222222-2222-4222-8222-222222222222";

function subscriptionEvent(overrides: {
  type?: string;
  id?: string;
  metadataOrg?: string | null;
  priceId?: string;
  status?: string;
  customer?: string;
} = {}) {
  return {
    id: overrides.id ?? "evt_test1",
    type: overrides.type ?? "customer.subscription.created",
    data: {
      object: {
        id: "sub_abc123",
        customer: overrides.customer ?? "cus_abc123",
        status: overrides.status ?? "active",
        cancel_at_period_end: false,
        current_period_end: 1_758_000_000,
        metadata:
          overrides.metadataOrg === null ? {} : { organization_id: overrides.metadataOrg ?? ORG },
        items: { data: [{ price: { id: overrides.priceId ?? "price_ProM123" } }] },
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubPrices() {
  vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_ProM123");
  vi.stubEnv("STRIPE_PRICE_BASIC_YEARLY", "price_BasicY123");
}

describe("handleStripeEvent", () => {
  it("mirrors a subscription with a known price onto the organization", async () => {
    stubPrices();
    const { client, writes } = fakeDb();
    const outcome = await handleStripeEvent(client, subscriptionEvent());

    expect(outcome).toEqual({ outcome: "subscription_mirrored", organizationId: ORG });
    expect(writes.subscriptions).toHaveLength(1);
    expect(writes.subscriptions[0]).toMatchObject({
      organization_id: ORG,
      stripe_subscription_id: "sub_abc123",
      plan_key: "pro",
      cadence: "monthly",
      status: "active",
    });
    expect(writes.activity).toHaveLength(1);
    expect(writes.events).toHaveLength(1);
  });

  it("is idempotent: a replayed event id changes nothing", async () => {
    stubPrices();
    const { client, writes } = fakeDb({ processedEventIds: ["evt_test1"] });
    const outcome = await handleStripeEvent(client, subscriptionEvent());

    expect(outcome.outcome).toBe("duplicate");
    expect(writes.subscriptions).toHaveLength(0);
    expect(writes.events).toHaveLength(0);
  });

  it("marks a deleted subscription canceled whatever status the payload says", async () => {
    stubPrices();
    const { client, writes } = fakeDb();
    const outcome = await handleStripeEvent(
      client,
      subscriptionEvent({ type: "customer.subscription.deleted", status: "active" }),
    );
    expect(outcome.outcome).toBe("subscription_canceled");
    expect(writes.subscriptions[0]).toMatchObject({ status: "canceled" });
  });

  it("falls back to the customer mapping when metadata carries no uuid", async () => {
    stubPrices();
    const { client, writes } = fakeDb({ customerOrg: { cus_abc123: ORG } });
    const outcome = await handleStripeEvent(client, subscriptionEvent({ metadataOrg: null }));
    expect(outcome.organizationId).toBe(ORG);
    expect(writes.subscriptions).toHaveLength(1);
  });

  it("records but never mirrors a subscription it cannot attribute", async () => {
    stubPrices();
    const { client, writes } = fakeDb();
    const outcome = await handleStripeEvent(client, subscriptionEvent({ metadataOrg: null }));

    expect(outcome.outcome).toBe("unresolvable");
    expect(writes.subscriptions).toHaveLength(0);
    expect(writes.events).toHaveLength(1);
    expect(String(writes.events[0].summary)).toContain("could not be matched");
  });

  it("refuses to invent a plan for an unknown price on a new subscription", async () => {
    stubPrices();
    const { client, writes } = fakeDb();
    const outcome = await handleStripeEvent(client, subscriptionEvent({ priceId: "price_unknown" }));

    expect(outcome.outcome).toBe("unresolvable");
    expect(writes.subscriptions).toHaveLength(0);
  });

  it("updates an existing subscription on an unknown price without touching its plan", async () => {
    stubPrices();
    const { client, writes } = fakeDb({ existingSubscriptionIds: ["sub_abc123"] });
    const outcome = await handleStripeEvent(
      client,
      subscriptionEvent({ type: "customer.subscription.updated", priceId: "price_unknown", status: "past_due" }),
    );
    expect(outcome.outcome).toBe("subscription_mirrored");
    expect(writes.subscriptions).toHaveLength(1);
    expect(writes.subscriptions[0]).not.toHaveProperty("plan_key");
    expect(writes.subscriptions[0]).toMatchObject({ status: "past_due" });
  });

  it("records checkout completion without writing plan state", async () => {
    const { client, writes } = fakeDb();
    const outcome = await handleStripeEvent(client, {
      id: "evt_checkout1",
      type: "checkout.session.completed",
      data: { object: { client_reference_id: ORG, customer: "cus_abc123" } },
    });
    expect(outcome).toEqual({ outcome: "checkout_recorded", organizationId: ORG });
    expect(writes.subscriptions).toHaveLength(0);
    expect(writes.events).toHaveLength(1);
  });

  it("acknowledges and records event types it does not act on", async () => {
    const { client, writes } = fakeDb();
    const outcome = await handleStripeEvent(client, {
      id: "evt_other1",
      type: "invoice.finalized",
      data: { object: {} },
    });
    expect(outcome.outcome).toBe("ignored");
    expect(writes.events).toHaveLength(1);
  });

  it("rejects an event with no well-formed id without touching the database", async () => {
    const { client, writes } = fakeDb();
    const outcome = await handleStripeEvent(client, { id: "not-an-event", type: "x" });
    expect(outcome.outcome).toBe("unresolvable");
    expect(writes.events).toHaveLength(0);
  });
});
