# Services CRM: audit, architecture and increment plan

Owner /goal, 2026-08-30 (task #63; the registration hit the 4,000-char
limit — a trimmed re-issue was provided; this document plus BACKLOG is
the working plan of record). The directive: a new global navigation
labeled "Services" and an AI-first Pest Services CRM + Field Service
platform (BOSS/FieldRoutes/PestPac/GorillaDesk/Jobber/Briostack class)
plus a marketing hub (HubSpot/ZoomInfo/Mailchimp class), built as
production functionality on Supabase with strict tenant isolation.

## AUDIT: what the repository already provides (reused, not rebuilt)

- **Tenancy**: organizations + organization_members + `is_organization_member`
  + forced RLS everywhere; org creation bootstraps the owner membership by
  trigger. The CRM rides this directly — org-scoped rows, unlike the
  person-scoped Job Seeker/Budget Tracker verticals, because a CRM is the
  org's shared book of business.
- **Product-shell pattern** (Budget Tracker, ADR-16x): own route group so
  the console's sidebar never renders here, self-contained navigation
  module, PascalCase case-sensitive root, `requirePortalViewer` gate in the
  product layout, global header row for product switching. `/Services`
  follows it exactly.
- **Route house style**: requireActiveOrganization → RLS session client,
  same-origin asserts on writes, bounded JSON, zod strict schemas, honest
  error codes, `databaseErrorResponse` passthrough.
- **Schema house style**: enum vocabularies, CHECK-bounded text,
  `text_has_likely_secret` guards, `set_updated_at` trigger,
  grant-level capability statements, hosted-apply scope discipline.
- **Billing**: Stripe subscription machinery exists (ADR-15x) — invoicing
  for CRM increments can build on the recorded billing foundation rather
  than a second payment stack.
- **AI**: the graph engine + provider transport is the substrate for the
  Copilot pillar (evidence-backed recommendations = ANCHOR-style observed
  data, never invented).

## ARCHITECT: the pillars, mapped to increments

Each increment ships whole through the standard cadence (tests → lint →
tsc → build → PR → 4 real checks → merge → hosted apply → deploy verify
→ probes). An increment is listed only with its real scope; nothing here
is a mockup commitment.

1. **Foundation (SHIPPED with ADR-185)**: `/Services` global nav + product
   shell; crm_accounts / crm_contacts / crm_properties /
   crm_timeline_events (immutable, append-only at the grant level;
   status changes self-record by trigger); routes for list/create/detail/
   patch/contacts/properties/timeline; Overview + Customers & Leads +
   360° account pages, all live-wired. Migration 20260830000500,
   hosted-apply scope `services-crm`.
2. **Pipeline & opportunities (SHIPPED with ADR-186)**: crm_opportunities
   with stages new→contacted→inspection→proposal→negotiation→won/lost,
   values in cents, expected close, trigger-written stage history on the
   account timeline, closed_at kept truthful by trigger+CHECK, no DELETE
   (conversion truth); whole-book report (per-stage counts/values, open,
   won, win rate) from the same authority as the board; duplicate
   detection on create via database-generated normals (name/email/phone
   surfaced as a 409 with matches, never auto-merged, explicit
   allowDuplicate to proceed); global search across accounts, contacts,
   properties and opportunities in the Services shell. Migration
   20260830000700, hosted-apply scope `crm-pipeline`.
3. **Field service core (SHIPPED with ADR-189)**: crm_technicians (no
   DELETE — history hangs off them), crm_work_orders
   (scheduled→dispatched→in_progress→completed/cancelled, completed_at
   trigger+CHECK, three-column same-account property FK), and
   crm_service_plans (recurrence + next_due, guarded generate with
   compensation). Completion writes the `service` timeline event through
   a definer — the system kinds' first real writer — naming the property
   and carrying field notes; cancellation records as status_change.
   /Services/schedule dispatch board + /Services/technicians roster;
   Demo Data fields the whole operation. Migration 20260830000800,
   hosted-apply scope `field-service`.
4. **Pest/IPM (SHIPPED with ADR-191)**: crm_devices with per-organization
   barcode identity and IPM activity thresholds; the append-only
   crm_device_events scan ledger (install/service/move/remove) whose
   install is written at birth and from which device state is projected
   by trigger; crm_pest_sightings with the corrective-action CHECK that
   makes "resolved" mean something. The /Services/ipm command center:
   scan box, per-site station tables, over-threshold flags, and the
   sighting loop. Nothing deletable anywhere — a pulled station is a
   remove scan. Migration 20260830001200, hosted-apply scope `pest-ipm`.
   Still ahead in this pillar: device/site MAPS (coordinates and floor
   plans), QR label generation, and long-run trend charts.
