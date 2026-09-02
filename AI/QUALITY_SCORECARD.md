# Quality scorecard

Last reviewed: 2026-08-31

**Addendum, 2026-09-02 latest+54 - nothing hidden (ADR-232):**
services-nothing-hidden.behavior 4 (six findings each raised once by a
fixture and never by the clean rows, ordered high/medium/low with the
exact detail sentences; three rules dry-run — a lead email blocked by "no
email on file", a service SMS blocked by "no phone on file", an overdue
task with nothing blocking — with counters untouched; every dashboard
figure's rows equal to its aggregate bucket by bucket, technician by
technician, day by day, and a stray key never parsed; a rival sees
nothing and only `authenticated` may execute). services-nothing-hidden
4 (severity and kind counts in the audit's order; dry-run summary by
reason; every figure's key shape accepted and refused; row view). services-
nothing-hidden-routes 5 (window bounded; malformed id and foreign rule
refused without a run; records, summary and Not Connected; unknown figure
and wrong-shaped key refused before the database; null key for a keyless
figure). services-schedule-panel +1, services-dashboards-panel 2,
services-marketing-panel 1, services-copilot +1. Hosted apply scope
`nothing-hidden` with a postflight that refuses a non-STABLE or DEFINER
function.

**Addendum, 2026-09-02 latest+53 - job profitability (ADR-231):**
services-profitability.behavior 6 (a fully known visit priced from
invoice, timesheet-minus-break at the technician's rate and the lot's
unit cost, with a voided duplicate excluded; the scheduled window standing
in and labelled when no shift was clocked; NULL margins for an unknown
rate, an uncosted lot and an unlinked invoice; worst-known-first ordering
with NULLs last and the day window honoured; a rival sees nothing and
only `authenticated` may execute; negative and absurd costs refused,
clearing a cost allowed). services-profitability 3 (view mapping, unknown
reasons, grouped sums over known visits only). services-profitability-
panel 3 (every input printed beside the margin with the unknown explained;
dollars saved as cents and a blank saved as unknown; the window select
refetches). services-copilot +2 (the lost-money skill recognised from its
example; coverage stated before the worst visits are named). Seed audit
64/64 with the two new optional columns populated on most rows. Hosted
apply scope `job-profitability` with its postflight.

**Addendum, 2026-09-02 latest+51 - data you own (ADR-230):**
services-data-own.behavior 5 (self-merge, cross-workspace and non-member
refused; portal-email collision refused with its message; one statement
moves property, work order, contact, invoice, payment and task while the
shared list membership stays and both histories carry "Merged into" /
"Absorbed" with the counts; a merged account refused as survivor, as loser
and as a customer; the import log append-only with counts bounded by the
row count and invisible across workspaces). services-data-import 5
(RFC 4180 with BOM/CRLF/escaped quotes; unmapped column refuses; missing
required refuses; invalid rows named; in-file repeat held back; contact
without first name and label without address refused).
services-data-panel 4 (export list with counts and downloads; header
guesses shown and editable, dry run sent as one and the report repeated;
a 422 repeated verbatim; merge body and moved counts). Seed audit 64/64
with the seed recorded as its own import; all replay, roster and census
guards green at 223 migrations.

**Addendum, 2026-09-02 latest+50 - explainable scoring and assignment
(ADR-229):** services-scoring.behavior 10 (defaults in code and database
the same 27; grant posture; a lead at 65 with every fact including "An
open opportunity worth $2,500.00" and "No activity ever recorded"; churn
at 75 with "An active plan is 30 days past due" and "$486.00 past due";
the calm customer at 30 on exactly no_visit_90d + silent_90d; upsell at 60
highest-first with "1 of 2 locations has no active plan"; override to 80,
switch-off to 90, unknown rule refused by name, delete resets to 65; rival
scores nothing; on-create assignment with the postal-code history line;
backfill 0 then 1 once coverage grows; a chosen territory kept).
services-scoring-panel 5 (points beside facts, model switch re-reads,
save/reset bodies, Reset only when overridden, assignment count repeated
verbatim). services-copilot +2 (the signals composer). Seed audit 63/63
with three overrides; all replay and roster guards green.

**Addendum, 2026-09-02 latest+49 - follow-ups and the suggested next step
(ADR-228):** services-followups.behavior 9 (RLS forced and exact grants on
both tables; all seven rules with their computed reasons and high-first
ordering; a rival organization sees nothing; one open task per key with
the second accept refused by index and the key returning once the task
closes; moments stamped by the row and any asserted moment ignored; the
`task` history line on completion ending the stale-lead rule; a dated
dismissal; a collection action silencing the quiet-invoice rule; both
origin/key contradictions refused). services-followups-panel 5 (buckets,
accept posts the key only, done patches status only, manual create, a 409
surfaced verbatim). services-copilot +2 (the follow-ups composer). The
seed roster, scope replay, migration-version, path-reference and
byte-ceiling guards all pass with the new table, scope and postflight.

**Addendum, 2026-08-31 latest+48 - the close-out tail:**
budget-transactions-editing 5 (PATCH never carries the stated balance;
delete asks first; breaks rendered with stated vs computed; transfer
Link here offered only to the exact counterpart; Unlink sends the group
id); budget-categories-panel 3 with the month-plan card in frame;
services-wdo-print 3 and services-invoice-print 2 (banners, the
browser-rendering statement, absence-as-claim); services-canvassing-panel
4 (route POST, follow-up date only where the schema allows, knock POST,
unassigned rows kept). Node-version row closed with the full gate set
green on v22.22.2. Every remaining open backlog row names its unparker.

**Addendum, 2026-08-31 latest+47 - version-safe Grok ACL verification
(ADR-227):** Exact main `24a6313e98023bfc618a921fc563c9f4bde4cad2`
passed four-job CI `33400336336`, reached READY deployment
`dpl_49dFxebk4jpWEXUtfK2CbsQpBk1T`, and matched public health. Fresh read-only
verify `33401887942` skipped apply/reload and failed closed only at the
specialist catalog predicate. PostgreSQL 17/18 includes `MAINTAIN` in the
owner's default table privilege set, so a fixed expanded count of seven is
incorrect. The candidate compares the actual privilege-type set to
`acldefault('r', relowner)` in both directions, requires its dynamically
derived expanded-row count, and retains owner-only, non-grantable, explicit
role-denial, and PostgreSQL 18 NOT NULL checks. The focused workflow contract
passes 12/12. Exact-head release and a new read-only
verify remain pending; no database or safety state changes with this fix.

**Addendum, 2026-08-31 latest+46 - Grok hosted completion and verifier catalog
containment (ADR-226):** Exact main
`85a7fed15ad876be4e56fd74903e41b68d4488b4` passed all four jobs in CI
`33395309085`, reached READY deployment
`dpl_FcbZciXJFJN1DWxN2mxd23wEPfaU`, and matches public health. Protected
probe `33397278231` measured hosted ledger `0|0`; apply `33397377838` accepted
only 009; independent probe `33397710586` accepted `1|0` with catalog, ACL,
runtime, lint, health, and stopped containment green. Run `33397811324`
applied and ledgered only 010 and reloaded PostgREST, then stopped on its
combined specialist verifier. The verifier treated one table ACL item as one
`aclexplode` privilege row; PostgreSQL expands the item to seven table
privileges. The corrected workflow requires one ACL item, seven exact expanded
owner privileges, and no non-owner or grantable row. PostgreSQL 18 also adds
28 `contype='n'` rows for the table's NOT NULL declarations; the corrected
verifier excludes those from the 24 named business constraints and attests all
28 required NOT NULL attributes separately. Its focused contract is 12/12.
Fresh read-only `verify`, signed-in acceptance, and real provider-backed
E2E still remain; workers/autonomy/actions are OFF and the kill switch is ON.
**GROK BOT: PRODUCTION READY is not declared.**

**Addendum, 2026-08-31 latest+44 - copilot + acceptance journey (ADR-224):**
services-copilot unit 6 (each skill recognized from its own example; the
refusal names every example and never guesses; composed sentences carry
the exact figures). services-crm-seed.behavior grew 6 -> 11: the five
acceptance-journey tests walk the seeded book across module boundaries —
completed-visit paper trail (lines sum to subtotal, netting holds,
timeline written), route-day coherence over every seeded route, a real
invitation acceptance seeing exactly its own invoices and visits, a
balanced journal over the whole book (>500 entries), and copilot overdue
arithmetic agreeing with the SQL. Budget categories panel 3. Suite total
after the close-out conversions: 6,40x passing locally in ~9 minutes.

**Addendum, 2026-08-31 latest+45 - site-wide dark/light theme (ADR-225):**
Focused theme/component contracts are green. The expanded Playwright journey
passes 6/6 tests across desktop, tablet, and mobile and exercises dark default, accessible
label/pressed state, light switch, reload, local-storage and cross-product
persistence, exact root/Factory/Services/Budget/customer palettes, scoped
Services status chips, intentional white print paper, horizontal overflow,
page errors, and serious/critical axe in both modes. A separate deterministic
contract checks text/muted/faint against background/surface/raised for root,
site chrome, Factory, and Services dark/light palettes at >=4.5:1. Consolidated
lint and typecheck pass; the full suite passes 559 files / 6,415 tests with
three files / seven tests skipped; and the production build generates 276
pages. Exact-head CI, Vercel identity, health, and production-browser evidence
remain pending at this repository checkpoint.

**Addendum, 2026-08-31 latest+43 - queue-diagnosis visibility (ADR-223):**
queue-diagnosis unit 16 (withdrawn names the timestamp and never says
"contradicts", pause says waiting-for-a-resume, withdrawal outranks pause);
graph-phase1c-release-lineage.behavior 16 — the new case sets both
timestamps on the fixture graph (pairing the by-columns to satisfy the
pair constraints) and reads them back through the definer as the worker.
Guard suites re-run green: path references both ways, scope replay
executes the new postflight, runbook total 220, and the workflow's
per-step DB_URL preamble is fully extracted — 451,768 bytes against a
guard ratcheted to 455,000.

**Addendum, 2026-08-31 latest+42 - portal filed-copy downloads (ADR-222):**
services-portal.behavior grew to 15: a customer lists their own filed
copies with the original still present and flagged superseded, reads a
body, and a rival tenant's customer (or a stranger login) asking with a
real id gets the empty set — the same answer as "no such document". The
fixture lesson cost two failed runs: crm_service_documents refuses a row
that names no subject (property/work order/inspection) and byte_size must
be octet_length(body) computed in SQL, and a hand-ordered parameter list
put a document id in filed_by. hosted-scope-replay executes the new
postflight against the migrated chain; runbook total 220.

**Addendum, 2026-08-31 latest+41 - the day route (ADR-221):**
services-day-route.behavior 11 on the real chain, most of them about the
three ways somebody drives to the wrong place: a stop whose visit is
scheduled for another day (refused, naming both dates), a visit on two
routes, two live routes for one technician on one morning. Also that
resequencing renumbers from one and carries the dispatcher's planned
arrival and note across a drag; that putting a visit on a route assigns it
to that technician while a visit already belonging to somebody else is
refused rather than quietly reassigned; that the same visit twice in one
order is refused; that a completed route cannot be resequenced; and that
anon and service_role hold NOTHING on the new tables despite hosted-like
default privileges being injected before the CRM foundation — this suite
replays the chain rather than restoring the snapshot for exactly that
reason, because a revoke only means something if the grant was there to
revoke. The postflight caught a bug in itself: role_table_grants reports
the table OWNER's privileges too, so an unscoped delete-grant check fails
on a correct schema. RLS census 215 -> 217; grants 60 -> 62 crm tables;
runbook 215 -> 216; seed report 59/59 -> 61/61 and 55,723 -> 57,447 rows,
with 857 routes and 867 stops. Matrix: 9 GAP -> 8, 9 PARTIAL -> 10.

**Addendum, 2026-08-31 latest+40 - accounting export (ADR-220):**
accounting-export unit 14 and services-accounting-export.behavior 6 on the
real chain. The unit suite pins what an accountant checks: every entry
balances, an unbalanced one throws rather than rendering, a draft and a
void post nothing, the tax line is omitted when there is no tax, a refund
mirrors a payment rather than negating one, a write-off takes only what is
still outstanding, cents render by integer arithmetic across values that
floating division gets wrong, and a customer called "Vance, Marisol" or
"The \"Pest\" People" stays inside one CSV field. The behaviour suite runs
the same builder over rows the DATABASE produced and found three things
fixtures would not have: crm_refunds points at a PAYMENT rather than an
invoice, so the first draft dropped every refund silently; crm_payments
carries its own account_id; and the payment triggers NET REFUNDS OUT of
paid_cents, so a design that also posted refunds separately would
double-count — this one does not, and Accounts Receivable provably nets to
zero across raise, payment, refund and write-off. The route's first draft
reached across composite foreign keys with PostgREST embeddings, which
cannot be verified without a live PostgREST; four plain selects joined in
memory replaced them. No migration. Matrix: 10 GAP -> 9, 8 PARTIAL -> 9.

Also in this batch: 17 more suites moved onto the migration snapshot
(199 tests, test time 83.27s -> 55.39s). The CI quality job went 19m19s on
#480 to 18m00s on #481 with only two suites converted, so the ceiling
headroom is back from 41 seconds to about two minutes. Bulk conversion was
attempted twice with a regex and reverted both times; the shapes differ too
much (three suites declare the database inside a helper function, one has a
local name colliding with the import, one has its own chain-applying
helper). The 17 that stand were done per file with the imports fixed and
every suite run.

**Addendum, 2026-08-31 latest+39 - Grok claim and specialist admission
(ADR-219):** The rebased repository candidate carries two forward-only files:
009 claim fence (`7f2dc3b80e466b3c06f589ac6383fd768df847d66e02ec0cab53b8d8431ab737`,
92,648 canonical-LF bytes) and 010 specialist planning
(`728628f0368e1f715d8c786ffb536d2d3fcc3a859a177a0665a00ea98a8386f1`,
56,636 canonical-LF bytes). The integrated migration inventory is 220.

Measured focused evidence on this rebased candidate is 17/17 for the dedicated
release-workflow contract, 10/10 for claim behavior/contracts, and 69/69 for
worker/auth runtime. These suites cover ordered hash-pinned scopes, protocol-v3
claim projection, stale/missing admission refusal, exact admitted credential
resolution after claim, legacy credential behavior, and alternate admitted
OpenAI models using their supported default reasoning effort. Earlier combined
planner/admission/release lanes passed 164/164 before the final rebase; that is
supporting evidence only and is not counted as a final-tree release gate.

The implementation also adds deterministic planner-v3 complete-roster evidence,
identical TypeScript/PostgreSQL wildcard normalization, append-only forced-RLS
specialist rows, v3-only new launch/claim authority, and fail-closed
research/deploy planning where no canonical executable bridge exists.
Consolidated local lint, typecheck, 559 test files / 6,415 tests, and the
276-page production build pass on the final combined tree; the separate
site-theme browser journey passes 6/6. Migration chain/catalog/RLS/ACL/replay/
rollback, exact CI and deployment identity, hosted postflight, signed-in
acceptance, and provider-backed end-to-end evidence remain pending.

**Status:** repository candidate only. Migrations 009/010 are unhosted; workers,
autonomy, and all automatic actions are OFF; the global kill switch is ON; no
provider-backed run or draft-PR/CI journey has passed. **GROK BOT: PRODUCTION
READY is not declared.**

**Addendum, 2026-08-31 latest+38 - autopay authorisation (ADR-218):**
services-autopay.behavior 15 on the real chain, most about what cannot
happen: a card number refused in the holder name, spaced or dashed, and in
the brand; a last_four longer than four refused; an expiry on a bank
account refused and its absence on a card refused; autopay refused when the
mandate belongs to the customer's OTHER card; a mandate unable to be edited
or deleted by anybody; a charge scheduled against the OUTSTANDING balance
rather than the whole bill again; a charge over the authorised ceiling
refused naming both amounts; an invoice belonging to another account
refused; a second live charge on one invoice refused; a settlement refused
while no processor is connected AND unable to be hand-written, with a
direct insert claiming `succeeded` refused by constraint; two live
enrollments per account refused; a removed instrument unable to be
enrolled; one workspace's instruments, mandates and charges invisible to
another. And the gate proved to OPEN: with the owner's switch on AND a
sealed credential present a real settlement lands and records the
processor's reference, while the switch alone does not, and a settled
charge cannot then be cancelled. payment-instruments unit 10, including a
parity table run through BOTH the browser rule and text_has_likely_pan so
the two cannot drift, and a card alive through the last day of its expiry
month rather than dying on the first. Two defects caught by tests rather
than a customer: `%.2f` is not valid in RAISE, so the cap message printed
"450.0000000000000000"; and the seed read an invoice status of `paid` that
does not exist in this schema, which is how its first draft quietly
produced 72 rows instead of 351. RLS census 211 -> 215; grants 56 -> 60 crm
tables; runbook 214 -> 215; seed report 55/55 -> 59/59 and 54,331 ->
55,628 rows, with 320 instruments, 320 mandates, 306 enrollments and 351
charge attempts of which exactly zero are `succeeded`. Matrix: 11 GAP ->
10, 7 PARTIAL -> 8.

Also in this increment, measured rather than assumed: 51 suites each
replayed all 215 migrations at 5,378ms apiece. Dumping the finished data
directory costs 217ms and restoring one costs 981ms, so
tests/support/migrated-database.ts builds the chain once and hands out
restored copies. The autopay suite went 8.20s cold to 2.17s warm — 3.8x —
and the CI `quality` job had finished #480 with 41 seconds to spare under
its twenty-minute ceiling, so this was the increment that needed it.

**Addendum, 2026-08-31 latest+37 - transactional notices (ADR-217):**
services-notices.behavior 16 on the real chain, most of them about what
CANNOT happen: a notice refused a dispatch while no provider is connected;
no UPDATE or DELETE grant at all, so nothing can hand-write a send; a row
inserted directly claiming `sent` refused by constraint; one notice per
subject per day however many times Remind is pressed; a do-not-contact
suppressing the notice while KEEPING it, with its reason and its body, so
"was this customer told?" has an answer; the outstanding reader showing
suppressed alongside composed; no state meaning "do not contact but
marketing is fine"; a preference change and its later lifting both written
into the account history; a kind that does not match what it points at
refused; a subject line required for email and refused for SMS; one book's
notices invisible to another; a sent notice unable to be cancelled. And the
gate proved to OPEN, because a gate that never opens is a wall: with the
owner's switch on AND a sealed credential present, a real dispatch lands
and records the provider's reference; with either half missing it refuses;
a second dispatch of the same notice refuses. notices unit 15: a template
that would render a gap refuses instead of sending "Hi , your visit is on
."; smsCost naming the one curly apostrophe that re-encodes a message as
UCS-2 and collapses the limit from 160 to 70. Two defects caught in review
rather than production: a CHECK constraint using the STABLE `at time zone`
(constraints require immutable expressions) and a trigger reading OLD on
INSERT behind an `and` SQL does not promise to short-circuit. RLS census
209 -> 211; grants 54 -> 56 crm tables; runbook 213 -> 214; seed report
53/53 -> 55/55 and 51,800 -> 54,331 rows, with 1,827 notices of which
exactly zero are `sent`. Matrix: 12 GAP -> 11, 6 PARTIAL -> 7.

**Addendum, 2026-08-31 latest+36 - filed service documents (ADR-216):**
services-documents.behavior 9 on the real chain: bytes kept exactly as
filed; the copy unable to be updated or deleted by anybody, which is the
whole value; a correction filed as another document naming the one it
replaces, with the original still readable and marked superseded; a
document about nothing refused; a size that disagrees with the body refused
so a truncated file cannot claim to be whole; a content type this product
cannot produce refused; the index carrying sizes rather than bodies so
listing does not move megabytes; one book's filings invisible to another;
the reader still an invoker. The row was recorded as blocked on object
storage and that was wrong — job_seeker_uploads had solved the same problem
already. bytea became TEXT after the seed exposed a real incompatibility:
PostgREST wants a hex string for a bytea and the PGlite harness wants
bytes, so the two paths would have disagreed about one column. RLS census
208 -> 209; grants 53 -> 54 crm tables; runbook 213; seed report 52/52 ->
53/53 and 51,281 -> 51,800 rows, with 519 filed documents including
corrections and inspection copies. Matrix: 13 GAP -> 12, 5 PARTIAL -> 6.

**Addendum, 2026-08-31 latest+35 - multi-unit properties (ADR-215):**
services-multi-unit.behavior 9 on the real chain, most of them about the
wrong door rather than the right one: a visit refused when it names a unit
of a different property, and the same for a station and a sighting; one
door being one row however it is typed, while the same number in another
building is a different door; the coverage reader naming never-serviced
units FIRST, because a 200-unit sweep that reached 188 is normal and the
twelve nobody opened are the point; a unit's own stations and sightings
counted rather than the building's; a property with no units behaving
exactly as before; a removed door detaching from its visit rather than
deleting the work; one book's doors invisible to another; and the reader
still an invoker. That suite caught a real bug in the migration: ON DELETE
SET NULL on a COMPOSITE key nulls every referencing column, two of which
are NOT NULL, so deleting a door would have failed at the constraint — the
column-list form `set null (unit_id)` detaches the door alone, and the
postflight asserts all four references carry exactly one column in their
delete set. RLS census 207 -> 208; grants 52 -> 53 crm tables; runbook 212;
seed report 51/51 -> 52/52 and 50,063 -> 51,281 rows, with 1,218 doors.
Matrix: 48 HAVE -> 49, 14 GAP -> 13.

**Addendum, 2026-08-31 latest+34 - the printable station label (ADR-214):**
code39 13 pins the transcribed pattern table by the properties the real one
has — nine elements each, exactly three wide, only narrow and wide, all
forty-four distinct — plus the framing, the alternation, the quiet zone, and
four refusals. The refusal that matters: a lowercase barcode is NOT
uppercased to make it fit, because crm_devices_org_barcode_key is
case-sensitive and the symbol would scan as a different station on a
regulated site. services-ipm-panel gains 2: a symbol beside the barcode a
scan resolves to, and a lowercase barcode printing without one and saying
why. No migration. Matrix: 47 HAVE -> 48, 4 PARTIAL -> 3, and the last row
code alone could close is closed.

**Addendum, 2026-08-31 latest+33 - the roster that had fallen behind:**
The seed report's table list was hand-written, so "48/48 tables passing"
was complete only relative to a list three tables out of date:
crm_service_integrations (ADR-207), crm_field_submissions (ADR-210) and
crm_plan_steps (ADR-211) had shipped without entering it, and
crm_stock_movements (ADR-213) would have made four. A green that means less
than it looks like is worse than a red, because nobody investigates it.
seed-report-covers-every-table 3 now compares the roster against the tables
the migrations actually create, in both directions — an uncovered table
fails, and so does a spec naming a table that no longer exists — and
requires a real reason beside anything deliberately excused. One table is
excused: the provider registry, which holds at most one row per provider.
The other three are seeded for real: 558 plan steps, 1,183 stock movements
including consumptions whose quantities match the applications they served,
and 262 field submissions across all three kinds. Report: 48/48 -> 51/51,
48,060 -> 50,063 records.

**Addendum, 2026-08-31 latest+32 - truck stock (ADR-213):**
services-truck-stock.behavior 12 on the real chain: balances derived from
the ledger rather than stored, so a receipt of 100 and a transfer of 40
read as 60 at the depot and 40 on the truck; a draw larger than a location
holds refused in its own words; a draw from a place that never held the lot
refused; a consumption whose quantity disagrees with its application
refused, and the agreeing one accepted; one application drawing exactly
once however often a sync replays; a consumption naming no application
refused; a consumption for another lot's application refused; a miscount
corrected by a second movement with both rows surviving; three impossible
shapes refused by constraint (a receipt that also has a source, a transfer
to where it already is, an adjustment claiming an application); the ledger
undeletable and unupdatable by a member; one book's stock invisible to
another; and both stock functions still invokers. services-stock-routes 11
pins the boundary: places named rather than uuids, a location emptied to
zero not shown as a holding, six database refusals each arriving with its
own status and the database's own sentence, and two malformed movements
refused before the database sees them. RLS census 206 -> 207; grants 51 ->
52 crm tables; runbook 211; workflow scope `truck-stock`. Matrix: 46 HAVE
-> 47, 4 PARTIAL -> 3.

**Addendum, 2026-08-31 latest+31 - invoices from the visit (ADR-212):**
services-invoice-from-visit.behavior 12 on the real chain: the service at
the plan's value plus one chemical line naming product, amount, target and
EPA number, with the invoice totals recomputed by the same statement that
wrote the lines; a second build refused rather than doubling the invoice,
proven by counting the lines afterwards; the same visit refused on a second
invoice with the first one's number in the message; a dispatched visit
refused because a visit is billed after it happens; an issued invoice
refused because a customer already holds it; a superseded application
excluded so the invoice bills the correction rather than the mistake; a
0.125 oz dose printed at its recorded scale rather than rounded into a
two-decimal financial column; a one-off visit priced at zero rather than
guessed; hand-typed lines kept and generated ones numbered after them; a
visit from another account refused; one book's visits invisible to
another's invoices; and the generator still an invoker with invoice lines
still undeletable by any browser role. services-invoice-from-visit-routes 9
pins that each of seven database refusals reaches the operator as its own
status and the database's own words. Two defects were caught in review
before first run: trim(trailing '0') renders 100.000 as "1", and the
service date rendered in the session's timezone. Runbook 210; workflow
scope `invoice-from-visit`. Matrix: 45 HAVE -> 46, 5 PARTIAL -> 4.

**Addendum, 2026-08-31 latest+30 - plan sequencing (ADR-211):**
services-plan-sequencing.behavior 14 on the real chain: a twice-monthly
account on the 1st and the 15th for a whole year rather than 27 drifting
fortnights; a seasonal program holding March/June/September/November across
a year boundary with a different service named per visit; a plan nobody
sequenced answering with nothing rather than inventing a date; the next
occurrence strictly after the last, so generating cannot produce one date
twice; SQL and the browser preview agreeing date for date over three years;
visits and bills reported side by side at 4 against 12; a step outside its
cycle refused; a step on a plan with no cycle refused; the cycle refused
both when cleared under existing steps and when shrunk past one, each
through PostgREST rather than through a function somebody has to call; a
step carrying two anchors refused so no generator ever chooses; one book's
calendar invisible to another, including through the generator; every
sequencing function still an invoker; and the billing period unchanged.
plan-sequence 13 pins the date arithmetic directly, including that day 31
is month end in February and that week 5 means the last matching weekday in
a month with four. services-plan-sequencing-routes 11 pins the boundary: a
sequenced plan advancing along its calendar rather than its recurrence, the
step's own service reaching the work order, a sequence with nothing ahead
refused rather than quietly falling back to the interval, an unsequenced
plan untouched, and four shapes refused before the database has to see
them. services-schedule-panel gains 2, which is the "on a page" half: the
preview appears before a save because the browser computes it, and the
cadence line says visits and bills separately the moment they disagree.
RLS census 205 -> 206; grants 50 -> 51 crm tables; runbook 209;
workflow scope `plan-sequencing`. Matrix: 44 HAVE -> 45, 6 PARTIAL -> 5.

**Addendum, 2026-08-31 latest+29 - the offline field queue (ADR-210):**
services-field-offline.behavior 9 on the real chain: a visit recorded at
the technician's own moment rather than the sync's; five replays of one
completion leaving exactly one submission, with neither the timestamp nor
the note overwritten by a retry carrying different text; four replays of a
station scan leaving ONE ledger event with the original count of 4 rather
than five events or a 99 — which matters more than the completion case
because crm_device_events is append-only and a double count could never be
corrected; a week-late arrival not overwriting a visit the office already
closed from a paper ticket; the server answering which tokens it actually
holds so a device reconciles against authority rather than its own
storage; two tenants minting the SAME uuid without either seeing the
other's submission, because the token is unique per organization; a
refusal for another account's work order that says the same thing whether
it exists or is not theirs; the submission log undeletable under forced
RLS; and every field function still an invoker. field-queue 10 pins the
client decisions — a replay settling rather than erroring, a permanent
refusal staying counted as unsent, oldest-first ordering, and nothing
unsent ever pruned at any age. Building it surfaced a shipped defect:
crm_work_order_set_completed_at stamped now() unconditionally, which would
have recorded every offline visit at sync time and corrupted productivity,
route density and recurring invoice service dates; 38 existing tests
confirm the coalesce fix is backward compatible. RLS census 203 → 204;
grants 49 → 50 crm tables; runbook 208; workflow scope
`field-offline-queue`.

**Addendum, 2026-08-31 latest+28 - restricted keys (ADR-209):**
A Stripe restricted key was invisible to all three secret detectors while
lib/billing accepted one as a valid STRIPE_SECRET_KEY — the system called
it a credential in one place and not in the layer that decides whether it
may be stored, committed or logged. Fixed in all three at once because the
parity suites bind them; 91 tests across secret-detector-parity,
secret-detector-sql-parity, sensitive-data, owner-approved-protected-draft-
changes and billing-plans. The new fixture is asserted in both parity sets,
and a new test pins the deliberate `pk_` exclusion so the obvious tidy to
`[sprk]k_` has to argue with it. The migration is the live body with ONE
character class changed, generated by patching that substring: a first
attempt rebuilt the function from its leading regex and silently dropped
the ~110 lines of assignment and JSON walking behind it, which an existing
test caught immediately. The postflight asserts every previously-caught
shape still trips, both walkers still work, and placeholders and
publishable keys still pass through. Runbook 206; workflow scope
`secret-guard-restricted-keys`.

**Addendum, 2026-08-31 latest+27 - the integration registry (ADR-207):**
services-integrations.behavior 9 on the real chain: all eight providers
reported including the ones nobody configured, because a capability the
workspace lacks is what a page most needs to be told about; a provider
configured AND switched on but with no credential still reported not live,
which is the assertion the whole increment exists for; live turning on the
moment a sealed credential appears and back off when either the credential
is removed or the switch is thrown; a credential filed under a different
purpose refusing to stand in; a key refused from the display label, the
settings blob, and — after a route test caught the gap — the purpose name,
whose shape check a Stripe secret key satisfies exactly and which was the
one free-text column left unguarded in the first draft; one row per provider
per workspace; a non-member refused with "membership is required" rather
than handed an empty list; and the status function's RETURNS signature
proven not to carry an envelope while provider_credentials stays unreadable
by anon and authenticated alike. services-integrations-routes 9 pins the
boundary: paused counted apart from awaiting-a-credential because the
owner's next step differs, a live provider with a recorded error reported
failing rather than connected, a caller's attempt to assert `live` refused
by the strict schema, three shapes of credential field refused outright,
and the route re-reading status rather than echoing its own write. RLS
census 202 → 203; grants 48 → 49 crm tables; runbook 205; workflow scope
`service-integrations`.

**Addendum, 2026-08-31 latest+26 - the activity heat map (ADR-206):**
portal-heat-map 6, pinning the four cell states the grid draws and one
assertion that they never collapse into fewer: a month absent from the
response classified as unscanned rather than clean (the function only
returns a row where a scan happened, so the months nobody visited are
exactly the ones missing, and a grid built from the returned rows alone
would drop them silently); a scan with no number written down kept out of
the clean state; a counted zero allowed to be clean, because that one
actually is; and a bigint total crossing as a number rather than a string,
without which the shading would compare text and rank 9 above 31. No
migration, no new tables, no seed change. It also corrected the matrix's
"commercial trend reports with heat maps" row, which was still GAP after
ADR-203 shipped the data behind it — 12 GAP down to 11, 18 rows now short
of HAVE.

**Addendum, 2026-08-31 latest+28 - Grok provider admission (ADR-208):**
the focused application/admission/security suites pass 119/119, the protected
release workflow contract passes 12/12, and its migration behavior/contract
slice passes 43 tests. Lint, strict typecheck, production build, YAML parsing,
every workflow shell block, canonical LF hash, and `git diff --check` pass.
The exact rebased full repository run passes 6,068 tests with seven skipped,
plus lint, strict typecheck, and the 266-page production build. The new
evidence table is forced
RLS with no direct non-owner grants, its rows reject update/delete/truncate,
the old launcher is no longer service-role callable, and the new workflow
canary rolls every fixture back after proving mismatch zero residue, valid
replay, hash integrity, pause, and zero graph/node runs. Exact commit
`49b087e1044c157ea24271c81070a2c38b03c8da` passed CI `33364471690` and
exact READY deployment `dpl_FeUuBGBeQBDEieFtquUoHRCBPWbc`. Protected run
`33365674624` applied and ledgered the migration once, then failed closed on
two stale workflow-only `prosrc` fingerprints; exact-body/PGlite catalog
verification proves the hosted function identities and ACLs are otherwise
correct. Hash-fix commit `d5e91c78e7696072eba72cb744d747c724b73eec`
reached then-current exact-main CI `33368051986` and READY deployment
`dpl_Hazwv3nZwHnNer7FAKSfkMqGThUU`. Read-only run `33369343687` passed exact
identity, ledger, catalog, and stopped containment, then failed before the
rollback canary because its `psql -c` command could not interpolate three
client variables; apply/reload were skipped and nothing durable changed. The
workflow now routes that input through a checked-in `psql -f` script and pins
the broken form with a regression test. Forward fix
`7bdbb5b7a5ef5466f7283ec66d09d3240fbc9311` was retained byte-for-byte by
then-current main `f86062a616c3859d93569fb7edfe15d3025b0c26`, whose exact
CI `33370961802`, READY deployment `dpl_7vXNrvijm5RrSpLLEnVCSxrrvgDc`, and
read-only verify `33372115428` all passed. Verify apply/reload stayed skipped;
ledger, catalog, ACL, rollback runtime, linked lint, health, and stopped safety
were green. Signed-in reload retained the exact durable blocked session and
both messages while showing no plan, graph, worker, or provider start. Launch
admission is accepted, but worker claim/wake is not admission-fenced, so this
score does not declare full production readiness.

**Addendum, 2026-08-31 latest+25 - WDO reports (ADR-205):**
services-wdo-inspections.behavior 14 on the real chain: an inspection
refused for not answering the headline question; a report claiming evidence
it never recorded refused; a report calling a structure clean while a live
infestation sits on it refused — and BOTH of those refused again through a
direct column write, because the first draft enforced them only in
`crm_wdo_issue_report` and a member can PATCH `status` through PostgREST,
which was a real hole and now has a test coming in through that door; a
genuinely clean report issuing with a conducive condition recorded on it,
since drawing the adverse line anywhere wider makes an honest clean report
unissuable; the `select (f(x)).*` mistake — fourteen evaluations of a
mutating function from one line — rolling back whole rather than
half-issuing, which is why that one guard stays in the function where the
shared transaction `now()` cannot defeat it; an issued report and its
findings frozen, with a correction superseding instead; coordinates paired
and inside the unit square; the summary counting evidence and clean over
ISSUED reports only so a draft lands in neither column; the customer seeing
issued reports with their obstructions spelled out and never a draft; the
rival tenant getting nothing through either door; no DELETE on either
table; and both function polarities asserted. services-wdo-routes 9 pins
the boundary — a null summary rather than a page of zeroes for a workspace
that has inspected nothing, `visibleEvidence` refused with no default, the
database's own sentence reaching the inspector rather than "something went
wrong", 409 for already-issued, and `status`/`issuedAt` refused as if they
were fields. Seed 48/48 tables, 48,060 records, with 352 reports and 464
findings in all four honest shapes, issued through the product's own
function rather than by writing `status`. RLS census 200 → 202; service-role
grants 46 → 48 crm tables; runbook 204; workflow scope `wdo-inspections`.
The PGlite supabase shim gained `.rpc()`, without which the seeder would
have been silently forced into the shortcut the schema exists to close.

**Addendum, 2026-08-31 latest+24 - the commercial portal view (ADR-203):**
services-commercial-portal.behavior 15 on the real chain: the LATEST scan
reported rather than the first or a sum of both; a station scanned with no
number written down reporting null, never 0; a station with a real count
and no threshold reporting a null `over_threshold`, because there is no
question to answer; a trend cell showing one scan and no activity, so an
empty month cannot read as a clean one; a corrected sighting absent from
open conditions while the open one stays; a safety library holding only
what was applied at this customer's own sites and not what the branch
stocks; completed inspections only, with `signature_path` absent from the
projection rather than filtered; a customer's own report stamped with their
portal seat and visible to staff as such; a refusal for another account's
site and for a null one; the rival tenant seeing its own binder and getting
zero rows even when it names Acme's site id explicitly; a signed-in
stranger getting nothing on all six reads; a deactivated login closing the
binder mid-session; and `crm_portal_account_for` still executable by
nobody. services-commercial-portal-routes 9 pins the boundary — the null
activity total surviving to JSON, `unknown` counted apart from `clear`, the
same property filter reaching BOTH the table and the trend, the window
bounded at 422 before it becomes a scan, `missingSds` counted rather than
hidden, and the database's refusal arriving as a 404 rather than a 500.
services-crm-seed grew a provenance test: both kinds of sighting exist and
no stamp crosses an account; the seed report now shows crm_pest_sightings
at 5/5 optional fields. RLS census unchanged at 200 and grants unchanged at
46 crm tables — this migration creates no tables; runbook 202; workflow
scope `commercial-portal`. The workflow ceiling ratcheted 480,000 → 478,000
after three inline heredoc guards were extracted, and
migration-path-references now checks `.github/hosted-apply/**` in both
directions.

**Addendum, 2026-08-31 latest+23 - revenue forecasting (ADR-202):**
services-revenue-forecast.behavior 9 on the real chain: a monthly plan
contributing once a month, a quarterly a third, and a weekly 365/7/12 —
not four, which is the arithmetic everybody gets wrong and which would lose
a whole cycle a year; an inactive plan and an unpriced one both
contributing nothing; a contract spread across its term while an open-ended
one stays out, because a term that does not exist cannot be spread and the
plans underneath it are already counted; the basis reporting both
omissions; a null priced share for a book with no plans; tenant isolation
through an aggregate; and neither function a definer.
services-dashboards-routes grew to 10, and the added one asserts the
payload states `churnApplied: false` — so adding a churn model later means
deleting a test that says there isn't one. RLS census unchanged at 200 and
grants unchanged at 46 crm tables, because this migration creates no
tables; runbook 201; workflow scope `revenue-forecast`.

**Addendum, 2026-08-31 latest+22 - equipment and fleet (ADR-201):**
services-equipment-fleet.behavior 13 on the real chain: an asset born with
its acquisition event written by trigger rather than by the caller
remembering; a backwards meter refused with BOTH readings in the message
and the honest reading accepted straight after; assignment, transfer and
release all through the ledger with the roster following; an `assigned`
event naming nobody refused; repair in and back out; a 180-day schedule
computed from the service just recorded while an asset with no interval
reports null rather than a date; a scheduled asset never serviced reporting
-310 days, because overdue-since-new is a finding and not an exemption; a
retirement that clears the assignment and then refuses everything after; a
retired status with no date refused; half a meter reading refused; an asset
tag colliding case-insensitively inside a company and reusable across
companies; the ledger append-only and the asset undeletable; and the report
proven not to be a definer. services-fleet-routes 8 pins the boundary,
including four separate attempts to set a projection through PATCH — every
one refused — and the backwards-meter message surviving to the technician
with both numbers intact.
Two of those tests earned their keep immediately: the tag test caught a
CHECK that demanded uppercase and so made the case-insensitive index
unreachable, and three route tests failed on UUIDs containing a `g`, which
is not a hex digit — the schema was right and the fixture was wrong. Seed
extended to 46 tables — 47,244 rows, 46/46 PASS, deliberately carrying
assets with no service interval, because that is the row the fleet report
keeps out of "fine". RLS census 200; service-role grants at 46 crm tables;
runbook 200; workflow scope `equipment-fleet` postflight re-proves the
append-only grant on the ledger, both projection triggers, and that the tag
index is case-insensitive.

**Addendum, 2026-08-31 latest+21 - recurring billing (ADR-200):**
services-recurring-billing.behavior 14 on the real chain, most of them
pressing on one invariant from a different angle: the due plans billed and
the not-yet-due one left alone; the unpriced plan considered and skipped
rather than invoiced for zero; each plan advanced by its OWN recurrence, so
a quarterly moves three months and a monthly one; the button pressed twice
billing once AND reporting the skip, so a re-run is distinguishable from a
run with nothing to do; a hand-written duplicate refused by
crm_invoices_plan_period_key itself, proving the guarantee does not depend
on the generator's care; two hand-raised invoices on the same day both
landing, proving the index is partial; half a provenance refused; a rival
naming our organization refused at the first write rather than silently
finding nothing; the worklist ordered oldest-and-largest with a threshold
that excludes the barely-late; a collections note filed against the wrong
customer refused by name; and no definer among the writers.
services-collections-routes 9 pins the boundary: the organization taken
from the workspace and never the body, a re-run's skipped count surviving
to the response, both Not Connected labels, the age copied onto the record
as sent, and the age filter bounded.
A fourth latent-trap guard shipped with it —
migration-partial-index-conflict — after the real clause was written wrong
first: ON CONFLICT against a partial unique index must repeat the
predicate, and the failure waits for a real user rather than the migration.
Its first draft mis-blamed the credential vault (column names matched on a
different table) and its second passed while the defect was live (an
earlier INSERT in the same function swallowed the match); it is table-aware
and scans backward now, and was verified by deleting the predicate and
watching it fail. Seed extended to 44 tables — 45,532 rows, 44/44 PASS,
zero orphans, and deliberately carrying overdue invoices nobody has
touched, because that is the row the worklist exists to surface. RLS census
198; service-role grants at 44 crm tables; runbook 199; workflow scope
`recurring-billing` postflight re-proves the index is present and partial,
that a notice cannot be edited after the fact, and that neither writer is a
definer.

**Addendum, 2026-08-31 latest+20 - the operating dashboards (ADR-199):**
services-dashboards.behavior 13 on the real chain: a draft invoice excluded
from revenue while the issued one counts; eleven months of null collection
rate beside one real zero, which is the distinction the whole file exists to
keep; a rate that rises when a payment lands and falls when part of it is
refunded; one tenant's 900,000 absent from the other's total through an
aggregate, proving RLS holds through a sum as it holds through a list; an
invoice aged into the bucket its due date puts it in, with every empty
bucket still naming itself and an undated invoice refusing to be aged as
current; retention null for a book with nobody in it; the technician with
nothing scheduled kept on the list with a null rate rather than dropped; a
finished shift's 450 minutes counted while a running one adds none and a
technician whose every shift is open reporting null; a two-hour hole
measured between two stops and a one-stop day's idle left unknown; a
cancelled visit absent from the route because nobody drove to it; and no
definer among the five. services-dashboards-routes 8 pins the boundary:
nulls surviving to JSON, caller windows bounded before they become scans,
overdue excluding both not-yet-due and undated, and exactly five aggregate
calls with no table reads at all. No new tables, so the RLS census stays
196 and service-role grants stay at 42 crm tables; runbook 198; workflow
scope `operating-dashboards` postflight re-proves all five are reachable by
authenticated, by neither anon nor service_role, and — the check that
matters — that none of them is a definer.

**Addendum, 2026-08-31 latest+19 - the customer portal (ADR-198):**
services-portal.behavior 13 on the real chain under hosted-style default
privileges, written from the attacker's side: a rival's customer reading our
invoices through a definer that could have returned everything and getting
only their own; a signed-in stranger with no portal link calling all five
reads and getting nothing five times; a deactivated login still holding a
session, with restoring it restoring exactly one account; a customer filing a
request against a rival's site refused by name, with their own landing; the
resolver `crm_portal_account_for(uuid)` executable by NO role while the
argument-free `crm_portal_me()` answers only about the caller; a rival
assigning our customer's login refused by the activation trigger, and the
patient version — inviting our customer's own address and waiting for them to
accept — refused by the global unique index; a portal user reading the two
tables directly and seeing nothing; a draft invoice never reaching the
customer; an unactivated invitation unable to act as a login; and `anon`
holding execute on no portal function.
services-customer-portal-routes 14 pins the boundary: one flat 403 carrying
neither account nor organization id, argument-free RPC on every read, both
Not Connected labels, an insert that omits `user_id` entirely rather than
nulling it, a triage that cannot rewrite the customer's words, the closing
moment supplied with a closing status and cleared when reopened, and the two
rollout figures (invitations never used, accounts never invited) computed
rather than estimated. Seed extended to 42 tables — 44,837 rows, 42/42 PASS,
zero orphans; portal logins are invitations only, and `user_id`,
`activated_at` and `last_seen_at` are excluded from optional-field coverage
on purpose rather than faked. RLS census 189; hosted service-role grants at
42 crm tables; runbook 195; workflow scope `customer-portal` postflight
re-proves forced RLS, no DELETE, the sealed resolver, the activation guard
and the nine caller-scoped definers after every apply.

**Addendum, 2026-08-31 latest+18 - the forms engine (ADR-197):**
services-forms.behavior 9 on the real chain under hosted-style default
privileges (prose refused for a number question by name with the right value
accepted; a choice outside the offered list and a multi-select outside it
both refused, with a real two-value multi-select accepted; completion refused
while a required question is unanswered AND the same transition succeeding
once it is answered; a template frozen once a form is assigned from it, with
the new version the refusal names actually working; a two-thirds signature
and a URL signature both refused with a real stored path accepted; an
overlapping shift refused with a later one accepted; ends-before-starts and
past-24-hours both refused; a licence expiry with no licence behind it
refused; anon/service_role shut out with no DELETE on any of the five;
tenant isolation). Seed extended to 40 tables — 44,067 rows, 40/40 PASS,
zero orphans, carrying both a running shift and finished ones because the
page renders both. RLS census 187; hosted service-role grants at 40 crm
tables; runbook 194; workflow scope `forms-timesheets-licences` postflight
proves forced RLS, no delete, all four guards and the licence columns.
**Also this round:** the select-contract guard now resolves the shared
`CRM_*_COLUMNS` constants instead of skipping them — 181 call sites moved
from unverified to verified, with a second assertion pinning the resolution
because its failure mode is silent. Lint zero warnings, tsc clean.

**Addendum, 2026-08-31 latest+17 - documents, canvassing, marketing
(ADR-196):** services-marketing-canvassing.behavior 9 on the real chain
under hosted-style default privileges (a URL, an s3 scheme and a leading
slash each refused as a storage path while a real private path is accepted;
a document filed about nothing refused; knocks and messages append-only at
the GRANT — update and delete both denied outright rather than matching zero
rows; a sold door forced to name its customer and a follow-up date confined
to callbacks and appointments; an unsubscribe reason refused without an
unsubscribe and the withdrawal keeping both moment and reason; a dynamic
list forced to state its criteria; the message funnel refusing an open with
no delivery and a bounce with no reason, then accepting the whole ordered
funnel; an email campaign refused without a subject; a sending rule refused
without its template; a rule refused for claiming runs it never had;
anon/service_role shut out with no DELETE anywhere and no UPDATE on the
three append-only tables; tenant isolation both ways). Seed extended to 35
tables — 38,728 rows, 35/35 PASS, zero orphans. RLS census 182; hosted
service-role grants at 35 crm tables; runbook 193; workflow scope
`documents-canvassing-marketing` postflight proves forced RLS on nine
tables, append-only facts, no delete, the shutout, and that a URL is still
refused as a storage path in production.
**And the guard that was missing:** `migration-regex-repetition` fails any
migration using a regex repetition count above PostgreSQL's limit of 255 —
the defect that has now cost two releases, because a CHECK's regex compiles
only when a row carries a value and therefore survives every null-column
test. Lint zero warnings, tsc clean.

**Addendum, 2026-08-30 latest+16 - the company (ADR-195):**
services-org-sales.behavior 9 on the real chain under hosted-style default
privileges (the branch/manager/rep/book join holding together; a commission
derived from basis and rate on insert AND still derived after the rate is
raised; a paid commission refused without its approval and an accrued one
refused with a stamp; a commission earned on nothing refused; closed-branch
and ended-employee flags refused when they contradict their dates; a
self-report refused; a free-text postal code refused while a real list of
three is accepted, so the CHECK discriminates rather than merely blocks;
cross-tenant invisibility and the impossibility of a cross-tenant reference;
anon/service_role shut out and DELETE denied at the grant, not matched to
zero rows). services-org-sales-routes 18 (per-branch counts tallied from the
rows including the unassigned remainder, closure deactivating without a
second instruction, duplicate codes as 409, a non-code refused before the
database, role counts over the ACTIVE roster only, the login link reported
as a fact and never as an identity, self-report refused at the boundary, the
payout unsendable — the field does not exist in the schema — the ledger's
computed amount reported back, approve-and-pay in one moment, moments taken
back on return to accrued, postal codes upper-cased and de-duplicated, and a
leaderboard reporting winRate null rather than 0 plus its own unowned
denominator). Seed extended to 26 tables — 24,688 rows, 26/26 PASS, zero
orphans, all seven employee roles and all four commission statuses present.
RLS census 173; hosted service-role grants at 26 crm tables; runbook 192;
workflow scope `branches-org-sales` postflight proves forced RLS, no DELETE
anywhere, the anon/service_role shutout, the derive trigger and the three
new columns on crm_accounts. Lint zero warnings, tsc clean.

**Addendum, 2026-08-30 latest+15 - billing (ADR-194):**
services-billing.behavior 6 on the real migration chain (settlement
derived from the ledger and the invoice reopened by a refund; the refund
cap proved at its exact remainder AND one cent past it; append-only
enforced at the grant level for both payments and refunds; the arithmetic,
signature and void CHECKs; void stays void through a full payment; tenant
isolation). services-billing-routes 17 (totals derived from the lines and
a caller-asserted subtotal refused; duplicate numbers surfaced as 409 and
never merged; a decision given its moment and taken back on reopen; lines
attached to the right parent; balance and overdue read from the ledger's
own figures; `paid` unreachable by assertion with the table never touched;
a void required to name its reason; due-before-issued refused; a payment
filed against the invoice's own account with the ledger's verdict read
back; payment refused against a void invoice; cross-origin refused before
any read; the refund cap surfaced as 409 rather than 500; contract totals
counting only running terms and ended_at taken back on reopen). The
full-scale seed now covers all 22 tables — 23,375 rows, 22/22 PASS, zero
orphans. Workflow scope `billing-contracts` postflight proves forced RLS
on seven tables, the absence of update on payments/refunds, the absence of
delete anywhere, the anon/service_role shutout and all three settlement
triggers. Lint zero warnings, tsc clean; full vitest + production build
before shipping.

**Addendum, 2026-08-30 latest+14 - the full-scale seed (ADR-193):**
services-crm-seed.behavior 5 against the real migration chain, running the
production seeder and the production validator unmodified through a
PGlite-backed supabase client shim: the whole book seeds (every table over
the 250 floor); the audit passes for every table with zero orphans and every optional
column populated; history is trigger-written (status_change and both
'service' writers present, lots genuinely drawn down, one install scan per
station); the lifecycle spread covers all four account statuses, all seven
pipeline stages, four work-order statuses, both account kinds and more than
a year of history; and a re-seed is refused by the barcode constraint
rather than duplicated. Report at the time: 15,943 rows across 15 tables — PASS; 23,375 across
22 after billing landed.
The run surfaced a real production defect: the sds_url/label_url CHECK
regexes used a repetition count above PostgreSQL's 255 limit and would have
failed the first product carrying a link; fixed and pinned. Route suite
extended to 22 (scale routing, unknown scale refused). Lint zero warnings,
tsc clean.

**Addendum, 2026-08-30 latest+13 - chemicals & compliance (ADR-192):**
services-chemicals-compliance.behavior 6 on the real chain under
hosted-style default privileges (lot drawn down exactly, an over-draw and
a unit mismatch both refused with the shelf left untouched; the
application's timeline event exact in summary, detail and actor;
append-only proven by refused update/delete plus a working supersede that
leaves the original standing; remaining-within-received and per-org EPA
uniqueness; products undeletable; per-org jurisdictions with cross-org
reuse; anon/service_role shut out of all four tables).
services-compliance-routes 9 (license copied from the roster onto the
record; a named jurisdiction's requirements enforced with the missing
fields listed and nothing written; an unconfigured jurisdiction answered
honestly; the lot's refusal returned as the caller's 422; unknown
technician refused pre-write; non-https SDS refused pre-database;
duplicate EPA as 409; the report resolving every id into an inspector's
name; the CSV quoted and formula-guarded).
services-compliance-panel 3 (catalogue with lot lines and rules from the
live payload, the report table and its matching CSV window, the
application body exact including its jurisdiction). Demo hygiene +1
(fictional 90000-series registrations, DEMO-LOT numbers, applications
landing on their own account's property in the product's own unit and
never drawing more than a lot holds). RLS census 162; hosted-grants
fifteen crm tables; runbook 189; workflow scope chemicals-compliance
postflight. Lint zero warnings, tsc clean; full vitest + production
build before shipping.

**Addendum, 2026-08-30 latest+12 - pest/IPM core (ADR-191):**
services-pest-ipm.behavior 4 on the real chain under hosted-style
default privileges (a station born with its install scan carrying its
actor and location; state driven through move/remove/reinstall by the
ledger alone; grant-level ledger immutability plus undeletable devices
and sightings; one barcode per organization with free cross-org reuse;
the corrected_at/corrective_action CHECK; tenant isolation incl.
cross-org property attachment refusal; anon/service_role shut out of all
three tables). services-pest-ipm-routes 7 (exact tenant install, taken
barcode as 409, barcode resolved inside the org with the actor recorded
and the device re-read after the trigger, unknown barcode 404 appending
nothing, a move without a destination refused pre-database, the
corrective action landing with its timestamp, the org-scoped dashboard
read). services-ipm-panel 4 (sites/stations/threshold flags from the
live payload, empty state naming its next step, the scan body exact,
the sighting loop closed through the real PATCH). Demo hygiene +1 (a
real IPM program: unique DEMO-ST barcodes on the account's own
properties, scans ordered after their install, an over-threshold
station, both an open and a closed sighting). RLS census 158;
hosted-grants eleven crm tables; runbook 188; workflow scope pest-ipm
postflight. Lint zero warnings, tsc clean; full vitest + production
build before shipping.

**Addendum, 2026-08-31 latest+20 — production-accepted atomic Grok control and
bounded Resume wake (ADR-204):** one owner-authenticated transaction serializes the
session, creates/replays the exact intent, records requested evidence, applies
Pause/Resume/Withdraw, resolves the intent, and records applied evidence. After
that transaction commits, only Resume resolves the exact project/repository
binding and sends the linked graph
UUID through the existing target-bound graph-worker dispatcher. Applied-Resume
replay retries that best-effort wake only when the exact applied key is replayed
while already unpaused and not withdrawn; a prior key cannot start a later Resume cycle, and a
new key cannot Resume an already-unpaused graph. The graph's immutable
repository id must match the resolved target before dispatch. Pause and stop
do not dispatch. Legacy exact requested pause/Resume/withdraw controls are
resolution-only recoverable when graph state already reflects their action and
no later same-graph `control.requested` event exists, while an
applied key is rejected whenever that action is available again in a later
state cycle. Disabled, invalid, conflicting, and failed dispatch paths return
`workerWoken: false` with **Not Connected** language. Dispatch acceptance is
not counted as a successful claim or execution. Direct Cancel/Retry are refused
and remain **Not Connected** because the current Phase 1C actions do not yet
atomically correlate their state transition with Grok audit resolution across
lost-response replay.
Atomic control is supplied by forward migration `20260830010000` (SHA-256
`bbd664a7b556a07ab31b84b155725ea8a1b1c5a7f6a6afb1cfe1bae8c07f06b7`):
authenticated owner only, tenant/session/project/launched-graph/action/key scoped, no
table grant, definer/search-path pinned, and later-control ordered by immutable
event sequence. Migrated Postgres behavior covers atomic request/mutation/
resolution/events, exact replay without duplicates, supersession despite
inverted timestamps, generic-control supersession, unlinked-graph and
unavailable-action rollback, member/anonymous and cross-tenant refusal, ACL,
owner, and search path.
The UI consumes canonical graph-run and shared release evidence, keeps planned
identity separate from observed routes, reports bounded graph/session event
truncation, and leaves Rollback/automatic continuation **Not Connected**. Graph
state alone no longer advertises Phase 1C Cancel/Retry. This is production-
accepted control/read evidence, not complete runtime-identity admission or
provider execution:
the downstream claim does not pin the selected bot/account/provider/model and
immutable assignment revisions, MODEL execution uses ambient worker identity,
and worker switches, autonomy, automatic actions, and the kill switch remain
unchanged.

Release evidence: commit `6e85b8762c28552313d7de7726118a6d733b42ef`
passed CI `33356348578`; run `33357349773` applied `20260830010000` once and
ledgered it before a verifier-only trimmed-newline hash mismatch. Canonical
PostgreSQL `prosrc` MD5 is `2b0ea737ac99b22570ddbfdd4c583eeb`, not the
trimmed-body `55508f9dad0b6f307b02713057949895`. Forward containment
`2c68e7c9a1ef5ee22a38f7272236d61ab1e11b04` passed CI `33357696796` and
deployed READY as `dpl_67Amo2Hm9uRNpFUpxTYCz1H83ffY`; it changed only the
verifier and its regression test. Read-only run `33359633742` proved
ledger `1|1|1|1|1`, exact catalog/ACL/runtime/rollback, linked lint, health,
and stopped safety. Application commit
`5bc8eea092c683bd53aa25867efe8ab29a32b93b` passed CI `33358790065` and
deployed READY as `dpl_ABMNZDEY6drqBP7YdMqrfmHaJrYi`.

**Addendum, 2026-08-30 latest+15 — Grok Phase 2 containment production
accepted (ADR-190):** exact app commit
`d4040fee445079e34b2e062bfc234b708f802d9b` passed all four jobs in CI run
`33349358778`; Vercel deployment `dpl_9zKFCaitCUAidmEaDbE9vAgKv5fY` is READY,
and health matches exact release/main, Vercel project
`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`, and reachable Supabase
`qpuofpmagrmyamahqwxw`. Signed-in Demo Data acceptance created session
`569325a5-5cd2-40c3-831e-0d90c89188ab` and truthfully refused missing ready
Claude coverage into a durable `blocked`, nonclosed record: two messages and
five immutable events ordered `session.created`, user `message.appended`,
assistant `message.appended`, `session.planning_failed`, `session.blocked`.
Return/reload retained the exact URL session and evidence; no plan, routing
identity, graph, run, artifact/deployment evidence, provider call, worker wake,
or dispatch exists. Legacy session `74d18263-37ba-4f7d-8230-dc5e41bdc86a`
now reloads truthfully as request saved/no plan. Phase 1 evidence and its
do-not-rerun mutation boundary remain preserved. Workers/autonomy/automatic
actions stayed OFF and the kill switch ON. This accepts failure containment,
not overall Grok Bot production readiness: the provider-backed loop still
needs legitimate ready bot coverage and separately authorized execution.

**Addendum, 2026-08-30 latest+14 — Grok database-first phase accepted
(ADR-190):** exact commit `f6292c8ec359fd8e39c5463e4039b3388cf2056f`
passed all four jobs in CI run `33348187052`; Vercel deployment
`dpl_A35nZhbJQMJWLtUSroG9zXLWhXBw` is READY with matching public health.
Guarded apply run `33348980504` and independent read-only verify run
`33349033378` passed with required ledger `1|1|1|1` and exact catalog, ACL,
atomic runtime/replay, linked lint, health, and stopped-safety evidence.
Migration `20260830001100` is therefore hosted and accepted. Phase 2 remains
pending: the API/store/UI caller still requires exact-head CI, matching
deployment, and signed-in create/return/reload acceptance before its behavior
is claimed live. Workers/autonomy/automatic actions remain OFF and the global
kill switch ON; this is not a Grok Bot production-readiness declaration.

**Addendum, 2026-08-30 latest+13 — Grok planning-failure durability
candidate (ADR-190):** signed-in production acceptance against exact green/READY
main `397798921ebda6a4f8e30d2c0d83af36a3dd73a0` found that a correct no-Codex
planner refusal durably saved the owner request but left the session active and
the workspace falsely claimed a saved plan. The local containment adds
hash-pinned migration `20260830001100`: one service-only atomic function writes
a fixed safe assistant response and immutable message/failure/blocked events,
ending at a `blocked`, nonclosed session with no graph, run, dispatch, provider
call, or worker wake. Focused migration/workflow contract evidence is green.
The application candidate replays the durable bundle as a structured 409 and
the workspace preserves/reloads its session identity while rendering no plan
or routing claims. This is candidate evidence only: repository-wide final
gates, the migration-first production phase, the subsequent application phase,
exact deployments, and signed-in return/reload acceptance remain pending.
Workers/autonomy/automatic actions remain OFF and the global kill switch ON.

**Addendum, 2026-08-30 latest+12 — Grok Bot local release candidate
(ADR-191):** deterministic Chief-of-Staff planning, the owner-only durable
session/message/event/link/control boundary, and the responsive workspace are
integrated. Focused bridge tests prove that the service-only boundary creates
the exact canonical `full_lifecycle` v2 graph and pauses it atomically before
visibility, with idempotent replay/status truth, no custom provider-labelled
DAG launch, no graph/node run, and no worker dispatch. Planned routing identity
is not counted as observed execution. The prior full suite at `a26caec` was
green with 5,705 passing tests and 7 skipped. This is not final exact-head,
hosted-migration, deployment, signed-in E2E, or production-readiness evidence:
post-release-workflow full gates, hosted ledger application of
`20260830000900` and `20260830001000`, exact deployment, and signed-in
production acceptance remain pending. The safety envelope remains
workers/autonomy/automatic actions OFF and global kill switch ON.

**Addendum, 2026-08-30 latest+11 — field service core (ADR-189):**
services-field-service behavior 5 on the real chain under hosted-style
defaults (completion writes exactly one 'service' event with property
detail, notes and actor — and only completion; cancellation records as
its status change; completed_at truthful; cross-account property
scheduling refused by the three-column FK; tenant isolation; roster and
schedule undeletable; anon/service_role shutout).
services-field-service-routes 10 (clamped recurrence math incl. leap
February; schedule counts from the same authority; exact tenant booking;
end-before-start refused pre-database; composite-key 404; completion
PATCH passthrough; exact roster insert; generate advancing by
recurrence with the visit carrying plan identity; concurrent
double-generate = one visit + honest 409 with no work-order touch;
paused plans refused; failed visit insert compensated back).
services-schedule-panel 5 (board/counts/due-lane from live payloads,
empty next step, due plan generating through the real route, notes-first
completion, roster add). Demo book replay extended: field-service counts
exact, one 'service' event per completion each naming its property.
RLS census 155; hosted-grants all 8 crm tables; runbook 187; workflow
scope field-service postflight.

**Addendum, 2026-08-30 latest+10b — the Demo Data book (ADR-187):**
services-crm-demo-book behavior 2 (the whole dataset replayed against
the real chain: counts exact incl. one trigger line per status/stage
move; every row labeled Demo Data with .example email and 555 phone;
closed_at/lost_reason coherent everywhere; the Whitfield journey reads
lead → prospect → customer → inactive); services-demo-data 4 (scale and
coverage, fictional-only reachability, every schema CHECK bound,
unambiguous seeder keys); demo-seed route 3 (cross-origin refused,
empty-book-only 409, session-scoped seed with reported counts);
overview panel now 4 (pipeline headline from the board's read, Demo
Data loader through the real route, DemoNotice on a seeded book).

**Addendum, 2026-08-30 latest+10 — CRM pipeline, duplicates, global
search (ADR-186):** services-crm-pipeline behavior 5 on the real chain
under hosted-style default privileges (every stage move trigger-written
onto the timeline with its actor and closed_at kept truthful through
close/edit/reopen; loss reason CHECKed to lost only and carried into
history detail; generated normals pinned to the exact values the route's
JS mirrors produce, respellings landing on one normal; tenant isolation
+ composite-FK attachment refusal + no-DELETE conversion record;
anon/service_role shutout). services-crm-routes 15 (whole-book pipeline
report incl. win rate, exact tenant insert, born-closed deals refused,
FK-honest 404, loss-reason-without-lost refused pre-database, leaving
lost clears the reason, duplicate 409 surfacing matches with nothing
inserted and the probe on the normalized column, explicit allowDuplicate
path, per-column search merged and de-duplicated, short needle refused
pre-database). services-pipeline-panel 4 (board + report from one
payload, empty state naming the next step, dollars→cents on the real
POST, immediate stage PATCH but reason-first lost flow);
services-customers-panel 5 (+ duplicates surfaced, Record anyway as the
deliberate second step). RLS census 152; hosted-grants
+crm_opportunities; runbook 186; workflow scope crm-pipeline postflight.
Lint zero warnings, tsc clean; full vitest + production build before
shipping.

**Addendum, 2026-08-30 latest+9 — Services CRM foundation (ADR-185):**
services-crm-foundation behavior 6 on the real chain (360° record held
together; tenant isolation both directions incl. composite-FK
attachment refusal; trigger-written status history exactly once with
its actor; grant-level timeline immutability + undeletable accounts;
secret-shaped notes refused; anon/service_role shutout);
services-crm-routes 8 (org-scoped list with counts from the same
authority, exact tenant identity on insert, cross-origin and unknown
shapes refused pre-database, honest 404, manual timeline refusing all
three system kinds, non-UUID refused); services-customers-panel 4
(live table, empty state naming the next step, real POST body, refusal
verbatim; overview counts from the live read). Workflow guards 15
green with the new scope; runbook 184. Lint zero warnings, tsc clean;
full vitest + production build before shipping.

**Addendum, 2026-08-30 latest+8 — inline LinkedIn/Indeed aggregator
(ADR-184):** board-search-jsearch suite 10 (lockstep gate across
registry/lookup/catalogue, always-on registry untouched, static row
names the exact var, keyless direct call refuses without fetching,
request contract incl. num_pages=1 frugality, publisher/salary/remote
parsing, limit cap, loud refusal + unknown shape); search-route 26
(aggregator absent-until-keyed incl. named-board 400, joins the
fan-out with per-hit publishers and "LinkedIn (JSearch)" unified
badges); panel 37 (Not Connected hint names JSEARCH_RAPIDAPI_KEY,
connected hint, badge rendering); catalogue counts 53/28; alerts-run 7
(registry mock extended). Lint zero warnings, `tsc --noEmit` clean.
Production build + full vitest run with the Pause/Resume increment's
combined gates before shipping.

**Addendum, 2026-08-30 latest+7 — Pause/Resume (ADR-183):** runner
suite 20 (pause finishes the wave in flight and starts nothing, a
pre-start pause holds everything, absence of the control changes
nothing); worker-execution suite 36 incl. the full journey on the real
chain (pause landing at the wave boundary → CANCELLED with pause
closure note + pause-detailed SKIP, claim empty while held, resume
claim reuses the three finished inspectors and executes exactly one
node) and the boundary case (withdrawn/null/non-member refusals, both role fences, unknown
run answers false); pause route 7 (exact rpc args, pause never
dispatches, resume wakes through the real binding, wake failure still
reports the resume, honest 409, non-UUID and cross-origin refused
pre-database); runs route 9 (controls projected, 42703 deploy-window
fallback pins both select shapes); workspace 17 (Pause on RUNNING,
Resume + paused label on held builds, server notes verbatim). Lint
zero warnings, production build lists the route, `tsc --noEmit` clean.

**Addendum, 2026-08-30 latest+6 — attempt projection + preview
(ADR-182):** graph-node-detail suite green on the chain with the honest
pair (unmeasured 0 → null; measured 2 → 2); workflow guards green with
the new scope; workspace suite 16 (attempt renders only >= 2 —
covered by type-level optionality and the projection test). Lint zero
warnings, production build, `tsc --noEmit` clean.

**Addendum, 2026-08-30 latest+5 — autonomy modes (ADR-181):**
autonomy-mode suite 5 (Ask-Me derivation from today's only permitted
state, future-state derivations, exact patches, invariants stated,
patch round-trips); workspace 16 (mode derived from real GET controls,
exact PATCH body with concurrency timestamp, the fence's refusal
verbatim). Lint zero warnings, production build, `tsc --noEmit` clean.

**Addendum, 2026-08-30 latest+4 — Stop as withdrawal (ADR-180):**
worker-execution suite 36 green incl. the withdrawal pair (unclaimable
after withdrawal, idempotent single audit event, RUNNING/secret/
non-member refusals, Stop ends the failed-run retry loop); withdraw
route 4 (exact rpc args, honest 409, non-UUID and cross-origin refused
pre-database); workspace 15 (Stop through the real route with the
server's words, no Stop on a RUNNING row). Lint zero warnings,
production build lists the route, `tsc --noEmit` clean.

**Addendum, 2026-08-30 latest+3 — probe extraction corrected
(ADR-179):** the ADR-178 addendum's "byte-honest" claim was wrong for
seven suffix-closed blocks; the live scope=probe dispatch caught it
(run 33297041401, syntax error in probe/04.sql). Corrected extraction
carries dual machine proofs and the missing guard: all 40 probe files
now EXECUTE against the migrated chain in hosted-scope-replay. 36
tests green across the five workflow guard suites.

**Addendum, 2026-08-30 latest+2 — workflow headroom (ADR-178):** probe
SQL extracted byte-honest (33 files, psql -f, order preserved);
workflow 49KB under its guard; all 14 workflow-reading suites green
after re-pointing three pins without weakening (probe-set parity +
drift guards, read-only scan extended over the extracted files,
scope-replay still executing 07.sql on the migrated chain). Lint and
`tsc --noEmit` clean, full vitest green.

**Addendum, 2026-08-30 latest+1 — Activity log (ADR-177):** events
route suite 4 (verbatim chronological rows with node keys resolved,
run-level events honestly node-less, non-UUID refused pre-database,
database refusal undressed); workspace suite 13 (lazy log: no fetch
until open, recorded line rendered verbatim, truncation footer absent
when not truncated). Lint zero warnings, production build lists the
route, `tsc --noEmit` clean.

**Addendum, 2026-08-30 latest — Changes & release (ADR-176):**
release-evidence suite 4 (all-null before observations, lineage read
back, checks keep real conclusions incl. failures, full four-observation
trail); workspace suite 12 (lazy release panel: no artifacts fetch until
open, PR files-tab link, real check conclusion rendered). Lint zero
warnings, production build, `tsc --noEmit` clean.

**Addendum, 2026-08-30 later still — plan approval before launch
(ADR-175):** chief-of-staff suite 6 (proposal pinned to the real
template: 14 steps, goal-first layering, widest layer 3, gates exactly
architecture/test/deploy, 0% honestly planned, jobs verbatim);
workspace suite 11 (submit drafts and POSTs nothing until Approve &
launch; Edit withdraws keeping the words; every launch path re-proven
through the approval step). Lint zero warnings, production build,
`tsc --noEmit` clean.

**Addendum, 2026-08-30 late night — attempt persistence (ADR-174, task
#56):** graph-worker-execution suite 32 green against the full migrated
chain including two new cases — a real retry persisting attempt 2 with
its own second `node_running` event and the completion carrying the
suffix; regression/nonsense refusals, exact-replay idempotence, the
higher-attempt retry branch, and the seven-argument legacy caller still
resolving with attempt honestly left at its insert default. Node-detail
suite updated to state the new truth (writer exists, projection
deliberately deferred). Runbook count 180 auto-guarded. Lint zero
warnings, production build, `tsc --noEmit` clean, full vitest suite
green.

**Addendum, 2026-08-30 night — Chief of Staff plan (ADR-173):**
chief-of-staff suite 5 tests (diamond layering, verbatim intent +
assignments + gates + 25% counted, ghost-edge immunity, cycle fallback,
null-on-empty percent); workspace suite 9 green with the plan-panel flow
(layers with assignments, 50% headline). Lint zero warnings, production
build, `tsc --noEmit` clean.

**Addendum, 2026-08-30 later still — specialists + evidence panels
(ADR-172):** specialists suite 7 tests (catalogue pinned to real
NODE_CAPABILITIES/SDLC_STAGES, capability precedence, bench-by-key,
stage fallback, null when nothing matches, all stages covered);
workspace suite 10 (adds the evidence-panel flow: specialist beside
executor, QA verdicts with verifier, artifacts fetched only on open,
spend line, history card with evidence links). Lint zero warnings,
production build, `tsc --noEmit` clean.

**Addendum, 2026-08-30 later — Build front door (ADR-171):** workspace
suite 7 tests (nothing-before-anything, projects-empty next step, exact
launch payload, refusal in the server's words, counted progress + OPEN
gate + stage states, closure note in transcript, resume list excluding
finished runs); app-shell nav 25 tests; e2e nav/pages/responsive lists
seated. Lint zero warnings, production build lists /solutions/build,
`tsc --noEmit` clean.

**Addendum, 2026-08-30 — primary link-outs + ZIP radius (ADR-170):**
geo suite 9 tests (ZIP resolution against the real index, six-digit and
unassigned-ZIP nulls, ZIP-centred radius), search-route 24 (ZIP centre
end-to-end with exact counts and "Austin, TX 78701" center), panel 35
(primary row present pre-search, live-updating hrefs, deselection).
Journey acceptance run 33285610004 green on main 9a73e12. Lint zero
warnings, production build, `tsc --noEmit` clean.

**Addendum, 2026-08-29 late night — Job Search increment 5: the filter
vocabulary complete (ADR-168):** location + radius over a real offline
GeoNames-derived city index (server-side, honest not-applied reporting,
remote/unresolvable kept and counted, saved radius honored by the alert
engine), plus title-derived marketing specialty and posting-text-derived
industry facets labeled as derived. Gates on the tree: unit 317 files /
4,037 tests before the increment's last additions (geo 6, unify 26 total,
route radius 3, panel 32, alerts pass-through), eslint zero warnings,
production build with the index in the server bundle only, `tsc --noEmit`
clean. Increment 4's marks migration applied to hosted (run 33273330183,
postflight green); production probes on #448's deploy verified (marks
401 anonymous, /JobSearch 200, alerts 503 fail-closed).

