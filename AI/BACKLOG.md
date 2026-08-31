# Backlog

## Grok runtime 018-021 next-only release chain (ADR-241, 2026-08-31)

- [x] Freeze the four committed canonical-LF identities and explicitly reject
  the stale proposed 018 digest that does not identify the committed blob.
- [x] Add one actor/attempt/confirmation-gated manual lane that derives only
  the next absent migration from the exact 018 -> 019 -> 020 -> 021 prefix;
  permit no migration selector, replay, down, reset, repair, or broad push.
- [x] Pin exact main/green-CI/READY-Vercel/health/Supabase identity, immutable
  unrelated-ledger history, stopped workflows/runtime, worker/schedule/auth/
  autonomy/automatic-action OFF state, and the global kill switch ON before
  mutation and after every operation.
- [x] Preserve the unchanged dedicated 019 preflight and native postflight and
  add chain-wide catalog/function/ACL/RLS/audit/runtime/lint verification with
  one-file transactional rehearsal/apply and zero residue.
- [x] Cover every intermediate prefix plus gap, digest, later-version, catalog,
  and runtime failure contracts in static and native PGlite tests.
- [ ] Publish one exact reviewed main SHA, require its complete CI and exact
  READY deployment identity, then use fresh manual probe/apply-one cycles for
  018, 019, 020, and 021 followed by verify. No hosted operation or production
  acceptance is claimed by this repository candidate.

## Grok initial Resume durable wake receipt (ADR-239, 2026-08-31)

- [x] Create one append-only wake intent in the exact owner Resume transaction,
  with tenant/session/graph/control revision identity and content-free audit.
- [x] Record GitHub dispatch acceptance/failure separately and never translate
  HTTP acceptance into `workerWoken`.
- [x] Require the exact target graph claim to receipt worker identity,
  protocol/capability version, and immutable timestamps before provider work;
  fail closed on missing, stale, wrong, or conflicting replay identity.
- [x] Project dispatch versus receipt truth through API, reload, and the Grok
  Progress inspector; cover the service boundaries, SQL contract, and native
  PGlite behavior.
- [ ] Integrate and release migration 021 only through a separately reviewed
  forward production lane. No hosted apply or live worker acceptance is
  claimed by this repository candidate.

## Exact graph target workspaces (ADR-238, 2026-08-31)

- [x] Resolve one dispatched graph to its current active installation,
  repository, required-check policy, base branch, and immutable base SHA
  through a bounded service-role-only database function.
- [x] Revalidate the complete target inside protocol-v4 claim and record exact
  repository identity on new read-only research graphs before visibility.
- [x] Request an exact-repository read-only installation token and expose only
  a verified, no-hooks, detached, read-only target tree to Claude; clean it on
  success or failure and never run target code.
- [x] Make graph schedule/global drain inert without an equally exact target;
  remove ambient checkout/repository/check-policy targeting from production.
- [x] Cover ACL/catalog/runtime behavior, wrong repository/SHA/installation,
  moved-branch pinned-SHA reachability, cleanup, and zero provider callback on
  workspace failure in unit, contract, and full-chain PGlite tests.
- [ ] Publish, apply, and accept migration 020 plus the exact worker release
  only through a separately reviewed forward release. No hosted or live
  execution evidence is claimed by this repository candidate.
## Grok causal production acceptance (ADR-240, 2026-08-31)

- [x] Add a manual two-phase lane whose start phase creates a new unique
  docs-only Grok goal, explicitly Resumes once, and requires immutable plan,
  roster, context, exact repository base/check policy, durable dispatch and
  first worker receipt, real Claude nodes/artifacts, exact Phase 1C Codex run,
  one-file draft PR, and all four exact-head checks.
- [x] Seal a strict secret-free start artifact and require its exact workflow
  run ID plus owner-supplied SHA-256 for every finish-phase read.
- [x] Make finish prove the same session/run-chain/bridge/PR through exact merge,
  READY deployment and health lineage, five-stage passing validation, terminal
  artifacts, and a signed-in read-only reload.
- [x] Add static workflow, SQL, evidence-schema, and opt-in Playwright
  contracts; disable screenshot, video, and trace capture.
- [ ] Provision dedicated protected repository secrets named
  `GROK_CAUSAL_PRODUCTION_EMAIL` and `GROK_CAUSAL_PRODUCTION_PASSWORD` for an
  owner of the exact acceptance project. Neither secret exists yet; do not
  repurpose another account or credential. A user's signed-in local browser may
  provide supplemental evidence but cannot replace the reproducible hosted
  account identity.
- [ ] Publish only after migrations 020 and 021 are integrated, all repository
  gates pass, and the candidate reaches exact READY production. Then run start
  and finish only under separate owner-controlled worker/gate/merge actions.
  No live run, provider proof, merge, deployment, or hosted mutation is claimed
  by this repository candidate.

## Grok admission-version null-fence release lane (ADR-237, 2026-08-31)

- [x] Freeze canonical-LF migration 019 at SHA-256
  `a0dd4da859e5ed6cb65342f2e5b3962c07d672346bd06685052c6446e99c5221`
  and 8,404 bytes, with one-file manual probe/apply/verify staging.
- [x] Pin exact ledger lineage, unrelated-history digest, old/new function
  source/ABI/security/search-path/ACL posture, linked lint, production identity,
  health, and stopped-safety gates before and after the operation.
- [x] Prove native null/missing/wrong roster, full-lifecycle-v4, and research-v2
  rejection before writes, zero residue, valid/replay behavior, and corrected
  route response labels for the callable v2/v4 boundary.
- [ ] Publish and run probe/apply/verify only as a separately reviewed
  production release. No hosted operation or production acceptance is claimed.

## Close-out triage (2026-08-31, owner /goal: complete the backlog, 100% production ready)

Every box below this section is either checked or parked, and every parked
box's own text names what unparks it. Read this section as the index; the
rows are the record. As of this triage the file holds 117 open boxes, all
 of them parked, in exactly five families:

1. **Owner credentials or accounts** — an external account or key nobody
   has opened or supplied: the eight CRM provider rows (SMS, email,
   card/ACH, GPS, accounting sync, telephony, reviews, mapping/geocoding),
   RESEND_API_KEY/CRON_SECRET/JOB_ALERT_EMAIL_FROM, JSEARCH_RAPIDAPI_KEY,
   LinkedIn OAuth, USAJOBS/Adzuna/Jooble keys, SUPER_ADMIN_EMAILS,
   `SOFTWAREFACTORY_CODEX_AUTH_JSON`, a Vercel token, an AI provider for
   copilot drafting. Each ships **Not Connected** and its row says which
   secret lights it up.
2. **Owner decisions** — a person must choose, not build: branch
   protection and signatures on `main`, the `theagoras.com` aliases,
   Vercel Deployment Protection, marketing-site indexing, usage-row
   retention, the Phase 2A per-token-cost conflict, confirming the
   owner's Supabase email, pressing Clear on their own projects,
   confirming pages match their design images.
3. **RED / separately-authorized actions** — `policies/RISK_CLASSIFICATION.md`
   and AGENTS.md forbid these without an explicit owner authorization
   naming action, target, evidence and rollback: unattended recurring
   billing, auto-merge, deploy/rollback execution, enabling any automatic
   action, the Grok 009/010 protected apply chain, the 00150/00200/00300
   legacy chain, the 17-version ledger reconciliation, `130015`,
   `20260821000400`, production canaries, the job-seeker grant
   contraction (parked one deploy behind its own shipped code).
4. **Live-production observation** — evidence only production can mint:
   real heartbeats, live provider runs, signed-in acceptance on deployed
   hosts, webhook defect `#4660724`, monitor targets. Recorded so the
   next session verifies rather than re-derives.
5. **Design follow-ons recorded as future work** — capabilities whose
   ungated half already shipped and whose remainder names its gate on the
   row: route optimisation behind geocoding, WDO diagram drawing surface,
   the learning edge (ADR'd), budget month-plan panel, transfer linking,
   reconciliation surfacing, ledger editing, phase 2 worker cases.

What the close-out itself completed is recorded on the rows it closed —
increments 24-27 (ADR-220..223), the copilot + acceptance journey and the
scoped **PEST CRM: PRODUCTION READY** declaration (ADR-224), the
57-suite snapshot conversion and the apply-workflow extraction, the
probe-verified hosted ledger through `20260831001400`, and the
category/insert-chain/notice truthfulness fixes. Nothing in this file is
open because work stopped; everything open is waiting on a named key, a
named decision, a named authorization, or production itself.

## Grok 015/017 protected release lanes (ADR-234, 2026-08-31)

- [x] Add separate manual, shared-concurrency `probe` / `apply` / `verify`
  workflows for only the canonical-LF hash-pinned 015 context projection and
  017 read-only research migrations.
- [x] Require exact release/CI/READY/health/Supabase identity, configured
  first-attempt actor and confirmation, unchanged unrelated ledger, exact
  forward order through 016, native catalog/ACL fingerprints, linked lint, and
  stopped workers/autonomy/actions with kill switches ON.
- [x] Rehearse each target-version migration chain and its full rollback-only
  runtime/adverse postflight, proving replay, tenant and tamper refusal,
  content-free audit, paused read-only research, and zero execution residue.
- [ ] Publish and dispatch 015 then 017 only as separately reviewed production
  releases after their prerequisites are hosted. No hosted operation or
  production acceptance is claimed by this repository candidate.

## Grok Phase 1C exact graph re-wake (ADR-233, 2026-08-31)

- [x] Persist exactly one immutable-identity re-wake intent in the admitted
  Grok bridge transaction that records the Phase 1C pull request.
- [x] Lease and acknowledge through service-role-only functions with exact
  graph/project/repository/run/command/bridge identity, current admissions,
  fresh non-disabled worker checks, bounded retries, and append-only evidence.
- [x] Reuse the existing opaque graph-dispatch boundary immediately after a
  targeted Phase 1C worker run; keep its independent worker gate authoritative.
- [x] Add unit behavior, SQL/workflow contracts, full-chain migration coverage,
  and a hash-pinned one-file protected `probe` / `apply` / `verify` lane.
- [ ] Publish/apply/verify 016 only as a separately reviewed production
  release. The repository candidate has no hosted ledger or runtime evidence.

## Grok deploy-readiness projection (ADR-236, 2026-08-31)

- [x] Preserve the exact planner-v3 deploy request as immutable RED intent with
  its owner-gated HUMAN `delivery` handoff.
- [x] Derive only the four exact Claude MODEL inspection/fan-in tasks into a
  separate GREEN graph; remove delivery and every resource, write, lifecycle
  stage, gate, feedback edge, provider fallback, provider tool, run, wake, and
  dispatch path; pin the exact verifier schema hashes.
- [x] Add the service-role-only, null-safe forward migration
  `20260831001800_grok_deploy_readiness_runtime.sql` with exact message/plan/
  task/edge/budget/roster/admission/hash checks, source-plan hashing, immutable
  audit/link evidence, atomic pause, and idempotent current-admission replay.
- [x] Route deploy intent to the dedicated readiness boundary without release
  mutation identity resolution; prove focused TypeScript, route, contract,
  schema, and full-chain PGlite behavior.
- [ ] Integrate on exact main and create a separately reviewed protected 018
  release scope before any hosted apply. Require exact ledger/catalog/ACL/RLS/
  runtime/rollback/lint/health/stopped evidence and signed-in reload acceptance.
  Do not merge, deploy, wake workers, or present the readiness graph as observed
  production delivery.
## Grok context-envelope 011 protected release lane (ADR-232, 2026-08-31)

- [x] Pin the exact canonical-LF 011 migration path, SHA-256, Supabase project,
  release SHA, configured actor, operation-specific confirmation, CI, Vercel,
  and health identities.
- [x] Permit only one staged migration file plus the 011 ledger row in one
  forward transaction; prohibit reset, repair, replay, down, broad push, and
  workflow dispatch paths.
- [x] Snapshot every unrelated ledger row, require the 00100-01000 lineage, and
  reprove the snapshot after probe/apply/verify without assuming the valid
  later 01200-01400 rows are absent.
- [x] Add rollback-only catalog, RLS/policy/grant/trigger/function-hash/ACL,
  runtime/replay/audit, adverse-tenant/secret/bounds, immutability, linked-lint,
  health, and zero-execution evidence with stopped containment before/after.
- [x] Pass the full migrated-chain native rehearsal and 16/16 focused static
  safety tests; keep credentials out of source and logs.
- [ ] Publish or dispatch only as a separately reviewed production release.
  This repository candidate has not applied 011 and carries no hosted ledger,
  catalog, lint, runtime, or health acceptance evidence.

## Grok record-only production acceptance (ADR-229, 2026-08-31)

- [x] Add an env-gated signed-in Playwright journey for one exact RFC-reserved
  account, project, harmless BUILD goal, exact return URL, and reload.
- [x] Add read-only hosted preflight/postflight SQL proving planner-v3,
  complete roster/route admission, immutable events, paused graph, and zero
  graph/node/agent/provider/Phase 1C execution.
- [x] Add a manual, explicit-confirm, exact-release workflow with stopped-state
  checks, least privilege, no browser capture, and no execution control calls.
- [x] Add static workflow safety and action-pin tests; focused evidence is 8/8,
  with lint/typecheck and guarded Playwright discovery green.
- [ ] Publish and run only after the exact fake account/project and Ready Claude
  plus bounded Ready Codex prerequisites exist and the repository secret
  `GROK_RECORD_ONLY_E2E_PASSWORD` is configured. Exact-head CI, Vercel READY,
  health, and hosted 009/010 evidence remain mandatory; no current production
  acceptance is claimed.

## Grok advanced control navigation (ADR-231, 2026-08-31)

- [x] Keep advanced control complexity collapsed by default in the selected
  Grok session inspector.
- [x] Open the canonical lifecycle controls for the exact immutable run, where
  Approve / Reject appears on its actual open gate; withhold that link until
  exact run evidence exists.
- [x] Link Retry / Cancel, rollback, and automatic continuation to the existing
  audited Runs, Operations, and Autonomy consoles without adding a second
  mutation path or changing any safety state.
- [x] Prove exact destinations, no-run refusal copy, and the no-mutation
  boundary in the 22/22 focused workspace suite; affected lint/typecheck pass.
- [ ] Require exact-head CI, READY Vercel identity, health, and signed-in
  production navigation acceptance before calling this slice production
  accepted.

## Site-wide dark/light theme (ADR-225, 2026-08-31)

- [x] Make dark the deterministic first-visit default and restore only a valid
  explicit light choice before first paint.
- [x] Put one accessible, persistent theme toggle in every visual shell,
  including Factory, Services/Budget/portal shared chrome, customer portal,
  authentication/decision pages, and the offline surface.
- [x] Convert public marketing, console, Factory, Services, Budget, Job Search,
  and customer structural colors to semantic theme tokens while preserving
  intentional artwork, provider branding, data colors, scrims, destructive
  contrast, and printable white paper.
- [x] Verify dark/light persistence and palettes in desktop, tablet, and mobile
  browser projects; require no horizontal overflow, no page errors, no serious
  or critical axe findings, and >=4.5:1 palette-token text contrast.
- [x] Pass consolidated local lint, typecheck, 559 test files / 6,415 tests,
  the 276-page production build, and the 6/6 desktop/tablet/mobile theme journey.
- [ ] Require all four exact-head CI jobs, Vercel READY identity, matching
  health, and signed-out production theme acceptance before calling the change
  production accepted.

## Two competitor rows that are NOT provider-gated (found 2026-08-31)

Checked while writing ADR-217, because "everything remaining is gated
outside the code" had been wrong three times in two days and was worth
testing rather than repeating. Of the eleven GAP rows, nine name a real
external account nobody has opened. Two did not, and both have now
shipped their ungated half:

- [x] **Route optimization / visual route manager.** PARTLY buildable, and
  the first version of this entry overstated it — corrected here before it
  reached main. `crm_route_density` (ADR-199) is an analytics read, not a
  sequencer, and the sequencing arithmetic itself is genuinely ungated:
  haversine plus nearest-neighbour and a 2-opt improvement pass is
  something this repository can compute and test offline.
  But `crm_properties` stores an `address` and NO COORDINATES, so a
  distance sequencer currently has nothing to sort, and turning an address
  into a point is geocoding — which needs a provider. Claiming the row was
  simply "not gated" was the same over-broad move this file exists to
  discourage, made in the opposite direction.
  What is actually shippable: nullable `latitude`/`longitude` on
  `crm_properties`, a sequencer over whatever coordinates exist, and honest
  degradation — a property with no point is LISTED as unsequenceable rather
  than silently dropped from the day. That would move the row to PARTIAL.
  Still gated afterwards: bulk geocoding, drive time, traffic and time
  windows. SHIPPED as the day route (ADR-221, `20260831001200`, hosted run 33389230218): the
  dispatcher's sequence is first-class (routes, stops, resequencing,
  route sheet), which is the half of "route manager" no provider gates.
  The optimiser itself remains gated on geocoding exactly as ADR-221
  records; row is PARTIAL with the optimiser named as the remainder.
- [x] **QuickBooks sync.** The API sync is gated on an Intuit account. A
  QuickBooks-readable EXPORT FILE is not, and is what many small shops
  actually use — the invoice and payment ledgers already hold everything it
  needs. SHIPPED as the accounting export (ADR-220): a balanced
  general-journal CSV built from the real ledgers, downloadable from the
  billing panel. Row is PARTIAL; the live API sync stays gated on the
  Intuit account.

Both shipped their ungated half; the provider-gated remainders are
recorded on their rows. They are recorded here rather than left as an
unexamined "gated" so the next reader treats that word as a claim to check
— and the route entry above is a reminder that "buildable" is equally a
claim to check, since the first version of it did not verify that the data
the algorithm needs exists.


## Grok Bot -> truthful Chief-of-Staff workspace (ADR-190, 2026-08-30)

- [x] Deterministic Chief-of-Staff planner: owner prompt -> intent,
  requirements, acceptance criteria, dependency graph, configured-agent
  routing intent, and bounded budget. `Grok Bot` is the product name; no xAI
  provider is introduced.
- [x] Hosted durable boundary in
  `20260830001000_grok_chief_of_staff_persistence.sql`: owner-only,
  tenant/project-scoped sessions; append-only messages/events; immutable
  task, graph, and artifact links; monotonic control intents; forced RLS and
  narrow definer functions. Focused runtime suites: 43/43.
- [x] Fail-closed planning API: save and reload the plan, preserve idempotent
  durable status truth, wake no worker, and never launch the custom
  provider-labelled DAG. Planned provider/model/agent identity is routing
  intent, not observed run evidence.
- [x] Integrate and verify the Grok workspace UI: session history,
  conversation, plan/tasks, agents, progress, files/diffs, tests, artifacts,
  deployment, and honest blocked/control states across responsive and
  accessibility coverage.
- [x] Scope session history at the database boundary instead of filtering an
  organization-wide top-20 list in the browser. Expose the existing stable
  `(created_at, id)` cursor, prove complete-cursor validation and bounded
  look-ahead, add `Load older sessions`, and retain direct links that fall
  outside the first project page. Keep disconnected-project history readable
  while disabling new goals before any session is created (ADR-228; focused
  32/32).
