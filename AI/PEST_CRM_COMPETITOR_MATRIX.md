# Pest-control CRM competitor matrix

Owner directive (2026-08-31): *"research top 10 CRM competitors for pest
control such as BOSS and Pest Pack and list all of their features and
capabilities, then build those into this CRM."*

This is the audit half. It names the field, lists what those products
actually do, and marks — honestly — what this CRM has, what it half has,
and what it does not have yet. A row marked **HAVE** means a real table, a
real route and a real page; nothing here is marked on the strength of a
plan.

## The field

Ten products this CRM is measured against, from the 2026 review roundups:

| # | Product | Vendor | Shape |
|---|---------|--------|-------|
| 1 | **PestPac** | WorkWave | Enterprise/commercial-heavy; deepest forms + commercial portal |
| 2 | **FieldRoutes** | ServiceTitan (was PestRoutes) | Growth/enterprise; deepest dispatch + territory mapping, marketing built in |
| 3 | **Briostack** (the BOSS office suite) | Briostack | Automation-first: automated servicing, twice-monthly scheduling, barcode, tech app |
| 4 | **GorillaDesk** | GorillaDesk | SMB; pest-specific, FIFRA chemical tracking, portal + e-sign + GPS on Pro |
| 5 | **Jobber** | Jobber | Horizontal field service; CRM, online booking, one-click routing |
| 6 | **Housecall Pro** | Housecall Pro | Horizontal SMB field service |
| 7 | **ServiceTitan** | ServiceTitan | Enterprise field service platform |
| 8 | **Fieldwork** | Fieldwork | Pest-specific SMB, mobile chemical tracking |
| 9 | **QuoteIQ** | QuoteIQ | Owner-operator; all-in pricing, recurring revenue |
| 10 | **ServSuite** | ServicePro | Long-standing pest/lawn vertical suite |