**Addendum, 2026-08-29 late night — LinkedIn/Indeed deep link-outs
(ADR-169):** the two sites' chips now carry the whole current search in
their own URL parameters, verified by 7 builder unit tests (exact URLs,
km→mile conversion, upward radius snapping, salary bucketing,
unmappable-filter omission) and a panel test (deep chips sort first, both
labeled, LinkedIn/Indeed hrefs asserted parameter by parameter, Glassdoor
stays template-only). Gates: lint zero warnings, production build,
`tsc --noEmit` clean, panel suite 33 tests green.

**Addendum, 2026-08-29 night — Job Search increment 4: marks + seniority
(ADR-167):** favorites/hide/viewed are persisted per person in
`job_seeker_result_marks` (forced RLS, own-row policies, service_role
revoked, no update path) behind `/api/job-seeker/search/marks`, with panel
controls that render only after the real marks load and separate "hidden by
you" / "hidden by your filters" counts; the seniority facet is derived from
the job title alone and labeled that way, shared by route, panel,
saved-search schema and alert engine. Gates on the tree: unit 316 files /
4,017 tests, integration 142 files / 1,431 tests (marks migration replayed
through the full chain; RLS count 147), lint zero warnings, production
build, `tsc --noEmit` clean. Marks route tests 6; panel tests 29 including
optimistic-revert-on-failure and controls-stay-unrendered-when-unknown.

