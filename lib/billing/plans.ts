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

/**
 * The advertised amounts, in cents, matching the marketing rows the pricing
 * page has carried since 20260813000500. The bootstrap creates Stripe prices
 * from these; the page renders its own copies from the database. The runbook's
 * test purchase is where a human confirms the two agree.
 */
export const PLAN_AMOUNTS_CENTS: Readonly<
  Record<"basic" | "pro", Readonly<Record<BillingCadence, number>>>
> = Object.freeze({
  basic: { monthly: 2_900, yearly: 27_840 },
  pro: { monthly: 7_900, yearly: 75_840 },
});

/**
 * Stable lookup keys for the four purchasable prices. The bootstrap stamps
 * them onto the prices it creates, and the resolver below can find prices by
 * key at request time — so a deployment needs no per-price environment
 * variables at all once the bootstrap has run.
 */
export const PRICE_LOOKUP_KEYS: Readonly<Record<string, string>> = Object.freeze({
  "basic:monthly": "factory_basic_monthly",
  "basic:yearly": "factory_basic_yearly",
  "pro:monthly": "factory_pro_monthly",
  "pro:yearly": "factory_pro_yearly",
});

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

/** Whether a well-formed secret key is configured at all. */
export function billingSecretConfigured(): boolean {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  return !!secret && /^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/.test(secret);
}

/** Whether a well-formed webhook signing secret is configured. */
export function webhookSecretConfigured(): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  return !!secret && /^whsec_[A-Za-z0-9]{8,}$/.test(secret);
}

/**
 * Whether payments are live: the secret key, the webhook signing secret, and
 * at least one purchasable price named by environment variables. The webhook
 * secret is deliberately part of "connected": a checkout that charges while
 * the mirror cannot hear about it would take money without granting anything.
 * The UI shows the exact label "Not Connected" when this is false — buttons
 * that cannot charge must say so, not pretend.
 *
 * A deployment using lookup-key prices instead of env prices answers through
 * `resolvePurchasablePlans` below, which does the live lookup; this sync
 * check is the env-only fast path the webhook route and tests rely on.
 */
export function billingConnected(): boolean {
  if (!billingSecretConfigured() || !webhookSecretConfigured()) return false;
  return (["basic", "pro"] as const).some(
    (plan) => priceIdFor(plan, "monthly") !== null || priceIdFor(plan, "yearly") !== null,
  );
}

export function planByKey(key: string): Plan | null {
  return key in PLANS ? PLANS[key as PlanKey] : null;
}

export type SecretShape = "missing" | "malformed" | "ok";

export type BillingConfigurationReport = {
  readonly secretKey: SecretShape;
  readonly webhookSecret: SecretShape;
  readonly prices: Readonly<Record<"basic" | "pro", Readonly<Record<BillingCadence, boolean>>>>;
};

/**
 * Which pieces of the Stripe configuration this deployment can actually see,
 * as shapes only — never values. Exists because "Not Connected" alone sent
 * the owner guessing across four dashboards; this names the broken piece.
 * "malformed" almost always means quotes or whitespace pasted into Vercel,
 * or a publishable key where the secret belongs.
 */
export function describeBillingConfiguration(): BillingConfigurationReport {
  const shape = (raw: string | undefined, pattern: RegExp): SecretShape => {
    const value = raw?.trim();
    if (!value) return "missing";
    return pattern.test(value) ? "ok" : "malformed";
  };
  return {
    secretKey: shape(process.env.STRIPE_SECRET_KEY, /^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/),
    webhookSecret: shape(process.env.STRIPE_WEBHOOK_SECRET, /^whsec_[A-Za-z0-9]{8,}$/),
    prices: {
      basic: {
        monthly: priceIdFor("basic", "monthly") !== null,
        yearly: priceIdFor("basic", "yearly") !== null,
      },
      pro: {
        monthly: priceIdFor("pro", "monthly") !== null,
        yearly: priceIdFor("pro", "yearly") !== null,
      },
    },
  };
}

/**
 * Resolve the Stripe price for a plan+cadence: environment variable first,
 * then a lookup-key search against Stripe, cached briefly per server instance
 * so the pricing page does not call Stripe on every render. Exported cache
 * reset keeps tests deterministic.
 */
import { listPricesByLookupKeys, type StripeTransport } from "@/lib/billing/stripe";

type LookupCache = { at: number; byKey: Map<string, string> };
let lookupCache: LookupCache | null = null;
const LOOKUP_CACHE_MS = 60_000;

export function resetPriceLookupCache(): void {
  lookupCache = null;
}

async function lookupPrices(transport?: StripeTransport): Promise<Map<string, string>> {
  const now = Date.now();
  if (lookupCache && now - lookupCache.at < LOOKUP_CACHE_MS) return lookupCache.byKey;
  const rows = await listPricesByLookupKeys(
    Object.values(PRICE_LOOKUP_KEYS),
    ...(transport ? [transport] : []),
  );
  const byKey = new Map(rows.map((row) => [row.lookupKey, row.id]));
  lookupCache = { at: now, byKey };
  return byKey;
}

/** The price id to charge for a plan+cadence, or null when none exists. */
export async function resolvePriceId(
  plan: PlanKey,
  cadence: BillingCadence,
  transport?: StripeTransport,
): Promise<string | null> {
  const fromEnv = priceIdFor(plan, cadence);
  if (fromEnv) return fromEnv;
  if (!billingSecretConfigured()) return null;
  const lookupKey = PRICE_LOOKUP_KEYS[`${plan}:${cadence}`];
  if (!lookupKey) return null;
  try {
    return (await lookupPrices(transport)).get(lookupKey) ?? null;
  } catch {
    // A lookup outage must degrade to "not purchasable", never to a crash on
    // the public pricing page.
    return null;
  }
}

export type PurchasableMap = Readonly<
  Record<string, Readonly<Record<BillingCadence, boolean>>>
>;

/**
 * Which plans a checkout could actually charge for right now — the async,
 * lookup-aware answer the pricing page and billing summary render from.
 * Requires the webhook secret for the same reason `billingConnected` does.
 */
export async function resolvePurchasablePlans(
  transport?: StripeTransport,
): Promise<{ connected: boolean; purchasable: PurchasableMap }> {
  if (!billingSecretConfigured() || !webhookSecretConfigured()) {
    return { connected: false, purchasable: {} };
  }
  const entries = await Promise.all(
    (["basic", "pro"] as const).map(async (plan) => [
      plan,
      {
        monthly: (await resolvePriceId(plan, "monthly", transport)) !== null,
        yearly: (await resolvePriceId(plan, "yearly", transport)) !== null,
      },
    ] as const),
  );
  const purchasable = Object.fromEntries(entries);
  const connected = entries.some(([, cadences]) => cadences.monthly || cadences.yearly);
  return { connected, purchasable: connected ? purchasable : {} };
}
