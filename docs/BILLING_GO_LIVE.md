# Billing go-live runbook

The site can now take money. This is the exact, ordered list of what the owner
does to turn it on; nothing here is optional and nothing else is required.
Until every step is done, every billing surface renders **Not Connected** and
the pricing page's buttons behave exactly as they always did (they link to
sign-in). Nothing pretends.

## What was built

- **Plans**: the four the pricing page has always advertised — Free, Basic
  ($29/mo or $23.20/mo billed yearly), Pro ($79/mo or $63.20/mo billed
  yearly), Enterprise (contact). Basic and Pro are self-serve; the entitlement
  numbers live in `lib/billing/plans.ts` and the storefront copy in the
  `marketing_pricing_plans` table.
- **Checkout**: Stripe-hosted. The browser never sees a card field or any
  Stripe key; `/api/billing/checkout` returns a redirect URL. Owner/admin only.
- **Mirror**: `/api/billing/webhook` verifies Stripe's signature and mirrors
  subscription state into `billing_subscriptions` (service-role writer,
  idempotent by event id, every delivery recorded in `billing_events`,
  transitions audited in `activity_events`).
- **Enforcement**: Free = 1 project, 10 graph launches per UTC month, 1 seat.
  Basic = unlimited projects, 50 launches, 5 seats. Pro = unlimited projects,
  250 launches, 25 seats. Limits gate **new** work only; refusals are HTTP 402
  with the exact numbers. Nothing already created stops working.
- **Surfaces**: `/pricing` buys (when connected); `/solutions/billing` shows
  the plan, usage meters, upgrade buttons, and the Stripe customer portal.

## Go-live steps

1. **Apply the migration** (before deploying the code):
   run the `apply-hosted-migrations.yml` workflow with
   `scope=billing-foundation`. It applies only `20260825000400`, hash-pinned,
   and verifies tables, forced RLS, and the customer boundary.

2. **Create the Stripe account** at <https://dashboard.stripe.com> (or use an
   existing one). Complete business verification so live payouts work.

3. **Create the products and prices** (Dashboard → Product catalog):
   - Product "Basic": recurring price $29.00/month, and a recurring price
     $278.40/year (equals $23.20/mo, the advertised yearly rate).
   - Product "Pro": recurring price $79.00/month, and $758.40/year
     (equals $63.20/mo).
   Copy each price id (`price_…`).

4. **Set the Vercel environment variables** (Project → Settings → Environment
   Variables, server-side only, never `NEXT_PUBLIC_`):
   - `STRIPE_SECRET_KEY` — a **restricted** key (Dashboard → Developers → API
     keys → Create restricted key) with write access to Customers, Checkout
     Sessions, and Billing Portal; nothing else. A full secret key works but
     grants more than this integration uses.
   - `STRIPE_PRICE_BASIC_MONTHLY`, `STRIPE_PRICE_BASIC_YEARLY`,
     `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY` — from step 3.
   - `SUPABASE_SERVICE_ROLE_KEY` — already documented in `.env.example`; the
     webhook needs it to write the mirror. If it is already set for the
     GitHub webhook, nothing to do.

5. **Create the webhook** (Dashboard → Developers → Webhooks → Add endpoint):
   - URL: `https://www.theagoras.com/api/billing/webhook`
   - Events: `customer.subscription.created`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `checkout.session.completed`.
   - Copy the signing secret into `STRIPE_WEBHOOK_SECRET` on Vercel.

6. **Redeploy** so the environment variables take effect.

7. **Prove it end to end in test mode first**: with test-mode keys and test
   price ids in place, buy Pro with card `4242 4242 4242 4242`, watch
   `/solutions/billing` flip to Pro after the webhook lands, launch a graph,
   then cancel from "Manage billing on Stripe" and watch the plan fall back to
   Free at period end. Then swap the four values for their live-mode
   equivalents and redeploy.

8. **Comp your own organization** (optional but recommended): create a 100%-off
   forever coupon in Stripe, subscribe your own organization to Pro with it.
   That keeps your own usage inside the same machinery instead of special-cased
   in code — there is deliberately no "owner bypass" flag anywhere.

## What to watch after go-live

- `billing_events` — every webhook delivery, including the ones the mirror
  could not attribute (`summary` says why).
- `activity_events` with `event_type = 'billing.subscription_changed'` — the
  audit trail of who gained and lost paid entitlements.
- Stripe Dashboard → Payments — the money itself. The application's tables are
  a mirror; Stripe is the ledger of record.

## Boundaries this deliberately keeps

- No Stripe key of any kind in the browser; no card fields on the site.
- The webhook is the only subscription writer; a browser session cannot
  promote its own organization (RLS: members read, nobody writes).
- Stripe ids (`cus_`, `sub_`, `evt_`) are stored; payloads, emails, and card
  metadata are not.
- Enterprise stays "Contact Sales" — no self-serve path to a custom contract.
