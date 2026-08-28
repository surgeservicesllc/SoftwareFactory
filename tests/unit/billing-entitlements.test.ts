// @vitest-environment node

import { describe, expect, it } from "vitest";

vi.mock("server-only", () => ({}));

import { vi } from "vitest";

import {
  checkGraphLaunch,
  checkProjectCreation,
  monthWindowUtc,
  readUsage,
  resolveEntitlements,
} from "@/lib/billing/entitlements";

/**
 * Entitlement resolution against a fake PostgREST client. The invariants:
 * no subscription is the Free plan, standing statuses (active, trialing,
 * past_due) grant the paid plan, everything else falls back to Free, and the
 * limit checks refuse with the exact numbers they enforced.
 */

type ChainCall = { method: string; args: unknown[] };

function tableChain(resolver: (calls: ChainCall[]) => unknown) {
  const calls: ChainCall[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of [
    "select", "eq", "neq", "gte", "lt", "order", "limit", "maybeSingle", "insert", "upsert",
  ]) {
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

type EntitlementsClient = Parameters<typeof resolveEntitlements>[0];

function fakeClient(config: {
  subscriptions?: Array<Record<string, unknown>>;
  projects?: number;
  graphs?: number;
  members?: number;
}): EntitlementsClient {
  return {
    from(table: string) {
      return tableChain(() => {
        switch (table) {
          case "billing_subscriptions":
            return { data: config.subscriptions ?? [], error: null };
          case "projects":
            return { count: config.projects ?? 0, error: null };
          case "graphs":
            return { count: config.graphs ?? 0, error: null };
          case "organization_members":
            return { count: config.members ?? 0, error: null };
          default:
            throw new Error(`Unexpected table ${table}`);
        }
      });
    },
  } as unknown as EntitlementsClient;
}

const ORG = "11111111-1111-4111-8111-111111111111";

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    plan_key: "pro",
    status: "active",
    cadence: "monthly",
    current_period_end: "2026-09-25T00:00:00.000Z",
    cancel_at_period_end: false,
    updated_at: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveEntitlements", () => {
  it("resolves no subscription to the Free plan", async () => {
    const result = await resolveEntitlements(fakeClient({}), ORG);
    expect(result.plan.key).toBe("free");
    expect(result.subscription).toBeNull();
  });

  it("resolves an active subscription to its paid plan", async () => {
    const result = await resolveEntitlements(
      fakeClient({ subscriptions: [subscription()] }),
      ORG,
    );
    expect(result.plan.key).toBe("pro");
    expect(result.subscription).toMatchObject({ planKey: "pro", status: "active", cadence: "monthly" });
  });

  it("keeps past_due paid: a bank hiccup gets Stripe's retry window", async () => {
    const result = await resolveEntitlements(
      fakeClient({ subscriptions: [subscription({ status: "past_due", plan_key: "basic" })] }),
      ORG,
    );
    expect(result.plan.key).toBe("basic");
  });

  it("treats canceled and incomplete as Free", async () => {
    for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
      const result = await resolveEntitlements(
        fakeClient({ subscriptions: [subscription({ status })] }),
        ORG,
      );
      expect(result.plan.key).toBe("free");
    }
  });

  it("skips a standing row whose plan key this build does not know", async () => {
    const result = await resolveEntitlements(
      fakeClient({
        subscriptions: [
          subscription({ plan_key: "retired-plan" }),
          subscription({ plan_key: "basic", updated_at: "2026-08-24T00:00:00.000Z" }),
        ],
      }),
      ORG,
    );
    expect(result.plan.key).toBe("basic");
  });
});

describe("monthWindowUtc", () => {
  it("brackets a mid-month instant to its UTC month", () => {
    const window = monthWindowUtc(new Date("2026-08-25T22:00:00Z"));
    expect(window.start).toBe("2026-08-01T00:00:00.000Z");
    expect(window.next).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rolls December into January", () => {
    const window = monthWindowUtc(new Date("2026-12-31T23:59:59Z"));
    expect(window.start).toBe("2026-12-01T00:00:00.000Z");
    expect(window.next).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("usage and limit checks", () => {
  it("reads the three usage counters", async () => {
    const usage = await readUsage(fakeClient({ projects: 2, graphs: 7, members: 3 }), ORG);
    expect(usage).toEqual({ projects: 2, graphLaunchesThisMonth: 7, seats: 3 });
  });

  it("refuses project creation at the Free cap, naming the numbers", async () => {
    const check = await checkProjectCreation(fakeClient({ projects: 1 }), ORG);
    expect(check.allowed).toBe(false);
    if (check.allowed) return;
    expect(check.code).toBe("plan_limit_reached");
    expect(check.limit).toBe(1);
    expect(check.current).toBe(1);
    expect(check.planKey).toBe("free");
    expect(check.message).toContain("pricing page");
  });

  it("allows project creation under the cap", async () => {
    const check = await checkProjectCreation(fakeClient({ projects: 0 }), ORG);
    expect(check.allowed).toBe(true);
  });

  it("refuses a graph launch at the monthly allowance and allows under it", async () => {
    const atCap = await checkGraphLaunch(fakeClient({ graphs: 10 }), ORG);
    expect(atCap.allowed).toBe(false);

    const underCap = await checkGraphLaunch(fakeClient({ graphs: 9 }), ORG);
    expect(underCap.allowed).toBe(true);
  });

  it("raises the allowance with a paid plan", async () => {
    const check = await checkGraphLaunch(
      fakeClient({ graphs: 10, subscriptions: [subscription({ plan_key: "basic" })] }),
      ORG,
    );
    expect(check.allowed).toBe(true);
  });
});