- [x] Connect the session to the exact canonical `full_lifecycle` v2 bridge —
  Claude planning -> HUMAN architecture approval -> Codex Phase 1C ->
  CI/Vercel/health — while persisting planned identity separately from actual
  graph/node/agent-run evidence. The service-only boundary creates and pauses
  the graph atomically before visibility, produces no graph/node run, dispatches
  no worker, and replays idempotently from durable state. Focused bridge tests
  are green.
- [x] Add a bounded manual Resume wake/recovery path after graph creation: only an
  owner-authorized Resume resolves the exact project/repository target and
  asks the existing graph worker to claim that graph UUID. Replays retry the
  wake for commit-before-dispatch recovery only when the same applied key is
  replayed while already unpaused; an older applied key cannot start a later
  graph-control cycle. Exact requested graph controls may complete an
  interrupted idempotent action and service-role resolution. The graph's
  immutable repository id must match the resolved
  dispatch target, other controls never dispatch, and disabled, invalid,
  conflicting, or failed wakes remain **Not Connected**. This path does
  not enable either worker or change autonomy/kill-switch state. Direct
  Cancel/Retry are refused by this endpoint and remain **Not Connected** until
  one forward database boundary can correlate each action with its audit
  resolution atomically and replay it safely.
- [x] Replace read-then-act recovery with the owner-only atomic graph-control
  RPC in `20260830010000_atomic_grok_graph_control.sql`; preserve
  authenticated-only execute, exact tenant/session/project/graph/key scope, no
  table grant, pinned definer/search path, immutable event-sequence ordering,
  exact replay without duplicate evidence, and rollback without residue for
  unavailable fresh actions.
- [x] Apply `20260830010000` exactly once through protected run `33357349773`.
  The mutation and ledger insert succeeded; the run stopped only because its
  postflight hashed a trimmed function body. Forward verifier containment
  `2c68e7c9a1ef5ee22a38f7272236d61ab1e11b04` corrected the canonical
  PostgreSQL `prosrc` fingerprint without replaying a migration or changing
  history. Read-only run `33359633742` proved ledger `1|1|1|1|1`,
  exact catalog/ACL/runtime/rollback, linked lint, health, and stopped safety.
- [x] Project canonical linked graph-run and release evidence into the Grok
  workspace: observed node route/state/attempt, token/cost/closure, newest 500
  graph events and newest 200 session events with truncation truth, artifacts,
  PR/diffs, exact CI, preview, deployment, and health. Do not infer bot/worker
  identity; Rollback and automatic continuation remain **Not Connected**, and
  graph state alone does not advertise Phase 1C Cancel/Retry.
- [x] Add immutable launch-time provider admission (ADR-208): planner v2
  snapshots safe assignment/bot/role/account/provider identity; the route maps
  each canonical MODEL/Phase 1C node to one exact posting; and forward migration
  `20260831000100` locks and re-derives the live identity before it atomically
  records append-only admissions and creates a paused, zero-run graph. Revoke
  service-role execution from the legacy unadmitted launcher. The dedicated
  one-file workflow verifies exact ledger, forced RLS, ACL/catalog/source,
  linked lint, runtime/replay/immutability/rollback, health, and stopped safety.
- [x] Finish verifier-only containment for the hosted admission migration.
  Exact app commit `49b087e1044c157ea24271c81070a2c38b03c8da` passed all four
  CI jobs and exact READY production health. Apply run `33365674624` then
  applied and ledgered `20260831000100` once before a false-negative
  postflight: the workflow fingerprints for both new function bodies included
  delimiter text that PostgreSQL does not store in `prosrc`. Correct the two
  hashes from the exact migration bodies. Commit `d5e91c78e7696072eba72cb744d747c724b73eec`
  did that; then-current main `25f39c45b15e1089d829150143a4ed6ee78acd36`
  passed exact CI `33368051986` and READY production. Read-only verify
  `33369343687` then passed identity, ledger, catalog, and stopped containment
  before a second verifier-only defect: `psql -c` does not interpolate the
  three canary input variables. Commit
  `7bdbb5b7a5ef5466f7283ec66d09d3240fbc9311` consumes the checked-in input
  through `psql -f` and pins the broken form in 12/12 workflow tests.
  Then-current main `f86062a616c3859d93569fb7edfe15d3025b0c26`
  passed exact CI `33370961802`, READY production, and read-only verify
  `33372115428`; signed-in reload retained the exact durable blocked session
  without starting a graph, worker, or provider. Never rerun, repair, replay,
  or down-migrate the already accepted migration.
- [x] Implement honest prompt/roster admission in the repository through
  `20260831001000`: planner v3 persists the complete Ready configured posting
  roster, normalizes `*` to the fixed canonical vocabulary in TypeScript and
  SQL, keeps v1/v2 readable, and blocks research/deploy before graph creation
  rather than inventing executable work. Protected run `33397811324` applied
  and ledgered it once; never replay it. Exact main `24a6313e98023bfc618a921fc563c9f4bde4cad2`
  passed four-job CI `33400336336` and READY deployment
  `dpl_49dFxebk4jpWEXUtfK2CbsQpBk1T`; read-only verify `33401887942`
  skipped apply/reload and isolated the remaining failure to ADR-227's
  version-dependent ACL count. Final acceptance awaits that verifier-only
  correction and another fresh read-only verification.
- [x] Implement the repository worker-admission fence through
  `20260831000900`: every Grok Resume/wake and protocol-v3 graph or Phase 1C
  claim requires and revalidates the complete current admission identity;
  legacy unadmitted Grok work cannot enter the worker. Protected apply run
  `33397377838` and independent read-only run `33397710586` accepted it.
- [x] Implement durable bounded input context and multi-turn composition
  (ADR-235) through `20260831001100`: exact server-derived project/repository
  references, safe bounded text capture, URL/image reference-only handling,
  tenant-linked integration references, forced RLS, append-only audit/hash
  evidence, exact replay, and an atomic owner follow-up boundary that never
  dispatches or silently changes the immutable plan. Repository candidate only;
  the migration is not hosted yet.
- [ ] Add `20260831001100` to an explicitly reviewed protected forward-only
  release scope after integration. Require exact hash/ledger/catalog/RLS/ACL/
  replay/immutability/tenant-isolation/health evidence and signed-in initial +
  follow-up + reload acceptance. Keep URL/image fetching, binary storage,
  workers, autonomy, and automatic actions out of that scope.
- [x] Connect immutable initial Grok context to protocol-v3 Full Lifecycle and
  Phase 1C claims (ADR-230) through `20260831001500`. The private projector runs
  only after exact current admission, tenant, project, session, and plan-message
  checks; revalidates item/file/envelope bounds, secrets, and hashes; excludes
  all post-plan follow-ups; and rolls back the claim on mismatch. Admitted
  Claude/Codex prompts receive a separate typed untrusted-data section without
  changing the existing 4 KB goal. Legacy/non-Grok claims stay unchanged.
- [x] Add `20260831001500` to a dedicated protected forward-only
  `probe` / `apply` / `verify` scope after `01100` is accepted. ADR-234 pins its
  canonical-LF hash and native `prosrc` identities and proves exact ledger/
  catalog/ACL/runtime/rollback/lint/health plus stopped containment. Hosted
  dispatch remains separately gated; no worker, autonomy, automatic-action,
  URL/image fetch, merge, or deployment authority belongs to that scope.
- [x] Publish one exact rebased candidate and require lint, typecheck, the full
  test suite, production build, all three browser/accessibility shards, exact
  green CI, exact READY Vercel identity, and matching public health. Exact main
  `85a7fed15ad876be4e56fd74903e41b68d4488b4`, CI `33395309085`, and READY
  deployment `dpl_FcbZciXJFJN1DWxN2mxd23wEPfaU` satisfy this gate.
- [ ] Apply only the protected completion sequence through the dedicated
  workflow: fresh `probe`, `claim-admission-fence` (`00900`),
  `specialist-admission-planning` (`01000`), then fresh read-only `verify`.
  Require exact ledger, catalog, RLS, ACL, runtime, lint, health, and stopped
  safety evidence; never broad-push, replay, repair, reset, or down-migrate.
  Both one-file applies are complete and ledger is now `1|1`; 010 postflight
  stopped before acceptance because its verifier counted expanded table
  privileges as ACL items and PostgreSQL 18 NOT NULL constraints as named
  business constraints. ADR-226 fixed those two mistakes, but fresh read-only
  verify `33401887942` proved the remaining hard-coded count of seven is also
  version-dependent because PostgreSQL 17/18 includes `MAINTAIN`. Ship
  ADR-227's semantic `acldefault` set comparison, then run only fresh read-only
  `verify`.
- [ ] Perform signed-in production create/return/reload acceptance with workers
  still OFF, proving the exact current roster and route persist without
  claiming that provider execution occurred.
- [ ] Under a separate authorization, run the real current-base provider path
  through an admitted claim, repository change, draft pull request, stable
  exact-head CI, and immutable audit evidence. Only that provider-backed E2E
  can close `GROK BOT: PRODUCTION READY`.
- [x] Establish the production baseline before containment: exact main
  `397798921ebda6a4f8e30d2c0d83af36a3dd73a0` is green/READY and hosted
  migrations `20260830000900` and `20260830001000` are each ledgered once.
  Signed-in acceptance reproduced the truthful no-Codex planning refusal and
  proved that it persisted an active session while the UI falsely claimed a
  saved plan; it created no graph, run, or dispatch.
- [x] Release the database-first planning-failure phase at exact commit
  `f6292c8ec359fd8e39c5463e4039b3388cf2056f`: all four jobs in CI run
  `33348187052` green; Vercel deployment
  `dpl_A35nZhbJQMJWLtUSroG9zXLWhXBw` READY with matching health; migration
  apply run `33348980504` and read-only verify run `33349033378` passed. The
  required ledger vector is `1|1|1|1`, with exact catalog, ACL, atomic
  runtime/replay, linked lint, health, and stopped safety.
- [x] Release and accept Phase 2 containment at exact app commit
  `d4040fee445079e34b2e062bfc234b708f802d9b`: all four jobs in CI run
  `33349358778` green; Vercel deployment
  `dpl_9zKFCaitCUAidmEaDbE9vAgKv5fY` READY with exact release/main health,
  project `prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`, and reachable matched Supabase
  `qpuofpmagrmyamahqwxw`. Signed-in Demo Data acceptance created durable session
  `569325a5-5cd2-40c3-831e-0d90c89188ab`, truthfully refused missing ready
  Claude coverage, and reloaded the exact `blocked`, nonclosed state with two
  messages and five ordered immutable events. It created no plan, routing
  identity, graph, run, artifact/deployment evidence, provider call, worker
  wake, or dispatch. Legacy session `74d18263-37ba-4f7d-8230-dc5e41bdc86a`
  now reloads as request saved/no plan.
- [ ] Complete the separate provider-backed loop only after legitimate ready
  bot coverage exists and execution receives its own authorization. The
  repository candidate now pins the selected bot, connected account,
  provider/model, credential rotation, and immutable revisions at claim time,
  but it is unhosted and has not executed a provider. Keep workers, autonomy,
  and automatic actions OFF and the global kill switch ON; do not treat a
  repository dispatch as proof of claim or execution.

## Services CRM → pest-services platform (task #63, owner /goal 2026-08-30)

The audit + pillar-to-increment map is `AI/SERVICES_CRM_GAP_ANALYSIS.md`
(the /goal registration hit the 4,000-char limit; a trimmed re-issue was
handed to the owner). PEST CRM: PRODUCTION READY is declared only after
the full seeded E2E journey passes — increment 10 of the plan.

- [x] Increment 1 (ADR-185): the foundation — "Services" global nav +
  product shell (own route group, Budget Tracker pattern);
  20260830000500 crm_accounts/contacts/properties + immutable
  crm_timeline_events (append-only grants, trigger-written status
  history, same-org composite FKs, secret guards, forced member RLS);
  five routes (list+counts, detail, patch, contacts, properties,
  timeline with system-kind refusal); Overview + Customers & Leads +
  360° account pages live-wired. Hosted apply: dispatch
  scope=services-crm after merge.
- [x] Increment 2 (ADR-186): crm_opportunities pipeline (trigger-written
  stage history, closed_at trigger+CHECK, loss reasons, no DELETE),
  whole-book conversion report + /Services/pipeline board, duplicate
  detection on create via generated normals (409 surfaced, explicit
  allowDuplicate, never merged), global search in the shell.
  20260830000700; hosted apply: dispatch scope=crm-pipeline after merge.
- [x] Demo Data book (ADR-187, owner directive): seedable fictional
  clientele through /api/services/demo-seed — empty-book-only, every
  record source-labeled "Demo Data", .example emails, 555 phones,
  history earned through the real triggers; Overview gains the loader,
  the DemoNotice label, and the pipeline headline. No migration.
- [x] Increment 3 (ADR-189): field service core — technicians (no
  DELETE), work orders (completion → trigger-written `service` event
  with property + field notes; cancellation recorded; completed_at
  trigger+CHECK; three-column same-account property FK), recurring
  service plans (guarded generate + compensation, clamped month math);
  /Services/schedule board + /Services/technicians roster; Demo Data
  fields the operation. 20260830000800; hosted apply: dispatch
  scope=field-service after merge.
- [x] Increment 4 (ADR-191): pest/IPM core — crm_devices with per-org
  barcode identity, the append-only crm_device_events scan ledger
  (install written at birth; device state projected from the ledger by
  trigger), crm_pest_sightings with the corrective-action CHECK; the
  /Services/ipm command center (scan box, per-site station tables,
  threshold flags, sighting loop); Demo Data now runs a real IPM
  program. 20260830001200; hosted apply: scope=pest-ipm after merge.
- [x] Increment 5 (ADR-192): chemicals & compliance — crm_products with
  EPA identity and https-checked SDS/label references, crm_product_lots
  with trigger drawdown, the APPEND-ONLY crm_applications log (license
  copied at recording, supersede-not-edit corrections, its own timeline
  event), and crm_compliance_rules as configurable per-jurisdiction rows
  enforced at the application boundary; the audit report as JSON or
  injection-guarded CSV; /Services/compliance. 20260830001300; hosted
  apply: scope=chemicals-compliance after merge.
- [x] Increment 6 (ADR-194): billing — crm_estimates and lines (totals
  derived from the lines at the boundary), crm_contracts (term,
  signature completeness, ended-iff-closed), crm_invoices and lines
  whose paid total and `paid` status are decided by the settlement
  trigger rather than any caller, and the APPEND-ONLY crm_payments /
  crm_refunds with a row-locking trigger that refuses a credit larger
  than the payment it refunds; every payment writes a `payment` timeline
  event; /Services/billing. 20260830001400; hosted apply:
  scope=billing-contracts after merge.
- [ ] Increment 6 follow-on: take card payments through the existing
  Stripe machinery. The ledger records money that moved; it does not yet
  move it, and /Services/billing says so rather than implying otherwise.
  Also open in this pillar: dunning schedules and PDF invoice rendering.
- [x] Increment 7 (ADR-195): the company — crm_branches (code, address,
  IANA time zone, open/close dates), crm_employees as the org chart (seven
  roles, branch, supervisor, commission basis points, quota),
  crm_territories (postal-code coverage, one rep, one branch) and
  crm_commissions whose payout is derived from basis × rate by trigger and
  cannot be sent by a caller at all; accounts gained branch/territory/owner,
  opportunities an owner, technicians a branch and a supervisor;
  /Services/branches, /Services/team, /Services/sales. 20260830001500;
  hosted apply: scope=branches-org-sales after merge.
- [ ] Increment 7 follow-on (canvassing): door-to-door routes, knock
  dispositions and per-rep canvassing stats. The territory map and the
  leaderboard now exist to hang them on; the knocking itself does not.
- [x] Increment 8 (ADR-196): documents, canvassing and the marketing hub —
  crm_documents (a storage PATH, never a URL, never bytes),
  crm_canvass_routes + append-only crm_knocks with dispositions,
  crm_marketing_lists + crm_list_members with consent as a record that
  keeps its moment, crm_campaigns, append-only crm_messages,
  crm_automations and append-only crm_attributions; /Services/canvassing
  and /Services/marketing. No provider is wired and no executor runs the
  rules: both surfaces carry **Not Connected**. 20260830001600; hosted
  apply: scope=documents-canvassing-marketing after merge.
- [ ] Increment 8 follow-on: wire an email/SMS provider behind
  owner-supplied credentials, and an executor for the automation rules.
  Until then `sending`/`sent` stay unreachable from the API and
  run_count/last_run_at stay unsettable, which is what keeps the page
  honest.
- [x] Increment 9 (ADR-197): the forms and inspections engine — versioned
  templates over seven field types, assignable instances, answers checked
  against their question's declared type by trigger, "completed" counted
  from the required questions rather than asserted, signatures whole or
  absent, templates frozen once in use; plus crm_timesheets with overlap
  refused and licence expiry on technicians. /Services/forms.
  20260830001700; hosted apply: scope=forms-timesheets-licences after merge.
- [ ] Increment 9 follow-on: WDO/termite diagrams (a drawing surface, not a
  form), and PDF rendering of a completed inspection.
- [x] Increment 10 (ADR-198): the customer portal, residential view — one
  login resolves to exactly one account through SECURITY DEFINER
  projections, with no existing staff policy widened; balance, issued
  invoices, visit history, documents and service requests; staff invite an
  address and the customer claims it themselves. /customer-portal and
  /Services/portal. 20260830001800; hosted apply: scope=customer-portal
  after merge.
- [x] The `budget-tracker` apply scope pointed at
  `20260829000300_budget_tracker_activity_types.sql`, a name the file lost
  when the job-seeker alert engine took 000300. Its pinned hash still
  matched the real file byte for byte, so only the version had drifted —
  but a dispatch would have died at `sha256sum` with "No such file"
  instead of applying, and the ledger probe asked about a version this
  repository does not contain. Fixed to `20260829000100`, and
  `tests/unit/migration-path-references.test.ts` now fails on any
  `supabase/migrations/...` path a workflow or test names that is not a
  real file.
- [x] Increment 10 follow-on: the COMMERCIAL portal view. Shipped as
  increment 15 (ADR-203) — open conditions, device trend heat maps,
  sighting tickets, the SDS library and inspection history on
  /customer-portal; this earlier entry predates it and was stale.
- [ ] Increment 10 follow-on: sending the invitation. The row exists and
  the accept flow works, but nothing emails a customer to tell them — no
  email provider is connected, so an invitation is delivered by whatever
  the office does today. Wire it when a provider is supplied.
- [x] Increment 10 follow-on: the workflow size ceiling. The seven CRM
  scopes' postflight SQL now lives in
  `.github/hosted-apply/postflight/<scope>.sql` and runs with `psql -f`,
  the way the probe SQL was extracted. 488KB -> 473KB, and the guard
  ratcheted down to 480,000 so the recovery is kept.
  `hosted-scope-replay` executes every one of the seven against the fully
  migrated chain and proves one of them actually RAISES on a broken
  schema — a postflight that passes on a broken schema is worse than none,
  because it is read as proof.
