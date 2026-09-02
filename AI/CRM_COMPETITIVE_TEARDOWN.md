# CRM competitive teardown: HubSpot, PestBoss, PestPac

Owner /goal (2026-09-02): *"list out every feature of the Hubspot, BOSS, and
Pest Pack CRM and marketing platforms. Identify the top 25 issues /
complaints from each platform and build them into my CRM platform from an
AI first perspective to make it even better. Make my platform world class.
Wire everything 100% to supabase and 100% production ready."*

"BOSS" is **PestBoss** and "Pest Pack" is **PestPac** (WorkWave) — the same
identification `AI/PEST_CRM_COMPETITOR_MATRIX.md` settled on after finding
that no product called BOSS exists in the field. **HubSpot** is measured as
the CRM + marketing platform the goal names it as, hub by hub.

This document is the audit half of the goal. The build half is tracked as
increments in `AI/BACKLOG.md` under "World-class CRM build-out", each with
its own ADR, and the status column here is updated as each one ships. A row
marked **HAVE** means a real table, a real route and a real page; nothing
here is marked on the strength of a plan.

## Method, and what the evidence is worth

- **Feature inventories** are taken from each vendor's own published
  feature index, product pages and catalogue, cross-checked against the
  independent review aggregators' feature checklists.
- **Complaints** are taken from verified-reviewer text on Capterra, G2,
  GetApp, SourceForge and Software Advice, plus two long-form independent
  reviews per product. Each complaint row cites the kind of reviewer who
  said it. Where the same complaint is made by many reviewers it is listed
  once and marked *recurring*.
- **PestBoss has thin public evidence.** Its own site returned errors
  during this audit, it has a handful of published reviews, and G2 says
  outright it has "not enough reviews to provide buying insight". Two
  complaints are quoted from real reviewers; the rest of its 25 are
  **capability absences** visible from its own published feature list
  measured against what the field ships, each marked *(inferred)*. That is
  said plainly rather than dressed up as reviewer sentiment.
- The **AI-first** answer to a complaint is, in this phase, a deterministic
  one: computed from the workspace's own rows at the moment of asking, with
  the fact that raised it printed beside it (ADR-224, ADR-228). Free-form
  generation needs an AI provider, which is an outbound capability that
  ships **Not Connected** until an owner supplies one (ADR-207). That is
  not a lesser answer — most of the complaints below are about software
  that hides *why*, and a computed reason is the fix.