**Addendum, 2026-08-29 final — the goal's full acceptance, email included
(ADR-166):** journey workflow run `33269486606` on main `71060d0` passed all
three serial tests on a fresh stack: the complete fake-data journey, the
live board search-save-persist walk, and the new alert-email leg — a saved
search created in the browser, its cadence set through the panel's own
control, the engine run exactly as Vercel Cron runs it, a **real SMTP
delivery** read back from the local Mailpit sink (direct links and the
never-repeat promise in the body), and exactly one message still in the
sink after a second engine run. Local pre-verification of the same leg:
`{"ran":true,"due":1,"scanned":1,"emailed":1,"failures":[]}`. Production
delivery remains Resend-gated on the owner's env vars and honestly **Not
Connected** until then. Verdict: **EVERY STEP OF THE GOAL'S TEST LIST NOW
PASSES IN THE AUTOMATED LANE; PRODUCTION EMAIL AWAITS ONLY THE OWNER'S
CREDENTIALS.**

**Addendum, 2026-08-29 late — Job Search E2E acceptance + journey lane
recovered (ADR-165):** journey workflow run `33266060493` on main
`3cd6150` passed end to end: the full 178-migration chain applied on a
real local Supabase stack, the production build served, and the
real-browser fake-data journey (sign-in → onboarding → every job-seeker
section → live board search → save a result → find it again after
reload) completed — the lane's first green since 08-22. The six-day
blackout was environment drift (supabase CLI 2.116.0's new postgres
image seeds hosted-style default function privileges; no CLI wraps a
migration file in a transaction), root-caused by Docker reproduction
against both images and fixed in the chain itself (#442: roles.sql,
000850's third accepted input, 000210's explicit transaction; sha pins
moved at all four sites). Full local suite on the merged tree 5,412
passed / 2 skipped; Vercel deploy of `3cd6150` success. Verdict:
**E2E ACCEPTANCE PASSES FOR EVERYTHING AUTOMATABLE; THE EMAIL LEG
REMAINS "NOT CONNECTED" UNTIL THE OWNER'S THREE ENV VARS EXIST.**