- [x] Increment 11 (ADR-199): the operating dashboards — revenue by month
  with invoiced and collected as separate series, receivable aging that
  keeps not-yet-due and undated out of overdue, retention with the
  customers nobody serves, technician productivity with the idle roster
  kept in, and route DENSITY from real scheduled windows.
  /Services/dashboards. 20260830001900; hosted apply:
  scope=operating-dashboards after merge.
- [ ] Increment 11 follow-on: route OPTIMIZATION, which needs a mapping
  provider for drive time. Density ships; sequencing by distance is
  labelled Not Connected until credentials are supplied.
- [x] Increment 12 (ADR-200): recurring billing and dunning — invoices
  raised from service plans that have come due, made safe by a PARTIAL
  unique index rather than by the generator checking first; billing runs
  recorded with the operator's name; a collections worklist ordered
  oldest-and-largest; and dunning notices that record what a person did.
  /Services/collections. 20260830002000; hosted apply:
  scope=recurring-billing after merge.
- [x] Increment 13 (ADR-201): equipment and fleet — assets over an
  append-only ledger, with status, assignment and meter readings as
  projections of it; service schedules where "no interval on file" is its
  own standing rather than "fine"; and a meter that cannot run backwards.
  /Services/fleet. 20260830002100; hosted apply: scope=equipment-fleet
  after merge.
- [x] Increment 14 (ADR-202): revenue forecasting — active plans and
  contracts with a term, projected forward with NO churn or growth model,
  and every reason the figure understates reported beside it. Forecast tab
  on /Services/dashboards. 20260830002200; hosted apply:
  scope=revenue-forecast after merge.
- [x] Increment 15 (ADR-203): the commercial portal view — open conditions,
  a station table and a monthly activity trend, an SDS/label library
  covering only what was applied at the customer's own sites, and
  completed-inspection history, plus a sighting the customer can file
  themselves. Three tabs on /customer-portal. 20260830002300; hosted apply:
  scope=commercial-portal after merge.
- [x] Increment 16 (ADR-205): WDO/termite inspection reports — a not-null
  verdict so an unfinished inspection cannot read as a clean one, the
  areas that could NOT be inspected as first-class columns, a 0..1
  coordinate diagram with click-to-place marks, an issue-time
  contradiction check on the trigger rather than the function, and issued
  reports on the customer's Compliance tab. /Services/wdo. 20260830010100;
  hosted apply: scope=wdo-inspections after merge.
- [x] ADR-206: the commercial activity heat map — four cell states rather
  than one opacity ramp, so a month nobody scanned cannot read as a clean
  one. Closed the matrix row ADR-203 had already earned the data for.
- [ ] Increment 12 follow-on: UNATTENDED billing. The generator is correct
  and idempotent but nothing calls it on a schedule, because nothing in
  this product runs on a timer. Needs a scheduler or a worker executor —
  the same gap the automation rules have.
- [ ] Increment 12 follow-on: actually SENDING a dunning reminder. The
  notice records what a person did; delivery needs an email/SMS provider
  and stays Not Connected until credentials are supplied.
- [x] ADR-207: the provider integration registry — one place that knows,
  per provider, whether this workspace can actually do the thing, with
  `live` derived from a sealed credential existing rather than stored.
  /Services/integrations. 20260830010200; hosted apply:
  scope=service-integrations after merge.
- [x] Increment 18 (ADR-210): the technician field app, offline-capable —
  idempotent field writes on a client-minted token, a queue that never
  reports sent until the server confirms, and a fix to the completion
  trigger so an offline visit keeps the moment it actually happened.
  /Services/field. 20260830010400; hosted apply: scope=field-offline-queue
  after merge.
- [x] Increment 19 (ADR-211): twice-monthly and custom appointment
  sequencing — ordered visit steps on a calendar-anchored cycle, a
  generator the dispatch path advances from, and a cadence that reports
  visits a year beside bills a year so level billing reads as the
  arrangement it is. /Services/schedule. 20260831000200; hosted apply:
  scope=plan-sequencing after merge.
- [x] Increment 20 (ADR-212): invoice lines generated from the work order —
  the service at the plan's value plus one line per current chemical
  application, built once and never rebuilt, so the document and the record
  of the visit cannot drift apart. /Services/billing. 20260831000300;
  hosted apply: scope=invoice-from-visit after merge.
- [x] Increment 21 (ADR-213): truck stock — an append-only movement ledger
  between warehouses and vehicles, balances derived rather than stored, a
  lock that stops a location going negative, and one draw per application
  so an offline replay cannot double-count. /Services/compliance.
  20260831000400; hosted apply: scope=truck-stock after merge.
- [x] The seed roster can no longer fall behind the schema: every crm_
  table must be seeded or explicitly excused with a reason, checked against
  the tables the migrations create. Three tables that had already slipped
  past are now seeded.
- [ ] Provider-gated, ship Not Connected until an owner supplies
  credentials, never implied as working: card/ACH processing (the ledger
  records money that moved; it does not move money), SMS/email delivery,
  GPS/fleet telemetry, and QuickBooks sync.
- [x] Mint a printable station label (PestBoss parity, ADR-214): a Code 39
  label sheet on the IPM page, printed from the browser. A barcode Code 39
  cannot carry prints without a symbol and says why, because barcodes are
  case-sensitive and an uppercased one would scan as a different station.
  This was the last row on the competitor board that code alone could close.
- [x] Multi-unit properties (PestPac parity, ADR-215): a unit level below a
  property, with every visit, station, sighting and plan referencing
  (organization, property, unit) so a treatment cannot land on a door in
  another building, plus a coverage reader that names the doors a sweep
  missed. 20260831000500; hosted apply: scope=multi-unit-properties after
  merge. This was the last row on the competitor board that code alone could
  close.
- [ ] Provider- or vendor-gated PestPac modules found by auditing the audit:
  smart traps (a sensor feed), online sales (a self-serve purchase flow on
  top of estimates and contracts, and the payment row it depends on), print
  marketing fulfilment, customer surveys (the form model exists; sending is
  the email/SMS row), and a website builder, which is outside a CRM core and
  is listed rather than quietly dropped.
- [x] File a service report as a document (PestBoss, PestPac parity,
  ADR-216): frozen bytes, append-only, corrected by superseding.
  20260831000600; hosted apply: scope=service-documents after merge. This
  was recorded as blocked on object storage, which was wrong — a column
  under RLS had already solved it for the Job Seeker.
- [ ] Send a filed document to a customer. The email/SMS provider row, same
  as every other outbound message.
- [x] Offer the filed copy for download in the customer portal (ADR-222):
  two definers hand a customer their own list and bodies, the panel's
  Documents tab renders per-copy download anchors with a superseded mark,
  and both stale notices citing object storage are corrected.
  20260831001300; hosted: scope=portal-filed-documents, run 33389312549.
- [ ] BLOCKED ON OWNER AUTHORIZATION, not on code: running recurring
  invoicing on a schedule. A timer that raises invoices against real
  customers is a billing action executed autonomously, which
  policies/RISK_CLASSIFICATION.md classes RED and says a toggle or an
  unrelated task cannot authorize. Needs an owner authorization naming the
  action, target, risk, evidence and rollback/containment plan. The
  generator itself already exists and is idempotent (ADR-200); only the
  clock is missing, and the clock is the part that needs permission.
- [x] Then the AI copilot and the seeded E2E acceptance journey (ADR-224):
  /Services/copilot answers five computed questions from the workspace's
  own rows (free-form drafting labelled Not Connected), and five
  acceptance-journey tests walk the 57,447-record seeded book across
  module boundaries — paper trail, routes, portal scoping, balanced
  journal, copilot arithmetic. **PEST CRM: PRODUCTION READY is declared
  for everything the repository can do alone**; the eight provider-gated
  rows stay Not Connected and the RED actions stay owner-gated, each
  named on its own row.
- [x] Queue-diagnosis honesty follow-up (ADR-223): `20260831001400`
  re-creates `diagnose_graph_queue_as_worker_v2` with withdrawn_at +
  pause_requested_at projected, and explainEmptyQueue names both reasons
  ahead of everything else — withdrawn is final, pause waits for a resume.
  Worker-only ACL restated after the forced DROP; postflight proves the
  new columns and the unchanged reach. Hosted:
  scope=queue-diagnosis-visibility, run 33389384384.
- [x] The apply workflow's byte ceiling, again: the Grok-completion merge
  pushed the file to 478,074 — over the 478,000 guard. `Choose the
  connection` now exports a masked $DB_URL in BOTH modes and every apply
  step's identical six-line preamble is gone (76 removed in the mechanical
  pass after the three newest shipped without one): 478,074 -> 451,768
  bytes, guard ratcheted to 455,000 so the recovery is kept. New steps
  read $DB_URL from env and must never re-add the preamble.
- [x] Increment 6 (ADR-176): Changes & release panel —
  `lib/factory/release-evidence.ts` derives the release trail from the
  ANCHOR observations (lineage/review/ci_check_runs/deployment/probe);
  Build links files-changed/diffs to the PR's files tab, shows each
  check's real conclusion, deployment state/URL, and production health.
  Open still: an inline preview.
- [x] Increment 8 (ADR-182): measured attempt projected —
  20260830000300 restates list_graph_runs with attempt >= 1 as itself
  and the unmeasured 0 as null; Build Agents rows say "attempt N" for
  N >= 2; graph-node-detail proves both projections on the chain.
  Preview resolved by design: the app's own anti-framing headers fence
  an inline iframe (weakening them is RED), so the deployment URL is
  the preview, labeled as such. Hosted apply: dispatch
  scope=node-attempt-projection after merge.
- [x] Increment 7 (ADR-177): Activity log — GET
  /api/graphs/runs/[graphRunId]/events reads graph_events verbatim
  (RLS tenant client, newest-500 bound with admitted truncation, node
  keys resolved via node_runs→graph_nodes); Build's lazy log panel
  renders time/type/node/detail monospace. "Terminal/logs" =
  the engine's recorded events, never invented console output.
- [x] Increment 4 (ADR-172): the eleven specialists as a first-class
  catalogue (`lib/factory/specialists.ts`) bound to real engine
  capabilities/stages, the engineering bench told apart by the node's
  own key; Build gains the command-center evidence panels — Agents
  (specialist beside real executor/provider/model/latency), Independent
  QA (graph_verifications verdicts), lazy Artifacts (real route), spend
  accounting, and Build history with closure notes and evidence links.
- [x] Increment 5 (ADR-181): autonomy modes over the real Phase 1D
  controls — deriveAutonomyMode + AUTONOMY_MODES (exact patches +
  invariants); Build's Autonomy panel derives from GET controls and a
  stronger-mode selection is a real PATCH whose refusal (schema pins
  autonomousMode:false; the trigger refuses beneath) renders verbatim.
  Opening the fence itself is RED and stays with the owner; nothing
  here widens autonomous authority.
- [x] Task #56 (ADR-174): node_runs.attempt persisted —
  20260830000100 replaces `record_node_state_as_worker` with the
  attempt-carrying eight-parameter definer (retry = real second RUNNING
  with its own event; regressions refused; old callers resolve; ACLs
  restated service_role-only); the worker passes the measured attempt on
  every transition with a PGRST202 deploy-window fallback; hosted-apply
  scope `node-attempt-persistence` with signature postflight. Projection
  into the runs feed stays deliberately deferred (a surfaced 0 on
  historical rows would read as measured fact).
- [x] **Workflow headroom** (ADR-178): the probe step's 33 inline SQL
  blocks extracted verbatim to `.github/hosted-apply/probe/*.sql`
  (step runs them with `psql -f`, same order, same output); workflow
  489,956 → 440,708 bytes — 49KB under the 490KB guard. Three pinning
  suites re-pointed without weakening (probe-set parity + runs-the-file
  drift guards; the read-only contract now scans the extracted files;
  scope-replay still executes 07.sql against the migrated chain).
  Follow-up if headroom runs low again: the three mutating giants
  (factory-any-model-record-only 82KB, scope=all 65KB,
  bot-account-binding 41KB) — extract with the same verbatim+re-point
  discipline, never in the same change as a new scope. The ceiling test
  stays; do not raise it.

## Job Search 50-source engine (active owner goal, ADR-163)

- [x] Increment 1: six probed adapters (Remotive, Remote OK, Jobicy,
  Himalayas, Arbeitnow, We Work Remotely) with fixture-pinned parsers; the
  shared `unify` dedupe/filter module used by route and panel alike; the
  50-source catalogue (25 general + 25 marketing) with probed links and
  honest statuses; route `unified` block + filter params; panel rework
  (unified cards with source badges, filter chips + Clear All + AND/OR,
  grouped source picker, sort, NEW badge).
- [x] Increment 2 (schema landed via ADR-141's 20260828000400, applied to
  hosted 2026-08-29): saved-search CRUD route + panel section
  (Save/Update-to-current/Duplicate/Delete/Run Now); AI match scores on
  every unified card from the recorded-facts evaluator with reasons, gaps,
  qualified accent, best-match sort, and a minimum-score filter; per-board
  search metering events feeding the discovery credit meter.
- [x] Increment 2 remainder (superseded by increment 3): the cadence UI
  shipped with the delivery engine, gated behind the connected check;
  the seen-jobs/delivery ledger arrived in 20260829000300.
- [x] Increment 3 (code merged #437, schema applied to hosted 2026-08-29
  run 33263020948 with green postflight): alert engine as a Vercel Cron
  route over two service_role-only definer functions; pure dedupe →
  saved filters → score → never-repeat → email-composition core;
  env-gated Resend adapter; delivery ledger with the never-repeat UNIQUE
  constraint, append-only by trigger; ASAP/Daily/Weekly cadence controls
  that render **Not Connected** and refuse writes until RESEND_API_KEY,
  JOB_ALERT_EMAIL_FROM and CRON_SECRET exist (ADR-164). Remaining to
  light it up: the owner sets those three env vars in Vercel and
  redeploys — nothing else.
- [x] E2E acceptance (everything automatable): journey workflow run
  `33266060493` on main `3cd6150` — full 178-migration chain on a real
  local Supabase stack (real Postgres/PostgREST/GoTrue), production Next
  build, real-browser fake-data journey (sign-in → onboarding → every
  section → live board search → save → found again after reload) —
  **success**, the lane's first green since 08-22 (unblocked by
  ADR-165). CI browser/accessibility shards green on every merged head;
  layout suites 1,387 passed locally.
- [x] E2E acceptance, email leg (ADR-166): the journey lane now proves
  the send itself — the mailer gained a dev-stack SMTP transport, the
  lane wires the local Mailpit sink, and the spec's alert test walks
  save-search → cadence → engine run as the scheduler → a real SMTP
  delivery read back from Mailpit (facts + never-repeat promise in the
  body) → second run leaves exactly one message. Below the send,
  `job-seeker-alert-engine.behavior.test.ts` (11 real-SQL tests) plus a
  service_role drive on the Docker stack cover due-ness, the ledger, and
  the definer boundary.
- [x] Increment 4 (ADR-167): personal marks — favorite, hide, viewed —
  on `job_seeker_result_marks` (20260829000400, forced RLS, own-row
  policies, service_role revoked, no update path) via
  `/api/job-seeker/search/marks`; panel star/Hide/Viewed controls that
  render only after the person's real marks load, "hidden by you"
  counted apart from "hidden by your filters", Show hidden, Favorites
  only; plus the title-derived seniority facet (`deriveSeniority`,
  seven levels, most-senior-wins, labeled "from the job title") wired
  through route, panel, saved-search schema and the alert engine.
  Hosted apply scope `job-seeker-result-marks` added to the workflow
  (step + options entry) — applied to hosted (run 33273330183, postflight
  green) after #448 merged.
- [x] Increment 5 (ADR-168): the last three filter gaps closed without a
  fake — location + radius over an offline GeoNames-derived city index
  (`geo.ts` + `data/cities.json`, CC BY 4.0 attribution; server-side
  haversine; remote/unresolvable kept and counted; unknown centre =
  "distance not applied" with the reason; saved radius honored by the
  alert engine via an injected refinement); title-derived marketing
  specialty (12 disciplines) and posting-text-derived industry (11
  industries), both labeled as derived, wired through route, panel,
  saved-search schema and alerts.
- [x] Owner request (2026-08-29 night, ADR-169): LinkedIn and Indeed
  wired as deep link-outs — the current search, place, radius, posted
  date, work model, seniority and salary floor translated into each
  site's own URL parameters; the two chips sort first and say "· your
  filters". A live adapter stays impossible without violating their
  terms (LinkedIn API partner-only; Indeed publisher API closed), which
  the goal forbids; partner credentials would enable one behind env
  vars like the keyed boards.
- [x] Owner request (2026-08-30, ADR-170): LinkedIn + Indeed primary —
  "Search directly on" row beside the Search button, deep links live as
  the person types; US ZIP codes resolve in the radius filter via the
  GeoNames postal set (41,488 ZIPs, server-only index), shown as
  "City, ST 78701" in the radius report. Journey acceptance re-proved
  green on main 9a73e12 (run 33285610004).
- [ ] Production email delivery: owner-gated on RESEND_API_KEY,
  JOB_ALERT_EMAIL_FROM, CRON_SECRET in Vercel — the alert path's honest
  production state is **Not Connected** (503 fail-closed probe). Verify
  one real Resend delivery after the env vars exist before any
  unqualified "production ready" claim for alerts in production.
- [x] Owner directive (2026-08-30, ADR-184): LinkedIn/Indeed results
  INLINE — built as the env-gated JSearch aggregator adapter (Google's
  job index, official keyed API, per-result publisher). Registry
  (`availableBoardSearchAdapters`), resolved catalogue, search route,
  board picker, save path and alert runner all follow the key in
  lockstep; unified badges read "via LinkedIn (JSearch)"; the panel's
  hint states Connected/Not Connected honestly. Scraping stays refused.
- [ ] **OWNER ACTION to light up inline LinkedIn/Indeed**: create a free
  RapidAPI account, subscribe to the JSearch API (free plan, ~200
  requests/month, rapidapi.com → search "JSearch" by OpenWeb Ninja),
  copy the app key, set `JSEARCH_RAPIDAPI_KEY` in Vercel, redeploy.
  The board, the inline results and the Connected copy appear on their
  own — no code change. Then verify one live search shows "via
  LinkedIn (JSearch)" badges; the first live search is the parser's
  probe (ADR-184 records why a keyed board cannot be probed sooner).
- [ ] Owner-supplied credentials would light up: USAJOBS, Adzuna, Jooble,
  Careerjet, Reed, ZipRecruiter (see catalogue notes). All keyless
  general boards worth adapting are live (13); the rest are honest
  link-outs.

## Migration chain under Supabase CLI ≥ 2.116 (2026-08-29, ADR-165)

- [x] Root cause of the journey lanes failing since 08-23: CLI 2.116.0's
  local stack (postgres 17.6.1.165) seeds hosted-style default function
  privileges, and no CLI wraps a migration file in one transaction.
  Fixed in the chain itself: `supabase/roles.sql` collapses the default
  ACLs before migrations (no-op on older CLIs), 20260822000850 accepts
  the hosted-defaults clean-replay input (sha pins moved with it), and
  20260827000210 opens its transaction explicitly. Full 178-migration
  chain replayed end to end in Docker on 17.6.1.165. Lanes stay on
  floating `supabase@2` so the daily run doubles as drift detection.