5. **Chemicals & compliance (SHIPPED with ADR-192)**: crm_products (EPA
   registration identity, https-checked SDS/label references, restricted-use
   flag), crm_product_lots (trigger drawdown, expiry, remaining ≤ received),
   the APPEND-ONLY crm_applications log (applicator license copied at
   recording, rate/quantity/area/target pest, supersede-not-edit
   corrections, its own 'service' timeline event), and crm_compliance_rules
   as configurable per-jurisdiction rows enforced at the application
   boundary. Audit-ready report by customer/site/date/product/technician,
   as JSON or injection-guarded CSV. /Services/compliance. Migration
   20260830001300, hosted-apply scope `chemicals-compliance`. Still ahead
   in this pillar: PDF rendering (CSV ships now) and retention-window
   reporting driven by each rule's configured years.
6. **Billing: estimates, contracts, invoices, payments (SHIPPED with
   ADR-194)**: crm_estimates and lines (totals derived from the lines at
   the boundary, decided-iff-closed CHECK), crm_contracts (term, signature
   completeness, ended-iff-closed), crm_invoices and lines (paid_cents and
   the `paid` status maintained by trigger — never assertable by a
   caller), and the APPEND-ONLY crm_payments and crm_refunds, with a
   row-locking trigger that refuses a credit larger than the payment it
   refunds. Every payment writes a `payment` timeline event, so all three
   system kinds now have real database writers. Nothing deletable: a void
   invoice keeps its reason on the record. /Services/billing reads the
   four books and the ledger behind them. Migration 20260830001400,
   hosted-apply scope `billing-contracts`. Still ahead in this pillar:
   taking card payments through the existing Stripe machinery (the ledger
   records money that moved; it does not yet move it), dunning schedules,
   and PDF invoice rendering.
7. **The company and the sales motion (SHIPPED with ADR-195)**:
   crm_branches (per-organization code, address, IANA time zone, open and
   close dates, a manager from the org chart), crm_employees as the org
   chart itself (owner / branch manager / sales manager / sales rep / CSR /
   dispatcher / admin, each with a branch, a supervisor, hire and end
   dates, a commission rate in basis points and a monthly quota),
   crm_territories (a branch's slice of the map, worked by one rep,
   defined by the postal codes it covers, CHECKed element by element), and
   crm_commissions whose amount is DERIVED from basis × rate by trigger —
   the API carries no amount field, so the number cannot be asserted at
   all. Accounts gained branch/territory/owning rep, opportunities an
   owner, technicians a branch and a supervisor. /Services/branches,
   /Services/team and /Services/sales, each naming the uncomfortable
   figure: the book no branch serves, the map nobody works, the deals
   nobody owns. Migration 20260830001500, hosted-apply scope
   `branches-org-sales`. Still ahead in this pillar: door-to-door
   canvassing routes and knock dispositions, and multi-touch attribution.
8. **Marketing hub**: segments, lists, campaigns, email/SMS sends over
   env-gated providers (Resend machinery exists for email), consent and
   unsubscribe as first-class records, deliverability events, ROI;
   B2B prospecting only via legally licensed enrichment providers behind
   owner-supplied keys — contact data is never fabricated.
9. **AI Copilot**: natural-language search over CRM records, scheduling
   and routing suggestions, lead prioritization, churn risk,
   next-best-action, IPM anomaly detection — every recommendation cites
   the recorded rows it derives from.
10. **E2E acceptance**: seeded TEST-data journey (residential +
    commercial, branches, technicians, routes, IPM, chemicals,
    campaigns, billing) through Lead → Sale → Contract → Schedule →
    Route → Service → Barcode/IPM → Chemical Log → Compliance → Invoice
    → Payment → Marketing → Renewal. **PEST CRM: PRODUCTION READY is
    declared only after this passes** — not before, by anyone.

## Standing rules for every increment

- Supabase is the system of record; every table forced-RLS org-scoped;
  anon/service_role revoked unless a reviewed definer needs otherwise.
- The timeline is the audit trail: system kinds only ever written by
  reviewed database machinery; no update/delete grants, ever.
- Honest labels: a section joins the Services navigation only when its
  page genuinely works; gated integrations say **Not Connected** and name
  the exact variable.
- No fake production data, dead buttons, mock integrations, TODOs or
  hardcoded success. The one sanctioned fake dataset is the Demo Data
  book (ADR-187): seeded only into an empty workspace, through the real
  machinery, with every record carrying the exact **Demo Data** source
  label and fictional-only contact ranges.