**Addendum, 2026-08-29 evening — Job Search increments 2–3: match scores,
saved searches, metering, alert engine (ADR-163 addendum, ADR-164):** merged
as #437 squash `2319970` after four real completed CI checks on the exact
head; local suite on the merged tree **5,412 tests passed / 2 skipped across
455 files**, lint zero-warning, typecheck clean, production build green.
Vercel deploy of `2319970` verified `success` and production probed: the new
alert runner answers **503 `alerts_not_configured`** (designed fail-closed
while `CRON_SECRET` is unset), saved-searches refuses anonymous callers 401,
`/job-seeker/search` serves 200. Hosted schema applied the same hour via
scope `job-seeker-alert-engine` (#440 added the missing dispatch option;
apply run `33263020948` success with in-step postflight: deliveries ledger
exists with forced RLS, `last_scanned_at` present, both alert functions
SECURITY DEFINER and not executable by anon/authenticated). New tests this
increment: 10 alert-planning, 7 runner-route, 13 saved-searches-route
(3 alert cases), 20 search-route, 21 panel. Verdict: **INCREMENT GATES PASS;
EMAIL ALERTS ARE HONESTLY "NOT CONNECTED" IN PRODUCTION UNTIL THE OWNER SETS
RESEND_API_KEY, JOB_ALERT_EMAIL_FROM AND CRON_SECRET; NO UNQUALIFIED
"PRODUCTION READY" CLAIM FOR THE EMAIL LEG BEFORE A REAL DELIVERY IS
OBSERVED.**

**Addendum, 2026-08-29 — Job Search increments 1–2: thirteen live boards,
unified dedupe, honest 52-source catalogue (ADR-163):** on the branch merged
with main `ed1fc34` (which brought the parallel Job Discovery surface): lint
zero-warning, typecheck clean, **5,251 tests passed / 2 skipped across 446
files** on the merged tree plus the 140-test targeted delta for the three
same-day board additions (The Muse, Working Nomads, Jobspresso — all
registry-dependent suites re-run green), and a **174/174-page production
build**. Every one of the thirteen live adapters was probed against its real
API before its parser was written; the 52-source catalogue's non-live links
were probed the day they were listed, and four dead domains found during
research were replaced rather than shipped. Production incident closed the
same hour: Job Discovery had 500'd because deployment ran ahead of migration
`20260828000400`; the degradation fix (`ed1fc34`) deployed and the
`job-seeker-discovery-surface` scope applied and postflight-verified (runs
`33254397295`, `33254518297` — saved_at, allowance column, three tables with
forced RLS, schema cache reloaded). Verdict: **INCREMENT GATES PASS; E2E
ACCEPTANCE STILL AHEAD OF ANY "PRODUCTION READY" CLAIM FOR ALERTS/EMAIL.**

**Addendum, 2026-08-28 — cleanup and target-bound claim production
acceptance (ADR-155/161):** cleanup SHA
`ce86d9c04ff91f237e680a5db4b0cda97feea2ce` passed all four jobs in CI
`33169913723`, exact READY deployment `dpl_4Zqh4q2yBfaagGtg7stSbV4NSphP`, and
the public health identity join. Local evidence was lint/typecheck green,
**5,145 tests passed / 7 skipped across 441 files**, a 171/171-page production
build, **50/50 focused URL tests**, clean secret review, and an independent
cleanup-policy audit. Probe `33170897689` passed `1|1|1|1|0|0`; first-attempt
run `33170953151` applied only hash-pinned `20260828000200`; independent probe
`33171025468` passed `1|1|1|1|1|0`. Catalog, ACL, runtime, audit, linked lint,
health, worker state, autonomy, and kill-switch checks stayed exact. Read-only
browser acceptance found no errors and proved existing historical test data is
rendered truthfully: run `884d6164` is 8/10, with Deploy refused by policy and
Monitor skipped, and is explicitly not presented as current v2 evidence.
Verdict: **TARGET-BOUND CLAIMS PRODUCTION PASS; POSTDEPLOY CORRECTLY GATED**.

**Addendum, 2026-08-28 — hosted selector/URL checkpoint and signed acceptance
gate (ADR-161):** exact cleanup SHA
`994da2cec81c0cd83aa1e2d87ad848d2f2ff612a` passed all four CI jobs and exact
READY Vercel/public-health identity. First-attempt protected runs
`33165823042`, `33165886343`, `33165944760`, and `33165992529` passed; hosted
ledger is exactly `1|1|1|1|0|0`, the selector is normalized, and the
production-URL writer/catalog/ACL is live. The new disposable acceptance path
is manual, exact-main/actor/first-attempt, serialized with migrations, and
rechecks exact CI/deployment/health plus full stopped database/GitHub state
three times. It uses no password and requires a confirmed owner/admin, an unset
value, one immutable owner-attributed event, no-op replay, and signed-in reload.
Focused evidence is **7/7 workflow guard tests**, **86/86 URL-focused tests**,
clean focused ESLint, clean TypeScript, valid YAML, and every shell block passes
`bash -n`. Exact disposable release
`540aceb173ec88e67cb982018a80134ece3ec474` passed all four jobs in CI
`33167232673`, READY deployment `dpl_31W7nKgJd6ENoCfuvgP1zzHZM6eT`, and the
public health identity join. First-attempt run `33168092838` passed all
pre-write release/safety/connection gates and then failed closed before target
resolution or mutation because `psql -c` did not expand its protected variable
tokens. Both temporary selectors were deleted. Corrected release
`53b84b7952a1e09725f53da5d65c4947b8cb914a` then passed all four jobs in CI
`33168368270`, READY deployment `dpl_tBF2s6AtLmqZ13YpYHKWzBRtwiKT`, and the
public health identity join. Fresh first-attempt run `33169297158` passed the
real owner/admin session, exact URL write, one immutable owner-attributed audit
event, no-op replay without a duplicate, signed-in reload, and every pre/post
stopped-containment check. Both temporary selectors were deleted immediately;
this cleanup removes the disposable workflow/test. Verdict: **PRODUCTION URL
ACCEPTANCE PASS; DISPOSABLE SESSION PATH REMOVED**. No worker or autonomous
action was enabled.

**Addendum, 2026-08-28 — exact Blackstone Auth bootstrap (ADR-160):** the
temporary workflow is manual-only, permissions-empty, exact-main/project/email,
first-attempt, and identity-gated to the configured production release actor as
both actor fields. The password is sourced only from an encrypted temporary
repository secret; output is limited to created/updated plus a UUID after an
exact email-confirmed re-read. Focused workflow evidence is **5/5 tests** and
focused ESLint green. Exact first-attempt run `33164766560` on production
release `298264b02fe5a29e3c139f8077e65d6270f19167` returned one bounded updated
UUID after verified readback; the temporary password secret was then deleted,
and this forward cleanup removes the workflow/test. Verdict: **PRODUCTION
PASS; DISPOSABLE CREDENTIAL PATH REMOVED**. No tenant role, provider
connection, worker switch, autonomy setting, or kill switch changed.

**Addendum, 2026-08-28 — live application release and selector-normalization
containment (ADR-159):** exact `main`
`79ca52f5b92e7d95292210e05565d35d21b4a435` passed the quality job and all
three browser/accessibility shards in CI `33158801269`. GitHub deployment
`6138739479` is READY Vercel deployment
`dpl_57pM3ZEYNyK596VAeLPJMabJLZrH`; public health joined the exact SHA/ref,
Vercel project `prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`, immutable deployment, and
Supabase project `qpuofpmagrmyamahqwxw` with the database reachable. Verdict:
**APPLICATION PRODUCTION PASS**.

Protected read-only probe `33159805326` stopped before mutation because the
hosted `claim_phase1c_run_budget_internal(text,text,text,integer)` body is
exact stale MD5 `ed5840b9d8d0efdb513a8576df128e9b`, not breaker-aware target
`5933952d71f9da90a2a80a05ce6e0378`; its full ABI, postgres owner,
`SECURITY DEFINER`, pinned search path, private ACL, breaker helpers/table,
and stopped-safety state otherwise passed. The isolated forward migration
`20260828000050_normalize_breaker_aware_phase1c_selector.sql` is pinned at LF
SHA-256
`8914034508451d1550ebf3f1bedd8f7b71592f1809306e78c57774c458952896`.
Current containment evidence is lint and typecheck green, **5,150 tests
passed / 7 skipped across 442 files**, and a **171/171-page production
build**. Verdict: **SELECTOR CONTAINMENT LOCAL PASS; EXACT-HEAD PUBLICATION,
PROTECTED APPLY, AND POSTFLIGHT PENDING**.

Signed-in Factory acceptance is not upgraded: the active organization has no
connected provider account, ready linked bot, or assignment, so no fresh Step
8 POST or persisted Steps 9-10 correlation has been proven. Workers, provider
execution, autonomy, schedules, the auth broker, and automatic actions remain
OFF; the global kill switch remains ON. Seventeen older ledger-missing
versions beginning at `20260815000200` remain a separate unresolved
object-by-object forward-reconciliation track.

**Addendum, 2026-08-28 — final ten-step Factory release candidate:** Step 8
now accepts the assigned bot's provider/model for record-only work, persists
one immutable command route, and reports disabled execution truthfully. Launch
and gate UI retain `workerWoken` plus the exact server note, suppress automatic
polling when the worker is OFF, and expose bounded/manual refresh. Application
and workflow gates are exact-`true`, target-bound, and manual graph dispatch is
main-only. Mutation scopes reject reruns and a different triggering actor.
Public health joins the exact alias, Vercel project/deployment ID and URL,
main SHA/ref, and Supabase project; the hosted workflow compares that URL to
GitHub's exact Vercel Production status before and after database work.
Production worker/auth-broker variables are explicitly OFF and no execution
workflow is active. Verdict: **LOCAL PASS; EXACT-HEAD PUBLICATION, ORDERED
HOSTED MIGRATIONS, AND SIGNED-IN RECORD/RELOAD ACCEPTANCE PENDING**. Workers,
autonomy, and automatic actions remain OFF; the kill switch remains ON. Final
local evidence: lint/typecheck green, **439 test files / 5,150 tests passed**
(3 files / 7 tests skipped), and a **171/171-page production build**.

**Addendum, 2026-08-28 — Step 10 public URL configuration (ADR-156):**
the project detail page now supplies the missing owner/admin writer for the
public production URL, without changing the existing three-argument detail
RPC or provider deployment identity. The forward migration validates the
durable column, uses a pinned `SECURITY DEFINER` boundary, refuses archived
projects, retains projects FORCE RLS, and routes real changes through the
existing immutable project audit trigger. URL safety rejects credentials and
likely-secret path material at the database boundary, query/fragment material,
non-HTTPS, private/localhost/intranet, ambiguous
numeric, IPv6-literal, and non-standard-port targets; runtime monitoring still
pins and checks the address actually connected. Vercel Production now carries
an independent expected Supabase project ref, and `/api/health` fails closed
with bounded status when the configured URL does not match it. Focused evidence is **89/89
tests**, focused ESLint clean, and full typecheck green. Verdict: **LOCAL PASS;
HOSTED MIGRATION AND SIGNED-IN VALUE/AUDIT ACCEPTANCE PENDING**. No live value
or execution control changed. Migration LF SHA-256:
`0856ddee447280a1bb4418f25d6a6d4650687e168fffcd5e98e8ce15edd62b27`.

**Addendum, 2026-08-28 — exact-target one-shot claims (ADR-155):** local
evidence passes 106/106 focused tests across target-claim behavior and
contracts, graph/Phase 1C stores, environment validation, workflow contracts,
full-chain schema-security invariants, and graph-worker execution. Focused
ESLint and scoped diff checks pass. The database selector itself filters the
requested UUID before lock/claim, preserves every existing scheduler, budget,
lease, breaker, RLS, ACL, and audit boundary, and exposes public project URL
without overwriting exact deployment lineage. Scheduled and one-shot graph
workers share an exact global gate that remains OFF; provider execution,
autonomy, and automatic actions remain OFF; the kill
switch remains ON. Verdict: **LOCAL PASS; HOSTED MIGRATION AND TARGET CANARY
PENDING**. This addendum does not upgrade production or end-to-end acceptance.

**Addendum, 2026-08-28 — AI Factory loading gate and Factory v2 release:** the signed-out
factory gate renders on the first server response and performs zero protected
browser reads. The portal layout and leaf page share one request-scoped,
verified viewer lookup with a five-second fail-closed presentation deadline;
route authorization remains independent. Focused unit/contract tests pass
56/56, the production build passes, and the real-page Playwright gate passes
9/9 across desktop, tablet, and mobile. Exact main
`bb68659a0ee84370f83dd647ae57f4ccb83ea06c` passed all four required jobs in
CI `33149814278`; Vercel `dpl_2A2bhtevZeBY6422ZYjVGJE5SuTU` / deployment
`6137077047` is READY behind `www.theagoras.com`. Hosted containment and
lineage passed in runs `33150654596` and `33150707932` after exact four-row
manifest probe `33150619218`. Signed-in Steps 8-9 remain pending provider OAuth
and route setup, not code release or database lineage.