## Exact Blackstone Supabase Auth bootstrap (2026-08-28, ADR-160)

- [x] Add an exact-email/project/actor/first-attempt workflow that receives the
  password only through an encrypted temporary repository secret, creates or
  updates through the GoTrue Admin API, and re-verifies unique UUID plus
  `email_confirmed_at` without logging credentials or response payloads.
- [x] Publish and run the workflow once with confirmation phrase
  `CONFIRM BLACKSTONE SUPABASE AUTH BOOTSTRAP`; exact first-attempt run
  `33164766560` on release `298264b02fe5a29e3c139f8077e65d6270f19167`
  returned one bounded updated UUID after confirmed readback.
- [x] Delete `BLACKSTONE_SUPABASE_BOOTSTRAP_PASSWORD` immediately after the
  accepted run and remove the temporary workflow and its test in this forward
  cleanup. No organization membership or application role was inferred from
  the Auth identity.

## Ten-step Factory final release (2026-08-28)

- [x] Correct Step 8 any-provider/model record-only routing and preserve one
  durable command/task/graph identity.
- [x] Preserve exact worker wake evidence in launch/gate UI; show **Not
  Connected**, stop automatic polling when no wake occurred, and bound live
  refresh when a wake was accepted.
- [x] Put Phase 1C and graph application dispatch plus every workflow trigger
  behind explicit fail-closed gates; require exact one-shot target IDs and
  main-only manual execution.
- [x] Bind public health to exact main SHA/ref, public host, Vercel project and
  immutable deployment identity, and Supabase project identity.
- [x] Make mutation authorization first-attempt/non-replayable and validate
  active workflows, exact CI/deployment/health, database containment, ledger,
  catalog, ACL, runtime, lint, and Step 8 any-model contracts.
- [x] Publish exact `79ca52f5b92e7d95292210e05565d35d21b4a435`; all four jobs
  passed in CI `33158801269`, and GitHub deployment `6138739479` resolved to
  exact READY Vercel deployment `dpl_57pM3ZEYNyK596VAeLPJMabJLZrH` with the
  public release-identity health join green.
- [x] Publish exact `298264b02fe5a29e3c139f8077e65d6270f19167`; all four jobs
  passed in CI `33163838800`, and GitHub deployment `6139678648` resolved to
  exact READY Vercel deployment `dpl_ChxG5EdgPzh3vybRZgBRz9EA9gg1` with the
  public release-identity health join green.
- [x] Diagnose the protected probe's only mismatch: the live Phase 1C
  selector is exact stale body `ed5840b9d8d0efdb513a8576df128e9b`, not the
  required breaker-aware body `5933952d71f9da90a2a80a05ce6e0378`; all ABI,
  ownership, security, search-path, ACL, helper, breaker-table, and safety
  guards otherwise match.
- [x] Add isolated forward migration
  `20260828000050_normalize_breaker_aware_phase1c_selector.sql` (LF SHA-256
  `8914034508451d1550ebf3f1bedd8f7b71592f1809306e78c57774c458952896`)
  plus a dedicated protected `selector-normalization` scope. Local gates pass:
  lint, typecheck, 5,150 tests / 7 skipped across 442 files, and 171/171-page
  production build.
- [x] Publish exact cleanup release
  `994da2cec81c0cd83aa1e2d87ad848d2f2ff612a`, pass all four exact-head jobs
  plus exact READY Vercel/health identity, and complete fresh probe
  `33165823042`.
- [x] Apply only `20260828000050` in first-attempt run `33165886343`, pass
  fresh probe `33165944760`, then apply only `20260828000100` in first-attempt
  run `33165992529`. Exact ledger is `1|1|1|1|0|0`; never rerun either scope.
- [x] Publish disposable acceptance release
  `540aceb173ec88e67cb982018a80134ece3ec474`; pass all four exact-head jobs in
  CI `33167232673`, exact READY deployment
  `dpl_31W7nKgJd6ENoCfuvgP1zzHZM6eT`, and public health identity.
- [x] Dispatch first-attempt acceptance run `33168092838`; it passed release,
  safety, and connection gates, then failed closed before target resolution or
  mutation because protected `psql` variables were placed in a `-c` command.
  Delete both temporary selector secrets immediately and do not rerun it.
- [x] Publish quoted-stdin correction release
  `53b84b7952a1e09725f53da5d65c4947b8cb914a`; pass all four exact-head jobs
  in CI `33168368270`, READY deployment
  `dpl_tBF2s6AtLmqZ13YpYHKWzBRtwiKT`, and public health identity.
- [x] Complete fresh first-attempt acceptance run `33169297158`: real
  owner/admin session, exact URL write, exactly one owner-attributed immutable
  audit event, no-op replay, signed-in reload, and pre/post stopped
  containment all passed. Delete both temporary protected selectors, then
  remove the disposable workflow/test in this forward cleanup.
- [x] Publish cleanup `ce86d9c04ff91f237e680a5db4b0cda97feea2ce`, pass all
  four jobs in CI `33169913723`, exact READY deployment
  `dpl_4Zqh4q2yBfaagGtg7stSbV4NSphP`, and public health. Probe `33170897689`
  confirmed `1|1|1|1|0|0`; first-attempt run `33170953151` applied only
  `20260828000200`; independent probe `33171025468` confirmed
  `1|1|1|1|1|0` with exact stopped containment. Never rerun target claims.
- [ ] Accept legitimate signed-in Step 8 record/reload and truthful Step 9
  persistence with workers OFF before applying `20260828000300`; then run
  read-only `verify`.
- [ ] Only after `00300` and `verify`, separately authorize and accept current
  Full Lifecycle v2 execution through TEST, DEPLOY, and MONITOR.
- [ ] Complete signed-in production Step 8 record/reload and Step 9 persisted
  observation with a legitimately connected bot. The current organization has
  zero connected accounts, ready linked bots, or assignments. Do not copy a
  provider token/account across tenants or enable a worker merely to satisfy
  this acceptance item.

## Hosted migration ledger reconciliation (2026-08-28)

- [ ] Reconcile 17 older missing ledger versions beginning at
  `20260815000200`; Supabase Preview currently reaches the already-present
  `organizations.maximum_concurrent_runs` column and stops.
- [ ] For each version, inventory every declared catalog/ACL/RLS/audit effect,
  add only surgical forward compensation for anything missing, and record the
  historical ledger row only after the complete effect is proven present.
- [ ] Never edit/replay historical migrations, reset or down-migrate the
  hosted database, disable the preview check, or blindly mark a version
  applied. The isolated `00050` selector repair is not ledger reconciliation.

## Step 10 public production URL configuration (2026-08-28, ADR-156)

- [x] Add a dedicated owner/admin RPC without changing the compatible
  three-argument project-detail function.
- [x] Reject credentials, likely-secret path material, query/fragment state, non-HTTPS, localhost/private
  and ambiguous network targets at both request and database boundaries.
- [x] Preserve projects FORCE RLS and route real changes through the existing
  immutable `project.updated` activity trigger; refuse archived projects and
  no-op replays.
- [x] Add the project-detail field, clear behavior, accessible failure text,
  API/unit/contract/native-SQL behavior coverage, focused lint and typecheck.
- [x] Configure Vercel Production with an independent non-secret expected
  Supabase project ref; make `/api/health` fail closed on mismatch.
- [x] Publish and apply only
  `20260828000100_project_production_url_configuration.sql` (LF SHA-256
  `0856ddee447280a1bb4418f25d6a6d4650687e168fffcd5e98e8ce15edd62b27`) through the
  protected hosted path in first-attempt run `33165992529`.
- [ ] Configure the intended project through the signed-in owner/admin
  application boundary and verify one immutable audit event plus no-op replay.

## Exact-target one-shot worker claims (2026-08-28, ADR-155)

- [x] Move graph and Phase 1C target UUIDs into the authoritative database
  selectors so a requested wake cannot consume an unrelated eligible item.
- [x] Preserve the existing scheduled/global claim APIs through null-target
  delegation and leave both scheduled worker gates disabled by default.
- [x] Require explicit target UUIDs for repository-dispatch and manual canary
  workflows; commit target-scoped cleanup and return no row for ineligible
  Phase 1C targets without claiming a neighbor.
- [x] Put every graph-worker event and application dispatch behind one exact
  global activation switch; keep it OFF in both GitHub and Vercel.
- [x] Keep the exact provider deployment URL and public project production URL
  as distinct release-evidence fields.
- [x] Cover target preference, ACL denial, workflow wiring, migration order,
  schema security, environment parsing, and graph execution locally (106/106
  focused tests; focused ESLint clean).
- [ ] Publish an exact reviewed head, pass the complete required gate set, and
  apply only `20260828000200_target_bound_worker_claims.sql` through the
  protected hosted path.
- [ ] Run one explicit-ID graph canary and one explicit-ID Phase 1C canary (or
  record exact policy ineligibility) while schedules, autonomy, and automatic
  actions remain OFF and the global kill switch remains ON.

## Billing follow-ons (2026-08-25, after go-live)

The subscription engine shipped with ADR-149; these are the deliberate
deferrals, in the order they become worth doing once money moves:

- **Seat enforcement** waits for a member-invite surface to exist; the limit
  is declared in `lib/billing/plans.ts` and read by nothing yet.
- **Run-credit packs** (one-time purchases topping up graph launches) need a
  credit ledger with expiry semantics — designed away from v1 to keep the
  mirror trivially idempotent.
- **Job Seeker Pro** as a second product: the schema already keys plans by
  slug, so a `job-seeker-pro` plan is additive when priced.
- **Dunning surface**: `past_due` currently grants Stripe's whole retry
  window silently; a banner on `/solutions/billing` naming the failing card
  would recover more of them.
- **Command-launched graphs**: `launch_command_analysis_graph` counts toward
  the month's launch usage but is gated by command budgets, not the plan
  quota. Pricing the command surface needs a decision about whether a
  command's implicit graph is a launch or an overhead.
- **`node_runs.attempt` bridge** (task #56): shipped 2026-08-30 as
  20260830000100 (ADR-174); no longer queued here.

## One graph stranded behind an undecidable gate (2026-08-25, needs an owner call)

Graph `91959362` (test lifecycle from an earlier session, run `6ac300ae`,
PARTIAL since 2026-08-24) sits permanently halted: its `requirements` node is
VERIFYING behind an AUTOMATIC gate holding zero anchors. Nobody can approve
that — `decide_automatic_gate_as_worker` and `decide_node_gate` both refuse a
zero-anchor automatic approval — so the queue reports it waiting for a
decision no one is able to give.

`f6f4bb7` stops the shape being planted again (the compiler now refuses an
AUTOMATIC gate off an ANCHOR node), but a compile-time guard cannot heal a row
already in the database.

- [ ] Decide what to do with it. Three options, none of them urgent — the
  graph blocks nothing, the claim skips it, and its recorded work is intact:
  1. **Leave it.** It is honest debris: a dead test lifecycle that says so.
  2. **Reject the gate.** A rejection is permitted where an approval is not
     (the zero-anchor check only guards `p_approved`), which closes the graph
     with a recorded reason. This is a product decision on real data, so it
     wants the owner's word rather than an agent's.
  3. **Delete the graph.** A destructive data operation, and out of scope for
     an agent without explicit direction.


## Clearing the Backlog and All Pipelines pages (2026-08-22, ADR-119)

- [x] Add `clear_backlog_tasks` and `clear_all_pipelines` as SECURITY DEFINER
  functions that check owner/admin, require a reason of at least ten
  characters, skip live work, and skip rows whose deletion would cascade into
  `agent_runs` unless the caller opts in.
- [x] Add the two `activity_event_type` labels those audit rows use, in their
  own migration, because an enum value cannot be used in the transaction that
  added it.
- [x] Give both pages one shared confirm-reason-clear control that reports what
  was kept and why.
- [x] Apply to hosted with a dedicated narrow scope, hash-pinned, with a ledger
  preflight and a post-apply readback that fails the run on a mismatch.
- [x] Dispatch `scope=probe` for the independent second read of the two
  functions' privileges. Run 33385704826 (2026-08-31 11:10Z, success) is
  that read: the ACL listings show the expected grants and the after-ledger
  listing is the current contiguous chain through `20260831000800`.

## Any-model safe Step 8 -> Step 9 release (2026-08-22, ADR-115)

- [x] Keep exact `openai` / `gpt-5.3-codex` as the sole executable Factory
  identity and classify every other valid bounded provider/model pair as
  `record_only`.
- [x] Make `record_only` persist command/task/route disposition with zero
  `agent_runs`, no worker dispatch, and no branch/commit/PR/deployment path.
- [x] Fail closed when `SOFTWAREFACTORY_CODEX_MODEL` names any nondefault model;
  changing an environment pin cannot grant execution support.
- [x] Advance Step 8 after durable recording and make Step 9 distinguish
  `record_only` from execution, using project-scoped safe history that does not
  expose raw parameters and survives reload.
- [x] Record the hosted prerequisite truth:
  `20260822000600_route_bots_onto_the_executable_model.sql` is applied, but it
  makes only the exact Codex identity executable.
- [x] Remove the repository-only magic RED release approval/expiry ceremony
  (ADR-116). The owner's direct instruction in the active task authorizes the
  release; exact technical identity, CI, deployment, migration, containment,
  and audit gates remain mandatory.
- [ ] Freeze the final application commit and all migration hashes, push only
  that exact head, and require all exact-head quality plus browser/accessibility
  jobs green and an exact READY Vercel Production identity. No such release
  evidence exists yet.
- [x] Contain the factory posture the gate requires: the owner engaged the
  global kill switch and turned Autonomous Mode OFF via the Safety page
  (~21:11Z), and probe run 32599024205 read every state, census, worker, and
  event clause green afterwards.
- [x] Dispatch `scope=audit-guard-acl-contract`: run 32599987697 measured the
  hosted `{postgres, service_role}` ACL, contracted it to owner-only, and read
  it back (ADR-122; the gate's space-only btrim source comparison fixed in the
  same change).
- [x] Dispatch `scope=agentos-foundation-cleanup`: run 32601173685 measured
  the 4-object remnant (three enums plus one helper), dropped it, and read
  back a zero roster (ADR-123).
- [x] Dispatch `scope=command-carry-forward`: run 32602669547 applied
  20260815001000 then 20260822001500, carrying hosted submit_command from
  source 2772f6554cf16c98aa72c7d94f525f63 to the frozen
  adb50eb74e1721274f23d0d69b79e2e8 with the owner-plus-authenticated ACL, and
  read both back (ADR-124).
- [x] Fix the rehearsal lint so it can execute at all: chain run 32603384774
  passed every input gate the carry-forward unblocked and then died on
  `missing trigger relation` — plpgsql_check refuses a trigger function
  without its relation, and the lint passed `0::regclass` for all 27 roster
  functions including the three Phase 1C trigger functions. The lint rows now
  carry the relations 01000 pins in trigger_expectations (ADR-125), with the
  mechanics probe-verified inside a rolled-back transaction.
- [x] Apply only the protected atomic
  `00300 -> 00850 -> 00900 -> 01000 -> 01100 -> 01200` chain through
  `scope=factory-any-model-record-only`: run 32607123713 rehearsed the whole
  chain with a clean lint, committed the single production transaction, and
  recorded all six ledger rows (ADR-125/126). Its post-commit
  RECORD_ONLY_READY check refused on a pinned contract md5 that matches no
  database; the pin is corrected and `scope=record-only-postflight` re-runs
  the three unreached post-commit verifications (ADR-127).
- [x] Dispatch `scope=record-only-postflight`: run 32607902289 read back
  green RECORD_ONLY_READY / RECORD_ONLY_BOUNDARY / FOUNDATION_READY, healthy
  database, reachable site, and requested the PostgREST reload — "Record-only
  chain postflights verified on the applied production database."
- [x] Owner-confirmed acceptance (screenshots 2026-08-23 ~00:27Z): Step 8
  "Issue a Command" Done — 1 command recorded only; Step 9 "Watch It Ship"
  shows the truthful record-only view with the command record modal.
- [x] Step 9 real run with the Claude bot (owner goal, ADR-128/129):
  command `0e9a4765` ("Fix high-priority bugs") is linked to analysis graph
  `e3097ed8`, and graph run `6d6c0a07` reached **COMPLETED with 7
  artifacts** (2026-08-23 13:42:37Z to 13:48:30Z, worker run 32643138657).
  The link was committed through `scope=analysis-launch-commit` (run
  32643074805) after the browser tap twice left no trace and the
  rolled-back doorcheck (run 32614371816) placed the fault above the
  database. Confirmed by probe run 32646908822.
- [x] The application's own launch path is working again: command
  `d8777258` gained graph `a9fc2de2` at 13:44:25Z with no workflow
  involvement; its run `cc39a49f` finished PARTIAL with 5 artifacts, which
  is reported as PARTIAL. Still unexplained is why the two earlier taps
  failed silently — if it recurs, `scope=analysis-launch-doorcheck`
  re-proves the database without writing, and the endpoint now returns
  request-shape refusals with their real status.
- [ ] Codex write-path enablement (owner-gated, unchanged): connect the
  ChatGPT/Codex account in Bot Manager, create an `openai`/`gpt-5.3-codex`
  bot, assign + configure it, set repo variable
  `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED=true`, then a manual command runs
  to an isolated branch and draft PR with CI. Readiness measured by probe
  32608500364; worker auth last green 2026-08-21 21:54Z; the 2026-08-13
  stdin-era failure is structurally gone (SDK adapter; claim takes only
  queued runs).
- [ ] Reverify autonomy/actions OFF, kill switch ON, disconnected workers and
  executors, and zero runs for all `record_only` commands before and after apply.
- [ ] Complete signed-in production Claude or alternate-model Step 8 -> truthful
  Step 9 -> reload acceptance, prove project isolation, and only then update
  continuity documents with exact deployment, apply-run, ledger, and runtime
  evidence.

## Historical bot-account binding containment (2026-08-22, ADR-111; superseded)

This preserves the earlier release checklist as evidence. Do not execute its
separate release sequence; the current pending database action is the atomic
ADR-115/ADR-118/ADR-120/ADR-121
`00300 -> 00850 -> 00900 -> 01000 -> 01100 -> 01200` scope above.

- [x] Push exact approved commit
  `4fc18d3e5ecba6f362f14a7459e588a74a84b84b` to `main` and verify exact
  READY Vercel deployment `dpl_8yngqtjJkNbexxWAMfAhZtEf1RWU` plus public
  HTTP 200 / signed-out API 401 boundaries.
- [x] Publish successor application commit
  `30d7e824691bdd4f8fa72481b21c91d3da6e3a31` with the sole owner identity as
  author and committer. Verify READY Vercel production deployment
  `dpl_FrvCToHvFhkzfwnkmEeeTyfuE3v2`, GitHub deployment `6036292508`, status
  `17160408639`, exact production URL, and stable aliases.
- [x] Preserve the fail-closed database result: EXPAND run `32568221857`
  stopped at `LEGACY_CATALOG_READY` before its apply notice, DDL transaction,
  or ledger insert. Predecessor `20260822000100` remains present and both
  protected target versions remain absent. CONTRACT was not dispatched.
- [x] Reproduce both independent failures locally: Supabase function default
  privileges add direct `service_role` EXECUTE to all seven frozen legacy bot
  routines, while raw `pg_get_functiondef` MD5s vary across PostgreSQL major
  versions even when the catalog contract is identical.
- [x] Add forward-only migration `20260822000150` to atomically normalize only
  the coherent all-seven hosted overgrant. It refuses mixed 1-6/7 states,
  identity/body/catalog/owner/ACL drift, and performs no history write itself.
- [x] Replace deparser-byte gates with line-ending-canonical `md5(prosrc)`
  (CRLF and lone CR become LF) plus explicit return,
  argument/default, security, volatility, cost/rows, support, transform,
  trigger, and ACL catalog invariants in EXPAND, CONTRACT, and hosted guards.
- [x] Record exact-head CI run `32570540183` as red: all three browser shards
  passed, but quality job `97025270055` failed before build because the LF
  migration chain rejected all seven non-canonical source hashes. Classify
  Supabase Preview check `97025325852` separately as pre-existing
  `provider_credentials` preview ledger/schema drift.
- [x] Freeze the repaired repository file identities: 00150
  `6b24b6ebb57e59b9c4398c3e439221c27c300663a7b6932ff192996ffe6bcd93`,
  00200
  `658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`,
  and 00300
  `79914bc97660eef908b6a0fa0c90abfdd15da1683b383ad568e34bf3bd32c5f7`.
  Native PostgreSQL 17.10 and 18.4 full chains pass.
- [x] Confirm that publication of `30d7e824` caused no hosted database
  mutation. No protected apply was dispatched afterward; 00150/00200/00300
  remain unhosted and CONTRACT remains undispatched.
- [ ] Freeze the repaired commit, obtain new exact RED authorization, push it,
  and require green exact-head CI before any hosted DDL.
- [ ] Apply only 00150 then 00200; complete signed-in Role/Claude stickiness,
  runtime, audit, lint, health, autonomy-off/kill-switch-on acceptance; only
  then apply 00300. Never reset, down-migrate, repair history, or rerun the old
  failed workflow.

## Claude bot identity and Role assignment release (2026-08-22, ADR-108/ADR-109)

- [x] Remove the zero-role assignment dead end inside the Assign Bots wizard.
  The inline starter selector defaults to the reviewed Backend engineer
  template, creates it through the existing manager-only audited role API, and
  places the exact returned UUID into only blank selected drafts. The Role
  field then has a real selectable value and Configure can advance. Developer
  remains a separate permission preset; existing posting role/configuration is
  preserved.
- [x] Keep AI Factory on one full-app modal/focus/close boundary, complete the
  open-assignment roster through terminal-proven UUID keyset pagination, and
  serialize/fence broker start, retry, close, and cleanup races.
- [x] Contain the owner-screenshot identity shortcut. `ProjectBots` no longer
  treats `credentialRef` similarity as an exact AI-account link or hides the
  repair control. An unbound Ready legacy bot may be assigned while AI Factory
  correctly keeps steps 5-7 incomplete. The UI exposes the existing exact
  `/api/bots/connect/provision` Link-or-repair/adoption path, awaits the parent
  refresh, and offers an accessible **Return to AI Factory** action. Completion
  remains connected account + exact `aiAccountId` + current Ready + project
  assignment.
- [x] Validate the current unpublished UI containment: focused UI 75/75,
  focused ESLint, full typecheck, and lint/typecheck/build pass. The root full
  suite passes 337 files / 4,054 tests with 3 files / 7 tests skipped. Its first
  contention-only `supabase-wiring` timeout cleared isolated 2/2 and on the
  full rerun.
- [x] Freeze forward migration
  `20260822000200_register_bot_for_ai_account.sql` at SHA-256
  `658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`.
  It binds a subscription bot to the exact tenant AI account, introduces
  monotonic bot/assignment revisions, rejects stale or released-posting
  writes, and records exact-config readiness through a service-role-only
  boundary while preserving a management-authored Disabled state.
- [x] Make `20260822000200` an EXPAND migration: preserve exact legacy function
  definitions/signatures/security/search paths and authenticated-only execute
  ACLs while adding authenticated revision-checked wrappers plus the
  service-only readiness recorder. The temporary bypass is explicit; revoke
  legacy execution only in a separately approved forward CONTRACT migration
  after the exact replacement app is deployed and accepted.
- [x] Preserve the prepublication working-tree gates: lint, typecheck,
  production build, 331
  Vitest files / 3,934 tests (7 skipped), and 1,207 serialized browser passes
  with 545 intentional viewport skips. The one unknown-resource status defect
  repeated across three viewports was fixed forward; its exact 404 and
  generated-social-image regression passes 6/6 across desktop/tablet/mobile.
  The all-fields audit additionally proves every assignment field and reload
  readback, preserves spaces while Instructions are typed, and refuses a
  required custom/self-hosted endpoint in both UI and API. Independent security,
  broker, UI, and proxy reviews report no unresolved P0/P1/P2. Exact-head CI
  `32570540183` supersedes this as the release verdict and is red for the
  cross-platform migration-hash defect.
- [x] Publish and deploy the application candidate at exact commit
  `30d7e824691bdd4f8fa72481b21c91d3da6e3a31`. This proves application identity
  only; its failed CI gate and absence of hosted database mutation prevent a
  release-accepted claim.
- [ ] After the repaired commit is approved and green, verify exact
  main/CI/Vercel identities and hosted predecessor `20260822000100`. Apply 00150
  and then 00200 only through their dedicated scopes, verify one ledger row
  each and exact catalog/ACL invariants, then run runtime create/bind/assign/
  configure/readiness/audit, linked-database lint, health, and signed-in Claude
  Role/reload stickiness. Stop on any mismatch and contain only with a new
  forward change.
- [ ] After exact-app production acceptance, separately review and authorize a
  forward CONTRACT migration that revokes the six legacy authenticated execute
  grants. Do not fold revocation into the EXPAND apply or infer approval for it.
  Keep the global kill switch ON, raw autonomy and all automatic actions OFF,
  and the worker/executor disconnected.

## Agents selectable into the AI Factory (2026-08-22, ADR-107, owner goal)

- [x] Migration `20260822000100_project_agent_selection.sql`: project_agents
  with RLS + FORCE RLS, no direct table path, owner/admin select/deselect and
  member list definer functions, audit events, advisory locks; 16 behavior
  cases against the real chain.
- [x] `/api/project-agents` (GET/POST/DELETE) reporting the unapplied
  migration as Not Connected; 10 route cases.
- [x] `ProjectAgentSelector` on /solutions/agents (standalone project picker)
  and in the AI Factory's new Select Agents step (nine-step journey; done =
  at least one agent included, names as evidence); 5 component cases plus the
  updated factory suite.
