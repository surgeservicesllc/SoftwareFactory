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
4. **Pest/IPM differentiator**: devices/stations with QR/barcode
   identity, install/service/move/remove scans, station history and
   conditions, captures/consumption, thresholds and trends, pest
   sighting logs, corrective actions; multi-site commercial dashboards.
5. **Chemicals & compliance**: product/lot inventory, application logs
   (rate/quantity/location/applicator), license tracking, SDS/label
   references, jurisdiction-configurable rule records (never one
   hardcoded state), audit-ready PDF/CSV export per
   customer/site/date/pest/device/chemical/technician.
6. **Invoicing & payments**: estimates/proposals → invoice → payment on
   the existing Stripe machinery; `payment` timeline events.
7. **Sales**: territories, canvassing routes, dispositions, leaderboards,
   commissions, attribution.
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