**Addendum, 2026-08-27 — Job Search production acceptance (ADR-147):**

| Evidence tier | Result | What it proves / does not prove |
| --- | --- | --- |
| Upstream identity | PASS | All 214 files match exact `MadsLorentzen/ai-job-search` head `79cd383e58f0af7948c7c6462a3a289e9b67421e`; the vendor tree is excluded from build, lint, typecheck, tests and runtime imports. This proves source identity, not runtime behavior. |
| Product entry and navigation | PASS in production | `/JobSearch` is canonical, the signed-in global entry is **Job Search**, and `/Job-Search` plus `/job-seeker/search` share the same gated content. Exact release `aabd82b3a626da94a2478ef26f043a51d059cd15` is live; the stable alias returns `200`. Desktop and 390px mobile browser acceptance passed. |
| Live board contracts | PASS in production | Direct probes returned Jobnet 2/4, Jobindex 2/736, Jobdanmark 0/0 and Freehire 2/6752. Signed-in production returned Jobnet 4/4, Jobindex 20 shown of 736, Jobdanmark 0/0 and Freehire 25 shown of 6,752, with the location limitation and empty state rendered honestly. Future third-party stability remains external. |
| Save provenance | PASS locally and in production | Every result is sealed server-side for organization + user + board + exact normalized fields with a 30-minute lifetime. Missing, expired, cross-user, cross-tenant or altered evidence is refused before persistence. Production accepted an untouched Jobnet result and read it back with the same attribution. |
| Supabase transaction and isolation | PASS in PostgreSQL tests and production | `record_job_seeker_job` atomically records job + match + initial application + immutable event, derives `auth.uid()`, checks membership, returns a no-write duplicate outcome, rolls back child failure, and uses composite owner FKs. Production read back the accepted row at score 35/100 and stage FOUND plus exactly one `job_seeker.job_recorded` event. |
| Hosted database | PASS | Exact-head CI run `33110615299` passed all four required jobs before workflow run `33111692239` applied only `20260827000100_record_job_seeker_job_atomically.sql` (SHA-256 `2f51bf64ba3fd2bc711e6fbf9e660a2cc0dd5ef4b1f85d932ee574e79e9c7d13`) to project `qpuofpmagrmyamahqwxw`. Postflight accepted the one ledger row, exact routine identity/security/search path/ACL, three validated owner constraints, old-key removal, PostgREST reload and forced RLS. |
| Application production acceptance | **PASS** | Exact-head CI `33114868741`, Vercel Production deployment `6130751384`, alias health, four-board signed-in search, sealed Jobnet save, Supabase readback and immutable activity evidence passed. Remote journey `33115019633` also passed the returning-account gate; its no-unsaved-result mutation was skipped honestly and the manual authenticated walk supplied that missing acceptance evidence. |

Local evidence is full lint and typecheck green, 407 Vitest files / 4,721
tests passed (3 files / 7 tests skipped), and a production build of 165 pages
including `/JobSearch`. Focused evidence includes 16 atomic-persistence tests,
64 migration-contract tests and the related Job Seeker regression suites.
The rollout was database-first because the application calls the new RPC.
Direct authenticated table INSERT remains intentionally available while the
manual jobs POST route still uses it; a later forward contraction must first
move and test that final writer. The verdict is **HOSTED DATABASE PASS;
APPLICATION PRODUCTION ACCEPTANCE PASS**.

**Addendum, 2026-08-25 — billing (ADR-149):** the revenue engine is tested at
every seam it owns — 56 tests in six new files plus quota regressions in the
launch and projects route suites: catalog invariants against the advertised
matrix, price env resolution both directions, HMAC signature vectors
(tamper, replay ±tolerance, key-roll), mirror idempotency and
non-attribution refusals, checkout/portal/webhook routes including every
Not Connected and forbidden path, and 402 enforcement at both creation
boundaries proving the write RPC is never reached. What is deliberately NOT
claimed: no test exercises Stripe's live API (the transport is the injected
seam), and the end-to-end money path remains unproven until the owner runs
the test-mode purchase in `docs/BILLING_GO_LIVE.md` step 7 — the scorecard
will say so until a real test-mode webhook has landed on production.

**Addendum, 2026-08-25 — the ten-step factory: six engine defects found by
driving it, and what is actually proven (ADR-144 through ADR-146, plus ADR-148):** the
owner's ten-step production-readiness goal was driven against live
production, and the drive — not review — found six defects in the graph
engine. Each was fixed with a regression that fails without it:

- **Gate-halted re-pay (ADR-143, `20260824001100`).** A gate-approved node's
  recorded work was re-executed on the next claim, spending a provider window
  on work the database already held. The resume read now offers VERIFYING
  runs. Hosted-applied.
- **A void consumed a gate approval (ADR-144, `20260825000100`).** The claim
  compared the owner's approval against the last RUN's close rather than the
  last ANSWERING run's, so a capacity-voided run silently staled the approval
  and stranded lifecycle `d7241cf4` permanently. The watermark now counts
  answers only. Hosted-applied, run `32805322660`, readback verified — and
  proven live: run `04e5f69f` reused all nine recorded stages at zero cost.
- **A flat turn budget (ADR-145).** The lifecycle's implement node exhausted
  24 turns twice; implementation surveys a repository before it can describe
  a build. Ceiling 48, implementation nodes granted it, both pinned against
  the ceiling so a silent clamp cannot recur.
- **The artifact guard killed the drain (ADR-145).** A node's real output
  tripped the sensitive-data constraint — the guard working — and the raw
  throw stopped the drain for every organization's graphs. The engine now
  writes the artifact before the COMPLETED mark and contains the refusal to
  its own node, with a message that never restates the payload.

- **A 529 was never retried, over a backoff never applied (ADR-146).** The
  capacity classifier could not tell a session limit, which must wait for a
  named reset, from a 529 overload, which asks to be retried — so the one
  error class the provider marks temporary was the only one that spent no
  attempts. Runs `28b4dedf` and `bfb6e0e7` lost six nodes to it. Underneath,
  `RetryPolicy.backoffMs` was declared, defaulted, dropped by the compiler
  and read by nothing, so every retry the engine ever performed fired into
  the instant that had just refused it. Both halves are fixed together;
  fixing either alone would have changed nothing.

- **The run never said why it ended (ADR-148).** The engine composes a
  run-level explanation on every close — including the correction that
  gate-halted nodes did not fail — and threw it away: `completeRun`'s
  parameter was named `_detail` because the RPC had no parameter and
  `graph_runs` had no column. Ten CANCELLED runs in the live queue state no
  reason. Migration `20260825000300` adds `closure_note` and carries it
  through to `list_graph_runs`. **Not yet hosted**; apply before the code
  ships, not after.

**Ten-step flow, local: PASS.**
`tests/integration/ten-step-consecutive-flow.behavior.test.ts` drives one
`full_lifecycle` request to a COMPLETED run against the real migrated schema
across gate-halted windows: all eleven stages close with a COMPLETED node and
an artifact, no node executes twice, both human gates are owner-approved and
the automatic gate decides on its anchors, `list_graph_runs` reports
identically on a second read, and a signed-in outsider is refused outright.
Step 1's refusals are pinned at the route boundary (malformed body, non-uuid
project, unknown template, non-manager role, cross-origin), each asserting
its own error code. Full suite 4535 passed / 2 skipped, lint, typecheck and
production build green; all ten `/solutions/factory/*` pages serve 200 to a
signed-in user on `dab41e5`.

**Ten-step flow, live production: PASS — the whole walk, terminating on
policy.** Lifecycle `1f9defa2`, launched by a signed-in user through the
real product API (`POST /api/graphs`, project 51af87ae), ran all ten steps
against production with genuine model execution, across four provider
windows on 2026-08-25. Verified through `/api/graphs/runs` as that same
signed-in user, not from worker logs:

| Step | Stage | Node(s) | Result |
|---|---|---|---|
| 1 | REQUIREMENT | goal, requirements | COMPLETED |
| 2 | DISCOVER | scan_internal, scan_dependencies, recall_ecosystem, consolidate | COMPLETED |
| 3 | EVALUATE | evaluate | COMPLETED |
| 4 | DECIDE | decide | COMPLETED |
| 5 | ARCHITECT | architecture | COMPLETED, HUMAN gate APPROVED via the product API |
| 6 | BUILD | implement | COMPLETED under ADR-145's 48-turn budget |
| 7 | REVIEW | review | COMPLETED |
| 8 | TEST | test | COMPLETED, AUTOMATIC gate APPROVED on anchored evidence |
| 9 | DEPLOY | deploy | FAILED by policy refusal — the designed Phase-1 terminal |
| 10 | MONITOR | monitor | SKIPPED, correctly blocked behind the refusal |

The final run `884d6164` closes PARTIAL carrying 11 RAW and 1 ANCHOR
artifact. That PARTIAL is the honest terminal, not a defect: step 9 records
"deployment execution is owner-approved in Phase 1 and no deployment
instrument is wired. This refusal is the policy holding, not a fault," and
step 10 blocks behind it because nothing shipped to observe. A COMPLETED
run here would mean the policy had failed.

Both intermediate voids (`c1576809`, `4a426a14`) were capacity refusals the
engine correctly recorded as CANCELLED rather than answers, and ADR-144's
watermark then let the approved gate survive them — proven live, twice.

**PRODUCTION READY: PASS — seeded flow and live production walk both.**
The seeded ten-step flow passed end to end (the seed's own loop, the real
migrated schema, a COMPLETED run with all eleven stages closed and their
artifacts recorded, gates decided by the owner and by anchored evidence, an
outsider refused), and the live walk above completed all ten steps against
production, verified through the product's own API as the signed-in user.

What this verdict covers precisely: steps 1-8 executed and COMPLETED with
real model calls; step 9 terminates on the Phase-1 deployment refusal and
step 10 blocks behind it, which is the designed behavior, not an
outstanding gap. Autonomous deployment stays outside Phase 1 by policy, so
no walk can pass step 9 until an owner-approved deployment instrument is
wired — and that is a scope boundary, not a defect.

**Migrations, and the `Supabase Preview` check: two different claims.** On a
FRESH database, the migration set replays cleanly — every integration suite in
this session applies all 163 files in order to an empty PGlite and passes,
which is what the ten-step PASS below rests on. What is NOT clean is replay
onto a database that already holds the objects: `Supabase Preview` has been
red on `main` continuously (checked across eleven commits back through
`5e5054b`, all predating this session), dying on `20260815000200` with
`column "maximum_concurrent_runs" of relation "organizations" already exists`.

That is the known partial-apply class already tracked in `AI/BACKLOG.md`: 18
historical migrations were applied to production without recording ledger
rows, so the preview branch replays each one into its own objects. The
backlog's stated discipline — probe inventory first, finish only what is
missing, record the row only once every declared object is present — is
deliberately NOT shortcut here, because "applying them blind is how this class
of problem began." Making the column adds `if not exists` would paper over a
ledger gap and could hide a genuine partial apply, so it was left alone.

This session's own migration (`20260825000100`) followed that discipline and
IS ledger-recorded (apply run 32805322660, `migration repair` confirmed), so
it does not extend the 18. `Supabase Preview` is also not a required check —
`main` has no required status checks configured at all; the four-green-checks
bar used for every merge in this session is stricter than the repository
enforces.

**Seeded ten-step flow: PASS.** `tests/integration/dev-seed-drive.behavior.test.ts`
walks the whole flow to a COMPLETED run by calling `driveSeedLifecycle` — the
exact loop `npm run seed:dev` runs — against the real migrated schema, with
only PGlite substituted for supabase-js. All eleven stages close with a
COMPLETED node and a recorded artifact, the two human gates are approved by
the owner and the anchored gate decides itself, the walk halts for a person
without `--drain`, and every artifact carries `dev_seed`. Running the real
loop found two further defects: the claim was parsed before being checked
for null (an empty queue threw a malformed-projection error instead of
reporting an idle answer), and a `--drain` re-run claimed nothing at all,
because the first run leaves an OPEN gate that makes the graph deliberately
unclaimable and the loop only decided gates after a claim — so the obvious
two-step usage did nothing. Both fixed and pinned.

**Development seed setup: PASS — and it was broken.**
`scripts/seed-dev-lifecycle.mts` was first recorded here as unexercised,
because this container cannot start Docker. That was too generous: its setup
path was checkable against real PostgreSQL all along, and
`tests/integration/dev-seed-setup.behavior.test.ts` found **two defects that
would have failed the first time anyone ran it**.

It created its project with a direct service-role insert, but only
`postgres` may insert a project — migration 20260812001700 revoked that from
`authenticated`, and `service_role` never held it, because a project is born
from the audited `connect_github_project` path. And it read its world with
the service-role client, which holds SELECT on none of `projects`, `graphs`
or `graph_gates`: those are granted to `authenticated`, so RLS decides who
sees what. Both were fixed by respecting the boundary rather than widening
any grant — the seed now finds a project instead of inventing one, and reads
as the signed-in owner — and both failures are kept as assertions.

Now **PASS** at 5 cases against the real migrated schema: onboarding
idempotency, no role may invent a project, the discovery read refused the
service role and working as the owner, all eleven phases staged through
`create_graph_from_plan`, and the planted graph actually claimable. The full
end-to-end drive against a live Supabase stack remains **PENDING** the same
Docker limitation, and the script is idempotent, labels every payload
`dev_seed`, refuses the production project with no override, and refuses to
claim graphs it did not plant.


**Addendum, 2026-08-22 ~21:30Z — containment gate honesty and the audit
guard's hosted ACL (ADR-122):** four probe-guided rounds isolated why the
protected chain kept refusing at containment after every catalog gate went
green. The owner's Safety-page actions (~21:11Z: kill switch engaged,
Autonomous Mode OFF) satisfied every state and event clause — probe
`32599024205` reads all four project rows green with a disconnected worker
table — leaving exactly one red clause, `reject_mutation_function_posture`
(probe `32599284961`). Its two causes are fixed in one change: the gate's
space-only `btrim` source comparison, false on every database including a
pristine one, now trims `' \n'`; and `20260822001300` behind
`scope=audit-guard-acl-contract` removes the hosted Supabase default
`service_role EXECUTE` grant on `reject_activity_event_mutation()`.
Certified locally by `tests/integration/audit-guard-acl-contract.test.ts` —
**PASS** at 4 cases: clean-chain no-op, reproduced hosted default grant
contracted, unknown-ACL refusal, and full-chain replay including the
protected six. Hosted application of `20260822001300`, the protected chain,
and the production Step 8/9 acceptance remain **PENDING**.

**Addendum, 2026-08-22 — Backlog and All Pipelines clear controls
(ADR-119):** `main` commit `9761055` (#317). Local verification before merge is
**PASS**: 345 test files, 4168 tests passed, 0 failed, 2 skipped, with lint,
typecheck and production build green. `tests/integration/clear-backlog-and-pipelines.behavior.test.ts`
is **PASS** at 15 cases against real PostgreSQL, covering the owner/admin check,
the ten-character reason floor, the live-work skip, the cascade-into-run-history
skip and its explicit opt-in, replay, and the audit row written by a clear that
deleted nothing.

Hosted application is **PASS**: run `32582241930`, `scope=clear-controls`,
ledger empty for both `20260822000700` and `20260822000800` beforehand. The
post-apply readback measured `security_definer t`, `member_may_execute t`,
`anon_may_execute f` for `clear_backlog_tasks` and `clear_all_pipelines`, and
both `activity_event_type` labels present.

That evidence is **self-graded**: the step that applied the DDL also asserted
it. `scope=probe` now reads the same catalogue independently — the definer
flag, owner, and EXECUTE for `authenticated`, `anon` and `service_role`, plus
the two labels from `pg_enum` — so a wrong assertion and a wrong migration can
no longer cancel out. The independent read has not yet been dispatched.

**Any-model safe command candidate (ADR-115): LOCAL/PENDING RELEASE.** Exact
`openai` / `gpt-5.3-codex` remains the only executable identity. All other valid
bounded provider/models are `record_only` and are contractually limited to
durable command/task/route history with zero runs, worker dispatch, repository
artifacts, or deployment. Invalid identities and every nondefault
`SOFTWAREFACTORY_CODEX_MODEL` execution pin fail closed.

Step 8 durable-record advancement and truthful Step 9 are implemented against a
project-scoped safe history projection; raw parameters are not part of that
projection, and reload persistence is covered locally. Hosted `00600` is
already applied. Protected `00300/00850/00900/01000/01100/01200` remain pending
as one atomic scope, with rollback rehearsal and exact ledger/catalog/ACL/lint/
health and safety gates. Read-only hosted probe `32591774367` measured twelve
exact guarded functions and four exact ACL deltas. `00850` converges only those
ACLs, preserving every OID and the claim function's hosted
`organization_id`/`purpose` OUT contract; `00900` freezes that legacy contract
instead of replacing it.

ADR-116 removes only the repository release ceremony: a direct owner request in
the active task is sufficient release authority, without a magic RED phrase,
predeclared commit/hash, expiry, or repeated approval. Exact-head CI, READY
deployment identity, immutable migration hashes, rollback rehearsal,
ledger/catalog/ACL/lint/health checks, audit evidence, and containment remain
mandatory. Product/runtime RED approvals are unchanged.

Release status is therefore **NOT DEPLOYED / NOT PRODUCTION-ACCEPTED** for this
candidate. Final commit identity, exact-head green CI, matching READY Vercel
deployment, hosted atomic apply, zero-run postflight, and signed-in
Claude/alternate-model Step 8 -> Step 9 -> reload evidence are all still
required. Existing workers/autonomy/actions remain OFF and the global kill
switch remains ON; no prior deployment is evidence for this new behavior.

**Historical release checkpoint before ADR-115, 2026-08-22 (ADR-111,
superseded):** exact commit
`30d7e824691bdd4f8fa72481b21c91d3da6e3a31` is on `main`, authored and
committed by `surgeservicesllc <surgeservicesllc@gmail.com>`. Exact Vercel
production deployment `dpl_FrvCToHvFhkzfwnkmEeeTyfuE3v2` is READY at
`https://softwarefactory-116001qbk-surgeservices-projects.vercel.app` and owns
the stable aliases. GitHub deployment `6036292508` and status `17160408639`
bind the deployment to that exact SHA.

Exact-head CI run `32570540183` is **FAIL**. Browser/accessibility jobs
`97025270171`, `97025270137`, and `97025270138` are **PASS**. Quality job
`97025270055` is **FAIL** during tests and skipped build because the LF
migration chain rejected all seven legacy routine hashes at the 00150
preflight. Supabase Preview check `97025325852` is also **FAIL**, separately,
at the older provider-credential migration with SQLSTATE `42P07` because
`provider_credentials` already exists; the same preview drift predates this
candidate.

The local repair canonicalizes CRLF and lone CR to LF before every
`md5(prosrc)` comparison and pins 00150, 00200, and 00300 respectively at:

- `6b24b6ebb57e59b9c4398c3e439221c27c300663a7b6932ff192996ffe6bcd93`;
- `658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`;
- `79914bc97660eef908b6a0fa0c90abfdd15da1683b383ad568e34bf3bd32c5f7`.

Native PostgreSQL 17.10 and 18.4 full chains are **PASS**. The repaired forward
candidate is not yet pushed, deployed, or authorized for hosted execution. No
hosted database mutation occurred; 00150/00200/00300 remain unhosted and
CONTRACT was not dispatched. Historical predecessor commit `4fc18d3e...`,
deployment `dpl_8yngqtjJkNbexxWAMfAhZtEf1RWU`, and fail-closed EXPAND run
`32568221857` remain retained safety evidence.

**Addendum, 2026-08-22 — Claude bot identity and Role-assignment release
candidate (ADR-108/ADR-109):** this is local candidate evidence only. Migration
`20260822000200_register_bot_for_ai_account.sql` is frozen at SHA-256
`658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`.
It binds each returned subscription bot to the exact tenant AI account and
derived provider/credential slot. A default/non-additional request reuses the
account's bot or permits only one unambiguous in-place legacy adoption; an
explicit additional request creates a distinct bot with that same exact account
binding. Future coherence is enforced. Positive bot and assignment revisions
start at 1, increment on every update, and make stale exact-config/readiness or
exact-posting writes fail under row lock. Checked mutation paths refuse
released history.

Readiness recording is service-role-only, carries the audited owner/admin actor,
and compares exact bot revision, AI account, provider, model, credential
reference, and base URL. A check cannot author Disabled and cannot overwrite an
existing Disabled management state. `bot.registered` and adoption-path
`bot.updated` immutable events include the exact `ai_account_id`. This is an
EXPAND migration: legacy function definitions, signatures, security attributes,
search paths, and exact authenticated-only execute ACLs remain unchanged while
checked wrappers and the service-only recorder are added. The accepted rolling-
cutover risk is that the old application can still use unchecked assignment and
legacy readiness calls. Revocation requires a separately approved forward
CONTRACT migration after exact-app deployment and acceptance.

The visible path also closes coherently. AI Factory supplies one application
modal/focus boundary and embeds the roster, assignment/configuration flow, and
starter-role control without nested dialogs. With zero roles, Backend engineer
is the reviewed starter default and its full template is saved through the
audited role API; the exact returned UUID fills only blank selected drafts.
Developer remains the separate default permission preset for a new posting,
while existing posting role/configuration is preserved. The account connector
serializes start/retry/close/unmount operations and fences async results by
session UUID plus generation. The roster filters released rows before a
terminal-proven keyset traversal, continues after short pages, and fails closed
on invalid progress or the page guard. Factory completion therefore follows
one complete connected-account -> exact account bot -> selected project ->
revision-checked active configured posting chain.

Owner-screenshot containment closes one UI-only identity shortcut:
`ProjectBots` had used `credentialRef` similarity to suppress the exact-link
repair control. An unbound Ready legacy bot could be assigned while AI Factory
correctly held steps 5-7 incomplete. The local fix removes that inference,
exposes the existing exact `/api/bots/connect/provision` Link-or-repair/adoption
path, awaits the parent refresh, and adds an accessible **Return to AI Factory**
action. The affected completion predicate remains connected account + exact
`aiAccountId` + current Ready + project assignment.

This UI containment is frozen in the current unpublished candidate. Focused UI
is **PASS 75/75**; focused ESLint, full typecheck, and lint/typecheck/build are **PASS**. The root
full suite is **PASS** for 337 files / 4,054 tests, with 3 files / 7 tests
skipped. Its first contention-only `supabase-wiring` timeout cleared isolated
2/2 and on the full rerun.

Focused coverage exists for migration behavior, hosted-scope guards, exact bot
and readiness synchronization, revision/stale/released handling, complete-
roster pagination, one-modal/zero-role onboarding, assignment preservation and
readback, broker races, and Factory progress/reload. The final semantic audit
also covers every assignment, manual-bot, authored-role, and advanced-command
field; it fixed controlled Instructions editing and required endpoint gating.
Prepublication local gates and the exact-head browser shards remain useful, but
the failed quality job controls the release verdict. The application commit has
matching `main` and Vercel evidence; the repaired forward candidate does not
yet have a published exact-head CI result.

No database release claim is made. Dedicated protected scopes enforce the exact
00150 -> 00200 -> signed-in application acceptance -> 00300 order, and broad
apply refuses to introduce those files. Runtime behavior, linked-database lint,
application health, and containment are explicit post-apply gates. Promotion
remains RED. Kill switch stays ON, raw autonomy and all automatic actions stay
OFF, and worker/executor remains disconnected.

**Addendum, 2026-08-21 — AI Factory production acceptance:** exact candidate
head `a020e8192d8512a1bb65112e01017047087f0528` passed all four jobs in CI run
`32543409160` (quality plus browser shards 1/3, 2/3, and 3/3). Production-browser
evidence is separately **4/8**: **Agentic SDLC** persisted after reload and its
immutable `pipeline.selected` event appeared in Activity; the owner-reconnected
Claude account reports Connected. Refresh remains pending because no worker
sweep completed, so it proves no fresh worker or end-to-end bot health.

Production Create Bot still fails and leaves zero bots. The proven mismatch is
that the Bot Manager sends raw broker purposes `claude`/`claude_N` (or
`codex`/`codex_N`) to a provision contract that accepts provider-neutral
`subscription`/`subscription_N`. PR #309 exact head
`db1958f8b501e865a9e741a21298683e0f88f969` normalizes every account-backed
path and fails closed on missing/mismatched metadata; 99 focused tests, lint,
typecheck, the production build, and the secret/protected-path audit pass. The full Windows run
passed 3,763 tests but retained one unrelated timing failure that passed 13/13
immediately in isolation, plus the existing `script`-binary runner errors. The
exact-head CI gate failed in run `32545138211`: browser shards 1/3 through 3/3 could not
find the `AI Factory` H1 while required reads were pending. The forward
candidate keeps the page H1 in loading and all fail-closed states and adds a
direct regression test.

The candidate still is not release-ready: the protected credential normalizer
rejects the catalog-declared Claude/Codex subscription reference that
provisioning stores, the manual readiness endpoint checks and serializes
environment presence only, and provisioning leaves `bots.ai_account_id` null.
No protected fix was made without exact owner approval. Bot creation, assignment,
configuration, readiness, identity binding, and reload stickiness therefore
remain unproved. Production is also still unsafe/not fully
`subscription`/`subscription_N`. The branch candidate now normalizes every
account-backed path and fails closed on missing/mismatched metadata; 100 focused
tests, lint, typecheck, and the production build pass. The full Windows run
passed 3,763 tests but retained one unrelated timing failure that passed 13/13
immediately in isolation, plus the existing `script`-binary runner errors. The
fix is not deployed. Bot creation, assignment, configuration, and reload
stickiness therefore remain unproved. Production is also still unsafe/not fully
live because of five linked lint errors/ten
findings, raw autonomy and kill-switch drift, two projects with effective kill
off, no connected/fresh worker, and hosted
`20260821000300`/candidate `20260821000400` migration/application drift.

**Addendum, 2026-08-22 — Job Seeker, production-behavior certified:** the
evidence tier above local-stack certification now exists: the full
fake-data journey ran against https://www.theagoras.com itself (journey
lane remote mode, run 32540879299 — first attempt timed out on a
production cold start immediately after sign-in; the CI retry completed
the entire spec, so the run is recorded flaky-then-green). Confirmed
independently by signing in to production as the fake account and
reading the production API back: 42 jobs in its RLS-isolated workspace
(2 manual + 40 imported live from Greenhouse in production), all 42
scored, analytics recomputed from the walked rows (1 application, 100%
measured response rate, 1 interview-stage count, 1 offer). Every capability
on the then-existing `/job-seeker` surface was observed working in production,
wired to hosted Supabase end to end. That 2026-08-22 run predates the later
Job Search integration and is not evidence for `/JobSearch`, live multi-board
search, sealed-result saving, or the atomic recording RPC.

