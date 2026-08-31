# Handoff

Last updated: 2026-08-31

## Newest (2026-08-31, latest+17): documents, canvassing, marketing (ADR-195)

Owner /goal: match BOSS and PestPac. The audit is
`AI/PEST_CRM_COMPETITOR_MATRIX.md` — ten products, per-capability
HAVE/PARTIAL/GAP, source-linked. This increment closes the photos/files,
door-to-door and campaigns rows.

`20260830001500` adds crm_documents, crm_canvass_routes + crm_knocks,
crm_marketing_lists + crm_list_members, crm_campaigns + crm_messages,
crm_automations, crm_attributions.

FOUR INVARIANTS IN THE SCHEMA:
1. A document is a storage PATH — the CHECK refuses anything with a scheme
   in it, and bytes never enter the database. Render via a signed URL.
2. crm_knocks holds select+insert only. A sold door must name its account;
   a follow-up date is confined to callback/appointment_set.
3. Consent keeps its moment: unsubscribed_at + reason, with the reason
   refused when there is no unsubscribe. crm_messages is append-only.
4. The message funnel is one-way by CHECK: clicked→opened→delivered→sent.

READ THIS BEFORE "FINISHING" MARKETING: nothing sends. No provider, no
executor. `sending`/`sent` are deliberately absent from the campaign API's
settable set; run_count/last_run_at are not settable at all and the schema
CHECKs they agree; the page carries Not Connected. Wiring a provider is the
follow-on item in BACKLOG — do not fake it in the meantime.

THE 255-REPETITION TRAP, SECOND OCCURRENCE: storage_path used `{2,300}`.
PostgreSQL refuses a repetition count above 255 and a CHECK's regex only
compiles when a row carries a value, so it survived every null-column test —
exactly as ADR-192's `{4,500}` did. Fixed by splitting shape (regex) from
length (char_length), and now guarded by
`tests/unit/migration-regex-repetition.test.ts`, which strips comments
first because the two ADR notes have to quote the counts that caused it.

SEED: 35 tables, 38,728 rows, 35/35 PASS. Note one deliberate omission —
`crm_automations.last_run_at` is NOT in the validator's optional list,
because nothing runs an automation and seeding a moment would be claiming
one had fired. An honestly empty column is not a coverage gap.

## Newest (2026-08-30, latest+16): the company arrives (ADR-194, task #64)

Owner directive: locations, branches, managers, salesmen, world class,
competitor-researched. `20260830001400_branches_org_sales.sql` adds
crm_branches, crm_employees (the org chart), crm_territories and
crm_commissions, plus branch/territory/owner columns on crm_accounts, an
owner on crm_opportunities, and branch/supervisor/hire_date on
crm_technicians.

THREE INVARIANTS IN THE SCHEMA:
1. `crm_derive_commission_amount` computes amount = basis x rate on INSERT
   **and UPDATE**, so raising a rate later re-derives the payout. The route
   schema has NO amountCents field — the number cannot be sent at all, and
   services-org-sales-routes pins that (422, table never touched).
2. "Active" never contradicts a date: a branch with closed_on cannot be
   active, an employee with end_date cannot be active, closes cannot
   precede opens, and nobody reports to themselves.
3. A commission is earned on something: num_nonnulls(opportunity, contract,
   invoice) >= 1, with approved/paid as ordered moments.

THE POSTAL-CODE TRICK: a CHECK cannot hold a subquery, so per-element
validation of `postal_codes text[]` is done by regexing the JOINED string —
`array_to_string(postal_codes, ',') ~ '^CODE(,CODE)*$'`. Repetition counts
stay under Postgres's 255 limit (the trap ADR-192 found), so it compiles.

WHY TECHNICIANS KEPT THEIR TABLE: a technician takes work-order
assignments and carries a licence; an employee is a person in the business.
Merging would have meant repointing three FKs and dropping a table with
live history for a naming preference. Both gained branch + supervisor, and
/Services/team shows them side by side.

