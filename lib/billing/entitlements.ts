import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PLANS,
  planByKey,
  type BillingCadence,
  type Plan,
  type PlanKey,
} from "@/lib/billing/plans";

/**
 * What an organization is entitled to right now, and what it has used.
 *
 * Entitlements come from the newest subscription in a standing status; the
 * absence of one is the Free plan, not an error. `past_due` still counts —
 * a failed card gets Stripe's retry window before work stops, because
 * stopping a customer's factory over a bank hiccup costs more trust than the
 * grace costs money. `canceled` and the incomplete states do not count.
 */

const STANDING_STATUSES = new Set(["active", "trialing", "past_due"]);

export type SubscriptionSummary = {
  readonly planKey: PlanKey;
  readonly status: string;
  readonly cadence: BillingCadence;
  readonly currentPeriodEnd: string | null;
  readonly cancelAtPeriodEnd: boolean;
};

export type OrganizationEntitlements = {
  readonly plan: Plan;
  /** Null when the organization is on Free (no standing subscription). */
  readonly subscription: SubscriptionSummary | null;
};

type SubscriptionRow = {
  plan_key: string;
  status: string;
  cadence: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  updated_at: string;
};

// The route layer owns its client type; anything with .from() works here.
type DataClient = Pick<SupabaseClient, "from">;

export async function resolveEntitlements(
  client: DataClient,
  organizationId: string,
): Promise<OrganizationEntitlements> {
  const { data, error } = await client
    .from("billing_subscriptions")
    .select("plan_key,status,cadence,current_period_end,cancel_at_period_end,updated_at")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error) throw new Error(`Billing state could not be read: ${error.message}`);

  const standing = ((data ?? []) as SubscriptionRow[]).find(
    (row) => STANDING_STATUSES.has(row.status) && planByKey(row.plan_key) !== null,
  );

  if (!standing) {
    return { plan: PLANS.free, subscription: null };
  }

  return {
    plan: planByKey(standing.plan_key) ?? PLANS.free,
    subscription: {
      planKey: (planByKey(standing.plan_key) ?? PLANS.free).key,
      status: standing.status,
      cadence: standing.cadence === "yearly" ? "yearly" : "monthly",
      currentPeriodEnd: standing.current_period_end,
      cancelAtPeriodEnd: standing.cancel_at_period_end === true,
    },
  };
}

/** The current UTC calendar month as an ISO [start, next) window. */
export function monthWindowUtc(now: Date = new Date()): { start: string; next: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), next: next.toISOString() };
}

export type UsageSnapshot = {
  readonly projects: number;
  readonly graphLaunchesThisMonth: number;
  readonly seats: number;
};

export async function readUsage(
  client: DataClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<UsageSnapshot> {
  const window = monthWindowUtc(now);

  const [projects, launches, seats] = await Promise.all([
    client
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .neq("status", "archived"),
    client
      .from("graphs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("created_at", window.start)
      .lt("created_at", window.next),
    client
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
  ]);

  for (const result of [projects, launches, seats]) {
    if (result.error) throw new Error(`Usage could not be read: ${result.error.message}`);
  }

  return {
    projects: projects.count ?? 0,
    graphLaunchesThisMonth: launches.count ?? 0,
    seats: seats.count ?? 0,
  };
}

export type LimitCheck =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: "plan_limit_reached";
      readonly message: string;
      readonly limit: number;
      readonly current: number;
      readonly planKey: PlanKey;
    };

function refusal(
  plan: Plan,
  what: string,
  limit: number,
  current: number,
): LimitCheck {
  const upgrade = plan.key === "free"
    ? "Upgrade on the pricing page to raise the limit."
    : "Upgrade your plan on the pricing page to raise the limit.";
  return {
    allowed: false,
    code: "plan_limit_reached",
    message: `The ${plan.name} plan includes ${limit} ${what}; this organization has ${current}. ${upgrade}`,
    limit,
    current,
    planKey: plan.key,
  };
}

/**
 * May this organization create one more project?
 *
 * A quota, not a lock: the count is read before the insert, so two
 * simultaneous creations can land one over. That costs at most one row and
 * corrects on the next attempt — the alternative (serializing every project
 * creation through a lock) taxes the honest path to stop a shrug.
 */
export async function checkProjectCreation(
  client: DataClient,
  organizationId: string,
): Promise<LimitCheck> {
  const [{ plan }, usage] = await Promise.all([
    resolveEntitlements(client, organizationId),
    readUsage(client, organizationId),
  ]);
  if (usage.projects >= plan.entitlements.maxProjects) {
    return refusal(plan, "project(s)", plan.entitlements.maxProjects, usage.projects);
  }
  return { allowed: true };
}

/** May this organization launch one more graph this month? */
export async function checkGraphLaunch(
  client: DataClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<LimitCheck> {
  const [{ plan }, usage] = await Promise.all([
    resolveEntitlements(client, organizationId),
    readUsage(client, organizationId, now),
  ]);
  if (usage.graphLaunchesThisMonth >= plan.entitlements.graphLaunchesPerMonth) {
    return refusal(
      plan,
      "graph launch(es) per month",
      plan.entitlements.graphLaunchesPerMonth,
      usage.graphLaunchesThisMonth,
    );
  }
  return { allowed: true };
}