**Release addendum, 2026-08-21 — Factory command routing (ADR-106):**
implementation is locally complete but not live. Migration
`20260821000400_command_factory_routing.sql` is 34,999 bytes with SHA-256
`e45149db3ca7c66a27934b0b49ac160e1b5ef597fc8f34ad8547de4759086598`.
It makes owner-only submit/replay durable and immutable, stores the selected
pipeline, bot/assignment, provider/model, work effort, effective-risk and
configuration evidence, rechecks stored effective risk, and resolves replay
before mutable state. The API fails closed as Not Connected until the RPC is
hosted. Submission dispatches no worker and changes no autonomy control; no
connected/fresh worker was observed, while merge, deploy, and rollback remain
not connected.

The UI candidate also pins two first-use boundaries: embedded graph planning
renders and submits only the caller's project from the first dialog frame,
without a workspace project read; bot assignment cannot advance past Configure
with a missing role and gives a real Bot Manager recovery path.

Current candidate lint, typecheck, and production build pass. Default
unbounded-run Supabase-wiring and pipeline failures were contention-only and
both clear on isolated retry; the wiring contract passes 2/2 in 0.603s with
`maxWorkers=1`. The bounded current-head non-frozen command
`vitest run --exclude tests/unit/auth-broker-runner.test.ts --maxWorkers=4`
passes 317 files / 3,730 tests, 7 skipped, in 183.78s. The excluded owner-
frozen auth-broker file has 19 tests and is excluded locally solely because
Windows lacks Unix `script`; Linux CI must run the complete suite. Hosted-
runbook/repository-memory guards separately pass 21/21. Production still hosts
`20260821000300`, not `20260821000400`, and serves the old application copy.
Hosted quality is blocked by five linked lint errors/ten findings, one raw
organization with `autonomous_mode = true`, one with
`autonomy_kill_switch_active = false`, two
projects with effective kill off, and no connected/fresh worker. Older clean-
lint/all-OFF/kill-ON statements below are historical and are not current
hosted evidence.

**Addendum, 2026-08-21 — Job Seeker, live-stack certified (ADR-097):** the
surface's strongest evidence tier so far: one continuous browser journey
(`tests/e2e/job-seeker-journey.spec.ts`, guarded by `JOB_SEEKER_E2E=1`)
green against real GoTrue + PostgREST + Postgres carrying all 127
migrations, under the production `next build` — every section filled with
fake data, every capability exercised, persistence proven by reload, the
approval gate and duplicate refusal observed in the browser, and the
anti-fabrication contract asserted on a live generated document. The run
found and fixed three live defects the mocked suites could not see (the
PostgREST one-to-one embed shape chief among them — the mocks had encoded
the wrong shape). Round 2 the same day extended the journey to the whole
capability surface (all eleven stages, reject+close, entry removal, the
resume BYTEA download round-trip, analytics re-checked after the walk)
and closed two more wiring gaps: the CRM details editor and the
persistent current-resume link. Suite counts on the merged state: 3,470
vitest green (2 skipped), lint and tsc clean, production build clean,
extended journey green in 30.8s. The journey also runs in CI now:
`.github/workflows/job-seeker-journey.yml` (dispatch + daily schedule),
proven live by run 32533731639 — green in 3m40s on a runner that
provisioned the stack itself. Live-wiring regressions surface within a
day without anyone asking.

**Addendum, 2026-08-21 — Factory Briefing (ADR-104):** locally implemented
as a read-only Dashboard projection with no schema or authority change. The
pure classifier pins mutual exclusivity, task ownership of linked runs
records, lifecycle precedence, deterministic priority/recency sorting, caps,
cancelled omission, coordinator/crew counts, stale-worker escalation, and
fail-visible unknown states. The component suite pins signed-out zero-read
behavior, eight concurrent `no-store` GETs with no mutating method, all four
populated lanes, GitHub-only evidence links, server-minimized briefing payloads,
omission of prompt-derived titles, command prompts, inbox bodies, and detailed
graph evidence beyond fail-visible verdicts; explicit unavailable/malformed/
saturated-source integrity warnings, and expired-session handling. Reads have
per-source timeout, batch cancellation, stale-response protection, and
visibility-aware polling. The populated browser harness covers every width from 320 through
1440 px and drives the component's refresh control; axe scans cover 320 and
1440 px, and a maximum-length coordinator has an explicit 320 px overflow
regression. Local evidence is full lint/typecheck/build green, 57/57 focused
tests, a browser matrix with 30 passes plus 15 intentional non-resizable-
project skips, and 2,506/2,506 unit tests on the rebased tree after excluding
two known Windows-only process/permission files. Database behavior suites need
their configured stack; Linux draft-PR CI remains authoritative. Production
behavior is not claimed until an authorized deployment and live authenticated
observation exist.