- [x] Applied to hosted Supabase: run 32548916762 (2026-08-22 03:25Z,
  scope=agent-selection), ledger repaired, schema cache reloaded. Verified on
  production: /api/project-agents answers 401 signed out; signed in,
  available:true from the live list function, and a write probe surfaced the
  database's own owner/administrator refusal - both definer functions execute
  on hosted and fail closed.

## AI Factory production acceptance (2026-08-21)

- [x] Verify exact candidate head
  `a020e8192d8512a1bb65112e01017047087f0528`: CI run `32543409160` passed
  quality and all three browser shards.
- [x] Advance and reload production at 4/8: **Agentic SDLC** remains selected,
  its immutable `pipeline.selected` Activity event is visible, and the owner's
  reconnected Claude account reports Connected.
- [ ] Complete the account Refresh with a real worker sweep. It remains pending
  and is not connected/fresh-worker evidence.
- [x] Implement and locally verify the downstream bot-purpose normalization:
  translate
  broker `claude`/`claude_N` and `codex`/`codex_N` purposes into provision
  choices `subscription`/`subscription_N`, reject mismatches, and pin the real
  broker-purpose fixtures in regression tests. PR #309 at exact head
  `db1958f8b501e865a9e741a21298683e0f88f969` passes 99 focused tests,
  lint, typecheck, a production build, and the secret/protected-path audit. It
  is not deployed;
  production Create Bot still fails and the roster remains empty.
- [x] Diagnose PR #309 CI run `32545138211` browser shards 1/3 through 3/3: the async
  loading state omitted the page H1. Keep `AI Factory` visible in loading and
  every fail-closed state and pin the initial-loading state in a component
  regression test. This is a forward candidate; it invalidates the prior exact-
  head merge approval.
- [ ] Obtain exact owner approval before changing the protected
  `lib/bots/credentials.ts` boundary. It must admit only catalog-declared
  subscription reference bases and valid `_2` through `_9999` slots, while
  continuing to reject arbitrary, malformed, browser-public, and privileged
  references. Until this lands, a subscription bot can be created but cannot
  read ready from its vault credential.
- [ ] Make the manager-only manual readiness check use the same boolean-only
  environment-or-vault presence predicate as the bot-fabric read. It currently
  checks and serializes with environment presence only, so a vault-backed bot
  can be persisted and returned as Not Connected. This protected readiness
  change also requires exact owner approval.
- [ ] Bind a provisioned bot to its exact `ai_accounts.id` through a separately
  reviewed forward schema/RPC design. `bots.ai_account_id` currently remains
  null, so credential-slot stickiness is not full identity stickiness.
  broker-purpose fixtures in regression tests. The branch candidate passes 100
  focused tests, lint, typecheck, and a production build. It is not deployed;
  production Create Bot still fails and the roster remains empty.
- [ ] After an authorized release, repeat Create Bot, assignment, settings, and
  reload checks before claiming that a connected bot is usable and sticky.
- [ ] Keep production promotion stopped until the five linked-lint errors/ten
  findings, raw autonomy/kill-switch drift, two effective-kill-off projects,
  absent fresh worker, and hosted `20260821000300`/candidate `20260821000400`
  drift are contained and remeasured.


## Factory command routing release (2026-08-21, ADR-106)

- [x] Persist one immutable route for every owner-submitted factory command,
  including selected pipeline/template, bot assignment, bot, provider/model,
  work effort, effective risk, and the routing/configuration snapshot.
- [x] Resolve exact idempotent replay before any mutable pipeline, roster,
  readiness, or capacity read; recheck stored effective risk in the database.
- [x] Keep submission and replay owner-only, fail closed when the routing RPC
  is absent, and leave worker dispatch, autonomy, merge, deploy, and rollback
  unavailable.
- [x] Freeze `20260821000400_command_factory_routing.sql` at 34,999 bytes,
  SHA-256
  `e45149db3ca7c66a27934b0b49ac160e1b5ef597fc8f34ad8547de4759086598`.
- [ ] Remediate and remeasure the hosted release blockers: five linked lint
  errors/ten findings; one raw organization with `autonomous_mode = true`; one
  raw organization with `autonomy_kill_switch_active = false`; two projects with effective
  kill off; and no connected/fresh worker.
- [ ] Apply `20260821000400` only through a separately authorized hosted
  release, verify its exact ledger/object/ACL/RLS/replay behavior, then publish
  and prove the matching production copy. Production remains on hosted
  `20260821000300` and the old application until then.
- [x] Classify the default unbounded-run Supabase-wiring and pipeline failures
  as contention-only by clearing both on isolated retry; the wiring contract
  passes 2/2 in 0.603s with `maxWorkers=1`.
- [x] Run the bounded current-head non-frozen Windows suite:
  `vitest run --exclude tests/unit/auth-broker-runner.test.ts --maxWorkers=4`
  passes 317 files / 3,730 tests, 7 skipped, in 183.78s. Lint, typecheck, and
  build are green.
- [x] Remove the embedded template-plan first-render race: derive the caller's
  project synchronously, perform no workspace project read, and pin the
  immediate render and project-scoped graph submission in regression tests.
- [x] Remove the no-role assignment dead end: explain the required role, link
  to `/solutions/bot-manager`, and keep Configure from advancing until every
  selected bot has one.
- [ ] Require Linux CI to run the complete suite, including the owner-frozen
  19-test `tests/unit/auth-broker-runner.test.ts`. Its local exclusion is only
  because Windows lacks the Unix `script` executable; it is not a test waiver.

## FirstMate review / Factory Briefing (2026-08-21, ADR-104)

- [x] Review FirstMate at pinned commit `738460d401b1115dab617c3859077973977615cb`
  and adapt its strongest safe product pattern: one bounded member briefing
  with Needs owner now, Underway, Recently finished, and Up next lanes.
- [x] Keep the integration read-only and tenant-scoped; use existing bounded
  APIs, fold linked runs into tasks, disclose saturated source windows and
  cancelled omissions, treat unknown states as inspectable, and mark partial
  reads as incomplete rather than clear.
- [x] Add pure classification tests, component tests, populated responsive
  harness coverage at 320–1440 px, and populated axe coverage at phone and
  desktop widths.
- [ ] Consolidate the eight bounded reads behind one server-side safe
  projection if dashboard request volume becomes material. Preserve the same
  per-source integrity signal; a consolidation must not turn one failed
  sub-read into an empty success.
- [ ] Design durable keyed owner decisions and explicit analysis-versus-code
  output contracts as separate increments before changing mission execution.
  A true liaison, restart checkpoints, or graph-to-Phase-1C child runs require
  their own schema, RLS, audit, lease, and authority review; none is implied by
  the briefing.
- [ ] Do not import FirstMate's Bash/tmux runtime, Relay/public intake,
  ambient CLI credentials, `+yolo`/raw launch escape hatches, merge scripts,
  or flat-file state into this multi-tenant control plane.

## Job Seeker increments (2026-08-20, ADR-096, owner goal)

- [x] Increment 1: foundation schema (approval gate, dupe key, score integrity
  in CHECKs), hard-gated /job-seeker page, navigation, career profile and
  preferences CRUD, scoring engine with pinned weights, behavior + unit +
  sweep coverage.
