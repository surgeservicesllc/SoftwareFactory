import "server-only";

/**
 * The plan catalog behind the pricing page.
 *
 * The storefront (marketing_pricing_plans, migration 20260813000500) has
 * advertised these four plans since before billing existed; this file makes
 * the same four keys mean something. The advertised copy lives in the
 * database; the *entitlements* live here, versioned with the code that
 * enforces them, so a limit and its enforcement can never drift apart in a
 * deploy.
 *
 * Prices are Stripe Price ids supplied by environment variables, never
 * hard-coded: the amounts shown on the page come from the marketing rows, and
 * the amounts charged come from Stripe's own price objects. If an env var is
 * missing, the plan is simply not purchasable and the UI says so — nothing
 * pretends.
 */

export type PlanKey = "free" | "basic" | "pro" | "enterprise";

export type PlanEntitlements = {
  /** How many projects the organization may have in total. */
  readonly maxProjects: number;
  /** How many graphs may be launched per calendar month (UTC). */
  readonly graphLaunchesPerMonth: number;
  /** How many members the organization may have. */
  readonly maxSeats: number;
};

export type Plan = {
  readonly key: PlanKey;
  readonly name: string;
  /** Whether the plan can be bought with a checkout button. */
  readonly selfServe: boolean;
  readonly entitlements: PlanEntitlements;
};

/**
 * Limits follow the published matrix (Free: 1 user / 1 project; Basic: up to
 * 5 users, unlimited projects; Pro: up to 25 users, unlimited projects).
 * "Unlimited" is bounded at a number no honest use reaches, so the arithmetic
 * stays total and an abuse loop still hits a wall.
 */
const UNLIMITED = 100_000;

export const PLANS: Readonly<Record<PlanKey, Plan>> = Object.freeze({
  free: {
    key: "free",
    name: "Free",
    selfServe: false,
    entitlements: { maxProjects: 1, graphLaunchesPerMonth: 10, maxSeats: 1 },
  },
  basic: {
    key: "basic",
    name: "Basic",
    selfServe: true,
    entitlements: { maxProjects: UNLIMITED, graphLaunchesPerMonth: 50, maxSeats: 5 },
  },
  pro: {
    key: "pro",
    name: "Pro",
    selfServe: true,
    entitlements: { maxProjects: UNLIMITED, graphLaunchesPerMonth: 250, maxSeats: 25 },
  },
  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    selfServe: false,
    entitlements: { maxProjects: UNLIMITED, graphLaunchesPerMonth: 1_000, maxSeats: UNLIMITED },
  },
});

export type BillingCadence = "monthly" | "yearly";

const PRICE_ENV: Readonly<Record<string, string>> = Object.freeze({
  "basic:monthly": "STRIPE_PRICE_BASIC_MONTHLY",
  "basic:yearly": "STRIPE_PRICE_BASIC_YEARLY",
  "pro:monthly": "STRIPE_PRICE_PRO_MONTHLY",
  "pro:yearly": "STRIPE_PRICE_PRO_YEARLY",
});

/** The Stripe Price id for a purchasable plan+cadence, or null when unset. */
export function priceIdFor(plan: PlanKey, cadence: BillingCadence): string | null {
  const name = PRICE_ENV[`${plan}:${cadence}`];
  if (!name) return null;
  const value = process.env[name]?.trim();
  return value && /^price_[A-Za-z0-9]{1,64}$/.test(value) ? value : null;
}

/** Reverse lookup: which plan+cadence does a Stripe Price id belong to. */
export function planForPriceId(priceId: string): { plan: PlanKey; cadence: BillingCadence } | null {
  for (const [pair, envName] of Object.entries(PRICE_ENV)) {
    if (process.env[envName]?.trim() === priceId) {
      const [plan, cadence] = pair.split(":") as [PlanKey, BillingCadence];
      return { plan, cadence };
    }
  }
  return null;
}

/**
 * Whether payments are live: the secret key plus at least one purchasable
 * price. The UI shows the exact label "Not Connected" when this is false —
 * buttons that cannot charge must say so, not pretend.
 */
export function billingConnected(): boolean {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret || !/^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/.test(secret)) return false;
  return (["basic", "pro"] as const).some(
    (plan) => priceIdFor(plan, "monthly") !== null || priceIdFor(plan, "yearly") !== null,
  );
}

export function planByKey(key: string): Plan | null {
  return key in PLANS ? PLANS[key as PlanKey] : null;
}
