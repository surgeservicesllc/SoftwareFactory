# Backlog

Last triaged: 2026-08-28

## Exact Blackstone Supabase Auth bootstrap (2026-08-28, ADR-160)

- [x] Add an exact-email/project/actor/first-attempt workflow that receives the
  password only through an encrypted temporary repository secret, creates or
  updates through the GoTrue Admin API, and re-verifies unique UUID plus
  `email_confirmed_at` without logging credentials or response payloads.
- [ ] Publish and run the workflow once with confirmation phrase
  `CONFIRM BLACKSTONE SUPABASE AUTH BOOTSTRAP`; verify its exact successful
  bounded result.
- [ ] Delete `BLACKSTONE_SUPABASE_BOOTSTRAP_PASSWORD` immediately after the
  accepted run, then remove the temporary workflow and its test in a forward
  cleanup commit. Do not infer any organization membership or application role
  from an Auth identity alone.

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
- [ ] Publish the selector-normalization containment, pass all four exact-head
  jobs plus exact READY Vercel/health identity, then run a fresh read-only
  probe. Do not rerun failed probe `33159805326`.
- [ ] Apply only `20260828000050`, verify its exact ledger/catalog/ACL/runtime
  and stopped-safety postflight, then apply only `20260828000100`,
  `20260828000200`, and `20260828000300` through their ordered forward-only
  scopes and accept every postflight.
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
- [ ] Publish and apply only
  `20260828000100_project_production_url_configuration.sql` (LF SHA-256
  `0856ddee447280a1bb4418f25d6a6d4650687e168fffcd5e98e8ce15edd62b27`) through the
  protected hosted path, then configure the intended project through its
  signed-in owner/admin UI and verify one immutable audit event. No live value
  was set by the local implementation.

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
- **`node_runs.attempt` bridge** (task #56) is unrelated to billing but
  queued behind the same release for migration-ordering reasons.

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
- [ ] Dispatch `scope=probe` for the independent second read of the two
  functions' privileges. The apply's own gate passed; a step that grades its
  own work is the weaker evidence, and the probe read exists but has not been
  run.

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
- [ ] Move the remaining manual `POST /api/job-seeker/jobs` insert chain onto
  the atomic boundary, add its regression, then revoke authenticated direct
  INSERT on jobs/matches/applications in a separate forward contraction. Do
  not revoke while that application path still depends on the grants.
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
- [ ] Resolve the residual probe limitation: a public hostname that resolves to a private address at DNS time is not detected.

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
