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
| **Customer portal — residential**: balances, pay invoice, request service, service history | PestPac, GorillaDesk (Pro), Briostack, Jobber | **GAP** |
| **Customer portal — commercial**: open conditions, trend reports with heat maps, device summary, sighting tickets, SDS/compliance document library, inspection history | PestPac | **GAP** |
| Customer communication: automated reminders, SMS/email notifications | Briostack, PestPac, FieldRoutes | **GAP** |

### B. Scheduling, routing, dispatch

| Capability | Who has it | Us |
|---|---|---|
| Work orders, dispatch board, status lifecycle | all | **HAVE** (ADR-189) |
| Recurring service plans / automated service cadence | Briostack, PestPac, FieldRoutes | **HAVE** (ADR-189) |
| Twice-monthly and custom appointment sequencing | Briostack | **PARTIAL** — recurrences exist, sequencing does not |
| **Route optimization / visual route manager / dynamic planner** | FieldRoutes (deepest), PestPac, Briostack, Jobber | **GAP** |
| Technician time in/out and timesheets | PestPac | **HAVE** (ADR-196) |
| **GPS / fleet tracking** | GorillaDesk (Pro), FieldRoutes | **GAP** (needs a provider — would ship Not Connected) |

### C. Mobile and the field

| Capability | Who has it | Us |
|---|---|---|
| Barcode scanning of stations | Briostack, PestPac | **HAVE** (ADR-190) |
| Materials/chemical logging from the field | PestPac, FieldRoutes, GorillaDesk, Fieldwork | **HAVE** (ADR-191) |
| **Technician mobile app** | all | **GAP** |
| **Offline mode — full capacity without signal** | PestPac | **GAP** |
| Signature capture | PestPac, GorillaDesk (Pro) | **HAVE** (ADR-196) on forms — a name, a moment and a stored image, whole or absent |
| Photos, files and documents attached to orders and accounts | PestPac | **HAVE** (ADR-195) — diagrams still a GAP |
| **In-field card payment** | PestPac | **GAP** |

### D. Inspections and forms

| Capability | Who has it | Us |
|---|---|---|
| IPM devices, thresholds, scan ledger | Briostack, PestPac | **HAVE** (ADR-190) |
| Pest sightings with corrective actions | PestPac | **HAVE** (ADR-190) |
| Digital form builder: inspections, service reports, compliance checklists — assignable, signed, instantly on the desktop | PestPac | **HAVE** (ADR-196) |
| **WDO / termite graphs and diagrams** | PestPac, ServSuite | **GAP** |

### E. Chemicals and compliance

| Capability | Who has it | Us |
|---|---|---|
| Chemical catalogue with EPA identity, SDS/label references | PestPac, FieldRoutes, GorillaDesk | **HAVE** (ADR-191) |
| Lot tracking with drawdown | PestPac | **HAVE** (ADR-191) |
| Append-only application log with applicator licence | FIFRA-compliant set | **HAVE** (ADR-191) |
| Per-jurisdiction rules enforced at recording | PestPac | **HAVE** (ADR-191) |
| Audit-ready report, CSV export | all | **HAVE** (ADR-191) |
| Technician licence expiry tracking | PestPac, ServSuite | **HAVE** (ADR-196); alerting is a GAP — the report exists, nothing notifies |

### F. Billing and payments

| Capability | Who has it | Us |
|---|---|---|
| Estimates / proposals | PestPac, FieldRoutes | **HAVE** (ADR-193) |
| Contracts with terms and signature record | FieldRoutes, PestPac | **HAVE** (ADR-193) |
| Invoices, payments, refunds, void | all | **HAVE** (ADR-193) |
| Service details and chemical usage pulled onto the invoice | PestPac, FieldRoutes | **PARTIAL** — invoices reference a work order; lines are not generated from it |
| **Autopay, stored payment methods, card + ACH** | PestPac, FieldRoutes, Briostack | **GAP** — the ledger records money that moved; it does not move money |
| **Recurring/subscription auto-invoicing** | Briostack, FieldRoutes | **GAP** |
| **AR aging, dunning, automated reminders** | Briostack, PestPac | **GAP** |
| **QuickBooks sync** | Briostack, GorillaDesk, Jobber | **GAP** |

### G. Sales and marketing

| Capability | Who has it | Us |
|---|---|---|
| Opportunity pipeline with stages | FieldRoutes, Briostack | **HAVE** (ADR-186) |
| Territory mapping | Briostack, FieldRoutes | **HAVE** (ADR-194) |
| Per-rep and per-territory performance, leaderboards | Briostack | **HAVE** (ADR-194) |
| Commission management | Briostack | **HAVE** (ADR-194) |
| Branches / multi-office | PestPac, FieldRoutes, ServSuite | **HAVE** (ADR-194) |
| Door-to-door canvassing routes and knock dispositions | FieldRoutes, Briostack | **HAVE** (ADR-195) |
| Campaigns, lists, consent | FieldRoutes, Briostack, PestPac | **HAVE** (ADR-195); the *send* is a GAP — no provider is connected |
| Marketing automation and attribution | FieldRoutes, Briostack | **HAVE** (ADR-195) as records; no executor runs the rules |
| **Reviews / reputation management** | FieldRoutes, Jobber | **GAP** |

### H. Reporting and analytics

| Capability | Who has it | Us |
|---|---|---|
| Pipeline conversion report | Briostack | **HAVE** (ADR-186) |
| Compliance/application report with CSV | PestPac | **HAVE** (ADR-191) |
| **Operating dashboards: revenue, retention/churn, tech productivity, route density** | all | **GAP** |
| **Commercial trend reports with heat maps** | PestPac | **GAP** |
| **Revenue forecasting** | Briostack | **GAP** |

### I. Operations

| Capability | Who has it | Us |
|---|---|---|
| Branch/office structure with managers | PestPac, ServSuite | **HAVE** (ADR-194) |
| Org chart, roles, reporting lines | PestPac, ServSuite | **HAVE** (ADR-194) |
| Warehouse/lot inventory | PestPac | **PARTIAL** — product lots exist; truck stock does not |
| **Equipment and fleet/asset management** | ServSuite, FieldRoutes | **GAP** |
| **Call centre / phone integration** | FieldRoutes, PestPac | **GAP** |

## Build order

Ranked by what a buyer comparing us to PestPac or Briostack would notice
first, and tracked in `AI/BACKLOG.md`:

1. ~~Documents, canvassing, marketing~~ — **SHIPPED** as ADR-195.
2. ~~Digital forms and inspections engine~~ — **SHIPPED** as ADR-196,
   with timesheets and licence expiry.
3. **Customer portal** (increment 10) — both PestPac and Briostack lead
   with it; residential first, then the commercial view.
4. **Dashboards and route optimization** (increment 11).
5. **Recurring auto-invoicing, AR aging and dunning** (increment 12).

Three capabilities need an external provider and will ship labelled **Not
Connected** until an owner supplies credentials, never implied as working:
card/ACH processing, SMS/email delivery, and GPS/fleet telemetry.