TWO HONESTY RULES ON THE SURFACES, do not "simplify" them away: winRate is
NULL, not 0, for a rep with nothing decided (0 reads as "loses
everything"); and unowned deals / unassigned accounts / unworked
territories are reported at the top of their pages rather than excluded.

BASE-BRANCH NOTE: origin/main moved four commits mid-flight, one adding a
migration at 20260830000900 that collided with pest-ipm. This branch's
three unapplied migrations renumbered to 001100/001200/001300 (and this one
to 001400); 33 files swept. Main also arrived red — see the commit
"Withhold the typed-input boundary with the release it consumes".

## Newest (2026-08-30, latest+15): billing closes the chain (ADR-193, task #63)

Increment 6. `20260830001300_billing_contracts.sql` adds crm_estimates
(+lines), crm_contracts, crm_invoices (+lines), crm_payments and
crm_refunds. Five invariants live in the SCHEMA, not in a route:

1. crm_payments and crm_refunds hold `select, insert` and nothing else —
   append-only AT THE GRANT LEVEL, so no policy or later migration can
   quietly make money editable.
2. `crm_guard_refund_total` locks the payment `for update`, sums the
   credits already against it, refuses the excess. Two concurrent refunds
   cannot together overdraw one payment.
3. `crm_settle_invoice` derives paid_cents from payments minus refunds
   and sets the status from that total; a refund that drops the total
   reopens the invoice. `void`/`uncollectible` keep their status. The
   API's settable set deliberately OMITS `paid` — a caller cannot assert
   it, and services-billing-routes pins that (422, table never touched).
4. Every payment writes a `payment` timeline event by trigger. All three
   system kinds (status_change, service, payment) now have real writers.
5. Integer cents under non-negative CHECKs; no floating-point money.

Nothing is deletable: a withdrawn estimate is `declined`, a closed
contract `ended`, an invoice raised in error `void` — with its reason on
the record.

Surfaces: /Services/billing (four books + the ledger) and
/api/services/{estimates,estimates/[id],contracts,invoices,invoices/[id],
payments,refunds}. Routes derive every total from the lines they were
sent and surface the ledger's refusals as 409s, never 500s.

WHAT IS NOT TRUE YET, say it plainly: this records money that moved; it
does not move money. No card is charged from /Services/billing — the
Stripe machinery is not wired to it. That is the next item in the
pillar, tracked in BACKLOG.

TRAPS RE-CONFIRMED THIS INCREMENT:
- PGlite composite-FK trap, hit a 3rd and 4th time: a composite FK needs
  its target's unique index to EXIST FIRST. crm_opportunities and
  crm_service_plans had none, so 20260830001300 PREPENDS both
  `(organization_id, id)` unique indexes before its own tables.
- The hosted default-privileges trap: every new table is granted ALL to
  authenticated/service_role on creation, so append-only is expressed by
  REVOKE-then-GRANT, and the `billing-contracts` postflight proves the
  ABSENCE of update/delete rather than assuming it.

## Newest (2026-08-30, latest+14): the full-scale seed corpus (ADR-192, task #63)

New owner /goal: populate the CRM so every feature can be tested end to
end, 250+ rows per applicable table, every optional field populated,
audited table by table. Three modules: seed-generator (deterministic
mulberry32; fictional by construction; idempotent by identity — every
unique value derives from its index, so a re-run collides with the
database's constraints instead of doubling the book), seed-runner
(dependency-ordered, batched, through the caller's RLS client; statuses
and stages walk one step so triggers write the history; corrections are
a SECOND pass because a supersede must reference an existing row), and
seed-validation (reads the rows BACK: counts vs a 250 floor, optional
coverage, enum spread, orphans, PASS/FAIL per table).

VERIFICATION IS THE DELIVERABLE: services-crm-seed.behavior runs the
production seeder and validator unmodified against the real chain in
PGlite, through tests/support/pglite-supabase-client.ts — a shim
implementing the slice of the supabase-js builder those modules use, and
translating Postgres errors into Supabase's shapes (23505/23503/23514/
42501) so the code takes the same branches it would live. Result (with
increment 6's billing tables covered): 22/22 PASS, 23,375 rows, zero
orphans. Set SEED_REPORT_PATH to capture
the report; a passing vitest run swallows console output.

BUG THIS FOUND (would have hit production): crm_products.sds_url and
label_url used `~ '^https://[^[:space:]]{4,500}$'`. Postgres refuses a
regex repetition count above 255, so the CHECK compiled only when a row
carried a URL — every prior test left it null. Fixed in
20260830001200 (NOT yet applied to hosted, so edited in place; shape and
length are separate checks now) and pinned by a chain test that inserts
a linked product.

Surfaces: POST /api/services/demo-seed takes { scale: "book" | "full" }
(book is the default, so the existing caller is unchanged);
GET /api/services/seed-report returns the audit, ?format=text for a
plain table. VALIDATOR TRAP: sample ordered by uuid PK, not insert order
— insert order clusters by kind and the first page of a timeline is all
trigger-written status changes, which would fail a fully-populated table.

## Older (2026-08-30, latest+13): chemicals & compliance (ADR-191, task #63)

Increment 5, the regulated pillar. 20260830001200 adds crm_products /
crm_product_lots / crm_applications / crm_compliance_rules. Five schema
invariants: applications are APPEND-ONLY at the grant level (a
correction is a superseding record naming the original, never an edit);
the applicator's license is COPIED onto the record by the route from the
roster (renewals must not rewrite history); the lot drawdown is a
`for update`-locked trigger refusing over-draws and unit mismatches;
every application writes its own 'service' timeline event (the second
real writer of that system kind); and jurisdiction rules are configurable
rows, enforced at the application boundary with the missing fields named
— no state hardcoded anywhere. TRAP: a self-referencing composite FK
cannot be inline (the unique index it targets is the table's own) —
`supersedes_id` is added as a separate constraint after the table;
PGlite caught it with "no unique constraint matching given keys".

Surfaces: products GET/POST (https-only SDS/label, EPA 409),
products/[id]/lots POST, applications GET/POST, compliance/rules
GET/POST, compliance/report (JSON or CSV; the CSV is RFC-4180 quoted and
prefixes =,+,-,@ cells so a regulator's spreadsheet reads text, never a
formula). /Services/compliance panel: catalogue with lot lines and
inline receive, jurisdiction rules, recent applications, and the audit
report with its matching CSV link. Demo Data gained a fictional
catalogue (90000-series EPA numbers no real registration uses), lots,
applications drawing them down, and two contrasting jurisdictions.

Suites: services-chemicals-compliance.behavior 6, compliance routes 9,
compliance panel 3, demo hygiene +1, demo-book replay extended (the two
'service' writers counted apart). Census: RLS 162, hosted-grants fifteen
crm tables, sentinels swept to 20260830001200 (28), runbook 189,
workflow scope chemicals-compliance. Dispatch after merge. Next:
increment 6, invoicing on the existing Stripe machinery.

## Older (2026-08-30, latest+12): pest/IPM core (ADR-190, task #63)

Increment 4, the goal's differentiator pillar. 20260830001100 adds
crm_devices / crm_device_events / crm_pest_sightings on the established
posture (org-scoped forced RLS, revoke-then-grant against hosted
defaults, anon+service_role revoked, three-column composite keys to the
account's own property). Four schema-held invariants: the scan ledger is
APPEND-ONLY at the grant level (select+insert, nothing else); a station
is born with its install scan (AFTER INSERT definer trigger — no device
predates its ledger); device state is a PROJECTION of the ledger
(install reactivates, remove closes with removed_at CHECKed against
status, move relocates — all by trigger); and corrected_at is CHECKed
against corrective_action so a resolved sighting always says what was
done. Nothing is deletable anywhere. Barcode = field identity: unique
per organization (a scan resolves to exactly one station), reusable
across organizations, grammar-CHECKed. NOTE: this migration also adds
crm_work_orders_org_id_key — the ledger's work-order FK needed a
composite target that field service never created; PGlite caught it
("no unique constraint matching given keys").

Surfaces: /api/services/ipm (one org-scoped dashboard read),
devices POST/PATCH, devices/scan (barcode → 404 or append; device
re-read after the trigger moves it), sightings POST + PATCH (the
corrective-action close). /Services/ipm panel: scan box, per-site
station tables with threshold flags, sighting loop; nav entry "IPM &
Devices". useAccountProperties extracted from the schedule panel to
components/services/use-account-properties.ts and reused by both IPM
forms. Demo Data now runs a real IPM program (8 stations across 5
sites, scan histories with an over-threshold station, one open and one
closed sighting), replayed against the chain.

Suites: services-pest-ipm.behavior 4 (chain), pest-ipm routes 7, IPM
panel 4, demo-data hygiene +1, demo-book replay extended. Census: RLS
158, hosted-grants eleven crm tables, sentinels swept to
20260830001100 (26), runbook 188, workflow scope pest-ipm (postflight:
forced RLS x3, ledger immutability, no-DELETE, anon/service_role
shutout, both device triggers, barcode uniqueness). Dispatch
scope=pest-ipm right after merge. Next: increment 5, chemicals and
compliance.

## Older (2026-08-30, latest+11): field service core (ADR-189, task #63)

Increment 3 on main-bound work: crm_technicians / crm_service_plans /
crm_work_orders (20260830000800), all revoke-then-grant, NO DELETE
anywhere (inactive/cancelled are the verbs; history hangs off
everything). First real 'service' timeline writer: work-order completion
→ definer trigger writes summary "Service completed: {type}." with
"Property: {label}." + field notes in detail; cancellation → the
status_change it is; dispatch progress deliberately silent.
completed_at trigger+CHECK like closed_at. Three-column FK
(org, account, property) makes cross-account scheduling impossible.
Plans: guarded generate (advance eq'd on prior next_due → concurrent
double-click = one visit + 409 plan_already_generated) with
compensating rollback if the visit insert fails; advanceServiceDate
clamps month ends. UI: /Services/schedule (counts chips, due-plans
lane, day-grouped board, per-visit technician/status selects,
notes-first completion) + /Services/technicians roster; nav 5 entries.
Demo Data now fields the operation (3 technicians, 8 plans incl. one
due at seed, 9 visits incl. cancellation; replay suite counts 'service'
events = completions, each naming its property). Census: RLS 155,
hosted-grants 8 crm tables, sentinels → 20260830000800, runbook 187,
workflow scope field-service (~462KB of 490KB — the scope-step budget
is tightening; consider extracting scope SQL like the probe's 01.sql
within the next two scopes). TRAP hit twice now: the shared ui Card
drops unknown props — data-testid goes on an INNER element, never on
Card. Dispatch scope=field-service right after merge. Next: increment
4, pest/IPM devices + stations.

## Older (2026-08-30, latest+10): CRM pipeline, duplicates, global search (ADR-186, task #63)

Increment 2 of the CRM plan: crm_opportunities (20260830000700) on the
ADR-185 posture — org-scoped forced RLS, composite same-org FK,
anon/service_role revoked, revoke-then-grant in the SAME migration
because hosted defaults GRANT ALL on creation (chain suites now install
those defaults before the CRM window, so the class fails locally). Stage
moves are trigger-written onto the account timeline (system kind
status_change, loss reason in detail); closed_at maintained by BEFORE
trigger + CHECKed `(stage in won/lost) = (closed_at not null)`; NO
DELETE grant — win rate is won/(won+lost) and erasing losses would
inflate it; lost_reason CHECKed to lost only, so PATCH clears it when
leaving lost. Creation restricted to open stages at the route. Duplicate
detection: generated normals on crm_accounts (name alnum-lower, email
trim-lower, phone digits) with JS mirrors in lib/services/crm.ts — the
chain suite pins stored values so probe/stored can't drift; create
returns 409 + matches, explicit allowDuplicate proceeds, nothing is ever
merged. Global search: per-column ilike probes (or() strings break on
commas in addresses), merged per group, box in the shell. New surfaces:
/Services/pipeline board + report, Opportunities card on the account
page, search in shell/drawer. Suites: services-crm-pipeline behavior 5
(chain), routes now 15, pipeline panel 4, customers panel 5. Census:
RLS 152, hosted-grants +crm_opportunities, sentinels swept to
20260830000700 (23), runbook 186, workflow scope crm-pipeline
(postflight: forced RLS, no-DELETE, both triggers, generated columns).
Dispatch scope=crm-pipeline right after merge. Next: increment 3, field
service core.

Same window, owner directive ("CRM looks like a placeholder… fake seed
data fully built out"): the Demo Data book (ADR-187). 14-account
fictional clientele in lib/services/demo-data.ts, seeded per-org via
POST /api/services/demo-seed → seedDemoData walking statuses/stages one
real move at a time (triggers write the history; nothing forges system
rows). Empty-book-only (409 book_not_empty); source = "Demo Data" on
every seeded account; .example emails, 555 phones; Overview gains the
loader block, the reserved DemoNotice when seeded rows are present, and
a pipeline headline (open value / won / win rate from the board's own
read). Dataset replayed against the real chain in
services-crm-demo-book.behavior (any CHECK overstep fails there before
production); hygiene pins in services-demo-data unit suite. No
migration — hosted apply for this window is scope=crm-pipeline only.

## Older (2026-08-30, latest+9): Services CRM foundation (ADR-185, task #63)

New owner /goal: pest-services CRM + field-service platform. Plan of
record: AI/SERVICES_CRM_GAP_ANALYSIS.md (10 increments; PRODUCTION
READY only after the seeded E2E). Increment 1 shipped: /Services
product (route group `(services)`, own shell/nav on the Budget Tracker
pattern, requirePortalViewer gate, global-nav entry), migration
20260830000500 (crm_accounts/contacts/properties + append-only
crm_timeline_events; ORG-scoped member RLS — not person-scoped like
Budget/JobSeeker; status changes self-record via AFTER UPDATE trigger;
composite same-org FKs; no DELETE on accounts, no UPDATE/DELETE grants
on timeline), five /api/services routes (manual timeline route refuses
status_change/service/payment — those kinds belong to future database
machinery), three pages live-wired. Suites: services-crm-foundation
behavior 6 (chain), services-crm-routes 8, services-customers-panel 4.
Workflow scope services-crm (postflight: forced RLS ×4, immutability
grants, trigger, anon/service_role shutout); runbook 184; sentinels
swept to 20260830000600 (23). The first scope=services-crm dispatch
FAILED its own postflight — hosted default privileges GRANT ALL on new
tables to authenticated, so the foundation's narrow timeline grants
shipped wide; 20260830000600 is the revoke-then-grant fix, the scope
step now applies both files, and the behavior suite installs
hosted-style defaults right before the CRM migrations so this class
fails locally from now on (whole-chain defaults contradict an earlier
migration's own security catalog — window them). Dispatch the hosted
apply right after merge. TRAP unchanged from latest+7: owner-role
writes in PGlite suites belong at wave boundaries/sequential points.

## Older (2026-08-30, latest+8): inline LinkedIn/Indeed via the keyed JSearch aggregator (ADR-184)

Owner screenshot directive: LinkedIn/Indeed results inside the site.
Scraping stays refused; the built path is board-search/jsearch.ts —
JSearch (RapidAPI) over the Google for Jobs index, per-result
`publisher` on BoardSearchHit (optional field), env-gated on
JSEARCH_RAPIDAPI_KEY. Lockstep gating: `availableBoardSearchAdapters()`
(registry) + `resolvedSourceCatalogue()` (catalogue) are call-time
reads; search route GET/POST, save route (via boardSearchKeys), alert
runner and the panel all follow. Route badges aggregator sources
"LinkedIn (JSearch)"; per-board rows say "on LinkedIn"; the linkout
hint says Connected or Not Connected + the exact var. One request per
search (num_pages=1; free plan ~200/mo). Catalogue 52→53 (28 general) —
counts pinned in board-search-catalogue.test. TRAP: the alerts-run
route test mocks the registry with an explicit export list — a new
registry export must be added there. NOT live until the owner sets
JSEARCH_RAPIDAPI_KEY (recorded as an OWNER ACTION in BACKLOG); the
parser is fixture-pinned to the documented v2 envelope and the first
keyed search is its live probe.

## Older (2026-08-30, latest+7): Pause/Resume — the run controls are complete (ADR-183)

Pause is GRAPH-level (graphs.pause_requested_at/by, 20260830000400) —
run-level would self-defeat: the paused run closes CANCELLED (void, re-
claimable), so the next drain would resume it unasked. The claim
selector is the 20260830000200 definition verbatim + exactly
`and g.pause_requested_at is null`. Engine: RunnerDependencies.checkPause
polled at each wave boundary → outcome PAUSED; worker maps it to
CANCELLED with a pause closure note, SKIPs undispatched nodes with a
pause detail, and GraphRunSummary.paused tells the drain log. Store
poll read_graph_pause_as_worker answers false on ANY failure
(PGRST202 pre-apply included) — a pause poll must never kill the
drain; the claim predicate still holds the next run. Resume =
set_graph_pause_as_member(false) + the launch route's worker wake
(route POST /api/graphs/[graphId]/pause, {paused:boolean}); lifecycle
reuse continues from completed steps — proved end-to-end in
graph-worker-execution.behavior. Member definer refuses withdrawn
graphs ('graph_withdrawn' → 409). Runs feed projects
pausedAt/withdrawnAt off the existing RLS identity read with a 42703
deploy-window fallback (test pins both select shapes). Sentinels swept
to 20260830000400 (22), runbook 183, workflow scope pause-graph
(options + step; postflight: 2 columns, claim predicate, member fence
authenticated-only, worker read service_role-only). Dispatch the
hosted apply right after merge. Follow-up recorded: queue diagnosis
doesn't yet name paused/withdrawn as exclusion reasons.
TRAP (cost 3 wall-clock hours): in the PGlite behavior suite, never
issue a member-role write from INSIDE a concurrently-executing wave —
the single shared session's set role/reset role dances interleave and
the session wedges at 100% CPU with every pending query unresolved,
past any vitest timeout. Owner-side writes in these tests belong at
wave boundaries (e.g. wrapped into a readPauseRequested poll) or
outside runs entirely. Production is unaffected (separate HTTP
connections).

## Older (2026-08-30, latest+6): attempt projected; preview is the deploy URL (ADR-182)

20260830000300 restates list_graph_runs (from 20260825000300, verbatim
+ one change): 'attempt', case when nr.attempt >= 1 then nr.attempt end
— measured values project, the pre-writer 0 projects as null.
DetailedNode + RunNode gain optional attempt; Build Agents rows append
"· attempt N" only when N >= 2. graph-node-detail's old
"nothing writes one" test replaced per its own instruction (null on
0-rows, 2 after a measured update). Preview: X-Frame-Options DENY +
frame-ancestors 'none' fence an inline iframe (weakening = RED); the
release panel's deployment link is now labeled Preview. Workflow scope
node-attempt-projection added (runbook 182; sentinels swept to
20260830000300). Dispatch the hosted apply right after merge.

## Older (2026-08-30, latest+5): autonomy modes derived, fence intact (ADR-181)

lib/factory/autonomy-mode.ts (deriveAutonomyMode + AUTONOMY_MODES with
exact control patches). Build panel build-autonomy: derives from
GET /api/projects/[id]/controls; selecting Balanced/Autonomous PATCHes
the real route ({autonomousMode, maximumAutonomousRisk,
expectedUpdatedAt}) and the refusal renders verbatim — the route schema
pins autonomousMode to literal false and enforce_safe_project_controls
refuses beneath it. DO NOT loosen either: enabling/widening autonomous
authority is RED (RISK_CLASSIFICATION) and outside the owner-directed
release rule. The controls effect uses the kickoff-setTimeout pattern
(react-hooks/set-state-in-effect refuses sync setState in effects).

## Older (2026-08-30, latest+4): Stop as withdrawal (ADR-180)

20260830000200: graphs.withdrawn_at/by/reason + ONE predicate added to
the verbatim-restated claim_planned_graph_target_internal (both v2
claims route through it); withdraw_graph_as_member authenticated
definer (membership, secret scan, idempotent, RUNNING refusal
'graph_run_in_flight', 'graph.withdrawn' activity event — enum value
added). Route maps in-flight to 409 in plain words. Build: Stop on the
waiting card + non-RUNNING active rows only. Sentinels swept to
20260830000200 (22), runbook 181, workflow scope withdraw-graph (step +
options, postflight checks columns + claim predicate +
authenticated-only ACL). Dispatch the hosted apply right after merge —
before it lands the route answers PGRST202 as an honest failure.
TRAP: pg_catalog.coalesce()/nullif() do not exist — they are SQL
constructs; write them bare even under search_path=pg_catalog.

## Older (2026-08-30, latest+3): probe extraction corrected (ADR-179)

ADR-178's parser mis-terminated on blocks whose closing line carries a
shell suffix (`|| echo`, `|| true`, `\` continuations): 40 real blocks,
not 33; live probe dispatch 33297041401 failed at probe/04.sql:35. The
re-extraction carries two machine proofs (byte-exact step surgery;
every file == the bash-unescaped text psql received) and the guard that
was missing: hosted-scope-replay now EXECUTES all 40 probe files
against the migrated chain (supabase_migrations stubbed). Lifecycle pin
is 08.sql now. Do not trust an extraction any test does not execute. CLOSED: the
re-dispatched scope=probe run 33297796528 completed green on the
fixed extraction — live evidence for ADR-178/179.

## Older (2026-08-30, latest+2): workflow headroom (ADR-178)

apply-hosted-migrations.yml was 44 bytes under its 490KB guard (GitHub
hard-refuses at 500KB) — no new scope could be appended. The probe
step's 33 inline SQL blocks now live in .github/hosted-apply/probe/
NN.sql (verbatim, dedented; step runs psql -f in the same order):
489,956 → 440,708 bytes. Re-pointed pins: runbook-counts probedVersions
reads 01.sql + asserts the workflow runs it; bot-account-binding's
register_bot/read-only pin scans step + all probe files;
scope-replay executes 07.sql against the migrated chain. TRAP for the
next scope author: extraction of the three mutating giants
(factory-any-model 82KB, all 65KB, bot-account-binding 41KB) is the
recorded follow-up — never combined with a new scope in one change.

## Older (2026-08-30, latest+1): Activity log (ADR-177)

GET /api/graphs/runs/[graphRunId]/events — graph_events verbatim via
the RLS tenant client (org filter restated; policies from
20260814000100 already grant member SELECT on graph_events, node_runs,
graph_nodes — no migration). Newest-500 bound, `truncated` admitted,
chronological, node keys via two bounded lookups. Build panel
build-events: lazy, monospace time/type/node/detail lines (ADR-174
attempt suffixes now person-visible). Inline preview is the last open
command-center panel.

## Older (2026-08-30, latest): Changes & release panel (ADR-176)

`lib/factory/release-evidence.ts` derives the release trail from the
ANCHOR observation payloads (shapes verbatim from
lib/worker/anchor-node-executor.ts: phase1c_change_lineage,
phase1c_pull_request_review, ci_check_runs, github_production_deployment,
production_http_probe) — null per section until its observation exists.
Build's "Changes & release" disclosure (testid build-release, lazy,
sharing the artifacts fetch/state) links files-changed/diffs to the
PR's `/files` tab (GitHub's diff is authoritative — never re-rendered),
shows produced commit + base, each check's real conclusion (failures
red), deployment state/environment/URL, production health. Open gaps
recorded in ADR-176: logs (graph_events not yet in Build) and inline
preview. #456 merged as f3899d9, deployed (Vercel queued ~35 min —
watch for that), probed.

## Older (2026-08-30, later still): plan approval before launch (ADR-175)

Build's submit now drafts instead of launching: `composeLaunchProposal`
(chief-of-staff.ts) reads the full_lifecycle template — same nodes,
jobs, gates, proposedEdges the launch route compiles — through
composePlan. The proposal card (testid build-proposal) shows the goal
verbatim, layers with specialists, the three HUMAN gates named
(architecture, test, deploy), and template jobs under a disclosure;
"Approve & launch" performs the old submit's POST, "Edit the request"
withdraws keeping the prompt. Tests: unit proposal pinned to the real
template (14 steps, widest layer 3, gates exact); workspace suite's
`launch` helper now clicks Approve after propose. Templates.ts is
client-safe (pure data + zod). The #56 hosted apply ran green
(run 33293100915, single-signature postflight) — that scope is DONE;
#455 merged as 69faa30, deployed, probed.

## Older (2026-08-30, late night): node_runs.attempt persisted (ADR-174, task #56)

`20260830000100_node_attempt_persistence.sql` replaces
`record_node_state_as_worker` with the eight-parameter definer
(`p_attempt integer default null`; body otherwise the 20260827000200
text verbatim; ACLs restated service_role-only). Semantics: ordinary
transitions coalesce the attempt in; RUNNING→RUNNING with a HIGHER
attempt is the retry branch (counter moves + its own `node_running`
event, "attempt N" detail suffix); lower = `node_attempt_regression`,
zero/negative = `node_attempt_must_be_positive`; exact replays stay
idempotent. Worker: `graph-run.ts` records RUNNING on EVERY dispatch
(the old `attempt === 1` guard is gone) and passes the attempt on all
terminal transitions (SKIPPED stays attempt-less — never dispatched);
`graph-store.ts` retries once without `p_attempt` on PGRST202 so the
deploy window degrades to unpersisted, not failed. Chain integration:
22 test sentinels swept to `20260830000100…`, runbook total 180,
workflow scope `node-attempt-persistence` (step + options entry — the
#440 lesson) with a single-signature/definer/ACL postflight.
Projection stays deliberately deferred (graph-node-detail test states
why). **Hosted apply for this scope must be dispatched immediately
after merge** — it is safe before the app deploys (old callers
resolve), and the PGRST202 fallback covers the other ordering.

## Newest (2026-08-30, night): Chief of Staff named + plan panel (ADR-173)

`lib/factory/chief-of-staff.ts` composePlan: Kahn layers over stored
edges, ADR-172 assignments, gate list, widest-layer parallelism, counted
percent (null on empty). Build shows "Plan — composed by the Chief of
Staff" + percent-led headline; edges fetched once per watched graph from
/api/graphs/edges.

## Newest (2026-08-30, later still): specialists + evidence panels in Build (ADR-172)

`lib/factory/specialists.ts` — eleven roles bound to real capabilities/
stages; bench split by node-key words; null when nothing matches. Build
gains Agents / Independent QA / lazy Artifacts / spend / Build history
panels, all from the runs feed + artifacts route. Specialists tests pin
the catalogue to NODE_CAPABILITIES and SDLC_STAGES so vocabulary drift
fails loudly.

## Newest (2026-08-30, later): Build — conversational front door (ADR-171, task #61)

`/solutions/build` launches full_lifecycle via POST /api/graphs and
watches via GET /api/graphs/runs (Agent Trail's feed). Transcript = real
state transitions only; progress = counted node states; OPEN human gates
surface with a link to decide; unfinished lifecycle runs list on arrival.
Audit/plan: `AI/AI_FACTORY_GAP_ANALYSIS.md`. Nav pins updated in THREE
places: app-shell test, e2e console.spec nav list, pages.spec +
responsive.spec route lists — a new console page must seat in all of them.

## Newest (2026-08-30): LinkedIn/Indeed primary + ZIP-code radius (ADR-170)

"Search directly on LinkedIn / Indeed" row now sits beside the Search
button (testid primary-linkouts), recomputing the ADR-169 deep links live;
deselection under Sources still governs it. `resolvePlace` now falls back
to a 41,488-entry GeoNames US postal index (`data/postal-codes-us.json`,
server-only) — city lookups first, then \b\d{5}\b; resolved centers show
the ZIP ("Austin, TX 78701"). Journey acceptance run 33285610004 green on
main 9a73e12 re-proved the whole goal E2E list post-increments.

## Newest (2026-08-29 late night): LinkedIn + Indeed deep link-outs (ADR-169)

Owner asked for LinkedIn and Indeed "wired". The only permitted wiring is
outward: `board-search/linkout.ts` translates the current search + filters
into each site's own URL parameters (LinkedIn distance/f_TPR/f_WT/f_E/f_SB2;
Indeed q/l/radius/fromage with salary + "remote" in q per its search tips),
faithful-or-omitted per filter. The two chips sort first in "Also search on",
accented, "· your filters". Other link-outs keep the plain template —
unverified parameter mappings would be invented integrations. Partner/
publisher credentials are the only path to a real adapter; catalogue notes
say all of this.

## Newest (2026-08-29 late night): Job Search increment 5 — radius, specialty, industry (ADR-168)

Location + radius: `lib/job-seeker/board-search/geo.ts` (server-only)
over `data/cities.json`, generated from GeoNames cities15000 (CC BY 4.0
— keep the attribution). The fold in `foldPlaceName` MUST stay identical
to the dataset build's fold or lookups miss; the build script logic is
recorded in ADR-168 and the file regenerates from
`download.geonames.org/export/dump/cities15000.zip`. Radius is a
request-level, server-applied refinement (`radiusKm` beside `location`),
NOT part of the client-side instant filters — the index never ships to
the browser. The response's `unified.radius` block is the honesty
surface: applied (with excluded/unresolvedKept/remoteKept counts) or
not-applied with the reason. Alert engine: `planAlertCandidates` takes
an optional `refineUnified` hook; the run route injects
`applyRadius`-based refinement when the stored query carries radiusKm.
Specialty (`deriveSpecialty`, title-only) and industry
(`deriveIndustry`, title+company+description, keyword families, most
evidence wins) live in `unify.ts` beside seniority, flow through the
same schema/filters/chips plumbing, and drop unstated postings only
while set. Trap: the increment 4 marks migration is hosted-applied
(33273330183); nothing in increment 5 touches the database.

## Older (2026-08-29 night): Job Search increment 4 — personal marks (favorite/hide/viewed) + title-derived seniority facet (ADR-167)

`job_seeker_result_marks` (20260829000400) keys a person's favorite /
hidden / viewed marks on the posting URL under forced RLS — own-row
policies, service_role revoked, deliberately no UPDATE path (mark is row
identity; unmark = delete; both directions idempotent). Route:
`/api/job-seeker/search/marks` (GET grouped, POST upsert-ignore, DELETE
count-honest). Panel: star + Hide + Viewed badge render only after the
real marks load; "hidden by you" and "hidden by your filters" are two
separate counts; Favorites-only toggle; viewed recorded on opening the
posting, quietly. Seniority: `deriveSeniority` in `unify.ts` — title
text only, seven levels, most-senior-wins, "lead gen" excluded; wired
through the search route, panel select/chip, saved-search schema
(`nullish` so old stored queries parse) and the alert engine's
`toUnifiedFilters`. Location radius and industry facets remain honestly
unoffered — the boards expose no such data (`AI/JOB_SEARCH_SOURCES.md`).

Chain integration for the new migration: 22 sentinel sites swept to
`20260829000400…` (budget's semantic site untouched), grants-test seat
added, phase1e RLS count 146→147, runbook total 179, and the
apply-hosted-migrations workflow gained BOTH the scope step
(`job-seeker-result-marks`, sha-logged apply + boundary postflight) and
its `options:` entry — the #440 lesson. Hosted apply for this scope
still needs dispatching after merge.

## Older (2026-08-29 evening): Job Search increments 2–3 shipped end to end — alert engine live in schema, waiting only on owner env (ADR-164)

PR #437 (increments 2+3 together) squash-merged to main as `2319970` after
four real CI checks on the exact head and a fully green local suite
(455 files / 5,412 tests); Vercel deploy verified and production probed
(`/api/job-seeker/alerts/run` answers 503 `alerts_not_configured` — the
designed fail-closed state; saved-searches 401 anonymous). #440 followed:
the apply step's `workflow_dispatch` choice option had never been added,
so scope `job-seeker-alert-engine` was undispatchable — one line, merged,
then the hosted apply ran green (run `33263020948`, postflight verified
forced RLS + definer ACLs).

What remains for live email alerts is owner-side only: set
`RESEND_API_KEY`, `JOB_ALERT_EMAIL_FROM`, `CRON_SECRET` in Vercel and
redeploy (documented in `.env.example`). Until then every surface says
**Not Connected** honestly and refuses cadence writes with 409.

Traps for the next agent: the alert runner reaches the database ONLY
through the two service_role-only definer functions — never grant the
role a table; `record_job_seeker_alert_scan` takes camelCase jsonb keys
from `toDeliveryRows`; 22 tests pin the latest-migration filename as a
chain sentinel but `budget-tracker.behavior.test.ts:~423` re-applies the
BUDGET migration semantically and must keep `20260829000200…` (a blind
sweep broke it once — audit for semantic references before sweeping);
`check_suite.completed` webhooks can be false-green before real jobs
register, so gate merges on ≥4 real completed check runs; a PR whose
`mergeable_state` is `dirty` gets NO pull_request workflow runs at all —
merge the base first when CI seems to never schedule.

## Older (2026-08-29 later): Job Search increment 2 — match scores live on results, saved searches real (ADR-163 addendum)

Merged main's Job Discovery surface (ADR-141) and built on it: the search
route scores every unified card via `loadEvaluationInputs` +
`evaluateJob` (match null + stated basis when no profile row exists; the
minimum-score filter 422s in that state), logs one metering event per
board into `job_seeker_search_events`, and the panel gained match badges
with a "Why this match score" expansion, best-match sort, a min-score
filter, and a full Saved Searches card over the new CRUD route
(`/api/job-seeker/saved-searches` — double ownership filters above
forced RLS, 409 on duplicate names, sensitive-content refusal). Alert
switches remain deliberately unrendered until a delivery engine exists.
Route tests mock `loadEvaluationInputs` — a new search-route test that
forgets this will try a real client call. Increment 3 next: the alerts
engine + env-gated email adapter + delivery ledger with the
never-repeat guarantee, then real E2E acceptance.

## Older (2026-08-29): Job Search increment 1 — ten live boards, unified view, honest catalogue (ADR-163)

The active owner goal (50-source `/JobSearch`) landed its first increment.
Nine new adapters, each live-probed before its parser existed and pinned
by fixture tests (Remotive, Remote OK, Jobicy, Himalayas, Arbeitnow, WWR,
The Muse, Working Nomads, Jobspresso); the registry holds thirteen boards. `board-search/unify.ts` is the single
definition of cross-board identity and result filters, imported by both
the route (a `unified` response block with dedupedFrom/beforeFilters
counts) and the panel (instant client-side filtering, no refetch). The
52-source catalogue carries one honest status per source; every non-live
link was probed 2026-08-29 (four dead domains found in research were
replaced — verify before listing, always). The panel's unified view is
default: source badges, NEW ≤3d, sort, filter chips with Clear All,
grouped picker with **Not Connected** and outward links.

Working rules discovered/confirmed this stretch: the route test now mocks
every registry adapter — when a board joins the registry, add its mock
there or unit tests will attempt real egress; a unified card must be saved
through `sources[primarySourceIndex]` because the seal binds board + exact
job fields; catalogue and registry are held equal by an integrity test, so
neither can drift alone.

Next increments (BACKLOG "Job Search 50-source engine"): saved searches +
alerts prefs + seen-jobs migration under forced RLS, match-score display
from the Career Profile chain, then the alerts engine + env-gated email
adapter with a delivery ledger and the never-repeat guarantee, then real
E2E before any production-ready claim.

## 2026-08-29: Budget Tracker

Detail in `AI/CURRENT_STATE.md`; decisions in ADR-147 and ADR-148.

Three things the next agent must not undo:

- **The owner's real financial workbook is not in this repository, and must not
  be put there.** It was used to develop and verify the spreadsheet reader
  against real shapes, and left out of every fixture, seed and test. If a test
  needs data, construct it — `tests/unit/budget-import.test.ts` builds a
  minimal `.xlsx` in memory rather than checking one in.
- **`budget_monthly_flow` and `budget_category_spend` are SECURITY INVOKER.**
  Making either a definer hands every member of an organization every other
  member's monthly totals, past a row policy that is otherwise correct.
Both migrations are applied to hosted (run 33257354301) and the page is live.

- **The `service_role` revoke in `20260829000200` is load-bearing.** That role
  is BYPASSRLS and the hosted default privileges re-grant it on every new
  table; without the revoke the six budget tables are readable past every
  policy on them. The behaviour test grants those privileges the way hosted
  would and checks they are taken away, so it fails if the revoke is removed.

## Newest (2026-08-28 ~11:30Z): Agent Trail — a live map of the factory's runs (ADR-162)

The owner directed sodiumsun/agenttrail (MIT) be built into the site.
Adapted, not vendored: `/solutions/trail` renders each graph run as a
live dependency map — `layoutTrail` (pure Kahn layering, unit-tested),
`GET /api/graphs/edges` (member-scoped, zero migrations since
graph_edges already had a member SELECT policy), states/gates/errors/
closure notes from the existing runs projection on a 10s poll, and a
declared-vs-observed panel per node. Attribution in
THIRD_PARTY_NOTICES.md and on the page. The daemon/fs-watcher half of
agenttrail is deliberately not ported (ADR-162 records why).

Billing, same hour: the owner's one-click bootstrap ran in production —
all four lookup-keyed prices and the webhook created, both secrets read
ok, `connected: true`, and a real LIVE-mode checkout session was created
through the API. The owner reports buying Basic with a real card;
verification of the plan flip is theirs to read (RLS keeps their org's
subscription invisible to the test account — working as designed).

## Newest (2026-08-28): target claims hosted; stop before postdeploy

Cleanup release `ce86d9c04ff91f237e680a5db4b0cda97feea2ce` removed the
used production-URL acceptance workflow/test. All four exact-head jobs passed
in CI `33169913723`; GitHub deployment `6140863004` resolved to READY Vercel
deployment `dpl_4Zqh4q2yBfaagGtg7stSbV4NSphP`, and public health joined the
exact Git, deployment, Vercel-project, and Supabase identities.

Probe `33170897689` passed ledger `1|1|1|1|0|0`. First-attempt mutation run
`33170953151` applied only SHA-pinned
`20260828000200_target_bound_worker_claims.sql` and passed exact ledger,
catalog, ACL, runtime, audit, lint, health, and stopped-safety postflight.
Independent probe `33171025468` confirmed `1|1|1|1|1|0`. Never rerun selector
normalization, URL schema, target claims, or either URL-acceptance attempt.

Do not dispatch `postdeploy`: signed-in production still has no legitimate
connected Ready bot route for the required record/reload acceptance. Current
Full Lifecycle v2 also has not executed while workers remain OFF. Read-only
production browser acceptance found no page or
console errors. Existing test-data run
`884d6164-0ecd-4f93-878a-0a7ecda239e5` renders Steps 1-8 complete, then
truthfully shows Deploy refused by policy and Monitor skipped; it explicitly
lacks a verifiable current-template identity and cannot prove v2. The next
legitimate action is a connected Ready bot assignment, then signed-in Step 8/9
record/reload acceptance with workers still OFF. Only afterward apply `00300`
and read-only `verify`; current v2 execution is a separate later authorization
window. Until then, keep workers, schedules, the auth broker, autonomy, and
automatic actions OFF and the global kill switch ON.

## Newest (2026-08-28 ~09:45Z): the site sets up its own Stripe account (ADR-158)

The six-paste configuration path failed in practice: the shape diagnostic
(#427) proved the production runtime saw none of the six STRIPE_* values
across seven hours and four fresh deployments — "missing", never
"malformed", so the values simply never reached the Production
environment. The owner asked for everything to be done for them; a cloud
container cannot reach their browser, and secrets must not transit the
transcript regardless.

So the deployment now does its own setup. Prices are addressable by fixed
lookup keys with `resolvePriceId` falling back from env vars to a cached
Stripe lookup; `POST /api/billing/bootstrap` (super administrator only,
idempotent, find-first) creates the Basic/Pro products, the four
lookup-keyed prices at the advertised amounts, and the webhook endpoint,
returning the show-once signing secret to the admin's screen; the Billing
page carries the "Finish payment setup" card that drives it; and
`billingConnected` now also requires the webhook secret, because charging
while the mirror is deaf would take money without granting anything. The
owner's remaining part is exactly two pastes into Vercel (secret key,
then the signing secret the card hands them), each followed by a
redeploy — docs/BILLING_GO_LIVE.md leads with this short path.

## Newest (2026-08-28): one exact Supabase Auth account is verified; secret and bootstrap removed

Exact first-attempt workflow run `33164766560` on release
`298264b02fe5a29e3c139f8077e65d6270f19167` created or updated the requested
normalized identity in Supabase Auth project `qpuofpmagrmyamahqwxw`, then
re-read one exact UUID with a parseable `email_confirmed_at`. Its only output
was the bounded updated UUID. The temporary encrypted password secret was
deleted immediately. This forward cleanup removes the disposable workflow and
test. The result is an email-confirmed Auth identity only; it does not grant
tenant membership, owner/admin role, provider connection, or execution
authority.

## Newest (2026-08-28): application is live; apply selector normalization before the release tail

Step 8 no longer treats a provider/model mismatch or a disabled worker as an
invalid command plan. The durable record-only route accepts the assigned bot's
provider/model, and both launch and gate controls preserve exact server wake
evidence. When the global worker gate is OFF the UI says **Not Connected**,
does not enter an unbounded polling loop, and keeps a manual exact refresh.

Production containment is explicit in both control planes: GitHub variables
hold Phase 1C/graph/schedule/auth-broker execution OFF, the auth-broker run was
cancelled, and Vercel Production holds the same application dispatch gates at
`false`. The release workflow rejects mutation reruns, non-owner triggering
actors, non-main graph manual runs, active execution workflows, or any changed
autonomy/kill-switch/runtime state.

`/api/health` now joins `www.theagoras.com` to the exact Vercel project,
immutable deployment ID/URL, main SHA/ref, and Supabase project ref. The
workflow compares that runtime deployment URL to GitHub's exact Vercel-bot
Production status twice. Vercel's non-secret expected Supabase/Vercel/host and
both worker-gate variables are configured, with the worker gates explicitly
`false`. Exact `main`
`79ca52f5b92e7d95292210e05565d35d21b4a435` passed all four jobs in CI
`33158801269`; GitHub deployment `6138739479` is exact READY Vercel deployment
`dpl_57pM3ZEYNyK596VAeLPJMabJLZrH`, and public health joined it to Vercel
project `prj_pAsrhftaVWI4SyaqstgRVSWHJkdD` and Supabase project
`qpuofpmagrmyamahqwxw`.

Read-only release probe `33159805326` performed no mutation and stopped on one
exact catalog drift: the hosted Phase 1C selector body is stale MD5
`ed5840b9d8d0efdb513a8576df128e9b`; the frozen breaker-aware target is
`5933952d71f9da90a2a80a05ce6e0378`. ABI, owner, definer/search-path/private
ACL, three helper identities, and the FORCE-RLS breaker table are exact.
Migration `20260828000050_normalize_breaker_aware_phase1c_selector.sql`
(LF SHA-256
`8914034508451d1550ebf3f1bedd8f7b71592f1809306e78c57774c458952896`)
is the isolated forward-only containment. It accepts only the exact stale or
target body, verifies the surrounding catalog, replaces only that function,
and records no historical ledger repair.

Next: publish the containment, require the four exact-head jobs and exact
READY Vercel/health identity, dispatch a fresh `probe`, then apply only
`00050`. After its ledger/catalog/ACL/runtime/safety postflight passes, proceed
in order with `00100`, `00200`, and `00300`; never rerun `33159805326` or a
mutation attempt. Current gates are lint/typecheck green, 5,150 tests passed / 7
skipped across 442 files, and a 171/171-page production build.

Signed-in acceptance remains externally incomplete: the active organization
for `daniel.hughen@gmail.com` has zero connected AI accounts, ready bots, or
assignments. Finish a supported provider connection before a fresh Step 8 POST
and persisted Steps 9-10 evidence; never copy a token or account across
tenants. Workers, provider execution, autonomy, schedules, the auth broker,
and automatic actions stay OFF and the global kill switch stays ON.

Seventeen older hosted versions beginning at `20260815000200` remain missing
from the ledger while partial catalog effects exist. Reconcile each only after
complete object-by-object proof and any surgical forward compensation. Never
edit/replay history, blindly mark applied, reset, or down-migrate.

## Newest (2026-08-28): Step 10 public URL writer is locally complete

`20260828000100_project_production_url_configuration.sql` (LF SHA-256
`0856ddee447280a1bb4418f25d6a6d4650687e168fffcd5e98e8ce15edd62b27`) is the isolated
forward migration for the public project address used by lifecycle monitoring.
It leaves `update_project_details(uuid,text,text)` unchanged and adds only an
authenticated owner/admin setter, a safe-target predicate/constraint, and
postflight assertions for projects FORCE RLS plus the existing audit trigger.
The project detail page now has a dedicated configuration field and clear
unsafe-target feedback. The database independently rejects likely-secret path
material through `text_has_likely_secret`; no live project value was changed.

Vercel Production has the non-secret expected Supabase project ref configured
for the next deployment. `/api/health` will fail closed unless the runtime URL
matches it, exposing only bounded match status plus exact release SHA/ref.

Local evidence is 89/89 focused tests, including the full migration chain and
native SQL authorization/ACL/audit behavior, plus clean focused ESLint and full
typecheck. Do not call it hosted until the exact migration is applied once and
signed-in owner/admin acceptance confirms the stored value and immutable
`project.updated` event. The release must keep workers, provider execution,
autonomy, and automatic actions OFF and the global kill switch ON.

## Newest (2026-08-28): one-shot wakes are exact-target claims locally

Migration `20260828000200_target_bound_worker_claims.sql` and its worker/
workflow callers are locally complete under ADR-155. Repository-dispatch and
manual graph runs require `graph_id`; Phase 1C requires `command_id`. The UUID
is enforced inside the authoritative PostgreSQL selector before locking and
claiming, so an older or higher-priority neighbor cannot consume the wake. A
Phase 1C target that is not claimable returns no row after its target-scoped
stale cleanup, so cleanup commits and the caller can report persisted state.
Scheduled calls retain their prior global selector through null-target
delegation and remain gated OFF. All graph-worker event types plus application
wakes share a second exact global activation switch, also OFF. The graph claim exposes
`project_production_url` separately from release-lineage `deployment_url`.

Local evidence: 106/106 focused contract/behavior/unit tests passed, including
full-chain schema-security and graph-worker execution; focused ESLint and
scoped diff checks are clean. Do not call this hosted: the migration must be
published and applied once through the protected exact-hash path, then an
explicit-ID canary must prove target identity. Keep workers/schedules,
provider execution, autonomy, and automatic actions OFF and the global kill
switch ON. Full-chain tail/digest fixtures belong to the adjacent post-deploy
validation change and must move with that migration rather than being patched
independently here.

## Newest (2026-08-28): Factory v2 is live; provider route remains

The real page could wait indefinitely for the client fan-out of protected
reads before discovering the viewer was signed out. The leaf page now obtains
the same verified viewer as the portal layout, passes only its signed-in bit,
and the console renders the signed-out gate immediately without protected
reads. The viewer lookup is request-memoized and bounded to five seconds for
presentation; API authorization is unchanged. Exact `main`
`bb68659a0ee84370f83dd647ae57f4ccb83ea06c` passed all four required jobs in
CI `33149814278`; Vercel `dpl_2A2bhtevZeBY6422ZYjVGJE5SuTU` / GitHub
deployment `6137077047` is READY behind `www.theagoras.com`.

Hosted containment and lineage are accepted in runs `33150654596` and
`33150707932` after payload-free exact-manifest probe `33150619218`. The only
remaining Factory acceptance gate is provider setup: a fresh signed-in Chrome
tab as `daniel.hughen@gmail.com` has zero connected accounts, ready bots, or
assignments; one Codex connection is unfinished and Claude OAuth is incomplete.
Do not claim Steps 8-9 until OAuth, routing, a fresh POST, and persisted Step 9
correlation are observed.

## Newest (2026-08-28 ~01:20Z): Stripe keys configured owner-side; this commit is the redeploy that lets the runtime see them

After the billing release went live, the owner reported creating the
Stripe account and adding the keys to Vercel. The running deployment
still answered `connected: false` — Vercel injects environment values at
deployment creation, so keys added after a deploy do not reach it. This
commit exists to produce the next deployment; once it serves,
`/api/billing/summary` should answer `connected: true` and the checkout
test (BILLING_GO_LIVE step 7) can run. If it still answers false after
this deploys, the next suspects are the variable names and the value
shapes the catalog validates (`sk_`/`rk_` secret key, `price_` ids).

## Newest (2026-08-27): canonical Job Search is production accepted

The completed integration is on `main`. Application behavior release
`aabd82b3a626da94a2478ef26f043a51d059cd15` is bound to exact-head CI
`33114868741` and Vercel Production deployment `6130751384`
(`https://softwarefactory-14wpknnsx-surgeservices-projects.vercel.app`); the
stable alias serves `/JobSearch` as `200`. Search originally landed through
#416 (`5cfd839`). This release completes it with one canonical product entry,
current live-board contracts, sealed save provenance, transactional
persistence and signed-in production acceptance. `AI/SEARCH_MIGRATION_REPORT.md`
is the detailed source, disposition, probe and rollout record.

**Surface and source.** `/JobSearch` is canonical and **Job Search** is the
signed-in global-navigation label. `/Job-Search` and `/job-seeker/search` are
compatibility routes over the same content and gate. The entire 214-file
upstream repository is vendored byte-for-byte at exact head
`79cd383e58f0af7948c7c6462a3a289e9b67421e`, excluded from runtime/tooling.
Four safe, keyless board capabilities are adapted: Jobnet, Jobindex,
Jobdanmark and Freehire. LinkedIn remains excluded on service-terms grounds;
Jobbank is deferred until its intermittent Cloudflare/WebSearch fallback can
be made reliable and reviewed, not declared permanently impossible.

**What the direct probes and production walk proved.** Non-persistent calls through the actual
adapters returned Jobnet 2/4, Jobindex 2/736, Jobdanmark 0/0 for London and
Freehire 2/6752. Jobnet's current BFF path/order, Jobindex's nested company
shape and lack of free-text location, and Freehire's `cities` parameter are
now executable request contracts. A Jobdanmark 0/0 is a valid empty live
answer, not a parser error. Signed-in production returned Jobnet 4/4,
Jobindex 20 shown of 736, Jobdanmark 0/0 and Freehire 25 shown of 6,752.

**Trust and persistence.** Search responses mint a 30-minute sealed token per
result, bound to organization, user, board and exact normalized fields. Save
refuses missing/tampered/expired evidence. `insertScoredJob` preserves its API
but calls only `record_job_seeker_job`, supplied by local forward migration
`20260827000100_record_job_seeker_job_atomically.sql`. The authenticated-only,
exact-path `SECURITY DEFINER` function derives `auth.uid()`, checks membership,
and records job + match + initial application + immutable
`job_seeker.job_recorded` activity in one transaction. Composite owner foreign
keys close the cross-user child-reference gap. Behavior tests prove success,
dedupe no-op, child-failure rollback, outsider refusal, cross-user refusal,
ACL/search-path and forced RLS.

**Database gate passed.** Workflow run `33111692239` applied only exact
`20260827000100_record_job_seeker_job_atomically.sql` (SHA-256
`2f51bf64ba3fd2bc711e6fbf9e660a2cc0dd5ef4b1f85d932ee574e79e9c7d13`) to
project `qpuofpmagrmyamahqwxw`. Its postflight accepted the ledger, function
identity/security/search path/ACL, owner constraints, superseded-key removal,
PostgREST reload, and forced RLS. Direct INSERT remains authenticated because
the manual jobs POST route still depends on it; move that final writer to the
RPC before a later ACL contraction. Nothing here authorizes a reset,
down-migration, worker or autonomy action.

**Production acceptance.** Remote journey `33115019633` passed the
returning-account gate on exact `aabd82b`; its live sample had no unsaved row
and skipped the mutation honestly. The authenticated browser walk closed that
sample gap: all four board sections rendered, a sealed Jobnet posting was
saved, and Supabase-backed Discovery read it back `via jobnet`, score 35/100,
stage FOUND. Activity rendered one immutable `job_seeker.job_recorded` event,
entity `7637e796-b172-40d6-833f-408407b6f5b2`, at 16:55 EDT. Desktop and 390px
mobile acceptance passed with no horizontal overflow.

**Separate AI Factory Step 8 trace.** Postflight run `33114160835` verified
the current any-model record-only database contract, exact definitions/ACL,
zero-agent-run boundary and schema reload. Vercel logs showed zero new
`POST /api/commands` requests after that postflight; the owner's repeated red
message was retained state in an already-open modal, not a response from the
current release. Hard refresh/reopen/submission is the correct next probe. Do
not add or replay a migration until a failing current-deployment POST has a
request ID and proves catalog drift.

## Newest (2026-08-25 ~23:00Z): revenue — subscription billing shipped behind a Not Connected gate (ADR-149)

The owner directed a revenue avenue. What ships in this release: Stripe
subscription billing for the plans the pricing page has always advertised.
`lib/billing/` (plans, entitlements, thin Stripe REST client + HMAC webhook
verification, subscription mirror), `/api/billing/{checkout,portal,webhook,summary}`,
enforcement as HTTP 402 on project creation and graph launches past the plan,
`/pricing` cards that become checkout buttons only where a configured price
stands behind them, and `/solutions/billing` under Settings. 56 tests in six new
files, plus quota regressions inside the existing launch- and
project-route suites.

**Released 2026-08-28 (owner-directed):** both migrations hosted-applied
apply-first and postflight-verified — `runs-closure-note` (20260825000300,
ADR-148) in run `33131066501`, `billing-foundation` (20260825000400,
ADR-149) in run `33131128140` — then PR #421 squash-merged as `98ef9b2`.

Until the owner completes
`docs/BILLING_GO_LIVE.md` (Stripe account, restricted key, four price ids,
webhook secret, `SUPABASE_SERVICE_ROLE_KEY` on Vercel, redeploy), every
billing surface renders **Not Connected** and the storefront behaves exactly
as it did before this change. The webhook is the only subscription writer;
browsers hold zero Stripe keys and zero write grants on billing tables.

## Earlier (2026-08-25 ~20:00Z): the run that never said why (ADR-148; 147 was taken by Job Search on main)

Defect #11, from the same live queue read. `graph-run.ts` composes a
run-level explanation on every close — the fan-in assessment, the "this
run is void" statement, and the correction that gate-halted nodes did
not fail — and its own comment says the record should carry it "rather
than leaving the correction to whoever happens to know the distinction".

It was left to whoever happens to know. The message reached
`completeRun`, whose parameter was named `_detail` because nothing read
it: the RPC had no parameter and `graph_runs` had no column. Ten
CANCELLED runs in the live queue state no reason at all.

Migration `20260825000300` adds `closure_note`, the writer stores it, and
`list_graph_runs` projects it. **Apply the migration before deploying the
code** — the new parameter is defaulted, so the currently deployed
seven-argument call still resolves, but the reverse is not true. The
apply scope is `runs-closure-note` in `apply-hosted-migrations.yml`.

Two collisions were caught during this change and are worth knowing
about: #416 landed `20260825000200` while this was in flight, so the
timestamp was taken (renumbered to `000300`) *and* its rebuild of
`list_graph_runs` would have been reverted had this file been rebuilt
from the older `20260823001000`. Twenty-one tests pin the newest
migration filename; they are re-pointed here.

## Earlier (2026-08-25 ~19:15Z): the retry that never happened (ADR-146)

Inspecting the live queue rather than re-running green tests turned up
defect #10, and a second defect underneath it. Runs `28b4dedf` (06:02Z)
and `bfb6e0e7` (06:08Z) — the same graph, six minutes apart — lost six
nodes between them to `API Error: 529 Overloaded`, and not one of those
six was ever retried. `isCapacityRefusal` matched session limits and 529
alike, and the executor spends no attempts on a capacity refusal, so the
one error whose own text says "try again in a moment" was the only class
that never got a second attempt; a plain transport failure got three.

Underneath it: `RetryPolicy.backoffMs` was declared, defaulted to 2000ms,
dropped by the compiler, and read by nothing. Every graph retry the
engine has ever performed fired into the instant that had just refused
it — so fixing the classification alone would have bought nothing.

Both are fixed in ADR-146. `isQuotaRefusal` (never retried, waits for a
named reset) is now separate from `isTransientOverload` (keeps its
attempts); their union still drives the run's void decision, so an
overload that exhausts every attempt still leaves a lifecycle CANCELLED
and claimable. `backoffMs` reaches CompiledNode and the runner waits it,
once per scheduling round rather than once per node.

Four cases fail without the change; they were run red before green.

## Earlier (2026-08-25 ~17:30Z): the live ten-step walk is complete

The 17:20 window finished it. Run 895b1918 executed REVIEW and halted at
the TEST anchor's automatic gate; that gate self-decided on its anchored
evidence, and run 884d6164 then reused twelve stages and recorded DEPLOY's
Phase-1 policy refusal with MONITOR blocked behind it. Lifecycle 1f9defa2
has now run all ten steps live: steps 1-8 COMPLETED with real model calls,
step 9 terminating on policy, step 10 correctly blocked. Verified through
/api/graphs/runs as the signed-in user who launched it, not from logs.

Both intermediate voids were capacity refusals recorded as CANCELLED, and
ADR-144's watermark let the approved ARCHITECTURE gate survive them — the
fix proven live twice. ADR-145's 48-turn budget carried IMPLEMENTATION,
which had exhausted 24 turns twice before.

Nothing on the ten-step goal is outstanding. The next lifecycle work is
whatever the owner asks for; a Phase-2 deployment instrument is what would
let step 9 pass rather than refuse.

## Earlier 2026-08-25 (parallel branch): the graph branch was parked for Search

**Branch reset, deliberately and with the owner's direction.**
`claude/ui-simplification-cbyx5t` was reset onto `main` to build Search. The
ten-stage graph work that was on it — PR #347 — is preserved on
`claude/graph-ten-stage-backup` at `786d1ef`. It was 39 commits behind a
fast-moving `main` and largely superseded: `main` had independently shipped its
own ten-stage lifecycle (#370, #372, #374, #375, #385–#388, #399, #401),
including marking ADR-136 superseded itself. Anything still wanted from #347
should be taken from that backup ref, not from the PR.

The Search status recorded here at the time (fixture-only, Jobdanmark unported,
no migration) is superseded by the 2026-08-27 handoff above. Jobdanmark is now
adapted, all four adapters have direct live probe evidence, and atomic audited
persistence requires a new local forward migration. Attribution remains in
`THIRD_PARTY_NOTICES.md`; exact current disposition is in
`AI/SEARCH_MIGRATION_REPORT.md`.

## Earlier (2026-08-25 ~12:55Z): the live walk reaches step 6, and ADR-145 is proven live

The 12:20 window carried lifecycle 1f9defa2 (the fake user's, launched
through POST /api/graphs) from two stages to SEVEN, all from genuine model
execution: GOAL, PRD, the three DISCOVERY scans + consolidate, EVALUATION,
DECISION, ARCHITECTURE — whose HUMAN gate was approved through the product's
own /api/graph-gates/{id}/decide as the signed-in user — and IMPLEMENTATION,
which ran fresh and succeeded under ADR-145's 48-turn budget. That is the
turn-budget fix proven live: the same node exhausted 24 turns twice before.

Steps 7-10 remain: review hit the session limit (resets 17:20Z) and run
4a426a14 voided CANCELLED, which is correct. Trigger
trig_01WayphjizZz23QDwAqPVhaM (17:21Z) carries the finish.

Budget the finish accordingly: only ONE of the four remaining nodes costs
provider capacity. `review` is the last MODEL node in the template; `test`,
`deploy` and `monitor` are all ANCHOR executors, which make no provider call
at all — test reads CI's verdict, deploy records the Phase-1 policy refusal,
monitor probes the live surface. So the walk is one model call from its
terminal, not four, and a single short window finishes it. The drain stopping
on review is what defers the three anchors behind it, not their own cost.

Separately, and NOT this user's walk: graph 0dafc3b9 belongs to another
organization. The same drain carried it the whole distance, and its run
050b35e5 recorded DEPLOY failing on the Phase-1 policy refusal —
"deployment execution is owner-approved in Phase 1 and no deployment
instrument is wired. This refusal is the policy holding, not a fault." —
with MONITOR blocked behind it, after its TEST anchor gate self-decided.
That is the designed step 9/10 terminal observed live, but it is visible
only in the worker log: this user is not a member of that organization and
cannot verify it through the product. Report it as such, never as ours.

## Earlier (2026-08-25 ~08:30Z): fresh lifecycle 1f9defa2, launched by the product, walking the ten steps

d7241cf4 is PARTIAL-retired (implement's two 24-turn exhaustions were
genuine failures; the re-plant machinery is per-graph data migrations,
not automatic). The live walk continues on a FRESH lifecycle the fake
user launched through the real product API (POST /api/graphs,
templateKey full_lifecycle, project 51af87ae): graph 1f9defa2. Its
first window (run c1576809) completed GOAL, PRD and all three DISCOVERY
scans for real, then consolidate hit the session limit (resets 12:20Z)
and the run voided CANCELLED — the five stages reuse at zero cost next
window under ADR-144. One-shot trigger trig_01HweQJNJBeJ6d6TZcojkm43
(12:21Z) carries the continuation: consolidate→architecture halt →
fake-user gate approval → implement under ADR-145's 48 turns → review →
TEST anchor self-gate → deploy refusal terminal → final verdict.
Windows appear to reset every 5 hours (02:20/07:20/12:20).

## Earlier (2026-08-25 ~07:45Z): defects #6 and #7 — turn budget and the guard crash (ADR-145)

The 07:20 window's drain (run 32821441484) surfaced two more defects.
Implement exhausted the flat 24-turn budget twice (run f200de80; the
nine upstream stages reused at zero cost — ADR-143/144 both held) and
d7241cf4 closed PARTIAL-retired. Then graph 0dafc3b9 (un-stranded by
ADR-144) hit the artifact sensitive-data guard with a real output and
the raw throw killed the drain; its run sits RUNNING until the 2-hour
reclaim (~09:37Z). Fixes: transport ceiling 24→48 with
IMPLEMENTATION_NODE_MAX_TURNS=48 (others keep 24, all pinned against
the ceiling), and the engine now writes the artifact before COMPLETED
so a guard refusal fails exactly that node with a payload-free message
(worker-execution regression + transport/executor pins). After merge,
the next dispatch re-plants d7241cf4's successor with the measured
envelope (the re-plant machinery) and implement runs under 48 turns.

## Earlier (2026-08-25 ~03:35Z): ADR-144 proven live — nine stages reused at zero cost

#398 merged (72f13b2), scope gate-approval-voided hosted-applied and
read back (run 32805322660). The next dispatch claimed the previously
stranded d7241cf4: run 04e5f69f reused all nine recorded stages —
goal, requirements, the three scans, consolidate, evaluate, decide,
and the approved gate-halted architecture — at zero cost, and executed
implement, which failed only on the session limit (resets 07:20Z). The
projection (verified as the fake user via /api/graphs/runs) shows the
nine stages COMPLETED, architecture passed through its approved gate.
8 of 10 run slots used: do not dispatch before the reset. A one-shot
trigger (trig_01MxgLSJ385g85oDpcpEtVr7, 07:21Z) carries the finishing
plan: implement→review→test, TEST anchor self-gate, deploy refusal
terminal, fake-user + live-page verification, final ten-step verdict.

## Earlier (2026-08-25 ~03:00Z): defect #5 found and fixed — a void consumed a gate approval

The 02:20 window's live drive surfaced the fifth engine defect. Graph
67a8fdda (an older org's lifecycle at the queue head) executed 8 real
stages and halted at its ARCHITECTURE gate — correct. But d7241cf4 was
NOT claimable after it: the queue diagnosis said "no fresh gate
approval" because the approval (after the 6152cee2 halt) was compared
against the capacity-voided e3c4b582 run's close. ADR-144: the
watermark now counts answers only (migration 20260825000100, tail pin
moved, 163 total; workflow scope gate-approval-voided, sha
ff38feb9…f324e; queue-diagnosis mirrored; regression in the
worker-execution suite + a diagnosis unit case). After merge: hosted-
apply the scope, then dispatch graph-worker.yml — d7241cf4 then reuses
its nine recorded stages and runs implement→review→test. 67a8fdda's own
ARCHITECTURE gate awaits its org's owner on the product pages.

## Earlier (2026-08-25 ~02:15Z): the ten-step goal — consecutive E2E landed, dev seed added

The owner's active /goal asks for the ten factory steps fully functional,
Supabase-backed, seeded, and tested end to end. Mapped: the flow already is
the full_lifecycle graph (STEP 1's empty state carries the real launch
control; gates decidable on the step pages). Landed this window:
`tests/integration/ten-step-consecutive-flow.behavior.test.ts` (one request
drained to COMPLETED across gate-halted windows — all eleven stages closed
with artifacts, exactly-once execution, gates + audit, identical refresh
projection, outsider refused) and `npm run seed:dev`
(`scripts/seed-dev-lifecycle.mts`, idempotent, dev_seed-labelled,
production-refusing). Open: the seed has not run against a live dev stack
(no Docker here — guards exercised, drive path is the tested one); the live
lifecycle d7241cf4 still needs its implement→monitor hops via the
graph-worker dispatch on main (the 02:21Z trigger carries the plan). Also
merged: #396 (factory step board detail + truthful fixture states + 320px
tile stacking), deploy-verified on production.

## Earlier (2026-08-24 ~22:50Z): the owner's navigation — ten factory step pages

The owner's next /goal: match the navigation image (01. Factory Setup +
02. AI Factory with ten numbered steps) and build each step page
production-ready. Delivered: nav restructured (only rename + new group —
everything else already matched), the AI Factory page retitled, ten step
pages at /solutions/factory/[step] over the newest lifecycle run with
gates decidable in place, factory-steps mapping (total/exclusive, tested),
shared stage-content readers extracted. Fixtures updated: consoleNavigation,
app-shell nav test, ai-factory title pins, responsive sweep, harness
"factory-step" case, component-layout list.

## Earlier (2026-08-24 ~22:00Z): the 21:20 window proved and closed the next gap (ADR-143)

The window's live walk advanced the test lifecycle and found the fourth
structural defect in the engine. Run 6152cee2 executed architecture for
real and halted at the ARCHITECTURE human gate; the gate was approved as
the fake user (gate cc334aaa, APPROVED, truthful "nothing runs until
dispatch" note); and the re-dispatched claim re-executed architecture
from scratch — a gate-halted node is VERIFYING, and the resume read only
offered COMPLETED — burning the remaining window (run e3c4b582,
session limit "resets 2:20am (UTC)"). Fix: 20260824001100 widens the
resume read to (COMPLETED, VERIFYING); gates still govern advancement
(OPEN halts at zero cost, REJECTED fails, APPROVED passes through).
Behavior-tested end to end in pglite. Hosted scope resume-gate-halted
must be RUN, then the finish fires at the 02:20Z window: dispatch →
architecture + the eight stages all reuse → implement/review execute →
TEST anchor self-gate → DEPLOY policy refusal terminal.

## Earlier (2026-08-24 ~20:20Z): the owner's step page, per run and per stage (ADR-142)

The owner sent design boards for a per-run "1. REQUIREMENT"-style page and
directed building it. Delivered as
`/solutions/lifecycle/run/[graphRunId]/[stage]`: request verbatim, linked
ten-step strip from the run's own nodes, recorded artifact payloads rendered
as the breakdown (typed packages structurally, everything else verbatim
JSON), verifications, the shared gate decision, real clocks only. New
migration 20260824001000 (`list_graph_run_artifacts`, authenticated-only) +
`GET /api/graphs/runs/[graphRunId]/artifacts`; hosted scope
`run-artifacts-read` added and MUST BE RUN on hosted before the live page
can show payloads (the page renders and is honest about the artifact read
failing until then). Stage detail run rows link into the new page.

## Earlier (2026-08-24 ~19:20Z): the lifecycle stage cards are actionable

The owner's latest /goal: the eleven cards on /solutions/lifecycle were
static; make each actionable and complete the ten-step Graph Engineering
process through that page. Delivered: the stage index now carries the
Workflows page's `GraphLaunchControl` (full_lifecycle) at the top, and any
stage holding an open gate offers Approve/Reject on its own card — the
shared `components/graph/gate-decision.tsx`, extracted from the runs panel
so both surfaces post to the same route with the same wording. Stage pages
offer the decision on the node row. The open-gate scan is newest-run-first
and deliberately still finds an older PARTIAL run's open gate — that is the
resume case ADR-141 built.

Live thread to finish: lifecycle graph d7241cf4 resumes at the ~21:20Z
subscription window (trigger armed) — architecture executes (8 nodes reuse
recorded results), the ARCHITECTURE human gate is decided from the new
lifecycle card as the fake user, then implement/review, the TEST anchor's
self-approving gate, and the DEPLOY policy refusal terminal. The Demo Data
project 51af87ae was re-activated after the clear-control test archived it
(unarchive via /api/portfolio/controls, verified status "active").

## Earlier (2026-08-24 ~01:50Z): the first live lifecycle found the gate deadlock; fixed, applied, re-running (ADR-140)

The owner said the end-to-end "is not working" and directed a test-data
walk with fixes in place. Delivered so far: the Launch card was buried
and is now first on the Workflows page (#381); the fake journey
workspace has a seeded Demo Data binding chain (e2e-test-data.yml,
owner-approved) so the whole path is drivable with test data; the first
live full_lifecycle run (graph 91959362) claimed, executed its goal node
through the real subscription transport, and deadlocked at the PRD
automatic gate — an undecidable wall, the same one that froze the five
old agentic_sdlc graphs. #382 fixed it (automatic gates only on anchors;
decide_automatic_gate_as_worker; truthful gate-halt reporting) and the
migration is applied on hosted. A fresh test-data graph (10fe2b0d) is
draining now; expected path: model stages → ARCHITECTURE human gate
(approve as the fake user) → implement/review → TEST anchor with the
self-approving gate → DEPLOY policy refusal → PARTIAL, the honest
Phase-1 terminal.

## Newest (2026-08-23 ~23:00Z): the launch button wakes a worker that can run anchors (ADR-139)

The owner launched `full_lifecycle` from the Workflows page and it sat
PLANNED. Two fixes, both tested: `POST /api/graphs` now wakes the graph
worker best-effort after creating the graph (`workerWoken` in the
response, wake failure can never fail the launch), and the worker declares
ANCHOR — `lib/worker/anchor-node-executor.ts` executes anchors as
observations (TEST = CI's recorded check-run verdict for the checked-out
commit; MONITOR = production HTTP probe of
`SOFTWAREFACTORY_PRODUCTION_URL`; DEPLOY = policy refusal on the record,
Phase 1 keeps deployment owner-approved). Workflow gains `checks: read`
and the two instrument env vars. Next live step after merge: dispatch
`graph-worker.yml`, watch the owner's planned lifecycle drain to the
ARCHITECTURE HUMAN gate, and hand the decision to the owner — the gate
appearing is the design succeeding. The owner then asked for a
step-by-step guide plus an end-to-end test of it: `docs/
FULL_LIFECYCLE_GUIDE.md` is the guide, and walking it surfaced five more
gaps, all fixed and merged — stale "no executor is connected" wording on
the Workflows page and launch control; gate approvals stranding the run
(the decide route now wakes the worker on approvals, `workerWoken`
reported truthfully); "nothing ran" now printing a per-graph queue
diagnosis (#378); and the TEST anchor honoring
SOFTWAREFACTORY_REQUIRED_CHECKS so main's permanently red Supabase
Preview cannot veto verified commits (#379). The diagnosis settled the
owner's stuck launch: it never created a graph (pre-deploy click) — the
one remaining live step is the owner pressing Launch on the current
build, which now wakes the worker itself. Production verified current
via the fake journey account: sign-in lands on /decision, the Workflows
page serves the new launch card and full_lifecycle.

## Earlier (2026-08-23 ~01:15Z): a record-only Claude command now launches one real analysis run (ADR-128)

The owner directed that Step 9 must actually run the bot. The delivered
answer keeps every boundary: a record-only Claude command now launches its
one analysis graph (goal = the command's stored prompt), the application
wakes the graph worker by repository_dispatch, the subscription transport
executes MODEL nodes read-only, and Step 9 plus the Bots request card
report the run state exactly as the database holds it - "Waiting for a
worker to pick it up" no longer appears for work no worker could ever pick
up. Migration `20260823000100_command_analysis_graphs.sql` (link table +
launch + list, all fail-closed, hosted-default-privilege postflight
in-file) ships behind one-shot `scope=command-analysis-graphs`. Repo-write
execution stays exactly where it was: the manual Codex lane
(openai/gpt-5.3-codex), currently disabled by the
`SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` repo variable. Remaining for the
live acceptance: deploy, hosted apply, the owner re-issues a command with
the Claude bot, the analysis run completes, Step 9 shows it.

## Earlier (2026-08-23 ~00:50Z): Step 8/9 record-only accepted; the real-run path is measured and owner-gated

The owner confirmed Step 8 passes and Step 9 shows the truthful record-only
view (screenshots, 2026-08-23 ~00:27Z), then set the next goal: Step 9 must
actually run the bot. Probe 32608500364 measured the whole execution path:
the only bot is `Claude - Daniel` (anthropic/claude-opus-5, ready, connected
subscription) which records-only by design; no Codex bot or OpenAI account
exists; every project's GitHub binding is healthy; the sole manual run ever
(2026-08-13, run f4594556) failed in the CLI-stdin era
(`Codex Exec exited with code 1: Reading prompt from stdin`) - the current
adapter is SDK-based (`thread.runStreamed`), and `claim_phase1c_run` claims
only `queued` runs, so that failure cannot repeat or resurrect. The
subscription-authenticated GitHub Actions Codex worker last ran green on
2026-08-21 21:54Z (auth valid, idle) and is currently disabled by repo
variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED`. Only RED commands await
approval; GREEN/YELLOW queue tasks and runs immediately, and the Step 9 UI
already renders the manual execution path. Remaining enablement is entirely
owner-side: connect the ChatGPT/Codex account, create/assign/configure a
`openai`/`gpt-5.3-codex` bot, re-enable the worker variable, and issue the
command with that bot. Autonomy stays OFF; manual owner-issued execution is
by design not gated by the kill switch.

## Earlier (2026-08-23 ~00:30Z): the protected chain is applied on production

Chain run 32607123713 committed the six-file transaction: the rehearsal
passed with a clean lint for the first time, all six ledger rows
(00300/00850/00900/01000/01100/01200) recorded once each, and the
fourteen-identity contract read back unchanged. The record-only routing is
live in the hosted database. The step then refused at the post-commit
RECORD_ONLY_READY check; the detail probe (32607361788) showed hosted's
posture matches every measurable expectation, and replaying the exact gate
query on the clean local full chain reproduced the refusal - the pinned
contract md5 for list_factory_commands matches no database. The pin is
corrected (true identity 162d47956f98e7b005c7abe1df680ee9) and read-only
`scope=record-only-postflight` re-runs the three unreached post-commit
verifications plus health and the PostgREST reload (ADR-127). Run
32607902289 read them all back green: "Record-only chain postflights
verified on the applied production database; PostgREST schema reload
requested." Remaining: only the signed-in production Step 8 record-only
acceptance and truthful Step 9. Workers, autonomy, and automatic actions
stay OFF; the global kill switch stays ON.

## Earlier (2026-08-22 ~23:45Z): the lint ran, found one real warning, and both are fixed and machine-verified

With ADR-125's trigger relations in place, chain run 32604992678 completed
the rehearsal lint for the first time and the gate refused honestly on one
genuine finding: `agentos_resolved_agent_grants` initialized its
`agentos_network_mode` variable from a bare text literal (plpgsql_check
42804). The initializer now carries the explicit enum cast in both creator
copies (20260814000300 and the restore copy in 20260822000900), 00900's
source pin moved to `a1231a4a5329b1dab132b6e774d97bb3`, and the frozen
REPAIR sha to `512869badb...f694`. The same run proved the gate's plain
non-emptiness test could never pass - rehearsal stdout legitimately carries
blank lines from void-returning SELECTs - so findings are now
sentinel-prefixed `LINTROW|` rows with every field coalesced, and the gate
greps for the sentinel (ADR-126). Everything was verified in the supabase
postgres 17.6 image before pushing: all 148 migrations apply, both creator
paths produce the pinned md5, and the whole 27-function roster lints with
zero findings. Full vitest suite: 4274 passing.

## Earlier (2026-08-22 ~23:00Z): every input gate passes; the rehearsal lint itself was the last defect

After the audit-guard contract (run 32599987697), the AgentOS partial-
foundation cleanup (run 32601173685, ADR-123), and the submit_command
carry-forward (run 32602669547, ADR-124), chain run 32603384774 passed every
prerequisite, history, catalog, containment, and input gate for the first
time - and then aborted inside the rehearsal transaction on
`missing trigger relation`. That error is plpgsql_check refusing to lint a
trigger function without the relation that types NEW/OLD; the lint passed
`0::regclass` for all 27 roster functions, three of which are trigger
functions, so the clause could never complete against any database and had
simply never been reached before. The rehearsal's `begin;` aborted with it,
so nothing committed. The lint rows now carry the relations
`20260822001000` pins in its own trigger_expectations
(`normalize_phase1c_command()` -> `public.commands`;
`plan_phase1c_task_and_run()` and `queue_phase1c_run_for_task()` ->
`public.tasks`), and `scope=probe` gained a rolled-back
create-extension/lint/rollback block that proves the mechanics on hosted
plus a residue readback (ADR-125).

Operator order: dispatch `scope=probe` for the lint-mechanics evidence, then
under exact-main CI green and READY Vercel identity on the new tip dispatch
`scope=factory-any-model-record-only`, then capture the signed-in production
Step 8 record-only acceptance and truthful Step 9. Workers, autonomy, and
automatic actions stay OFF; the global kill switch stays ON.

## Earlier (2026-08-22 ~21:30Z): the containment gate is honest and its last hosted input is contracted

The protected `factory-any-model-record-only` release walked through four
fail-closed refusals today, each isolated by extending `scope=probe` with a
clause-by-clause report (ADR-122). In order: the sixteen-function pre-repair
gate (resolved by `20260822000850` inside the chain); the containment gate's
two audit-evidence clauses, which demanded change events the platform forbids
from ever being written (now trail-agreement: the newest relevant event, if
any, must agree with the contained state); the owner's runtime posture in the
active workspace — the owner engaged the global kill switch and turned
Autonomous Mode OFF through the Safety page at ~21:11Z, writing the real
events the gate reads; and finally `reject_mutation_function_posture f`,
which had two causes at once: the gate compared the guard function's source
with space-only `btrim` against a body that begins and ends with newlines
(false on every database, fixed to trim `' \n'`), and hosted Supabase default
privileges left `service_role EXECUTE` on the guard that 20260812000300 never
revoked. `20260822001300_contract_audit_guard_function_acl` behind
`scope=audit-guard-acl-contract` removes that grant, fail-closed on any
unknown state, no-op on the clean replay.

Operator order: dispatch `scope=audit-guard-acl-contract`, then under
exact-main CI green and READY Vercel identity re-dispatch
`scope=factory-any-model-record-only`, then capture the signed-in production
Step 8 record-only acceptance. Workers, autonomy, and automatic actions stay
OFF; the global kill switch stays ON.

## Newest (2026-08-22): the Backlog and All Pipelines pages can be cleared

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

## Newest (2026-08-22): any model records safely; only exact Codex executes

The current release candidate resolves the Step 8 provider/model dead end
without pretending that every provider has an executor (ADR-115). Exact
`openai` / `gpt-5.3-codex` is still the only executable Factory identity. Every
other valid bounded pair, including Claude and alternate OpenAI models, is
`record_only`: command, task, immutable route, and disposition persist, while
the database and application both guarantee zero `agent_runs`, no worker
dispatch, and no branch, commit, pull request, merge, or deployment. Invalid
identities still fail closed. A nondefault `SOFTWAREFACTORY_CODEX_MODEL` also
fails before planning; do not use environment configuration to claim a second
executable model.

Step 8 now completes on durable recording. Step 9 consumes project-scoped safe
command history and explicitly reports that a `record_only` command has no run,
worker, branch, or PR by design. Reload must preserve the same project-only row,
and the projection must not reveal raw parameters.

Hosted migration `20260822000600_route_bots_onto_the_executable_model.sql` is
already applied. The protected database tail is not: `00300`, ACL normalizer
`00850`, `00900`, and `01000`, plus forward ACL containment `01100` and
`01200`, remain pending as one atomic forward-only chain. Apply them only through
`scope=factory-any-model-record-only`, after exact-main/READY-Vercel identity
and all immutable prerequisite, catalog, lint, health, and containment checks.
The owner directly requested this release in the active task; ADR-116 removes
the old magic RED phrase, predeclared-SHA, expiry, and repeat-approval ceremony
without weakening any technical or product/runtime gate. The workflow rehearses
the same six files under rollback
before the one transaction that records all six ledger rows. `00850` first
converges the exact four-function hosted ACL input: it restores required
`service_role` execution on `claim_provider_connect_session` and removes the
unintended service-role grants from normalize-configuration, claim-anchoring,
and pipeline-area validation. It preserves every function identity and keeps
the claim function's hosted `organization_id`/`purpose` OUT contract and OID.
`01100` removes
the exact hosted `service_role EXECUTE` overgrant on
`apply_resume_extraction(uuid,text[])` that the immutable `00500` left behind;
`01200` does the same for both clear-control functions left by immutable `00800`.
The retired standalone `00300` path must not mutate, and `scope=all` must not
introduce any member of the chain.

This is not a deployment handoff yet. No final candidate SHA, green exact-head
CI set, matching Vercel deployment, hosted atomic apply, or signed-in production
Step 8 -> Step 9/reload proof exists. Keep workers, autonomy, and automatic
actions OFF and the global kill switch ON. The next operator must freeze exact
identities, publish and verify the application, run the protected atomic scope,
then capture Claude/alternate-model project-scoped acceptance before using
"deployed" or "production ready."

## Prior (2026-08-22): every command was being refused, and why

`Issue a Command` refused every submission in every workspace with
`PROVIDER_MODEL_MISMATCH` — at the last step of the journey, after a project, a
pipeline and a bot had all been chosen. Nothing was misconfigured. The plan
fixed `gpt-5.3-codex`; `ensureProviderBot` named new bots `gpt-5.1-codex` from
the catalog's list; routing and `submit_factory_command` both compare the pair
exactly. One fact in two files, with nothing tying them.

`executionModel()` is now that tie (ADR-114), provisioning asks it, the roster's
picker marks each model **runs** or **cannot run**, and the refusal names the
bot, both models, and where to change one.

At this historical checkpoint, migration
`20260822000600_route_bots_onto_the_executable_model` was still outstanding.
It is now hosted; do not rerun it. The current pending database action is the
atomic ADR-115/ADR-118/ADR-120/ADR-121
`00300 -> 00850 -> 00900 -> 01000 -> 01100 -> 01200` scope described above.


## Prior (2026-08-22): application deployed; repaired database sequence local

Exact commit `30d7e824691bdd4f8fa72481b21c91d3da6e3a31` is current
`main`, with `surgeservicesllc <surgeservicesllc@gmail.com>` as author and
committer. Vercel production deployment
`dpl_FrvCToHvFhkzfwnkmEeeTyfuE3v2` is READY at
`https://softwarefactory-116001qbk-surgeservices-projects.vercel.app` and owns
the stable aliases. GitHub deployment `6036292508` and status `17160408639`
bind that production deployment to the exact commit.

Exact-head CI run `32570540183` is red. Browser/accessibility shards 1/3, 2/3,
and 3/3 passed; quality job `97025270055` failed during tests and skipped build.
The LF Linux/PostgreSQL chain reached `20260822000150`, where all seven legacy
routine hashes failed because `pg_proc.prosrc` line endings were not
canonicalized. Supabase Preview check `97025325852` failed separately at the
older provider-credential migration because `provider_credentials` already
exists, the same pre-existing preview drift seen on earlier heads.

The local repair canonicalizes CRLF and lone CR to LF before every
`md5(prosrc)` comparison and pins these exact repository files:

- 00150 —
  `6b24b6ebb57e59b9c4398c3e439221c27c300663a7b6932ff192996ffe6bcd93`;
- 00200 —
  `658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`;
- 00300 —
  `79914bc97660eef908b6a0fa0c90abfdd15da1683b383ad568e34bf3bd32c5f7`.

Native PostgreSQL 17.10 and 18.4 full chains pass. Before hosted action, record
the exact forward-commit identity and require green CI plus fresh RED authorization. No hosted
database mutation has occurred: 00150/00200/00300 remain absent, CONTRACT was
not dispatched, and no apply, ledger insert, repair, reset, or down-migration
followed `30d7e824`.

Historical containment evidence remains valid: exact predecessor commit
`4fc18d3e5ecba6f362f14a7459e588a74a84b84b` reached READY deployment
`dpl_8yngqtjJkNbexxWAMfAhZtEf1RWU`; EXPAND run `32568221857` then stopped at
`LEGACY_CATALOG_READY` before its apply notice, DDL transaction, ledger insert,
or PostgREST reload. Never rerun that old EXPAND path.

## Newest (2026-08-22): Claude bot identity and Role assignment

The application portion is deployed at `30d7e824`; its protected database
sequence is not. AI Factory owns the one application
modal/backdrop/focus/close boundary. `ProjectBots`, its assign/configure/edit
states, and zero-role onboarding render inline inside that overlay instead of
opening nested dialogs. A zero-role organization sees the reviewed Backend
engineer starter selected by default; the complete template is submitted to
the existing same-origin manager-only `/api/bot-roles` boundary, and its exact
returned UUID is applied only to selected drafts with no role. Do not conflate
that role with the Developer permission preset used for a new posting. Existing
postings retain their authored role and configuration; with existing roles, a
new posting prefers the preset-matching slug before the first available role.

The owner screenshot exposed a UI-only identity shortcut: `ProjectBots` used
`credentialRef` similarity to hide the exact-link repair control. An unbound
Ready legacy bot could then be assigned while AI Factory correctly kept steps
5-7 incomplete. The local fix removes that inference, exposes the existing
exact `/api/bots/connect/provision` Link-or-repair/adoption path, awaits the
parent refresh, and provides an accessible **Return to AI Factory** action. The
affected completion predicate remains: connected account + exact
`aiAccountId` + current Ready + project assignment.

The containment is frozen in the current unpublished candidate. Focused UI
passes 75/75; focused ESLint, full typecheck, and lint/typecheck/build are green. The root
full suite passes 337 files / 4,054 tests, with 3 files / 7 tests skipped. Its
first contention-only `supabase-wiring` timeout cleared isolated 2/2 and on the
full rerun.

Migration `20260822000200_register_bot_for_ai_account.sql` is frozen at SHA-256
`658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`.
`ensure_ai_account_bot` derives provider and credential slot from the exact
tenant account and returns a bot UUID bound to it. A default/non-additional
request reuses the account's bound bot or adopts at most one unambiguous legacy
bot in place; an explicit additional request creates another distinct bot with
the same account binding. Incoherent future writes are refused. Bot and
assignment revisions initialize at 1 and advance on every update. Checked assignment,
configuration, status, and model/work-effort writes lock and compare exact
assignment id, project id, and revision, and released postings reject further
checked edits. Existing grants are patched rather than rebuilt; the client
still requires the exact RPC result and committed readback.

`record_bot_readiness_preserving_disabled` is service-role-only and carries the
initiating owner/admin actor. Under row lock it compares exact bot revision,
account UUID, provider, model, credential reference, and base URL; stale
evidence fails, a check cannot author Disabled, and an existing Disabled value
survives unchanged. `bot.registered` and adoption-path `bot.updated` immutable
events include the exact `ai_account_id`. This is an EXPAND migration: legacy
registration/assignment/readiness definitions, signatures, `SECURITY DEFINER`,
pinned search paths, and exact ACLs remain unchanged. All six legacy mutation
RPCs temporarily retain authenticated-only execution so the deployed old app
survives migration-first cutover; checked wrappers and the service-only recorder
are additive. That is a bounded compatibility bypass, not the final contract.
Revoke those grants only in a separately approved forward CONTRACT migration
after the exact replacement app is deployed and accepted.

The read side filters released history in SQL and keyset-pages open assignments
by UUID until an empty terminal page. It does not treat a short page as final,
and invalid cursor progress or the 100-data-page guard fails the entire roster,
so incomplete data cannot mark the assignment-derived Assign/Configure steps
complete. Connect separately proves connected account -> exact account-bound
Ready bot; overall Factory evidence continues through the exact selected
project and revision-checked active configured posting across reload.

Broker start/retry/close/unmount cleanup is serialized. Exact session UUID and
generation fence every poll/callback; late superseded results are ignored.
Retry cancels before starting anew. Close blocks a racing retry, waits for an
in-flight start's exact session id, and refuses to dismiss/resumes polling when
cancellation cannot be confirmed.

Prepublication local gates and the three exact-head browser shards remain useful
evidence, but the failed quality job is the controlling release result. The
application was pushed and deployed; the protected database sequence was not.
The workflow verifies separate exact files and ledger/catalog boundaries for
00150, 00200, and 00300, and `scope=all` refuses to introduce them. Runtime
behavior, linked-database lint, application health, and kill-switch/autonomy/
worker containment remain separate mandatory post-apply release gates.

Freeze the repaired commit, request fresh exact RED approval, publish it, and
require green exact-head CI before any hosted DDL. Keep kill switch ON, raw
autonomy and all automatic actions OFF, and worker/executor disconnected.

## Newest (2026-08-22 ~01:30Z): agents are selectable into the AI Factory (ADR-107)

The owner's goal for /solutions/agents, shipped as the mirror of pipeline
selection: migration `20260822000100_project_agent_selection.sql`
(project_agents + three definer functions, RLS + FORCE RLS, no direct
table path), `/api/project-agents` (GET/POST/DELETE, unapplied migration
reported as Not Connected), and one shared `ProjectAgentSelector`
component rendering "Include in AI Factory" toggles on the Agents page
(standalone project picker) and inside the factory's new **Select
Agents** step (journey-scoped, done when at least one agent is included,
included names as evidence). Selection is routing intent — audit-evented,
advisory-locked, refused for archived projects, cross-project agents,
and non-managers. Local certification: 16 behavior cases against the
full migration chain, 10 route cases, 5 component cases, factory suite
updated to the nine-step journey; lint, tsc, and the production build
green. Hosted apply: `scope=agent-selection` added to the apply workflow;
runbook total is now 131 and the 13 tail pins moved to the new file.

## Newest (2026-08-21): AI Factory production pass is 4/8; bot fix pending

Exact candidate head `a020e8192d8512a1bb65112e01017047087f0528` is green in
CI run `32543409160`: quality and browser shards 1/3, 2/3, and 3/3 all passed.
That proves the candidate head only; it is not evidence that production serves
the candidate.

Authenticated production-browser evidence is now **4/8**. **Agentic SDLC** was
selected for the existing project, survived reload, and produced an immutable
`pipeline.selected` event visible in Activity. The owner reconnected Claude,
and production reports that account Connected. Refresh queued background
re-verification but remains pending because no worker sweep completed; do not
present the spinner as fresh worker or end-to-end health evidence.

Create Bot currently fails and leaves zero bots. Root cause is isolated outside
the owner-frozen connection path: Bot Manager forwards raw broker purposes
`claude`/`claude_N` or `codex`/`codex_N`, while
`/api/bots/connect/provision` accepts provider-neutral
`subscription`/`subscription_N` choices. The branch candidate now normalizes
all account-backed paths and fails closed on missing or mismatched metadata;
PR #309 exact head `db1958f8b501e865a9e741a21298683e0f88f969` has 99 focused
tests, lint, typecheck, production build, and secret/protected-path audit green.
It did not pass its merge gate: browser shards 1/3 through 3/3 in run `32545138211` failed
because the loading state omitted the page's H1. The forward candidate keeps
the `AI Factory` H1 in loading and every fail-closed state and adds a direct
regression test, so the prior exact-head merge approval is stale.

Do not merge after only repairing that shard. The protected credential
normalizer currently rejects the catalog-declared Claude/Codex subscription
references that provisioning writes, so a created subscription bot would read
Not Connected despite a stored vault credential. The manager-only manual
readiness endpoint also checks and serializes environment presence only, so it
persists the same false negative for vault-backed accounts. Those protected
paths remain unchanged pending exact owner approval. Provisioning also leaves
`bots.ai_account_id` null; full account-identity binding needs a separately
reviewed forward schema/RPC change. The fix is not deployed, so do not claim
the Claude account is yet usable or sticky as a bot; after an authorized
release, repeat create, assign, configure, and reload acceptance.
real broker-purpose fixtures, the focused 100-test run, lint, typecheck, and a
production build pass. The fix is not deployed, so do not claim the Claude
account is yet usable or sticky as a bot; after an authorized release, repeat
create, assign, configure, and reload acceptance.

Do not promote production while the known blockers remain: five linked lint
errors/ten findings, raw autonomy enabled for one organization, raw kill switch
off for one organization, two projects with effective kill off, no
connected/fresh worker, and hosted `20260821000300`/candidate
`20260821000400` drift. Worker/autonomy stays off and production is not fully
live.

## Newest (2026-08-22 ~00:45Z): the journey has now run against PRODUCTION itself — green

The owner's goal ("connect to the site remotely, fill every field with
fake data, prove every capability, everything wired to Supabase")
completed against https://www.theagoras.com directly. Sequence: the
owner approved the one-shot `journey-prod-user.yml` (#305, dispatched)
which marked the fake account jordan.seeker.prod1@example.org
email-confirmed in hosted GoTrue and swept the unconfirmed probe
residues — no auth configuration changed, confirmation stays ON for real
users. The journey lane gained a remote-target mode (#306:
`base_url`/`email`/`password` dispatch inputs skip the local-stack
steps). Dispatch run 32540879299: remote step green (one first attempt
timed out just after sign-in on a production cold start; the CI retry
ran the complete spec to the end — Playwright reports it flaky, the job
succeeded). Independently verified by signing in to production as the
fake user and reading back through the production API: 42 jobs in the
fake workspace (2 manual + 40 `via greenhouse` — real Stripe postings
imported live in production), all 42 scored, analytics computed from the
walked rows (applications 1, response rate 100%, interviews 1, offers
1). Sandbox note: this session's egress proxy accepts curl and raw
CONNECT but resets every Chromium TLS hello, so remote browser runs ride
the CI runner (the lane's remote mode) — playwright.config.ts now
forwards HTTPS_PROXY for remote HTTPS targets for environments where the
proxy accepts browsers. Cleanup when desired: delete the fake user in
Supabase Auth → Users; the cascade removes its workspace rows.

## Newest (2026-08-21): immutable Factory command routing (ADR-106)

The rebased release candidate adds
`20260821000400_command_factory_routing.sql` (34,999 bytes; SHA-256
`e45149db3ca7c66a27934b0b49ac160e1b5ef597fc8f34ad8547de4759086598`).
Only an authenticated organization owner may submit or replay. The database
uses the existing command/task/run transaction, rechecks the stored effective
risk, and freezes the selected pipeline/template, assignment, bot, role,
provider, resolved model, work effort, and configuration/risk snapshot in an
immutable route. Exact replay resolves that route before any mutable project,
pipeline, roster, readiness, or capacity state is read. This release creates
no worker dispatch or autonomy change; no connected/fresh worker was observed,
and approve, merge, deploy, and rollback remain unavailable. If the RPC is
absent, the API fails closed as Not Connected/503.

Two first-use UI failures are also closed in this candidate. The embedded
template-plan dialog derives its locked project synchronously, never flashes a
false empty-workspace state, and does not issue the wider `/api/projects`
request. The assignment wizard names the missing-role prerequisite, links to
the real Bot Manager route, and cannot advance from Configure until every
selected bot has a role.

Do not describe this candidate as live. Hosted production includes
`20260821000300` and still serves the old copy; `20260821000400` is unhosted.
The current release blockers are measured adverse state, not assumptions:
five linked-database lint errors across ten findings; one raw organization
with `autonomous_mode = true`; one raw organization with
`autonomy_kill_switch_active = false`; two projects whose effective kill switch is off;
and no connected/fresh worker. These measurements supersede older claims below
that linked lint is clean or that hosted controls are universally all-OFF and
kill-ON. Contain and remeasure them before any hosted apply or production
promotion.

Candidate lint, typecheck, and build pass. The default unbounded Windows run's
Supabase-wiring and pipeline failures were contention-only and both cleared on
isolated retry; the wiring contract passed 2/2 in 0.603s with `maxWorkers=1`.
The bounded current-head non-frozen command
`vitest run --exclude tests/unit/auth-broker-runner.test.ts --maxWorkers=4`
passes 317 files / 3,730 tests with 7 skipped in 183.78s. The excluded
owner-frozen auth-broker file contains 19 tests and is excluded locally solely
because Windows lacks Unix `script`. Linux CI must run it as part of the full
suite. The independent hosted-runbook/repository-memory guards remain 21/21.

## Newest (2026-08-21): FirstMate review → read-only Factory Briefing (ADR-104)

FirstMate was reviewed at exact commit
`738460d401b1115dab617c3859077973977615cb` (MIT, Copyright 2026 Kun Chen).
It is a single-user local Bash agent distribution, not a compatible web
dependency, so this change reimplements only its strongest information-
architecture invariant: one four-lane bearings view. The Dashboard's former
fragmented attention block is replaced by Factory Briefing, which classifies
live task/run/graph/inbox/incident/connection evidence into exactly one of
Needs owner now, Underway, Recently finished, or Up next; reports the logical
Orchestrator role and worker heartbeat separately; caps lists with totals; and
names every missing, malformed, or saturated source. Linked runs are folded
into their task. Eight parallel reads have timeouts, batch cancellation, and
stale-response protection; briefing-specific server responses omit prompt-
derived task titles, command prompts, inbox bodies/choices, graph node/
artifact/verification details beyond fail-visible verdicts, repository
details, and unrelated operations data. Malformed graph verification evidence
fails the source read closed. All actions navigate to authoritative screens
rather than mutating from the summary. No migration, auth/RLS boundary, worker, provider,
autonomy setting, workflow, merge, deployment, or production resource changed.

Local evidence: full ESLint and TypeScript clean; production Next build green;
57/57 focused classifier/component/minimized-route/operations-contract tests
green; the component browser matrix has 30 passes and 15 intentional skips in
the non-resizable mobile project across 320–1440 px, including populated
layout/control/axe checks and an unbroken
maximum-length coordinator at 320 px. On the rebased combined tree, the local
unit suite passes 2,506/2,506 after excluding two pre-existing Windows-only
process/permission files. Database behavior suites need their configured
stack; Linux draft-PR CI remains authoritative.
Publish only a draft PR; do not merge or deploy from this handoff.

## Newest (2026-08-21 ~23:45Z): Job Discovery is operational — real public-board imports (ADR-105)

The owner's goal "make /job-seeker?section=discovery 100% operational"
shipped as identifier-driven public imports: Greenhouse and Lever read
their providers' public keyless APIs, driven by a board token / site name
the user types on the card — the env-var "credentials" those two adapters
demanded were a misclassification, dropped. `POST /api/job-seeker/import`
fetches up to 40 postings per request (the reply states the board's true
total), records each through the same evaluate → job → match →
application chain as manual entry (shared `lib/job-seeker/record.ts`),
counts duplicates via the existing unique index, and skips-and-counts
anything the credential scanner refuses. Job rows carry `via {source}`
attribution. LinkedIn stays honestly Not Connected (real OAuth needed).
Proven live end to end: the journey's new discovery phase drives the real
Greenhouse API — a missing board's verbatim refusal, then the "stripe"
board imported and scored (local stack: 40/40 imported rows scored and in
the pipeline) — journey green in 32.7s. Also measured this session:
production sign-up still answers 202 confirmationRequired even after the
owner reported disabling confirmation — the dashboard toggle did not take
(wrong switch or unsaved); sign-in probes stayed 403 email_not_confirmed
through a 10-minute poll.

## Prior (2026-08-21 ~21:15Z): Job Seeker — full browser journey green against a real Supabase stack; three live defects found and fixed

The owner's verification goal ("go through /job-seeker, fill every field
with fake data, prove every capability, everything wired to Supabase") was
executed as a real browser journey, not a mocked one:
`tests/e2e/job-seeker-journey.spec.ts` (guarded by `JOB_SEEKER_E2E=1`)
drives sign-in through real GoTrue, workspace onboarding, every profile
field including employment/education entries and a resume upload,
preferences, job recording + scoring, the duplicate refusal, prepare →
review → approve → applied, contact + outreach draft, and analytics —
against `supabase start` (the full 127-migration chain on real Postgres +
PostgREST) with the production `next build` in front, asserting
persistence by reload. It passes end to end (23.7s). Signed-out production
was verified directly: `https://www.theagoras.com/job-seeker` streams the
sign-in redirect and all `/api/job-seeker/*` endpoints answer 401.

The journey caught three real defects the mocked suites could not, all
fixed in the same change: (1) a signed-in person with **no workspace** hit
a dead-end "could not be loaded" error — the page now redirects them to
onboarding (which honors `?next=` and returns them), and the console
renders a "Create your workspace" call-to-action on the 409 as the
client-side floor; (2) **live PostgREST returns one-to-one embeds as
objects** — `job_seeker_matches`/`job_seeker_applications` both carry
`unique (job_id)` — while `toView` read `[0]` as if they were arrays, so
every live record showed "Recorded." with no score and no stage;
`firstEmbed()` now accepts both shapes (ADR-097); (3) an employment-history
entry added and never filled made the whole profile save fail 422 — the
form now prunes untouched entries before submit. Local-stack notes for
re-running the journey live in the spec header; the sandbox needs
`supabase start -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`
(an excluded service trips a forbidden rlimit syscall in this sandbox) and
the wipe between runs must TRUNCATE because generated documents refuse row
deletes by design. Gates on the merged state: lint clean, tsc clean, 3,465
vitest green, production build, journey green.

**Round 2 (same day, ~22:30Z): the whole capability surface, and two more
wiring gaps closed.** The journey now also walks: CRM details (notes, the
submitted application URL, a follow-up date — a per-card "Notes &
follow-up" editor was ADDED, because the PATCH actions existed with no UI
reaching them, and the jobs embed now carries those fields), every
remaining pipeline stage (Applied → Follow Up → Recruiter Response →
Interview → Final Interview → Offer, each proven by its group heading),
the reject side of the gate on a second recorded job (reject → no forward
moves anywhere → close), the stored resume made visible from load (the
profile view now embeds resume metadata via the `resume_upload_id`
pointer, which previously went unread — the link used to vanish on
reload) with the BYTEA download round-tripped and its content asserted,
history-entry removal persisted through reload, and analytics re-checked
after the walk (2 jobs, 1 application, 100% measured response rate, 1
interview-stage count, 1 offer). Extended journey green in 30.8s.

**Round 3 (same day, ~22:45Z): the journey has a CI lane.** ADR-097's one
open item is closed: `.github/workflows/job-seeker-journey.yml`
(workflow_dispatch + daily 07:41 UTC) provisions the lean local Supabase
stack on the runner, mints the pre-confirmed journey user through
GoTrue's admin API, builds and serves the production app, and runs the
JOB_SEEKER_E2E journey — so live-wiring regressions surface within a day
instead of at the next manual run. Actions pinned to reviewed SHAs
(pin-guard test green); no deployment, no production credentials, no
provider usage in the lane. **The lane is proven live**: first dispatch
on main, run 32533731639, green in 3m40s — the runner provisioned the
stack, minted the user, built and served the production app, and the
whole journey passed.

**The production sign-in boundary is now measured, not assumed**: a probe
of production's own `/api/auth/sign-up` answers 202 with
`confirmationRequired: true`, so a signed-in production journey needs a
real inbox — only the owner has one. (Two probe residues exist in hosted
auth: `jordan.journey.b@example.org` — unconfirmed, org-less, cannot sign
in — and possibly `jordan.journey.2026@example.com` from a first attempt
that 503'd; the owner can delete both from Supabase Auth → Users, and
nothing references them.) If the owner ever wants the journey run against
production itself, either sign in and use the page, or temporarily
disable email confirmation in hosted Auth settings and say so — the spec
takes `JOB_SEEKER_E2E_EMAIL`/`_PASSWORD` overrides and would run as-is
with `PLAYWRIGHT_BASE_URL=https://www.theagoras.com`.

## Prior (2026-08-20 ~02:20Z): Job Seeker — all seven increments live; the goal's own E2E journey passes

Increments 5-7 joined 1-4 (#289, #290, #291): contacts + outreach drafts
that never claim a send; resume upload in a person-scoped BYTEA table
(migration 20260820000300, applied in run 32322900245 — hosted storage
policies are unownable from our apply path and the web tier holds no
service-role key); and the goal's finishing requirement executed as ONE
continuous test (job-seeker-journey.behavior.test.ts): Profile →
Preferences → Discover → Score → Qualify → Resume → Cover Letter → QA →
Review → Approve → Apply → Follow-Up → Analytics against the real schema
through the real engine functions, with the QA contract asserted (a term
the profile does not record never appears in a generated document) and the
gate proven in both directions inside the journey. Import adapters exist as
a typed registry whose `configured` flips only by detection of named
variables — Not Connected on the page with exact needs listed, no fetch
implementation until real. Completion score against the /goal's criteria:
everything in-repo is done and tested (3,463 green, sharded browser CI
green); the two open items need external inputs — an import credential
(SOFTWAREFACTORY_GREENHOUSE_BOARDS / _LEVER_SITES / _LINKEDIN_*) and a
live launch of the job_search_pipeline template from Pipelines → Templates,
which spends the owner's provider window and is theirs to click.

## Prior (2026-08-20 ~01:35Z): Job Seeker — four increments live (ADR-096)

The owner's /job-seeker goal, increments 1-4 merged and deploying (#283,
#284, #285, #286, #287): hard-gated page (server redirect, e2e-proven),
eight person-scoped tables with the approval gate / dupe key / score
integrity as CHECKs (migrations 20260820000100/000200, applied in run
32318712493), career profile + preferences CRUD, manual job recording with
deterministic fact-only scoring (reasons and gaps name their facts,
exclusions veto), the eleven-stage pipeline with Approve/Reject recording
decision evidence, fact-only ATS resume + cover letter generation with
immutable versions, counted analytics (rates with no denominator render
"—"), and the seven-agent job_search_pipeline graph template on the
production-proven execution lane. Remaining (BACKLOG): contacts/outreach
UI over the existing tables, uploads (storage-bucket decision), import
adapters, model-polished documents through the graph lane with QA lenses.
Watch: the width sweep initially died on the redirect route — fixed by
measuring the gate AS a redirect (#287); confirm CI green on c68d4cc.

## Prior (2026-08-19 23:05Z): THE COMPLETE RUN — the graph goal's last live proof is delivered

Drain `32310917147`, graph run `1df3fd45-5501-4912-81f8-26448b865af3`:
**COMPLETED, 7 succeeded, 0 failed**, 6m26s wall. Five MODEL inspectors in
parallel through the subscription CLI, the deterministic reduce, the report
synthesis — dispatched alone in the fresh 22:50Z window exactly as planned
by `20260819001200`, so nothing competed for fuel. Zero API tokens. The
scorecard withholds no graph-execution claim any longer. Also confirmed
this window: the ADR-095 unsupported observation (18:55:40Z) is the newest
usage row and the ONLY one in four hours — the memo ended the five-minute
re-probe spam, and the Bot Manager states the correct status (Connected,
usage not measurable for this connection type, reason on the card).

## Prior (2026-08-19 ~18:05Z): all five inspectors succeeded in production; one node from a COMPLETED run

The 17:50Z window delivered the strongest evidence yet, then ran dry:

- **Drain 32283900970, graph run `4d3f44a7-…`: 6 of 7 — every MODEL
  inspector succeeded in parallel** through the CLI (24-turn/480s envelope),
  the deterministic reduce folded their findings, and the run closed PARTIAL
  naming its one failure: the report synthesis, refused capacity (the fresh
  window had also just paid for the canary's five nodes; resets 22:50Z).
- **Live canary 32283945714 fully green**: "fans out, synthesizes, and
  verifies with a fresh context", 176.6s, zero API tokens — no capacity
  skip, no turn-budget failure.
- Migration `20260819001200` plants one fixed-id copy
  (`c9d4f1e8-7a52-4b3c-9e16-4f8a2d5c7b91`) cloned verbatim from the
  PARTIAL-retired copy, for a **solo** dispatch after 22:50Z (no canary in
  the same window) to convert 6/7 into the COMPLETED all-seven proof.
- The auth-broker's post-reset usage sweep still recorded `1 unavailable`
  (counts only in the log); the probe now prints the last five usage
  observations' status+detail (constraint-guaranteed secret-free), so the
  next probe run reads WHY without a database console. Rounds 15-16 also
  pinned every workflow action to a reviewed SHA and the Claude CLI to one
  version everywhere, both guarded by tests.

## Prior (2026-08-19 ~17:15Z): the day's own cadence audited, and the Bot Manager tells the truth again (ADR-093, ADR-094)

Applied to production through apply runs 32277018759 (…001000) and
32279867500 (…001100); ledger confirmed both. Highlights, in the order the
day found them:

- **Main's CI verdict is real again**: pushes get a per-commit concurrency
  group and are never pre-empted, so a merge no longer cancels the previous
  merge's verification (#267). The probe now asks `pg_constraint` directly
  and measured `covers_all_five_added = t` — the ADR-036 parity fix is
  genuinely live (#266).
- **The claim matches worker capability** (`20260819001000`, ADR-093): the
  analysis worker declares DETERMINISTIC+MODEL and never claims a graph
  containing ANCHOR nodes; such graphs stay PLANNED with budget intact, and
  the template cards say so before recording one (#269, #272). Drain
  32277660454 exercised the two-argument claim live: five inspectors
  dispatched in parallel, session limit refused capacity, run closed
  CANCELLED (void) — graph `51816274-…` still claimable for the 17:50Z
  window.
- **The browser suite is sharded 3×535** after being killed at 1582/1605 by
  its own ceiling; required checks and merge-readiness fixtures moved with
  the rename, and the install step is bounded per attempt after two shards
  hung 19 minutes in a stalled apt mirror (#270, #272).
- **Owner-reported Bot Manager defect fixed end to end** (ADR-094,
  `20260819001100`): a rate-limited usage probe (HTTP 429) no longer
  impersonates a broken account. Probe retries once within a small
  Retry-After and records what 429 means; the projection carries the last
  measured windows past a newer failure; the console renders probe failures
  as muted information and keeps real numbers on screen; push-handover
  broker runs skip the startup probe that caused the burst. The account
  badge (Connected) is the statement of health. The next broker sweep
  records the first observation under the new wording; numbers appear when
  the provider window reopens (17:50Z).

## Prior (2026-08-19 ~03:10Z): graphs execute — the worker boundary is live on production (ADR-092)

The planned-graph dead end is wired. Migration `20260819000100` (claim /
node-state / artifact / closure as service-role definer functions), the
executor worker (`scripts/graph-worker.mts`, `graph-worker.yml`), the
`server-only` shim, and the pinned CLI install are all merged (PRs #236-#240)
and applied to production. Three real dispatches each surfaced and fixed one
defect: run 32208699123 (import — shim), run 32208975669 (missing CLI —
pinned install), run 32209893742 (a session limit burned every remaining
re-claim chance in seconds — capacity refusals now void runs as CANCELLED,
uncounted, and stop the drain). Edges now carry data into node prompts, and
migration `20260819000200` re-planted one fixed-id copy of the owner's
first-day readiness graph so the next dispatch after the session limit
resets (7:30am UTC) has real work. **The post-reset dispatch delivered the
first real production node success** (run `32228988434`, graph run
`e51c57a5-…`: the rollback inspector completed through the CLI, RAW
artifact recorded, run closed PARTIAL honestly). The residual failures were
the executor's own 8-turn ceiling — raised to 24 by measurement, with MODEL
template nodes now carrying an eight-minute timeout, and `buildLaunchPlan`
now passing the compiled timeout/attempts instead of letting database
defaults override the planner. Drain `32254860997` (graph run `ca347ab9-…`) then executed **the whole
chain**: inspector → deterministic reduce → report synthesis, nothing left
undispatched, closed PARTIAL with the four failed inputs named. Those four
failed because the transport's `MAX_TURNS_CEILING` was silently clamping
the executor's declared 24 back to 8 — raised to 24 and pinned against the
executor's constant by a test, so the pair cannot drift again. The next
dispatch is the attempt at every inspector succeeding. CI on main is fully green
(run `32216103242`) after the outgrown e2e ceiling was raised (PR #248).
The worker's schedule stays off until the repo variable
`SOFTWAREFACTORY_GRAPH_WORKER_SCHEDULED` is set. File-writing nodes remain
deliberately with the Phase 1C path. The owner's standing merge cadence for
this goal: merge immediately, verify on production, keep looping.

## Newest (2026-08-18): Use records a project's pipeline — one owner action outstanding

`Configure Pipeline` on `/solutions/ai-factory` now has something to configure.
Pressing **Use** on a template card selects it for the project the journey is
scoped to, writes that to `project_pipelines`, and the step reads it back: done
only when at least one pipeline is selected, with the chosen names rendered on
the page. Many can be selected; pressing a selected card again removes it. The
graph-planning dialog Use used to open is now its own **Plan graph** button.

**Applied on production**, 2026-08-21 23:27Z, run `32536895799`
(`scope=pipeline-selection`, `confirm=apply`). The run's own after-ledger
listing prints `20260821000300 | 20260821000300` — local and remote — so the
`project_pipelines` table and its three definer functions exist on the hosted
project and the ledger records them. The PostgREST schema cache was reloaded in
the same step, so a browser that had been seeing PGRST202 stops.

The Not Connected path stays in the code and is not dead: it is what any
database without this migration — a fresh preview branch, a restored snapshot —
will report, and it is the reason a missing migration cannot present as an empty
selection set. `/api/project-pipelines` returns
`pipeline_selection_not_connected` there and the Use button is disabled naming
that reason.

What this run does **not** establish is behaviour observed in production: a
ledger row proves the DDL ran, not that someone has pressed Use on the live
site and seen the selection survive a refresh. That observation is still
outstanding.

## Newest (2026-08-18 05:40Z): the hosted ledger, measured — read this before any "unhosted" claim below

Probe run `32103778884` (`.github/workflows/apply-hosted-migrations.yml`,
`scope=probe`, read-only; the three apply steps were skipped and the log shows
it) printed the full local-vs-remote ledger. **It is not a contiguous prefix of
the local files.** Nineteen versions are missing from the middle —
`20260814002500`–`002600`, `20260815000200`–`000600`,
`20260815000800`–`001600`, `20260816000100`–`000300` — while every row above
them is present, the whole `20260817` range included.

Every "the migration is unhosted" note further down this file was written
against a high-water-mark model that the measurement disproves. Check a version
against the table in `AI/HOSTED_APPLY_RUNBOOK.md` before acting on any of them.
Two that are now known to be wrong as written: `20260816001500` and
`20260816001400` are both **on the ledger**, so the usage rows and the
repository picker are backed on production.

The ledger also still understates the schema: 19 of 19 probed objects came back
present, among them `scheduling_decisions` and `projects.engineering_priority`,
both owned by `20260815000200`, which has no ledger row. Where a marker object
is present the correct action is `migration repair --status applied <version>`,
recording history that is already true — not re-running the file. The probe now
prints a `present` boolean per version so that call can be made per file rather
than for the batch.

Only the probe was run. `AGENTS.md` puts RED actions behind explicit owner
approval in Phase 1, so `scope=all`, `broker-functions` and `project-controls`
remain the owner's to trigger.

## Newest (2026-08-16 ~23:20Z): per-account usage on the Bot Manager, captured by the broker sweep

The owner asked for each connected bot's usage (session % and weekly %) on
`/solutions/bot-manager`, fully automated. Landed as ADR-076: evidence table
`ai_account_usage_observations` (migration `20260816001500` — recorded as
unhosted when this was written; the 2026-08-18 measurement finds it **on the
hosted ledger**, so live rows are possible), probe module
`lib/worker/usage-probe.ts`, a bounded capture hook in
`scripts/auth-broker.mts` (frozen file, touched under the owner's explicit
instruction; login semantics untouched), `GET /api/ai-accounts/usage`, and the
usage rows in `components/ai-accounts-panel.tsx` /
`components/bot-manager/account-usage.tsx`. Truthfulness contract: the UI
renders only recorded observations — measured windows, a named failure, or
"no usage recorded yet" — and the probe never demotes an account. Codex
records `unsupported` until a real usage endpoint is proven; proving one is
the natural next step.

## Project ↔ repository picker (2026-08-16, branch `feat/project-repo-picker`)

Owners/admins can now choose, change, and unlink which GitHub repository an existing
project connects to, end to end: migration `20260816001400_project_repository_picker`
(two definer functions, serialized with handoff and change reservations, uniqueness
refusals that name the holding project), `PUT`/`DELETE
/api/projects/[projectId]/repository`, and a per-project picker in the Connections
console with explicit no-installation / zero-repository / projects-load-failure states.
The migration was recorded as **unhosted** here; the 2026-08-18 measurement finds
`20260816001400` on the hosted ledger. `AI/HOSTED_APPLY_RUNBOOK.md` carries the
current position. Nothing here touches the frozen AI-account connection path, execution
authority, or RLS.

## Newest (2026-08-16 ~21:30Z): both provider paths frozen; GitHub install host-skew fixed

Both AI-account connection paths are owner-frozen — Claude (ADR-072) and now
Codex (ADR-073, after the first live Codex connection at 19:06:41Z). The
operative file list is in `policies/PROTECTED_RESOURCES.md`; diagnosis stays
allowed, fixes are owner proposals. Separately, the GitHub App install flow
was failing across the deployment's hostname aliases (`github_state_invalid`
on `softwarefactory-tan.vercel.app`): the launch and callback legs now
303-converge on the configured callback host before touching cookies, state
verification failures name their real cause, the state lifetime is 30
minutes, and the Connections console strips its one-shot notice query
parameters after reading them (ADR-074; the host-skew entry in
`todo.md` has the full defect story). Outcome, owner-verified 19:47Z:
GitHub is Connected live on a fresh installation `#154236235` scoped to
exactly `surgeservicesllc/SoftwareFactory`, bound to the owner's live
workspace. The old installations from the 2026-08-13 setup were bound to
a workspace the owner's login cannot reach (single-membership login, no
Workspace card); recovery was uninstall + fresh Connect, not adoption.
A Workspace switcher card now renders on Connections whenever a login
belongs to several workspaces (PR #165).

## Active goal: BotBuild — AI accounts + automatic auth broker (2026-08-16)

The owner's active goal (spec recorded in `todo.md` → "Owner goal — BotBuild")
replaces the copy-a-command connect flow with a fully in-browser one: Add AI
Account → Connect → the provider's real login → automatic detection →
Connected. The foundation landed in `20260816000100_ai_accounts_auth_broker`
(see ADR-071): `ai_accounts` identities, the `ai_auth_sessions` broker state
machine (worker-driven, definer-function-only, sealed relay code, audit
events on every transition), and nullable `bots.ai_account_id`. The
verifying suite is `tests/integration/ai-accounts-auth-broker.behavior.test.ts`.
Still open, in order: broker API routes, the worker auth runner (GitHub
Actions job that runs the provider CLI login against a claimed session —
including a live probe of headless `claude setup-token`; Codex's
localhost-callback login is a known risk recorded in `todo.md`), the
auto-completing UI, the Bot Manager redesign, disconnect/reauth surfaces,
and the verification loop. The subscription connect-command flow (PRs
#133/#134/#135) keeps working during the transition; do not remove it until
the broker path is live end to end.

## Read this first: master clean-room audit + frictionless goal (2026-08-16)

The authoritative current state is `todo.md` → "Master clean-room audit
(2026-08-16, iteration 24 — FINAL GATE)" and the "FRICTIONLESS COMPLETION
REPORT" above it. Summary: full local gate PASS on merged `main` `69a0156`
(eslint 0 errors, tsc clean, vitest 2741/0, production build OK), 22/22 live
production routes 200, zero-token PASS, no unblocked P0/P1 — everything
remaining is owner-only (1C canary, hosted-ledger position, second
repository, 2A decision). A nine-iteration frictionless owner-experience
loop merged as PRs #121, #123–#129 (guided setup, one-click bot connect,
simple goal box, attention area, plain-language runs, iOS GitHub-connect
fix, owner-first navigation, journey e2e) with **zero safety-surface
changes** — presentation and tests only. Deployment caveat: Vercel's
free-tier daily quota exhausted mid-sequence; production serves main through
`0126825` (#126) until the next deploy after quota reset, an owner Redeploy,
or a plan upgrade. The worker's one-click sign-in flow for the owner is:
production `/auth/sign-in` → "Email me a sign-in link instead" → click the
link promptly on the same device (PKCE — raw `/auth/v1/otp` links do NOT
sign into this app; the session travels in a fragment the app ignores).

## Mission and boundary

**Phase 2E portfolio scheduling landed on `claude/softwarefactory-phase-1e-ops-mjdiiq` on 2026-08-15** (migrations `20260815000100`-`20260815000600`, scored 33/36 PASS in `AI/PHASE_2E_COMPLETION.md`). Read that file and the 2E handoff block at the top of `todo.md` before touching the claim path: `claim_phase1c_run` now orders by effective priority and filters on four ceilings plus circuit-breaker health, and its body has been rewritten twice by copying the previous version and editing it, so a third rewrite should do the same rather than retyping it. Two ordering facts matter operationally — five of the six migrations are ledger-absent as measured on 2026-08-18 (`20260815000100` is on the ledger; `000200`-`000600` are not, though `000200`'s objects are demonstrably live), and `20260815000500`/`20260815000600` cannot apply to a database where `20260814000210` is half-applied, because their `language sql` bodies are resolved at creation.



**Phase 1B close-out merged as `c325dbb` on 2026-08-14.** Scoring is in `AI/PHASE_1B_COMPLETION.md` (18 PASS / 2 PARTIAL / 0 FAIL). Three real defects were fixed, not just covered: generic-`500` lifecycle refusals, a stale suspension marker left after a revocation, and a discovery that aborted against a terminally deleted installation. `tests/integration/github-lifecycle-matrix.test.ts` is the access-loss proof — it attempts a real change reservation after every transition rather than reading a UI label, so do not weaken it into asserting rendered state. Migration `20260814001100` is **unhosted**; apply it as item 7 of `AI/HOSTED_APPLY_RUNBOOK.md`.

Two environment blockers were hit and are not code defects: Vercel's free-tier `api-deployments-free-per-day` limit, and GitHub Actions failing to assign a runner at all (`runner_id: 0`, no logs, two attempts). The second matters for Phase 1D, whose goal item 12 requires gates to rest on real CI evidence.


Finish Phase 1C live acceptance without overstating status. Historical reconciliation and verification below remain useful, but the current hosted release gate is adverse: five linked lint errors/ten findings, raw autonomy/kill-switch drift, and no connected/fresh worker. Production is on `20260821000300`; factory command routing in `20260821000400` is local and fails closed until hosted. No successful Phase 1C run or draft PR exists, so Phase 1C remains **Not Connected** and no command routing may dispatch work.

## Phase 1D state for the next agent

The autonomous-loop **decision layer** is complete and lives in `lib/autonomy/`. It decides; it
never executes.

- `controls.ts` — nine automatic actions at two scopes, resolved most-restrictive-wins. Read the
  envelope from `public.resolved_autonomy_controls(project_id)` rather than assuming it.
- `diff-risk.ts` — classifies a real diff. Do not reintroduce caller-declared risk as the only
  input; the whole point is that the thing being judged does not supply its own verdict.
- `gates.ts`, `agents.ts`, `approval.ts`, `pipeline.ts` — the gate sets, the three reviewing
  agents, the approval tri-state, and the twelve-stage machine.

Rules that must survive any future change:

1. **Approval never outranks verification.** Owner approval is evaluated after the gates. If you
   find yourself moving that check earlier, stop.
2. **No self-approval, at any risk level, including for an owner.**
3. **A missing gate result is a blocker, never a pass.**
4. **Blocked stages are named, not skipped.** `MERGE_EXECUTOR_NOT_CONNECTED`,
   `DEPLOY_EXECUTOR_NOT_CONNECTED` and `CODEX_WORKER_NOT_CONNECTED` are asserted in
   `tests/integration/phase1d-loop-journey.behavior.test.ts`. If you connect an executor, those
   assertions are supposed to fail — update them deliberately, and do not weaken them to
   "either blocked or not".
5. **The Phase 1D control migration relaxes nothing.** Enabling any automatic action is a RED action
   requiring an owner-approved migration. Do not do it as a side effect of anything else.

Phase 1D migration `20260813000600_phase1d_autonomy_controls.sql` remains part of the historical hosted chain, but its old all-OFF/kill-ON observation is no longer current evidence. Raw hosted data now includes one organization with `autonomous_mode = true`, one with `autonomy_kill_switch_active = false`, and two projects with effective kill off. No connected/fresh worker or executor was observed, so nothing is dispatched; contain the drift before any routing migration or promotion.

Manual Phase 1C execution may handle only authenticated owner-submitted GREEN/YELLOW commands. RED remains non-executable. Autonomous Mode is OFF, the global kill switch is ON, and auto approve/merge/deploy/rollback are OFF. The worker ends at an open draft PR plus observed CI; it never writes the default branch or performs delivery.

## Current repository work

**Phase 2B (graph engineering) is open in draft PR #27**, branch
`claude/github-connection-confirm-qe3tqm`. Stages 1–5 are built: the pure engine
core (`lib/graph/`), thirteen durable tables plus a SECURITY DEFINER write
boundary (both **applied to hosted**), the runner and provider bridge, the
templates/Workflows/observability/optimizer surfaces, and six of the seven
demonstrations. Read `todo.md` first — it opens with a pickup section — then
`AI/GRAPH_ENGINEERING.md` and `AI/PHASE_2B_DEMONSTRATIONS.md`.

Three facts a successor needs and will not infer:

- **The credential boundary is narrower than it looks.** `runGraph` takes an
  injected `executeNode`, so every decision the engine makes is testable without
  a provider. Only the claim that a real model satisfies these contracts needs
  `ANTHROPIC_API_KEY` and a funded `OPENAI_API_KEY`. Stage 5 was once recorded
  as fully credential-blocked; that was wrong, and six demonstrations now pass.
- **Migration versions collide across concurrent workstreams.** Twice so far:
  `20260813000500`, then `20260814000100` when Phase 2C's
  `phase2c_resource_persistence` and Phase 2B's `graph_engineering` both claimed
  it. The ledger stores one row per version, so the loser can never be applied.
  `graph_engineering` was already hosted and could not move, so the unhosted
  Phase 2C file was renamed to `20260814000300`. Check `supabase/migrations/`
  before choosing a version.
- **Automatic CI is intermittent.** A missing run and a not-yet-started run are
  indistinguishable. Confirm an Actions run exists for the exact head SHA before
  treating a PR as gated.

Phase 2A is a separate advisory path. It can route a bounded task to an official Anthropic/OpenAI adapter and store a structured analysis artifact only after hosted schema, server credential, provider health, and explicit organization enablement exist. It cannot access a Git workspace or authorize a repository, approval, merge, deployment, rollback, or Phase 1C/1D switch.

## Repository identity

- Exact GitHub repository: `surgeservicesllc/SoftwareFactory`.
- Exact live owner: `surgeservicesllc@gmail.com`.
- Every commit author and committer: `surgeservicesllc <surgeservicesllc@gmail.com>`.
- Existing connected candidate App path: App `4582606`, installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, project `b1f23696-437e-4d89-b55f-d7a949980e8f`.
- Primary installation `153445938` remains rollback; Support `#4660724` remains the webhook defect record.

## Phase 1E production operations

The production-operations control plane is implemented in source and migration `028`. Its schema effect and reconciled ledger row are present on hosted Supabase, but no monitor has observed a real production target, so every Phase 1E surface reports **Not Connected** or **Unknown** today.

What it does: monitors production through one bounded HTTPS-probe adapter, derives project health with a stored reason, opens and deduplicates SEV1–SEV4 incidents, freezes autonomous releases automatically on SEV1/SEV2, resolves Last Known Good only from a validated deployment, evaluates rollback fail-closed, diagnoses deterministically, creates bounded repair work, orchestrates ten durable event types idempotently, gates resolution on real restoration evidence, and reports daily.

What it deliberately does not do, and why:

- **No rollback execution.** No deployment provider adapter exists, `policies/AUTO_ROLLBACK.md` disables automatic rollback, and migration `010` pins `auto_rollback` off. Every rollback decision records `EXECUTOR_NOT_CONNECTED`. No database or data migration is ever reversed.
- **No repair execution.** Repair work can now be promoted into the ordinary Phase 1C command queue (owner-only, through `submit_command`, with a live base SHA), which it previously could not be at all — `create_repair_attempt` wrote a task `claim_phase1c_run` could never select. The promoted run stops at `queued`: Phase 1C is Not Connected, no worker is registered, and migration `20260813001700` is unhosted.
- **No deployment, merge, or scheduled monitoring.** Checks are owner-triggered; authorizing a scheduler identity must not widen `service_role`.

Invariants a future change must not break: `service_role` gains no new table privileges; the four append-only evidence tables stay append-only; `production_monitors_enabled_requires_connection` stays in place so an unconnected monitor cannot be enabled; `rollback_operations_failure_escalates` stays in place so a failed rollback cannot be silent; `incidents_resolution_requires_cause` stays in place so a green deployment cannot close an incident; and `EXECUTOR_NOT_CONNECTED` stays unconditional in `autonomous_release_allowed`.

Released to `main` as merge commit `b243e1ddf9ce8155c4440c56d7b846ccc3d74ce0`; CI run `31731632715` passed both jobs against that commit.

Next Phase 1E steps: configure an owner-authorized monitor target and record the first real detection-to-resolution journey. Hosted ledger reconciliation is complete and must not be replayed.

## Implemented boundaries and migration state

### Hosted Phase 1B and published Phase 1E migrations

- `011`: initial direct mutation closure and `github_pat_` detection.
- `012`: actor-attributed terminal change audit.
- `013`: bounded service-role repository-grant reconciliation.
- `014`: exact linked-project repository/default-branch propagation with audit.
- `015`: existing-draft-PR completion recovery.
- `016`: terminal/provider-time installation lifecycle.
- `017`: remaining direct connection/project/link/change-request write closure plus authenticated exact-binding reservation RPC.
- `018`: provider-time repository lifecycle and terminal delete/explicit restore handling.
- `019`: minimal service-role execute on the SECURITY DEFINER sensitive-JSON CHECK wrapper; recursive/text helpers remain inaccessible.
- `020`: remove authenticated base-table SELECT for agents/commands/tasks/runs/reports and add caller-member safe list RPCs.
- `021`: persist stable GitHub repository UUID bindings for projects/change authorization.
- `022`: immutable owner-only RED protected-change approval plus five-minute pre-provider reservation lease/reclaim boundary.
- `023`: bounded verified GitHub activity details with stable repository-to-project attribution.
- `024`: raw Activity/webhook direct-read closure plus caller-member bounded `list_activity`.
- `025`: generic secret-assignment detection, protected approval/reservation/token-order integrity, and serialized stable repository relinking.
- `026`: revoke all `service_role` public-table privileges, then restore only SELECT/INSERT/UPDATE on the four GitHub ingress tables.
- `027`: hosted; immutable owner RED approval/single-use execution, exact candidate signed-delivery provenance/freshness, cross-App repository serialization, atomic history-preserving project handoff, and evidence-bound reverse handoff.
- `028` and canonical `130001`-`130005`: schema effects and reconciled ledger rows are present. Their DDL was not rerun; preserve the completed history-only repair evidence.

### Published Phase 2A/Phase 1C and provider-startup recovery

- Command route/composer: connected-project and exact selected-pipeline admission, command type, acceptance criteria, stable idempotency, deterministic risk, exact base SHA, fixed plan, immutable bot-route evidence, database-authoritative response snapshot, and truthful persisted-only/no-dispatch states.
- Orchestration: provider `openai`, model `gpt-5.3-codex`, role mapping, 45-minute/four-turn/token/one-repair/15-minute-CI budgets, and fixed inspect-to-report draft-PR workflow.
- Provider layer already on `main`: official Anthropic/OpenAI adapters, health/model discovery, routing, bounded fallback, independent review, owner execution controls, advisory run persistence, and provider settings/run surfaces; `130001` schema and its reconciled ledger row are hosted, while advisory execution remains OFF/**Not Connected**.
- Schema: `130006` Phase 1D decision-only interlocks; `130007` provider compatibility; `130008` enum-only commit; `130009` core command/task/run/worker/evidence/RLS/RPC schema; `130010` provider-neutral roster, owner/risk/ACL/recovery/report hardening; and `130011` canonical dependencies, derived criteria, idempotent replay, and cumulative retry budgets. All are hosted; `130012`-`130014` are forward-only containment/lint/emergency-stop corrections. Only `130007`-`130013` contain Phase 1C changes.
- Pending compatibility/projection/read boundary: local `130015` is frozen at 13,121 bytes with SHA-256 `3E1BEA8F5DAB912D5D7D6251E4503C319816B27EF2465DB5E8612E26A3DD1A13`. It widens the assignment/run model checks from 120 to the original 128-character provider catalogue/API contract while preserving their other semantics; adds four named no-secret constraints covering catalogue model/display-name, assignment model, and routing policy-version/selected-model text; replaces `get_agent_run_detail(uuid, uuid)` to expose capped/allowlisted routing evidence; revokes authenticated raw SELECT on routing decisions/events; and retains tenant-scoped model-catalogue SELECT. Provider runtime/API boundaries also reject credential-shaped default-model/model/display-name scalars before serialization or RPC and fail closed on dirty pre-migration catalogue rows. The application accepts an absent/null routing field for rolling compatibility. Hosted Supabase remains at `130014`; apply `130015` only under a fresh exact RED approval using that frozen source identity and verify all six changed/added constraint definitions, 128-character assignment/run/project behavior, valid and negative credential-shaped scalar behavior, function signature, `SECURITY DEFINER`, pinned `search_path`, exact table/function ACLs, tenant isolation/direct denial, lint, and health.
- Worker: supported `@openai/codex-sdk`, isolated `CODEX_HOME`, controlled environment, exact repository/base-SHA workspace, `factory/*` branch, bounded Codex, pinned Docker validation, protected-path/secret scan, commit/push, draft-PR recovery, exact-head CI observation, bounded repair, redacted persistence.
- Workflow: `.github/workflows/codex-worker.yml` runs one claim on opaque repository dispatch or every five minutes for recovery; branch-selectable manual dispatch is intentionally absent, workflow token permission is contents read, actions are commit-SHA pinned, checkout credentials are not persisted, and the job remains skipped unless the activation variable is literal `true`.
- Recovery patch, published on `main` at `bc95b9e3a5952864bd26da778a052f37400ea747`: before every claim, verify the installed Codex CLI is the reviewed `0.147.0` and perform a non-billable exact-model lookup using only the OpenAI secret. The distinct repository-dispatch event `softwarefactory_phase1c_preflight` additionally requests one bounded, non-stored response, then skips Docker preload and durable claim. The Codex adapter retains the redacted structured `turn.failed`/error message if the event iterator subsequently exits with a generic CLI trailer.
- UI/APIs: bounded list/detail/status for Agents, Backlog, Runs, Reports, Dashboard, and Bot Manager; cancellation and eligible retry; worker status is heartbeat-derived rather than configuration-derived.

## Critical protected configuration

GitHub Actions does not permit secret names beginning `GITHUB_`. The reviewed workflow expects these repository secrets:

- `SOFTWAREFACTORY_SUPABASE_URL`
- `SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY`
- `SOFTWAREFACTORY_CODEX_AUTH_JSON`
- `SOFTWAREFACTORY_GITHUB_APP_ID`
- `SOFTWAREFACTORY_GITHUB_APP_PRIVATE_KEY_BASE64`
- `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_ID`
- `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64`

The workflow maps the four App values to runtime `GITHUB_*` names only inside the worker step. Never print, persist, copy into source, or expose secret values. The public workflow identity is fixed to `surgeservicesllc <surgeservicesllc@gmail.com>`.

`SOFTWAREFACTORY_OPENAI_API_KEY` is intentionally and permanently absent. The value pasted into chat must be treated as compromised and revoked at the provider; do not restore it, and do not add a replacement. Phase 1C authenticates Codex with the owner's ChatGPT subscription through `SOFTWAREFACTORY_CODEX_AUTH_JSON`, the contents of `~/.codex/auth.json` from a subscription `codex login`. Never instruct the owner to fund an OpenAI API account for this phase.

The non-secret repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` must equal literal `true` or every repository-dispatch/schedule job is skipped. It is the final fail-closed activation gate. It was enabled only long enough for the first approved acceptance claim and is now absent/OFF; any further activation remains bounded by the exact owner approval.

`SOFTWAREFACTORY_REQUIRED_CHECKS` must be a non-empty, unique pipe-delimited list of 1-20 exact check names. The reviewed workflow value is `Lint, typecheck, test, and build|Browser and accessibility tests 1/3|Browser and accessibility tests 2/3|Browser and accessibility tests 3/3`, matching `.github/workflows/ci.yml`. Before activation, verify no CI job rename drift. Missing/invalid configuration blocks worker startup; incomplete/missing/unstable checks or a changed draft PR cannot pass CI.

## Verification state

- The prior verified production baseline before this update passed supported Node `24.19.0` lint/typecheck, 117 files/1,282 tests, a production build with 74 page/route entries, prior coverage 75.06/69.97/72.60/76.66, Playwright/axe 117/117, focused migration/security suites, production dependency audit 0, and safe disabled-worker smoke. Baseline commit `0c662a24393f682073e6002c5aff9339292226d8` passed both required jobs in CI run `31749352644`, and matching Vercel deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7` was READY.
- Current routing candidate: lint/typecheck/build pass. Default unbounded-run wiring/pipeline contention failures both clear in isolation. The bounded current-head non-frozen Windows suite passes 317 files / 3,730 tests, 7 skipped, in 183.78s with `maxWorkers=4`; it excludes only the owner-frozen 19-test auth-broker file because Windows lacks Unix `script`. Linux CI must run the complete suite. Hosted production has `20260821000300`, not `20260821000400`; linked lint currently has 5 errors/10 findings. Publication, Linux full-suite evidence, hosted apply, matching deployment, and owner acceptance remain pending.
- First acceptance evidence: command `0c4d0ca8-1867-4d00-80cf-476401491a17`, durable run `f4594556-6f72-4763-a480-6993939e3651`, and worker Actions run `31746057998`. A real heartbeat and provider thread identifier were recorded, then Codex startup failed. No changed file, factory branch, commit, PR, validation, or exact-head CI evidence was created. Its planned base is now stale against current `main`, so the failed row must not be retried. Activation is OFF.
- Published provider-only diagnostic `31748582858` skipped Docker preload and durable claim. The exact-model GET passed; the bounded non-stored Responses call returned only the safe machine-readable code `credit_balance_exhausted`. The stale failed run was not touched and activation is OFF.
- The exact blocker is no longer funding. The paid dependency was removed from the execution path; the blocker is the owner-supplied `SOFTWAREFACTORY_CODEX_AUTH_JSON`. Configure it, rerun the no-claim diagnostic, then submit a new current-base command. Never retry the stale failed run. No production-monitor journey or successful live Phase 1C provider result exists.

## Immediate sequence

1. Preserve the prior verified production baseline before this update: commit `0c662a24393f682073e6002c5aff9339292226d8`, CI run `31749352644`, and READY deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7`.
2. Preserve the passing frozen candidate. Publish only after exact review; record the new commit, CI, and deployment rather than reusing the prior baseline.
3. Obtain fresh exact owner RED approval for the complete `20260813001500_expose_bounded_run_routing.sql`, then apply only that migration forward to `qpuofpmagrmyamahqwxw` and verify ledger, exact definitions for both widened and all four no-secret constraints, 128-character assignment/run/project behavior, valid and negative credential-shaped catalogue/assignment/routing scalar behavior, both routing-table ACL revokes plus retained model-catalogue SELECT, function definition/signature/security/search-path/ACL, bounded Phase 1C/2A/legacy routing runtime, raw-table/RLS denials, lint, and health. Stop on any mismatch.
4. Revoke the user-pasted OpenAI key at the provider. Keep `SOFTWAREFACTORY_OPENAI_API_KEY` absent permanently and activation OFF. Configure `SOFTWAREFACTORY_CODEX_AUTH_JSON` from a subscription `codex login` through the protected secret path; do not fund an OpenAI API account.
5. Within a separately approved window, admit only `softwarefactory_phase1c_preflight`, then return activation to absent/OFF. Require the pinned CLI, exact-model GET, and bounded non-stored Responses probe to pass while Docker preload and durable claim remain skipped.
6. If that diagnostic fails or is ambiguous, stop. Only after it passes, leave stale run `f4594556-6f72-4763-a480-6993939e3651` untouched, submit a new current-base safe GREEN command, and return activation to absent/OFF immediately after claim.
7. Observe command -> task -> neutral logical agent -> routing reasons -> run -> Codex thread -> validation -> factory branch/commit -> open draft PR -> stable exact-head required checks -> structured report/activity; prove no default-branch write, approval, merge, deployment, rollback, workflow/provider-setting mutation, secret disclosure, or RED execution occurred.
8. Complete the unrelated-authenticated and mutation-denial live matrix, then update repository memory with exact success or failure evidence before changing OpenAI/Codex from **Not Connected**.

## Safe operating notes

- Never print or commit App private keys, client/state/webhook secrets, OAuth/installation tokens, service role, or database credentials.
- Service role is limited to narrow provider-ingress/terminal evidence boundaries and never proves RLS.
- Before any new linked database command, reconfirm the authenticated release identity and exact project `qpuofpmagrmyamahqwxw`; never fall back to the previously wrong/unauthorized profile. No mutation used that profile, and hosted production must never be reset.
- Preserve **Demo Data** and **Not Connected** language when live evidence is absent.
- Keep default-branch writes, non-draft PRs, merge, deploy, rollback, workflow/administration writes, and autonomous execution unavailable.
- `main` is currently unprotected and the published release commit is unsigned; changing branch protection or signature requirements is a separate protected owner-review action.
- Unexpected `theagoras.com` aliases require owner review before any retain/remove routing action; do not mutate protected routing without exact approval.

## Completion checklist

- [ ] Re-establish a current hosted release baseline: resolve 5 linked lint errors/10 findings and the measured autonomy/kill-switch drift, then verify raw/effective controls and worker freshness before applying `20260821000400`.
- [x] Migration `026` is hosted; exact ACL mismatch count is zero, with four intended `service_role` ingress tables and no table privileges on the other 19.
- [x] Historical candidate lint/typecheck, 56 files/436 tests, 38-route build, and 48/48 E2E evidence is retained only as historical Phase 1B evidence.
- [ ] Run and record the complete final gate set for the current routing/UI update; no prior count is current-update evidence.
- [x] Published application-release source/rebuilt-static and production privileged-marker gates pass.
- [x] Candidate cutover publication passed main CI secret-boundary tests; no secret/helper artifact was committed. Prior full source/client scan evidence remains clean.
- [x] Application release `799d2cea189b6860a03987ae75c25765f9ac4aca` is published, CI `31716263910` passes both jobs, and matching READY production deployment `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ` is verified. Production Playwright 48/48, 13/13 routes, invalid webhook, log, and 20-asset checks pass.
- [x] Migrations `011`-`027` are hosted; the prior dry-run/lint/ACL baseline and live `027` behavior pass.
- [x] Authenticated production owner reads pass through Bot Manager, Runs/detail, Backlog/detail, all-eleven-role Agents/detail, Reports/detail, and Connections. Signed-out UI leaks no tenant records, and twelve hosted Phase 1C target/read RPCs deny anonymous callers with `401`/`42501`.
- [ ] Complete the live unrelated-authenticated and mutation-shaped denial matrix. Hosted membership currently has only the owner, so an owner-authorized second tenant/session is required; local integration tests cover this boundary but are not live evidence.
- [x] Real GitHub callback/sync/project/read/edit/ordinary-plus-protected-draft-PR/audit journey passes for the owner connection.
- [x] Exact deployment commit identity is configured server-side in Production/Preview and live draft commits prove matching author and committer without App-bot fallback.
- [x] Dual-App code is deployed, migration `027` is hosted, candidate App `4582606` is installed as `153479019`, and an exact post-sync signed delivery is processed.
- [x] Owner handoff, project/history continuity, candidate-backed reads, draft-only PR `#8`, and cleanup pass.
- [ ] Reverse observation and disconnect/loss journey pass before primary retirement.
- [ ] Failure/revocation/rate-limit/stale-SHA/protected approval/expiry/lease/idempotency/recovery/out-of-order/terminal states pass.
- [x] Documentation and scorecard distinguish hosted `20260821000300`, unhosted `20260821000400`, the old production copy, and the current linked-lint/control/worker blockers without claiming Phase 1C Connected.
- [x] Phase 1E control plane passes lint, typecheck, 143 files/1621 tests, a clean build, and Playwright 117/117 including axe, with the end-to-end journey and failed-rollback escalation proven against the migrated schema.
- [x] Migration `028` is hosted in the reconciled ledger. No real production target has been observed, so every Phase 1E monitoring surface remains **Not Connected** or **Unknown**.
- [x] The control plane is served under `/solutions` and verified live: twelve pages serve both navigation landmarks, every former path returns `308`, and the console stays `noindex` and out of the sitemap. See ADR-041.

## Additional Phase 1C release safeguards

- Do not infer approval for protected migrations/secrets/workflow activation from urgency, prior approval for another phase, or a generic "continue."
- Do not use service role as the user-under-test for RLS acceptance.
- Do not run `supabase db reset` against hosted production or repair/renumber migration history.
- Do not let a Vercel READY state, workflow file, configured secret name, queued command, or mocked SDK response count as a live worker.
- Keep the Phase 1B candidate/primary distinctions and remaining tenant/adverse gaps intact.
- Any new code/schema/provider/deployment change invalidates affected evidence and requires rerunning its gates.

## 2026-08-28 Step 8 current-production handoff

- The visible `invalid Phase 1C command plan` result came from an Aug 22 modal
  that remained mounted. Exact-deployment logs now show authenticated GETs,
  zero `POST /api/commands`, and no command-route 4xx/5xx.
- A fresh Chrome tab as `daniel.hughen@gmail.com` loads the current production
  bundle. It has zero connected AI accounts, ready bots, or assignments; one
  Codex connection is unfinished and Claude OAuth is incomplete.
- Finish one provider OAuth flow and project route setup, then submit a fresh
  Step 8 command and verify immutable record-only route evidence plus persisted
  Step 9 correlation. No worker dispatch or execution enablement is required.

## 2026-08-28 ten-step Factory v2 release handoff

- Exact production is `bb68659a0ee84370f83dd647ae57f4ccb83ea06c`.
  CI `33149814278` passed quality and browser/accessibility 1/3, 2/3, and 3/3;
  Vercel `dpl_2A2bhtevZeBY6422ZYjVGJE5SuTU` / deployment `6137077047` is
  READY behind `www.theagoras.com`.
- Requirements -> Monitor, exact repository/base/policy identity, strict gates,
  durable Phase 1C-to-production lineage, and exact graph/run selection are
  released. Hosted `00210` containment and unchanged `00200` lineage are also
  accepted; do not replay `00150`, reset history, or down-migrate.
- Keep the worker, provider execution, autonomy, and every automatic action
  OFF, with the global kill switch ON. Complete provider OAuth and route setup,
  then verify one new record-only Step 8 command survives reload and correlates
  to Step 9 before changing **Not Connected** status.

## 2026-08-28 hosted containment and lineage acceptance

- Probe run `33150619218` on exact project `qpuofpmagrmyamahqwxw` returned four
  candidates, payload-free manifest SHA-256
  `784acaca2b0957ecb0eeea85e3d0dde2e64ba653c744e708ec8d4094f9175b99`,
  and downstream blockers `0|0|0|0`.
- Containment run `33150654596` matched that exact manifest, applied only
  `20260827000210`, and passed ledger, zero-offender, constraints, private
  FORCE-RLS/no-ACL, immutable-audit, exact tombstone, ACL, and safety checks.
- Lineage run `33150707932` then reconstructed the manifest from private audit
  evidence and applied only unchanged `20260827000200`. Ledger, catalog, RLS,
  eight revoked legacy signatures, exact authenticated-only/evidence-bound
  `decide_node_gate`, audit, runtime, lint, health, and stopped-worker
  postflights all passed.
- The production safety envelope is unchanged: execution workers, provider
  execution, autonomy, and automatic actions are OFF; the global kill switch
  is ON; no running graph or Phase 1C run was introduced. Never replay `00150`,
  reset migration history, restore legacy authority, or down-migrate.
