# Current state

## 2026-09-02: scope=all's gate repaired (ADR-236)

The broad push's protected-catalog gate
(`.github/hosted-apply/guard/scope-all-protected-catalog-ready.sql`) names
the four `_checked` mutators' sources as `20260822000900` left them — the
values the record-only chain's verification already pinned beside the old
ones — instead of as `20260822000200` wrote them. Nothing else in the gate
changed. `hosted-guard-captures.behavior` 4: the broad gate now prints `t`
against the whole chain (was `f` for exactly those four hashes, ADR-235);
the EXPAND-state and CONTRACT-preflight expectations are unchanged. On
hosted, `scope=all` can pass its catalog gate again; a broad push remains
an owner-dispatched action and no scope is in this change.

## 2026-09-02: Guard captures (ADR-235)

The apply workflow's three largest inline SQL blocks — the captured
catalog checks `VERIFIED=` (scope=bot-account-binding's own postflight),
`CATALOG_READY=` (the retired CONTRACT scope's preflight) and
`PROTECTED_CATALOG_READY=` (scope=all's protected-catalog gate) — are
files under `.github/hosted-apply/guard/`, verbatim and dedented, read
with `$(psql "$DB_URL" -v ON_ERROR_STOP=1 -Atq -f …)`. The workflow is
409,854 bytes and the guard is ratcheted from 450,000 to 420,000. No scope
is in the change. `hosted-guard-captures.behavior` 4 (each file captured
once by its own step and still branched on; both EXPAND-state checks `t`
with the chain replayed to 20260822000200; the CONTRACT preflight `f`
once 20260822000300 lands; the broad gate `f` against the whole chain for
exactly one reason — the four `_checked` mutators' source hashes, which
20260822000900 rewrote — and `t` with that clause set aside). The two
suites that pin what those steps prove read the files spliced in place
(`tests/support/hosted-apply-guards.ts`); path references are checked
both ways as before. Finding: on hosted, `scope=all` has refused with
"catalog is not exact" since the plpgsql repair landed; the four-pin
repair is a recorded follow-up in its own change. Hosted applies:
`customers-side` run 33584595689 succeeded on main `81e10cf`; `trust`
run 33585834149 succeeded on main `fca867e`.

## 2026-09-02: Trust (ADR-234)

Increment 32 ships `20260902000700_trust.sql`: `crm_forecast_assumptions`
(one row per workspace — annual churn and growth in basis points, a note
on their provenance; RLS forced; deliberately unseeded) and
`crm_revenue_forecast_scenario(months, churn_bps, growth_bps)`, SECURITY
INVOKER, returning the recorded forecast beside the same months with the
rates compounded month by month and the factor printed, month zero always
the recorded figure, inputs clamped to 0–100%; and
`crm_contact_hygiene(org)`, SECURITY INVOKER, naming every contact the
book should not trust with the reasons (unreachable, undeliverable,
duplicate email, inactive account, untouched for a year), most flagged
first, returning nothing for a clean contact. Routes
`GET/PUT/DELETE /api/services/forecast/scenario` (a what-if from the
query is applied and never saved; the payload says which source was
applied) and `GET /api/services/data/hygiene`. The Dashboards forecast
tab gains a Scenario card; the Data page gains a Hygiene card. Copilot
skill "Which contacts are stale?". TOTP enrolment is recorded as RED and
owner-gated with its exact scope in the backlog, per PROTECTED_RESOURCES
and RISK_CLASSIFICATION.

Evidence: 3 behavior tests on the replayed chain (twelve flat months
untouched at zero rates; (0.88)^(11/12) eleven months out at twelve
percent churn, decreasing factors, churn and growth compounded together,
inputs clamped; one set of assumptions per workspace inside 0–100% and
invisible to a rival; the hygiene report naming four contacts with their
exact reasons in order — an inactive, undeliverable, duplicated and
untouched contact first — and nobody clean; both functions
authenticated-only). Pure 3, routes 4, panels 2 (the scenario card applies
the saved numbers, tries a what-if without saving and saves in basis
points with provenance; the hygiene card states the reasons, lists each
contact and says when the book is clean), copilot +1. Seed roster with the
assumptions deliberately unseeded; grants roster and RLS census 227;
scope replay with the new postflight; runbook count 227; byte guard
449,510 of 450,000 — the next scope needs an extraction first; tsc and
eslint clean. Hosted apply scope `trust`: run 33585834149 succeeded on
main `fca867e`.

## 2026-09-02: The customer's side (ADR-233)

Increment 31 ships `20260902000600_customers_side.sql`: `crm_portal_surveys`
(one 1–5 rating per completed visit, written only through
`crm_portal_survey_submit` — a definer scoped to the caller's own account
that refuses an unfinished visit and a second rating and writes a history
line; staff SELECT only; deliberately unseeded), two stamps on
`crm_portal_requests` (`acknowledged_at`, `first_response_at`) set once
by a BEFORE trigger and never moved by hand, `crm_sla_defaults()` per kind
in the schema with `crm_sla_policies` holding a workspace's overrides and
`crm_request_sla()` computing met / breached / waiting / overdue /
unrecorded live, and `crm_portal_messages` (a thread either side writes:
the customer through `crm_portal_message_send`, staff through RLS as
themselves; immutable once sent, the read mark set once). Staff routes
under /api/services/portal/{sla,surveys,messages}; customer routes under
/api/customer-portal/{surveys,messages}. The Customer Portal page gains
Request clock, Ratings and Messages tabs with a per-kind policy editor;
the customer's portal rates a completed visit from the Visits tab and
carries a Messages tab that marks staff replies read on opening. Copilot
skills "How are customers rating us?" and "Which requests are past their
promise?". The seed writes staff-authored messages and one policy
override; the customer side of every seeded thread is honestly empty.

Evidence: 4 behavior tests on the replayed chain (a rating once, on the
caller's own completed visit, kept as history, invisible and immutable to
staff, and invisible to a rival; six defaults, one override, the clock
moving from overdue to breached when acknowledgement comes late and from
waiting to met when a question is answered and resolved, an unstamped
acknowledgement reading unrecorded, and a stamp that cannot be moved by
hand; a thread the customer writes on their own request and not on
another's, staff writing as themselves and not as anybody else, a body
that cannot be edited and a read mark set once, marks counted on both
sides; nine functions granted to authenticated only and three tables
fenced with forced RLS). Seed audit 66/66 with surveys deliberately
unseeded; grants roster, RLS census 226, scope replay with the new
postflight, runbook count 226, byte guard (448,707), tsc and eslint
clean. Hosted apply scope `customers-side`: run 33584595689 succeeded on
main `81e10cf`.

## 2026-09-02: Nothing hidden (ADR-232)

Increment 30 ships `20260902000500_nothing_hidden.sql`: three SECURITY
INVOKER, STABLE functions that store nothing. `crm_schedule_audit(org,
days)` names six contradictions with the rows involved — double-booked
(each visit its own finding), slipped (window passed, still open),
unrouted, plan due with no visit within a week, planned arrival outside
the promised window, and a visit reassigned after routing — high before
medium before low. `crm_automation_dry_run(org, rule, days)` lists which
records a rule would touch right now, what it would do to each and why it
would not (no email/phone on file, do-not-contact, marketing or notices
declined); the rule's counters cannot move. `crm_dashboard_rows(org,
figure, key)` opens every dashboard figure by the aggregate's exact
predicate, every key cast inside a CASE on the figure. The Schedule page
shows the audit above the board; the Marketing page's automations table
gains a Dry run per rule with coverage stated first and the send labelled
Not Connected; every Dashboards tile, month, bucket, technician and day
opens the rows behind it. Copilot skill "What contradicts in the
schedule?".

Evidence: 4 behavior tests on the replayed chain (all six findings raised
by fixtures and none by the clean rows, ordered by severity; three rules
dry-run with the exact would-do text and blocked reason and counters
untouched; every dashboard figure's row count equal to its aggregate,
bucket by bucket, technician by technician, day by day, with a stray key
never parsed; a rival sees nothing and only `authenticated` may execute);
4 pure tests; 5 route tests; 3 panel tests (schedule audit card and its
clean state; drill-down keys for a tile, a bucket, a technician, a day and
a month with the ceiling stated; dry-run coverage and per-record lines);
copilot +1. Scope replay with the new postflight, runbook count 225, byte
guard 450,000 (447,824), tsc, eslint and a production build clean. Hosted
apply scope `nothing-hidden`: run 33582776542 on main `0ec154f`, success,
postflight passed.

## 2026-09-02: Job profitability (ADR-231)

Increment 29 ships `20260902000400_job_profitability.sql`: two bounded,
nullable cost columns (`crm_technicians.hourly_cost_cents`,
`crm_product_lots.unit_cost_cents`; NULL means unknown, never zero) and
`crm_visit_profitability(org, days)`, SECURITY INVOKER, returning per
completed visit the revenue (non-void invoices linked to the visit; NULL
when none), labour minutes with their basis (finished timesheets, or the
scheduled window said so), labour cost, chemical cost from the lot's
recorded unit cost, the count of applications that could not be costed,
and a margin that is NULL whenever any input is unknown. Nothing is
stored. /Services/profitability shows totals and groupings by technician,
service and branch over known visits only with the unknown count beside
them, a card of unknowns by reason, the visits worst-first with every
input printed, and the cost editors in dollars. Copilot skill "Which jobs
lost money this quarter?" states coverage before naming a loser. The seed
gives most technicians a rate and most lots a cost, leaving some unknown
so the page's unknown states are exercised.

Evidence: 6 behavior tests on the replayed chain (a fully known visit at
$486.00 − $50.00 (75 min at $40/h, timesheet) − $3.00 = $433.00, 89.09%,
with a voided duplicate excluded; window basis when no shift was clocked;
NULL margins for no rate, an uncosted lot and no invoice; worst-known
first with NULLs last and the 90-day window honoured; a rival sees
nothing and only `authenticated` may execute; negative and absurd costs
refused); 3 summariser and 3 panel tests; 2 copilot tests; seed audit
64/64 with the new optional columns; scope replay (44 probes, new
postflight), runbook count 224, byte guard 450,000, tsc, eslint and a
production build clean. Hosted apply scope `job-profitability`: run
33581692298 on main `a42ee73`, success, postflight passed.

## 2026-09-02: Workflow headroom (probe heredocs extracted)

The apply workflow's probe step ran its last four probes from inline
heredocs; they are now files under `.github/hosted-apply/probe/` (44),
byte-identical, re-pointed with `-f`, each executed by the scope-replay
test which pins the count. The workflow is 446,039 bytes; the
byte guard is ratcheted from 455,000 to 450,000 so the room stays.

## 2026-09-02: Data you own (ADR-230)

Increment 28 ships `20260902000300_data_you_own.sql`: `crm_accounts.merged_into_id`
(a merged account is inactive by CHECK, never itself, and points home),
the append-only `crm_imports` log, and `crm_merge_accounts()` — a definer
that checks membership itself and re-points every child table in ONE
statement of data-modifying CTEs so the (organization, account, property)
keys are checked once at the end; history is never moved, both accounts
get a line, shared list membership and contact preference stay behind,
and a portal-email or live-autopay collision refuses. The importer
(`planImport`, pure) maps every column or refuses, names every invalid
row, holds back in-file repeats, and the route skips and lists duplicates
against the book by the same normals the create path uses; a dry run
writes nothing and a commit records itself. The export is a 65-table
allowlist read through the caller's RLS, one JSON document per table with
a reported ceiling. /Services/data carries all three; the seed records
itself as the book's first import.

Evidence: 5 behavior tests on the replayed chain (self/cross-workspace/
non-member refused; the portal-email collision refused; every child
re-pointed with the shared membership left behind and both histories
written with the re-pointed counts; a merged account refused again and
refused as a customer; the import log append-only, count-checked, and
invisible to a rival); 5 planner tests and 4 panel tests; seed audit
64/64; scope replay, roster, runbook-count, grants-roster, RLS-count,
migration-version, path-reference and byte-ceiling guards; tsc and
eslint clean. Hosted apply scope `data-you-own`: run 33579099463 on main
`c77992e`, success, postflight passed.

## 2026-09-02: Explainable scoring and assignment with its reason (ADR-229)

Increment 27 of the build-out ships `20260902000200_explainable_scoring.sql`:
`crm_scoring_defaults()` (27 rules across lead / churn / upsell, versioned
with the schema and mirrored by `SCORING_DEFAULTS` under a parity test),
`crm_scoring_rules` holding only a workspace's overrides (a trigger refuses
an unknown rule; deleting an override is the reset), and
`crm_score_accounts(org, model)` — a SECURITY INVOKER engine that computes
one facts row per account and keeps, beside every point, the specific
sentence that earned it. Nothing about a score is stored. A new account is
assigned territory, branch and rep by the LAST five-digit postal code in
its billing address against an active territory's declared coverage
(never a city name), only filling what the caller left blank, and a `note`
on its history names the postal code and the territory;
`crm_assign_accounts_by_postal(org)` backfills the same way as the caller.
/Services/signals shows the three models with per-point chips, the rules
editor (points, on/off, save, reset) and the backfill; the copilot gains
warmest leads, churn risk and room to grow. The seeded book gains three
overrides (one per model, each with the reason a person gave).

Evidence: 10 behavior tests on the replayed chain (defaults parity, grant
posture, a lead at 65 with every fact, churn at 75 and 30 with the facts,
upsell at 60 highest-first, override → 80 → 90 → reset to 65 with an
unknown rule refused, rival sees nothing, on-create assignment with its
history line, backfill after coverage grows, a chosen territory never
overridden); 5 panel tests; 2 copilot composer tests; seed audit 63/63;
scope replay, roster, migration-version, path-reference and byte-ceiling
guards; tsc and eslint clean. PR #490 merged as exact main
`eb188a18b8a761133ed3e22d9291a0e995703b14`; hosted apply scope
`explainable-scoring` succeeded in run `33577784853` (postflight: 27
defaults, overrides name real rules, engine and matcher read as the
caller). Both /Services/followups and /Services/signals are live against
production.

## 2026-09-02: The world-class CRM build-out begins with follow-ups and the suggested next step (ADR-228)

The owner /goal of 2026-09-02 is audited in `AI/CRM_COMPETITIVE_TEARDOWN.md`:
HubSpot (60 features across its hubs), PestPac (53 modules) and PestBoss
(30 capabilities) are inventoried against this product row by row, and the
top 25 complaints for each — quoted from verified reviewers on Capterra,
G2, GetApp, SourceForge and Software Advice, with PestBoss's thin evidence
said plainly and its inferred rows marked — are mapped to a
seven-increment program in `AI/BACKLOG.md`.

Increment 26 ships the first: `20260902000100_followups.sql` adds
`crm_tasks` (no DELETE; done/cancelled moments stamped by a BEFORE trigger
from the status alone; a suggested task must carry its rule key and reason,
a manual one must not), `crm_followup_dismissals` (dated), and
`crm_suggest_followups(org)` — a SECURITY INVOKER function reading seven
rules live: stale lead, overdue opportunity, undecided estimate, unanswered
portal request, quiet overdue invoice, expiring licence, uncorrected
high-severity sighting. Nothing is stored. One open task per suggestion key
is a partial unique index. Finishing a follow-up about an account writes a
`task` line on its history through the foundation's definer pattern, which
is also what ends the stale-lead suggestion. /Services/followups accepts
by KEY only (the route recomputes and refuses a key that no longer fires,
409), dismisses for thirty days, and buckets open work into overdue / today
/ later; the copilot gains "What should I follow up on today?". The seeded
book gains 400 tasks; dismissals are deliberately unseeded.

Evidence: 9 behavior tests on the replayed chain (RLS forced, exact grant
posture, all seven rules with their reasons, rival organization sees
nothing, accept-once-while-open, self-stamped moments, history line, dated
dismissal, collection action silencing the rule, both origin contradictions
refused); 5 panel tests; copilot composer tests; seed roster, scope replay,
migration-version and path-reference guards; tsc and eslint clean. PR #490 merged as exact main
`eb188a18b8a761133ed3e22d9291a0e995703b14`; hosted apply scope `followups`
succeeded in run `33577715452` (postflight: one open task per suggestion,
moments stamped by the row, rules read as the caller).

## 2026-08-31: Grok completion DDL is hosted; acceptance awaits a version-safe ACL verifier (ADR-227)

Exact main `24a6313e98023bfc618a921fc563c9f4bde4cad2` passed all four
required jobs in CI run `33400336336`, reached READY Vercel deployment
`dpl_49dFxebk4jpWEXUtfK2CbsQpBk1T`, and reports the matching Git,
deployment, and Supabase project identity from public health. Its workflow-only
containment correctly handles PostgreSQL 18 NOT NULL constraints separately
from the 24 named business constraints. Fresh read-only run `33401887942`
skipped both apply and reload, accepted exact identity and preflight, then
failed closed only at the combined specialist catalog predicate.

That remaining failure is verifier-only. PostgreSQL 17 and 18 add `MAINTAIN`
to the table-owner default privilege set, so the one owner ACL item expands to
eight privileges on the hosted version rather than the hard-coded seven. The
candidate now compares the actual privilege-type set to
`acldefault('r', relowner)` in both directions while independently requiring
the same server-derived expanded-row count, owner-to-owner non-grantable rows,
and denials for `anon`, `authenticated`, and `service_role`. It retains the
PostgreSQL 18 NOT NULL split. The hosted ledger
remains `1|1`; neither migration may be replayed, reset, repaired in history,
or down-migrated. After this workflow-only correction passes exact-head CI and
READY deployment identity, only a fresh read-only `verify` scope may run.

Workers, autonomy, and every automatic action stayed OFF; the global kill
switch stayed ON. Signed-in create/return/reload acceptance and a real
provider-backed repository/PR/CI/deployment journey still remain. **GROK BOT:
PRODUCTION READY is not declared.**

## 2026-08-31: One persistent dark/light choice now covers every site shell (ADR-225)

The repository candidate makes dark the first-visit default for the public
site, control plane, AI Factory, Services CRM, Budget Tracker, Job Search,
customer portal, authentication/decision surfaces, and offline page. An
accessible sun/moon control is reachable from every visual shell, persists one
explicit choice in local storage, synchronizes it across open tabs, and applies
it before first paint on later navigations so a saved light choice does not
flash dark.

Root, Factory, and Services palettes now expose the same semantic surface,
text, border, action, and status contracts in both modes. Services retains its
emerald identity but is dark by default; its prior sage/white presentation is
the light variant. Legacy Services status classes receive a scoped dark
translation. Intentional inverse artwork, provider-brand tiles, modal scrims,
destructive-action contrast, and printable white reports/labels remain fixed
by design rather than being mistaken for application chrome.

Focused component/contract evidence is green. Repository lint and typecheck,
559 test files / 6,415 tests (three files / seven tests skipped), and the
276-page production build pass on the consolidated candidate. The expanded
theme browser journey passes 6/6 across desktop, tablet, and mobile with
persistence, exact
computed palettes, no horizontal overflow, no page errors, and no serious or
critical axe findings. The token contract independently requires at least
4.5:1 for text, muted text, and faint text against each palette's background,
surface, and raised surface. Exact main
`85a7fed15ad876be4e56fd74903e41b68d4488b4` passed all four required jobs in
CI run `33395309085` and reached READY Vercel deployment
`dpl_FcbZciXJFJN1DWxN2mxd23wEPfaU`. Matching health plus authenticated and
public browser acceptance proved the saved preference across Services,
Software Factory, and Budget Tracker. The site-wide theme release is
production accepted.

## 2026-08-31: Grok claim-time admission and specialist planning are hosted, with final verification pending (ADR-219, ADR-226)

The next Grok boundary is implemented and its two forward migrations are now
hosted, but final read-only verification and signed-in production acceptance
remain open. Forward migration
`20260831000900_grok_claim_admission_fence.sql` (canonical LF SHA-256
`7f2dc3b80e466b3c06f589ac6383fd768df847d66e02ec0cab53b8d8431ab737`;
92,648 LF bytes) makes protocol v3 the only service-role Grok claim path. Every
Grok Resume, wake, graph claim, and Phase 1C claim revalidates the complete
immutable admission set against the current graph node, assignment, bot, role,
AI account, credential rotation, provider, and model. The worker receives only
the exact admitted credential projection after claim; credential values are
never stored in launch or roster evidence. A private, one-use Phase 1C
submission guard derives the command provider/model from the current admission
instead of browser or ambient worker configuration. The v2 service-role claim
and legacy Grok control entry points are revoked while non-Grok historical
compatibility remains bounded.

The runtime now resolves exact admitted Claude authentication per MODEL node and
exact admitted Codex authentication per Phase 1C job. An admitted OpenAI model
uses its model/CLI-supported reasoning default rather than an incompatible
hard-coded effort; a legacy job without an admission retains the existing
`high` behavior. Admission-backed bootstrap and claim do not read ambient Codex
credentials, while the legacy path still fails closed when its configured
credential is absent or unsafe.

Forward migration
`20260831001000_grok_specialist_admission_planning.sql` (canonical LF SHA-256
`728628f0368e1f715d8c786ffb536d2d3fcc3a859a177a0665a00ea98a8386f1`;
56,636 LF bytes) advances new plans to version 3. It persists an append-only,
forced-RLS, deterministic snapshot of every Ready configured project posting,
normalizes an explicit `*` to the same fixed canonical capability vocabulary in
TypeScript and PostgreSQL, and exposes only the v3 launcher for new Grok work.
Version 1 and 2 plans remain readable history. Research and deploy plans remain
blocked before graph creation because no intent-specific canonical executable
bridge exists; the planner does not manufacture tasks to make them look ready.

Current focused evidence is 17/17 for the protected completion workflow,
10/10 for claim behavior/contracts, and 69/69 for worker/auth runtime. The
earlier combined planner/admission/release lanes were 164/164 before the final
rebase and are supporting evidence only. Consolidated local lint, typecheck,
559 test files / 6,415 tests, and the 276-page production build now pass on the
final combined tree; the separate site-theme browser journey passes 6/6. Those
local gates do not substitute for the still-pending migration chain/catalog/
RLS/ACL/replay/rollback checks, exact-head CI and deployment identity, hosted
ledger/catalog/ACL/runtime/lint postflight, signed-in acceptance, or real
provider-backed end-to-end evidence.

Migration `00900` was accepted by protected apply run `33397377838` and
independent read-only run `33397710586`. Migration `01000` was applied and
ledgered by run `33397811324`; that run then stopped on the verifier-only ACL
and PostgreSQL-18 constraint-enumeration defects described in ADR-226. Workers, autonomy, and every automatic
action remain OFF, and the global kill switch remains ON. No actual
provider-backed run, repository change, draft pull request, or exact-head CI
chain has passed through this boundary. **GROK BOT: PRODUCTION READY is not
declared.**

## 2026-08-31: Stock has a place, not just a quantity (ADR-213)

A lot has always known how much of it is left. It now also knows where the
remainder sits: an append-only movement ledger between warehouses
(branches) and vehicles or sprayers (equipment), with every balance derived
by summing that ledger rather than stored anywhere. A truck's stock is
exactly what was put on it minus what left.

A location can never hold a negative amount of a chemical. The recorder
locks the lot before it reads the balance, so two technicians drawing the
last of a lot cannot both pass. A consumption names the application it
served and their quantities must agree, and one application draws stock
exactly once however often an offline sync replays it — which is where the
field queue and inventory meet.

Corrections are movements, not edits: the ledger takes select and insert
and nothing else, and a miscount is recorded as an adjustment so both the
original and the correction survive.

Each lot on `/Services/compliance` now shows where its remainder is, by
depot and by truck tag.

Repository only: the migration is not yet applied to hosted.

## 2026-08-31: An invoice can be built from the visit it bills (ADR-212)

A draft invoice raised against a completed work order can now be built from
it: the service at the plan's agreed value, then one line per current
chemical application naming the product, the amount at the scale the
compliance log recorded it, the target pest and the EPA registration
number. Chemicals are priced at zero because the material is part of the
service; a zero line says "included, and here is what it was" rather than
inventing a figure nobody agreed to.

It builds once. Invoice lines are insert-only in this schema, so changing a
built invoice uses the verb already provided — void it and raise another,
leaving both documents for an audit. One visit bills once across the whole
workspace, and an invoice already sent cannot be rebuilt underneath the
customer holding it.

The control lives on `/Services/billing` beside the invoice it belongs to,
offering only completed visits for that account that no invoice has billed.

Repository only: the migration is not yet applied to hosted.

## 2026-08-31: A plan now runs on a calendar, not an interval (ADR-211)

A service plan may carry an ordered list of visit steps and a cycle length,
so "the 1st and the 15th" means those days rather than every fourteenth
one, "2nd and 4th Tuesday" anchors to the route it is driven on, and a
seasonal program can name a different service for each visit in the year.
Cycles anchor to the calendar rather than to a stored origin date, so a
March/June/September/November program stays in those months however often
somebody edits or pauses it. A plan with no steps behaves exactly as it
did before.

Two guards are triggers rather than application checks, because PostgREST
is a door: a step must fit its plan's cycle, and a plan carrying steps must
have one. `crm_plan_set_sequence` replaces a whole schedule in a single
statement, so a client that stops halfway cannot leave a plan with a cycle,
no steps and no visits.

Sequencing moves visits and never billing. Where the two disagree that is
level billing — pay monthly, serviced quarterly — which is a normal
arrangement rather than a fault, so the schedule editor reports visits a
year beside bills a year instead of hiding the difference. The editor lives
on `/Services/schedule` beside the plan it belongs to, and previews dates
before anything is saved from a browser copy of the same arithmetic that a
parity suite pins to the database's.

Repository only: the migration is not yet applied to hosted.

## 2026-08-31: Grok immutable launch admission and its runtime verifier are production accepted (ADR-208)

The Grok launch boundary now fails closed unless every executable canonical
node carries an immutable, safe provider admission. New planner version-2
tasks snapshot the exact assignment and bot revisions, role and AI-account
timestamps, provider/model, normalized capabilities, model-tier ceiling, and
credential reference/purpose. They never snapshot a credential value. The
server maps those tasks onto the canonical Full Lifecycle v2 graph, and the
new service-only database launcher locks and re-derives every live identity
before atomically creating the still-paused graph and its append-only
`grok_execution_admissions` evidence. Stale or mismatched identity leaves no
graph, launch, admission, run, or audit residue. Stored version-1 plans remain
readable but cannot execute.

Forward migration `20260831000100_grok_provider_admission.sql` has canonical
LF SHA-256 `37809d9b3d9bc760ffbee501fcca383f0daa5665fb047964734603ceed41aef7`.
It keeps forced RLS and owner-only table ACLs, revokes `service_role` from the
legacy unadmitted launcher, exposes only the v2 launcher to `service_role`, and
adds an exact one-file release scope with ledger/catalog/ACL/lint/runtime/
rollback/health checks. The workflow's rollback canary proves old-launch
denial, stale-revision zero residue, valid launch and exact replay, immutable
admission rows, a paused graph, and zero graph/node runs.

Exact application commit `49b087e1044c157ea24271c81070a2c38b03c8da`
passed all four jobs in CI run `33364471690` and reached exact READY Vercel
deployment `dpl_FeUuBGBeQBDEieFtquUoHRCBPWbc`. Protected apply run
`33365674624` passed every preflight, applied and ledgered `20260831000100`
exactly once, and reloaded PostgREST, then stopped at postflight because the
workflow's two new `prosrc` hashes accidentally included delimiter text.
Independent exact-body/PGlite catalog checks prove the hosted functions and
ACLs are correct. Verifier commit
`d5e91c78e7696072eba72cb744d747c724b73eec` derives the PostgreSQL-stored body hashes:
`3c2b855b41873447c738b2b220d10544` for the admission hash helper and
`78055b8bc6d6d44dbb1cbd6e94657a8d` for the v2 launcher. Then-current-main commit
`25f39c45b15e1089d829150143a4ed6ee78acd36` inherited that fix, passed all
four exact-head jobs in CI `33368051986`, and reached exact READY deployment
`dpl_Hazwv3nZwHnNer7FAKSfkMqGThUU`.

Read-only run `33369343687` then passed exact main/CI/Vercel/health, compiler,
project/file identity, ledger, catalog, and stopped-containment preflight. It
correctly skipped migration apply and schema reload, but failed before the
rollback canary because `psql -c` sent its three `:'variable'` tokens to the
server without client interpolation. Forward commit
`7bdbb5b7a5ef5466f7283ec66d09d3240fbc9311` moves that
fixture input into `.github/grok-release/provider-admission-runtime-input.sql`
and regression-tests that it is consumed through `psql -f`. The failed run
made no durable database change.

Then-current main `f86062a616c3859d93569fb7edfe15d3025b0c26`
retained the workflow, input, test, and provider migration byte-for-byte,
passed all four jobs in CI `33370961802`, and reached exact READY Vercel
deployment `dpl_7vXNrvijm5RrSpLLEnVCSxrrvgDc`. Read-only verify run
`33372115428` passed exact ledger, catalog, ACL, rollback runtime, linked lint,
health, and stopped-safety postflight; its apply and schema-reload steps were
skipped. Signed-in production reload retained project
`51af87ae-27a9-470c-a9a2-73122d01f420` and session
`569325a5-5cd2-40c3-831e-0d90c89188ab`, reloaded both durable messages, and
truthfully remained `request saved; no plan recorded` with no graph, worker,
or provider start. Do not rerun, repair, replay, or down-migrate
`20260831000100`.

At ADR-208 acceptance this was launch admission, not worker admission: the
Resume/wake, claim, specialist-roster, and wildcard follow-ups were still open.
ADR-219 now implements those follow-ups as a repository candidate only; its
two forward migrations, exact production release, signed-in acceptance, and a
real provider-backed E2E remain open. Workers, autonomy, and every automatic
action remain OFF, the global kill switch remains ON, and **GROK BOT:
PRODUCTION READY is not declared.**

## 2026-08-31: Grok atomic control is production accepted; provider loop remains open (ADR-204)

Grok Bot is a SoftwareFactory product label and Chief-of-Staff experience, not
an xAI provider or model. Production now includes exact application commit
`5bc8eea092c683bd53aa25867efe8ab29a32b93b`; all four jobs in CI run
`33358790065` passed, and Vercel deployment
`dpl_ABMNZDEY6drqBP7YdMqrfmHaJrYi` is READY at
`https://softwarefactory-i7tikev82-surgeservices-projects.vercel.app`. At
application acceptance, public health matched that exact release on `main`, Vercel project
`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`, and reachable Supabase project
`qpuofpmagrmyamahqwxw`.

The durable owner-only Supabase boundary remains tenant/project scoped under
forced RLS, with append-only messages/events, immutable task/graph/artifact
links, and monotonic controls. Planned provider/model/agent fields remain
routing intent and are never presented as observed execution evidence. The
service-only bridge can create only the canonical `full_lifecycle` v2 graph and
pause it before visibility; the custom provider-labelled planning DAG is never
launched.

Database-first Phase 1 remains accepted at exact commit
`f6292c8ec359fd8e39c5463e4039b3388cf2056f`. All four jobs in CI run
`33348187052` passed, Vercel deployment
`dpl_A35nZhbJQMJWLtUSroG9zXLWhXBw` was READY with matching health, migration
apply run `33348980504` passed, and independent read-only verify run
`33349033378` passed. The required ledger vector was `1|1|1|1`, with exact
catalog, ACL, atomic runtime/replay, linked lint, health, and stopped safety.
Do not rerun the mutation scope.

Phase 2 containment is also production accepted. Signed-in acceptance on the
Demo Data project submitted a harmless README wording request and created
session `569325a5-5cd2-40c3-831e-0d90c89188ab`. Missing ready Claude coverage
was refused truthfully into a durable `blocked`, nonclosed session with exactly
two messages and five immutable events in order: `session.created`, user
`message.appended`, assistant `message.appended`, `session.planning_failed`,
and `session.blocked`. The URL retained the exact session through return and
reload. No plan, routing identity, graph, run, artifact/deployment evidence,
provider call, worker wake, or dispatch was created. Legacy active session
`74d18263-37ba-4f7d-8230-dc5e41bdc86a` now reloads truthfully as request saved
with no plan.

Workers, autonomy, and automatic actions remain OFF, and the global kill switch
remains ON; no safety state changed. The containment release is accepted, but
the provider-backed loop still requires legitimate ready bot coverage and
separately authorized execution. **GROK BOT: PRODUCTION READY is not declared.**

The production control/read release gives owner Resume a bounded, recoverable
wake path without widening authority. One owner-authenticated database transaction
serializes the session, creates or replays the exact graph-control intent,
records `control.requested`, applies Pause/Resume/Withdraw, resolves the intent,
and records `control.applied`; any refusal rolls the whole transition back. Only
after an audited Resume commits does the route resolve the project's exact
Phase 1C repository binding and send the graph UUID through the existing
target-bound graph-worker dispatch, and only when the graph's immutable
`github_repository_id` equals that resolved target's internal repository id.
An exact applied-Resume replay retries the wake only while the graph is unpaused
and not withdrawn. A legacy requested graph control can finish only when the
durable graph state already reflects its action and no later same-graph
`control.requested` event exists; recovery never reruns the mutation. An
applied key is rejected after any later opposite graph control. New unavailable graph
actions roll back without an intent or event. Pause and stop never dispatch.
Disabled, invalid, conflicting, or unavailable dispatch remains truthful **Not
Connected**. Dispatch acceptance is not represented as a successful claim or
execution. The release changed no worker switch, autonomous action, kill
switch, or provider execution state.

Forward migration `20260830010000_atomic_grok_graph_control.sql`
(SHA-256 `bbd664a7b556a07ab31b84b155725ea8a1b1c5a7f6a6afb1cfe1bae8c07f06b7`)
adds one authenticated, owner-only atomic graph-control boundary. It is
tenant/session/project/exact-launched-graph/key bound, exposes no table grant,
preserves `SECURITY DEFINER` with `search_path=pg_catalog`, and orders supersession by
the immutable per-session `grok_events.sequence_no`. The bounded transcript is
evidence, never an idempotency index.

Migration/workflow commit `6e85b8762c28552313d7de7726118a6d733b42ef`
passed all four jobs in CI run `33356348578` and deployed successfully as
GitHub deployment `6174926870`. Protected run `33357349773` passed exact
preflight and applied `20260830010000` exactly once, inserted its ledger row,
and reloaded PostgREST. Its postflight then stopped on a verifier-only mismatch:
the workflow expected trimmed-body MD5 `55508f9dad0b6f307b02713057949895`,
while PostgreSQL correctly retained the dollar-quoted body's delimiter-adjacent
newlines and reported canonical `prosrc` MD5
`2b0ea737ac99b22570ddbfdd4c583eeb`.

Forward code containment
`2c68e7c9a1ef5ee22a38f7272236d61ab1e11b04` derives the fingerprint from the
exact migration body. It passed all four jobs in CI run `33357696796` and
deployed READY as `dpl_67Amo2Hm9uRNpFUpxTYCz1H83ffY` at
`https://softwarefactory-m8t3wp4zn-surgeservices-projects.vercel.app`. No
migration was replayed, no ledger history was changed, and no attestation-only
migration was added. Read-only run `33359633742` then proved ledger
`1|1|1|1|1`, exact catalog/ACL/runtime/rollback, linked lint, production health,
and stopped safety. Earlier read-only attempt `33358635527` stopped before its
Supabase connection because `main` advanced to owner-merged PR #471; every
database step was skipped and no mutation occurred. The successful attestation
ran only after rebasing the application release and after the unrelated
Services `20260830002200`/`20260830002300` applies completed.

Direct Cancel and Retry are intentionally absent from this endpoint. Their
existing Phase 1C action functions do not provide one atomic action-plus-audit
resolution boundary for every lost-response replay, so exposing them here
could misstate a committed action as failed. The workspace does not advertise
them; a future forward database boundary must make those transitions
correlated and replay-safe before they return.

The Grok workspace now projects canonical linked graph-run evidence instead of
simulated progress: exact node state/provider/model/attempt, tokens, cost,
closure, artifacts, the newest 500 graph events with explicit truncation, the
newest 200 session events when its history is longer, and release evidence
derived through the shared PR/CI/preview/deployment/health adapter. Planned bot
identity remains separate from observed execution routes; no worker or bot
account identity is inferred when the runtime did not persist one. Rollback and
automatic continuation remain explicitly **Not Connected**, and Cancel/Retry
are not advertised from graph state alone.

This is a wake/recovery boundary, not complete provider-identity admission.
The downstream database claim still does not pin the selected Grok bot,
connected account, provider/model, or immutable assignment revisions, and the
graph MODEL executor still uses ambient worker identity. Keep workers OFF and
the global kill switch ON until that separate runtime admission is implemented
and accepted.

## Services CRM (task #63, ADR-185 — newest product)

`/Services` is the pest-services CRM's own product (route group, own
shell, global-nav entry). Foundation live: org-scoped crm_accounts /
crm_contacts / crm_properties under forced member RLS, and the
append-only crm_timeline_events audit spine (no update/delete grants;
status changes self-record by trigger; manual route refuses system
kinds). Overview + Customers & Leads + 360° account pages wired to
five /api/services routes. Increment 2 (ADR-186) live: crm_opportunities
pipeline (stage moves trigger-written onto the timeline, closed_at
trigger+CHECK, no DELETE — conversion truth), whole-book report + board
under /Services/pipeline, duplicate detection on account create via
database-generated normals (surfaced 409, never auto-merged), and global
search across all four record types in the shell. Increment 3 (ADR-189)
live: technicians roster, work orders with trigger-written service
history and a notes-first completion flow, recurring service plans with
guarded visit generation, and the /Services/schedule dispatch board —
five nav sections, all org-scoped forced RLS, nothing deletable, the
timeline's 'service' kind now written only by the reviewed trigger.
The Demo Data book
(ADR-187) makes the product presentable on demand: an empty workspace
can seed a 14-account fictional clientele through the real machinery —
every record source-labeled "Demo Data", history written by the
triggers, loader + DemoNotice + pipeline headline on the Overview.
Pest/IPM (ADR-191) is live: barcoded stations over an append-only scan
ledger (install written at birth, device state projected from the ledger
by trigger, per-organization barcode uniqueness), sightings closed only
by recording a corrective action, and the /Services/ipm command center
with a scan box, per-site station tables, threshold flags and the
sighting loop. Chemicals and compliance (ADR-192) close the regulated half: a product
catalogue with EPA identity and SDS/label links, lots drawn down by
trigger, an append-only application log that copies the applicator's
license and writes its own timeline event, jurisdiction rules configured
as rows and enforced at the boundary, and an audit report served as JSON
or injection-guarded CSV. Billing (ADR-194) closes the money half:
estimates and their lines, contracts with signature and term
completeness, invoices whose paid total and `paid` status are decided by
the settlement trigger rather than asserted by any caller, and the
append-only crm_payments / crm_refunds ledger with a row-locking trigger
that refuses a credit larger than the payment it refunds. Every payment
writes a `payment` timeline event, so all three system kinds now have
real database writers; nothing in billing is deletable, and a void
invoice keeps its reason. /Services/billing reads the four books and the
ledger behind them. The company arrived with ADR-195: crm_branches (code, address, IANA time
zone, open/close dates), crm_employees as the org chart (seven roles, a
branch, a supervisor, a commission rate in basis points, a quota),
crm_territories (a branch's slice of the map, worked by one rep, defined
by the postal codes it covers) and crm_commissions, whose payout is
DERIVED from its basis and rate by trigger — the API has no amount field
at all. Accounts gained a branch, a territory and an owning rep;
opportunities gained an owner; technicians gained a branch and a
supervisor. /Services/branches, /Services/team and /Services/sales read
them, each naming the uncomfortable number rather than hiding it: the
book no branch serves, the map nobody works, the deals nobody owns.
Documents, canvassing and marketing (ADR-196) close the door-to-door and
campaign rows of the competitor matrix: crm_documents holds a private
storage PATH and never a URL or bytes, crm_knocks is append-only so a
disposition cannot be improved after the door closed, consent keeps the
moment it was withdrawn, and the message funnel is CHECKed one-way so a
reported open rate cannot exceed its own delivery. Nothing sends: no
email/SMS provider is connected and no executor runs the automation rules,
and /Services/marketing carries **Not Connected** above every figure.
The forms engine (ADR-197) closes the largest gap in the competitor
matrix: versioned templates over seven field types, answers checked against
their question's declared type by trigger, "completed" counted from the
required questions rather than asserted, signatures whole or absent with the
image stored as a path, and templates frozen once a form is assigned from
them. Timesheets refuse overlapping shifts and report no worked total while
a shift is still running; licence expiry reports current, expiring, expired
and — kept deliberately apart — unrecorded, because a licence with no date
on file is an unknown rather than a pass. /Services/forms reads all four.
The customer portal (ADR-198) admits the first reader who is not a member
of the organization whose rows they read. It does so without widening a
single staff-facing policy: a customer reaches exactly one account through
reviewed SECURITY DEFINER functions whose column lists are the whole of
what they can see, and a signed-in caller with no portal link resolves to
no account and is answered with nothing. Staff invite an address on
/Services/portal; the person at that address turns it into a login
themselves, because the database refuses any write that points a portal
row's login at a session other than the caller's own. /customer-portal
shows that customer their balance, issued invoices, visit history,
paperwork and the requests they have sent, with the company's reply beside
their own words rather than over them. Paying an invoice and opening a
document are both labelled **Not Connected**: no card processor and no
object storage are configured, so the balance and the filing are stated
and nothing pretends to be a button.
The operating dashboards (ADR-199) close the reporting gap, and they are
built on one decision worth restating: every figure is aggregated in the
database by a SECURITY INVOKER function. In SQL, because the corpus is
48,060 rows and a route that tallies a bounded fetch reports a number that
is right only while a workspace is small. As an invoker, because these read
across a whole book — a definer would read across every tenant's at once,
the exact inverse of the portal, where a definer is what narrows. The
migration adds no new visibility; it adds arithmetic over visibility that
already existed. A rate with an empty denominator is null end to end rather
than zero, a running shift contributes no worked minutes, and idle time on
a one-stop day is unknown rather than none. Route DENSITY ships from real
scheduled windows; drive-time sequencing needs a mapping provider and is
labelled **Not Connected**.
Recurring billing (ADR-200) generates a period's invoices from active
plans, and the thing that stops a double bill is a partial unique index
rather than a check in application code. Equipment and fleet (ADR-201) puts
assets over an append-only ledger, with status, assignment and meter
readings as projections of it and a meter that cannot run backwards.
Revenue forecasting (ADR-202) projects plans and contracts with a term
forward and applies no churn or growth model, reporting every reason the
figure understates beside it.
The commercial portal view (ADR-203) finishes the portal: open conditions
unioning uncorrected sightings with stations whose last scan came back
wrong, a station table read from the scan ledger, monthly activity by
station type, an SDS/label library covering only what was applied at the
customer's own sites, completed-inspection history, and a sighting the
customer can file themselves — stamped with their portal seat so a branch
knows who is waiting on a call back. It adds no tables; it is the
projection over data that already existed, and its four deliberate nulls
are what keep it usable as a compliance binder. A station nobody scanned
reports null, not "caught nothing"; a station with no threshold reports
null, not "under" one; a trend cell with no counted scan reports null with
its scan count beside it; and a product with no safety sheet on file is
counted as a gap rather than hidden. Downloading a signed inspection copy
is **Not Connected** — no object storage is configured.
WDO reports (ADR-205) are the last of the large buildable rows. An NPMA-33
is a legal document, and the failure it is built to prevent is a report
that reads as clean when nobody looked: `visible_evidence` is a not-null
boolean, so "no visible evidence observed" is an answer somebody signed
rather than an absence of rows, and an unfinished draft cannot take the
same shape as a completed clean inspection. What could NOT be inspected is
a first-class column on both the staff report and the customer's copy. The
diagram is a 0..1 coordinate space with click-to-place marks, so a finding
recorded without a location is listed rather than silently dropped and
every surface says how many of the findings are actually placed. The
issue-time check that a report cannot contradict its own findings lives on
the trigger rather than in the function that issues, because a member holds
the same privileges through PostgREST and could otherwise write the status
column directly. /Services/wdo. Uploading a floor plan is **Not
Connected** — no object storage is configured — so the built-in structure
outline ships.
A workspace can populate itself two ways (ADR-193): the curated Demo Data
book for presenting the product, or the full corpus — 48,060 rows across
all forty-eight tables, every optional field populated, spanning years —
for testing dashboards, reports and pagination at the size of a real book.
GET /api/services/seed-report audits whichever is loaded, table by table,
PASS or FAIL. Plan of record: AI/SERVICES_CRM_GAP_ANALYSIS.md and
AI/PEST_CRM_COMPETITOR_MATRIX.md. Increments 1 through 21 have shipped —
the last four being the offline field queue, plan sequencing, invoices
built from the visit, and truck stock — bringing the matrix to 47 HAVE,
3 PARTIAL, 8 GAP.

The board is measured against eleven products, not ten: an earlier revision
identified the directive's "BOSS" as "the Briostack office suite", which
does not hold up — Briostack's office component is Brio Office, and the
likely referent is PestBoss, a separately-sold product. Measuring PestBoss
in its own right added two rows and no HAVEs: minting a printable station
label, and delivering a service report as a document.

That printable label is now built (ADR-214): a Code 39 label sheet on the
IPM page, printed from the browser rather than rendered to a PDF, because a
PDF would need object storage and printing is the capability. A barcode
Code 39 cannot carry prints without a symbol and says why — barcodes are
case-sensitive here, so uppercasing one would produce a label that scans as
a different station.

Checking PestPac's own feature index against the board — the same doubt
that found the BOSS error — turned up seven named modules with no row at
all, in the deepest-measured competitor here. The board is now 67 rows:
48 HAVE, 5 PARTIAL, 14 GAP. Two rounds of checking added nine rows and no
HAVEs, which is what auditing your own audit looks like.

That last buildable row is now built (ADR-215): a unit level under a
property, with visits, stations, sightings and plans referencing
(organization, property, unit) so a treatment cannot be attributed to a
door in another building, and a coverage reader that names the doors a
sweep missed rather than counting the ones it reached.

A service report can now be FILED as a document (ADR-216): the bytes frozen
as issued, append-only for everybody, corrected by filing another that names
it. That row had been recorded as blocked on object storage, which was
wrong — `20260820000300` had already solved the same problem for the Job
Seeker by putting the bytes in a column under ordinary RLS. Sending it is
still the email/SMS row.

A customer can now be TOLD things (ADR-217). A visit reminder, an en-route
text or an overdue notice is composed, addressed, deduplicated one-per-day,
and either kept as `composed` or kept as `suppressed` with the reason the
customer asked not to be contacted — kept either way, because "was this
customer told?" needs an answer. Account-level do-not-contact is separate
from marketing consent on purpose: leaving a newsletter is not a request to
stop hearing that a technician is coming tomorrow. Nothing can claim to
have been SENT: `crm_notices` carries no UPDATE grant for anybody, so
`sent` is reachable only through a dispatch that asks
`crm_integration_live()` first. The seed writes 1,827 notices and not one
of them is sent.

A customer can now AUTHORISE being charged (ADR-218), which is not the
same as being charged. A stored instrument is metadata — brand, last four,
and the NAME of the vault purpose a processor token would live under; the
schema refuses anything PAN-shaped in any field a person types into, and
the browser refuses it first so it never crosses the network. The mandate
keeps the words the customer was shown, frozen and append-only, which is
the record a bank asks for months later. The enrollment carries the ceiling
they authorised, enforced by a trigger against every caller. Nothing can
say money moved: `crm_charge_attempts` has no UPDATE grant, so `succeeded`
is reachable only through a settlement that asks whether a processor is
really connected. The seed writes 351 charge attempts and not one is
settled.

The books can now leave the building (ADR-220). A general-journal CSV
carries invoices raised, payments taken, refunds given and uncollectible
invoices written off as balanced double-entry lines, downloadable from the
ledger tab. It is an EXPORT a bookkeeper imports, not a sync, and the code
says so in the module, the route and the row; the API sync still needs an
Intuit account. Every entry balances by construction — an unbalanced one
throws rather than rendering — because a journal file that does not balance
is rejected at the import screen, or worse, accepted.

A dispatcher can now say what order a technician drives (ADR-221). A route
is one technician's day from a branch, with stops numbered from one;
resequencing replaces the whole set so a drag cannot collide, and it
carries the planned arrival and notes somebody typed. Nothing computes the
order from geography — crm_properties holds an address and no coordinates,
and turning one into the other is geocoding. Drive time, traffic, time
windows and bulk geocoding all still need a mapping provider.

A portal customer can download their own filed copies (ADR-222). Two
definer projections list and serve crm_service_documents bodies scoped
through crm_portal_account_for; the Documents tab renders per-copy
download anchors (attachment, nosniff, no-store — never inline), marks
superseded copies instead of hiding them, and the two notices that blamed
object storage for the missing link are corrected — that blocker ended
with ADR-216.

The worker's empty-queue diagnosis now names withdrawal and pause
(ADR-223) instead of printing its accuse-the-claim contradiction line for
a graph that was excluded on purpose. Read-only restatement of
diagnose_graph_queue_as_worker_v2; protocol unchanged.

**PEST CRM: PRODUCTION READY (ADR-224), scoped exactly.** The copilot
answers five computed questions from the workspace's own rows, and five
acceptance-journey tests walk the 57,447-record seeded book across module
boundaries. The declaration covers everything the repository can do
alone; the eight provider-gated rows remain **Not Connected** and the RED
actions remain owner-gated, each named on its own backlog row. Nothing in
this declaration authorizes autonomous production changes.

The close-out tail finished the pattern "the schema shipped, the page
didn't": the Budget Tracker's ledger edits/deletes with reconciliation
on the page, linked transfers and the month plan; printable WDO reports
and invoices (browser print-to-PDF, DRAFT/VOID banners, no pretended
server renderer); and canvassing's route planning, knock recording and
per-rep figures. Every backlog row still open names an owner-held
credential, an owner decision, a RED authorization, live-production
observation, or owner-direction-gated design as its unparker.

Of the remaining eighteen rows, eight are gated on an
external account nobody has opened: card/ACH processing, SMS/email
delivery, GPS telemetry, QuickBooks sync, telephony, reviews and
drive-time routing. Those ship labelled **Not Connected** and are never
implied to work.

One more needs object storage configured before a service report can become
a PDF. And the last — running recurring invoicing on a schedule — is gated on
governance rather than an account. Raising invoices on a timer is a
billing action executed autonomously, which `policies/RISK_CLASSIFICATION.md`
classes RED and says cannot be authorized by a toggle or by an unrelated
task. It needs an owner authorization naming the action, target, risk,
evidence and rollback plan; until then generation stays operator-triggered.


Last reviewed: 2026-08-31

## 2026-08-29: Budget Tracker — own navigation, dated import, and a plan/history fix

Three changes after the first release, all from loading the owner's real
workbook and looking at what came out.

**The forward plan was being imported as history.** A household ledger is kept
with posted rows on top and a forward plan underneath — payee, amount, no date,
because it has not happened. The importer carried the previous row's date down
into all of it: 914 rows became one day, inventing $1.07M of activity in
September 2026 that then dominated every chart. Now a date is carried forward
only for a row *between* dated rows, where it means "same day as the line
above"; everything after the last dated row is counted and reported as planned,
not posted. With that fixed the last twelve months read sanely — September 2026
is 20 transactions and -$5,235.96 — and reconcile against their own stated
running totals with **zero breaks**. The 36 discontinuities are all in older
history.

**Its own left navigation.** `/BudgetTracker` moved from `(portal)` to a new
`(budget)` route group. It had been inheriting `AppShell`, so the rail beside a
household's finances was the control plane's own navigation. It now has five
routes (Overview, Accounts, Transactions, Bills & Debt, Import), one gate in
`(budget)/BudgetTracker/layout.tsx`, and a self-contained shell that imports
nothing from `lib/navigation`, `AppShell` or the Job Seeker's navigation —
asserted in `tests/unit/budget-navigation.test.tsx` against the import lines.

**Import takes a date window,** with a "Last 12 months" preset. The window is
applied after each row's date is resolved, so a continuation row is judged on
the date it inherits rather than on its blank cell.

Also hardened: the overview route derives its `YYYY-MM` key from whatever shape
the driver returns for a `date`. PostgREST returns an ISO string, so slicing
seven characters was right; a driver returning a `Date` turned the same slice
into "Mon Sep", which would have labelled every bar on the cash-flow chart with
a weekday. Found by running the real pipeline against PGlite.

Verified end to end against real PostgreSQL with the owner's workbook: 866 rows
for the twelve-month window, a second import of the same window adding zero,
and thirteen months of cash flow read back through `budget_monthly_flow`.

## 2026-08-29: Budget Tracker

`/BudgetTracker`, reached from a third global navigation tab for signed-in
people. Accounts, recurring obligations, a paged ledger, cash flow by month,
credit utilization, two payoff orders, and spreadsheet import. Owner request,
2026-08-29; ADR-147 and ADR-148.

Two migrations, `20260829000100_budget_tracker_activity_types` (enum values,
separate so no transaction uses a value it added) and
`20260829000200_budget_tracker_foundation` (six tables, two aggregate read
functions). **Applied to hosted** on 2026-08-29 through the `budget-tracker`
scope (run 33257354301, from `d22107ba`); both versions are in the ledger and
the scope's own postflights passed against the live catalogue: six tables with
RLS enabled and forced, neither `anon` nor `service_role` holding a grant on
any of them, and both aggregate reads SECURITY INVOKER.

`/BudgetTracker` is live and gated: signed out it redirects to
`sign-in?next=%2FBudgetTracker`, and `/budgettracker` is a 404 — the
capitalised path is the one that answers.

Every row is scoped by `organization_id` **and** `user_id`, RLS enabled and
FORCEd, with neither `anon` nor `service_role` holding a grant. The
`service_role` revoke is explicit and load-bearing: that role is BYPASSRLS and
the hosted default privileges hand it each new table, so without it the six
would have arrived wide open past every policy. The two aggregate reads are
SECURITY INVOKER for the same class of reason — as definers either would hand
every member of an organization every other member's monthly totals.
`tests/integration/budget-tracker.behavior.test.ts` proves all of it against
real PostgreSQL while assuming the `authenticated` role; a superuser bypasses
RLS outright, so a test skipping that step would pass against no policies.

Money is `bigint` cents everywhere. A CHECK ties sign to kind, so a debit
recorded as positive is a failed insert rather than a silently inverted total.
A credit limit is refused on anything that is not a credit card, because
utilization computed against a mortgage is a meaningless number that looks
like a real one.

**No seeded data, and none from the owner's own workbook.** The tables ship
empty. The uploaded spreadsheet was used to develop and verify the reader and
was deliberately not committed in any form — no fixture, no seed migration, no
test data carrying real payees or balances.

Import reads `.xlsx` with no parsing dependency: `lib/budget/spreadsheet.ts`
inflates the ZIP with `node:zlib` and reads the XML parts, under caps on entry
count, part size, total inflated size and rows. Verified against the owner's
real 5.8 MB workbook: 8 sheets, 8,043 rows read from the checking sheet, 8,040
imported, 3 skipped and reported. Re-importing is a no-op through a per-person
sha256 content hash.

**Not Connected**: there is no bank connection and no provider integration.
Balances are what the person last recorded, and the page says so rather than
implying a refresh that does not happen.

Two findings worth keeping. The source workbook stores running counters in the
same column as dates — read as Excel serials, 184 and 1721 become 1900-07-01
and 1904-09-16, dates that sort and chart perfectly well and are not dates; the
importer bounds serials to the range `posted_on` accepts. And the workbook does
not fully reconcile: 38 of 8,040 rows disagree with their own stated running
total, from twenty years of hand edits. `reconcile()` in
`lib/budget/analytics.ts` finds those rather than hiding them.

## 2026-08-28: target-bound claims are hosted; final postdeploy remains gated

Forward cleanup release `ce86d9c04ff91f237e680a5db4b0cda97feea2ce`
removed the disposable production-URL acceptance boundary. All four exact-head
jobs passed in CI `33169913723`; GitHub deployment `6140863004` resolved to
READY Vercel deployment `dpl_4Zqh4q2yBfaagGtg7stSbV4NSphP`, and public health
joined the exact release, deployment, Vercel project, and Supabase project
`qpuofpmagrmyamahqwxw`.

Read-only probe `33170897689` confirmed ledger `1|1|1|1|0|0`. First-attempt
mutation run `33170953151` then applied only hash-pinned
`20260828000200_target_bound_worker_claims.sql`; its exact ledger, catalog, ACL,
runtime, audit, lint, health, and stopped-safety postflight passed. Independent
probe `33171025468` confirmed ledger `1|1|1|1|1|0` with containment unchanged.
Never rerun selector normalization, URL schema, or target claims. Do not apply
`20260828000300` until a legitimate provider/bot assignment route produces the
required signed-in Step 8 record/reload and truthful Step 9 persistence while
workers remain OFF. After `00300` and read-only `verify`, current Full Lifecycle
v2 execution acceptance remains a separate authorization gate.

Production browser acceptance over existing test data found no page or console
errors. Historical run `884d6164-0ecd-4f93-878a-0a7ecda239e5` renders Steps
1-8 complete, then truthfully records Deploy refused by the Phase 1 authority
boundary and Monitor skipped. It has no verifiable current-template identity,
so it is not evidence that current `full_lifecycle` v2 completed. Workers,
schedules, the auth broker, autonomy, and automatic actions remain OFF; the
global kill switch remains ON.

### Earlier production-URL acceptance evidence

Exact cleanup release `994da2cec81c0cd83aa1e2d87ad848d2f2ff612a` passed all
four required jobs in CI `33164903094`. GitHub deployment `6139882660`
resolved to READY Vercel deployment `dpl_7u7h6GaP2LLNawDtB9wYGAuMTARB`, and
public health joined that exact SHA/ref, deployment URL, Vercel project, and
Supabase project `qpuofpmagrmyamahqwxw`.

Protected read-only probe `33165823042`, selector-normalization mutation
`33165886343`, post-selector probe `33165944760`, and configure-URL mutation
`33165992529` all passed on their first attempts. Hosted ledger state at that
checkpoint was
exactly `1|1|1|1|0|0` for
`27000200|27000210|28000050|28000100|28000200|28000300`. The stale Phase 1C
selector is normalized and the owner/admin-only production-URL writer is live;
neither scope may be rerun.

Disposable acceptance release `540aceb173ec88e67cb982018a80134ece3ec474`
passed all four required jobs in CI `33167232673`. GitHub deployment
`6140332126` resolved to READY Vercel deployment
`dpl_31W7nKgJd6ENoCfuvgP1zzHZM6eT`, and public health joined that exact
SHA/ref, deployment URL, Vercel project, and Supabase project.

The disposable acceptance workflow uses protected
owner/project selectors and one ephemeral GoTrue magic-link session—never an
owner password—to call the real production application route. It requires an
unset target value, writes `https://www.theagoras.com`, proves exactly one
owner-attributed immutable `project.updated` event, repeats the same write as a
no-op with no duplicate event, reloads through the signed-in portfolio API,
and rechecks exact main/CI/Vercel/health/catalog plus fully stopped containment
immediately before and after. First-attempt run `33168092838` passed immutable
invocation, exact green/READY release, stopped-workflow, and Supabase connection
gates, then stopped before target resolution or mutation: `psql -c` sent the
literal protected-variable tokens to PostgreSQL instead of expanding them.
Both temporary selectors were deleted immediately. The forward fix moved only
that read-only target query to a quoted stdin heredoc, where `psql` variable
quoting is supported, and added a regression guard.

Corrected release `53b84b7952a1e09725f53da5d65c4947b8cb914a` passed all
four required jobs in CI `33168368270`. GitHub deployment `6140556549`
resolved to READY Vercel deployment `dpl_tBF2s6AtLmqZ13YpYHKWzBRtwiKT`, and
public health joined the exact release/deployment/Vercel/Supabase identities.
Fresh first-attempt acceptance run `33169297158` passed the real owner/admin
session, exact production URL write, exactly one owner-attributed immutable
`project.updated` event, no-op replay without a duplicate event, signed-in
portfolio reload, and pre/post stopped containment. The two temporary selector
secrets were deleted immediately. The subsequent cleanup, probe, and
target-claim evidence is recorded above.

## 2026-08-28: exact verified Blackstone Auth bootstrap completed and disposed

The owner requested one email-confirmed Supabase Auth identity for
`blackstoneagencyllc@gmail.com`. A temporary dispatch-only workflow is fixed to
that exact email, project `qpuofpmagrmyamahqwxw`, `main`, the configured
production release actor as both original and triggering actor, and first
attempt. It receives the requested password only through a temporary encrypted
repository secret and the existing service-role credential, never through a
workflow input or log. It idempotently creates or updates the one normalized
identity through the GoTrue Admin API and re-reads a unique UUID plus
`email_confirmed_at` before bounded output. Exact first-attempt production run
`33164766560` on release `298264b02fe5a29e3c139f8077e65d6270f19167`
completed successfully as the configured release actor and returned one
bounded updated UUID after exact confirmed readback. The temporary password
secret was deleted immediately. This forward cleanup removes the disposable
workflow and its test. The operation granted no organization membership,
application role, worker authority, or autonomous action.

## 2026-08-28: ten-step Factory application release is live; selector containment is local/pass

The remaining Step 8 `invalid Phase 1C command plan` path is corrected in the
application and the protected database release. A record-only command accepts
the bot assignment's real provider/model (including Claude), persists one
command/task route, and launches at most its one analysis graph. The UI now
retains the server's exact `workerWoken` and `note` result: with production
containment engaged it says **Not Connected**, does not claim execution
started, does not poll forever, and retains an exact manual refresh. Gate
continuations use the same fail-closed behavior.

Both Phase 1C and graph dispatches now require an exact application-side
`true` switch as well as their GitHub job switch. One-shot workflows require
the exact command/graph UUID, graph manual dispatch is main-only, and the
release workflow refuses reruns of mutation scopes. Production GitHub
variables explicitly hold Phase 1C, graph, schedules, and the auth broker OFF;
the previously active auth-broker run was cancelled and there are no active
execution runs. Autonomy/automatic actions remain OFF and the global database
kill switch remains ON.

The new public `/api/health` is now a release identity join, not a generic
liveness response. It requires the exact main SHA, exact public alias, exact
Vercel project ID, immutable Vercel deployment ID/URL, and exact Supabase
project ref before one bounded anonymous database read. The hosted workflow
requires the GitHub Vercel deployment URL to equal the deployment URL reported
by the public alias, closing the independent-evidence gap. Vercel Production
has all five non-secret identity/containment values configured, with both
worker gates explicitly `false`.

Exact `main` `79ca52f5b92e7d95292210e05565d35d21b4a435` is live. CI run
`33158801269` passed the quality job and all three browser/accessibility
shards. GitHub deployment `6138739479` resolves to READY Vercel deployment
`dpl_57pM3ZEYNyK596VAeLPJMabJLZrH`, and the public health join reported the
same SHA/ref, exact Vercel project `prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`, and
exact Supabase project `qpuofpmagrmyamahqwxw` with the database reachable.

The newer exact Factory release
`298264b02fe5a29e3c139f8077e65d6270f19167` passed all four jobs in CI
`33163838800`. GitHub deployment `6139678648` resolves to READY Vercel
deployment `dpl_ChxG5EdgPzh3vybRZgBRz9EA9gg1`; public health joined that exact
SHA/ref and deployment URL to the same Vercel and Supabase project identities.

The protected read-only lifecycle probe `33159805326` then found one exact
hosted catalog mismatch before it could admit the release-tail migrations:
`claim_phase1c_run_budget_internal(text,text,text,integer)` has the stale
`20260815000300` body MD5 `ed5840b9d8d0efdb513a8576df128e9b`, while the
required breaker-aware `20260815000500` body is
`5933952d71f9da90a2a80a05ce6e0378`. Its ABI, postgres ownership,
`SECURITY DEFINER`, pinned `search_path=pg_catalog`, owner-only execute ACL,
three breaker helpers, and FORCE-RLS `resource_breakers` dependency otherwise
match exactly. No hosted mutation ran in that failed probe.

Forward migration
`20260828000050_normalize_breaker_aware_phase1c_selector.sql` (LF SHA-256
`8914034508451d1550ebf3f1bedd8f7b71592f1809306e78c57774c458952896`)
accepts only that exact stale body or the exact clean-chain target, verifies
the full surrounding catalog and ACL shape, replaces only the selector with
the frozen breaker-aware body, and re-verifies it. The protected release order
is now `00050`, `00100`, `00200`, then `00300`; this does not replay or mark
either historical migration. Current local evidence is lint and typecheck
green, 5,150 tests passed / 7 skipped across 442 files, and a 171/171-page
production build.

Signed-in Steps 8-10 are still not accepted for the active organization:
`daniel.hughen@gmail.com` currently has zero connected AI accounts, ready
linked bots, or assignments there. Provider OAuth must be completed through
the supported flow before a fresh Step 8 POST and persisted Step 9/10 evidence
can be measured; no token or account may be copied from another tenant.
Workers, provider execution, autonomy, schedules, the auth broker, and all
automatic actions remain OFF, while the global kill switch remains ON.

Hosted migration history also still has 17 older missing ledger versions,
beginning at `20260815000200`, despite partial catalog effects. Each needs
complete catalog proof, surgical forward compensation where necessary, and
only then protected ledger reconciliation. Historical files must not be
edited or replayed, and the database must not be reset or down-migrated.

## 2026-08-28: public production URL configuration is locally complete

Forward migration `20260828000100_project_production_url_configuration.sql`
(LF SHA-256 `0856ddee447280a1bb4418f25d6a6d4650687e168fffcd5e98e8ce15edd62b27`)
adds the missing writer for the public project URL that Full Lifecycle Step 10
observes. The original three-argument `update_project_details` RPC remains
unchanged. A separate authenticated, owner/admin-only `SECURITY DEFINER` RPC
with a pinned search path refuses archived projects and rejects non-HTTPS,
credential-bearing, query/fragment, localhost/private, ambiguous numeric,
likely-secret-bearing path, IPv6-literal, and non-standard-port targets. The projects column now carries a
validated safe-target constraint while its forced RLS and existing immutable
`project.updated` audit trigger remain in force.

Project detail now exposes a clear **Configure production URL** field and the
same validation runs before the request for useful feedback; the database
independently repeats it. Focused local evidence is 89/89 tests plus clean
focused ESLint and full typecheck. No live project value was changed, the
migration is not hosted, and workers, autonomy, automatic actions, and the
global kill switch are unchanged.

Vercel Production now has the non-secret
`SOFTWAREFACTORY_EXPECTED_SUPABASE_PROJECT_REF` config bound to exact project
`qpuofpmagrmyamahqwxw`. The new `/api/health` refuses a missing/mismatched
identity before touching Supabase and reports only `matched`/`mismatched`; the
next production deployment is required before that config and route are live.

## 2026-08-28: exact-target one-shot worker claims are locally complete

Forward migration `20260828000200_target_bound_worker_claims.sql` makes a
repository-dispatch or manual one-shot wake an immutable database claim
filter, not a diagnostic hint. Graph and Phase 1C selectors apply the requested
UUID during stale cleanup, eligibility/admission, locking, and withheld-work
diagnosis; they cannot claim and execute a neighboring queue item. Existing
scheduled calls delegate to the same selectors with a null target, preserving
their current global semantics and disabled-by-default gates. The target graph
claim also projects the project's public production URL separately from the
exact provider deployment URL used by release-lineage evidence.

The workflows now require a graph/command UUID for repository-dispatch and
manual one-shot execution. Every graph-worker trigger and application wake is
also behind the exact global `SOFTWAREFACTORY_GRAPH_WORKER_ENABLED` switch,
which is absent/OFF in production. They do not enable either worker, either schedule,
provider execution, autonomy, automatic actions, or the release kill switch.
An ineligible exact Phase 1C target returns no row after target-scoped stale
cleanup, allowing that cleanup to commit without ever claiming a neighbor.
Focused local evidence includes the exact claim/cleanup and catalog suites plus clean focused ESLint and migration
chain/schema-security coverage. This is not hosted or production acceptance:
publication, exact-head gates, protected application of only `20260828000200`,
and a target-bound canary remain pending.

## 2026-08-28: Factory v2 release and hosted lineage are production accepted

`/solutions/ai-factory` now passes a server-verified viewer hint into the
client journey. A signed-out visitor renders the sign-in gate on the first
response and launches zero protected workspace reads, so one slow endpoint
cannot leave the whole factory on its loading shell. `readViewer` is
request-scoped with `React.cache` so the portal layout and leaf page share one
verified lookup, and the presentation lookup has a five-second fail-closed
deadline. Every privileged route continues to authorize independently.
Focused unit/contract evidence is 56/56 and the rebuilt production bundle's
real-page gate passes 9/9 across desktop, tablet, and mobile. Exact `main`
`bb68659a0ee84370f83dd647ae57f4ccb83ea06c` passed all four required jobs in
CI run `33149814278`; Vercel deployment
`dpl_2A2bhtevZeBY6422ZYjVGJE5SuTU` (GitHub deployment `6137077047`) is READY
behind `www.theagoras.com`.

Hosted database completion is separately measured. Payload-free probe run
`33150619218` found the exact four-row manifest
`784acaca2b0957ecb0eeea85e3d0dde2e64ba653c744e708ec8d4094f9175b99`
with all four downstream blocker counts zero. Containment run `33150654596`
applied only `20260827000210`; lineage run `33150707932` then applied the
unchanged `20260827000200`. Ledger, catalog, ACL, RLS, immutable audit,
tombstone, runtime, lint, and stopped-safety postflights all passed. Workers,
provider execution, autonomy, and automatic actions remain OFF; the global
kill switch remains ON.

Signed-in Steps 8-9 are not yet accepted. Exact-deployment logs contain
authenticated GET traffic but zero `POST /api/commands` and no command-route
4xx/5xx. A fresh Chrome tab as `daniel.hughen@gmail.com` loads current
production, but the tenant has zero connected AI accounts, ready bots, or
assignments; one Codex connection is unfinished and Claude OAuth is not
complete. Provider OAuth and route setup must finish before a fresh command
and persisted Step 9 correlation can be measured.

## 2026-08-29 (late night): Job Search increment 5 — radius, specialty and industry facets (ADR-168)

The filter vocabulary is complete. Location + radius runs against a real
offline place index (`board-search/data/cities.json`, from GeoNames
cities15000, CC BY 4.0): server-side resolution and haversine, native
names and exonyms both resolving, the most populous claimant of an
ambiguous name winning visibly, remote and unresolvable-place postings
kept and counted, an unknown centre reported as "distance not applied"
with the reason — never a failure or a silent narrowing. The saved
radius reaches the alert engine through an injected refinement so the
planner stays pure. Marketing specialty (12 disciplines, from the job
title) and industry (11 industries, from the posting text) are derived
facets labeled as derived, with unstated postings kept under "Any".
Increment 4's marks migration was applied to hosted (run 33273330183)
and production probes verified the deploy of #448.

## 2026-08-30 (night): the Chief of Staff named; the plan read back (ADR-173)

The orchestrator is the engine, named: Build renders its plan — intent
verbatim, dependency layers from stored edges, specialist assignments,
QA gates, real parallelism, counted percent — composed read-only from
the records the engine made.

## 2026-08-30 (later still): the eleven specialists + command-center evidence (ADR-172)

Roles derived from recorded facts only; Build shows agents beside their
real executor evidence, independent QA verdicts, lazily fetched
artifacts, the run's own spend, and finished-run history with closure
notes.

## 2026-08-30 (later): Build — the conversational front door (ADR-171)

One prompt launches the existing full_lifecycle workflow and the page
watches the real run: counted progress, SDLC-ordered stage states, gate
calls-to-decide, closure notes, and a resume list of unfinished runs.
Composition over existing endpoints only; audit and increment plan in
`AI/AI_FACTORY_GAP_ANALYSIS.md` (task #61).

## 2026-08-30: LinkedIn/Indeed primary; ZIP codes centre the radius (ADR-170)

The deep pair is one click from the Search button before any board is
asked, links recomputed live; US ZIP codes ("78701", "Austin, TX 78701",
"78701-1234") resolve to GeoNames postal centroids in the radius filter,
reported with the ZIP visible. Journey acceptance run 33285610004 (main
9a73e12): the goal's full E2E list green after all increments.

## 2026-08-29 (late night): LinkedIn and Indeed wired as deep link-outs (ADR-169)

The permitted wiring, made real: LinkedIn and Indeed open their own search
with the person's query AND filters translated into each site's own URL
parameters (`board-search/linkout.ts`), sorted first in the "Also search
on" strip and labeled "· your filters". Filters map faithfully or stay off
the URL; other link-out sites keep the plain query+location template. A
results-feed adapter for either site remains impossible without violating
their terms, which this repository refuses; partner credentials would
change that.

## 2026-08-29 (night): Job Search increment 4 — personal marks + title-derived seniority (ADR-167)

Favorites, hide-job and viewed/unviewed are real: `job_seeker_result_marks`
(20260829000400) keys them on the posting URL under forced RLS with own-row
policies, service_role revoked, and no update path (mark = row identity;
both directions idempotent), served by `/api/job-seeker/search/marks` and
rendered as star/Hide/Viewed controls that appear only after the person's
actual marks load. "Hidden by you" and "hidden by your filters" are two
separate honest counts; Show hidden and Favorites-only exist. The seniority
facet is derived from the job title alone (`deriveSeniority`: seven levels,
most-senior-wins, "lead generation" excluded by name, unstated = null) and
flows through the search route, the panel select + chip, the saved-search
schema (`nullish`, so stored queries parse) and the alert engine. Location
radius and industry facets remain unoffered because no connected board
exposes that data — recorded, not faked. The migration is chain-integrated
(22 sentinels swept, grants seat, RLS count 147, runbook 179, workflow scope
step + options entry both added).

## 2026-08-29 (later): Job Search increments 2–3 — match scores, saved searches, alert engine (ADR-163 addendum, ADR-164)

Merged to `main` as #437 (squash `2319970`), Vercel deploy verified, and the
alert-engine schema applied to hosted the same hour (workflow run
`33263020948`, scope `job-seeker-alert-engine`, postflight green: forced RLS
on the deliveries ledger, `last_scanned_at` present, both definer functions
SECURITY DEFINER and executable by service_role only). #440 added the
dispatch option the apply step guarded on.

- **AI match scores on results**: the search route scores every unified card
  server-side from the recorded Career Profile facts (one profile load per
  request, deterministic evaluator, reasons + gaps carried). No profile row →
  `match: null` with a stated basis, and `filters.minimumScore` refuses with
  422 rather than silently ignoring. Panel: score badge, "Why this match
  score" evidence expansion, best-match sort offered only when scores exist,
  minimum-score filter + chip.
- **Saved searches**: `/api/job-seeker/saved-searches` CRUD over the ADR-141
  table (strict bounded jsonb query documents, double ownership filtering
  above forced RLS, 409 on duplicate names, credential-shaped values
  refused). Panel card: Save / Run / Update-to-current / Duplicate / Delete;
  running one restores the full builder state and executes.
- **Search metering**: one immutable `job_seeker_search_events` row per board
  queried (failure-tolerant — a missed tick never fails a search that
  answered), making the discovery credit meter a measurement.
- **Alert engine (ADR-164)**: migration `20260829000300` — cadence check +
  `last_scanned_at` on `job_seeker_search_alerts`; append-only
  `job_seeker_alert_deliveries` ledger with the never-repeat UNIQUE
  constraint; `list_due_job_seeker_alerts` / `record_job_seeker_alert_scan`
  as service_role-only SECURITY DEFINER functions (zero service_role table
  grants — the billing-boundary pattern). Runner `/api/job-seeker/alerts/run`
  on Vercel Cron hourly: fail-closed 503 while `CRON_SECRET` is unset
  (verified live in production), timing-safe bearer, honest "Email is Not
  Connected" short-circuit, per-alert search → dedupe → saved filters →
  score → drop-delivered → email → record. Cadence controls render **Not
  Connected** and writes 409 until `RESEND_API_KEY`, `JOB_ALERT_EMAIL_FROM`
  and `CRON_SECRET` exist; the owner setting those three in Vercel and
  redeploying is the only remaining step to live email alerts.

Full suite at merge: 455 files / 5,412 tests green, lint zero-warning,
typecheck clean, production build green, four real CI checks on the exact
merged head.

## 2026-08-29: Job Search increment 1 — ten live boards, unified dedupe, 50-source catalogue (ADR-163)

The active owner goal (world-class `/JobSearch` over 50 sources) landed its
first increment on the existing search stack, extending rather than replacing
it:

- **Six new board adapters**, each probed live before its parser was written
  and pinned by fixture tests: Remotive (6h per-term cache honoring its API
  call budget, link-back + attribution by construction), Remote OK (corpus
  feed, local filtering, HTML-entity decode, legal-notice row skipped),
  Jobicy (`tag` free-text search), Himalayas (epoch dates, salary period kept
  as text), Arbeitnow (`remote:false` maps to null, not "onsite"), and
  We Work Remotely (official RSS; "Company : Role" split), and — same-day
  addendum — The Muse (public JSON API, sampled pages, no upstream text
  search), Working Nomads (open JSON feed), and Jobspresso (official job
  feed). The registry now holds thirteen live boards; the request-contract test pins the exact
  `supportsLocation` map.
- **`board-search/unify.ts`**: one shared pure definition of cross-board
  identity (normalized company+title), richer-record-wins card selection
  with `primarySourceIndex` (saving goes through the board whose sealed
  token matches the card's exact fields), and result-level filters
  (AND/OR keywords, exclusions, work model, salary minimum with
  unknown-kept semantics, require-salary, posted-within). The search route
  returns a `unified` block (hits + dedupedFrom + beforeFilters) beside the
  untouched per-board `results`, and the panel applies the same module
  client-side for instant filtering without refetching.
- **53-source catalogue** (`board-search/catalogue.ts`): 28 general + 25
  marketing sources, each `live` (integrity-tested equal to the registry) |
  `needs_credentials` (official API named — the JSearch aggregator,
  USAJOBS, Adzuna, Jooble, Careerjet, Reed, ZipRecruiter — shown
  **Not Connected**) | `external_link` (probed URL the person's own
  browser opens) | `not_supported`. Every non-live URL was probed
  2026-08-29; four dead domains found during research were replaced with
  probed live ones. The JSearch row (ADR-184) flips to `live` at call
  time via `resolvedSourceCatalogue()` once `JSEARCH_RAPIDAPI_KEY` is
  set, in lockstep with `availableBoardSearchAdapters()` — the door
  through which LinkedIn/Indeed postings appear inline, each labeled
  with its publisher.
  `GET /api/job-seeker/search` now serves the catalogue to the picker.
- **Panel rework**: unified view default (source badges per card, NEW badge
  ≤3 days, sort by recency/stated salary), by-board view preserved, filter
  chips with Clear All, grouped source picker with live checkboxes and
  honest statuses. 17 panel tests, 12 route tests, 33 parser/unify tests,
  6 catalogue integrity tests all green; the route test now mocks every
  registry adapter so no unit test can egress.

Remaining increments of the goal (tracked in BACKLOG): saved searches +
alert preferences + seen-jobs ledger (migration + RLS), AI match display
from the Career Profile, the alerts engine + email adapter with delivery
ledger, and E2E acceptance before any production-ready claim.

## 2026-08-27: canonical Job Search is live and production accepted
## 2026-08-25: Revenue — Stripe subscription billing behind the existing storefront (ADR-149)

The owner directed that the site needs a revenue avenue. Built and tested,
shipping with the ADR-148 release: organization-level Stripe subscriptions
behind the plans `marketing_pricing_plans` has advertised since 20260813000500
(Free / Basic $29 / Pro $79 / Enterprise).

- **Migration `20260825000400`** (scope=billing-foundation, **hosted-applied
  2026-08-28**, run `33131128140`, postflight-verified: three tables with
  forced RLS plus both definer boundaries): `billing_customers`,
  `billing_subscriptions`, `billing_events`, `ensure_billing_customer`,
  `record_billing_activity`.
- **Server**: thin Stripe REST client + HMAC webhook verification
  (`lib/billing/stripe.ts`, no SDK, no browser key of any kind), plan catalog
  + entitlements (`lib/billing/plans.ts`, `entitlements.ts`), webhook mirror
  (`lib/billing/webhook.ts` — idempotent by event id, attribution by ids
  only). Routes: `/api/billing/{checkout,portal,webhook,summary}`.
- **Enforcement**: HTTP 402 `plan_limit_reached` on project creation and graph
  launches past the plan (Free: 1 project, 10 launches/UTC-month, 1 seat;
  Basic: 50 launches, 5 seats; Pro: 250 launches, 25 seats). Creation-gating
  only; existing work never stops.
- **UI**: `/pricing` cards become checkout buttons only where a configured
  Stripe price stands behind them; `/solutions/billing` (Settings → Billing)
  shows plan, usage meters, upgrade, and the Stripe portal. Everything renders
  **Not Connected** until the owner completes `docs/BILLING_GO_LIVE.md`.
- **To take the first payment** the owner must: apply the migration scope, set
  the six `STRIPE_*` variables plus `SUPABASE_SERVICE_ROLE_KEY` on Vercel,
  create the webhook endpoint, and redeploy — the runbook is the exact list.

## 2026-08-25: Search, ported from ai-job-search into Job Seeker

The complete integration is on `main`. Application behavior release
`aabd82b3a626da94a2478ef26f043a51d059cd15` is deployed through exact Vercel
Production deployment `6130751384` at
`https://softwarefactory-14wpknnsx-surgeservices-projects.vercel.app`, with
`www.theagoras.com` serving `/JobSearch` as `200`. Its exact-head CI run
`33114868741` covers the quality job and all three browser/accessibility
shards. Search first reached `main` in #416 (`5cfd839`); this release completes
the canonical surface, trust boundary, transactional save and production
acceptance. Full disposition and evidence are in
`AI/SEARCH_MIGRATION_REPORT.md`.

The exact upstream source snapshot is
[MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search)
at `79cd383e58f0af7948c7c6462a3a289e9b67421e` (MIT, © 2026 Mads
Lorentzen): all 214 files are kept byte-for-byte under
`vendor/ai-job-search/`, excluded from build/runtime tooling, and classified
rather than selectively remembered. Four keyless search capabilities are
adapted into the product — Jobnet, Jobindex, Jobdanmark and Freehire.
LinkedIn remains excluded because service terms and source-code licensing are
different permissions. Jobbank is deferred until a reliable, reviewed
Cloudflare/WebSearch fallback exists; it is not described as permanently
impossible.

`/JobSearch` is the canonical owner-named page and the signed-in global header
entry is **Job Search**. `/Job-Search` and `/job-seeker/search` remain working
compatibility entries over the same component, auth gate, Job Seeker shell and
API — not three search implementations. The responsive/auth/loading/error/
empty coverage registers the canonical path. Live request-contract repairs
match the boards as observed now: Jobnet uses `/FindJob/Search` with
`PublicationDate`; Jobindex reads nested company names, refuses an unreadable
non-empty result shape and honestly does not apply a free-text location;
Freehire sends `cities`; Jobdanmark declares its location support. Direct,
non-persistent probes returned Jobnet **2/4**, Jobindex **2/736**, Jobdanmark
**0/0** for London, and Freehire **2/6752**. Signed-in production then
returned Jobnet **4/4**, Jobindex **20 shown of 736**, Jobdanmark **0/0** and
Freehire **25 shown of 6,752**, including the explicit Jobindex location
limitation and honest Jobdanmark empty state.

The repeated-error loop is closed in the production application. Starting a
replacement search immediately removes the prior results and their sealed
tokens, including when the replacement loses its network response. Save now
renders the server's actual safe error message; an expired/invalid result tells
the person to search again and disables the futile retry, while a transient
failure remains retryable. The save route also authenticates before parsing or
classifying caller-controlled content.

Saving no longer trusts a browser-posted board result. Each returned result
carries a 30-minute server-sealed token bound to organization, user, board and
the exact normalized job fields; missing, expired or altered evidence is
refused. `insertScoredJob` now crosses one database boundary:
`record_job_seeker_job`, added by the forward migration
`20260827000100_record_job_seeker_job_atomically.sql`. The authenticated-only
`SECURITY DEFINER` function has exact `search_path=pg_catalog`, derives the
owner from `auth.uid()`, verifies organization membership, and commits job +
match + initial application + immutable `job_seeker.job_recorded` evidence in
one transaction. A dedupe race returns `duplicate` without children or an
extra event; child validation failure rolls the job back. Composite owner
foreign keys prevent a child from naming another person's job, and RLS is
reasserted enabled and forced.

The database-first gate is complete. Workflow run `33111692239` applied only
`20260827000100_record_job_seeker_job_atomically.sql` (SHA-256
`2f51bf64ba3fd2bc711e6fbf9e660a2cc0dd5ef4b1f85d932ee574e79e9c7d13`) to
exact project `qpuofpmagrmyamahqwxw` and verified the single ledger row,
function identity/owner/`SECURITY DEFINER`/exact search path/authenticated-only
ACL, three validated owner constraints, removal of the two superseded foreign
keys, PostgREST schema reload, and enabled+forced RLS. Direct authenticated
INSERT grants are not contracted yet because the existing manual
`POST /api/job-seeker/jobs` path still writes the three tables directly;
contracting them first would break an application path. Local lint, typecheck,
focused persistence/migration tests, and the related Job Seeker regression
suites are green. The full release passes 407 Vitest files / 4,721 tests
(3 files / 7 tests skipped), full lint and typecheck, and a 165-page production
build that includes `/JobSearch`.

Production acceptance is measured, not inferred. Remote journey run
`33115019633` passed the returning-account overview gate against exact release
`aabd82b`; its board sample did not expose an unsaved row and therefore skipped
the mutation rather than fabricating a pass. The authenticated browser walk
closed that gap on a fresh exact-release page at 16:55 EDT: it searched all
four boards, saved the Jobnet posting "Sales Development Representative for
the Swedish Market", and read it back from the Supabase-backed Discovery page
as `via jobnet`, score **35/100**, initial stage **FOUND**. Activity rendered
exactly one immutable `job_seeker.job_recorded` event for entity
`7637e796-b172-40d6-833f-408407b6f5b2`. Desktop and 390px mobile rendering
showed the canonical heading/input with no horizontal overflow. The verdict is
**production accepted**; board content and third-party availability remain
live external facts rather than guarantees.

## 2026-08-25: the ten-step factory, and the defects driving it exposed

Driving the owner's ten-step flow against live production found six graph
engine defects that review had not: gate-halted work re-paid (ADR-143), a
capacity-voided run consuming a gate approval and stranding a lifecycle
permanently (ADR-144), a flat 24-turn budget too small for implementation
nodes, the artifact sensitive-data guard's refusal killing an entire
drain for every organization (both ADR-145), a 529 overload retried zero
times over a backoff the engine declared but never applied (ADR-146),
and the run's own account of why it ended computed on every close and
discarded on every close (ADR-148). All six are fixed, each with a
regression that fails without the fix; ADR-143 and ADR-144's migrations
are hosted-applied and readback-verified. **ADR-148's migration
(`20260825000300`) was hosted-applied 2026-08-28, run `33131066501`,
postflight-verified** under the `runs-closure-note` scope, honoring the
apply-before-deploy order its defaulted parameter required.

The last of them came from reading the live queue rather than re-running
tests that already pass: two runs of one graph, six minutes apart, lost
six nodes to `529 Overloaded` on a single attempt each, because the
classifier could not tell a limit with a reset hour from an overload that
asks to be retried. Underneath sat `RetryPolicy.backoffMs` — declared,
defaulted, dropped at compile time, read by nothing — which meant every
graph retry the engine had ever performed fired into the same instant
that had just refused it.

What is proven: the whole flow reaches a COMPLETED run locally against the
real migrated schema (`ten-step-consecutive-flow.behavior.test.ts`) — every
stage closed with its artifact, exactly-once execution across gate-halted
windows, gates decided as policy places them, the projection identical on
refresh, an outsider refused. Step 1's refusals are pinned at the route
boundary. All ten `/solutions/factory/*` pages serve to a signed-in user.

The LIVE walk is now also complete. Lifecycle `1f9defa2`, launched through
the real product API by a signed-in user, ran all ten steps against
production across four provider windows: steps 1-8 executed and COMPLETED
with genuine model calls (ARCHITECTURE's human gate approved through the
product API, TEST's automatic gate self-decided on anchored evidence),
step 9 DEPLOY recorded the Phase-1 policy refusal, and step 10 MONITOR
correctly blocked behind it. Final run 884d6164 closes PARTIAL with 11 RAW
and 1 ANCHOR artifact — the honest terminal, since a COMPLETED run would
mean the deployment policy had failed. Every hop verified through
/api/graphs/runs as that same signed-in user.

## 2026-08-25: the ten steps are walked consecutively in CI, and a dev stack can be seeded

`tests/integration/ten-step-consecutive-flow.behavior.test.ts` drives one
`full_lifecycle` request end to end against the migrated schema: worker
windows split by the ARCHITECTURE human gate, the TEST anchor's automatic
gate, and the DEPLOYMENT human gate; the owner approves the human gates,
anchored evidence decides the automatic one, and the run closes COMPLETED.
It pins the properties the factory pages depend on — every one of the eleven
stages closes with a COMPLETED node and an artifact, no node executes twice
across windows (gate-halted and completed work is reused), the gates land
where policy places them with audit events, `list_graph_runs` reports the
finished truth identically on a second read, and a signed-in outsider is
refused outright ("organization membership is required").

`npm run seed:dev` (`scripts/seed-dev-lifecycle.mts`) plants the same flow
on a development stack through the product's own RPCs: seed owner (auth
admin), organization (`onboard_authenticated_organization`), project (direct
insert, deliberately without a fake GitHub connection), one lifecycle graph
(`create_graph_from_plan`), driven with `SupabaseGraphStore` to the first
gate halt — or all the way with `--drain`. Idempotent; every payload carries
`dev_seed: true`; refuses production (ref pinned, no override) and refuses
to claim graphs it did not plant. Guards are exercised; the full script has
not yet run against a live dev stack (this container cannot start Docker),
which is the one open verification.

## 2026-08-24: the console navigation is the owner's factory, ten steps and all

The left navigation now matches the owner's design: **01. Factory Setup**
(the renamed /solutions/ai-factory setup journey) and **02. AI Factory** — a
group of ten numbered step pages at `/solutions/factory/[step]`
(requirement, discover, evaluate, decide, architect, build, review, test,
deploy, monitor). `lib/sdlc/factory-steps.ts` maps the ten-step vocabulary
onto the eleven lifecycle stages, total and exclusive (REQUIREMENT owns GOAL
and PRD), with a test that breaks when either vocabulary grows unmapped.

Each step page (`FactoryStepConsole`) walks the **newest full-lifecycle
run**: the ten-step strip with per-step standings, the request verbatim,
per-stage sections with nodes and the shared GateDecision, recorded
artifacts through the shared readers in
`components/graph/stage-content.tsx` (extracted from the run-stage console
so two surfaces cannot read one payload two ways), the Discover scout
summary, activity clocks, and prev/next steps. No lifecycle run yet →
the page offers the launch control rather than an empty imitation.

## 2026-08-24: the step pages read reports, and Discover sums its scouts

The owner's STEP 2 board landed on the per-run stage page as recorded facts.
`lib/graph/node-report.ts` is the read-side parser for the general model-node
report every full_lifecycle MODEL node records ({blocked, summary,
findings[{title, detail}], confidence, recommendations}); `ArtifactBody` now
renders that shape as a report — summary, confidence, findings as disclosure
rows, recommendations — instead of raw JSON, on every stage page at once. On
DISCOVERY the page adds `DiscoverySources`: one tile per scout node with its
recorded findings count and stated confidence, and the dedup sentence as
arithmetic over recorded findings (scans total vs consolidated shortlist).
The board's stars, relevance bars and search timings are absent on purpose:
nothing records them. Parser order: typed packages first, then the report,
then verbatim JSON.

## 2026-08-24: one run, one stage — the owner's step page

`/solutions/lifecycle/run/[graphRunId]/[stage]` renders the owner's design
boards as stored facts: the request is the run's goal verbatim, the ten-step
strip is `summariseRunStages` over the run's own nodes (each chip a link into
the same run), the breakdown is the recorded artifact payloads themselves —
structured when a typed stage package parses (decision, evaluation,
discovery), verbatim JSON when none does — and the decision control is the
shared `GateDecision`. The boards' invented figures (confidence percentages,
estimated completion) are deliberately absent: nothing computes them, so
nothing shows them. `/run/[graphRunId]` redirects to the first stage; a
non-stage slug or non-UUID id is a 404; a run outside the newest hundred says
so instead of pretending to be empty.

The read behind it is new: migration `20260824001000_list_graph_run_artifacts`
(function `list_graph_run_artifacts(p_organization_id, p_graph_run_id)`,
authenticated execute only, membership-checked, run scoped to the caller's
organization) served by `GET /api/graphs/runs/[graphRunId]/artifacts` —
payloads verbatim, because `list_graph_runs` correctly carries only counts.
Hosted apply scope: `run-artifacts-read` (sha-pinned). Migration total is 161.
Tests: `tests/unit/run-stage-console.test.tsx`,
`tests/unit/graph-run-artifacts-route.test.ts`.

## 2026-08-24: the lifecycle pages act, not just report

The stage index at `/solutions/lifecycle` was eleven accurate, static cards.
It now carries the work's two actions where the reader already is: a **Launch
Full Lifecycle** card (the same `GraphLaunchControl` the Workflows console
uses, `templateKey="full_lifecycle"`), and an **Approve / Reject** control on
any stage card whose stage holds an open gate — scanning runs newest-first,
so an older PARTIAL run halted at its gate (the resume case) still surfaces
its decision. The stage pages offer the same control on the node row itself.

One implementation, deliberately: `GateDecision` moved from a private
component in `graph-runs-panel.tsx` to `components/graph/gate-decision.tsx`
and both surfaces import it, so the wording, the route
(`POST /api/graph-gates/{gateId}/decide`) and the refusal-passthrough cannot
drift apart. `DetailedNode` (`lib/graph/node-detail.ts`) gained the optional
`gate_*` projection fields the runs endpoint already returned. A decision on
the lifecycle page re-reads the runs, so the card never keeps describing a
gate that no longer holds. Tests: `tests/unit/lifecycle-console-actions.test.tsx`.

## 2026-08-23: a node explains itself, from columns already stored

Round 7's "clicking a node reveals nothing" is closed (ADR-140).
`list_graph_runs` now projects, per node, the job it was given, the nodes it
waited for (`depends_on`), its queue/start/finish clocks, `blocked_reason`,
`max_attempts` and its own artifact counts. Migration `20260823001000` adds no
table, no column and no backfill, and touches no writer: every value was
already stored and only the read was missing. Because the fields go inside the
`nodes` jsonb rather than into new return columns, `create or replace` sufficed
and `app/api/graphs/runs/route.ts` needed no change — it already passes
`row.nodes` through verbatim.

Node keys in the graph-runs panel are buttons; opening one shows the detail.
Durations are derived in TypeScript (`lib/graph/node-detail.ts`) and are null
whenever a duration is not knowable — never started, not yet finished, or
clocks out of order — with the row omitted rather than dashed.

Two things stated so they are not later mistaken for defects:
`node_runs.attempt` gained its writer on 2026-08-30 (ADR-174,
20260830000100 — the worker records each dispatch's attempt and a retry
re-enters RUNNING with its own event), but the column is still deliberately
not projected: historical rows keep their insert default of 0, and a 0 under
an "attempt" heading would read as measured fact, so it surfaces nowhere
until it can be surfaced honestly everywhere. And `latency_ms` is the
executor's call time, not the node's wall time, so the table and the detail
show different figures on purpose.

## 2026-08-23: the lifecycle stages have pages, and the browser suite got its workers back

`/solutions/lifecycle` is the stage index and `/solutions/lifecycle/[stage]`
is one page per stage, added to the console navigation as **Lifecycle**. Both
iterate `SDLC_LIFECYCLE`, so the eleven-stage vocabulary is picked up without
a stage list written out in the UI; an unknown slug is `notFound()`, not an
empty page. `lib/sdlc/portfolio.ts` groups every run by stage — touched,
failed, active, complete, and a failure rate — and is built on
`lib/graph/stage-summary.ts` rather than beside it, so the per-run and
across-run views cannot disagree. Every figure comes from `/api/graphs/runs`,
the same read the runs panel uses. `/solutions/ai-factory` is unchanged and is
still the setup journey, not the lifecycle.

Within one run an empty stage is omitted, because "DEPLOYMENT 0/0" on an audit
graph invents a stage that graph was never going to enter. Across the
portfolio every stage is listed, because "no run has ever reached DEPLOYMENT"
is itself the finding. The difference is intended, not an inconsistency.

**CI: Playwright had been running at one worker on a four-core runner.** Run
32665994906 killed browser shards 1 and 2 at the 20-minute job ceiling —
shard 1 at test 691 of 697 — while shard 3 finished its identical 697 in four
minutes. `--shard` splits by test count, so the three shards were exactly
equal by count and fivefold apart in duration. `workers` in CI is now 2:
measured on a four-core box, a 77-test slice ran 86s at one worker, 53s at
two and 52s at three, so two is the whole available gain and the slowest shard
lands near twelve minutes. A fourth shard was tried and reverted — the shard
count is a string contract in `codex-worker.yml`'s
`SOFTWAREFACTORY_REQUIRED_CHECKS`, the exact-head gate in
`apply-hosted-migrations.yml`, and two tests, so it must move in all four
places at once. No check was renamed.

One regression was caught locally that CI could not have reported, because the
shards it would have failed on never finished: pointing the layout harness's
`/api/graphs/runs` at a new fixture broke the unrelated `factory-briefing`
case. `FactoryBriefing` validates that projection before trusting it, the
fixture omitted `startedAt`, `completedAt` and `verifications`, and the
briefing correctly reported itself incomplete. The fixture now matches the
route's projection.

## 2026-08-24: the lifecycle deadlock is found and fixed by the first live run (ADR-140)

The owner-directed end-to-end test with test data (seeded Demo Data
workspace for the fake journey account; scope note in #381) launched the
first live full_lifecycle graph (91959362). It claimed and executed its
goal node through the real subscription transport — then deadlocked at
the PRD AUTOMATIC gate: zero anchors made it unapprovable by rule, and
nothing anywhere decided automatic gates at all. Fixes shipped in #382
and applied to hosted (run 32680840656, migration 20260824000100, scope
automatic-gate-decider): automatic gates may only sit on ANCHOR nodes
(both lifecycle templates keep two HUMAN gates + one AUTOMATIC on the
TEST anchor), `decide_automatic_gate_as_worker` approves anchored
automatic gates after the run closes (human gates refused
unconditionally, zero anchors refused as for a person), the drain
re-claims and continues in the same dispatch, run records stop calling
gate-halts failures, and the claim schema's stage enum derives from
SDLC_STAGES. Graph 91959362 remains halted at its now-removed wall as
the specimen; fresh launches use the fixed design.

## 2026-08-23: the Workflows launch wakes a worker that can run anchors

The owner's first live `full_lifecycle` launch sat PLANNED and exposed two
gaps (ADR-139). `POST /api/graphs` now dispatches the graph worker
best-effort after `create_graph_from_plan` — the wake can never fail a
launch that already succeeded, and the response reports `workerWoken`
truthfully. The worker now declares ANCHOR alongside DETERMINISTIC and
MODEL: `lib/worker/anchor-node-executor.ts` executes anchors as
observations — the TEST anchor reads CI's recorded check-run verdict for
the worker's checked-out commit (new `checks: read` permission +
`SOFTWAREFACTORY_CHECKS_TOKEN`), the MONITOR anchor probes
`SOFTWAREFACTORY_PRODUCTION_URL` (defaults to https://www.theagoras.com),
and the DEPLOY anchor is refused by policy on the record because Phase 1
keeps deployment owner-approved. Absent instruments read as Not Connected
in the node's own record. Lifecycle graphs are therefore claimable;
the live drain to the ARCHITECTURE HUMAN gate is the remaining evidence.
The same round wired the gate-decision route to wake the worker on
approvals (a recorded approval used to strand the run until a manual
dispatch), retired the "no executor is connected" wording the Workflows
page and launch control still carried, and added the owner's step-by-step
`docs/FULL_LIFECYCLE_GUIDE.md`. The end-to-end walk then added: a
queue diagnosis whenever a drain claims nothing (one line per graph
naming the excluding claim filter — proven live on run 32674703858,
which also showed the owner's original launch never created a graph),
and required-checks mode for the TEST anchor
(`SOFTWAREFACTORY_REQUIRED_CHECKS`, guarded by the wiring suite), so
main's long-red Supabase Preview check cannot fail every lifecycle's
TEST stage. Production serves the current build (verified signed-in via
the fake journey account).

## 2026-08-23: one request can traverse all ten phases in one graph

`full_lifecycle` (ADR-138) stitches the scout's look-before-you-build chain
into the agentic SDLC: GOAL, PRD, three parallel DISCOVERY scans, EVALUATION,
DECISION, then ARCHITECTURE (HUMAN gate), IMPLEMENTATION, REVIEW, TEST
(anchor), DEPLOYMENT (anchor + HUMAN gate), MONITORING (anchor), with the
monitor→goal feedback edge. Launches through the same
`create_graph_from_plan` as every graph; proven in PGlite to store nodes in
all eleven stages with gates exactly where the policies put them. The graph
worker's job timeout rose to 240 minutes to outlive the template's 220-minute
budget. No live full_lifecycle run has executed yet; MODEL nodes run the
record-only worker path, and the two HUMAN gates mean a live run stops for
the owner at architecture and again before deploy — by design.

## 2026-08-23: the lifecycle has DISCOVERY, EVALUATION and DECISION, and a template that populates them

ADR-136's precondition is met and its prescribed growth executed (ADR-137).
`NODE_CAPABILITIES` gains `discovery`, `evaluation` and `decision`; their
outputs are the typed packages in `lib/graph/stage-packages.ts`; the
`open_source_scout` template (seven nodes, three parallel scans, tolerant
fan-in, AUTOMATIC decision gate) launches nodes in all three stages.
`SDLC_STAGES` is eleven. Migrations `20260823000800`/`20260823000900` are
**applied and recorded on hosted** (run 32665300909, two psql invocations
because an enum value cannot be used in the transaction that added it). Both
in-file postflights passed against production; the run shows failure only
because the scope's after-the-fact readback compared `name[]` to `text[]` —
fixed, and now executed verbatim in the replay test. A hosted scout launch
can store nodes in all three stages.

The honesty boundary is in the schema, not the prompt: a discovery candidate
must say how it is known (REPOSITORY / DEPENDENCY / MODEL_KNOWLEDGE), a
recalled candidate cannot claim repository verification, and popularity
metrics do not exist in the contract because the executor has no network to
observe them with.

## 2026-08-23: signing in lands on a chooser, and the header names two products

`/decision` is the destination for every sign-in, on `main` as `56641c13`
(#365) and live in production. Two product cards - AI Software Factory and AI
Job Seeker - with Getting started beneath them and a Quick overview plus
Recent activity rail. Every number on it is counted from the viewer's own
records; a source that cannot be read says **Unavailable** on its own row
rather than showing a zero.

Three gates run before it renders: signed out redirects to sign-in, no
workspace redirects through onboarding and back, and a closed gate redirects
to `/solutions`. "Only on initial login" is a fifteen-minute HTTP-only marker
opened by the password route and the auth callback and closed by the act of
choosing (ADR-135). It grants nothing - the page still resolves the viewer, so
a forged cookie earns a redirect rather than a page. Verified live: an
anonymous request to `/decision` is answered with Next.js's streamed redirect
to `/auth/sign-in?next=/decision` and no page content.

The global navigation now reads **Software Factory** and **Job Seeker** for
every signed-in viewer, verified in the deployed client bundle. Administration
is no longer an entry there; `/solutions/admin` is unchanged and the console's
own column still lists it for super administrators.

## 2026-08-23: the Autonomy page can be cleared, by archiving

`clear_autonomy_projects` (migration `20260823000600`) is hosted, applied and
verified by run `32657726992`. The Clear control on `/solutions/autonomy`
archives every project the loop can still act on, through `archive_project`,
and `list_autonomy_status` now excludes archived projects - which is what
empties the section. It deletes nothing: every run, task, command and activity
row keeps its project, and archived projects can be unarchived from the
Projects page.

Three independent guards refused deletion on the way here, the third by name
(ADR-134). The apply's own rolled-back proof, run against the real hosted
rows, reported `GUARD: project deletion still refused`. That proof now accepts
the `activity_events` RESTRICT as well as the guard trigger's message, because
hosted has never recorded `20260815000900` and the constraint - not the
trigger - is what enforces permanence.

## 2026-08-22: the Backlog and All Pipelines pages can be cleared

`/solutions/backlog` and `/solutions/pipelines?view=all` each carry a clear
control (ADR-119), landed on `main` as `9761055` (#317). One component,
`components/clear-surface-button.tsx`, serves both: press, confirm, give a
reason of at least ten characters, optionally tick the checkbox that also
deletes rows carrying run history.

The authority is entirely in the database. `clear_backlog_tasks` and
`clear_all_pipelines` (migration `20260822000800`) are SECURITY DEFINER, refuse
a caller who is not an owner or admin, refuse a short reason, skip live work,
and skip anything whose deletion would cascade into `agent_runs` unless the
caller opts in. Every call writes an audit row, including one that deleted
nothing. The two labels those rows use — `task.backlog_cleared` and
`command.pipelines_cleared` — are added in `20260822000700`, a separate file
because PostgreSQL refuses to use an enum value in the transaction that added
it.

**Hosted: applied.** Run `32582241930`, `scope=clear-controls`, both versions
absent from the ledger beforehand. The post-apply readback measured:

```
       proname       | security_definer | member_may_execute | anon_may_execute
 --------------------+------------------+--------------------+------------------
  clear_all_pipelines| t                | t                  | f
  clear_backlog_tasks| t                | t                  | f
```

Both enum labels present. That readback came from the step that ran the DDL, so
`scope=probe` now carries the same read independently, plus `service_role`
EXECUTE and the two labels asked of `pg_enum` directly. An apply grading its own
work cannot tell a wrong assertion apart from a wrong migration.

**Unpublished any-model command candidate, 2026-08-22 (ADR-115):** Factory
command admission now follows the selected posting instead of forcing every bot
to impersonate the one executable worker. Exact `openai` / `gpt-5.3-codex`
remains the only executable identity and keeps the manual Phase 1C plan. Every
other valid bounded provider/model pair is `record_only`: its command, task,
route, and disposition persist, but it creates zero agent runs and cannot reach a
worker, branch, commit, pull request, merge, or deployment. Invalid identities
are refused. A nondefault `SOFTWAREFACTORY_CODEX_MODEL` value also throws before
planning, so environment configuration cannot silently widen execution.

Step 8 may advance on durable `record_only` persistence. Step 9 then reads the
project-scoped safe command projection and truthfully reports that no run,
worker, branch, or pull request exists by design; a reload must preserve that
same project-only history without exposing raw parameters. The executable Codex
path remains distinct and unchanged.

Hosted `20260822000600_route_bots_onto_the_executable_model.sql` is already
applied. The protected `20260822000300` -> `20260822000850` ->
`20260822000900` -> `20260822001000` -> `20260822001100` -> `20260822001200`
chain **is applied on production**: run 32607123713 rehearsed the whole
chain with a clean lint, committed the single production transaction, and
recorded all six ledger rows once each (detail probe 32607361788 read the
exact intended posture back). The record-only routing is live in the hosted
database. ADR-116 removes the repository's magic RED release phrase,
predeclared-SHA, expiry, and repeat-approval ceremony; it does not remove
any technical gate or any product/runtime RED approval boundary. Workers,
autonomy, and automatic actions remain OFF and the global kill switch
remains ON. `scope=record-only-postflight` run 32607902289 read every
post-commit verification back green on the applied database (ADR-127). The
owner then confirmed Step 8 passing and the truthful record-only Step 9
(screenshots ~00:27Z) and directed that Step 9 actually run the bot:
ADR-128 gives a record-only Claude command one real analysis graph run
(subscription transport, read-only tools, artifacts and verifications),
launched at submit and reported truthfully in Step 9 and the request card.
Migration 20260823000100 ships behind `scope=command-analysis-graphs`; the
manual Codex write lane is unchanged and still owner-gated. Outstanding
evidence: deploy + hosted apply + a live analysis run completing for an
owner-issued command; until that lands, make no fully-verified claim about
the bot running.

The containment gate walked to its last clause on 2026-08-22 evening
(ADR-122). The owner engaged the global kill switch and turned Autonomous
Mode OFF via the Safety page at ~21:11Z; probe 32599024205 then read every
state, census, worker, and event clause green, and probe 32599284961
isolated the one red clause: `reject_mutation_function_posture`. Two causes:
the gate's space-only `btrim` source comparison was false on every database
(fixed to trim `' \n'`), and hosted default privileges left `service_role
EXECUTE` on `reject_activity_event_mutation()`. `20260822001300` behind
`scope=audit-guard-acl-contract` removes that grant. Order:
`audit-guard-acl-contract`, then re-dispatch `factory-any-model-record-only`
under fresh exact-head CI and READY Vercel identity.

All three hosted-input repairs then landed and read back exactly: run
32599987697 (`audit-guard-acl-contract`), run 32601173685
(`agentos-foundation-cleanup`, ADR-123), and run 32602669547
(`command-carry-forward`, ADR-124). Chain run 32603384774 subsequently
passed every prerequisite, history, catalog, containment, and input gate for
the first time and aborted inside the rehearsal transaction on
plpgsql_check's `missing trigger relation`: the lint invoked all 27 roster
functions with `0::regclass`, and the three Phase 1C trigger functions can
never be linted without their relations, so the clause was unsatisfiable on
every database (ADR-125). Nothing committed; the ledger is unchanged. The
lint rows now carry the `trigger_expectations` relations from
`20260822001000`, and `scope=probe` proves the mechanics inside a
rolled-back transaction (probe 32604290485: attachments match, zero lint
exceptions, zero extension residue).

Chain run 32604992678 then completed the rehearsal lint for the first time
and refused on one genuine warning: `agentos_resolved_agent_grants`
initialized its `agentos_network_mode` variable from a bare text literal
(plpgsql_check 42804). Both creator copies (20260814000300 and 00900) now
carry the explicit enum cast, 00900's source pin is
`a1231a4a5329b1dab132b6e774d97bb3`, and the frozen REPAIR sha is
`512869badb309e99f9c58c6886ecd1af10e3b29ec636ed700b93b539f2f0f694`. The
gate's evaluation also could never pass as written - rehearsal stdout
legitimately carries blank lines - so findings are sentinel-prefixed
`LINTROW|` rows and the gate greps for the sentinel (ADR-126). All of it
verified in the supabase postgres 17.6 image: 148 migrations apply, both
paths yield the pinned md5, 27-function roster lints clean. Remaining
order: the chain under fresh exact-head CI and READY Vercel identity, then
production Step 8/Step 9 acceptance.

Read-only hosted probe `32587973532` isolated the prior atomic-run stop to one
real ACL defect: every table/RLS/policy/index/constraint/source/catalog hash was
exact, but `apply_resume_extraction(uuid,text[])` still had direct
`service_role EXECUTE` from Supabase function default privileges. Immutable
`00500` did not revoke that role. New forward migration `01100` freezes the
exact known three-entry input, removes only the overgrant, and requires the
final owner-plus-authenticated ACL. It is part of the same rollback rehearsal
and production transaction; it has not yet been hosted.

Read-only hosted probe `32590061431` then proved the same Supabase default
privilege overgrant on both clear-control functions: `service_role` could
directly execute `clear_backlog_tasks(uuid,text,boolean)` and
`clear_all_pipelines(uuid,text,boolean)`. Forward migration `01200` freezes
their exact identities and known ACL inputs, removes only the unintended
function access, and requires owner plus authenticated as the final ACL. It
extends the protected rollback rehearsal and atomic production transaction;
it has not yet been hosted.

Read-only hosted probe `32591774367` found the final pre-repair catalog delta
without writing DDL or history. Twelve of the sixteen guarded routines were
exact. `normalize_bot_assignment_configuration(jsonb)`,
`record_claim_anchoring(uuid,anchored_claim,uuid[])`, and
`validate_pipeline_template_areas(jsonb)` carried an unintended direct
`service_role EXECUTE` grant, while
`claim_provider_connect_session(text,text)` had the inverse drift: owner-only
ACL instead of its required owner-plus-service-role ACL. Forward migration
`20260822000850_normalize_hosted_pre_repair_function_acls.sql` accepts only
that exact four-function input and converges the ACLs before `00900` runs.
It does not replace a function or change an OID, source, signature, owner,
SECURITY DEFINER setting, search path, argument/result contract, or comment.
In particular, the hosted claim function keeps its legacy OUT names
`organization_id` and `purpose`; pending `00900` now freezes that measured
result contract (`3b2b93799687f2d2de6b154376542759`) and complete catalog
contract (`a7ca5a02b1faa50ebba452c4a4f46195`) rather than renaming it.

**Historical release checkpoint before ADR-115, 2026-08-22 (ADR-111,
superseded):** exact commit
`30d7e824691bdd4f8fa72481b21c91d3da6e3a31` is on `main`, with
`surgeservicesllc <surgeservicesllc@gmail.com>` as both author and committer.
Vercel production deployment `dpl_FrvCToHvFhkzfwnkmEeeTyfuE3v2` is READY at
`https://softwarefactory-116001qbk-surgeservices-projects.vercel.app` and owns
the stable production aliases. GitHub deployment `6036292508` and status
`17160408639` bind that production deployment to the exact commit.

Exact-head CI run `32570540183` completed with failure. Browser/accessibility
jobs `97025270171` (1/3), `97025270137` (2/3), and `97025270138` (3/3) all
passed. Quality job `97025270055` failed during tests, so the production build
step was skipped. The candidate defect was deterministic: migration
`20260822000150` compared legacy `pg_proc.prosrc` hashes without canonicalizing
line endings, and the LF Linux/PostgreSQL chain rejected all seven routines with
`legacy bot function ACL normalization preflight failed`. Supabase Preview
check `97025325852` also failed, but at the older
`20260814002500_provider_credential_vault.sql` migration with SQLSTATE `42P07`
because `provider_credentials` already exists; the identical failure predates
this candidate and remains preview schema/ledger drift.

The local cross-platform repair canonicalizes CRLF and lone CR to LF before
every `md5(prosrc)` comparison in migrations and hosted guards, updates the
canonical LF routine map, and pins these exact repository files:

- `20260822000150_normalize_legacy_bot_function_acls.sql` —
  `6b24b6ebb57e59b9c4398c3e439221c27c300663a7b6932ff192996ffe6bcd93`;
- `20260822000200_register_bot_for_ai_account.sql` —
  `658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`;
- `20260822000300_contract_bot_mutator_acls.sql` —
  `79914bc97660eef908b6a0fa0c90abfdd15da1683b383ad568e34bf3bd32c5f7`.

Native PostgreSQL 17.10 and 18.4 full migration chains pass with the repair.
The repair is frozen in the current forward candidate but is not yet pushed,
deployed, or authorized for hosted execution. No hosted database mutation has
occurred: 00150, 00200, and 00300 remain unhosted, CONTRACT was not dispatched,
and the old failed EXPAND must
not be rerun.

The preceding exact commit
`4fc18d3e5ecba6f362f14a7459e588a74a84b84b` and READY deployment
`dpl_8yngqtjJkNbexxWAMfAhZtEf1RWU` remain historical application evidence.
Protected EXPAND run `32568221857` stopped before DDL or ledger mutation at
`LEGACY_CATALOG_READY`: `20260822000100` was present and 00200/00300 absent.
That failure exposed the hosted all-seven direct `service_role` EXECUTE posture
and the PostgreSQL-major-sensitive `pg_get_functiondef` deparser hashes that
ADR-111 contains forward.

**Release-candidate addendum, 2026-08-22 (Claude bot identity and Role assignment,
ADR-108/ADR-109):** the application portion is deployed at `30d7e824`; the
protected database sequence remains local and unhosted. AI Factory owns one
application modal, backdrop, focus
trap, and close/back path. Its project roster, assignment wizard, posting edit,
and zero-role onboarding render inline in that overlay; they do not open a
nested dialog. When an organization has no roles, the starter selector defaults
to the reviewed **Backend engineer** template and sends that complete template
through the existing same-origin, manager-only, audited `/api/bot-roles`
boundary. The exact returned role UUID fills only selected drafts that still
lack a role. This is separate from the **Developer** permission preset used for
a new posting; an existing posting keeps its authored role and configuration,
and a new posting with existing roles prefers a role whose slug matches the
preset before falling back to the first available organization role.

The owner screenshot exposed one UI-only identity leak: `ProjectBots` used
`credentialRef` similarity to suppress the exact-link repair control. That let
an unbound Ready legacy bot be assigned while AI Factory correctly held steps
5-7 incomplete. The local fix removes the inference, exposes the existing
exact `/api/bots/connect/provision` Link-or-repair/adoption path, awaits the
parent refresh, and supplies an accessible **Return to AI Factory** action. The
affected completion predicate remains: connected account + exact
`aiAccountId` + current Ready + project assignment.

This containment is frozen in the current unpublished candidate. Focused UI
passes 75/75; focused ESLint, full typecheck, and lint/typecheck/build are green. The root
full suite passes 337 files / 4,054 tests, with 3 files / 7 tests skipped. Its
first contention-only `supabase-wiring` timeout cleared isolated 2/2 and on the
full rerun.

Forward migration `20260822000200_register_bot_for_ai_account.sql` is frozen at
SHA-256
`658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`.
Its authenticated manager boundary binds every subscription bot it returns to
the exact tenant `ai_accounts.id` and derived provider/credential slot. A
default/non-additional request reuses that account's existing bound bot or may
adopt one unambiguous matching legacy bot without changing its identity; an
explicit additional request creates another distinct bot bound to the same
account. Cross-tenant or provider/credential drift is refused. The exact
account is the identity; provider or credential-reference similarity is not.
`bots.revision` and
`bot_assignments.revision` start at 1 and advance monotonically on every row
update, with overflow refused. Assignment, status, configuration, and execution
preference writes lock the open posting and compare its exact assignment UUID,
  project UUID, and revision before delegating to the established audited
  mutation. Checked edits refuse a released posting, so released history cannot
  be reopened or rewritten through a client-callable mutation boundary. Checked
  bulk assignment also refuses a current paused posting under lock; it must be
  explicitly resumed through the checked status boundary before assignment or move.

Readiness is server evidence. The service-role-only
`record_bot_readiness_preserving_disabled` function also carries an owner/admin
actor and, under the bot row lock, requires the exact bot revision, AI-account
UUID, provider, model, credential reference, and base URL that were evaluated.
A stale verdict fails instead of overwriting a newer configuration; a readiness
check cannot author `Disabled`, and an already Disabled bot is returned
unchanged. The legacy registration and mutation function definitions,
signatures, `SECURITY DEFINER` attributes, and pinned `search_path` values are
unchanged. This is an EXPAND migration: the exact existing authenticated-only
execute ACLs on all six legacy assignment/readiness RPCs remain unchanged while
authenticated revision-checked wrappers and the service-role-only readiness
recorder are added. That temporary compatibility means the old application can
still call unchecked mutations and the legacy readiness path; revocation is
deferred to a separately approved forward CONTRACT migration after exact-app
deployment and signed-in acceptance.

The roster now proves completeness rather than treating a prefix as the whole
fleet. It filters released postings in PostgreSQL, keyset-pages open postings
by assignment UUID until an empty terminal page (including after a short
server-capped page), and fails the entire read on invalid progress or its
bounded page guard. Only that terminal proof sets `assignmentsComplete`; AI
Factory fails the assignment-derived Assign and Configure steps closed without
it. Connect remains the separate exact connected-account -> account-bound Ready
bot proof. The combined identity continues through the exact selected project
and revision-checked active assignment, with posting configuration evaluated
from that same chain across reload.

Broker start, retry, close, and unmount cleanup are serialized through one
lifecycle queue. Session UUID plus generation gates discard late polls and
callbacks from a superseded attempt. Retry cancels the exact prior session
before starting another; close blocks a racing retry, waits for an in-flight
start to reveal its session UUID, and keeps the overlay open/resumes polling if
cancellation cannot be confirmed. This changes no provider login protocol or
credential format.

The prepublication working tree passed lint, typecheck, production build, 331
Vitest files / 3,934 tests (7 skipped), and the serialized browser matrix. That
evidence remains useful, but exact-head CI run `32570540183` supersedes it as the
release gate and is red for the cross-platform migration-hash defect described
above. All three exact-head browser shards remained green.

The application commit was pushed and deployed; the database sequence was not.
The protected workflow now has separate exact-file scopes for ACL normalizer
00150, EXPAND 00200, and CONTRACT 00300. Broad apply refuses to introduce any
of them. Before hosted execution, record the forward commit's exact identity,
require green exact-head CI, and obtain fresh RED authorization. Runtime behavior, linked-
database lint, application health, and kill-switch/autonomy/worker containment
remain explicit post-apply gates. Worker/executor dispatch remains disconnected,
all automatic actions and raw autonomous mode remain OFF, and the global kill
switch remains ON.

**Production acceptance addendum, 2026-08-21 (AI Factory):** exact candidate
head `a020e8192d8512a1bb65112e01017047087f0528` passed all four Linux CI jobs in
run `32543409160`: quality plus browser shards 1/3, 2/3, and 3/3. This is
exact-head candidate evidence, not proof that the candidate is deployed.

An authenticated production-browser pass now measures the guided journey at
**4/8**. Selecting built-in pipeline **Agentic SDLC** persisted across reload,
and the Activity surface exposed its immutable `pipeline.selected` event. The
owner then reconnected the Claude account, which production reports Connected.
Account Refresh has queued re-verification but remains pending because no
worker sweep completed, so it is not fresh worker evidence. Creating a bot
still fails and leaves the roster at zero: the Bot Manager sends the broker's
raw `claude`/`claude_N` purpose (and would do the same for `codex`/`codex_N`)
where the provisioning boundary accepts the provider-neutral
`subscription`/`subscription_N` choice. PR #309 isolates the normalization at
exact head `db1958f8b501e865a9e741a21298683e0f88f969`, rejects
provider/purpose mismatches, and carries real-purpose regression fixtures. Its
focused 99-test run, lint, typecheck, production build, and secret/protected-
path audit pass. It is not deployed and no production bot stickiness claim is
made.

PR #309 did not satisfy its merge gate. Browser/accessibility shards 1/3, 2/3,
and 3/3 in CI run `32545138211` failed because the client-only console rendered a spinner
without the page's `AI Factory` H1 while required workspace reads were pending.
The forward candidate keeps the H1 in loading and all fail-closed states and
adds a direct regression test. A separate release blocker remains at the
protected credential-resolution boundary: provisioning stores the catalog's
Claude/Codex subscription reference, but `normalizeCredentialRef` currently
allowlists provider API-key references only, so a created subscription bot
would read Not Connected even when its vault credential exists. The manual
readiness endpoint also evaluates and serializes environment presence only,
creating the same false negative for vault-backed accounts. No protected file
has been changed without the requested exact owner approval. Provisioning
also does not set `bots.ai_account_id`; credential-reference persistence is not
yet full account-identity binding.
`subscription`/`subscription_N` choice. The branch candidate now normalizes
every account-backed provisioning path, rejects provider/purpose mismatches,
and carries real-purpose regression fixtures. Its focused 100-test run, lint,
typecheck, and production build pass. It is not deployed and no production bot
stickiness claim is made.

Production therefore remains unsafe and not fully live. The same release gates
remain open: five linked-database lint errors across ten findings, one raw
organization with `autonomous_mode = true`, one raw organization with
`autonomy_kill_switch_active = false`, two projects with effective kill off,
no connected/fresh worker, and hosted migration/application drift
(`20260821000300` rather than candidate `20260821000400`).


**Release addendum, 2026-08-21 (Factory command routing, ADR-106):** the
rebased candidate adds `20260821000400_command_factory_routing.sql`, an exact
34,999-byte migration with SHA-256
`e45149db3ca7c66a27934b0b49ac160e1b5ef597fc8f34ad8547de4759086598`.
An authenticated organization owner can submit or replay a factory command;
the database delegates to the existing command/task/run transaction, rechecks
the stored effective risk, and persists one immutable route containing the
selected pipeline, bot assignment, bot, provider/model, and work-effort
evidence. Exact idempotent replay resolves that durable route before reading
mutable pipeline, roster, readiness, or capacity state. The request does not
dispatch a worker or change autonomy; no connected/fresh worker was observed,
and merge, deploy, and rollback remain Not Connected. A missing routing RPC
returns Not Connected/503, so the application fails closed until the migration
is hosted.

The candidate also closes two first-use UI failures. An embedded template-plan
dialog now derives its locked project directly from `projectContext`, so its
first render cannot falsely claim that the workspace has no projects and it
never performs the wider `/api/projects` read. The bot-assignment wizard now
explains that a role is required, links to the real Bot Manager route, and
cannot advance from Configure until every selected bot has a role.

This is candidate evidence, not a production claim. Production still serves
the previous copy and its hosted ledger includes `20260821000300`, not
`20260821000400`. The exact hosted project currently has five linked-database
lint errors across ten findings; raw data includes one organization with
`autonomous_mode = true`, one organization with `autonomy_kill_switch_active = false`,
and two projects whose effective kill switch is off. No connected/fresh worker
was observed. These facts supersede older blanket claims in this file that
linked lint is clean or that every hosted autonomy flag/kill switch is safely
OFF/ON. Release must stop until those conditions are contained and remeasured.

Candidate lint, typecheck, and production build pass. The default unbounded
Windows run exposed contention-only Supabase-wiring and pipeline failures;
both cleared on isolated retry (the wiring contract passed 2/2 in 0.603s with
`maxWorkers=1`). The bounded current-head non-frozen command
`vitest run --exclude tests/unit/auth-broker-runner.test.ts --maxWorkers=4`
passes 317 files / 3,730 tests with 7 skipped in 183.78s. The owner-frozen
19-test auth-broker file is excluded locally solely because Windows lacks the
Unix `script` executable. This is not a full-suite waiver: Linux CI must run
the complete suite including that file. The separate hosted-runbook/
repository-memory guards remain 21/21 passing.

**Addendum, 2026-08-21 (Factory Briefing, ADR-104):** the Dashboard now has
one read-only, four-lane control-plane briefing: Needs owner now, Underway,
Recently finished, and Up next. A deterministic classifier folds the existing
caller-member projections for tasks, runs, graph runs, the AgentOS inbox,
operations incidents, GitHub connections, the logical agent roster, and
worker heartbeat evidence. A task owns its linked run, so the same work cannot
appear in two lanes; cancelled work is omitted with a count; unknown lifecycle
values fail into an inspectable lane. All eight sources are read in parallel
with `no-store`, per-source timeouts, batch cancellation, and stale-response
protection. Any unavailable, malformed, or saturated source produces an
explicit incomplete warning—an empty lane is never presented as an all-clear
while evidence may be missing. Briefing-specific API views omit prompt-derived
task titles, command prompts, inbox bodies and choices, graph node/artifact/
verification details, repository details, and unrelated operations data from
the browser response while retaining verdicts needed to fail visibly.
Malformed verification evidence fails the graph briefing read closed. The
coordinator label is the recorded logical
Orchestrator role, not a claim that a new supervisor exists. Actions only
navigate to the existing authoritative screens, which re-read and re-authorize
state. This adapts the useful Bearings information architecture reviewed in
FirstMate commit `738460d401b1115dab617c3859077973977615cb`; no FirstMate
shell/session code, state files, credentials, relay, merge path, or execution
authority was imported. No schema, RLS, workflow, provider, autonomy, or
production change is part of this increment.

**Addendum, 2026-08-21 late (Job Discovery operational — ADR-105):**
discovery on /job-seeker now has two real ways in: manual recording and
public-board import. Greenhouse and Lever are identifier-driven public
adapters (their public APIs need no credential — only which board to
read, typed on the card); `POST /api/job-seeker/import` fetches up to 40
postings per request, records each through the same evaluate → job →
match → application chain as manual entry, counts duplicates against the
unique index, and states the board's true total. Rows carry `via
{source}` attribution; LinkedIn remains Not Connected pending real OAuth.
The journey proves the live provider round-trip (missing-board refusal
verbatim, then a real board imported and scored end to end).

**Addendum, 2026-08-21 (Job Seeker verified live — ADR-097):** the whole
/job-seeker surface has now been driven in a real browser against a real
Supabase stack (`supabase start` with the full migration chain + the
production Next build) by `tests/e2e/job-seeker-journey.spec.ts`
(env-guarded, `JOB_SEEKER_E2E=1`): sign-in, workspace onboarding, every
field of every section with fake data, resume upload, record + score,
duplicate refusal, the approval-gated pipeline to Applied, contact +
outreach draft, analytics — with persistence proven by reload. Three live
defects that run surfaced are fixed: the no-workspace dead end (the page
now redirects to onboarding, onboarding honors `?next=`, and the console
renders a workspace call-to-action on 409), live PostgREST one-to-one
embeds arriving as objects where the jobs route expected arrays (every
live record had shown no score), and a whole-profile 422 when an added
history entry was left empty (now pruned client-side). Signed-out
production verified separately: the page streams its sign-in redirect and
every /api/job-seeker route answers 401. Round 2 extended the journey to
the whole capability surface — all eleven pipeline stages walked, the
reject+close side of the gate, history-entry removal, the resume download
round-trip — and closed two more wiring gaps: a per-application "Notes &
follow-up" editor now reaches the PATCH actions (notes / application URL /
follow-up date) that previously had no UI, and the profile view embeds the
current resume via `resume_upload_id` so the stored file stays visible
across reloads instead of vanishing after the upload moment.

**Addendum, 2026-08-18 (a project's selected pipelines):** Configure Pipeline
is a step that can be worked on. `project_pipelines` (migration
`20260821000300`, applied on production by run `32536895799`) records which
templates a project runs — many
per project, built-in or custom — behind RLS with FORCE RLS, every table
privilege revoked from `anon`, `authenticated` and `service_role`, and three
definer functions as the only path: owner/administrator
`select_project_pipeline` and `deselect_project_pipeline` (both audit-evented
and advisory-locked per project-and-key) and member `list_project_pipelines`.
**Use** on a template card toggles that record through
`/api/project-pipelines` — grey and `aria-pressed` when selected, accent when
not — and the journey reads it back: the step is done only when at least one
pipeline is selected, and the chosen names render on the page rather than only
inside the overlay. Planning a real graph, which Use used to do, is now its own
**Plan graph** button. On a database *without* the migration — a fresh preview
branch, a restored snapshot — the route reports PGRST202 as **Not Connected**
and the console disables Use naming that reason, so a missing migration can
never present as an empty selection set (ADR-098).

**Addendum, 2026-08-17 (AI Factory guided journey):** `/solutions/ai-factory`
("AI Factory" in the left navigation under Overview) is the owner's guided
end-to-end path — Connect Repository → Create Project → Configure Pipeline →
Connect Bots → Assign Bots → Configure Bot Settings → Issue a Command → Watch
It Ship. Step completion is **derived from live records** (installations,
projects, connected accounts, assignments and their configuration, commands),
never from stored wizard state, so progress survives refresh by construction
and cannot disagree with the rest of the console. Every step's option opens
the **real existing control as an overlay** over the page (ConnectionsConsole,
AddProjectForm — extracted to `components/add-project-form.tsx` and shared
with the Projects dashboard — PipelineTemplatesManager with built-ins compiled
server-side, BotManagerHome, the per-project ProjectBots roster, and
CommandComposer); closing an overlay re-reads the journey, and the controls
that know their completion close themselves. The Assign Bots wizard also
links Bot Manager accounts directly: connected AI accounts with no bot yet
are offered in the Select step, and linking provisions a bot per account at
that account's credential slot (`/api/bots/connect/provision`,
`additional:true`), re-reads the roster, and selects the new bots — multiple
at once. Per-posting execution preferences (model override + work effort,
migration `20260817001100`, hosted) surface on each posting card. No
execution-authority change anywhere in this surface: assignment remains
routing intent, and the page says what actually runs.

**Addendum, 2026-08-20 (component audit — three migrations are outstanding on
hosted):** the hosted schema audit had been reporting "0 applied, 0
outstanding" from a hand-written list of four migrations while the directory
held 124. Its expectations are derived from `supabase/migrations` now, and the
audit now reads PostgREST's own description for functions as well as probing
tables, and run
[32316446825](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/32316446825)
reports **46 applied, 4 outstanding, 0 indeterminate, 74 not probeable**. The
four are `20260814000300_agentos_isolation_model` (nine `agentos_*` tables),
`20260814002500_provider_credential_vault`
(`resolve_provider_connect_session()`, whose sibling
`claim_provider_connect_session()` is visible),
`20260815001100_connection_routing_decisions`, and
`20260816001600_phase2c_resource_reservations` (`resource_reservations`,
`resource_rate_events`). NOT VISIBLE is not absent — a table that exists with
no grants looks identical over REST — so `scripts/hosted-state-report.sql`
must run before any apply, and applying is an owner-approved action that no
agent has taken. Meanwhile every consumer degrades honestly: the reservation
store refuses with `ADMISSION_UNAVAILABLE` rather than admitting on unknown
usage, `/api/agentos/grants` answers `agentos_grants_unavailable`, and
`connection_routing_decisions` has no application consumer at all. The vault
function had a real consequence: `POST /api/bots/connect/claim` reported the
failed lookup as `connect_session_invalid`, telling operators with a correct
code that their sign-in link was invalid. That path now separates a failed
lookup (`503 connect_unavailable`) from an unmatched code, without reopening
the code-guessing oracle the uniform failures close. The full
component-by-component walk, with each step's evidence, is
`AI/FACTORY_COMPONENT_AUDIT.md`.

**Addendum, 2026-08-19 (graphs execute now — ADR-092):** recorded graphs no
longer dead-end at PLANNED. The graph executor worker
(`scripts/graph-worker.mts` + `.github/workflows/graph-worker.yml`, manual
dispatch; schedule gated on `SOFTWAREFACTORY_GRAPH_WORKER_SCHEDULED`) claims
them through the service-role boundary of migrations `20260819000100` and
`20260819001000` (`claim_planned_graph(worker_id, supported_executors)` →
atomic RUNNING run + PENDING node_runs + whole projection, skipping any graph
whose nodes need an executor the caller does not declare — ADR-093;
`record_node_state_as_worker`; `record_graph_artifact_as_worker`;
`complete_graph_run_as_worker`; `record_verification_as_worker`), recompiles them through the console's own
compiler, and runs nodes in parallel up to the graph's budget through the
subscription transport — read-only analysis tools only, models tiered per
node. Edges carry data (each node's prompt receives its upstreams' outputs,
missing inputs demand stated incompleteness), failure is contained (siblings
finish, dependents SKIPPED, runs close PARTIAL/FAILED honestly), failed-only
graphs are re-claimable up to three FAILED runs, and provider capacity
refusals void the run as CANCELLED (uncounted, total ceiling 10) and stop
the drain. Applied and exercised on production: runs 32208699123,
32208975669, 32209893742 each drove the loop one real defect further.

**Addendum, 2026-08-16 (per-account usage evidence):** migration
`20260816001500_ai_account_usage_observations` adds append-only provider-usage
evidence per AI account (RLS+FORCE, zero direct table access, worker-only
`record_ai_account_usage`, member-only `list_ai_account_usage`). The
auth-broker worker now captures usage automatically — startup, ~5-minute idle
cadence, and immediately after a sign-in connects — by probing Anthropic's
OAuth usage endpoint with the sealed credential opened only inside the sweep
(`lib/worker/usage-probe.ts`); OpenAI/Codex records `unsupported` truthfully
until a real endpoint is proven. The Bot Manager's AI-accounts panel renders
the latest observation per account (session/weekly percentages with reset
times, a named failure, or "no usage recorded yet") via
`GET /api/ai-accounts/usage`, refreshing every 30 s while visible; a hosted
database that predates the migration reads as an empty list, not an outage.
Local and CI evidence only until the migration is hosted — the runbook's
outstanding set now ends at `20260816001500`. The frozen connect path's login
semantics are untouched (ADR-076); no execution authority changes.

**Addendum, 2026-08-16 (project repository picker):** migration
`20260816001400_project_repository_picker` adds `set_project_github_repository` and
`unlink_project_github_repository` — owner/admin choice of which GitHub repository an
existing project connects to, with change and unlink. Both take the same advisory locks as
`handoff_github_project_connection` and the change-reservation trigger, enforce one
non-archived project per repository (naming the conflicting project in the refusal), block
while a change reservation is pending, and append immutable `connection.changed` activity
evidence. `PUT`/`DELETE /api/projects/[projectId]/repository` exposes them behind
same-origin plus owner/admin checks, and the Connections console gains a per-project
repository picker with truthful no-installation / zero-repository / load-failure states.
`connect_github_project` (creation-time binding) is untouched; no RLS, grant matrix,
or execution-authority change. The migration was **unhosted** when this was written;
`20260816001400` is on the hosted ledger as of the 2026-08-18 measurement, and the
"outstanding set of 33 ending at ..." framing is superseded by that correction. Verified locally by
`tests/integration/project-repository-picker.behavior.test.ts`,
`tests/unit/project-repository-route.test.ts`, and the extended Connections console suite.

**Addendum, 2026-08-16 (BotBuild):** migration `20260816000100_ai_accounts_auth_broker`
adds `ai_accounts` (provider sign-ins as first-class identities; no secrets — only the
vault purpose linkage), `ai_auth_sessions` (the broker state machine a worker drives
through the provider's real login), and nullable `bots.ai_account_id`. RLS+FORCE with
zero direct table access; all transitions via definer functions that write activity
events. Local and CI-verified; recorded as **unhosted** when this was written. The
2026-08-18 measurement finds `20260816000100` still absent from the ledger while the
broker connect flow works live against production — unledgered DDL, not missing schema. No execution authority changes. The broker API, worker auth
runner, and UI are not built yet; the connect-command flow remains the live path.

Historical delivery snapshot (superseded by the 2026-08-21 routing addendum): Phase 1B GitHub App owner path live; hosted Supabase ledger reconciled and forward migrations applied through `130014`; Phase 1D decision layer hosted and execution-inert; Phase 1C re-architected to zero-token subscription-authenticated Codex execution; the credential was reported configured and the worker live at that time. Current evidence instead has no connected/fresh worker.

Overall status: **The protected hosted-database sequence completed on exact project `qpuofpmagrmyamahqwxw`: catalog-proven history for `028`/`130001`-`130005` was reconciled without DDL replay, forward migrations `130006`-`130014` were applied, the ledger is current, and linked lint is clean. Focused hosted verification preserved bot-function identity/security/search-path/ACL boundaries, found zero `pg_catalog.nullif`, passed register/update/readiness audit behavior `1/1/1`, and confirmed the Phase 1D resolver is hosted with all actions OFF and the global kill switch ON. Local migration `130015` restores assignment/run model checks from the accidental 120-character narrowing to the original 128-character provider catalogue/API contract, adds four no-secret constraints for catalogue model/display-name, assignment model, and routing policy-version/selected-model text, adds a bounded routing-evidence projection, and revokes authenticated raw reads of routing decisions/events while retaining RLS-scoped model-configuration reads; it is not hosted or covered by an existing approval. The prior verified production baseline before this update was `0c662a24393f682073e6002c5aff9339292226d8`; CI run `31749352644` passed both required jobs and matching Vercel deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7` was READY. Distinct no-claim diagnostic Actions run `31748582858` passed the exact-model lookup, then the bounded non-stored Responses probe failed with the safe machine-readable code `credit_balance_exhausted`. Docker preload and durable claim were skipped. Durable run `f4594556-6f72-4763-a480-6993939e3651` remains failed safely after attempt 1 of 2, but its immutable planned base predates the published baseline; it must not be retried because the worker would correctly reject it as `stale_base_sha`. Acceptance requires a new command bound to the then-current base after the subscription credential is configured. The activation variable is absent/OFF. The user-pasted OpenAI key is treated as compromised; `SOFTWAREFACTORY_OPENAI_API_KEY` has been removed from repository Actions secrets and is now **permanently** absent rather than pending replacement, because Phase 1C no longer has a paid-API path to restore it to. The other six protected secrets remain. The temporary Supabase release token was revoked and its temporary file deleted. There is still no successful live Phase 1C result, factory branch, or draft PR. Phase 1E execution, Phase 2A provider execution, bot-provider execution, Phase 1D execution, and Phase 1C Codex execution remain **Not Connected**.**

**Correction, 2026-08-15 (master loop):** two long-standing claims in this file are disproven by live evidence and superseded where they conflict with the following.

1. **The Phase 1C worker is LIVE, not "Not Connected pending credential".** Scheduled Actions run `31894356952` (16:01Z) passed every step: `SOFTWAREFACTORY_CODEX_AUTH_JSON` is present in the step environment (masked), and the worker logs "Codex authenticates with the owner's ChatGPT subscription. No per-token API billing is possible." then "SoftwareFactory Codex worker github-actions-31894356952-1 is ready." It registers, polls, and exits idle because no command is queued. The zero-token architecture is running in production, not merely merged. What remains for a live 1C result is one GREEN command submitted through `/solutions/bot-manager`.
2. **The hosted migration ledger is ahead of the documented `20260813001400` position.** The owner's SQL Editor attempt to insert ledger version `20260813001500` failed with `duplicate key value violates unique constraint "schema_migrations_pkey"` — that version is already applied on hosted. The Supabase GitHub integration (the "Supabase Preview" check on PRs, plus `supabase/config.toml` in-tree) is the probable applier on merge to `main`. The exact hosted position is unknown from any agent environment; the owner query in `todo.md` → External Blockers resolves it. Until then, every claim below about "unhosted" migrations after `20260813001400` is an upper bound, not a fact.

**Correction, 2026-08-16 (live production evidence):** the integration-as-applier claim above holds only up to a point. Migrations through `20260816000300` are provably applied on hosted (the broker connect flow works live), but `20260816000400`/`20260816000500` from PR #142 (merged 16:26Z) are provably NOT applied: production Remove returns PostgREST `PGRST202` (function `remove_ai_account` unknown) at 16:36Z and again at 16:51Z, and worker run `31958640122` printed an empty session projection 400ms before claiming a real session — the projection RPC errored, meaning `inspect_ai_auth_sessions` is missing too. **The Supabase GitHub integration cannot be relied on to apply migrations on merge.** The sanctioned applier is `.github/workflows/apply-hosted-migrations.yml`, which now also works with `SUPABASE_DB_PASSWORD` alone (the live `SUPABASE_ACCESS_TOKEN` secret is malformed — not `sbp_…`-shaped — per apply runs `31957275938`/`31959913171`).

**Correction, 2026-08-18 (the hosted ledger, measured end to end):** every
count above and below this line that describes the hosted position is
superseded. Probe run `32103778884` (`scope=probe`, read-only) printed the full
local-vs-remote ledger, and the shape it printed is one no earlier statement
allowed for: **the hosted ledger is not a contiguous prefix of the local
files.** It is missing nineteen versions in the middle —
`20260814002500`–`002600`, `20260815000200`–`000600`, `20260815000800`–`001600`,
`20260816000100`–`000300` — while carrying every row above them, including the
entire `20260817` range. So sentences of the form "the ledger ends at X,
everything after X is outstanding" are not merely out of date; the model behind
them is wrong, and every apply decision taken from one has been wrong.

Three consequences worth stating plainly:

1. `20260817000700_bot_assignment_configuration` **is applied on production**.
   The Assign Bots wizard's configuration columns and `assign_bots_to_project`
   exist there. This file, `todo.md` and the runbook previously said the
   opposite.
2. `20260816000100`–`000300` are ledger-absent, yet the 2026-08-16 correction
   above records the broker connect flow working live against production. Both
   observations stand: the DDL is live and the history row is not. The same run
   confirms it structurally — 19 of 19 probed objects present, including
   `scheduling_decisions` and `projects.engineering_priority`, both owned by
   `20260815000200`, which has no ledger row.
3. Part of the remaining gap is therefore **bookkeeping over DDL that already
   ran**, where the correct action is `migration repair --status applied`, not
   re-running the file. `AI/HOSTED_APPLY_RUNBOOK.md` carries the nineteen-row
   table, the marker object that settles each one, and the procedure.

No mutating scope was run. `AGENTS.md` puts RED actions behind explicit owner
approval in Phase 1 and the runbook requires a fresh exact approval per apply,
so the repair-versus-apply decision is written down for the owner rather than
taken.

**Superseded 2026-08-16 19:47Z — the live GitHub path changed.** The prior Phase 1B identifiers (candidate App `4582606` installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, project `b1f23696-437e-4d89-b55f-d7a949980e8f`, primary rollback installation `153445938`) are historical: they were bound to a workspace the owner's current login cannot reach, which surfaced as an empty Connections list plus the cross-tenant refusal on every reconnect. The owner uninstalled the primary GitHub App and reconnected fresh: the live path is now a new installation `#154236235` (primary App, repository access Selected → exactly `surgeservicesllc/SoftwareFactory`), bound to the owner's live workspace — owner-verified Connected with the repository listed at 19:47Z. The candidate App "Surge SoftwareFactory Next" remains installed on GitHub with its stale binding (inert; optional cleanup). GitHub Support ticket `#4660724` about the old primary installation's webhook defect is moot for the live path.

**Correction, 2026-08-16 (owner screenshot, 21:29Z):** on the `softwarefactory-tan.vercel.app` alias the Connections page showed "GitHub installation state is expired or does not match this session. (github_state_invalid)" **and** the "Connect GitHub to begin" empty state — the connected path above was not visible there. Root causes found in code: (a) the install state cookie and the Supabase session are host-scoped while the deployment answers on several hostnames, so an install leg that crossed between the canonical domain and an alias could never validate its state; (b) the failure notice rides in query parameters nothing cleared, so one old failure re-rendered on every reload as if current; (c) the ten-minute state lifetime was too short for a real organization install; and (d) the empty list is truthful only per organization — the browser callback is the sole path that creates `connections` rows (webhooks only update known installations), so a callback that dies at state validation leaves GitHub installed but the database empty. Fix (ADR-074): launch and callback now converge on the configured callback host before touching cookies, verification failures name their real cause, the lifetime is 30 minutes, and the console strips the one-shot notice parameters after reading them. Recovery for a GitHub-installed/database-empty skew is clicking Connect GitHub again — GitHub re-issues the callback for the existing installation and the persist step adopts it.

Phase 1B is scored item by item in `AI/PHASE_1B_COMPLETION.md`: **18 PASS, 2 PARTIAL, 0 FAIL — 90%**. Merge `c325dbb` closed the adverse-lifecycle gap and fixed three real truthfulness defects:

- GitHub lifecycle refusals raised by the RPCs were collapsing into a generic `500`. A stale disconnect, a resync of a terminally deleted installation, and a cross-organization installation binding now return `409`/`409`/`403` with their real reasons through the one client-safe SQLSTATE table in `lib/server/http.ts`. Unrecognized codes still return an opaque `500`.
- `mark_github_connection_lost`, untouched since migration `004` and never covered, left `suspended_at` set when moving an installation to `error`, so surfaces reported a suspension after the real evidence was a revocation. Migration `20260814001100` clears it and preserves the discarded state as activity evidence.
- The same function aborted on a terminally deleted installation, and both callers swallow that, so a real discovery was recorded nowhere. It now records the loss and leaves the terminal row untouched.
- `tests/integration/github-lifecycle-matrix.test.ts` proves access loss at the trusted write boundary by attempting a real change reservation after each transition, across two independent installations in one tenant plus a third in a second tenant: repository remove/re-add, archive/unarchive, repository deletion with a stale resurrection attempt, installation suspend, out-of-order unsuspend, valid unsuspend, server-discovered revocation, a late discovery against an already-terminal id, terminal deletion, owner disconnect, and reconnect/resync.

What remains for Phase 1B is not engineering. Items 2 and 20 need one live second GitHub account/organization installation plus one deliberate live adverse-event pass on that throwaway installation; exact pages, fields, and verification are under OWNER ACTION REQUIRED in `AI/PHASE_1B_COMPLETION.md`.

## Phase 2E - portfolio resource optimization (2026-08-15, branch `claude/softwarefactory-phase-1e-ops-mjdiiq`)

Scored item by item in `AI/PHASE_2E_COMPLETION.md`: **33 PASS, 2 PARTIAL, 0 FAIL, 1 BLOCKED - 92%**.

The factory now schedules across projects rather than one project at a time.
`claim_phase1c_run` was already a durable, lease-based, dependency-aware scheduler; what it
lacked was any relationship *between* projects. Six migrations (`20260815000100`-`20260815000600`)
add the portfolio state and the arbitration over it, inside the existing claim path rather than
beside it:

- P0-P3 project priority, strategic focus, an engineering pause, and per-project run ceilings,
  each set by an owner-only function that writes an activity event.
- Ceilings at four levels - worker, project, provider account or single connection, and
  portfolio - plus a reserve inside the portfolio ceiling that only effective-P0 work may take.
  Preemption is that subtraction: nothing is ever cancelled to make room.
- Aging that promotes queued work one tier per fairness interval, floored at P1, so nothing
  starves and nothing ages into the emergency reserve.
- Circuit-breaker health consulted at selection, with a cooldown that admits exactly one trial.
- `scheduling_decisions`, append-only: every assignment with its project, task, agent, provider,
  connection and reason, and every ready-but-withheld item with the ceiling that held it.
- Three browser projections behind `/solutions/portfolio`: the queue in scheduler order with a
  reason per item, portfolio capacity, and per-project scheduling state.

The graph engine now *requests* capacity (`RunnerDependencies.requestCapacity`) instead of taking
its concurrency from its own budget, and a zero grant ends a run `CAPACITY_WITHHELD` rather than
`STALLED`.

Two defects were fixed that were not missing features. Logical agents were one per role per
*organization*, and the scheduler correctly refuses a second concurrent run for one agent, so two
projects doing the same kind of work serialised however much capacity existed - every other 2E
control would have been enforced on a factory that still ran one project at a time. And the
portfolio console counted status values none of the relevant enums can hold (`planning`,
`blocked`, `ready`, `acknowledged`, `mitigating`), so every project reported zero open incidents
however many were open, and queued tasks were not counted at all.

Verification: 2360 unit/integration tests pass, 132 Playwright checks pass across desktop, tablet
and mobile with axe, lint and typecheck are clean, and the production build succeeds. The five
required canaries all pass against two competing projects, asserting on what a worker actually
claimed. What they do not cover: PGlite is a single connection, so every claim is sequential -
they prove ordering, ceilings, release and recovery, not behaviour under simultaneous contention,
which rests on the unchanged `for update ... skip locked`.

Still open: goal 9 names Phase 2D, which does not exist in this repository; goal 17 asks the 1C
agent-level exclusion and the 2B lock tables to become one mechanism; goal 35 needs the hosted
apply, now 29 migrations behind (`AI/HOSTED_APPLY_RUNBOOK.md`).

## Published Phase 2A provider layer

- Main contains the common `ProviderAdapter` contract plus official Anthropic and OpenAI adapters, server-only configuration, health/model discovery, structured artifacts, usage accounting, deterministic routing, controlled one-attempt fallback, and independent-review rules.
- Authenticated APIs cover provider status, model discovery/configuration, the owner execution switch, agent assignment, routing preview, and advisory run creation. The organization execution switch is also explicit consent for outbound health/model probes: while it is OFF, status returns a local **Disabled** snapshot without calling a provider; live discovery is owner/admin-only and returns a disabled error without a provider call. Configured catalogue reads remain tenant-scoped and local. Phase 2A runs return analysis artifacts only; they cannot write a repository, approve/merge a pull request, deploy, roll back, or alter Phase 1C/1D controls.
- Migration `130001` adds provider model configurations, immutable routing decisions, append-only run events, provider run metadata, owner/admin RPC boundaries, and an organization execution flag defaulting OFF. Its schema effect and reconciled ledger row are present on hosted Supabase. Advisory provider execution remains OFF and lacks successful live-call evidence, so the published routes remain **Not Connected**.
- **A real Claude execution is now verified, at zero API cost.** `lib/providers/claude-cli-transport.ts` reaches Claude through the Claude Code CLI on the owner's subscription, and `tests/integration/claude-live-canary.test.ts` proves it end to end: the repository's own prompts, a real nine-turn execution that read real files, and an artifact validated by the repository's own `parseProviderResult`. It is a *transport* behind the existing `AnthropicProviderAdapter`, not a second provider — same id, capabilities, run registry and structured result. `AI/PHASE_2A_COMPLETION.md` scores all 25 goals: **20 PASS, 3 PARTIAL, 2 BLOCKED_BY_1C — 88%**.
- The canary earned its place on its first run by failing. Claude answered in a schema it invented, because the shared system prompt says "matching the required schema" without including the schema — true on the API path, where `output_config` carries it structurally, false on a CLI transport that carries nothing out of band. The schema now travels in `outputFormat` and the answer is read from `structured_output`.
- **What is still not proven is the credential wiring, not the execution.** The transport builds its child environment from an allowlist rather than inheriting `process.env`, so a machine that is itself signed in to Claude cannot lend its credentials to a run — this repository's development container is such a machine. No `SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN` is configured, so the canary exercises the prompt and schema contract but not the credential path. One owner action closes it and costs nothing; `AI/PHASE_2A_COMPLETION.md` names the exact command, variable and verification.
- `ANTHROPIC_API_KEY` is required by nothing. Set it and the subscription path refuses to start rather than silently billing — per-token billing is an explicit opt-in, never a fallback, matching the rule `lib/worker/auth.ts` set for Codex.
- OpenAI remains **Not Connected** for the advisory Phase 2A path; no OpenAI key or successful live OpenAI request is verified. Advisory provider execution stays OFF until the owner enables it.

## Published Phase 1C implementation

- Next.js 16.3 App Router, React 19.2, TypeScript strict mode, Tailwind CSS 4, server-first Auth/tenant/provider boundaries, and caller-session Supabase RLS reads.
- The global header, once signed in, carries the owner's 2026-08-19 set (ADR-112): `AI Factory` → `/solutions`, `Job Seeker` → `/job-seeker`, and `Admin` → `/solutions/admin` for a confirmed super administrator only, beside the super-admin badge, the account address, Open Console and Sign out. Visibility derives from the Supabase-verified viewer (`auth.getUser()`), and the current entry is resolved by longest-matching href so nested entries cannot both read as current. Signed out the header is unchanged.
- The whole control plane is served under `/solutions` from `app/(portal)/`; the former `app/(console)/` group is gone. Twelve routes build there, each rendering the marketing global navigation above the console shell. Permanent redirects cover every former top-level path and its subpaths, and the GitHub return-path allowlist moved with them. `/solutions` is `noindex`, disallowed in `robots.txt`, and absent from the sitemap, which now lists marketing routes only. Each console page carries its own title so a tab no longer reads as the public home page.
- The console sidebar column begins with the menu (ADR-090): it carries no wordmark, removed on owner instruction on 2026-08-17. The rail is chosen by viewport width (1024-1279 rails), and from 1280 a retract control at the foot of the column lets a person choose (ADR-091) — offered only on devices with a hovering fine pointer, which is how "Windows or macOS" is asked reliably, with the choice stored under `softwarefactory:sidebar-compact`. It follows the owner's 2026-08-17 design (ADR-077): top-level destinations — Overview, AI Factory, Projects, Pipelines, Bots, Job Seeker, Runs, Operations, Reports, Integrations, Secrets, Settings, Advanced — with collapsible subpage groups that open expanded. The `Watch` group was removed on owner instruction (2026-08-19) and neither page it held was stranded: Operations was promoted to a destination of its own above Reports, and Activity is still reached from Bots as `Bot Activity`, the same `/solutions/activity` page, plus a Quick actions section (New Project, Give a bot work, Import Repository — a fourth, View Documentation, linked out to the marketing `/resources` pages and was removed by owner request on 2026-08-17). Every entry links a real page or page section; the design's subpages with no backing capability (Secrets, per-user project lists, Members/Teams/Permissions/Billing, pipeline Active/Schedules/Archived) are deliberately absent. Projects gained an Archived view (`/solutions/projects?filter=archived`, opt-in `?status=archived` on `GET /api/projects`), with unarchive pointed at the portfolio page's owner controls. `/solutions/myprojects` (owner design, 2026-08-17) renders the same live project records as collapsible rows — first row open, chevron per project — expanding into the exported `ProjectInspector`, with Import Repository / New Project page actions landing on the existing controls. `/solutions/projects` is the "All Projects" dashboard (same design set): live stat cards, All Projects / My Projects / Archived tabs, a paginated projects table with last-run and success-rate columns computed from `/api/runs` (only succeeded/failed carry a verdict) and an Open link to the portfolio detail page, plus a right rail with the by-status breakdown and the `/api/activity` feed; the add-project form stays anchored below. `GET /api/projects` exposes `updatedAt`. `/solutions/bot-usage` (same design set) lists every AI account with its latest recorded usage observation — the shared `AccountUsage` percent bars with provider reset times, derived headroom bands, connected/average-weekly summary cards, and a manager-only Refresh wired to the broker wake — with the design's plan/billing, date-range, and history affordances absent for lack of a backing model. Edit/delete controls follow ADR-078: project name/description edit (`update_project_details`, migration `20260817000100`, `PATCH /api/projects/[projectId]`, dialogs on the table and inspector), archive/unarchive in place with reasons, bot retire on the roster — while runs, activity events, and audit records remain immutable and templates are edited as code. `/solutions/pipelines` (owner pipeline goal, round 1) renders the lifecycle over saved commands — Active (worker-advanced human stages with owner-attention counts), All Pipelines (history with outcomes and durations), Templates (the graph engine's versioned templates, server-compiled topology facts, deep previews on Workflows) — with the audit and round plan tracked in `todo.md`.
- Supabase sign-up/sign-in/magic-link/sign-out/callback/onboarding, organization membership, and active-organization selection.
- GitHub App installation start/callback, short-lived repository-ID-scoped installation tokens, bounded repository reads, signed/idempotent/redacted webhooks, transaction-serialized project linking by stable repository UUID, and an isolated branch + commit + draft-PR-only file-change flow.
- Every interactive GitHub route is bound to the caller's exact active organization. Revoked or insufficient-permission token creation is persisted best-effort as connection loss; rate-limit errors do not falsely revoke the connection.
- Callback browser failures return safely to Connections with bounded error state; JSON callers retain structured no-store errors. GitHub-returned web URLs are restricted to HTTPS `github.com` origins.
- Connections and dashboard states do not hard-code a personal account and show **Not Connected** when live GitHub evidence is absent. The current owner connection shows its real installation ID and repository-selection mode.
- Ordinary file changes require owner/admin authorization, keep one idempotency key for an unchanged retry intent, and can recover an already-created draft PR after an ambiguous database-completion response. Protected paths fail closed unless an active owner supplies the exact short-lived RED approval phrase, rationale, and rollback plan; generic non-placeholder secret assignments and provider-token patterns remain blocked, and the only provider outcome remains a draft PR.
- The deployed write boundary requires a strictly validated server-only commit identity before authorization, persistence, token minting, or provider mutation, and sends that same identity as both GitHub author and committer. It has no App-bot fallback and is never browser-, database-, or log-visible. Production and Preview configure the owner-approved identity; live ordinary and protected draft commits verify both fields.
- Change reservations expire after five minutes and may be reclaimed only for the exact original intent before the provider boundary is entered. The exact approval snapshot is bound to the reserved change, and the provider boundary is durably revalidated before the write-scoped installation token is minted; entry permanently prevents lease reclamation.
- Installation and repository webhook transitions are provider-time ordered. Deletion is terminal for an installation ID; repository deletion remains terminal until an explicit newer restore, and restored repositories stay unselected pending access synchronization.
- Provider-authoritative repository rename/default-branch changes propagate by stable repository UUID only to exact connection-linked projects and create redacted immutable activity evidence.
- Agents, commands, tasks, runs, and reports are read through bounded caller-member RPC projections; authenticated browser sessions no longer have direct SELECT on those sensitive base tables. Command creation also enforces same-origin requests.
- Authenticated direct reads of raw Activity and webhook-delivery rows are revoked. Activity uses a caller-member, row-limited RPC and returns only allowlisted, bounded GitHub/SoftwareFactory actor, source, resource, action, status, conclusion, and transition evidence; raw audit metadata and stored webhook subsets remain server-side. Webhook project attribution uses the stable repository UUID.
- Projects selects repositories by stable provider ID and renders live repository sync time, branch protection/SHA, commit author/date, PR author/created/updated time and detail-fetched mergeability, default-branch checks, and per-PR checks fetched against each displayed head SHA.
- Global browser headers include a restrictive CSP, framing/object denial, a narrow Supabase connection allowlist, and a narrow image allowlist; repository Markdown previews do not load external images.
- No direct default-branch write, merge, deployment, rollback, or Claude worker exists. The published manual Codex worker is draft-PR-only and remains **Not Connected** after its first provider-startup failure. The intended Phase 1D control model is execution-inert, but current hosted raw/effective rows have drifted from the older all-OFF/kill-ON baseline described below; no connected/fresh executor was observed, and containment remains a release gate.
- The signed-out dashboard receives a server-verified authentication hint so it skips protected browser fetches; the focused production race regression passes 30/30 repeated runs.
- `POST /api/commands` accepts a connected project, one exact selected project pipeline, bounded command type, prompt, acceptance criteria, requested risk, and stable idempotency key. It resolves the live repository binding and exact base SHA server-side, computes a deterministic risk floor and execution plan, then atomically persists command/task/run plus immutable pipeline/bot routing evidence. The response uses the database's locked risk/model/work-effort snapshot. This request does not dispatch a worker or change autonomy.
- GREEN and YELLOW manual commands may be recorded. RED commands remain persisted as blocked/awaiting approval and are never claimable in Phase 1C; owner approval does not widen this ceiling.
- Provider, model, logical role, budget, workflow, repository IDs, branch, and base SHA are server-selected and independently normalized/revalidated by Phase 1C migrations `130007`-`130011`. Migration `130010` includes acceptance-criteria SQL risk parity and owner-only submission; `130011` adds canonical same-project dependencies plus cumulative turn/token budgets across retries.
- Migration `130010` initializes an idempotent provider-neutral roster of Orchestrator, Product, Architect, Frontend, Backend, Database, QA, Security, Performance, Release, and CEO Reporter for existing and future organizations. Provider/model remain execution metadata on runs, and prior factory role references are rebound without rewriting user-created agents.
- Logical roles include orchestrator, product, architect, frontend, backend, database, QA, security, performance, release, CEO reporter, and custom. The execution record keeps role, provider, model, project, connection, repository, and user identities separate.
- Detail APIs and pages expose bounded tenant projections for agents, backlog tasks, runs, reports, worker status, timelines, artifacts, validations, dependencies, cancellation, and eligible retry without broad browser SELECT on sensitive base tables.
- The dashboard and Bot Manager derive worker truth from a bounded heartbeat projection. A clean one-shot worker started by approved default-branch repository dispatch or schedule records `idle` on exit; its fresh heartbeat is briefly Available/Connected, then becomes stale/**Not Connected** after the bounded threshold. A real heartbeat was observed while the first acceptance attempt was claimed, but the provider failed before repository work and the heartbeat does not establish end-to-end connectivity. Branch-selectable manual workflow dispatch remains absent, and Codex remains **Not Connected**.

## Phase 1E production-operations state

Phase 1E adds a production-operations control plane and synthetic journeys in source and in migrations `028` and `130002`. Their schema effects and reconciled ledger rows are present on hosted Supabase, but no monitor or journey has observed a real production target. Every Phase 1E surface therefore reports **Not Connected** or **Unknown**. Nothing below treats schema presence as live production observation.

- Ten new tables (`production_monitors`, `monitor_observations`, `project_health_snapshots`, `release_freezes`, `deployment_validations`, `rollback_operations`, `production_diagnoses`, `repair_attempts`, `operations_events`, `operations_audit_events`) carry RLS and FORCE RLS with browser SELECT only. Every write goes through an owner- or admin-scoped SECURITY DEFINER workflow, so `service_role` gains **no new table privileges** and the verified `026` ACL matrix is unchanged.
- The only connected monitoring adapter is a bounded HTTPS probe. Vercel deployment status, error-rate and latency telemetry, database liveness, jobs, and integrations are each recorded as **Not Connected** with the exact reason and the condition that would unblock them. A CHECK constraint makes it impossible to enable a monitor whose adapter is not connected.
- Project health is `healthy/degraded/critical/unknown/paused`, derived from connected monitors, open incidents, and failed deployments, with append-only history and a stored reason. A project with no connected monitor resolves to **UNKNOWN**, never HEALTHY.
- Incidents are created automatically from breached failure thresholds, carry SEV1–SEV4, deduplicate by fingerprint into one open incident per project, and escalate severity upward only. SEV1/SEV2 automatically freezes autonomous releases.
- Last Known Good resolves only from a deployment whose own post-deploy validation passed. Rollback eligibility is evaluated fail-closed against `policies/AUTO_ROLLBACK.md` and always records `EXECUTOR_NOT_CONNECTED`; **no rollback is executed and no database or data migration is ever reversed**. A failed rollback cannot be recorded without escalating to SEV1 with owner attention — enforced by a CHECK constraint.
- The Production Investigator is a deterministic rules engine, not a model: it returns cause, cited evidence, subsystem, confidence, recommended action, and risk, and never produces or stores intermediate reasoning.
- Self-healing creates bounded repair work (three attempts, escalation on the third failure). A RED repair or work above the project risk ceiling is refused, so the GREEN/YELLOW/RED policy is not bypassed. Repair work is now **promotable into the ordinary Phase 1C command queue** through `submit_command` with a live base SHA, so a security-shaped repair is forced to RED and owner approval exactly as a person's command would be; before this, `create_repair_attempt` wrote a bare `backlog` task that `claim_phase1c_run` could never select, making repair work unclaimable rather than merely unassigned. Promotion is owner-only, is blocked by the emergency stop but deliberately not by a release freeze, and is proven in `tests/integration/phase1e-repair-promotion.behavior.test.ts`. Execution stays **Not Connected**: the promoted run sits `queued` because no Phase 1C worker is registered and no provider credential exists, and migration `20260813001700` is not hosted.
- Incident resolution is refused while monitors still fail, without a passing same-project validation, without root cause and corrective action, and — for SEV1/SEV2 — without a prevention reference. A successful deployment alone resolves nothing.
- `autonomous_release_allowed` returns false unconditionally and enumerates live blockers; `EXECUTOR_NOT_CONNECTED` is unconditional, so no configuration change can make it return true. Phase 1D interlocks are untouched: the kill switch stays locked ON and every project stays at Autonomous Mode OFF with a GREEN ceiling and all automatic actions OFF.
- Synthetic journeys are stored per project with Basic/Standard/Critical profiles. Step safety is a CHECK constraint, not a convention: a destructive path, an undeclared write, or a safe write with no reversal note cannot be stored at all, and a profile must cover what it promises. Execution stops at the first failing step, and a declared write is recorded as skipped rather than issued — Phase 1E has no authority to mutate a monitored production system.
- Scheduled monitoring is **Not Connected**: checks are owner-triggered because no scheduler identity is authorized, and authorizing one must not widen `service_role`.
- Overall Phase 1E completion is roughly **87%** in this tree (the promotion path is not hosted). The remaining ~13% is execution authority — rollback execution, Codex repair execution, and autonomous deployment — each blocked by a named, tested interlock rather than missing by oversight. `AI/PHASE_1E_IMPLEMENTATION_PLAN.md` carries the per-section breakdown, live integrations, security findings, limitations, and Phase 2A readiness.

## Phase 2C resource-manager state

AgentOS blocks A through G exist in source and in migrations `20260814000300`-`20260814001400`. Block G adds configuration as code: `agentos_export_project_config` and `agentos_apply_project_config` carry `agentos.yml` push and pull, `scripts/agentos.mts` is the CLI, and the round trip the spec names as acceptance is proven both through the file format and through the real migrated schema. Applying a configuration requires owner or admin; deleting is off by default and needs `--prune --yes`. **Every one of those ten migrations is unhosted**, no runner is connected, and every AgentOS surface reports **Not Connected**. Nothing in this workstream executes.

Phase 2C is the intelligence layer that picks agent, provider, and model per unit of work. Its scoring core and its memory exist in source and in migration `20260814000210`. That migration **is now hosted**: it had been applied only partially — far enough to create `resource_breakers`, which is why re-running it failed with `42P07` rather than doing nothing — and `scripts/repair-20260814000210.sql` completed it idempotently before the ledger was reconciled. The ledger now carries 65 rows covering all 64 migration files, with `20260814002300` as the high-water mark, and `scripts/hosted-schema-audit.mts` reports 0 outstanding and 0 indeterminate. No routing decision has ever been recorded against real work, because no provider run has executed.

- The scoring core (`lib/resources/capabilities.ts`, `history.ts`, `breakers.ts`, `manager.ts`) is deterministic-gate-first: work a code path can do never buys inference, eligibility is decided before scoring, and RED/judgement/security/architecture/synthesis work can never be pushed onto an economical model to save cost — an eligibility gate rather than a weight, so no objective can outvote it. An owner override selects among eligible workers and can never make an ineligible one eligible.
- Observed history refuses to compute below a minimum sample count, reports sub-population rates as `null` rather than `0`, marks each prediction evidenced or not, and does not score regret against a guess. Nothing here invents a metric.
- Migration `20260814000210` adds three tables — `resource_breakers` (mutable state), `resource_breaker_events` and `resource_assignments` (append-only evidence) — all with RLS and FORCE RLS, browser SELECT only, and **no new `service_role` table privileges**. Writes go through SECURITY DEFINER functions.
- Storing breaker state fixed a real defect rather than adding storage: a breaker folded in one request's memory begins closed on every request, so three consecutive outages spread across three requests never reached a threshold of three and the breaker could never fire. The behavior tests drive faults through separate calls for exactly that reason.
- Fault thresholds are passed into the database from `lib/resources/breakers.ts` rather than copied into SQL, so the rule deciding when a provider is cut off has one home.
- A predicted success rate is stored only when it was evidenced — enforced in `lib/resources/store.ts` and again by a CHECK constraint, so a null returned below the sample threshold cannot be laundered into a number that later outcomes are measured against.
- `/solutions/resources` reads `GET /api/resources/overview` and shows breakers with fault explanation and cooldown, breaker transitions, and per-decision candidate evidence with eligibility and named rejection codes. Almost every panel is legitimately empty, so each states which kind of empty it is: "nothing has failed here" is not "proven healthy", and an unevidenced prediction reads "No recorded history" rather than 0%. The Execution card shows `—` while loading rather than defaulting to **Not Connected**, because that is a state read from the server and not a fallback.
- The console page lives at `/solutions/resources` with **no** bare-path redirect, because `/resources` is a live public marketing page. A redirect list built by walking the console tree would have sent that public URL to the console with a permanent 308; `tests/integration/console-routing.contract.test.ts` now asserts the collision in both directions.
- Candidates now come from **real tenant rows** rather than code constants: `agents` become agent profiles and `provider_model_configurations` become model profiles (`lib/resources/candidates.ts`). Migration `20260814000220` adds owner-declared `strength_tier` and `context_limit_tokens` to the Phase 2A catalogue additively, touching no constraint that the pending `20260813001500` redefines.
- **An undeclared model property is never a permissive default.** Null strength resolves to the weakest tier, so the model cannot pass the strong-model eligibility gate; null context resolves to zero, so nothing can be shown to fit it. Only six of Phase 2A's eight capability names map onto Phase 2C's vocabulary — `structured_output` is an output format rather than a kind of work, and `reporting` is deliberately not mapped to `synthesis`, which gates work onto strong models.
- `POST /api/resources/route` routes one unit of work against those rows plus stored breaker state and records the decision. It **selects and starts nothing**: no claim, no token, no provider call, asserted by `tests/integration/phase2c-routing.contract.test.ts`. An unconfigured organization returns `NO_CANDIDATES_CONFIGURED` rather than a routing failure, and a decision that cannot be stored is still returned marked unrecorded, so a persistence problem cannot masquerade as a routing one.
- **Concurrency is now bounded rather than specified.** `lib/resources/capacity.ts` limits concurrent runs per worker, per provider, and per project, and every refusal names *which* limit refused — told "the project is full" when one worker is the real constraint, an operator raises the wrong number. It is applied in `assignWorker` as an eligibility gate beside capability and risk, never as a score weight, so cost or preference cannot outvote it. Reservations carry an expiry and expired ones stop counting, so a worker that dies does not strand its slot until someone notices.
- **The scheduler and the manager are joined.** `lib/resources/dispatch.ts` routes a whole tick of startable nodes: `lib/graph/scheduler.ts` says which nodes may start, `assignWorker` says who runs each. It is not a loop over the single-node decision — reservations are threaded forward through the batch, because routing every node against the reservations live at the *start* of the tick lets two nodes released together take the same last slot. Dispatch order is decided (risk, then stated priority, then nodeId) rather than inherited from the scheduler's emission order, since when capacity binds the order decides who waits. A node held back by a full fleet is `DEFERRED` and re-offered; a node no worker can ever satisfy is `UNROUTABLE` and is not, so the scheduler cannot spin on impossible work.
- **Rate is accounted separately from concurrency, because they are different questions.** `lib/resources/rate-limits.ts` counts requests and tokens over a sliding per-provider window and gates `assignWorker` alongside capability and capacity. Concurrency asks whether a slot is free; rate asks whether too much has happened recently — six concurrent slots filled by two-second calls is 180 requests a minute while never showing more than six in flight, so one limit does not imply the other. A rate refusal carries `retryAfterMs` and a capacity refusal deliberately does not: a window clears at a computable time, whereas nobody can say when another run will finish. Token budgets are checked against a caller-supplied estimate, and usage marks when it includes estimates rather than measurements — the same refusal to launder a prediction into a number that the history module already applies to success rates.
- **Not Connected / no data:** the manager is not called from the Phase 1C claim path — that path is hosted and live, nothing executes regardless, so changing it now buys no behavior and risks conflicting with concurrent agents. Capacity and dispatch are **pure functions with no persistence**: the caller owns storing reservations, so a process restart currently forgets what was held. `lib/resources/reservation-store.ts` and migration `20260816001600` exist to close exactly that, and neither is reachable from anything that executes: the store is imported only by its own tests, and its table is one of the four the hosted audit reports as not visible. The ordering matters — wiring a fail-closed admission gate against a table that is not there would refuse every claim and stop the one execution lane that works today, so the migration is applied first and the wiring follows. That is a real limit, not a rounding error, and it is why the plan records the central scheduler as complete *in-process* rather than durable. Rate accounting shares that limit: the window lives with the caller, so a restart forgets it. The budget ladder is still specified and not simulated, because it needs a worker pool that executes. `AI/PHASE_2C_IMPLEMENTATION_PLAN.md` carries the audit.

## Durable worker implementation

- `@openai/codex-sdk` is pinned at `0.147.0`; the default configured model is `gpt-5.3-codex`.
- `scripts/worker.mts` supports persistent polling or one-shot `--once` execution. `.github/workflows/codex-worker.yml` uses the one-shot form only on `repository_dispatch` or a five-minute recovery schedule; branch-selectable manual workflow dispatch is intentionally absent from the secret-bearing workflow.
- The event payload contains only an opaque command UUID. The worker still must claim one eligible run through a service-role-only RPC and maintain a short lease/heartbeat.
- Repository access uses a short-lived GitHub App installation token scoped to one immutable repository ID. The workspace verifies the planned default-branch SHA before creating a `factory/<run-id>-<slug>` branch.
- Codex runs with workspace-write sandboxing, approval policy `never`, workspace network disabled, web search disabled, a controlled process environment, an isolated `CODEX_HOME`, bounded turns/tokens/time, and redacted event projection.
- Dependency bootstrap runs `npm ci --ignore-scripts` in a restricted pinned Node container with bridge networking. Deterministic `git diff --check`, lint, typecheck, tests, and build run in the same pinned image with `--network none`, a read-only root, dropped capabilities, no-new-privileges, PID/CPU/memory limits, and bounded output.
- Publication fails closed for forbidden paths, symlinks, binary changes, likely secrets, more than 200 changed files, a file over 2 MiB, or more than 10 MiB total changed content. Protected paths require an exact unexpired approval containing every protected path, while RED work is still categorically non-executable.
- `SOFTWAREFACTORY_REQUIRED_CHECKS` is mandatory for an enabled worker. The reviewed workflow fixes it to `Lint, typecheck, test, and build|Browser and accessibility tests 1/3|Browser and accessibility tests 2/3|Browser and accessibility tests 3/3`. CI passes only after the complete check set is returned, every observed check is terminal and acceptable, all four required names are present with exact `success`, the same passing set is observed twice, and the draft PR still has the exact number/base/head.
- The worker commits and pushes only the isolated branch, creates or recovers an open draft pull request, observes checks for the exact head SHA, performs at most one configured repair attempt, and never merges or deploys.
- Run events, artifacts, validations, check summaries, changed paths, cumulative usage, cancellation, retryability, terminal results, and activity events are bounded and durable. New evidence tables are append-only. Migration `130010` makes artifact replay exact, persists a coherent draft-PR projection, permits retry only from no-provider/branch-only or fully coherent branch/commit/optional-draft evidence, revalidates remote recovery state, converts exhausted stale leases/cancellation to terminal evidence, and publishes bounded structured reports. Migration `130011` ensures retries consume, rather than reset, the original total turn/input/output budgets.
- The first live attempt proved the failure boundary: command `0c4d0ca8-1867-4d00-80cf-476401491a17` produced run `f4594556-6f72-4763-a480-6993939e3651`; worker Actions run `31746057998` claimed attempt 1 of 2, recorded a provider thread identifier, then failed on Codex startup before any changed file or GitHub publication. The row is durably failed and mechanically retryable, but its immutable planned base is older than current `main`; retry would correctly fail `stale_base_sha`, so it must remain historical evidence.
- An authenticated production owner session now proves real Bot Manager, Runs/detail, Backlog/detail, all-eleven-role Agents/detail, Reports/detail, and Connections reads against the hosted caller-bound projections. The live failure is rendered truthfully with provider/model, old base SHA, attempt, timeline, validation, and explicit absence of changed-file/commit/PR/CI evidence. A separate anonymous session exposes no tenant records, and direct anonymous calls to twelve hosted Phase 1C target/read RPCs return `401`/`42501`. No unrelated authenticated tenant currently exists in hosted membership, so that live isolation case and mutation-shaped denial probes remain pending; local integration tests cover them but are not substituted for live evidence.
- The recovery patch published on `main` at `bc95b9e3a5952864bd26da778a052f37400ea747` verifies the exact configured model with a non-billable OpenAI model lookup and verifies the pinned Codex CLI before every durable claim. The distinct `softwarefactory_phase1c_preflight` repository-dispatch event additionally executes one bounded, non-stored OpenAI response while skipping Docker preload and claim. The adapter preserves a redacted structured terminal provider error when the CLI later exits with a generic trailer. Diagnostic run `31748582858` exercised this no-claim path: the exact-model lookup passed and the response probe returned only the safe code `credit_balance_exhausted`.

## Database state

- Hosted Supabase project: `qpuofpmagrmyamahqwxw` (`softwarefactory`). Its canonical ledger is reconciled through `20260813001400`; schema-present `028`/`130001`-`130005` were history-repaired only and were not rerun.
- Hosted migration `20260813000600_phase1d_autonomy_controls.sql` adds only the execution-inert Phase 1D decision schema and keeps every automatic action constrained OFF.
- Hosted migration `20260813000700_provider_phase1c_compatibility.sql` carries additive/narrowing compatibility over the immutable hosted-source provider layer.
- Hosted migration `20260813000800_phase1c_enums.sql` adds `architect`/`performance` roles and Phase 1C activity values; PostgreSQL committed them before dependent use.
- Hosted migration `20260813000900_phase1c_codex_execution.sql` adds durable command/task/run orchestration, workers, evidence, RLS/FORCE RLS, safe projections, service-role lease/result RPCs, cancellation/retry, authoritative planning, and RED blocks.
- Hosted migration `20260813001000_logical_agent_roster.sql` adds the provider-neutral eleven-role roster, owner/risk/ACL hardening, coherent recovery/reporting, agent serialization, and bounded projections.
- Hosted migration `20260813001100_phase1c_task_dependencies.sql` atomically persists canonical same-project dependencies, derives non-empty criteria when omitted, validates idempotent replay, and enforces cumulative turns/input/output budgets across retries.
- Forward migrations `130006`-`130011` are hosted. `130012` repairs invalid bot `NULLIF` qualification without widening signatures/security/search paths/ACLs; `130013` resolves the remaining Phase 1C function-lint findings; `130014` exposes emergency-stop state in the autonomy resolver. All were applied forward-only under the exact owner approvals, with no reset, down-migration, or `130004` replay.
- Local migration `20260813001500_expose_bounded_run_routing.sql` is frozen at 13,121 bytes with SHA-256 `3E1BEA8F5DAB912D5D7D6251E4503C319816B27EF2465DB5E8612E26A3DD1A13`. It widens `provider_agent_assignments_model_check` and `agent_runs_model_check` from 120 to 128 characters to match the immutable `130001` provider catalogue/API contract while retaining the assignment regex and all other semantics. It adds `provider_model_configurations_text_not_secret`, `provider_routing_decisions_policy_version_not_secret`, `provider_agent_assignments_model_not_secret`, and `provider_routing_decisions_selected_model_not_secret`, using immutable `text_has_likely_secret(...)` checks to reject credential-shaped catalogue model/display-name, assignment model, and routing policy-version/selected-model text in browser-readable rows. It also replaces the bounded member run-detail projection to expose allowlisted routing source/policy/reasons/candidates, preserves the function signature and reviewed execution boundary, lets commandless Phase 2A runs resolve, revokes authenticated raw SELECT on `provider_routing_decisions` and `provider_run_events`, and retains tenant-scoped authenticated SELECT on `provider_model_configurations`. It is **unhosted** and requires a fresh exact RED approval plus post-apply exact six-constraint-definition/128-character assignment-run-project regression, valid scalar and negative credential-shaped-text regressions through reviewed paths, ledger, table/function ACL, signature, RLS/direct-denial, bounded runtime, lint, and health checks. Until then the application treats a missing routing field as legacy evidence absence without inferring reasons/scores and fails closed if a pre-migration catalogue row contains credential-shaped scalar text.

## Provider and release truth

| Capability | Status | Evidence |
| --- | --- | --- |
| Hosted Supabase | `20260821000300` hosted; `20260821000400` unhosted | Current linked lint has 5 errors/10 findings. Raw controls include one organization with `autonomous_mode = true`, one with `autonomy_kill_switch_active = false`, and two projects effective-kill-off; no connected/fresh worker was observed. Do not reuse the older clean/all-off evidence as current truth. |
| Primary GitHub App | Connected rollback path; webhook impaired | App `4573846` and installation `153445938` remain active for rollback; Support ticket [#4660724](https://support.github.com/ticket/personal/0/4660724) remains open. |
| Candidate GitHub App/project | Connected for the owner repository path | App `4582606`, installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, and project `b1f23696-437e-4d89-b55f-d7a949980e8f` passed callback, sync, signed webhook, handoff, reads, and draft-only write acceptance. |
| Supabase Auth owner | Confirmed and authenticated | `surgeservicesllc@gmail.com` is the only real user/email authorized for live acceptance. |
| Vercel UI hosting | Prior recovery baseline verified; current update pending | The prior verified production baseline before this update was `0c662a24393f682073e6002c5aff9339292226d8`; deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7` was READY and its Vercel status passed. |
| Phase 1E monitoring (HTTPS probe) | Published/hosted control plane; **no observed target** | Covers uptime, latency, critical routes, auth, project-reported database/job/integration endpoints, and synthetic journeys. Migrations `028`/`130002` are hosted, but no owner-authorized production target has been monitored. |
| Synthetic journeys | Published source; **no observed target** | Stored per project with database-enforced step safety. Read steps execute; declared writes are recorded, never issued. |
| Phase 1E telemetry/scheduler | **Not Connected** | Vercel/error/latency/database/job/integration adapters and a scheduler identity are absent. |
| Phase 1E rollback/repair execution | **Not Connected** | Rollback records `EXECUTOR_NOT_CONNECTED`. Repair work can be promoted into the ordinary command queue and stops at `queued`; no worker claims it and migration `20260813001700` is unhosted. Nothing executes. |
| Phase 2A provider layer | Published source and hosted schema; **Not Connected** | `130001` is ledger-reconciled; advisory execution remains OFF and no successful live advisory run exists. |
| Anthropic/Claude advisory provider | **Not Connected** | Adapter/source exists; hosted schema, credential, enabled switch, health, and live-run evidence do not. |
| Codex worker (zero-token) | **Not Connected** | Published worker claimed one real run and produced a transient heartbeat/provider thread, but provider startup failed safely before repository mutation. No-claim diagnostic `31748582858` then identified `credit_balance_exhausted` — the failure that prompted removing the paid dependency entirely. The worker now authenticates Codex with the owner's ChatGPT subscription and cannot consume per-token API credit. Still no factory branch, commit, draft PR, validation, or exact-head CI result: the blocker is the owner-supplied `SOFTWAREFACTORY_CODEX_AUTH_JSON`, not funding. |
| GitHub Actions Phase 1C secrets | Six remain; OpenAI secret permanently absent; subscription credential required; worker **Not Connected** | The user-pasted key is treated as compromised and `SOFTWAREFACTORY_OPENAI_API_KEY` has been removed. The other six protected secrets remain. The OpenAI secret stays absent permanently; Phase 1C authenticates Codex with the owner's ChatGPT subscription and has no paid-API path. The activation variable is absent/OFF. |
| Auto approve/merge/deploy/rollback | OFF | No autonomous production authority or executor exists. |

## Identity and secret boundary

- The only live SoftwareFactory owner is `surgeservicesllc@gmail.com`.
- All repository commits must use `surgeservicesllc <surgeservicesllc@gmail.com>` for author and committer. The workflow contains this public identity only; it contains no secret values.
- GitHub Actions forbids secret names beginning with `GITHUB_`. The workflow expects protected repository secrets named `SOFTWAREFACTORY_SUPABASE_URL`, `SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY`, `SOFTWAREFACTORY_CODEX_AUTH_JSON`, `SOFTWAREFACTORY_GITHUB_APP_ID`, `SOFTWAREFACTORY_GITHUB_APP_PRIVATE_KEY_BASE64`, `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_ID`, and `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64`, mapping the final four to runtime `GITHUB_*` variables only inside the worker step.
- `SOFTWAREFACTORY_OPENAI_API_KEY` is absent and must stay absent. Do not restore that value and do not add a replacement: Phase 1C has no paid-API path. The worker requires `SOFTWAREFACTORY_CODEX_AUTH_JSON` instead — the contents of `~/.codex/auth.json` from a subscription `codex login`. Supplying an API key without an explicit `SOFTWAREFACTORY_CODEX_AUTH_MODE=api_key` is a refused configuration, not a fallback.
- The non-secret Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` is a final fail-closed gate. Unless it equals literal `true`, repository-dispatch and schedule triggers skip the job. It is currently absent/OFF.
- `SOFTWAREFACTORY_REQUIRED_CHECKS` is a non-secret runtime policy value, not an activation switch. It must contain 1-20 unique pipe-delimited exact GitHub check names (maximum 300 characters each) and is fixed in the reviewed workflow to the four CI job names above. Missing/invalid/mismatched required checks stop or time out the worker; they never degrade to "all available checks."
- Secret values never belong in source, Supabase rows, prompts, model output, browser payloads, logs, fixtures, reports, screenshots, or repository artifacts.

## Current verification evidence

- The prior verified production baseline before this update passed supported Node `24.19.0` lint/typecheck, 117 files/1,282 tests, a production build with 74 page/route entries, and Playwright/axe 117/117. Commit `0c662a24393f682073e6002c5aff9339292226d8` passed CI run `31749352644`, and matching Vercel deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7` was READY.
- Hosted reconciliation through `130014` is complete. The frozen current-update candidate passes local Node `24.19.0` lint/typecheck, 118 Vitest files/1,311 tests, coverage 76.70/71.47/74.04/78.11, a 74/74-route build, Playwright/axe 117/117, production dependency audit 0, and clean diff-check. This is local final-candidate evidence only; publication commit, CI, matching Vercel deployment, and hosted `130015` application evidence remain pending.
- First live acceptance attempt: command `0c4d0ca8-1867-4d00-80cf-476401491a17`, durable run `f4594556-6f72-4763-a480-6993939e3651`, and Actions run `31746057998`. It failed safely on provider startup after claim attempt 1 of 2, before changed files, commit, branch push, draft PR, validation, or required-check observation. Although the row remains mechanically retryable, its immutable base SHA predates current `main`, so it must remain historical evidence and must not consume attempt 2. Activation was returned to absent/OFF.
- Provider-only diagnostic run `31748582858` used the published distinct no-claim event. The exact-model GET passed; the bounded non-stored Responses execution returned the safe machine-readable code `credit_balance_exhausted`. Docker preload and durable claim were skipped, activation returned to absent/OFF, and the stale failed run was not touched.
- The recovery preflight/error-preservation patch is published. There is still no successful live provider execution, factory branch, Phase 1C draft PR, or stable exact-head required-check result. The exact blocker is no longer funding. Phase 1C was re-architected to zero-token execution: the paid dependency is removed and the blocker is now the owner-supplied `SOFTWAREFACTORY_CODEX_AUTH_JSON`. Configure it, rerun the no-claim diagnostic, then submit a new safe GREEN command bound to the current base. Do not retry the stale failed run.
- The temporary Supabase release token used for the protected database work was revoked, and its exact temporary file was deleted.

## Phase 1D autonomy-control state

- The control model covers all nine automatic actions — plan, code, test, repair, review, approve, merge, deploy, rollback — at organization and project scope. Migration `010` shipped four at one scope; hosted migration `20260813000600_phase1d_autonomy_controls.sql` adds the remaining five plus organization scope and relaxes nothing.
- Resolution is most-restrictive-wins: an action survives only where both scopes enable it, the ceiling is the lower of the two, and the envelope (kill switch, emergency stop, release freeze, missing executor) forces every action off regardless of either scope. The resolver reports the mode the operator configured rather than rewriting it, so the interface can say "on, but held because X".
- `public.resolved_autonomy_controls` holds the identical rule in the database, is `security invoker` so it cannot cross a tenant boundary, and returns every action OFF while no executor is connected.
- Risk is classified from the actual diff — changed paths plus credential- and destructive-shaped content — rather than from a self-declared factor list. A finished change that classifies higher than it was declared is blocked and must be re-gated.
- Gates: a GREEN base set of tests, lint, typecheck, build, secret scan, diff review, CI and preview smoke, plus an enhanced set of security review, migration review, E2E and validated rollback that YELLOW and RED add on top. A missing result is a blocker, never a pass, and `not_connected` stays distinct from `not_run`.
- Review, QA and Security agents are deterministic analysers, not model calls: manual Phase 1C is separate, Not Connected, and has no autonomous-review authority. A rules engine cannot hallucinate an approval. Blocking findings stop progression; advisory findings are recorded and do not.
- Approval returns `APPROVED_AUTOMATICALLY`, `OWNER_APPROVAL_REQUIRED`, or `NOT_APPROVED`. Owner approval is evaluated after the gates, so nothing can be approved past a failing check, and an unsound change is never escalated to a person. No-self-approval is absolute at every risk level, including for an owner.
- The orchestrator sequences twelve stages and halts at the first blocked one. `implement`, `merge` and `deploy` are reached, evaluated, and blocked by name.
- Retries are bounded per stage with exponential backoff. Exhausting the budget escalates rather than retrying again, and a permanent failure never retries at all — re-running a change refused on policy grounds cannot produce a different answer.
- Backlog Autopilot **selects** work: eligible items are ordered by priority and then by lower risk, work is held behind unmet or unknown dependencies, work above the ceiling is refused, and nothing new is picked up for a project that is degraded, critical or paused. Every exclusion carries its reason. Selection confers no authority to start the work.
- `resolved_autonomy_controls` reports the owner emergency stop alongside the kill switch and the release freeze. `stop_autonomous_operations` already set `projects.autonomous_operations_stopped`, but the resolver did not read it, so a caller could not tell an owner's deliberate stop from an automatic SEV1 freeze. Nothing was ever permitted that should not have been — STOP also freezes, and the freeze held every action off. Forward migration `20260813001400` is applied and now exposes the distinct emergency-stop state while preserving all actions OFF.
- A read-only deployment adapter implements the real provider contract and reports **Not Connected** with a reason while no token is configured. It exposes no create, promote, or rollback path; adding one is a separate owner-approved decision.
- Every provider credential the loop would need — `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — is unset in the environment this phase was built in. The executor stages are materially impossible here, not merely policy-blocked.

## Phase 1D verification evidence

- `tests/integration/phase1d-autonomy-controls.behavior.test.ts` (35 tests) applies the whole migration chain to real PostgreSQL and attempts, from every direction, to switch something on: each of the nine actions at each of the two scopes, both risk ceilings, both autonomous-mode flags, the global kill switch, and a newly inserted project or organization trying to be born with authority. Every attempt is refused, both constraints are `convalidated`, and `anon` holds no INSERT/UPDATE/DELETE on either table.
- 277 unit tests across 12 files cover the decision modules: control resolution and envelope precedence, diff classification including credential and destructive-SQL detection, gate requirement and blocking semantics, the three agents' findings, the approval tri-state and the no-self-approval rule, bounded retries, backlog selection, decision records, merge revalidation, recovery ordering, post-deploy validation, and the stage machine.
- The classifier enforces the guardrails a loop could otherwise weaken about itself. `RISK_CLASSIFICATION.md` lists "enabling or widening autonomous approval, merge, deploy, or rollback authority" as RED; that scored YELLOW until it was matched on content, because a migration flipping an action to true looked like an ordinary schema change. Enabling any of the nine actions, turning autonomous mode on, clearing the kill switch or the emergency stop, raising the ceiling, or dropping the GREEN-observation constraint is now RED wherever it appears. Destroying audit evidence — dropping, truncating, or deleting from the audit and decision tables, or dropping an append-only trigger — is listed separately and is also RED, because it removes the ability to find out what was destroyed. `lib/autonomy/controls.ts` is RED by path, and `AI/DECISIONS.md` is raised to YELLOW so a guardrail decision cannot be deleted inside an otherwise-GREEN diff.
- **Post-deploy validation is decided, not assumed.** `POST_DEPLOY_VALIDATION.md` requires that missing, stale, or mismatched evidence produce `inconclusive`, never `passed`; the pipeline's `validate` stage reported satisfied unconditionally. `lib/autonomy/post-deploy.ts` now decides what a validation record proves, and the pipeline routes the absent case through the same evaluation rather than around it. Attribution is checked before any check result, so a record describing a different deployment or commit can neither pass nor fail this one — it is `inconclusive`, even when it records a failure. `inconclusive` freezes automation and asks for an owner; `failed` opens an incident and re-opens the rollback question under `AUTO_ROLLBACK.md` without ever authorizing a rollback. No validator produces this evidence, thresholds and baselines are carried as references rather than computed, and the stage is unreachable in this tree because `merge` blocks first — a test asserts that unreachability so connecting an executor forces the path to be reviewed.
- The GREEN end-to-end demonstration runs a well-formed change through classify, verify, review, pull request, risk gate and approval to `APPROVED_AUTOMATICALLY`, and then **still halts** at `MERGE_EXECUTOR_NOT_CONNECTED`. The blocked stages are asserted by name, so a future phase that connects an executor fails these tests deliberately rather than silently gaining authority.
- Every loop decision is **recorded immutably**. `autonomy_decisions` is append-only with RLS and FORCE RLS, readable by organization members and writable by no browser role. It stores the decision, the risk it was judged at, the commit, the author and approver, and named blocker codes only — never a diff, a provider message, or intermediate reasoning. Two rules the phase turns on are enforced in the table itself: an approval whose approver is its author is rejected, and a refusal with no named blocker is rejected.
- Merge is **revalidated against the current head** rather than against the snapshot the change was judged on. A push after approval invalidates that approval, and a push after verification invalidates the gates — a signature and a test run each describe the commit they were made against, not whatever is on the branch now. Conflicts, unknown mergeability, dismissed reviews, and required checks that are failing, pending, or have not reported at all each block; a required check that has not reported is treated as missing rather than absent-and-therefore-fine, so branch protection is never inferred as satisfied.
- A **recovery decision machine** decides what to do about a failure, so the response is a judgement the decision layer makes rather than an order a caller happened to drive Phase 1E's functions in. Freeze is always first and always permitted, because freezing only removes authority. Rollback fails closed on four separate conditions, and one of them outranks every other input: **a release containing a destructive migration is never rolled back automatically**, regardless of controls, ceiling or owner approval — reversing a dropped table or policy is a second destructive act, not an undo, so only an owner may decide it. Repair is bounded by the same retry budget, and anything the loop cannot finish escalates.
- The failed-deploy chain is **recorded, not asserted**. The journey reads deployment state through the adapter (which reports **Not Connected** with its reason rather than empty data), records a `failed` validation for the new release through `record_deployment_validation`, confirms that a failed validation cannot become Last Known Good, and only then opens the incident against it. Freeze, rollback decision and bounded repair follow from that row.
- The loop journey additionally drives the **real** `stop_autonomous_operations` RPC as the owner and shows the stop propagating into the decision layer: a tenant asking for all nine actions resolves to none, and a change that would otherwise be approved is refused. A non-owner attempting the same stop is refused by the database.
- Retry exhaustion is demonstrated end to end: a bounded budget is spent one attempt at a time and the loop escalates rather than trying again, and a permanent refusal never retries even with the whole budget intact.
- This is control-plane evidence against the hosted migrated database. Migrations through `20260813001400` are applied, but no automatic action has run or can run; all nine actions remain OFF and the global kill switch remains ON.

## Phase 1E verification evidence

- Local gates on the Phase 1E tree: `npm run lint`, `npm run typecheck`, `vitest run` (143 files / 1621 tests on the merged tree), and a clean production build all pass. Merged-tree coverage is statements 72.94%, branches 69.92%, functions 64.57%, lines 74.29%; the Phase 1E modules themselves are covered by 55 dedicated unit tests.
- Playwright passes 117/117 across desktop, tablet, and mobile including axe on the merged tree, with canonical `/solutions/operations` in the audited route set.
- `tests/integration/phase1e-operations.behavior.test.ts` (28 tests) exercises the real migrated schema: threshold detection, deduplication, upward-only severity, automatic freeze, owner-only resume with acknowledgement, Last Known Good resolution, blocked and failed rollbacks, bounded repair attempts, resolution gating, event idempotency and dead-lettering, cross-tenant denial, anonymous denial, append-only enforcement, and sensitive-value rejection.
- `tests/integration/phase1e-incident-journey.behavior.test.ts` walks the ordered end-to-end journey and separately proves failed-rollback escalation to SEV1 with owner attention, plus refusal to resolve on a successful deployment alone. The Codex-fix and deploy stages are asserted as **blocked with named reasons**, not simulated.
- `tests/integration/phase1e-operations.contract.test.ts` (16 tests) guards same-origin and role checks on every mutation, the execution envelope on every response, absence of any provider deployment call, no new `service_role` table grants, and the preserved Phase 1D interlocks.
- Released to `main` as merge commit `b243e1ddf9ce8155c4440c56d7b846ccc3d74ce0`. CI run `31731632715` passed both the quality/build job and the browser/accessibility job against that exact commit, and the Vercel Preview for the merged head deployed READY beforehand.
- This is control-plane evidence against a migrated database. It is **not** live production evidence: migration `028` is hosted, but no real production target has been observed.

## /solutions routing evidence

- Local gates on the routing change: lint, typecheck, `vitest run` (83 files / 824 tests), and a clean production build listing all twelve `/solutions` routes. Playwright passes 117/117 across desktop, tablet, and mobile, with axe on each moved page.
- Verified against live production: `/solutions` and its eleven children each return `200` and serve both landmarks (`aria-label="Primary"` and `aria-label="Console"`) plus the `--shell-top:73px` offset. Every former top-level path returns `308` to its `/solutions` home, preserving query strings and subpaths.
- Every live console page serves its own title (`Projects · Control plane · AI Software Factory`, and so on) with the site name appearing once.
- `/solutions/projects` serves `noindex, nofollow`; the marketing home serves `index, follow`; `robots.txt` disallows `/solutions` and the live sitemap lists the six marketing routes only.
- `tests/integration/console-routing.contract.test.ts` guards the agreement between the route tree, the redirects, and the crawler directives. Its sitemap/robots assertion was mutation-checked: re-adding `/solutions` to the sitemap fails it.

## Authentication state

- **The confirmation link was the defect behind "account creation did not work".** Supabase falls back to Site URL when `emailRedirectTo` misses its allowlist, and appending `?next=` to a bare `/auth/callback` entry always missed, so the emailed link resolved to `https://www.theagoras.com/?code=<uuid>` -- the marketing home page. The address was confirmed and nobody was signed in. Fixed by keeping query strings off the callback URL, with magic link's destination moved to a short-lived host-only cookie; no dashboard change was required. Proven end to end against a real Supabase stack in `tests/e2e/auth-lifecycle.spec.ts`, which reproduces the broken URL with the old code and passes with the fix.
- All 40+ migrations apply cleanly in order against **real PostgreSQL**, verified by `supabase start`, not only against PGlite.
- **Sign-in is verified working live.** A wrong password on a real confirmed account returns `401 invalid_credentials`, and a genuinely unconfirmed account returns `403 email_not_confirmed` with `needsConfirmation`, which is the recovery path this work added; that account was previously told its correct password was wrong.
- **Account creation is rate limited, not broken, and the limit is a Supabase project setting rather than application code.** The live project reports `mailer_autoconfirm: false`, so every signup needs a confirmation email, and the project uses Supabase's built-in sender. A raw-API probe during an open window created a user and returned `confirmation_sent_at`, proving the code path; the next request seconds later returned `over_email_send_rate_limit`. One signup consumes the window. Custom SMTP or switching off email confirmation is required before signup is usable, and both are dashboard settings this repository holds no credential for.
- No alternative route to an account exists to work around it: every OAuth provider, anonymous sign-in, and phone sign-in is disabled on the project, so email is the only path.
- Four application defects that also blocked it are fixed and live: every "Get Started Free" / "Start Free Trial" call to action pointed at `/sign-in` rather than sign-up (the header, the homepage hero and closing band, the platform page, and all three pricing plans); successful sign-in returned the visitor to the public home page instead of `/solutions`; `supabase/config.toml` allowlisted only the Vercel preview host, so confirmation links resolved to an origin where the session cookie cannot apply; and every failure collapsed into "The account could not be created."
- `describeAuthFailure` now distinguishes rate-limited email, invalid address, weak password, disabled signups, unconfirmed account, and provider outage, and never confirms during sign-up that an address is registered. `/api/auth/resend-confirmation` plus a resend button recover an account whose confirmation email never arrived, which was previously a permanent dead end.
- Hosted pricing rows still carry `/sign-in` as their call to action and cannot be edited from the application, so `normalizeCtaHref` maps the legacy path forward on read.
- Owner actions and verification commands are in `docs/AUTH_RUNBOOK.md`.

## Production deployment position, verified 2026-08-14 23:04 UTC

Measured directly rather than inferred from a merge succeeding.

- `https://www.theagoras.com`, `/solutions`, and `/platform` all return **200**.
- The served build's sitemap reports `lastmod` `2026-08-14T23:03:49Z`, which corresponds to the deploy triggered by `baf8ce0`. **Production is current with `main`.**
- It was behind for roughly ninety minutes. Vercel returned `api-deployments-free-per-day` — the free tier's hundred-per-day cap, reached by this session's pull-request volume — on deployments at 21:54, 22:02, 22:17, and 22:33 UTC, while previews succeeded at 22:16 and 22:48. The cap throttles rather than blocking for a day, contrary to its own "retry in 24 hours" message.
- A rejected deployment is not retried automatically, so the lag persisted until a later merge gave Vercel a fresh commit to build once capacity returned. If production is ever behind again for this reason, the remedies are another push to `main` or an owner redeploy from the Vercel dashboard; no code change affects it.
- Build identity is inferred from the served sitemap's `lastmod`, which changes only on rebuild. That is a reasonable proxy, not a deployment ID — this environment holds no `VERCEL_TOKEN`, so the deployment list cannot be read.

## Migration ledger integrity

- Two migrations shared the version prefix `20260814000300` (`agentos_isolation_model` and `declare_model_characteristics`). Supabase's ledger keys on the numeric prefix, so `supabase db push` would have hit a primary-key collision in `supabase_migrations.schema_migrations` and left the hosted schema **half-applied**. Neither file was hosted, so the fix carried no ledger consequence: `declare_model_characteristics` was renumbered to `20260814000250`, after the `20260814000200` migration whose columns it depends on and before the AgentOS chain.
- `tests/integration/migration-version-uniqueness.test.ts` now prevents recurrence. This had happened twice, both times from separate agents choosing the same timestamp in parallel.
- **Nineteen versions are absent from the hosted ledger**, measured 2026-08-18 by probe run `32103778884` — not the 15 this bullet claimed, and not a tail: the gap is in the middle of the sequence (see the 2026-08-18 correction near the top of this file). `AI/HOSTED_APPLY_RUNBOOK.md` names all nineteen with the marker object that decides, per version, whether the correct action is a history repair or a real apply. Both are owner-gated and need Supabase credentials that exist in no agent environment.

## Schema and wiring guarantees now enforced continuously

Each of these was true and unguarded — provable only by a manual run, which does not survive the next migration.

- `tests/integration/supabase-rpc-contract.test.ts` — every `.rpc()` call site in `app`, `lib`, and `scripts` resolves against the fully migrated schema with matching argument names.
- `tests/integration/schema-security-invariants.test.ts` — RLS and FORCE RLS on every public table across the whole chain; `service_role` table privileges limited to exactly `github_change_requests`, `github_installations`, `github_repositories`, `github_webhook_deliveries`; `anon` holds no write privilege anywhere. `newsletter_subscribers` is an allowlisted policyless table, locked shut on purpose behind the SECURITY DEFINER `subscribe_to_newsletter`.
- `tests/integration/required-checks-wiring.test.ts` — the worker's `SOFTWAREFACTORY_REQUIRED_CHECKS` matches the `name:` of every job in `ci.yml`, in both directions. A renamed CI job would otherwise leave a live run waiting for a check that never reports.

## Agentic SDLC lifecycle on the graph worker, 2026-08-21

`main` shipped a background graph worker while a parallel branch was building a
request-driven executor. The branch deleted its own and re-seated the lifecycle
on the worker: one executor, one write path, no second claimant racing the first
for the same run. `AI/AGENTIC_SDLC_GAP_MATRIX.md` records all 24 capabilities
against the tree.

**What exists.**

- Eight stages (`lib/sdlc/lifecycle.ts`), recorded on a node rather than implied, each with the gate that guards it and whether its claim must be anchored.
- `graph_gates` under RLS and FORCE RLS with `select` to `authenticated` and no write privilege anywhere, keyed on `node_id` so an approval outlives the run that asked for it.
- `claim_planned_graph` projects `lifecycle_stage`, `gate_kind` and any existing decision; excludes feedback edges; and re-offers a lifecycle that halted at a gate once that gate is decided.
- `runClaimedGraph` records a gated node's artifact, moves it to VERIFYING, opens the gate and reports it as not-completed so nothing downstream starts on an undecided result.
- `POST /api/graph-gates/{id}/decide` — member-scoped, `auth.uid()` recorded, both database refusals passed through intact.
- `components/graph-runs-panel.tsx` shows the stage and offers the decision inline on the node that owns it.

**Migrations `20260821000100` and `20260821000200` are local only.** The hosted
ledger does not have them, so no hosted graph carries a stage or a gate.

**Not Connected, unchanged.** No node has executed against a provider. Outbound
execution is off and no credential is configured. No lifecycle has met its
acceptance criteria and none is claimed to have.

## Release blockers

### Step 8 provider-route acceptance remains (2026-08-28)

- The repeated `invalid Phase 1C command plan` screenshot came from a stale Aug 22 mounted client. Release `bb68659a0ee84370f83dd647ae57f4ccb83ea06c` is current, and its logs contain authenticated GETs but zero `POST /api/commands` and no command-route 4xx/5xx.
- A fresh signed-in Chrome tab proves the current bundle loads for `daniel.hughen@gmail.com`; it also proves the tenant currently has zero connected AI accounts, ready bots, or assignments. One Codex connection is unfinished and Claude OAuth is incomplete.
- Complete provider OAuth and route setup, then submit one fresh record-only command and verify its persisted Step 9 correlation. Do not claim Steps 8-9 accepted before that evidence exists.

1. Preserve the prior verified production baseline before this update: commit `0c662a24393f682073e6002c5aff9339292226d8`, CI run `31749352644`, and READY deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7`.
2. Preserve the passing frozen local candidate and publish only after exact review, recording a new commit, CI run, and matching Vercel deployment. Keep `130015` local until a fresh exact RED approval authorizes only that complete forward migration on `qpuofpmagrmyamahqwxw`, including all four new no-secret constraints; then stop on any ledger, identity, constraint, secret-shaped-text regression, table/function ACL, signature, RLS/direct-denial, runtime, lint, or health mismatch.
3. Contain and remeasure the current hosted blockers: five linked lint errors/ten findings, one raw organization with `autonomous_mode = true`, one with `autonomy_kill_switch_active = false`, two projects effective-kill-off, and no connected/fresh worker. Preserve valid historical identity/ACL/audit evidence without presenting it as a clean current baseline.
4. Configure an owner-authorized production monitor target and record real Phase 1E observation/detection/resolution evidence before claiming monitoring Connected; rollback, repair, telemetry, and scheduling remain separately blocked.
5. Keep execution inert: no worker dispatch and no merge/deploy/rollback executor. Do not host or promote `20260821000400` until the observed hosted autonomy/kill-switch drift is contained under a separate owner-approved action and verified from raw plus effective state.
6. Keep `SOFTWAREFACTORY_OPENAI_API_KEY` absent permanently and revoke the exposed key at the provider. Do not fund an OpenAI API account for Phase 1C. Configure `SOFTWAREFACTORY_CODEX_AUTH_JSON` instead, from a subscription `codex login`. Keep `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` absent/false.
7. Rerun the distinct `softwarefactory_phase1c_preflight` event after the subscription credential is configured. In subscription mode it verifies the pinned CLI and reports the resolved authentication mode, and makes no request to `api.openai.com` at all, without preloading Docker or claiming a durable run. Leave stale run `f4594556-6f72-4763-a480-6993939e3651` failed as historical evidence. Only then submit a new safe GREEN command bound to the current `main`, observe the complete draft-PR/exact-head-CI journey, and immediately return activation to absent/false. Any diagnostic failure remains fail-closed and consumes no run attempt.
8. Observe the Phase 1B rollback window, reverse handoff, disconnect/loss, live second-tenant/anonymous/RPC, and remaining stale-SHA, approval-expiry, permission, rate-limit, ordering, deletion/restore, idempotency, and recovery cases before retiring primary access; keep Support ticket `#4660724` open.
9. Keep Phase 1B incomplete and Phase 1C/Phase 2 **Not Connected**. The intended control policy remains Autonomous Mode OFF, kill switch ON, and automatic actions OFF, but current hosted raw/effective drift must be remediated before that policy may again be claimed as observed fact.
10. Update this file and `AI/QUALITY_SCORECARD.md` with exact hosted, monitoring, provider, worker, run, branch, commit, PR, CI, deployment, activation, and deactivation evidence before changing any **Not Connected** status.

## 2026-08-28: ten-step Factory v2 release is live

Exact `main` `bb68659a0ee84370f83dd647ae57f4ccb83ea06c` carries the
Requirements -> Monitor lifecycle as one release-identity-bound graph: exact
repository/base revision, explicit policy and approval gates, immutable Phase
1C command/PR/CI/deployment/monitor lineage, and exact run selection in the
Factory UI. CI run `33149814278` passed quality plus browser/accessibility
shards 1/3, 2/3, and 3/3. Vercel deployment
`dpl_2A2bhtevZeBY6422ZYjVGJE5SuTU` / GitHub deployment `6137077047` is READY
behind `www.theagoras.com`.

The forward-only database sequence is complete: the previously accepted
`20260827000150` fence was not replayed; run `33150654596` applied only
containment migration `20260827000210`, and run `33150707932` then applied the
unchanged lineage migration `20260827000200`. All ledger, catalog, ACL, RLS,
audit, runtime, lint, health, and stopped-safety postflights passed.

Signed-in Steps 8-9 remain **Not Connected**, not failed. A fresh production
session has no connected account, ready bot, or assignment; the owner must
finish provider OAuth and route setup before current command/Step 9 acceptance.
Workers, autonomous mode, provider execution, and all automatic actions remain
OFF; the global kill switch remains ON.

## 2026-08-28: exact containment and lineage acceptance

Release `bb68659a0ee84370f83dd647ae57f4ccb83ea06c` is exact production. Probe
run `33150619218` reported four legacy artifacts, manifest SHA-256
`784acaca2b0957ecb0eeea85e3d0dde2e64ba653c744e708ec8d4094f9175b99`,
and downstream blockers `0|0|0|0`, without logging payloads or row identities.
Run `33150654596` matched that exact manifest and applied only hash-pinned
`20260827000210`; run `33150707932` then reconstructed the same manifest from
private immutable audit evidence and applied unchanged hash-pinned
`20260827000200`.

Both workflows passed transactional and post-commit ledger, catalog, FORCE
RLS, raw table/function ACL, immutable audit, constraint, exact tombstone,
runtime, lint, health, and stopped-worker checks. Post-v2, eight legacy
signatures remain fully revoked and the replacement
`decide_node_gate(uuid,boolean,text)` is authenticated-only,
owner/admin-checked, `SECURITY DEFINER`, pinned to `pg_catalog`, and
evidence-bound. The prior `00150` fence was not replayed; never reset,
down-migrate, or restore a legacy grant.

Fresh production diagnosis remains exact: authenticated GETs reached the new
deployment, but no command POST or command-route 4xx/5xx exists. Current
Steps 8-9 acceptance awaits completion of a supported provider OAuth flow and
the resulting connected account, ready bot, and project assignment.