Sources: [PestPac customer portal](https://www.pestpac.com/features/customer-portal),
[PestPac mobile app](https://www.pestpac.com/features/pest-control-mobile-app),
[PestPac forms](https://www.pestpac.com/features/pest-control-forms-software),
[PestPac customer communication](https://www.pestpac.com/features/customer-communication),
[Briostack platform](https://www.briostack.com/pest-control-software),
[Briostack CRM](https://www.briostack.com/pest-control-software/pest-control-crm-software),
[Briostack scheduling & routing](https://www.briostack.com/pest-control-software/scheduling-routing-software),
[FieldRoutes routing apps](https://www.fieldroutes.com/blog/pest-control-routing-apps),
[FieldRoutes contract management](https://www.fieldroutes.com/blog/pest-control-contract-management-apps),
[GorillaDesk](https://gorilladesk.com/learn/best-web-based-pest-control-software/),
[SafetyCulture 2026 roundup](https://safetyculture.com/apps/best-pest-control-software),
[QuoteIQ 2026 roundup](https://myquoteiq.com/top-10-pest-control-field-service-software-in-2026/),
[Pest Control Software Guide](https://pestcontrolsoftwareguide.com/gorilladesk-vs-fieldroutes/).

## Capability matrix

**HAVE** = shipped, wired to Supabase, on a page. **PARTIAL** = the data
exists but the capability the competitors sell does not. **GAP** = not
built.

### A. CRM and the book of business

| Capability | Who has it | Us |
|---|---|---|
| Residential + commercial accounts, contacts, multiple service locations | all | **HAVE** (ADR-185) |
| Lead → prospect → customer lifecycle with trigger-written history | all | **HAVE** (ADR-185) |
| Duplicate detection on create | PestPac, FieldRoutes | **HAVE** (ADR-186) |
| Global search across records | all | **HAVE** (ADR-186) |
| Account timeline / service history | all | **HAVE** (ADR-185) |
| **Customer portal — residential**: balances, pay invoice, request service, service history | PestPac, GorillaDesk (Pro), Briostack, Jobber | **PARTIAL** — balances, invoices, visit history, documents and service requests ship (ADR-198). Paying online is **Not Connected**: no card processor is configured. |
| **Customer portal — commercial**: open conditions, trend reports with heat maps, device summary, sighting tickets, SDS/compliance document library, inspection history | PestPac | **HAVE** (ADR-203) — open conditions unioning uncorrected sightings with failing stations; a station table read from the scan ledger; monthly activity by station type with the scan count beside it; a customer-filed sighting stamped with its portal seat; an SDS/label library covering only what was applied at the customer's own sites; completed-inspection history. Downloading a signed inspection copy is **Not Connected** — no object storage is configured. |
| Customer communication: automated reminders, SMS/email notifications | Briostack, PestPac, FieldRoutes | **GAP** |

### B. Scheduling, routing, dispatch

| Capability | Who has it | Us |
|---|---|---|
| Work orders, dispatch board, status lifecycle | all | **HAVE** (ADR-189) |
| Recurring service plans / automated service cadence | Briostack, PestPac, FieldRoutes | **HAVE** (ADR-189) |
| Twice-monthly and custom appointment sequencing | Briostack | **HAVE** (ADR-211) — a plan carries ordered steps and a cycle, so "the 1st and the 15th" is 24 visits on those days rather than 27 fortnights that drift off the date, "2nd and 4th Tuesday" anchors to the route, and a seasonal program names a different service per visit. Cycles anchor to the calendar, so March/June/September/November stays those months forever. Sequencing moves visits and never billing: `crm_plan_cadence` reports visits a year beside bills a year so level billing reads as the arrangement it is. |
| **Route optimization / visual route manager / dynamic planner** | FieldRoutes (deepest), PestPac, Briostack, Jobber | **GAP** |
| Technician time in/out and timesheets | PestPac | **HAVE** (ADR-197) |
| **GPS / fleet tracking** | GorillaDesk (Pro), FieldRoutes | **GAP** (needs a provider — would ship Not Connected) |

### C. Mobile and the field

| Capability | Who has it | Us |
|---|---|---|
| Barcode scanning of stations | Briostack, PestPac | **HAVE** (ADR-191) |
| Materials/chemical logging from the field | PestPac, FieldRoutes, GorillaDesk, Fieldwork | **HAVE** (ADR-192) |
| **Technician mobile app** | all | **HAVE** (ADR-210) — /Services/field, a phone-shaped surface showing dispatched work and recording completions and station scans. Responsive web rather than a store-published native app. |
| **Offline mode — full capacity without signal** | PestPac | **HAVE** (ADR-210) — writes are queued on the device against a client-minted token and replayed until the SERVER confirms, so a retry through a tunnel produces one visit rather than six. The screen never says "saved" for something still queued, refusals stay counted as unsent, and nothing unsent is ever pruned. The technician's own clock is what gets recorded, not the sync's. |
| Signature capture | PestPac, GorillaDesk (Pro) | **HAVE** (ADR-197) on forms — a name, a moment and a stored image, whole or absent |
| Photos, files and documents attached to orders and accounts | PestPac | **HAVE** (ADR-196) — diagrams still a GAP |
| **In-field card payment** | PestPac | **GAP** |

### D. Inspections and forms

| Capability | Who has it | Us |
|---|---|---|
| IPM devices, thresholds, scan ledger | Briostack, PestPac | **HAVE** (ADR-191) |
| Pest sightings with corrective actions | PestPac | **HAVE** (ADR-191) |
| Digital form builder: inspections, service reports, compliance checklists — assignable, signed, instantly on the desktop | PestPac | **HAVE** (ADR-197) |
| **WDO / termite graphs and diagrams** | PestPac, ServSuite | **HAVE** (ADR-205) — NPMA-33-shaped reports with a not-null verdict, obstructions and inaccessible areas as first-class columns, and a 0..1 coordinate diagram with click-to-place marks. An issue-time check refuses a report that contradicts its own findings in either direction. Uploading a floor plan is **Not Connected** — no object storage — so the built-in structure outline ships. |

### E. Chemicals and compliance

| Capability | Who has it | Us |
|---|---|---|
| Chemical catalogue with EPA identity, SDS/label references | PestPac, FieldRoutes, GorillaDesk | **HAVE** (ADR-192) |
| Lot tracking with drawdown | PestPac | **HAVE** (ADR-192) |
| Append-only application log with applicator licence | FIFRA-compliant set | **HAVE** (ADR-192) |
| Per-jurisdiction rules enforced at recording | PestPac | **HAVE** (ADR-192) |
| Audit-ready report, CSV export | all | **HAVE** (ADR-192) |
| Technician licence expiry tracking | PestPac, ServSuite | **HAVE** (ADR-197); alerting is a GAP — the report exists, nothing notifies |

### F. Billing and payments

| Capability | Who has it | Us |
|---|---|---|
| Estimates / proposals | PestPac, FieldRoutes | **HAVE** (ADR-194) |
| Contracts with terms and signature record | FieldRoutes, PestPac | **HAVE** (ADR-194) |
| Invoices, payments, refunds, void | all | **HAVE** (ADR-194) |
| Service details and chemical usage pulled onto the invoice | PestPac, FieldRoutes | **HAVE** (ADR-212) — a draft invoice is built from the completed visit: the service at the plan's agreed value, then one line per current application naming product, amount, target pest and EPA number. Chemicals are priced at zero because the material is part of the service, and the exact amount is printed at the scale the compliance log recorded it. One visit bills once, across the whole book; a built invoice is voided and reissued rather than rebuilt. |
| **Autopay, stored payment methods, card + ACH** | PestPac, FieldRoutes, Briostack | **GAP** — the ledger records money that moved; it does not move money |
| **Recurring/subscription auto-invoicing** | Briostack, FieldRoutes | **PARTIAL** (ADR-200) — invoices are raised from due service plans, idempotently, and a plan cannot be billed twice for a period. Running it on a SCHEDULE is the gap: nothing in this product runs on a timer, so generation is operator-triggered and the page says **Not Connected** about the rest. |
| **AR aging, dunning, automated reminders** | Briostack, PestPac | **PARTIAL** — aging by bucket (ADR-199) and a collections worklist with recorded actions (ADR-200) both ship. AUTOMATED reminders are the gap: no email/SMS provider is connected, so a notice records what a person did rather than what a machine sent. |
| **QuickBooks sync** | Briostack, GorillaDesk, Jobber | **GAP** |

### G. Sales and marketing

| Capability | Who has it | Us |
|---|---|---|
| Opportunity pipeline with stages | FieldRoutes, Briostack | **HAVE** (ADR-186) |
| Territory mapping | Briostack, FieldRoutes | **HAVE** (ADR-195) |
| Per-rep and per-territory performance, leaderboards | Briostack | **HAVE** (ADR-195) |
| Commission management | Briostack | **HAVE** (ADR-195) |
| Branches / multi-office | PestPac, FieldRoutes, ServSuite | **HAVE** (ADR-195) |
| Door-to-door canvassing routes and knock dispositions | FieldRoutes, Briostack | **HAVE** (ADR-196) |
| Campaigns, lists, consent | FieldRoutes, Briostack, PestPac | **HAVE** (ADR-196); the *send* is a GAP — no provider is connected |
| Marketing automation and attribution | FieldRoutes, Briostack | **HAVE** (ADR-196) as records; no executor runs the rules |
| **Reviews / reputation management** | FieldRoutes, Jobber | **GAP** |

### H. Reporting and analytics

| Capability | Who has it | Us |
|---|---|---|
| Pipeline conversion report | Briostack | **HAVE** (ADR-186) |
| Compliance/application report with CSV | PestPac | **HAVE** (ADR-192) |
| **Operating dashboards: revenue, retention/churn, tech productivity, route density** | all | **HAVE** (ADR-199) — all four, aggregated over the whole book in the database rather than over a bounded fetch. |
| **Commercial trend reports with heat maps** | PestPac | **HAVE** (ADR-203, ADR-206) — month x station-type activity on the customer's Stations tab, rendered as a shaded grid. It draws FOUR states rather than one ramp, because the data distinguishes them: nobody scanned, scanned without counting, counted at nothing, and counted with activity. Only the third is a clean month, and the grid refuses to let the other two borrow that reading. |
| **Revenue forecasting** | Briostack | **HAVE** (ADR-202) — projects active plans and contracts with their term, and applies no churn or growth model, because this system has no evidence for one. Every omission is reported beside the figure. |

### I. Operations

| Capability | Who has it | Us |
|---|---|---|
| Branch/office structure with managers | PestPac, ServSuite | **HAVE** (ADR-195) |
| Org chart, roles, reporting lines | PestPac, ServSuite | **HAVE** (ADR-195) |
| Warehouse/lot inventory | PestPac | **HAVE** (ADR-213) — an append-only movement ledger between warehouses (branches) and vehicles or sprayers (equipment), with every balance DERIVED rather than stored. A location can never go negative: the guard locks the lot before it reads the balance. A consumption names the application it served and their quantities must agree, and one application draws stock exactly once however often an offline sync replays. |
| **Equipment and fleet/asset management** | ServSuite, FieldRoutes | **HAVE** (ADR-201) — assets, an append-only ledger, assignment, service schedules and meter readings that cannot run backwards. GPS telemetry beside it stays **Not Connected**. |
| **Call centre / phone integration** | FieldRoutes, PestPac | **GAP** |

## Build order

Ranked by what a buyer comparing us to PestPac or Briostack would notice
first, and tracked in `AI/BACKLOG.md`:

1. ~~Documents, canvassing, marketing~~ — **SHIPPED** as ADR-196.
2. ~~Digital forms and inspections engine~~ — **SHIPPED** as ADR-197,
   with timesheets and licence expiry.
3. ~~Customer portal, residential AND commercial views~~ — **SHIPPED** as
   ADR-198 and ADR-203.
4. ~~Operating dashboards~~ — **SHIPPED** as ADR-199 (revenue, receivable
   aging, retention, technician productivity, route density). Route
   OPTIMIZATION by drive time is still open and needs a mapping provider.
5. ~~Recurring invoicing, AR aging and dunning~~ — **SHIPPED** as ADR-200
   (aging shipped with ADR-199). Generation is operator-triggered and
   idempotent; running it on a schedule needs a scheduler this product
   does not have, and sending a reminder needs an email provider.

## What is genuinely left, sorted by whether we can finish it

**Buildable now — no provider, no external account:**

1. ~~Commercial portal view~~ — **SHIPPED** as ADR-203. It was projection
   work over the existing definer pattern, as predicted: no new tables,
   one provenance column.
2. ~~Equipment and fleet/asset management~~ — **SHIPPED** as ADR-201.
3. ~~Revenue forecasting~~ — **SHIPPED** as ADR-202.
4. ~~WDO/termite graphs and diagrams~~ — **SHIPPED** as ADR-205. It was a
   drawing surface, as expected, but the hard part turned out to be the
   verdict rather than the drawing: a not-null answer so an unfinished
   inspection cannot read as a clean structure.
5. ~~Offline mode for technicians~~ — **SHIPPED** as ADR-210, together
   with the technician surface. The correctness bar was the reason it was
   last, and it earned that: building it found a shipped trigger that
   would have recorded every offline visit at sync time.

**Needs an external provider.** ADR-207 built the registry these depend on:
`/Services/integrations` lists every one, says what it unlocks, and reports
whether it is live — derived from a sealed credential actually existing,
never from a stored status. So each of these is now wired to the point
where the only missing piece is an account, and the **Not Connected** label
is read from the database rather than hard-coded in a component. What
remains for each is the account itself, and the provider-specific send or
charge call behind it: card/ACH
processing and in-field payment, autopay and stored payment methods,
SMS/email delivery (which also gates automated reminders and campaign
sending), GPS/fleet telemetry, QuickBooks sync, call-centre/telephony
integration, and reviews/reputation platforms.

**A note on what "parity" can mean here.** 58 capability rows: **47 HAVE,
3 PARTIAL, 8 GAP.**

The composition matters more than the count. As of ADR-210 **every
remaining GAP is provider-gated — all eight of them.** Not most, not
roughly half: all. SMS/email reminders, route optimization by drive time,
GPS telemetry, in-field card payment, autopay and card/ACH, QuickBooks
sync, reviews, and call-centre integration each need an account somebody
has to open and pay for.

There is no longer a row on this list that could be closed by writing more
code. ADR-207 built the registry those eight depend on, so each is wired to
the point where supplying a credential and the provider's own send-or-charge
call are the only remaining steps, and `/Services/integrations` reports
whether each is live from a sealed credential actually existing rather than
a hard-coded label.

The three PARTIALs are capabilities where the data ships and a piece of
what the competitors sell does not — automated sending on a schedule, drag
route sequencing, and paying online. Only the first two are buildable;
paying online is provider-gated like the eight GAPs beside it. Appointment
sequencing (ADR-211), invoice lines from the visit (ADR-212) and truck
stock (ADR-213) were on this list until they were built.