**Addendum, 2026-08-19 — graph execution (ADR-092):** the graph executor
boundary (migration `20260819000100`), the worker
(`scripts/graph-worker.mts`), edge data flow, capacity-refusal voiding, and
the one-time re-plant (`20260819000200`) are locally certified —
`tests/integration/graph-worker-execution.behavior.test.ts` (9 cases against
the full migrated chain, including measured parallel fan-out and both
convergence caps) and `tests/unit/claude-node-executor.test.ts` (8 cases) —
and hosted-behaviorally observed as far as the provider allowed: production
worker runs 32208699123 / 32208975669 / 32209893742 demonstrate claim,
parallel dispatch, containment, honest closure, and bounded re-claim on the
live database. **A node has now succeeded in production**: post-reset drain
run `32228988434`, graph run `e51c57a5-…` — the rollback inspector completed
through the CLI, its RAW artifact was recorded, and the run closed PARTIAL
with the incompleteness stated (every other node hit the worker's old
8-turn ceiling, since raised to 24 with an eight-minute MODEL-node
timeout). **The full chain has now executed end to end in production**: drain run
`32254860997`, graph run `ca347ab9-…` — an inspector completed through the
CLI, the deterministic reduce folded its findings in code, and the report
synthesis completed from the reduce output, with no node left undispatched
and the incompleteness stated. **Every inspector has now
succeeded in production**: post-reset drain run `32283900970`, graph run
`4d3f44a7-…` — all five MODEL inspectors completed in parallel through the
CLI with the corrected 24-turn/eight-minute envelope, the deterministic
reduce folded their findings, and the run closed PARTIAL naming its one
failure: the report synthesis, refused capacity minutes after the window
opened (the same window had just paid for the live canary's five nodes).
The live canary itself is green end to end — run `32283945714`, "fans out,
synthesizes, and verifies with a fresh context", 176.6s, zero API tokens —
so fan-out, synthesis, and fresh-context verification each have live
proof. **The complete run has now executed
in production**: drain `32310917147`, graph run
`1df3fd45-5501-4912-81f8-26448b865af3` — COMPLETED, 7 succeeded, 0 failed,
in 6m26s (22:54:48-23:01:14Z): five MODEL inspectors in parallel through
the CLI, the deterministic reduce, and the report synthesis, dispatched
alone in a fresh provider window per the plan in `20260819001200`. No
graph-execution claim is withheld any longer. CI on main is green on the
merged state with the browser suite sharded 3×535.

**Addendum, 2026-08-18 — a project's selected pipelines (ADR-098):**
migration `20260821000300` (`project_pipelines`, RLS + FORCE RLS, all table
privileges revoked from `anon`/`authenticated`/`service_role`, three definer
functions), `GET`/`POST`/`DELETE /api/project-pipelines`, the Use toggle in
`PipelineTemplatesManager`, and the AI Factory's Configure Pipeline step are
covered by `tests/integration/project-pipeline-selection.behavior.test.ts` (16
cases against the real migration chain, including owner-allowed,
member-denied-write/allowed-read, outsider-denied, anonymous-denied, and no
direct browser write path), `tests/unit/project-pipelines-routes.test.ts` (14
cases) and the two component suites. Lint, typecheck, the full 3258-test suite
and a production build are green on this change.

**Hosted evidence class: schema present, behaviour unobserved.** Run
`32536895799` (2026-08-21 23:27Z, `scope=pipeline-selection`) applied the
migration to the hosted project and its after-ledger listing shows
`20260821000300` local and remote. That proves the DDL ran — the table, the
three definer functions, and the ledger row — and nothing more. No one has yet
pressed Use on the live site and watched the selection survive a refresh, so no
production *behavioural* claim is made here.

The Not Connected path is retained and still correct for any database without
the migration: `/api/project-pipelines` reports PGRST202 with its own code and
the Use button is disabled naming that reason, rather than rendering an empty
selection set that would make a working button look broken.

**Addendum, 2026-08-18 — hosted evidence, measured (ADR-081):** the "the
migration is unhosted, so no hosted claim is made" qualifier attached to
several entries below was derived from a ledger high-water mark, and probe run
`32103778884` (read-only) shows that mark does not describe this ledger: it has
nineteen gaps in the middle and carries every row above them. Two entries below
are wrong as written — `20260816001500` (usage observations) and
`20260816001400` (repository picker) are both **on the hosted ledger**. The
`20260817` range is on it too, `20260817000700` included.

That is not the same as a hosted *quality* claim, and none is added here. A
ledger row proves the DDL ran; it does not prove behavior observed in
production, which is what these entries withhold. What changes is only the
stated reason for withholding it: for those migrations the reason is now "no
hosted behavioral observation", not "the schema is absent". The nineteen still
absent, and the per-version marker that decides repair-versus-apply for each,
are in `AI/HOSTED_APPLY_RUNBOOK.md`.

**Addendum, 2026-08-16 — per-account usage evidence (ADR-076):** migration
`20260816001500` (append-only usage observations, worker-only write, member
latest-per-account read), `lib/worker/usage-probe.ts` with the auth-broker
capture hook, `GET /api/ai-accounts/usage`, and the Bot Manager usage rows are
implemented and locally certified: the new behavior suite
`tests/integration/ai-account-usage.behavior.test.ts` and unit suite
`tests/unit/usage-probe.test.ts` pass alongside the updated
schema-security-invariants pins (service_role gains exactly
`record_ai_account_usage`; the policyless allowlist gains the evidence table),
with lint, typecheck, full vitest, and a production build green on this tree.
Hosted behavioral evidence does not exist yet. This entry originally said the
migration was unhosted; the 2026-08-18 measurement finds `20260816001500` **on
the hosted ledger**, so the schema is there and the panel fills in from the
already-deployed worker cadence. What is still unobserved is a production row. No execution
authority changes.

**Addendum, 2026-08-16 — project repository picker:** implemented and locally certified:
migration `20260816001400` (two definer functions, no table/grant/RLS changes),
`PUT`/`DELETE /api/projects/[projectId]/repository`, and the Connections console picker.
Evidence: `tests/integration/project-repository-picker.behavior.test.ts` (8 tests against
the full migrated chain: function ACLs, member refusal, link/relink/unlink evidence, the
named uniqueness refusal, the pending-reservation freeze, the archived-project refusal),
`tests/unit/project-repository-route.test.ts` (11 tests: same-origin, role, body, RPC
wiring, verbatim 55000 refusals, 23505 race mapping), and six new Connections console
component tests (picker render, link, unlink, uniqueness message, load-failure state,
no-installation state, zero-repository state). Local evidence only, and no hosted claim is made. The
"unhosted" reason originally given here is withdrawn: `20260816001400` is on
the hosted ledger as of the 2026-08-18 measurement. What is missing is a
production observation, not the schema.

**Addendum, 2026-08-16 — BotBuild (AI accounts + auth broker):** the P0 layer is
implemented and locally certified: migration `20260816000100` (two RLS+FORCE
tables with zero direct table access, 16 definer functions, `bots.ai_account_id`),
the `/api/ai-accounts` broker API, the worker auth runner + gated Actions
workflow, the auto-completing connect UI (no command, no check-now on the
primary path), unbounded account/bot slots (configured capacity only), and the
AI Accounts management panel (reconnect/disconnect). Full local gate on head
`1cab6f5`: vitest 2804/0, tsc clean, eslint 0 errors. **Superseded live
(2026-08-16):** the broker is LIVE in production for both providers — three
Claude accounts and one Codex account are Connected with identity capture and
periodic verification, owner-verified by screenshot at 19:07Z — and both
paths are owner-frozen (ADR-072/ADR-073). The freshest full local gate is on
merged head `aeabc95` (GitHub install host-convergence + freeze extension):
vitest 2839 passed / 2 skipped / 0 failed, tsc clean, eslint 0 errors
(10 pre-existing warnings in untouched files), production build exit 0.
Still open from this addendum: the verification loop UI and per-bot
runtime/log tracking beyond assignments (todo.md P1–P3).

Decision: **Phase 1C is re-architected to zero-token subscription-authenticated Codex execution, the credential is configured, and the worker is LIVE — scheduled Actions runs pass preflight in subscription mode and poll for work every ~5 minutes (run `31894356952`, 2026-08-15). No live canary exists yet because no command is queued; that is one owner action, not an engineering gap. Superseded text follows for history: ** The paid-API dependency is removed from the execution path: `OPENAI_API_KEY` is no longer a worker configuration field, `new Codex()` is constructed without an api key, preflight makes no `api.openai.com` request in subscription mode, and no workflow step receives a paid key. The billed mode must name itself and can never be reached by fallback. The schema, worker, and fail-closed provider-startup recovery are published, but Phase 1C remains Not Connected. The first owner-approved live acceptance attempt failed safely before any repository mutation. Distinct no-claim diagnostic run `31748582858` passed the exact-model GET and classified the bounded Responses failure as `credit_balance_exhausted`, while skipping Docker preload and durable claim. The failed run's immutable base predates current `main`, so it must not be retried; acceptance requires a new current-base command after funded-provider proof. Activation is OFF. Phase 1D execution and provider execution also remain Not Connected.**

Reason: exact project `qpuofpmagrmyamahqwxw` is reconciled and current through forward migration `130014`; linked lint and focused catalog/runtime/ACL checks pass. Local `130015` restores the assignment/run model constraint bound from 120 to the original 128-character provider catalogue/API contract, adds four no-secret constraints for catalogue model/display-name, assignment model, and routing policy-version/selected-model text, adds bounded routing evidence, and closes authenticated raw routing-decision/event reads while retaining tenant-scoped model-catalogue reads, but is unhosted pending fresh exact RED approval. The prior verified production baseline before this update was `0c662a24393f682073e6002c5aff9339292226d8`; it passed both required jobs in CI run `31749352644`, and matching Vercel deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7` was READY. Live command `0c4d0ca8-1867-4d00-80cf-476401491a17` produced durable run `f4594556-6f72-4763-a480-6993939e3651` and worker Actions run `31746057998`; a real claim, heartbeat, and provider thread occurred, then provider startup failed before changed files, commit, branch, PR, validation, or exact-head CI. Diagnostic `31748582858` identified exhausted project credits without a claim. The failed run is now stale against the verified baseline and must not be retried. The user-pasted OpenAI key is treated as compromised and its GitHub Actions secret is deleted; the other six protected secrets remain. A successful live draft-PR journey requires credits or a fresh funded replacement key, a passing provider-only diagnostic, and a new current-base command.

Phase 1E decision: **Production-operations control plane implemented, hosted, and locally verified; unobserved, so no live monitoring claim is made**

Reason: migration `028` adds ten RLS/FORCE-RLS operations tables and owner-scoped workflows with zero new `service_role` table privileges. Its schema effect and reconciled ledger row are hosted, but no monitor has observed a real production target. Every Phase 1E surface therefore reports **Not Connected** or **Unknown**. Rollback and repair execution remain absent by design.

Phase 1D decision: **Decision layer exists and no executor is connected; current hosted control drift blocks an all-OFF quality claim**

Reason: migration `130006` defines the intended nine-action, two-scope interlock model and the decision modules still classify diffs, require gates, and prohibit self-approval. Current hosted evidence, however, contains one raw organization with `autonomous_mode = true`, one with `autonomy_kill_switch_active = false`, and two projects with effective kill off. No connected/fresh worker or merge/deploy executor was observed, so execution remains inert; the data drift must be contained and remeasured before the intended all-OFF policy can regain a Pass.

### Phase 1D completion

| Objective area | Completion | Note |
| --- | --- | --- |
| Controls (9 actions, 2 scopes, most-restrictive-wins, emergency STOP) | **100%** | STOP and freeze were already Phase 1E; this phase added the missing five actions, the organization scope, and the resolver |
| Risk classification, before work and on the final diff | **100%** | Derived from paths and content; escalation past a declaration blocks |
| Gates (GREEN set, YELLOW set, blocking findings) | **100%** | A missing result blocks; `not_connected` distinct from `not_run` |
| Review / QA / Security agents | **100%** as deterministic analysers | Model-backed review needs Phase 1C/2A binding, which this phase does not claim |
| Approval (tri-state, no self-approval) | **100%** | Evaluated after the gates; unsound work is never escalated to a person |
| Orchestrator stage machine | **100%** as a decision machine | Twelve stages, halts at the first block |
| Deploy / preview / validate | **Validate: storage 100% (Phase 1E), decision 100% (Phase 1D); deploy and preview 0%** | **Blocked** — no Vercel API connection, and no validator produces the evidence. `lib/autonomy/post-deploy.ts` decides what a validation record proves: attribution before check results, and missing/stale/mismatched evidence is `inconclusive`, never `passed`. The pipeline's `validate` stage previously reported satisfied unconditionally; it now routes the absent case through the same evaluation |
| Rollback | **Decision 100% (Phase 1E); execution 0%** | **Blocked** — no adapter; `AUTO_ROLLBACK.md` disables it |
| Healing / repair | **Creation 100%, queueing 100% (Phase 1E); execution 0%** | **Blocked** — repair work now reaches the Phase 1C queue through `submit_command` instead of a task nothing could claim, but the manual Phase 1C candidate is **Not Connected** and grants no autonomous authority, so the run stops at `queued` |
| Auto merge | **0%** | **Blocked** — `AGENTS.md` forbids introducing the workflow in this line of phases |
| Backlog Autopilot | **Selection 100%; execution 0%** | Orders eligible P0–P3 work by priority then lower risk, holds behind unmet and unknown dependencies, refuses above the ceiling, and skips a degraded/critical/paused project. Starting the selected work is **blocked** on the two rows above |
| Bounded retries | **100%** | Per-stage caps with backoff; the budget escalates rather than retrying again, and a permanent refusal never retries |
| Recovery ordering on failure | **100%** as a decision machine | Freeze first (it only removes authority), then incident, rollback, repair, escalate |
| Never auto-reverse a destructive migration | **100%** | A destructive release resolves owner-only, outranking controls, ceiling and approval alike |
| Merge revalidation against the current head | **100%** | A push after approval invalidates it; a push after verification invalidates the gates; a required check with no report blocks rather than being read as satisfied |
| Decision auditability | **100%** | `autonomy_decisions` is append-only with RLS and FORCE RLS, no browser write, named blocker codes only. Self-approval and unexplained refusals are rejected by the table itself |
| Enabling any automatic action | **0% by design** | RED under `RISK_CLASSIFICATION.md`; needs an owner-approved migration. The classifier now enforces this rather than relying on it: any diff enabling an action, clearing the kill switch or emergency stop, raising the ceiling, or dropping the GREEN-observation constraint classifies RED on content, wherever it appears |
| Guardrails a loop could weaken about itself | **100%** as classification | Authority-widening and audit-evidence destruction are RED on content; `lib/autonomy/controls.ts` is RED by path; `AI/DECISIONS.md` is raised to YELLOW so a guardrail decision cannot be deleted inside an otherwise-GREEN diff |

**Overall: the decision half of the loop is complete; the executor half is blocked on three
things an agent cannot supply.** Everything that decides, restricts, records or refuses is built,
hosted and demonstrated. Everything that would mutate a protected resource is reached, evaluated
and blocked by a named blocker that the tests assert — so connecting an executor fails those
assertions deliberately rather than silently granting authority.

The three remaining blockers are a funded OpenAI project and rotated key (Phase 1C), a
`VERCEL_TOKEN` (deploy and preview), and an owner decision on the `AGENTS.md` auto-merge
prohibition. None is a code gap.

### Schema and wiring guards added 2026-08-14

Each of these encodes something that was already true and was verifiable only by a manual run, which does not survive the next migration. They are listed here because the scorecard previously credited manual verification as if it were standing coverage.

| Guard | What it prevents | Status |
| --- | --- | --- |
| `tests/integration/migration-version-uniqueness.test.ts` | Two migrations sharing a version prefix. Supabase's ledger keys on the prefix, so a duplicate is two applies competing for one primary key — `db push` fails partway and leaves the hosted schema half-applied | **Caught a live defect.** `20260814000300` was held by both `agentos_isolation_model` and `declare_model_characteristics`; the latter moved to `20260814000250`. Neither was hosted, so the fix carried no ledger consequence |
| `tests/integration/schema-security-invariants.test.ts` | A new table shipping without RLS, `service_role` quietly gaining a table privilege, a SECURITY DEFINER function without a pinned `search_path`, or a new function reachable anonymously | Pass - RLS and FORCE RLS on every public table across the whole chain; `service_role` table privileges limited to exactly `github_change_requests`, `github_installations`, `github_repositories`, `github_webhook_deliveries`; `anon` holds no write anywhere. **All 172 SECURITY DEFINER functions pin a `search_path`**; `anon` may execute exactly one of them (`subscribe_to_newsletter`) and `service_role` exactly twenty, each pinned by name |
| `tests/integration/required-checks-wiring.test.ts` | A renamed CI job leaving a live Phase 1C run waiting for a check that never reports — a hang rather than an error, after real work has been pushed | Pass - `SOFTWAREFACTORY_REQUIRED_CHECKS` matches `ci.yml` job names in both directions |
| `tests/integration/supabase-rpc-contract.test.ts` (pre-existing) | An `.rpc()` argument-name typo that type-checks and only fails against a real database | Pass - every call site in `app`, `lib`, `scripts` resolves against the migrated schema |

Two findings while writing these turned out to be the code being right and the assertion being wrong: `newsletter_subscribers` is deliberately policyless behind the SECURITY DEFINER `subscribe_to_newsletter`, and the four `service_role` tables are not the names assumed. Both corrections went into the tests.

### Authorization boundary audit, 2026-08-14

Every `app/api/**/route.ts` was checked for an authentication guard. **74 of 74 are guarded.**

Most do not call an auth helper directly — they delegate to a shared boundary that authenticates the caller, resolves the exact active organization, and reads through the caller's own JWT so the RPC enforces membership rather than the route re-implementing it: `tenantRpcListResponse` / `tenantRpcDetailResponse` (`lib/server/tenant-list.ts`), `operationsContext` (`lib/operations/route.ts`), and `prepareGitHubRepositoryRequest` (`lib/github/route.ts`). Concentrating the check is why the count is 74 rather than 74-minus-the-ones-someone-forgot.

Five routes are unauthenticated by design and were confirmed to be the intended set: `auth/sign-in`, `auth/sign-up`, `auth/magic-link`, `auth/resend-confirmation`, and `newsletter`. The newsletter route writes through the SECURITY DEFINER `subscribe_to_newsletter` into a table that holds RLS with no policy, so an anonymous caller can insert a subscription and read nothing.

Recorded because an audit with no record is an audit that gets repeated. A first pass using a naive grep reported 32 unguarded routes; every one was a false positive from the shared-helper indirection. The finding is that the boundary is centralized, not that it is missing.

### Client bundle secret scan, 2026-08-14

The production build output was scanned for credential-shaped strings and for the names of server-only secrets. **Nothing leaks.**

| Check | Result |
| --- | --- |
| Credential-shaped strings in the 35 client JS chunks | **none** |
| Credential-shaped strings anywhere in `.next` (excluding cache) | **none** — the apparent hits were `sk-async-storage-instance` inside Next.js's own `after-task-async-storage-instance.js` |
| `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_APP_PRIVATE_KEY_BASE64`, `SOFTWAREFACTORY_CODEX_AUTH_JSON`, `GITHUB_WEBHOOK_SECRET` in client JS | **absent** |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in client JS | **present as names, not values** |

The last row is the one worth explaining. `lib/bots/catalog.ts` carries `defaultCredentialRef: "OPENAI_API_KEY"` so the console can tell an owner which environment variable a provider's credential lives under. The name of a variable is not the variable's contents, and this is the pattern `AGENTS.md` prescribes: "A connection record is metadata plus a reference to server-side secret material; it is not a credential store."

`NEXT_PUBLIC_*` is limited to `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — all intentionally public, with row level security rather than obscurity as the protection.

### Deployment position

Measured 2026-08-14 23:04 UTC rather than inferred from merges succeeding. `https://www.theagoras.com`, `/solutions`, and `/platform` all return **200**, and the served build's sitemap `lastmod` is `2026-08-14T23:03:49Z` — the deploy from `baf8ce0`. **Production is current with `main`.**

It lagged for roughly ninety minutes because Vercel's free-tier hundred-per-day cap, exhausted by this session's pull-request volume, rejected deployments at 21:54, 22:02, 22:17, and 22:33 while allowing previews at 22:16 and 22:48. The cap throttles rather than blocking for a day, contrary to its own message, and a rejected deployment is not retried — the lag cleared when a later merge gave Vercel a fresh commit to build.

### Secret boundary

Scanned on 2026-08-14 across every tracked file and the full git history for OpenAI keys, GitHub
PATs, Slack tokens and private-key blocks. Twelve historical matches exist and **all twelve are
deliberate fake fixtures in test files** — `provider-config`, `autonomy-diff-risk`,
`github-rls-behavior`, `worker-foundation`, `provider-contract`, `bot-schemas`,
`bot-credentials`, and `provider-execution-rls`, each of which needs a credential-shaped string to
prove its detector fires. No real credential appears in any tracked file or in history, and no
`.env` file is tracked. The OpenAI key the roadmap records as exposed was exposed in chat, not
committed; the repository is consistent with that account.

## Phase 1E and retained Phase 1B evidence

| Area | Evidence | Status |
| --- | --- | --- |
| Phase 1B close-out (merge `c325dbb`) | `AI/PHASE_1B_COMPLETION.md`; `tests/integration/github-lifecycle-matrix.test.ts`; `tests/unit/github-lifecycle-errors.test.ts` | 18 PASS / 2 PARTIAL / 0 FAIL. Three real defects fixed: generic-500 lifecycle refusals, a stale suspension marker after revocation, and an aborted discovery against a terminally deleted installation |
| Full chain on real PostgreSQL 16.13 | 57 migrations applied in order from empty | Pass - 0 of 83 public tables missing RLS/FORCE RLS; `service_role` on exactly the four GitHub ingress tables with no DELETE; both Phase 1D interlocks intact |
| Merged-tree gates (2026-08-14) | `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `npx playwright test` | Pass - lint/typecheck clean; 1724 tests / 155 files; build exit 0; Playwright 126 passed, 3 skipped incl. axe |
| GitHub Actions CI on merge SHA | Run `31848857261`, two attempts | **Could not run** - no runner assigned (`runner_id: 0`), no logs (HTTP 404), 2s duration. Account-level Actions blocker, not a code signal. Identical code passed run `31846219078` |
| Merged-tree gates | `npm run lint`, `npm run typecheck`, `vitest run`, `npm run build` | Pass on the merged tree at 2026-08-14 22:00 UTC - lint/typecheck clean; **153 files/1704 tests**; production build clean. CI green on both required jobs for the commit merged as `145a31d` |
| Phase 1D E2E/accessibility | Local Playwright across desktop/tablet/mobile with axe | Pass - 117/117 |
| Phase 1D control interlocks | `tests/integration/phase1d-autonomy-controls.behavior.test.ts` against the migrated schema | Pass - 35 tests: each of nine actions refused at each of two scopes, both ceilings, both mode flags, the kill switch, and a new project or organization trying to be born with authority; both constraints `convalidated`; `anon` holds no write |
| Phase 1D decision modules | `tests/unit/autonomy-*.test.ts` | Pass - 277 tests across 12 files: controls, diff risk, gates, agents, approval, retries, autopilot, decision records, merge revalidation, recovery, post-deploy validation, and the stage machine |
| Phase 1D post-deploy validation | `tests/unit/autonomy-post-deploy.test.ts` | Pass - 38 tests. `passed` requires matching, complete, finished, fresh evidence with every required stage reporting and the observation window closed; mismatched evidence is `inconclusive` even when it records a failure, because a failure that cannot be attributed to this deployment is not this deployment's failure |
| Phase 1D end-to-end loop | `tests/integration/phase1d-loop-journey.behavior.test.ts` | Pass - a GREEN change reaches `APPROVED_AUTOMATICALLY` and then halts at `MERGE_EXECUTOR_NOT_CONNECTED`; a failed release drives incident, automatic freeze, Last Known Good, blocked rollback and bounded repair through Phase 1E's real functions, and the freeze is shown propagating back into the decision layer |
| Phase 1D self-approval boundary | Same journey plus `tests/unit/autonomy-approval.test.ts` | Pass - the author is refused as approver at every risk level, including RED and including an owner |
| Phase 1D hosted state | Ledger reconciled/current through `130014`; resolver checked live | Pass - decision-only migration `20260813000600` is hosted; all nine actions remain OFF and the global kill switch remains ON |

| Phase 1E gates | `npm run lint`, `npm run typecheck`, `vitest run`, `npm run build` on the Phase 1E tree | Pass - lint/typecheck; 132 files/1621 tests on the merged tree |
| Phase 1E coverage | `npm run test:coverage` | Pass - merged tree with Phase 2A: statements 72.94%, branches 69.92%, functions 64.57%, lines 74.29%. The Phase 1E tree alone measured 78.02/77.79/70.00/79.15 |
| Phase 1E E2E/accessibility | Local Playwright across desktop/tablet/mobile with axe, `/solutions/operations` included | Pass - 117/117 on the merged tree |
| Phase 1E detection pipeline | `tests/integration/phase1e-operations.behavior.test.ts` against the migrated schema | Pass - 30 tests: threshold detection, dedupe, upward-only severity, automatic freeze, owner-only resume, Last Known Good, blocked/failed rollback, bounded repairs, resolution gating, event idempotency, RLS, append-only |
| Phase 1E end-to-end journey | `tests/integration/phase1e-incident-journey.behavior.test.ts` | Pass - ordered Monitor→Detect→Incident→Freeze→Rollback→Diagnose→Repair→Validate→Resolve, plus failed-rollback escalation to SEV1; Codex-fix and deploy stages asserted as blocked, not simulated |
| Phase 1E boundary contracts | `tests/integration/phase1e-operations.contract.test.ts` | Pass - 19 tests: same-origin and role checks on every mutation, execution envelope on every response, no provider deployment call, no new `service_role` table grants, Phase 1D interlocks preserved, and repair promotion asserted to go through `submit_command` with a live base SHA rather than a privileged lane |
| Phase 1E repair promotion | `tests/integration/phase1e-repair-promotion.behavior.test.ts` against the migrated schema | Pass - 6 tests: the assembled parameters equal Phase 1C's exact-key allowlist, `submit_command` creates a real command and task, promotion is idempotent per attempt, a second promotion and an undiagnosed attempt are refused, a release freeze does not block promotion while the emergency stop does, and a security-shaped repair is forced to RED and `awaiting_approval` |
| Phase 2C durable circuit breaker | `tests/integration/phase2c-resource-persistence.behavior.test.ts` against the migrated schema | Pass - 12 tests driving faults through **separate calls**, which is the defect being fixed: an in-memory breaker reads zero every request and reaches no threshold ever. Also covers fault-class restart, close-on-success, transitions recorded only on real state changes, append-only enforcement, cross-tenant and anonymous denial, and zero `service_role` grants |
| Phase 2C decision storage | Same suite plus `tests/unit/resource-store.test.ts` | Pass - 11 unit tests: a stored timestamp converts to the epoch milliseconds the cooldown arithmetic needs, an unreadable breaker falls back to closed rather than blocking work, a lost fault observation throws rather than looking like health, thresholds are passed from the shared table rather than copied, candidate evidence is capped at 20 and carries named codes only, and an unevidenced prediction stores no success rate in either the module or the constraint |
| Phase 2C Resource Manager UI | `/solutions/resources`, `tests/unit/resource-manager-console.test.tsx`, `tests/e2e/pages.spec.ts` | Pass - 8 unit tests asserting that each empty panel says *which kind* of empty it is: "nothing has failed here" is distinguished from "proven healthy", an unevidenced prediction reads "No recorded history" and never 0%, candidate eligibility shows its named rejection codes, and the Execution card shows `—` while loading rather than defaulting to **Not Connected** |
| Phase 2C real-row candidates | `tests/unit/resource-candidates.test.ts` | Pass - 13 tests: an undeclared strength resolves to the weakest tier and an undeclared context limit to zero, both proven by routing the *same* model with and without the declaration and getting `RISK_TIER_TOO_WEAK` / `CONTEXT_TOO_SMALL`; an unrecognised capability is dropped rather than guessed; `custom` agents inherit nothing from their role; every agent status except `idle` is unavailable |
| Phase 2C routing boundary | `tests/integration/phase2c-routing.contract.test.ts` | Pass - 7 tests: the routing path contains no claim, token mint, or provider call; role and origin are checked before any tenant read; `performance: null` is never replaced by an invented zero; `reporting` and `structured_output` are not mapped onto Phase 2C capabilities; an unconfigured organization is distinguished from a routing failure; a decision that could not be stored is still returned |
| Phase 2C route collision | `tests/integration/console-routing.contract.test.ts` | Pass - `/resources` is a live public marketing page, so the console page gets **no** bare-path redirect. Adding one would have 308-redirected the marketing page to the console; the collision is now asserted in both directions. Caught by the production build listing both routes, not by the pre-existing test, which asserted the old rule faithfully |
| Phase 1E privilege boundary | Post-`028` grant assertions in the behavioral and hosted-grant suites | Pass - `service_role` still holds table privileges on exactly the four GitHub ingress tables; 63/63 public tables have RLS and FORCE RLS |
| Phase 1E probe SSRF guard | `tests/unit/operations-address.test.ts`, `tests/unit/operations-guarded-lookup.test.ts` | Pass - 13 tests. A public hostname resolving to a private address is refused at connect time via undici `connect.lookup`, so the checked address is the connected address. Covers loopback/private/CGNAT/link-local/metadata/reserved in both families, IPv4-mapped forms in dotted **and hex** spelling (`::ffff:7f00:1` was a live bypass in the first implementation), octal/hex/decimal-integer encodings, zone indices, and the public boundary addresses just outside each range |
| Phase 1E monitoring truth | `production_monitors_enabled_requires_connection`; provider registry; probe target validation | Pass - an unconnected monitor cannot be enabled; private/loopback/metadata targets are refused; no response body is read |
| Phase 1E execution boundary | `autonomous_release_allowed`; `PHASE_1E_ROLLBACK_EXECUTOR_CONNECTED`; `PHASE_1E_REPAIR_WORKER_CONNECTED` | Pass - release authority returns false unconditionally with `EXECUTOR_NOT_CONNECTED`; no rollback, deployment, merge, or repair is executed |
| Phase 1E synthetic journeys | Database CHECK constraints plus `tests/unit/operations-journey.test.ts` and the behavioral suite | Pass - destructive paths, undeclared writes, and uncovered profiles are refused by constraint; execution stops at the first failure; declared writes are recorded as skipped and never issued |
| Phase 1E live production observation | `AI/PRODUCTION_OBSERVATION_EVIDENCE.md` — shipped probe against `https://www.theagoras.com` | Pass - 4/4 routes observed at 200 within threshold (190-933 ms). Observations are **not stored**: migrations `028`-`030` are unhosted. |
| Phase 1E external observability of the recorded deployment | Same evidence file | **Blocked** - both `*.vercel.app` hosts return `302` to Vercel SSO for every route, so no external monitor can observe them. Owner decision required. |
| Phase 1E hosted state | Schema effects present; ledger reconciled | `028`/`130002` objects and ledger rows exist; no production target or journey has been observed |
| Phase 1E release | Merge commit `b243e1ddf9ce8155c4440c56d7b846ccc3d74ce0` on `main`; CI run [`31731632715`](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/31731632715) | Pass - both jobs green: lint/typecheck/tests/build, and browser/accessibility. Vercel Preview for the merged head deployed READY before the merge. |
| `/solutions` routing | `npm run lint`, `npm run typecheck`, `vitest run`, `npm run build`, Playwright; plus live checks against `https://www.theagoras.com` | Pass - lint/typecheck; 83 files/824 tests; build lists twelve `/solutions` routes; Playwright 117/117 with axe on each moved page. Live: all twelve pages `200` with both landmarks and the shell offset, every former path `308` to its new home, `/solutions` `noindex` and disallowed |
| `/solutions` routing contract | `tests/integration/console-routing.contract.test.ts` | Pass - 5 tests: no stray `app/(console)` group, a redirect for every console route, `/solutions` disallowed, no sitemap entry contradicting robots, a title on every console page. The sitemap assertion was mutation-checked |
| Scope/implementation | Auth/onboarding; signed-out fetch suppression; active-tenant GitHub boundaries; safe projections; stable repository UUID; protected approval/token/lease integrity; lifecycle/order/recovery; dual-App handoff; migrations `011`-`027` | Application/schema hosted; candidate owner path passes; remaining acceptance pending |
| Historical Phase 1B cutover-tree lint/typecheck/Vitest/build | `npm run check` plus main CI at the cutover release | Retained historical pass - lint/typecheck; 56 files/436 tests; 38 routes; CI `31716263910` green. Not current-update evidence. |
| Dual-App replacement boundary | Isolated candidate config; state binds App slot/ID; token routing uses persisted installation App ID; webhook verifies signing App provenance | Deployed and live for candidate installation `153479019` |
| Migration `027` atomic handoff | Immutable exact-tuple owner RED approval/execution; same account/external repository; both installations live; post-sync processed signed target delivery; cross-App/pending-change serialization; preserved history; bounded reverse | Hosted and live handoff passed |
| Hosted handoff database audit | Candidate sync `2026-08-13T15:26:56Z`; earliest qualifying delivery `2026-08-13T15:27:38Z` with exact App ID; immutable RED same-owner approval/execution succeeded; three request/approved/completed events; append-only triggers enabled; old installation/repository retained | Pass - project/link rebound to candidate while four completed change requests and five prior activity rows remain |
| Verified application-release integration suite | `npm run test:integration` | Pass - 21 files/163 tests; focused `026` grant test passes separately |
| Current-tree coverage | `npm run test:coverage` | Pass - statements 75.06%, branches 69.97%, functions 72.60%, lines 76.66% |
| Migration `026` | Narrowed exact table grants; function grants unchanged | Retained pass locally and hosted; pre-`027` history matched, dry run/lint clean, ACL mismatch count zero |
| Current-tree production build | `npm run check` | Pass - compiled 38 routes on Node 22.23.1; `/` is dynamic |
| Signed-out dashboard regression | Focused browser-error race repeated locally and against production | Retained pass - 30/30 production runs; current exact-commit CI is green |
| E2E/responsive/accessibility | Exact-main production Playwright plus CI browser job | Pass - production 48/48 desktop/tablet/mobile including axe; CI `31716263910` green |
| Secret/client boundary | Prior full source/rebuilt-static scan plus current CI secret-boundary contracts and production 20-asset marker scan | Pass - no secret/helper committed; 20 deployed JavaScript assets clean |
| Hosted Supabase identity | Exact project `qpuofpmagrmyamahqwxw`, ledger current through `130014`; earlier wrong/unauthorized CLI profile was not used for mutation | Reconciled history, linked lint, focused runtime/catalog/ACL, and hosted autonomy resolver checks pass; reconfirm identity before any future linked command |
| Hosted migrations | Catalog-proven `028`/`130001`-`130005` repaired history-only; forward migrations `130006`-`130014` applied without reset, down-migration, or DDL replay | Hosted through `130014` |
| Hosted database identity/lint | Exact `qpuofpmagrmyamahqwxw`; 5 linked lint errors across 10 findings | Blocked pending remediation and remeasurement |
| Hosted RLS/catalog/browser grants | Post-`027`: 25/25 RLS+FORCE, 34 policies, zero policyless; narrow owner-read/no-browser-mutation grants on both handoff-evidence tables; 22 secret guards and raw browser denials retained | Pass |
| Hosted service-role table grants | Verified pre-`027`: SELECT/INSERT/UPDATE on four GitHub ingress tables; no table privileges on other 19; `027` revokes direct access on its new evidence tables | Pass baseline; live `027` path uses narrow RPCs |
| Safe browser projections | Base-table SELECT revoked for five sensitive domains; bounded caller-member RPCs; allowlisted activity evidence | Hosted; owner Activity caller path passes; live second-tenant matrix pending |
| Stable repository authorization | Project connection/change/webhook attribution follows tenant-scoped repository UUID, not mutable name | Hosted via `021`; live rename/same-name acceptance pending |
| Protected-resource writes | Exact active-owner RED approval is immutable, path/digest/SHA/branch-bound, and draft-only; no local HTTP writer | Live protected draft PR `#7` and immutable approval/provider evidence pass; live expiry/admin-denial matrix pending |
| Draft-commit attribution | Deployed boundary strictly validates one server-only deployment identity before authorization/persistence and supplies it as both Contents API author and committer; no App-bot fallback or browser/database/log path | Pass - draft commits `e789303`, `6a808de`, and candidate-backed `204ed79e` verify both fields as `surgeservicesllc <surgeservicesllc@gmail.com>` |
| Idempotency/recovery | Same browser intent retains key; exact-binding reservation; five-minute pre-provider lease; existing draft-PR evidence recovery | Application plus migrations `015`/`017`/`022` hosted; live acceptance pending |
| Lifecycle safety | Provider-time installation/repository ordering; terminal deletion; explicit newer restore remains unselected | Hosted via migrations `016`/`018`; live acceptance pending |
| Service-role CHECK boundary | Only sensitive-JSON SECURITY DEFINER wrapper granted for provider-ingress constraints | Hosted via `019`; real provider-ingress insert/rejection acceptance pending |
| Browser/request hardening | Command same-origin enforcement; restrictive CSP/security headers; external Markdown images suppressed | Build and public production checks pass; authenticated verification pending |
| Projects provider detail | Sync freshness, branch protection/SHA, commit and PR timestamps/authors, mergeability, default-branch and per-PR head-SHA checks | Pass against the live selected repository |
| GitHub App configuration | Primary App `4573846`; candidate App `4582606` (`surge-softwarefactory-next`) owner-only with retained exact callback/active webhook; distinct candidate variable names Sensitive in Production/Preview; commit identity configured | Candidate is live; primary remains active rollback with impaired webhook |
| Supabase Auth owner | `surgeservicesllc@gmail.com` confirmed/authenticated; SoftwareFactory org/workspace owner onboarding succeeded | Pass for onboarding |
| GitHub provider installations | Candidate `153479019` is live for exactly `surgeservicesllc/SoftwareFactory`; primary `153445938` remains active for rollback | Pass for candidate; rollback retained |
| GitHub real connection | Candidate connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`; project `b1f23696-437e-4d89-b55f-d7a949980e8f`; callback/sync/handoff/read/write/audit journey observed | Connected for the owner repository path |
| GitHub webhook | Candidate-signed deliveries for installation `153479019` process with exact App-ID provenance after sync and stream push/check Activity. Primary App `4573846` remains blank/inactive under OPEN Support ticket [#4660724](https://support.github.com/ticket/personal/0/4660724). | Candidate Connected; primary webhook impaired |
| Local credential cleanup | Temporary downloaded App PEM and ignored provider-verification helper scripts deleted after use; no credential/helper artifact persisted | Pass |
| Project/repository and file-to-draft-PR flow | Candidate-backed branches/commits/checks/PRs/tree/file reads; ordinary draft `#6`; protected RED draft `#7`; candidate acceptance draft `#8`; likely-secret rejection; immutable Activity evidence | Pass for accepted owner scenarios; remaining adverse matrix pending |
| Acceptance cleanup | Prior PRs `#4`/`#5` and candidate acceptance PR `#8` were closed unmerged with isolated branches deleted; PR `#8` passed CI `31716958685` and Vercel Preview; `main` unchanged by acceptance writes | Pass |
| Git provenance for application release | Commit `799d2cea189b6860a03987ae75c25765f9ac4aca`, tree `a7731dc5626f1d014a446e94e989a1ac3f4f72a1`, author/committer `surgeservicesllc <surgeservicesllc@gmail.com>`; CI run `31716263910`, both jobs green | Pass; docs-only successors retain this evidence unless application code changes |
| Vercel production | `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ`; `https://softwarefactory-7kfx3u1ey-surgeservices-projects.vercel.app`; stable alias; source exact main commit `799d2cea189b6860a03987ae75c25765f9ac4aca` | READY; production Playwright 48/48; 13/13 public routes `200`; invalid webhook `401` private/no-store; 30-minute logs clean; 20 JavaScript assets clean |
| OpenAI/Codex | Published worker claimed one real run and emitted a transient heartbeat/provider thread, then failed before repository mutation. No-claim diagnostic `31748582858` passed exact-model lookup and returned `credit_balance_exhausted`; no successful run or draft PR exists. | **Not Connected** |
| Anthropic/Claude | Advisory adapter source exists; no hosted schema, verified credential, enabled switch, or live run | **Not Connected** |
| Automation safety | No merge/deploy/rollback executor; controls OFF | Pass |
| Phase 1D observation scaffold | Intended OFF/kill-ON policy; current raw/effective rows have measured drift | Execution remains blocked because no connected/fresh worker or executor exists; control remediation required |

## Phase 2A and Phase 1C reconciliation evidence

| Area | Current evidence | Status |
| --- | --- | --- |
| Command/orchestration | Connected-project-only intent; command type/criteria; stable idempotency; exact base SHA; fixed provider/model/role/budgets/workflow; independent SQL risk/config enforcement | Published and hosted; first live command persisted and was claimed safely |
| Phase 2A advisory providers | Official Anthropic/OpenAI adapters; consent-gated health/model discovery; deterministic routing; bounded fallback; independent review; advisory artifacts only | Published on `main`; `130001` hosted and ledger-reconciled. Execution OFF returns local Disabled status, suppresses outbound discovery/probes, and no successful live advisory run exists; **Not Connected** |
| RED ceiling | SQL and worker exclude RED; owner approval does not widen Phase 1C | Published and hosted; all autonomy controls remain OFF |
| Durable schema | Existing hosted chain plus `20260821000300`; immutable Factory routing `20260821000400` remains local | Production has `210003` and the old copy; `210004` fails closed until hosted. Linked lint is currently 5 errors/10 findings |
| Logical agent identity | Eleven standard logical roles for existing/future organizations; provider-account identity remains separate; general Phase 1C work maps to Orchestrator | Implemented and hosted in `130010`; authenticated production owner reads prove all eleven roles. No successful provider run exists. |
| Dependency and budget integrity | Canonical same-project pre-existing dependencies, atomic/idempotent persistence, derived criteria, total turn/input/output budgets across retries | Implemented and hosted in `130011`; focused hosted runtime/catalog checks pass. Live retry/provider acceptance remains pending. |
| Recovery/report integrity | Coherent artifact replay, draft projection, bounded retry/resume, stale-lease/cancel terminalization, structured success/failure/cancellation reports | Implemented and hosted in `130010`/`130011`; authenticated owner failure-detail/report reads pass. Live branch/PR recovery success remains pending. |
| Bounded routing evidence, model-contract restoration, scalar-secret rejection, and raw-read closure | Local `130015` restores assignment/run model checks from 120 to 128 characters, adds four no-secret constraints covering catalogue model/display-name, assignment model, and routing policy-version/selected-model text, adds capped/allowlisted Phase 1C/2A routing detail with absent/null rolling compatibility, revokes authenticated raw routing-decision/event SELECT, and retains tenant-scoped model-catalogue SELECT. Runtime/API validation rejects credential-shaped default-model/model/display-name scalars before serialization/RPC. | Local implementation and final gates pass. Hosted remains through `130014`; fresh exact RED approval and exact six-constraint/valid-and-negative-scalar/table-function-ACL/direct-denial/runtime/RLS/lint/health verification are required. |
| RLS/ACL | New tables declare RLS/FORCE RLS; browser table grants revoked; bounded member RPCs and service-role-only worker RPCs | Hosted catalog/function-identity/ACL and focused runtime checks pass; authenticated owner projections and anonymous denial for twelve hosted read RPCs are live-proven. Unrelated-authenticated and mutation-shaped live denial remain pending because hosted membership currently has only the owner. |
| Codex integration | Pinned `@openai/codex-sdk` `0.147.0`; isolated home; bounded turns/tokens/time; workspace-write/no approval/no workspace network/web search | Published; first real provider startup failed safely before repository work |
| Workspace/GitHub | Repository-ID token; exact base-SHA check; isolated `factory/*` branch; required commit identity; draft-PR-only publisher; exact-head CI polling | Implemented/tested locally; no live Phase 1C artifact |
| Validation sandbox | Exact pinned Node image; restricted bootstrap; network-none diff/lint/typecheck/test/build; process/resource/output limits | Implemented/tested locally; live runner proof pending |
| Policy scan | Path containment; forbidden/symlink/binary/secret/protected/file-count/size limits | Implemented/tested locally |
| Durable worker workflow | Opaque command dispatch, five-minute recovery, distinct `softwarefactory_phase1c_preflight` diagnostic dispatch, no branch-selectable manual trigger, read-only workflow token, no persisted checkout credentials | Published at `bc95b9e3a5952864bd26da778a052f37400ea747`; first claim failed safely, and diagnostic `31748582858` skipped Docker preload and claim. |
| Recovery preflight patch | Pinned CLI `0.147.0` plus non-billable exact-model lookup before every claim; distinct `softwarefactory_phase1c_preflight` bounded non-stored response that skips Docker preload/claim; structured terminal-error preservation | Published and exercised. Exact-model GET passed; bounded Responses returned the safe code `credit_balance_exhausted`. CI run `31748567790` and READY Vercel deployment `dpl_3hTUZ1aJy2b2BSdhTZMnZRMfxnhh` verify the exact recovery commit. |
| Safe UI/APIs | Worker status, agent/task/run/report detail, timelines/artifacts/validation, cancel, retry, responsive real-data consoles | Hosted authenticated owner reads pass across Bot Manager, Runs/detail, Backlog/detail, all-eleven-role Agents/detail, Reports/detail, and Connections. Signed-out UI and anonymous read-RPC denial pass; unrelated-authenticated and mutation-shaped live denial remain pending. Current routing UI local final gates pass; publication remains pending. |
| Consolidated lint/typecheck/tests/build | Frozen current-update local candidate | Pass on Node `24.19.0`: lint, typecheck, 118 files/1,311 tests, and production build with 74/74 route entries. Publication CI remains pending. |
| Consolidated coverage | Frozen current-update local candidate | Pass - 76.70% statements / 71.47% branches / 74.04% functions / 78.11% lines |
| Focused migration suites | Hosted chain through `130014` plus local `130015` | Pass - provider and Phase 1C integration 55/55; hosted `130015` verification remains pending fresh exact RED approval |
| Secret/tracked-file/client scan | Frozen current-update source | Pass - 0 high-confidence credential values in the changed tree; the user-pasted credential remains excluded and treated as compromised |
| Responsive/E2E/axe | Frozen current-update production build across desktop/tablet/mobile | Pass - 117/117 |
| Production dependency audit | Frozen current-update `npm audit --omit=dev` | Pass - 0 vulnerabilities |
| Disabled worker smoke | Prior verified baseline worker disabled/incomplete configuration | Prior evidence passed safely; current-update smoke remains pending |
| Diff and independent severity audit | Frozen current update | Pass - clean diff-check and independent frozen-tree review found no remaining P0/P1 source blocker |
| Hosted migrations | Exact project `qpuofpmagrmyamahqwxw` | `20260821000300` hosted; `20260821000400` unhosted. Current lint/control blockers prevent a release-ready claim |
| GitHub Actions secrets | Six non-OpenAI names currently present; OpenAI absent | The user-pasted OpenAI key is treated as compromised and `SOFTWAREFACTORY_OPENAI_API_KEY` is deleted. It must remain absent until a fresh funded replacement is available; configuration alone is not connectivity. |
| Worker activation gate | Repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` | Enabled only for the approved first claim, then removed; currently absent/OFF |
| Required CI checks | `SOFTWAREFACTORY_REQUIRED_CHECKS` exact names for both CI jobs; complete stable set; required conclusions `success`; PR base/head recheck | Implemented locally; live proof pending |
| Worker heartbeat | Fresh service-role worker registration/heartbeat | Observed transiently during Actions run `31746057998`; provider failure prevents a Connected claim and the heartbeat ages to stale |
| Live Codex acceptance | Real command/thread/branch/commit/draft PR/validation/exact-head CI/report/audit | Command `0c4d0ca8-1867-4d00-80cf-476401491a17` / run `f4594556-6f72-4763-a480-6993939e3651` failed safely before branch/commit/PR. Diagnostic `31748582858` identified exhausted credits without a claim. The failed run is now stale against current `main`; acceptance requires a new command after funded-provider proof. |
| Autonomous safety | Kill switch ON; Autonomous Mode and auto approve/merge/deploy/rollback OFF | Pass by design; hosted `010` retained |
| Commit identity | `surgeservicesllc <surgeservicesllc@gmail.com>` required for author/committer | Enforced in worker/workflow; live Phase 1C proof pending |

## Retained Phase 1B live evidence

- Candidate App `4582606`, installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, project `b1f23696-437e-4d89-b55f-d7a949980e8f`, signed webhook, handoff, reads, and prior draft-only write acceptance pass for exactly `surgeservicesllc/SoftwareFactory`.
- Primary installation `153445938` remains rollback; its webhook defect remains tracked by GitHub Support `#4660724`.
- The prior verified production baseline before this update was `0c662a24393f682073e6002c5aff9339292226d8`; it passed both required jobs in CI run `31749352644`, and matching Vercel deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7` was READY. Neither publication nor the no-claim diagnostic makes Codex Connected.
- Phase 1B still lacks a live second tenant, reverse handoff, disconnect/loss, and remaining adverse provider matrix.

## Phase 1C release acceptance required

1. Preserve the prior verified production baseline before this update: commit `0c662a24393f682073e6002c5aff9339292226d8`, CI run `31749352644`, and READY deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7`.
2. Complete and record all current-update final gates, publication CI, and deployment; do not reuse prior counts.
3. Obtain fresh exact RED approval for the complete `130015`, apply only that forward migration, and verify its two 120-to-128 constraint restorations, all four new no-secret constraints, 128-character assignment/run/project behavior, valid and negative credential-shaped catalogue/assignment/routing scalar behavior, two raw-SELECT revokes plus retained model-catalogue SELECT, run-detail identity/security/ACL, bounded routing behavior, raw-table/tenant denial, lint, and health.
4. Revoke the user-pasted OpenAI key at the provider. Keep its repository secret absent and activation OFF while adding project credits or obtaining a fresh funded replacement project key.
5. Configure only the fresh funded replacement key through the protected secret path, then dispatch only `softwarefactory_phase1c_preflight`; require pinned CLI `0.147.0`, exact-model access, and one bounded non-stored response while Docker preload and durable claim remain skipped. Return activation to absent/OFF after admission and stop on failure or ambiguity.
6. After the diagnostic passes, leave stale run `f4594556-6f72-4763-a480-6993939e3651` untouched, submit a new current-base GREEN command, and restore activation absent/OFF immediately after claim.
7. Preserve durable repository/base SHA, neutral logical agent, routing reasons, lease, recovery state, timeline, validation, artifacts, changed paths, usage, factory branch/commit/open draft PR, stable exact-head CI, structured report, activity, cancellation state, and final-result evidence.
8. Prove no default-branch write, PR approval/merge, deployment, rollback, RED execution, workflow/provider-setting change, or secret disclosure occurred, and complete the remaining unrelated-authenticated/mutation-denial matrix.

## Phase 2E portfolio scheduling evidence, 2026-08-15

| Check | Result |
|---|---|
| Unit and integration tests | 2360 passed, 0 failed, 2 skipped |
| Playwright, desktop + tablet + mobile with axe | 132 passed, 3 skipped |
| Lint | 0 errors, 3 warnings (all pre-existing, in test files) |
| Typecheck | clean |
| Production build | succeeds |
| Migration chain on PGlite from empty | 70 applied in order |
| Tables under RLS + FORCE RLS | 104 of 104 |
| `service_role` table privileges | still exactly the four GitHub ingress tables |

The five required canaries run in `tests/integration/phase2e-portfolio-scheduling.behavior.test.ts`,
each against two competing projects in one organization, and each asserting on the run a worker
actually claimed through `claim_phase1c_run` rather than on a projection:

| Canary | What it proves |
|---|---|
| A — competing projects | Beta queued first, Alpha (P1) claimed first, Beta claimed on release |
| B — P0 | Ceiling 1 with 1 reserved: routine work withheld, an incident-linked repair claimed at effective P0, the routine run still `queued` afterwards |
| C — capacity | Project ceiling 1 with worker capacity 2: excess withheld with `projectActive: 1, projectLimit: 1`, claimed after release |
| D — failure | Three outages open a breaker, work withheld naming it, another provider's breaker does not interfere, cooldown admits one trial, the trial consumes the window, success reopens |
| E — reprioritize | Focus set and cleared in one statement, next claim follows it, the running run keeps its lease token, one activity event |

**What this evidence does not cover.** PGlite is a single connection, so every claim above is
sequential. These prove ordering, ceilings, release and recovery; they do not prove behaviour
under simultaneous contention, which rests on the `for update ... skip locked` the claim has used
since Phase 1C and which these changes did not alter. Nothing here is hosted: 29 migrations remain
unapplied to hosted Supabase.

## Release-blocking invariants

- Configuration, source code, a queued row, a mocked SDK result, or a GitHub Actions file never counts as Connected.
- A clean idle one-shot heartbeat is briefly Available/Connected while fresh; stale, explicitly disabled, or missing heartbeat state is **Not Connected**. Idle availability is not end-to-end run proof.
- Missing or inconclusive validation/CI is failure, not success.
- RED, protected-without-exact-approval, secret-bearing, stale-base, cross-tenant, lease-mismatched, or oversized work must fail closed.
- Any browser exposure of raw command/model/provider errors, service credentials, raw audit details, or broad worker tables is a failure.
- Any default-branch write, non-draft PR, approval, merge, deploy, rollback, workflow/provider administration, or Autonomous Mode widening is a failure.
- A code/schema/provider/deployment change invalidates affected evidence and requires rerunning it.

## Step 8 current-production diagnosis (2026-08-28)

| Check | Evidence | Status |
| --- | --- | --- |
| Stale client result lifecycle | Current error retained across ordinary rerenders; project/context change and remount clear it; retry reuses the original idempotency key | Pass locally and released |
| Schema-skew response | Exact legacy `22023` command-plan/configuration refusals become bounded actionable `503`; no worker dispatch occurs | Pass locally and released |
| Exact production traffic | Authenticated GETs reached exact `bb68659`; zero `POST /api/commands`; no command-route 4xx/5xx | Confirms screenshot was stale mounted state, not a current server refusal |
| Current tenant route | Fresh Chrome as `daniel.hughen@gmail.com`: zero connected AI accounts, ready bots, or assignments; one unfinished Codex account; Claude OAuth incomplete | Provider OAuth and route setup pending |
| Steps 8-9 acceptance | Fresh signed-in POST, immutable route evidence, reload-persisted Step 9 correlation | Not yet claimed |

## Ten-step Factory v2 production scorecard (2026-08-28)

| Gate | Evidence | Status |
| --- | --- | --- |
| Release identity | Exact `main` `bb68659a0ee84370f83dd647ae57f4ccb83ea06c` | Pass |
| Requirements -> Monitor lifecycle | Exact repository/base/policy identity, explicit gates, durable command/PR/CI/deployment/monitor lineage, exact graph/run UI selection | Implemented and locally audited |
| Focused verification | 18 files / 207 tests; lint, typecheck, production build, and diff-check green | Pass locally |
| Protocol fence migration | `20260827000150`, LF-normalized SHA-256 `A4B505841D94CC89DFC82E24837DEDB78356B56C5F5698C0748F8B6735341A49`; run `33144600401` | Hosted once; ledger/fence/drain/safety postflight pass |
| Containment probe | Run `33150619218`; 4 rows; manifest `784acaca2b0957ecb0eeea85e3d0dde2e64ba653c744e708ec8d4094f9175b99`; blockers `0|0|0|0` | Pass; payload/row IDs not logged |
| Forward containment | Run `33150654596`; exact `20260827000210` only | Pass hosted with full postflight |
| Phase 1C release-lineage migration | Run `33150707932`; unchanged `20260827000200`, LF-normalized SHA-256 `23197552DF3F442AE8264BF71BD28A7C479E09A64BF6E298C615B767A96572BE` | Pass hosted with full postflight |
| Publication | Exact `main` `bb68659a0ee84370f83dd647ae57f4ccb83ea06c`; CI `33149814278` four jobs green; Vercel `dpl_2A2bhtevZeBY6422ZYjVGJE5SuTU` / deployment `6137077047` READY behind `www.theagoras.com` | Pass |
| Current Step 8/9 production acceptance | Current bundle loads signed in; tenant has no connected account/ready bot/assignment and provider OAuth is incomplete | Pending route setup; not falsely claimed |
| Safety envelope | Worker, provider execution, autonomy, and all automatic actions OFF; global kill switch ON | Preserved |

## 2026-08-28 exact release, protocol fence, and artifact containment

| Gate | Evidence | Status |
| --- | --- | --- |
| Exact production | `bb68659a0ee84370f83dd647ae57f4ccb83ea06c`; CI `33149814278` four required jobs green; Vercel `dpl_2A2bhtevZeBY6422ZYjVGJE5SuTU` / deployment `6137077047` READY behind `www.theagoras.com` | Pass |
| Hosted apply attempt | `33143231202` queued with zero jobs/checks; 517,320-byte workflow exceeded 500 KB; no DDL ran | Safely not started |
| Workflow recovery | 472,229-byte released workflow; executable lines unchanged; UTF-8 size contract `< 490,000` | Pass on exact release |
| Legacy authority fence | Run `33144600401` applied only `00150`; exact ledger/function ACL/drain/safety postflight; graph/Phase 1C running rows `0|0` | Pass hosted; never replay |
| Lineage apply | Run `33144659265`; exact `00200` stopped on `legacy graph artifact payload is sensitive or oversized` | Failed closed; single transaction rolled back all DDL and ledger insert |
| Payload-free probe | Run `33150619218`: four rows; manifest `784acaca2b0957ecb0eeea85e3d0dde2e64ba653c744e708ec8d4094f9175b99`; blockers `0|0|0|0` | Pass |
| Forward containment migration | Run `33150654596` applied only `20260827000210`, SHA-256 `c37a55efe74e9a9b4118924e1b2cbd0378a76f0d98c9747c6c66fffda9697de1` | Pass hosted; ledger/catalog/constraints/RLS/ACL/audit/safety green |
| Release lineage completion | Run `33150707932` applied only unchanged hash-pinned `00200` after accepted `00210` | Pass hosted; ledger/catalog/RLS/ACL/audit/runtime/lint/health green |
| State-dependent legacy fence | Post-v2: 8 legacy signatures fully revoked; replacement `decide_node_gate(uuid,boolean,text)` authenticated-only, owner/admin-checked, `SECURITY DEFINER`, pinned search path, and evidence-bound | Pass hosted |
| Fresh Step 8 request | Exact deployment: authenticated GETs, zero `POST /api/commands`, no command-route 4xx/5xx; fresh signed-in tenant has no connected account/ready bot/assignment | Pending provider OAuth and route setup; not accepted |
| Safety envelope | Workers/provider execution/autonomy/automatic actions OFF; global kill switch ON; no running graph or Phase 1C run | Pass hosted |