- [x] Increment 2: manual job recording with deterministic fact-only scoring
  (evaluate.ts — reasons/gaps name their facts, exclusions veto), discovery
  UI with breakdown, pipeline entry at the honest stage. (#284)
- [x] Increment 3: workspace — fact-only ATS resume + cover letter builders
  (no model in the path; the Kubernetes/Kafka test proves non-fabrication),
  immutable versions, READY_FOR_REVIEW + Approve/Reject on the gate. (#285)
- [x] Increment 4: counted analytics (null rates render as "—") and the
  seven-agent job_search_pipeline graph template on the real engine. (#286)
- [x] Increment 5: contacts + outreach-draft UI; drafts never claim a send.
  (#289)
- [x] Increment 6: resume upload in a person-scoped BYTEA table (hosted
  storage policies are unownable from our apply path; the web tier holds no
  service-role key), applied in run 32322900245. (#290)
- [x] Increment 7: the goal's E2E journey test — Profile → Preferences →
  Discover → Score → Qualify → Resume → Cover Letter → QA → Review →
  Approve → Apply → Follow-Up → Analytics in ONE pass against the real
  schema through the real engine functions — plus the import-adapter
  architecture: a typed registry where `configured` flips only by detection
  of the named variables, each adapter Not Connected on the page with its
  exact needs listed, and an unconfigured adapter carrying no fetch
  implementation at all.
- [x] Live verification (owner goal, 2026-08-21, ADR-097): the full
  fake-data browser journey green against a real Supabase stack
  (`tests/e2e/job-seeker-journey.spec.ts`, `JOB_SEEKER_E2E=1`); fixed the
  three live defects it surfaced (no-workspace dead end → onboarding flow
  with `?next=`, PostgREST one-to-one embed shape in the jobs route,
  empty-history-entry 422 → client-side prune).
- [x] Live verification round 2 (same day): the journey covers the whole
  capability surface — all eleven stages, reject+close, entry removal,
  resume download round-trip, analytics re-check — and two more wiring
  gaps closed: the CRM details editor (notes / application URL /
  follow-up date had PATCH support but no UI) and the persistent
  current-resume link (the `resume_upload_id` pointer went unread).
- [x] Greenhouse + Lever imports (2026-08-21, ADR-105): the two public
  adapters turned out to need identifiers, not credentials — real
  `fetchPostings` against the providers' keyless APIs, identifier-driven
  from the page, recorded and scored through the shared chain, journey-
  proven live (40/40 imported rows scored and in the pipeline).
- [x] Job Search integration (2026-08-27, ADR-147): canonical
  `/JobSearch` plus signed-in global **Job Search** navigation, with
  `/Job-Search` and `/job-seeker/search` sharing the same gated content;
  exact 214-file upstream snapshot at
  `79cd383e58f0af7948c7c6462a3a289e9b67421e`; four keyless adapters with
  current request/response contracts; explicit location-capability honesty;
  per-result organization/user/board/payload-bound save evidence; and one
  atomic audited persistence RPC. Direct non-persistent probes observed
  Jobnet 2/4, Jobindex 2/736, Jobdanmark 0/0 for London and Freehire 2/6752.
- [x] **Database-first release:** exact-head CI run `33110615299` passed all
  four required jobs, then workflow run `33111692239` applied only
  `20260827000100_record_job_seeker_job_atomically.sql` (SHA-256
  `2f51bf64ba3fd2bc711e6fbf9e660a2cc0dd5ef4b1f85d932ee574e79e9c7d13`) to
  exact Supabase project `qpuofpmagrmyamahqwxw`. Its postflight verified the
  one ledger row, exact function signature/owner/`SECURITY DEFINER`/
  `search_path=pg_catalog`/authenticated-only ACL, three validated composite
  owner constraints, removal of the superseded keys, PostgREST schema reload,
  and enabled+forced RLS. Migrated-PostgreSQL behavior tests cover safe
  duplicate, rollback, audit evidence, and tenant/user refusals; the signed-in
  hosted path remains part of production acceptance below.
- [x] **Production acceptance after the database gate:** exact application
  release `aabd82b3a626da94a2478ef26f043a51d059cd15`, CI `33114868741` and
  Vercel Production deployment `6130751384` are identity-bound. Signed-in
  production returned all four board outcomes, and a sealed Jobnet result was
  saved, read back `via jobnet` at score 35/100 and stage FOUND, then matched
  to exactly one immutable `job_seeker.job_recorded` event
  (`7637e796-b172-40d6-833f-408407b6f5b2`). Desktop and 390px mobile acceptance
  passed. Remote journey `33115019633` separately passed the returning-account
  gate; its live-board sample had no new savable row and skipped that mutation
  honestly rather than substituting a fake result.
- [x] Move the remaining manual `POST /api/job-seeker/jobs` insert chain onto
  the atomic boundary, with its regression: the route now calls
  insertScoredJob/loadEvaluationInputs (record_job_seeker_job commits job,
  match, pipeline entry and audit event together), and a source regression
  in job-seeker-record.test.ts fails if a direct insert on any of the
  three tables creeps back.
- [ ] PARKED until production runs the new route code (one deploy after
  this merges): revoke authenticated direct INSERT on
  jobs/matches/applications in a separate forward contraction with its own
  scope and postflight. Do not revoke while any deployed code still
  depends on the grants.
- [ ] Reconsider Jobbank only with a reliable, reviewed fallback contract for
  its intermittent Cloudflare block. Upstream suggests WebSearch as a
  fallback; the current hosted adapter has no such instrument. This is a
  deferred capability, not a permanent impossibility claim.
- [ ] Open (needs external credentials/decisions): LinkedIn import
  (SOFTWAREFACTORY_LINKEDIN_CLIENT_ID+SECRET — real OAuth app, reviewed
  integration); model-polished document variants through the
  job_search_pipeline graph template (live and launchable from
  Pipelines → Templates), QA-lens-checked against the deterministic
  baseline.
- [x] CI lane (2026-08-21): `.github/workflows/job-seeker-journey.yml` —
  workflow_dispatch + daily schedule; provisions `supabase start` (lean
  exclusion set) on the runner, mints the pre-confirmed journey user
  through GoTrue's admin API, builds and serves the production app, and
  runs the JOB_SEEKER_E2E journey. No deployment, no production
  credentials, no provider usage.
- [x] Production run (2026-08-22, owner goal): the lane's remote mode
  (`base_url` dispatch input) drove the whole journey against
  https://www.theagoras.com as the owner-approved fake account — run
  32540879299 green (flaky first attempt on a cold start, full pass on
  the CI retry), verified by reading production's API back as that user
  (42 jobs, 40 imported live via Greenhouse, all scored, analytics
  correct). Fake-account cleanup is one dashboard delete.

## Real usage numbers need a fuller-scoped sign-in (2026-08-19, ADR-095)

- [ ] Design the interactive-login connect path: seal the claude.ai OAuth
  token (scopes `user:profile` + `user:inference` + sessions) instead of the
  inference-only `claude setup-token` output, with refresh-token handling and
  expiry-driven re-auth. This is the only route to measured usage bars — the
  provider's usage endpoint declines inference-scoped worker tokens (HTTP
  403, measured 2026-08-19 across 10+ probes with the client's own headers).
- [ ] Until then the Bot Manager states the truth per ADR-095: Connected,
  fully operational for running bots, usage not measurable for this
  connection type. Do not weaken that wording to imply a transient failure.

## A project's selected pipelines (2026-08-18, ADR-098)

- [x] Add `project_pipelines` (migration `20260821000300`) with RLS + FORCE RLS, every
  table privilege revoked from `anon`, `authenticated` and `service_role`, and
  owner/administrator `select_project_pipeline` / `deselect_project_pipeline` plus
  member `list_project_pipelines` as the only paths, each audit-evented and
  advisory-locked per project-and-key.
- [x] Expose them at `GET`/`POST`/`DELETE /api/project-pipelines`, resolving names from
  `GRAPH_TEMPLATES` for a built-in and `graph_templates` for a custom template so no
  label can go stale, and refusing a key that names neither before anything is written.
- [x] Make **Use** a persisted toggle — grey with `aria-pressed` when selected, many per
  project — and move the graph-planning dialog to its own **Plan graph** button.
- [x] Make the AI Factory's Configure Pipeline step read the selections: done only when
  one is chosen, with the chosen names on the page rather than only in the overlay.
- [x] Cover the migration against the real chain (owner allowed, member read-only,
  outsider denied, anonymous denied, no direct browser write path), the route boundary,
  the toggle, and the selected-state layout at every swept width.
- [x] Apply `20260821000300` to hosted Supabase — run `32536895799`, 2026-08-21
  23:27Z, `confirm=apply` `scope=pipeline-selection`; the after-ledger listing shows
  the version local and remote, and the step reloaded the PostgREST schema cache.
- [ ] Observe the behaviour on production: press Use on `/solutions/ai-factory`,
  refresh, and confirm the selection is still there. The ledger row proves the DDL
  ran; it does not prove the journey reads it back on the live site.

## Project repository picker (2026-08-16)

- [x] Add `set_project_github_repository` and `unlink_project_github_repository`
  (migration `20260816001400`): owner/admin-only, serialized with handoff and change
  reservations, one non-archived project per repository with the conflicting project
  named, immutable activity evidence, `authenticated`-only grants.
- [x] Expose them at `PUT`/`DELETE /api/projects/[projectId]/repository` behind
  same-origin and owner/admin checks; map the uniqueness race to a readable 409.
- [x] Add the per-project repository picker to the Connections console with truthful
  no-installation, zero-repository, and projects-load-failure states.
- [x] Cover route authorization, the uniqueness conflict path, and unlink in unit,
  component, and migrated-schema behavior tests.
- [ ] Apply `20260816001400` to hosted Supabase through `AI/HOSTED_APPLY_RUNBOOK.md`;
  until then the picker's server functions do not exist on hosted.

Checked Phase 1C items distinguish implementation/configuration/release milestones from connectivity. Phase 1C is not Connected until the complete live draft-PR/CI journey has exact provider evidence.

## Per-account usage evidence on the Bot Manager (2026-08-16, ADR-076)

- [x] Add append-only `ai_account_usage_observations` (migration `20260816001500`) with key-allowlisted window payloads, worker-only write, member-only latest-per-account read, and zero direct table access.
- [x] Probe Anthropic subscription usage from the auth-broker sweep (startup, ~5-minute idle cadence, and on a fresh connect), with the credential opened only inside the sweep and failures recorded as named observations that never demote an account.
- [x] Render session/weekly usage bars with reset times, freshness, and truthful absence states on the Bot Manager's AI-accounts panel, auto-refreshing while visible.
- [ ] Apply migration `20260816001500` to hosted Supabase (owner-gated, `AI/HOSTED_APPLY_RUNBOOK.md`) — until then production records no observations and the panel says "no usage recorded yet".
- [ ] Prove a real usage endpoint for OpenAI/Codex subscription accounts; until then each Codex observation records `unsupported` truthfully.
- [ ] Decide a retention policy for usage observations (append-only rows accumulate ~300/account/day at the idle cadence); pruning is an owner decision, not a delete path this phase adds.

## Phase 1D autonomous-loop decision controls (execution-inert)

- [x] Complete the nine-action control model (plan, code, test, repair, review, approve, merge, deploy, rollback) at both an organization and a project scope.
- [x] Resolve the two scopes most-restrictive-wins, with the envelope (kill switch, emergency stop, release freeze, missing executor) overriding both.
- [x] Hold the same rule in the database as `public.resolved_autonomy_controls`, `security invoker` so it cannot cross a tenant boundary.
- [x] Classify risk from the actual diff, and block a change that classified higher than it was declared.
- [x] Define the GREEN gate set and the enhanced set YELLOW and RED add on top; treat a missing result as a blocker and keep `not_connected` distinct from `not_run`.
- [x] Add deterministic Review, QA and Security agents whose blocking findings stop progression.
- [x] Return `APPROVED_AUTOMATICALLY` / `OWNER_APPROVAL_REQUIRED` / `NOT_APPROVED`, evaluated after the gates, with an absolute no-self-approval rule.
- [x] Sequence the twelve pipeline stages and halt at the first block.
- [x] Show all nine actions in the interface, with the reason each is off.
- [x] Prove the interlocks against real PostgreSQL and demonstrate the loop end-to-end including the blocked stages.
- [x] Apply execution-inert Phase 1D migration `130006` only after the hosted ledger is reconciled. Hosted verification confirms all nine actions remain OFF and the global kill switch remains ON; the migration granted no execution authority.
- [ ] **BLOCKED — enabling any automatic action.** RED under `policies/RISK_CLASSIFICATION.md`; needs a separate owner-approved migration after sustained non-production evidence.
- [ ] **BLOCKED — auto-merge.** `AGENTS.md` forbids introducing the workflow in this line of phases.
- [ ] **BLOCKED — deploy execution and preview validation.** No Vercel API connection; `VERCEL_TOKEN` unset.
- [ ] **BLOCKED — rollback execution.** No adapter; `policies/AUTO_ROLLBACK.md` disables it.
- [ ] **BLOCKED — autonomous Codex code and repair execution.** The manual Phase 1C worker is published but remains **Not Connected** after a failed-safe first attempt; it is not an autonomous executor.
- [x] Backlog Autopilot **selection**: orders eligible P0–P3 work by priority then lower risk, holds work behind unmet or unknown dependencies, refuses work above the ceiling, and does not pick up new work while a project is degraded, critical or paused. Every exclusion is returned with its reason.
- [x] Revalidate CI, risk, reviews and conflicts against the current head before a merge would be attempted, and never infer branch protection as satisfied. A push after approval invalidates the approval; a push after verification invalidates the gates.
- [x] Plan the response to a failure in the decision layer rather than leaving the ordering to whichever caller drives Phase 1E: freeze first (it only removes authority), rollback fail-closed, bounded repair, escalation for anything left.
- [x] **Never auto-reverse a destructive migration.** A release containing one resolves to owner-only, outranking controls, ceiling and approval.
- [x] Bound retries per stage, with exponential backoff, escalation rather than a further retry once the budget is spent, and no retry at all for a permanent failure.
- [x] Deployment tracking **read** adapter with the real provider contract. It reports **Not Connected** with a reason while no token is configured, and exposes no create, promote, or rollback path.
- [ ] **BLOCKED — Backlog Autopilot execution.** Selection is done; starting the selected work needs `auto_plan` enabled and a worker.

## Phase 1C published implementation and provider-credit recovery

- [x] Add command type, bounded acceptance criteria, deterministic risk assessment, stable idempotency, connected-project filtering, and truthful queued/delayed/RED-blocked responses.
- [x] Resolve repository binding only from the authenticated active tenant and persist exact connection, installation, repository IDs, default branch, and current base SHA.
- [x] Fix provider, model, logical role, budgets, draft-PR workflow, and plan server-side; independently enforce the same boundary in SQL.
- [x] Add provider-neutral logical roles including architect and performance while keeping agent, provider, model, project, and account identities separate.
- [x] Add durable task dependencies, worker status, run leases/heartbeats/attempts/cancellation/retryability, append-only events/artifacts/validations, and bounded terminal reports/activity.
- [x] Add RLS/FORCE RLS, ownership constraints, indexes, secret checks, explicit table/function grants, caller-member safe projections, and service-role-only worker RPCs.
- [x] Preserve hosted-source `130001` and move additive/narrowing Phase 1C provider compatibility into forward migration `130007`.
- [x] Split Phase 1C enum additions into migration `130008` so PostgreSQL commits new enum values before execution migration `130009` uses them.
- [x] Add migration `130010` with an idempotent provider-neutral eleven-role roster for existing/future organizations, rebind factory-created role references, reconcile provider-table ACLs, and keep provider/model on execution runs rather than logical identities.
- [x] Add migration `130011` for canonical same-project dependency submission, deterministic derived acceptance criteria, idempotent dependency replay, and cumulative turn/input/output budgets across retries.
- [x] Harden database command submission to organization owners, include acceptance criteria in SQL risk parity, map general work to Orchestrator, and serialize concurrent work by logical agent.
- [x] Harden immutable artifact replay, draft-PR projection, bounded retry/recovery states, remote recovery revalidation, stale-lease/cancellation terminalization, and structured success/failure/cancellation reports.
- [x] Require a bounded `SOFTWAREFACTORY_REQUIRED_CHECKS` allowlist and verify exact CI names, complete returned check sets, stable repeated success evidence, and unchanged draft-PR base/head before reporting CI passed.
- [x] Add supported `@openai/codex-sdk` server-side adapter with isolated `CODEX_HOME`, bounded turns/tokens/time, structured output, workspace-write sandbox, approval `never`, network disabled, and web search disabled.
- [x] Add exact-base-SHA Git workspace preparation, `factory/*` branches, short-lived repository-ID-scoped App tokens, explicit owner commit identity, and safe branch recovery.
- [x] Add pinned-container dependency bootstrap and network-none deterministic diff/lint/typecheck/test/build validation with bounded output and one repair attempt.
- [x] Add path containment, forbidden path, symlink, binary, secret, protected-resource, file-count, per-file-size, and aggregate-size enforcement.
- [x] Add draft-PR-only publication, existing-draft recovery, exact-head CI observation, and durable result evidence with no merge/deploy authority.
- [x] Add GitHub Actions one-shot worker on opaque repository dispatch and a five-minute recovery schedule with read-only workflow token permissions; omit branch-selectable manual dispatch from the secret-bearing workflow.
- [x] Add tenant-safe agent/task/run/report detail APIs, worker status, run cancellation/retry, and production-data consoles for Dashboard, Bot Manager, Backlog, Agents, Runs, and Reports.
- [x] Keep Autonomous Mode OFF, global kill switch ON, RED non-executable, and auto approve/merge/deploy/rollback OFF.

## Phase 1C verification and protected release blockers

- [x] Prior verified production baseline before this update (`0c662a24393f682073e6002c5aff9339292226d8`) passes lint/typecheck, 117 test files/1,282 tests, production build with 74 page/route entries, Playwright/axe 117/117, focused migration/security gates, production dependency audit 0, and safe disabled-worker smoke on Node `24.19.0`.
- [x] Run the frozen current-update local final-candidate gates on Node `24.19.0`: lint/typecheck, 118 Vitest files/1,311 tests, coverage 76.70/71.47/74.04/78.11, 74/74-route production build, Playwright/axe 117/117, production dependency audit 0, and clean diff-check. This is not CI, Vercel, or hosted evidence.
- [x] Run the consolidated lint/typecheck/test/build, browser/accessibility, audit, worker-smoke, migration-chain, secret/static, and severity gates on the exact reconciled Phase 2A/1C tree before publication.
- [x] Review the published diff for unrelated edits and confirm tracked files contain no credentials, private keys, service-role tokens, generated workspace state, or local environment files.
- [x] Obtain exact owner RED approval for the protected sequence: ledger-only repair, forward migrations, protected Actions secret configuration, disabled publication, bounded activation, one live GREEN acceptance command, and deactivation. Applying `130006` did not enable Phase 1D.
- [x] Authenticate the protected Supabase release session, verify exact project ref `qpuofpmagrmyamahqwxw`, compare migration history, and run linked lint while stopping on identity/history mismatch.
- [x] Reconcile exact hosted catalog/source mappings and repair only migration-history rows for schema-present `028`/`130001`-`130005`; then apply the proven-absent forward chain through `130014`. No schema-present DDL was rerun, and no reset or down-migration occurred.
- [x] Implement local forward migration `20260813001500_expose_bounded_run_routing.sql`: restore `provider_agent_assignments_model_check` and `agent_runs_model_check` from 120 to the original 128-character provider catalogue/API bound without changing their other semantics; add four named no-secret constraints covering catalogue model/display-name, assignment model, and routing policy-version/selected-model text; add rolling-compatible UI/schema handling for absent, null, fixed Phase 1C, and immutable Phase 2A routing evidence; revoke authenticated raw SELECT on routing decisions/events; and retain tenant-scoped model-catalogue SELECT. Provider runtime/API validation also rejects credential-shaped default-model/model/display-name scalar values before serialization or RPC. This is source-only evidence, not hosted proof.
- [ ] **RED approval required — apply only the complete `130015`.** Hosted Supabase remains through `130014`. Obtain a fresh exact owner approval naming project `qpuofpmagrmyamahqwxw`, frozen SHA-256 `3E1BEA8F5DAB912D5D7D6251E4503C319816B27EF2465DB5E8612E26A3DD1A13` (13,121 bytes), both 120-to-128 constraint restorations, all four no-secret constraints, both ACL revokes, retained model-catalogue grant, run-detail projection, window, validation, and forward-only containment; then verify ledger, all six changed/added constraint definitions, 128-character assignment/run/project behavior, valid and negative credential-shaped scalar behavior through reviewed paths, exact table/function ACLs, function identity/signature/security/search path, bounded routing runtime, raw-table direct denial, RLS, lint, and health. Stop on any mismatch.
- [x] Exercise authenticated production owner reads across Bot Manager, Runs/detail, Backlog/detail, Agents/detail, Reports/detail, and Connections; separately verify signed-out UI isolation and anonymous denial for twelve hosted Phase 1C target/read RPCs.
- [ ] Create or supply an owner-authorized unrelated authenticated tenant/session and record its denial/empty behavior plus live anonymous/unrelated mutation-shaped and direct-table denial probes. Hosted membership currently contains only the owner, so local integration coverage is not represented as live proof. Service role is not a valid user-under-test.
- [x] Configure the seven protected repository secrets for the first bounded acceptance without rendering values. After the OpenAI key was pasted into chat, treat it as compromised and remove `SOFTWAREFACTORY_OPENAI_API_KEY`; the other protected secret names remain non-rendered.
- [x] Verify `SOFTWAREFACTORY_REQUIRED_CHECKS` equals `Lint, typecheck, test, and build|Browser and accessibility tests`, matching `.github/workflows/ci.yml`.
- [x] Keep repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` absent/false through migration, secret configuration, publication, normal CI, and Vercel verification.
- [x] Under exact owner RED approval, set the variable to `true` for the first bounded acceptance attempt and return it to absent/false after the run was claimed. The attempt failed safely before repository mutation; this is activation/deactivation evidence, not successful Phase 1C acceptance.
- [x] Publish the exact reviewed tree to the repository default branch with author/committer `surgeservicesllc <surgeservicesllc@gmail.com>` and verify CI run `31745504157` plus matching READY Vercel deployment `dpl_AnVz76EfgBa9RpsrFYWiWNresvbv` at commit `7f504255fc9db3a67da936e112825252dc668670`.
- [ ] Confirm the worker status changes from **Not Connected** only after a fresh real heartbeat and returns safely to stale/Not Connected when heartbeat evidence expires.
- [ ] **Owner action:** run `codex login` on a machine signed in to the intended ChatGPT account and store the resulting `~/.codex/auth.json` as repository secret `SOFTWAREFACTORY_CODEX_AUTH_JSON`. This is the only remaining blocker on Phase 1C requirements 4, 8, 13, and 14-live. Do not fund an OpenAI API account; there is no paid path to fund.
- [ ] **Owner decision:** Phase 2A's OpenAI and Anthropic adapters make per-token API calls, which conflicts with the zero-token cost rule as stated. The organization switch defaults OFF so nothing is being spent, and the conflict is latent. Decide whether Phase 2A is exempt as an explicitly-enabled advisory path, or should be removed or re-based on the same subscription-authenticated capability. Recorded in `AI/PHASE_1C_COMPLETION.md` §5a.
- [ ] **Unproven platform assumption:** whether an unattended GitHub Actions run may use ChatGPT-subscription credentials is a question about that plan's terms, not about this repository. If it is disallowed, report Phase 1C blocked on a platform limitation. Do not restore API billing to route around it.
- [ ] Complete one safe manual GREEN owner command against `surgeservicesllc/SoftwareFactory` and record the full command/task/run/agent, Codex thread, base SHA, `factory/*` branch, commit, open draft PR, validation, exact-head CI, usage, report, and activity evidence. First attempt evidence is command `0c4d0ca8-1867-4d00-80cf-476401491a17`, run `f4594556-6f72-4763-a480-6993939e3651`, and Actions run `31746057998`; it failed on provider startup before any changed file, commit, branch, or PR. Its planned base predates current `main`, so do not retry it. Submit a new command bound to the then-current base only after the subscription credential is configured; funded-provider proof is no longer required or wanted.
- [x] Confirm the first live failure was contained before repository mutation: no changed files, commit, pushed branch, PR, default-branch write, merge, deployment, or RED execution occurred, and activation returned to OFF.
- [x] Verify and publish the recovery patch at `bc95b9e3a5952864bd26da778a052f37400ea747`. It checks pinned Codex CLI `0.147.0` plus exact model access before every claim, supports the distinct `softwarefactory_phase1c_preflight` event for bounded non-stored response verification without Docker preload or claim, and preserves structured terminal provider errors.
- [x] Dispatch published provider-only diagnostic run `31748582858`. The exact-model GET passed, the bounded non-stored Responses call returned only the safe code `credit_balance_exhausted`, Docker preload and durable claim were skipped, activation returned to OFF, and the stale failed run was not touched.
- [x] Verify exact CI and matching Vercel evidence for recovery commit `bc95b9e3a5952864bd26da778a052f37400ea747`: CI run `31748567790` passed both required jobs and deployment `dpl_3hTUZ1aJy2b2BSdhTZMnZRMfxnhh` is READY.
- [ ] Revoke the user-pasted OpenAI key at the provider, add credits or obtain a fresh funded replacement project key, and keep `SOFTWAREFACTORY_OPENAI_API_KEY` absent until that replacement is ready.
- [ ] Configure only the fresh funded replacement key and rerun `softwarefactory_phase1c_preflight`. If both probes pass, submit a new safe GREEN command bound to the current base; never spend the stale failed run's remaining attempt. Otherwise stop and keep activation OFF.
- [ ] Verify the live run did not change the default branch, approve or merge the PR, deploy, rollback, modify workflows/provider settings, or execute RED work.
- [ ] Exercise cancellation, stale base SHA, dispatch failure/recovery schedule, lease expiry/reclaim, provider rate limit/unavailable, failed validation, CI failure/timeout, one retry, idempotent PR recovery, protected path denial, and likely-secret denial.
- [x] Update `AI/CURRENT_STATE.md`, `AI/HANDOFF.md`, and `AI/QUALITY_SCORECARD.md` with the published recovery, no-claim `credit_balance_exhausted` diagnostic, secret containment, and unconsumed-retry evidence. OpenAI/Codex remains **Not Connected**.

## Phase 1B retained acceptance gaps

- [ ] Complete the remaining live unrelated-authenticated and mutation-denial RPC/table matrix; owner reads and anonymous read denial are already recorded.
- [ ] Verify evidence-bound reverse handoff before retiring primary installation `153445938`.
- [ ] Verify explicit disconnect/loss behavior and preserved history.
- [ ] Complete remaining stale-SHA, permission/revocation, rate-limit, lifecycle-ordering, terminal delete/restore, and ambiguous-recovery provider cases.
- [ ] Keep Support ticket `#4660724` as the primary App webhook defect record until resolved.

## Phase 1E production operations

Implemented, hosted in the reconciled chain, and locally verified against the migrated schema. No real production target has been observed, so nothing here is live monitoring evidence.

- [x] Add migration `028` with ten RLS/FORCE-RLS operations tables, additive SEV1–SEV4 incident columns, owner-scoped SECURITY DEFINER workflows, and zero new `service_role` table privileges.
- [x] Build provider-neutral monitoring with one connected HTTPS-probe adapter, an explicit Not Connected reason and unblocking condition for every other provider, and a CHECK constraint preventing an unconnected monitor from being enabled.
- [x] Derive `healthy/degraded/critical/unknown/paused` health from real signals with append-only history and a stored reason; resolve absence of evidence to UNKNOWN.
- [x] Create and deduplicate SEV1–SEV4 incidents automatically with upward-only severity escalation and full evidence columns.
- [x] Freeze autonomous releases automatically on SEV1/SEV2; add owner-only resume with acknowledgement, an organization-wide emergency stop, and an owner-only reversal of that stop that never silently lifts a per-project freeze.
- [x] Resolve Last Known Good only from a validated deployment; evaluate rollback fail-closed; escalate a failed rollback to SEV1 with owner attention by constraint.
- [x] Add a deterministic Production Investigator returning cause, cited evidence, subsystem, confidence, action, and risk without intermediate reasoning.
- [x] Create bounded repair work capped at three attempts with escalation, refusing RED and above-ceiling work so the risk policy is not bypassed.
- [x] Add a durable, idempotent operations event queue covering all ten event types with bounded attempts and dead-lettering.
- [x] Gate incident resolution on restoration, a passing same-project validation, root cause, corrective action, and prevention for SEV1/SEV2.
- [x] Add the Operations console, per-project production detail, the daily operations report, and the immutable operations audit trail.
- [x] Pass lint, typecheck, 82 files/819 tests, a clean build, and Playwright 117/117 including axe.
- [x] Reconcile hosted ledger entries for schema-present `028` and `130002` without replaying their DDL as part of the exact protected chain on `qpuofpmagrmyamahqwxw`.
- [ ] Configure an owner-authorized production monitor target and record the first real observation, detection, and resolution.
- [x] Persist per-project synthetic journey definitions with database-enforced step safety and profile coverage, execute read steps through the bounded probe, and record declared writes as skipped.
- [ ] Authorize a scheduler identity for continuous monitoring without widening `service_role`.
- [ ] Connect Vercel deployment status, error-rate/latency telemetry, database liveness, and job/integration signals.
- [x] Resolve the residual probe limitation. RESOLVED since the ten-step
  release protocol landed: `lib/operations/guarded-lookup-core.ts` wraps
  node:dns lookup, checks EVERY answer against the private/loopback/
  metadata ranges, and `probe-core.ts` installs it as the undici Agent's
  dialer — so a public hostname resolving privately at DNS time fails
  with "resolved to a private, loopback, or metadata address" before any
  connection is made. operations-guarded-lookup covers it (loopback
  refused, all answers checked even when one was asked for). This row
  predated the fix and was stale.

## Phase 2B task work locks need a lease before anything can gate on them

Found while closing Phase 2E goal 17 (2026-08-15).

`public.task_work_locks` records `acquired_at` and `released_at` and nothing
else. There is no `expires_at`, no heartbeat, and no expiry sweep, so a lock
whose holder crashed — or whose task was cancelled between acquiring and
releasing — is held forever. Today that is invisible, because nothing consults
these locks when work is scheduled.

It stops being invisible the moment anything does. Phase 2E deliberately did
not make `claim_phase1c_run` respect these locks for exactly this reason: a
Phase 1C command declares no file scope, so the sound rule is that an
undeclared scope overlaps everything, and that rule over a lock that cannot
expire is a project that never schedules again with nothing to clear it.

The work, in order:

1. Add `expires_at` and `heartbeat_at` to `task_work_locks`, mirroring
   `graph_work_locks` (which already has both plus
   `expire_abandoned_graph_work_locks`).
2. Give `acquire_task_work_lock` a bounded lease and add a heartbeat function.
3. Add an expiry sweep, and treat an expired lock as not held when testing for
   conflicts.
4. Only then gate `claim_phase1c_run` on held locks in the same project, and
   record the refusal in `scheduling_decisions` like every other withholding.

Until step 4 lands, Phase 2E goal 17 stays PARTIAL, and the reason is written
out in `AI/PHASE_2E_COMPLETION.md` rather than left as a bare score.

## The 2C advisory capacity gate should read the durable limits

Found while merging Phase 2E with `main` (2026-08-15).

`lib/resources/capacity.ts` gates routing on `DEFAULT_CAPACITY_LIMITS`
(2 per worker, 6 per provider, 8 per project) held in code. Phase 2E stores the
authoritative limits in `organizations`, `projects`, `provider_capacity_limits`
and `phase1c_workers`, and enforces them inside the claim transaction.

Both are wanted — one previews, one decides — but the previewing one currently
guesses. When they disagree, the Resource Manager proposes work the scheduler
refuses, and the queue fills with items blocked by a ceiling the router never
consulted.

The work: source `CapacityLimits` from the durable rows (a small read on the
organization, project and provider rows, or a projection alongside
`portfolio_capacity_verdict`), and keep the constants only as the values used
when no row exists. No behaviour of the authoritative gate changes.

## Deferred

- Phase 1C live Codex/OpenAI worker execution: published and schema-current but **Not Connected** until a funded replacement credential passes no-claim preflight and a new current-base command completes live acceptance.
- Phase 1D execution/autonomy beyond the inert observation scaffold: OFF.
- Phase 2A provider execution: source and hosted migration are present, but credentials/live calls are absent and the owner switch remains OFF; **Not Connected**.
- Auto approval, merge, deployment, and rollback: OFF with no executor.
- Phase 1E rollback and repair **execution**: deferred behind a provider adapter, the `AUTO_ROLLBACK.md` drills, and an owner-approved migration relaxing the migration-`010` constraint. Phase 1E records the decision; it never performs the action.

## Phase 2A provider layer integration

- [x] Publish the Phase 2A integration on `main` at `b1060b83a0698a83e202aafdf9792886cf60a8b3`: `lib/providers/*` adapter contract, `/api/providers*` routes, `/api/runs` POST, `/api/agents` POST + `[agentId]/assignment`, `/api/runs/preview`, `ProviderSettings`/`ProviderStatusPanel`/`TaskRunLauncher`, and migration `20260813000100_provider_execution_layer.sql`. See ADR-032 and ADR-033.
- [x] Keep the hardened read path: `/api/runs` and `/api/agents` GET still use the `tenantRpcListResponse` safe-projection RPCs. The branch's versions read directly from tables and would have reverted that boundary, so only its POST handlers were taken.
- [x] Verify the three new provider tables (`provider_model_configurations`, `provider_routing_decisions`, `provider_run_events`) each enable RLS **and** FORCE RLS with tenant-scoped policies before adding them to the service-role grant matrix.
- [x] Restyle the three new provider components onto the design tokens; as merged they used sub-12px text and literal hex values, and `/settings` failed axe contrast at three viewports until fixed.
- [x] Scope the runs sensitive-column guard to the GET handler, matching the existing commands-route assertion. The POST handler records provider run input/output/errors by design; the guarantee protected is that the *list view* never projects them.
- [x] Implement and locally gate the provider assignment control on the RPC-backed `AgentsConsole`, recorded provider/model evidence on `RunsConsole`, and a bounded "Why this provider?" view. Assignment configuration is not live provider health; legacy/missing routing evidence renders as absent rather than being invented. Publication and hosted `130015` promotion remain separate pending items above.
- [ ] Provider execution stays OFF until an owner enables it per organization, and no provider key is set in this repository. Outbound AI execution remains **Not Connected**.

## Universal bot fabric and public marketing site

- [x] Integrate `claude/universal-bot-interface-0caeda` into `main`: `lib/bots/*`, `/api/bots`, `/api/bot-roles`, `/api/bot-assignments`, `BotFabricConsole`, and the public marketing route group. See ADR-036 through ADR-040.
- [x] Split the app into two route groups. `app/layout.tsx` no longer renders the shell; `app/(console)/layout.tsx` supplies it, so `app/(marketing)/*` renders without console chrome. The root layout stays `robots: index:false` and the marketing group opts back in.
- [x] `/` is now the public marketing landing and the console home moved to `/solutions`. The navigation Dashboard entry, the shell logo link, and the active-route check all point at `/solutions`.
- [x] Keep **main's** console pages through the move. Git rename detection carried each `app/*/page.tsx` into `app/(console)/`, and every page was verified byte-identical to main afterwards; the branch's 17-hour-old copies were not adopted. `/solutions` serves main's current dashboard, not the branch's stale duplicate, and it lives in the console group so it keeps the app shell.
- [x] Renumber three colliding migrations. The branch's `20260812002000`/`20260812002100` collided with main's hosted `safe_tenant_list_reads` and `bind_projects_to_github_repository_ids`, and its `20260813000100` collided with the provider layer; the later synthetic-journey migration then occupied `130002`. Hosted filenames are immutable, so the unapplied branch migrations became `20260813000300_bot_fabric_activity_types`, `20260813000400_bot_fabric`, and `20260813000500_marketing_content`.
- [x] Verify security before widening the grant matrix: `bots`, `bot_roles`, `bot_assignments` each enable RLS **and** FORCE RLS with tenant-scoped policies; the eleven marketing tables get both through a `format()` loop, and public read is `revoke all` followed by `grant select` behind a `using (published)` policy.
- [x] Restyle `BotFabricConsole` and the marketing pages onto the design tokens; both arrived with sub-12px text and literal hex values.
- [x] Merge the bot fabric console into Bot Manager alongside main's live request workspace rather than replacing it.
- [x] Ledger-reconcile schema-present `20260812002800`/`20260813000100`-`20260813000500`, then apply the forward chain through `20260813001400` under exact owner RED approvals. Hosted history is current, linked lint is clean, and no schema-present DDL was replayed.
- [ ] Decide whether the marketing site should be publicly indexed before the domain is pointed at it. The marketing group sets `robots: index:true` while the root layout stays `index:false`.

## Solutions page global navigation

- [x] Give `/solutions` the marketing global navigation so someone arriving from the public site keeps that wayfinding. The page moved from `app/(console)/` to `app/(portal)/`, whose layout renders `SiteHeader` above `AppShell`.
- [x] Add a `--shell-top` offset to `AppShell`. Its sidebar and header are `fixed`, so without it they would have sat underneath the global navigation. The variable defaults to `0px`, leaving every other console page byte-identical in behaviour.
- [x] Rename the console navigation landmark from "Primary" to "Console". `/solutions` now carries two navigation landmarks, and two sharing an accessible name leaves screen-reader users unable to tell them apart.

## Console migrated under /solutions

- [x] Move every console page from `app/(console)/` into `app/(portal)/solutions/`, so all twelve destinations sit beneath `/solutions` and inherit the global navigation from the portal layout. `app/(console)/` is removed.
- [x] Rewrite every in-app link to the new paths, including the `next=` sign-in return parameters. API routes under `/api/**` are unchanged and were deliberately excluded from the rewrite.
- [x] Update the GitHub install return-path allowlist in `lib/github/state.ts` to `/solutions/connections`, `/solutions/projects`, and `/solutions/files`. Leaving it unchanged would have broken the connect callback, because the allowlist rejects any path not on it.
- [x] Add permanent redirects from each old console path and its subpaths, so existing links, bookmarks, and in-flight provider callbacks keep working.
- [x] Reduce `app/robots.ts` to the single `/solutions` prefix, which now covers the dashboard and every page beneath it.
- [x] Give the two mobile menu buttons distinct accessible names ("Open site navigation" and "Open console navigation"). Both shells render on every `/solutions` page, and two buttons sharing a name left screen-reader users unable to tell them apart.
- [x] Point the Projects console's "Browse files" link at `/solutions/files`. It was the one in-app link the rewrite missed; it worked only by redirect.
- [x] Restore the console's title metadata. The old `app/(console)/layout.tsx` carried a default and template that the move dropped, so every console tab rendered the marketing home page's title. The portal layout supplies them again and each page exports its own title.
- [x] Remove `/solutions` from `sitemap.ts`. It stopped being a marketing page, so the sitemap was advertising a URL that `robots.txt` disallows and the page itself serves as `noindex, nofollow`.
- [x] Use `title.absolute` rather than `title.default` on the portal layout. A layout's `default` is still run through the parent template, so `/solutions` resolved as "Control plane · AI Software Factory · AI Software Factory".
- [x] Add `tests/integration/console-routing.contract.test.ts` to hold the route tree, the redirects, and the crawler directives in agreement. The sitemap/robots assertion was mutation-checked by re-adding the entry.
- [x] Assert page titles in `tests/e2e/pages.spec.ts`. Metadata resolves through nested layouts, so a wrong title is invisible in the source of the page that shows it; both title regressions were found by reading served HTML. Mutation-checked against the doubled title.
- [x] Verify against live production: twelve `/solutions` pages serve both navigation landmarks and the shell offset, every former path returns `308` preserving query strings and subpaths, and `/solutions/projects` serves `noindex, nofollow` while the marketing home stays indexable.

## Signed-in site state and roles

- [x] Resolve a server-verified viewer in every route-group layout so the signed-in navigation is correct in the first render (ADR-056).
- [x] Show console destinations, the signed-in identity, and sign-out once there is a session; leave the signed-out site unchanged, including the public Solutions entry.
- [x] Add the super-administrator role, configured by server-only `SUPER_ADMIN_EMAILS`, gated on a confirmed email address, with an Admin entry and a server-checked `/solutions/admin` page.
- [ ] **Owner action:** set `SUPER_ADMIN_EMAILS` in Vercel Production and Preview if the role should not use the repository default list.
- [ ] **Owner action:** confirm `Daniel.Hughen@gmail.com` manually in Supabase (Authentication -> Users -> Confirm email). No confirmation email arrives while the project has no custom SMTP, and the super-administrator role requires a confirmed address.
- [ ] Verify the signed-in navigation against the deployed site once an account can be confirmed.

## Maintenance

- [ ] Run final verification on the repository-supported Node version.
- [ ] Before any new hosted database command, reconfirm the authenticated release identity and exact project `qpuofpmagrmyamahqwxw`; do not fall back to the previously wrong/unauthorized profile.
- [x] Move Vitest configuration to native ESM (`vitest.config.mts`) to remove the prior config-loader warning.
- [ ] Expand authenticated E2E once a safe disposable live-provider fixture exists.

## Owner review - protected delivery controls

These are recorded for deliberate owner review and are not evidence that Phase 1B provider acceptance passed:

- [ ] Decide whether to enable protection/required checks and require verified signatures on `main`; the branch is currently unprotected and the published release commit is unsigned. Any settings change is a protected owner-approved action.
- [ ] Decide the `theagoras.com` aliases with the routing question now answered by evidence: both `*.vercel.app` hosts are behind Vercel SSO Deployment Protection, so `www.theagoras.com` is the **only** public path to the application. Removing the aliases would take the public site offline. See `AI/PRODUCTION_OBSERVATION_EVIDENCE.md`.
- [ ] Decide whether production keeps Vercel Deployment Protection. While it is on, no external monitor — this one or any third party — can observe the deployment URLs recorded as production.

## Delete a selection of pipelines (2026-08-23, owner goal, ADR-130)

- [x] `20260823000200` adds `delete_selected_pipelines`, the scoped sibling
  of `clear_all_pipelines`: same caller check, same mandatory reason, live
  work never deleted, run history never taken unless explicitly included,
  plus organization scoping (a foreign id is counted, never acted on) and a
  200-row cap. Eleven behaviour cases against real PostgreSQL.
- [x] `POST /api/commands/delete` carries no authority of its own and
  reports the database's own refusal sentence; five boundary cases.
- [x] The Pipelines page gains a checkbox per row, a select-all with an
  indeterminate partial state, and a Delete selected (N) button that
  confirms, requires the reason, and names what was kept.
- [x] Applied on hosted through the one-shot
  `scope=delete-selected-pipelines` (sha-pinned, run 32647755059), whose
  read-back proved SECURITY DEFINER and owner+authenticated-only execute.
- [x] Proven live on production without destroying anything: signed in as
  the fake journey account, a selection of one id that does not exist
  answered `{deletedCount: 0, keptRunning: 0, keptWithRuns: 0, notFound: 1}`
  — a response only the hosted function can produce, so session, route,
  PostgREST and function are all on the path. Unauthenticated posts get
  `authentication_required` (401), cross-origin gets
  `invalid_request_origin` (403), and an empty selection or short reason
  gets `invalid_delete_request` (400).
- [x] Selecting a pipeline now **stops** it (owner instruction, ADR-131):
  the first press hit "0 pipelines deleted. Kept: 2 still running." on two
  record-only rows that had been `queued` for one and fourteen hours and
  could never be claimed. `20260823000300` cancels a selected command's
  runs, tasks and itself before removal, and detaches its analysis graph
  rather than being refused by that link's restrict foreign key — the graph,
  its run and its artifacts survive. Applied on hosted; the function's
  argument list reads back with `stopped_count` and without `kept_running`
  (probe run 32649207253), and the live endpoint answers in the new shape.
- [x] The `stop-and-delete-pipelines` scope's first run (32649087847)
  **applied and recorded the migration, then failed on its own readback**:
  `'stopped_count' = any(subquery)` is the subquery form, so PostgreSQL
  coerced the scalar to an array and raised `malformed array literal`.
  Fixed to array containment, and `scope=probe` now reports the function's
  argument names so applied state is confirmable without re-running a
  one-shot scope.
- [ ] Still unexercised: an actual deletion of a real production row, and
  the kept-with-runs / kept-with-evidence branches against live data. Those
  need rows the owner is willing to lose.

## Two blockers behind the delete, and one migration finished (2026-08-23, ADR-132/133)

- [x] `factory command routing evidence is immutable` was the third blocker
  between the owner and a working delete. `20260823000400` lets the audited
  delete release a route while an UPDATE stays refused and no client role
  gains anything; proven by behaviour against the real hosted rows in a
  rolled-back transaction (`update refused=t delete refused=t`, apply run
  32652305439).
- [x] `20260814002500_provider_credential_vault` is finished and recorded
  (apply run 32653491713). Probe run 32652393423 measured it first: only
  `resolve_provider_connect_session` was missing. That single gap was
  answering every correct bot sign-in code with `connect_session_invalid`,
  and its unrecorded ledger row was what made Supabase's preview branch
  replay the file into a 42P07 on every commit.
- [ ] `Supabase Preview` **stays red**, and the vault repair should not be
  read as fixing it — though it verifiably advanced the replay. Before: the
  preview died on 20260814002500 (42P07, duplicate table). After (checked on
  379a0193): it dies on **20260815000200** with
  `column "maximum_concurrent_runs" of relation "organizations" already
  exists` (42701, duplicate column). Same partial-apply class, next file
  along. The replay runs in version order, so the earliest unrecorded file
  whose objects already exist is always the one that fails — an earlier note
  guessed `20260821000400` would be next on the strength of its table
  existing, which was right about the class and wrong about the order.
  The ledger listing in apply run 32657726992 (2026-08-23) shows **18**
  unrecorded versions: 20260815000200/000300/000400/000500/000600/000800/
  000900/001100/001200/001300/001400/001500/001600,
  20260816000100/000200/000300/001600, and 20260821000400. An earlier count of
  20 included 20260814002500 and 20260814002600, both of which are now
  recorded. Each wants the same
  measure-then-finish discipline the vault got — a probe inventory first,
  finish only what is missing, record the ledger row only once every declared
  object is present. Applying them blind is how this class of problem began.
- [ ] The bot sign-in claim path has not been exercised end to end since the
  function landed. The database half is verified; the flow itself wants a
  real connect attempt.

## Autonomy Clear control (2026-08-23, owner goal, ADR-134)

- [x] `20260823000600` adds `clear_autonomy_projects` (owner-or-admin, reason
  required, archives through `archive_project` so nothing is deleted) and
  narrows `list_autonomy_status` to exclude archived projects, which is what
  empties the section.
- [x] `POST /api/autonomy/clear` carries no authority of its own; the Clear
  control sits beside Refresh, confirms first, and says "Nothing was deleted".
- [x] Seven behaviour cases against real PostgreSQL, including two that assert
  the guards this design did not touch still refuse: project deletion and any
  activity-event mutation.
- [x] The first hosted apply (run 32656024602) **failed and rolled back
  cleanly**, applying nothing. Its own postflight refused because
  `projects_guarded_deletion` is absent on hosted — `20260815000900` is one of
  the unrecorded migrations listed above. The protection is not absent: the
  `activity_events -> projects` `ON DELETE RESTRICT` is there, and that
  trigger's own comment says nothing passes it. The postflight now asserts
  that constraint and only *notices* the trigger's absence, and the scope's
  rolled-back proof accepts SQLSTATE `23503` as well as the trigger's
  sentence.
- [x] Applied on hosted (run 32657726992). The ledger records
  `20260823000600`; the postflight raised its expected notice about the absent
  trigger; the rolled-back proof against real rows reported `GUARD: project
  deletion still refused`; the readback confirmed owner+authenticated-only
  execute and the surviving RESTRICT.
- [ ] Pressing Clear against the owner's own projects is theirs to do, not
  mine. The control is live on the Autonomy page and will archive every
  project the loop can still act on.

## The decision page and the renamed navigation (2026-08-23, owner goal, ADR-135)

- [x] `/decision` renders the two products as chooser cards, with Getting
  started beneath them and a Quick overview + Recent activity rail. Every
  number is counted from the viewer's own records; a source that cannot be
  read says "Unavailable" on its own row rather than showing a confident zero.
- [x] Three gates before it renders: signed out to sign-in, no workspace
  through onboarding and back, closed gate to `/solutions`.
- [x] "Only on initial login" is a 15-minute HTTP-only marker opened by the
  password route and the auth callback and closed by choosing. Choosing is a
  Server Action, not a link, so a prefetch cannot dismiss the page.
- [x] One default destination, in one place: the sign-in page forwards only a
  `next` the caller supplied, and the generic Sign In entries in the header
  and footer no longer pin `/solutions`.
- [x] Global navigation: `Software Factory` and `Job Seeker`, and no
  Administration entry for anyone. The console column still lists Admin for
  super administrators, and `/solutions/admin` is unchanged.
- [x] Covered by unit tests for the gate, the page's three redirects, the
  overview's failure behaviour, and the renamed header; by the entry-point
  contract; and in a real browser at every width through the harness case
  `decision-overview` and the signed-in header assertion.
- [x] **Fixed same day: the page was unreachable for everyone already signed
  in.** The gate defaulted to closed, so a session that predated the feature
  had no marker and `/decision` redirected to `/solutions`. The marker now
  records the decision rather than the permission: absent renders the chooser,
  `chosen` redirects, signing in and signing out both clear it.
- [ ] The owner should confirm the page matches their image. It was built from
  the described structure — two product cards (BUILD / GROW), Getting started,
  Quick overview and Recent activity — and the wording is mine, not theirs.
- [ ] The sidebar keeps its own `AI Factory` entry, which points at the guided
  journey (`/solutions/ai-factory`) rather than the console root. If the owner
  wants that renamed too, it is a one-line change plus its nav contract test.

## Graph round 5: DISCOVER/EVALUATE/DECIDE capabilities (2026-08-23, owner goal, ADR-137)

- [x] Typed stage packages (`lib/graph/stage-packages.ts`): discovery
  candidates labelled by how they are known, a recalled candidate can never
  claim repository verification, popularity metrics absent by schema; fixed
  100-point evaluation rubric with the weighted total computed, not trusted;
  decisions must weigh all five paths exactly once.
- [x] Capabilities `discovery`/`evaluation`/`decision` + template
  `open_source_scout` (clarify → three parallel scans → consolidate →
  evaluate → decide), every package node contract-enforced.
- [x] `SDLC_STAGES` grown to eleven; migrations 20260823000800/000900 replay
  green in PGlite; workflow scope `discovery-stages` sha-pinned and one-shot.
- [x] **Applied on hosted** (run 32665300909): both migrations applied, both
  in-file postflights passed on the production database — 20260823000800's
  hard-fails unless the enum reads exactly the eleven labels in order, and it
  did not — and both ledger rows recorded. The run itself shows **failure**
  because the workflow's own readback query compared `name[]` to `text[]`
  after everything real had succeeded; the query is fixed (`enumlabel::text`)
  and is now executed verbatim against the replayed database in
  `tests/integration/discovery-stages.behavior.test.ts`, so a verifier that
  cannot parse fails at commit time instead of after a production apply. The
  scope is one-shot and correctly refuses a re-run now that the versions are
  recorded.
- [ ] Owner-gated: WebSearch/WebFetch on discovery nodes would make ecosystem
  candidates live-verifiable; today they are honestly MODEL_KNOWLEDGE.
- [ ] Round 6+: scout→agentic_sdlc chaining (the one-request experience);
  the DECIDE package is shaped for the ARCHITECT handoff already.


## Graph round 9: one request through all ten phases (2026-08-23, owner /goal, ADR-138)

- [x] `full_lifecycle` template: the scout's chain stitched into the SDLC's
  build half; 14 nodes, all eleven stages, two HUMAN gates
  (ARCHITECTURE, DEPLOYMENT), monitor→goal feedback. Zero new machinery.
- [x] Worker job timeout 180→240min to outlive the 220min template budget;
  the budget-fit suite pins node envelope → budget → workflow timeout.
- [x] Behaviour proof against real PostgreSQL through create_graph_from_plan:
  stage coverage, forward-only stage order, gate placement, feedback loop.
- [ ] Live drain of a full_lifecycle launch (owner-initiated) — the graph
  halts at the ARCHITECTURE human gate by design; deciding it is the owner's.

## Budget Tracker: hosted apply and the parts not built (2026-08-29, ADR-147/148)

The page, its schema and its tests are complete and green locally. What is
outstanding:

- [x] **Hosted apply, owner-directed.** Both migrations applied 2026-08-29 via
  the `budget-tracker` scope (run 33257354301); postflights verified RLS
  forced, no `anon` or `service_role` grants, and both reads INVOKER.
- [x] Categories now have their own page (/BudgetTracker/categories): rename,
  retone, set or clear the monthly ceiling, archive/restore. Kind is
  deliberately not editable (history was classified under it — the PATCH
  route refuses the field) and there is no delete (ledger rows reference
  categories `on delete set null`; archiving keeps history honest). The
  monthly plan table (`budget_month_plans`) still has no panel on top of
  its schema and `compareToPlan` analytics; that remains open below.
- [ ] A panel on top of `budget_month_plans` + `compareToPlan` — the plan
  table has schema and analytics and no surface yet.
- [ ] Transfers get a `transfer_group_id` column and nothing populates it. Both
  sides of a move between the person's own accounts are typed correctly and
  excluded from spend, but they are not yet linked to each other.
- [ ] `reconcile()` finds where a statement's running total stops agreeing with
  its own amounts — 38 breaks in the owner's 8,040 rows — and nothing surfaces
  it on the page yet.
- [ ] Editing and deleting a transaction. The ledger is currently append-only
  through the UI; the RLS policies already allow update and delete.

## No learning edge from accepted results (found 2026-08-29, design gap)

`AI/LOOPS_AND_GRAPHS.md` records the split between a correction edge (a gate
returns one unit to the node that produced it, fixing the run in flight) and a
learning edge (an accepted result returns to the splitter as a constraint,
fixing every run after). This repository has the first and not the second.

Nothing derives a reusable constraint from an accepted node output, and nothing
feeds one into the planning brief, so every graph is planned with the same
blind spots as the last one and a failure fixed today is available to recur.
The engine is fast and does not get smarter.

Building it needs an ADR and owner direction before code, because the failure
mode is severe in the other direction: a derived constraint is an instruction
the planner cannot see the provenance of, and a wrong one narrows every later
plan silently. At minimum a constraint would need an owning run, the evidence
it was derived from, an expiry or review path, and a frozen-policy check so it
can never widen risk, budget, isolation or approval.

- [ ] ADR: what a derived constraint is, who may create one, how it expires.
- [ ] Constraint store with provenance back to the accepting verification.
- [ ] Planner brief reads constraints; `frozen.ts` proves none can relax a policy.
- [ ] Behaviour test: an accepted result changes how the *next* graph is cut.

## Resumable lifecycle runs (found 2026-08-24, owner-visible cost)

Gates are keyed to graph nodes so approvals outlive runs — correct — but a
reclaim re-executes every node from the beginning: claim_planned_graph
queues all nodes PENDING and the runner has no memory of a prior run's
COMPLETED outputs. A full_lifecycle pass therefore costs roughly three
times its model-node count in subscription sessions (run to the
ARCHITECTURE gate, re-run everything to the TEST gate, re-run everything
to the deploy refusal). With the day's session windows this stretches one
lifecycle across multiple windows. The fix is an engine design change —
reuse the same graph iteration's COMPLETED node outputs (artifacts already
persist) instead of re-executing them — and needs an ADR and owner
direction before building: replaying stale outputs across a decision that
requested rework is the failure mode to design against.

## Step 8 stale-error containment (2026-08-27)

- [x] Distinguish the old Aug 22 client error from a current hosted database rejection using production request and migration evidence.
- [x] Clear result state on a changed/remounted command intent and expose a same-idempotency Retry command action.
- [x] Map the two exact legacy command-plan/schema-skew refusals to a safe actionable `503` response.
- [x] Render the server-verified signed-out gate immediately, skip all
  protected client reads while signed out, deduplicate the layout/page viewer
  lookup per request, and bound that presentation lookup to five seconds.
- [x] Publish exact `main` `bb68659a0ee84370f83dd647ae57f4ccb83ea06c`;
  CI run `33149814278` passed quality and all three browser/accessibility jobs,
  and Vercel `dpl_2A2bhtevZeBY6422ZYjVGJE5SuTU` / deployment `6137077047`
  is READY behind `www.theagoras.com`.
- [x] Reload current production as `daniel.hughen@gmail.com` and close the
  stale-client diagnosis: exact deployment logs have authenticated GETs but
  zero `POST /api/commands` and no command-route 4xx/5xx.
- [ ] Complete provider OAuth and route setup. The fresh tenant currently has
  zero connected AI accounts, ready bots, or assignments; one Codex account is
  unfinished and Claude OAuth is incomplete. Only then submit a new Step 8
  command and accept its persisted Step 9 correlation.

## Ten-step Factory v2 production release (2026-08-28)

- [x] Rebase and locally audit candidate
  `ead498b495ac59d920e6f76df7917ea830dbcf8c`: Requirements -> Monitor
  lifecycle, exact release identity, Phase 1C lineage, strict gates, and exact
  Factory graph/run selection. Focused release verification passes 18 files /
  207 tests plus lint, typecheck, production build, and diff-check.
- [x] Isolate the forward cutover into `20260827000150` and `20260827000200`
  with dedicated one-shot scopes. Stable LF-normalized SHA-256 identities are
  `A4B505841D94CC89DFC82E24837DEDB78356B56C5F5698C0748F8B6735341A49`
  and `23197552DF3F442AE8264BF71BD28A7C479E09A64BF6E298C615B767A96572BE`.
- [x] Publish exact release `bb68659a0ee84370f83dd647ae57f4ccb83ea06c`;
  exact-head CI `33149814278` passed quality and all three browser/accessibility
  jobs, and Vercel `dpl_2A2bhtevZeBY6422ZYjVGJE5SuTU` / deployment
  `6137077047` is READY behind `www.theagoras.com`.
- [x] Apply only `20260827000150` and verify its ledger/catalog/fence/safety
  postflight. Run `33144600401` passed with legacy authority fenced, graph and
  Phase 1C running rows `0|0`, and the stopped safety envelope preserved.
- [x] Probe exact hosted legacy state in run `33150619218`: four rows, manifest
  SHA-256 `784acaca2b0957ecb0eeea85e3d0dde2e64ba653c744e708ec8d4094f9175b99`,
  and all four downstream blocker counts zero.
- [x] Apply only `20260827000210` in run `33150654596`, then unchanged
  `20260827000200` in run `33150707932`. Both exact-manifest operations passed
  ledger/catalog/ACL/RLS/audit/runtime/lint/health and stopped-safety
  postflights. Never reset, replay `00150`, or down-migrate.
- [ ] Reconnect a fresh supported owner AI account and verify reload
  stickiness, then complete signed-in production Steps 8 and 9 against the
  exact release. The former Claude bot/account was explicitly removed on
  2026-08-23, so its absence is not a current planner regression.
- [x] Preserve workers, provider execution, autonomous mode, and all automatic
  actions OFF with the global kill switch ON throughout hosted acceptance.

## Hosted apply workflow-size recovery (2026-08-28)

- [x] Diagnose run `33143231202`: exact `fd47242`, queued with zero jobs because
  the 517,320-byte workflow exceeded GitHub Actions' 500 KB file limit; prove no
  migration statement executed.
- [x] Reduce only workflow prose/comment bytes, keep every executable scope and
  protected identity unchanged, and add a regression test requiring less than
  490,000 UTF-8 bytes. Focused verification: 8 files / 63 tests, lint, and
  typecheck green.
- [x] Publish the forward recovery as exact main
  `0880191b367d12d42f8ce4af9c267657c10c5fce`, require exact-head CI and READY
  Vercel, prove the zero-job oversized-SHA orphan never executed, and apply
  `00150` exactly once.
- [x] Diagnose failed lineage run `33144659265`: legacy graph artifact payload
  violates the new sensitive-data or size boundary. The single transaction
  rolled back all `00200` DDL and its ledger insert; no partial v2 catalog
  survived.
- [x] Add forward migration
  `20260827000210_contain_legacy_graph_artifact_payloads.sql` and a dedicated
  payload-free, manifest-pinned `probe` / `contain` / `lineage` workflow. The candidate
  stores only bounded immutable digest/classification evidence and tombstones
  the offending payload; it never logs payloads or row identifiers.
- [x] Harden the local candidate after security review: serialize all three
  operations with every hosted-migration scope; lock `node_runs` with artifact
  state; require all nine legacy signatures revoked before v2 and, afterward,
  eight revoked plus exact authenticated-only/evidence-bound
  `decide_node_gate`; reject future-dated active/draining heartbeats; recheck
  worker-stopped state after apply; and move ACL/RLS/audit-trigger acceptance
  inside each migration transaction so failure rolls back DDL and ledger
  together.
- [x] Release exact `bb68659a0ee84370f83dd647ae57f4ccb83ea06c`; CI
  `33149814278` and Vercel `dpl_2A2bhtevZeBY6422ZYjVGJE5SuTU` are exact and
  green. Probe `33150619218` reported the exact four-row manifest
  `784acaca2b0957ecb0eeea85e3d0dde2e64ba653c744e708ec8d4094f9175b99`;
  contain `33150654596` applied only `00210` and passed every postflight.
- [x] After exact hosted `00210` acceptance, lineage run `33150707932` staged
  only unchanged hash-pinned `00200`, reconstituted the exact manifest from
  private audit rows, and passed transactional plus post-commit ledger,
  catalog, RLS, tombstone, ACL, audit, runtime, lint, health, and stopped-safety
  checks.
- [ ] Finish Claude OAuth or the unfinished Codex connection, create a ready
  bot and project assignment, then submit a fresh signed-in Step 8 request.
  Require a production POST, immutable record-only route evidence, and truthful
  persisted Step 9 state with all execution surfaces still OFF. The fresh
  current-production session has no such route yet, so acceptance is not
  claimed.