Sources: [HubSpot products](https://www.hubspot.com/products),
[HubSpot product & services catalog](https://legal.hubspot.com/hubspot-product-and-services-catalog),
[65 HubSpot features](https://www.3andfour.com/hubspot-features),
[HubSpot review — Hack'celeration](https://hackceleration.com/labs/review/hubspot),
[HubSpot Marketing Hub review — Docket](https://docket.io/resources/research/hubspot-marketing-hub-review),
[HubSpot Service Hub review — Macha](https://www.getmacha.com/blog/hubspot-service-hub-review),
[HubSpot CRM reviews — Capterra](https://www.capterra.com/p/152373/HubSpot-CRM/reviews/),
[HubSpot Marketing reviews — Capterra](https://www.capterra.com/p/171840/HubSpot-Marketing/reviews/),
[PestPac](https://www.pestpac.com/),
[PestPac CRM](https://www.pestpac.com/features/pest-control-crm-software),
[PestPac review — Connecteam](https://connecteam.com/reviews/pestpac/),
[PestPac review — Pest Control Software Guide](https://pestcontrolsoftwareguide.com/pestpac-review/),
[PestPac reviews — Capterra](https://www.capterra.com/p/23130/PestPac/reviews/),
[PestBoss — Software Advice](https://www.softwareadvice.com/field-service/pestboss-profile/),
[PestBoss — GetApp](https://www.getapp.com/all-software/a/pestboss/),
[PESTBOSS — SourceForge](https://sourceforge.net/software/product/PESTBOSS/),
[PestBoss — Capterra](https://www.capterra.com/p/194603/PESTBOSS/).

---

## Part 1 — Feature inventories

**HAVE** = shipped, wired to Supabase, on a page. **PARTIAL** = the data
exists but a piece of what the vendor sells does not. **BUILD n** = in
increment n of the program below. **GATED** = needs an external account
(provider), ships **Not Connected** until an owner supplies one. **RED** =
needs a separate owner authorization under `policies/RISK_CLASSIFICATION.md`.
**N/A** = outside what a pest-services CRM core is; listed so the count stays
honest, not built.

### 1A. HubSpot

| # | Feature | Hub | Us |
|---|---------|-----|----|
| 1 | Contact, company and deal records with associations | Smart CRM | **HAVE** (ADR-185/186) — accounts, contacts, properties, opportunities |
| 2 | Custom objects and custom properties | Smart CRM | **N/A by design** — the schema is typed and checked; "one wrong setting breaks setup" (PestPac complaint 37) is what free-form properties produce |
| 3 | Website activity tracking / Prospects (companies visiting the site) | Smart CRM | **N/A** — outside a CRM core |
| 4 | Email integration and open/click tracking | Smart CRM | **GATED** (email provider) |
| 5 | Call integration and recording | Sales | **GATED** (telephony) |
| 6 | Task management with due dates, owners, priorities | Smart CRM | **HAVE** (ADR-228, increment 26) |
| 7 | Insights: automatic company research / enrichment | Smart CRM | **GATED** (licensed enrichment provider; contact data is never fabricated) |
| 8 | Marketplace of 1000+ integrations | Platform | **PARTIAL** — the provider registry (ADR-207) is the integration surface; eight providers, each honestly labelled |
| 9 | Snippets and templates | Sales | **PARTIAL** — notice templates (ADR-217), automation templates (ADR-196) |
| 10 | Meeting scheduling with calendar sync | Sales | **PARTIAL** — portal service requests carry a preferred date (ADR-198); no calendar link |
| 11 | Quotes / CPQ | Sales | **HAVE** (ADR-194) — estimates with lines |
| 12 | KPI dashboards | Sales | **HAVE** (ADR-199) — drill-down to the rows behind a figure: **BUILD 30** |
| 13 | Sales automation (workflows on prospect behaviour) | Sales | **PARTIAL** — rules recorded (ADR-196); a dry-run that names exactly which records a rule would touch: **BUILD 30**; an executor on a clock: **RED** |
| 14 | ABM tools | Sales | **N/A** |
| 15 | Sequences (multi-step email) | Sales | **GATED** (email provider) |
| 16 | Lead scoring (predictive and manual) | Sales/Marketing | **BUILD 27** — explainable: every point itemised from an editable rule |
| 17 | Forecasting | Sales | **HAVE** (ADR-202) with no model; owner-supplied scenario inputs printed beside the figure: **BUILD 32** |
| 18 | Lead rotation and automatic assignment | Sales | **PARTIAL** — territory → rep exists (ADR-195); assignment on create: **BUILD 27** |
| 19 | HubSpot Payments | Sales/Commerce | **GATED** (card processor) |
| 20 | Playbooks | Sales/Service | **PARTIAL** — form templates (ADR-197) are the standardised script |
| 21 | Forms | Marketing | **HAVE** (ADR-197) |
| 22 | Email automation | Marketing | **GATED** (email provider) |
| 23 | SMS automation | Marketing | **GATED** (SMS provider) |
| 24 | Ads management and retargeting | Marketing | **N/A** |
| 25 | Social media management | Marketing | **N/A** |
| 26 | Advanced segmentation / lists | Marketing | **HAVE** (ADR-196) — lists with consent as a record |
| 27 | Landing pages | Marketing/Content | **N/A** |
| 28 | Duplicate detection and merge | Marketing/Data | **PARTIAL** — detection on create (ADR-186); an audited merge: **BUILD 28** |
| 29 | Company scoring and qualification | Marketing | **BUILD 27** (same explainable engine) |
| 30 | SEO recommendations | Marketing | **N/A** |
| 31 | Smart content / personalisation | Marketing | **N/A** |
| 32 | A/B testing | Marketing | **N/A** |
| 33 | Advanced reporting and analytics | Marketing/Data | **HAVE** (ADR-199, 202, 206); drill-down **BUILD 30** |
| 34 | Breeze AI: assistants, agents | Cross-hub | **PARTIAL** — computed copilot (ADR-224, ADR-228); generation **GATED** (AI provider) |
| 35 | Content Remix, Brand Voice, AI writer, AI image/video | Content | **GATED** (AI provider) |
| 36 | Ticketing / help desk | Service | **PARTIAL** — portal requests with a staff response (ADR-198); an SLA clock: **BUILD 31** |
| 37 | Live chat and chatbot | Service | **GAP** — two-way portal messages: **BUILD 31**; live chat needs a provider |
| 38 | Conversation routing | Service | **GAP** |
| 39 | Service automation (status notifications) | Service | **PARTIAL** — transactional notices compose and address (ADR-217); sending **GATED** |
| 40 | NPS / customer satisfaction surveys | Service | **BUILD 31** — asked in the portal after a completed visit, no email needed |
| 41 | Conversation intelligence | Service | **GATED** (AI + telephony) |
| 42 | SLA management | Service | **BUILD 31** |
| 43 | Knowledge base | Service | **GAP** |
| 44 | Customer portal | Service | **HAVE** (ADR-198, ADR-203, ADR-222) |
| 45 | Drag-and-drop page editor, themes, CDN, hosting, staging, membership, password pages | Content/CMS | **N/A** — a website builder is outside a CRM core (PestPac sells one too; listed, not built) |
| 46 | Field mapping on import | Data/Ops | **BUILD 28** — explicit mapping with a dry run that refuses to invent columns |
| 47 | Data quality automation | Data/Ops | **BUILD 28** (import), **BUILD 32** (stale-contact hygiene) |
| 48 | AI-based duplicate merging | Data/Ops | **BUILD 28** — merge with an audit line, never automatic |
| 49 | Scheduled workflows (date/time triggers) | Ops | **RED** — nothing here runs on a timer without owner authorization |
| 50 | Programmable automation (JavaScript), webhooks, custom UI extensions | Ops | **N/A** |
| 51 | Datasets for reporting | Ops | **HAVE** — the dashboards are whole-book SQL, not bounded fetches |
| 52 | Multi-touch attribution (Enterprise) | Marketing | **HAVE** as records (ADR-196) |
| 53 | Predictive analytics (Enterprise) | Marketing | **BUILD 27** — churn risk with itemised reasons, no model |
| 54 | Sandbox environments, advanced permissions (Enterprise) | Platform | **N/A** in this phase |
| 55 | Mobile app | Cross-hub | **HAVE** as responsive web (ADR-210) |
| 56 | Account Updater / stored payment methods | Commerce | **PARTIAL** — instruments as metadata + mandate (ADR-218); the vault **GATED** |
| 57 | Email deliverability tooling | Marketing | **GATED** |
| 58 | Contact lifecycle stages | Marketing | **HAVE** (ADR-185) — lead → prospect → customer → inactive, trigger-written history |
| 59 | Subscription / consent management | Marketing | **HAVE** (ADR-196, ADR-217) — consent keeps its moment; do-not-contact is separate from marketing consent |
| 60 | Reporting on sequences, campaigns, ROI | Marketing | **PARTIAL** — attribution records exist; sends are gated so ROI has no denominator yet |

### 1B. PestPac (WorkWave)

| # | Feature / module | Us |
|---|------------------|----|
| 1 | Appointment scheduler, drag-and-drop, technician timeline | **HAVE** (ADR-189, ADR-221) |
| 2 | Best Fit semi-automatic assignment | **PARTIAL** — putting a visit on a route assigns it (ADR-221); a suggested slot needs geocoding |
| 3 | Recurring job generation (calendar, interval, preset dates) | **HAVE** (ADR-189, ADR-211) |
| 4 | Bulk scheduling | **PARTIAL** — plan generation is bulk; bulk edit is not |
| 5 | RouteOp route optimisation by drive time | **GATED** (mapping provider) |
| 6 | Visual Route Manager | **PARTIAL** — the day route sequencer (ADR-221); a map needs geocoding |
| 7 | Multi-day route projects | **GAP** |
| 8 | Technician mobile app, iOS/Android | **HAVE** as responsive web (ADR-210) |
| 9 | Offline mode | **HAVE** (ADR-210) |
| 10 | Job start/stop, timesheets | **HAVE** (ADR-197) |
| 11 | Form submission and signature capture in the field | **HAVE** (ADR-197, ADR-210) |
| 12 | Payment collection in the field | **GATED** (card processor) |
| 13 | Media / photo upload | **HAVE** (ADR-196) |
| 14 | WorkWave Forms: templates, typed fields, service-type-triggered forms | **HAVE** (ADR-197); triggered-by-service-type: **PARTIAL** |
| 15 | Termite / WDI inspection reporting and diagrams | **HAVE** (ADR-205) + printable (close-out) |
| 16 | Chemical tracking, EPA compliance logging | **HAVE** (ADR-192) |
| 17 | Smart Trap integration | **GATED** (device vendor feed) |
| 18 | Damage and treatment history | **HAVE** (timeline, applications, WDO) |
| 19 | Inventory by truck and branch | **HAVE** (ADR-213) |
| 20 | Automated invoicing (per job, in advance, monthly cycle) | **HAVE** per-visit (ADR-212) and from due plans (ADR-200); on a clock: **RED** |
| 21 | Online payments, card and ACH | **GATED** |
| 22 | Customer payment profiles / autopay | **PARTIAL** (ADR-218) — the charge **GATED** |
| 23 | Branded self-service customer portal (CustomerConnect) | **HAVE** (ADR-198, ADR-203, ADR-222) |
| 24 | Communication Center: SMS, email, voice; automated confirmations and reminders; message logging | **PARTIAL** — composed, addressed, deduplicated and suppressed (ADR-217); the send **GATED** |
| 25 | Wavelytics: Intelligence Hub, scorecards, leaderboards, automated problem flagging | **HAVE** dashboards + leaderboards (ADR-195, ADR-199); problem flagging: **HAVE** (ADR-228 suggestions) and **BUILD 30** (schedule audit) |
| 26 | Standard reports: service completion, production value, sales forecast, material usage, technician efficiency | **HAVE** — dashboards, forecast, compliance report, productivity |
| 27 | Custom report builder, exports to Excel/PDF | **PARTIAL** — CSV/JSON exports per report; whole-book export: **BUILD 28** |
| 28 | User roles and permissions | **PARTIAL** — org membership + super-admin; per-role fences are the org chart's roles (ADR-195), not enforced per page |
| 29 | Audit logging | **HAVE** — immutable timeline and append-only ledgers everywhere |
| 30 | Technician profiles: certifications, availability, territories | **HAVE** (ADR-189, ADR-195, ADR-197) |
| 31 | Conflict detection: double-booking, certification mismatch | **BUILD 30** — the schedule audit |
| 32 | CRM: leads, duplicate detection, lead status, custom fields | **HAVE** (ADR-185/186); custom fields **N/A by design** |
| 33 | Lead-to-opportunity conversion, expected revenue | **HAVE** (ADR-186) |
| 34 | Tasks and reminders, follow-up date tracking | **HAVE** (ADR-228) |
| 35 | Digital contracts, sent for signature | **HAVE** record + signature completeness (ADR-194); e-delivery **GATED** |
| 36 | Automatic lead assignment | **BUILD 27** |
| 37 | Service opportunity identification (upsell on closed services) | **BUILD 27** — upsell signals with reasons |
| 38 | Actionable dashboard with recommended next steps | **HAVE** (ADR-228) |
| 39 | Google Analytics and call-tracking integration, marketing ROI | **GATED** |
| 40 | Geographic lead mapping | **GATED** (geocoding) |
| 41 | API (GET/POST), phone-system integration (Dialpad, TalkDesk), AI platform connectivity | **PARTIAL** — the routes are the API; telephony and AI **GATED** |
| 42 | Multi-unit properties | **HAVE** (ADR-215) |
| 43 | On-site compliance logbook (AIB/SQF/BRC) | **PARTIAL** — the portal holds every page of the binder (ADR-203, ADR-222); a bound export: **BUILD 28** |
| 44 | Post-service customer surveys | **BUILD 31** |
| 45 | Online sales (self-serve plan purchase) | **GATED** (payments) |
| 46 | Print marketing fulfilment, direct mail | **GATED** (vendor) |
| 47 | Website builder | **N/A** |
| 48 | Multi-branch / multi-location | **HAVE** (ADR-195) |
| 49 | Third-party GPS (Verizon Connect, Geotab, Azuga) | **GATED** |
| 50 | Zapier (higher tiers) | **N/A** |
| 51 | Advanced accounting / QuickBooks | **PARTIAL** — balanced journal export (ADR-220); sync **GATED** |
| 52 | eCommerce | **GATED** |
| 53 | Marketing automation | **PARTIAL** — rules as records; executor **RED** |

### 1C. PestBoss

| # | Feature | Us |
|---|---------|----|
| 1 | Account management and CRM, customer database and history | **HAVE** |
| 2 | Task / appointment scheduling, calendar management, dispatch | **HAVE** |
| 3 | Routing | **PARTIAL** — sequencing yes, optimisation gated |
| 4 | Job management, work orders, job tracking | **HAVE** |
| 5 | Digital work orders from the field | **HAVE** (ADR-210) |
| 6 | Automated invoicing, billing | **HAVE** (ADR-200, ADR-212); on a clock **RED** |
| 7 | Electronic payments, payment collection in the field | **GATED** |
| 8 | Quotes / estimates, contract management | **HAVE** (ADR-194) |
| 9 | Electronic signature, mobile signature capture | **HAVE** (ADR-197) |
| 10 | Client portal: service reports, messages, inspection history, real-time site analytics | **HAVE** reports/history/analytics (ADR-203, ADR-222); messages: **BUILD 31** |
| 11 | Monitoring reports created, filed and shared from the field | **HAVE** filed (ADR-216); shared by email/SMS **GATED** |
| 12 | Pest activity heat maps | **HAVE** (ADR-206) |
| 13 | Barcode scanning of devices and chemicals | **HAVE** (ADR-191); chemical-lot barcodes: **GAP** |
| 14 | In-field barcode production | **HAVE** (ADR-214) |
| 15 | Device monitoring dashboards, thresholds, alerts | **HAVE** (ADR-191); alert delivery **GATED** |
| 16 | Property layouts / site maps | **PARTIAL** — WDO diagrams (ADR-205); site device maps need coordinates or a floor plan |
| 17 | Pesticide usage tracking | **HAVE** (ADR-192) |
| 18 | Inventory management and control | **HAVE** (ADR-213) |
| 19 | Fleet management | **HAVE** (ADR-201) |
| 20 | Time clock | **HAVE** (ADR-197) |
| 21 | Employee and technician management | **HAVE** (ADR-189, ADR-195) |
| 22 | Multi-location | **HAVE** |
| 23 | Email management, SMS messaging, reminders, alerts/notifications | **PARTIAL** (ADR-217) — the send **GATED** |
| 24 | Activity dashboard, real-time reporting, reporting & statistics | **HAVE** (ADR-199) |
| 25 | Data archiving | **HAVE** — nothing is deleted; superseded records stay readable |
| 26 | Accounting integration | **PARTIAL** (ADR-220) |
| 27 | Third-party integrations | **PARTIAL** (ADR-207) |
| 28 | Mobile access | **HAVE** |
| 29 | Compliance / regulatory record-keeping | **HAVE** (ADR-192) |
| 30 | Version 5 platform refresh (announced) | — |

---

## Part 2 — The top 25 complaints, and what each one becomes here

Columns: the complaint as reviewers put it; the kind of reviewer; what the
complaint is really about; and the row in this product that answers it,
with its status.

### 2A. HubSpot

| # | Complaint | Who | What it is about | Our answer |
|---|-----------|-----|------------------|------------|
| 1 | The 44× price jump from Starter to Professional; non-refundable onboarding fees (recurring) | owners, CEOs, marketing VPs | Pricing cliffs | **Product stance, recorded here**: this CRM has no modules and no tiers inside the product — every increment ships to every workspace. The website's plans (ADR-15x) price seats, not features. |
| 2 | Contact-tier pricing escalates as the list grows; auto-upgrade mid-contract with no cleanup grace | marketing, CEOs | Paying for stale data | **BUILD 32** — stale-contact hygiene report; and no per-contact pricing exists here to punish a large book |
| 3 | Basic features keep moving behind paid tiers; reporting "unnecessarily locked down" | VPs, growth consultants | Feature paywalling | Every dashboard, report and export is in the base product (ADR-199, 202, 220) |
| 4 | Steep learning curve; "so many features and menus"; interface "noisy" (recurring) | agents, directors, CMOs | Complexity | Each Services page does one job and says what it proves; the copilot's refusal lists what CAN be asked (ADR-224) |
| 5 | Reporting is limited; dashboards cap the number of reports; no drill-down | analysts, directors | Opaque figures | **BUILD 30** — every dashboard figure opens the rows behind it |
| 6 | Workflows are hard to build, hard to visualise past ten branches, "nerve-racking" to set live | RevOps, strategists | Fear of automation | **BUILD 30** — a rule can be DRY-RUN: exactly which records it would touch, before it is ever active; executors stay **RED** |
| 7 | Importing from Excel silently creates new properties | customer service | Import without consent | **BUILD 28** — import shows every column, requires an explicit mapping, refuses to invent a field, and dry-runs first |
| 8 | Duplicate companies with no cleanup tools; "inactive and bounced contacts need manual cleanup" | BDRs, marketers | Data hygiene | **PARTIAL** now (detection, ADR-186); **BUILD 28** merge with an audit line; **BUILD 32** hygiene |
| 9 | Lead scoring is "complex and clunky"; contact scoring "finicky, we have to restart the workflow" | RevOps, marketing | Scoring nobody can explain | **BUILD 27** — a score is a sum of named rules with editable weights, and every point is printed with its reason |
| 10 | Forecasting tool lacks customisation | RevOps | A model you cannot see | **HAVE** a forecast with NO hidden model (ADR-202); **BUILD 32** owner-supplied scenario inputs, printed beside the figure |
| 11 | Email template builder limited and dated; landing pages generic | marketers | Design tooling | **N/A** — the send is gated; templates here are text with a transcript of what was sent |
| 12 | Email deliverability issues; shared-IP reputation | marketers | Sending infrastructure | **GATED** — a provider row; when connected, every send is a `crm_messages` record with its outcome |
| 13 | Support "directs you to generic articles"; 18–24h email responses; no live chat on Pro | owners, admins | Support model | Outside product code. Every page states its own rules in prose; there is no "help center" layer to be worse than the page |
| 14 | Sales team moved a customer from monthly to annual without consent | marketer | Contract practice | Outside product code; recorded because it is a top-25 |
| 15 | Mobile app trails the desktop | many | Two products drifting | **HAVE** one responsive product measured at eight widths in CI, not a second app |
| 16 | Lag switching sections | reviewers | Performance | Every page is a bounded read; dashboards aggregate in the database (ADR-199) |
| 17 | Integration quirks; bi-directional sync needs middleware; marketplace apps unmaintained | directors | Integration honesty | **HAVE** the registry (ADR-207): `live` is derived from a sealed credential existing, never from a stored flag |
| 18 | Data outdated or inaccurate | branch managers | Trust in the record | The timeline is immutable and trigger-written; a status change cannot exist without its history line (ADR-185) |
| 19 | Modular purchase forces unwanted tiers; "does everything but specialises in nothing" | consultants | Bundling | See #1; this product is one pest-services CRM, not a suite of hubs |
| 20 | Implementation took ten months with incomplete delivery | CEO | Setup burden | The Demo Data book (ADR-187) fields a whole operation in one click, through the real machinery, every record labelled |
| 21 | Notifications overwhelming | agents | Signal vs noise | **HAVE** (ADR-228) — one Follow-ups page; suggestions are rules that fire on facts, deduplicated per key, dismissable |
| 22 | Deal visualisation "could be improved" | directors | Pipeline reading | **HAVE** stage board with whole-book conversion (ADR-186) |
| 23 | Confusion between lists, workflows and sequences | reviewers | Three things that look alike | Lists are membership with consent (ADR-196); automations are rules (ADR-196); notices are transactional (ADR-217) — three tables, three pages |
| 24 | Per-seat pricing on Sales Pro; Ops Hub needed for deeper automation | directors | Paying twice | See #1 |
| 25 | Free tier has zero support; Service Hub "weaker as a standalone desk"; knowledge base gated | support leads | Service depth | **BUILD 31** — request SLA clock and two-way portal messages, in the base product |

### 2B. PestPac

| # | Complaint | Who | What it is about | Our answer |
|---|-----------|-----|------------------|------------|
| 1 | "Nickel and dime you for each feature"; "everything is extra"; modules on top of modules (recurring) | owners, presidents, office managers | Add-on pricing | See HubSpot #1 — no modules exist here to charge for |
| 2 | Contract traps: cancellation terms misrepresented, "bait and switch", billed after failing obligations, invoices to a dissolved entity sent to collections | owners, GMs, office managers | Sales and contract practice | Outside product code; recorded because it is the most-cited |
| 3 | Steep learning curve; "programmer-level knowledge"; lookup tables; "50 steps to get something done" (recurring) | owners, operations managers | Complexity | Every increment ships with one page that does the job; the follow-ups page is the shortest path to "what next" (ADR-228) |
| 4 | Archaic, dated interface; "not with the times" (recurring) | owners, operations | Interface | Site-wide theme system (ADR-225), measured at eight widths, no serious axe findings |
| 5 | Bugs unaddressed; updates remove features; UI changes without notice; downtime for hours during updates | office managers, proprietors | Release discipline | Every change lands through four required CI jobs, a migration replay, and a hosted postflight that RAISES on a broken schema (ADR-178); nothing is applied to production without its own ledger entry |
| 6 | Support slow, tickets only, paid webinars, "forums instead of help" (recurring) | owners, HR | Support model | Outside product code |
| 7 | Scheduling puts tasks on the wrong day; technician schedules "missing stops"; phantom arrival times; customer communications randomly stop | office managers, marketing | Schedule integrity | **HAVE** a route cannot hold a stop for another day or another technician (ADR-221 trigger); **BUILD 30** the schedule audit names every double-booking, unrouted visit and unplanned due plan |
| 8 | Reporting "totally off", "inaccurate"; "impossible to determine profitability reliably" | branch managers, presidents | Trustworthy numbers | Dashboards aggregate over the whole book in SQL (ADR-199); **BUILD 29** job profitability with every input printed |
| 9 | Errors "cannot be corrected"; cannot un-void an invoice; inflexible name fields | operations, owners | Correction path | Voided invoices are reissued, never rebuilt (ADR-212); applications are superseded, never edited (ADR-192); **BUILD 28** audited merge for the account-level mistake |
| 10 | No email preview before sending notifications | admins | Sending blind | **HAVE** notices are composed and readable before any send (ADR-217); **BUILD 30** dry-run for rules |
| 11 | "Not built for two-way communication" | reviewers | One-way messaging | **BUILD 31** — two-way portal messages, threaded on the account |
| 12 | Mobile app: no manager dashboards, no in-app alerts, dated navigation, low store ratings; invoices differ between desktop and mobile | technology directors, operations | Two products | **HAVE** one responsive product; the invoice print view is the same page at every width (close-out) |
| 13 | Forms lack conditional logic; must print on specific paper; plain-paper printing is a paid module | operations, admins | Forms tooling | **HAVE** browser printing for labels, reports and invoices, free (ADR-214, close-out); conditional questions: **GAP** |
| 14 | No 2FA / biometric login confirmed | reviewers | Account security | **BUILD 32** — TOTP enrolment through Supabase Auth's own MFA, if policy review clears it as YELLOW (it touches authentication) |
| 15 | No built-in GPS or time tracking; GPS is a paid add-on with manual fleet upload | reviewers | Field telemetry | **HAVE** timesheets (ADR-197); GPS **GATED** |
| 16 | Integrations are bolt-ons; no QuickBooks/Xero; Zapier only on higher tiers | reviewers | Integration honesty | **PARTIAL** balanced journal export (ADR-220); registry (ADR-207) |
| 17 | Data "held hostage"; migration expensive, incomplete, "extreme manual work daily" | owners | Lock-in | **BUILD 28** — a whole-book export the customer can take anywhere, from a button |
| 18 | Customer-facing side lacking for multi-unit | VP finance | Portal depth | **HAVE** multi-unit (ADR-215) and the commercial portal (ADR-203) |
| 19 | Logs out constantly mid-workflow | reviewers | Session handling | Supabase Auth refresh sessions; no product-level timeout |
| 20 | Routing costs extra; Visual Route Manager needs a separate login | office managers | Routing access | **HAVE** the day route in the base product (ADR-221); optimisation **GATED** |
| 21 | Inspection reports do not meet state regulations | technology directors | Compliance fidelity | **HAVE** NPMA-33-shaped WDO with a not-null verdict (ADR-205); per-jurisdiction rules at recording (ADR-192) |
| 22 | Modules have compatibility issues with each other | office managers | Integrity across modules | Same-organization composite foreign keys everywhere; the seeded acceptance journey crosses module boundaries (ADR-224) |
| 23 | "Doesn't lead you to the next step very well"; "not intuitive" | admin process managers | Guidance | **HAVE** (ADR-228) — the next step is computed and explained |
| 24 | Change-log reporting incomplete; some fields not tracked | IT support managers | Audit trail | **HAVE** immutable timeline; append-only ledgers for scans, applications, payments, movements, filed copies |
| 25 | Cannot pick own card-processing partner; cannot bill monthly; per-user licences; forms need specific paper | presidents, office managers | Being boxed in | Processor **GATED** on whichever account the owner supplies (ADR-207); level billing **HAVE** (ADR-211 cadence); seats are the only price |

### 2C. PestBoss

Evidence is thin — see Method. Rows marked *(quoted)* are real reviewer
text; rows marked *(inferred)* are capability absences read from PestBoss's
own published feature list against what the field ships.

| # | Complaint | Basis | Our answer |
|---|-----------|-------|------------|
| 1 | "The current version is old fashion, so glad version 5 is being deployed" | *(quoted)* manager, 2+ years | Theme system and eight-width measurement (ADR-225) |
| 2 | Too few public reviews for a buyer to judge — "not enough reviews to provide buying insight" | *(quoted)* G2 | The seeded acceptance journey and this teardown are the buyer's evidence (ADR-224) |
| 3 | No route optimisation by drive time | *(inferred)* | Same gate as everyone: **GATED** on a mapping provider — said so |
| 4 | No sales pipeline with stages, conversion and loss reasons | *(inferred)* | **HAVE** (ADR-186) |
| 5 | No canvassing / door-to-door | *(inferred)* | **HAVE** (ADR-196 + close-out) |
| 6 | No marketing lists with consent, campaigns, attribution | *(inferred)* | **HAVE** as records (ADR-196) |
| 7 | No commission management or leaderboards | *(inferred)* | **HAVE** (ADR-195) |
| 8 | No territory mapping | *(inferred)* | **HAVE** (ADR-195) |
| 9 | No WDO/termite diagrams | *(inferred)* — reviewer notes it is "effective for termite control", diagrams are not listed | **HAVE** (ADR-205) |
| 10 | No recurring auto-invoicing from due plans | *(inferred)* — "automated invoicing" is listed without cadence | **HAVE** (ADR-200) |
| 11 | No AR aging or dunning worklist | *(inferred)* | **HAVE** (ADR-199, ADR-200) |
| 12 | No revenue forecasting | *(inferred)* | **HAVE** (ADR-202) |
| 13 | No twice-monthly / custom sequencing | *(inferred)* | **HAVE** (ADR-211) |
| 14 | No offline field mode stated | *(inferred)* | **HAVE** (ADR-210) |
| 15 | No multi-unit property model | *(inferred)* | **HAVE** (ADR-215) |
| 16 | No truck-stock movement ledger | *(inferred)* — "inventory" is listed without locations | **HAVE** (ADR-213) |
| 17 | No autopay authorisation / mandate | *(inferred)* | **PARTIAL** (ADR-218) |
| 18 | No lead scoring, churn risk or next-best-action | *(inferred)* | **HAVE** next step (ADR-228); **BUILD 27** |
| 19 | No duplicate detection | *(inferred)* | **HAVE** (ADR-186) |
| 20 | No provider registry / integration status | *(inferred)* — "third-party integrations" listed generically | **HAVE** (ADR-207) |
| 21 | Small vendor, single product line — continuity risk | *(inferred)* | Whole-book export **BUILD 28** is the customer's insurance either way |
| 22 | No published pricing | *(inferred)* | Seats, published |
| 23 | No customer surveys | *(inferred)* | **BUILD 31** |
| 24 | No compliance-rule enforcement per jurisdiction at recording time | *(inferred)* — "pesticide usage tracking" listed without rules | **HAVE** (ADR-192) |
| 25 | Facility-monitoring depth without a residential sales motion | *(inferred)* | **HAVE** both (ADR-185: residential and commercial kinds; ADR-198 and ADR-203 portal views) |

---

## Part 3 — The build program

Ordered by how many complaint rows each increment closes, and by what
closes cleanly without a provider. Each ships whole through the standard
cadence: migration → routes → page → tests → PR → four real checks → merge
→ hosted apply → postflight.

| Inc | Name | Closes | Status |
|-----|------|--------|--------|
| 26 | **Follow-ups and the suggested next step** (ADR-228): `crm_tasks`, `crm_followup_dismissals`, `crm_suggest_followups()` — seven rules read live, each with its reason; accept-once-while-open; done writes history | HubSpot 21, 6 (partly); PestPac 23, 7 (partly); PestBoss 18 | **SHIPPED** |
| 27 | **Explainable scoring**: lead score, churn risk and upsell signals as sums of named, weighted, editable rules with every point itemised; automatic lead assignment by territory | HubSpot 9, 16, 29, 53; PestPac 36, 37; PestBoss 18 | next |
| 28 | **Data you own**: import with explicit column mapping and a dry run; audited duplicate merge; whole-book export | HubSpot 7, 8; PestPac 9, 17; PestBoss 21 | |
| 29 | **Job profitability**: technician cost rates and lot unit costs; margin per visit, plan, branch, with every input printed | PestPac 8 | |
| 30 | **Nothing hidden**: schedule audit (double-bookings, unrouted visits, due plans unscheduled), automation dry-run, dashboard drill-down | HubSpot 5, 6; PestPac 7, 10 | |
| 31 | **The customer's side of the conversation**: post-service survey in the portal, request SLA clock, two-way portal messages | HubSpot 25, 36, 40, 42; PestPac 11; PestBoss 23 | |
| 32 | **Trust**: forecast scenario inputs, stale-contact hygiene, TOTP enrolment (pending policy review) | HubSpot 2, 10; PestPac 14 | |

**What stays outside this program, and why.** Sending (email, SMS, voice),
charging (card, ACH, in-field), locating (geocoding, GPS), syncing
(QuickBooks), listening (smart traps, telephony), generating (AI drafting)
and reputation platforms each need an account the owner opens; every one is
a row in the provider registry and ships **Not Connected** with the exact
variable named (ADR-207). Anything on a timer — unattended billing, rule
executors, scheduled workflows — is a RED action under
`policies/RISK_CLASSIFICATION.md` and needs its own owner authorization.
Website builders, ads, social, SEO and landing pages are outside a
pest-services CRM core and are listed above so the count stays honest.
