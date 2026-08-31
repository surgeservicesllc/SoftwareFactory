# Applying the unhosted migrations

Written 2026-08-14, after verifying the whole chain on a real PostgreSQL 16 cluster.
Rebased 2026-08-16 on an owner-measured hosted position (see the section directly below).

## Grok immutable provider-admission tail (2026-08-31)

Use only `.github/workflows/grok-bot-release-migrations.yml` for migration
`20260831000100_grok_provider_admission.sql`. Its protected canonical-LF
SHA-256 is
`37809d9b3d9bc760ffbee501fcca383f0daa5665fb047964734603ceed41aef7`.
Do not add it to a broad migration scope, run `db push`, or apply any other
file with it.

Choose one reviewed 40-character `surgeservicesllc/SoftwareFactory` `main`
commit and pass that same value as `release_sha` to every dispatch. Before any
database connection the workflow requires the exact dispatch checkout and live
`main`, all four exact-head quality/browser-accessibility jobs green, the exact
SHA READY as the latest successful Vercel Production deployment, matching
public health/Vercel/Supabase identities, every execution and auth workflow
stopped, worker switches OFF, the auth broker disabled, autonomy and all nine
automatic actions OFF, and every global kill switch ON.

Run fresh workflow dispatches in this exact order:

1. `scope=probe` — read-only. Require the existing Grok release ledger prefix
   through `20260830010000` exactly once, the seven legacy Grok tables, and
   `20260831000100` plus every provider-admission catalog object either all
   absent or all already present. Save no row payloads or credential material.
2. `scope=provider-admission`, `confirm=apply` — stages only the protected
   `20260831000100` file, requires ledger `1|1|1|1|1:0`, exact old-launcher
   source/owner/SECURITY DEFINER/search path/ACL and dependencies, and a pristine
   provider-admission catalog. It locks the ledger and affected catalogs,
   applies the one file, validates the v2 PL/pgSQL function, and records only
   `20260831000100` in the same transaction. Never rerun this mutation attempt.
3. Require its postflight to prove eight private forced-RLS Grok tables, exactly
   20 named Grok functions, 18 Grok triggers (16 immutable-rejection triggers),
   the exact admission table policy/ACL, 27 validated constraints, seven valid
   indexes, both composite unique keys, exact helper/v2 source and ABI/ACL, and
   denial of `service_role` on the old launcher. The rollback-only database
   canary must deny the old launcher, refuse a stale assignment revision with
   zero residue, accept and exactly replay v2, verify every admission hash,
   reject update/delete/truncate, keep the canonical graph paused, create zero
   graph/node runs, and leave no durable canary session or launch after rollback.
4. `scope=verify` — fresh, read-only. Require the same exact deployed SHA and
   stopped safety state, `20260831000100` exactly once, and repeat the complete
   catalog, ACL, lint, runtime, rollback, health, and live-`main` verification.

The database workflow proves the stored provider-admission boundary but does
not by itself prove a signed-in browser's route, reload, and presentation.
Before describing the whole Grok path as production-ready, separately accept
the signed-in production queue/reload flow against the same exact deployment;
keep all workers and automatic actions OFF and the kill switch ON during that
acceptance. Any identity, ledger, hash, catalog, ACL, runtime, lint, browser,
health, or safety mismatch stops the release. Never reset, repair migration
history, down-migrate, or replay a recorded version. Contain only with a newly
reviewed forward migration.

## Full Lifecycle v2 release tail (2026-08-28)

Use only `.github/workflows/factory-lifecycle-release-migrations.yml` for this
four-file release. Do not add these files to the broad hosted-migration
workflow. The protected LF byte identities are:

- `20260828000050_normalize_breaker_aware_phase1c_selector.sql` — SHA-256
  `8914034508451d1550ebf3f1bedd8f7b71592f1809306e78c57774c458952896`;
- `20260828000100_project_production_url_configuration.sql` — SHA-256
  `0856ddee447280a1bb4418f25d6a6d4650687e168fffcd5e98e8ce15edd62b27`;
- `20260828000200_target_bound_worker_claims.sql` — SHA-256
  `f7d87242534e16bacd22c0244784a992bded3c335fcb0a38e85d8a6b9168eaa5`;
- `20260828000300_graph_postdeploy_validation.sql` — SHA-256
  `0104f4b6514eb42fddb931b76a8026cea4834547f8dff011c2fff956d11579a5`.

The workflow is manual and shares the global `apply-hosted-migrations`
concurrency lock. Every scope binds exact repository `main`, the four named
exact-head CI checks, the latest successful Vercel Production deployment, and
Supabase project `qpuofpmagrmyamahqwxw`. Public health must join the exact
GitHub deployment URL to Vercel project
`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`, its immutable deployment ID/URL, main
SHA/ref, and `www.theagoras.com`. Mutation scopes additionally require
`confirm=apply`, the configured exact production-release actor as both the
original and triggering actor, and run attempt 1. **Never rerun a mutation
workflow attempt**; create a fresh dispatch after diagnosing a failure. Before
and after every operation it refuses an active execution/auth workflow, a
running graph or agent run, Autonomous Mode, any of the nine automatic
actions, a worker switch outside OFF, an enabled auth broker, or an
organization whose global kill switch is not ON.

Choose the reviewed 40-character `main` commit once and pass that same exact
value as `release_sha` to every dispatch below. The workflow requires it to
equal both the dispatch snapshot and the live `main` ref at preflight, then
rechecks live `main` immediately before any database mutation. Never replace
the value between scopes; publish a new release and restart at `probe` if main
advances.

Run the scopes separately and in this exact order:

1. `scope=probe` — read-only. Require prerequisite ledger rows `20260827000200`
   and `20260827000210` exactly once and one of the five canonical six-field
   release-tail prefixes (`0000`, `1000`, `1100`, `1110`, or `1111`) for
   `00050|00100|00200|00300`. Record no secrets or row payloads.
2. `scope=selector-normalization`, `confirm=apply` — stages only the
   hash-pinned `00050` file. It requires exact hosted selector hash
   `ed5840b9d8d0efdb513a8576df128e9b`, exact graph selector and breaker
   dependencies, private selector ACLs, absent target-claim objects, and the
   exact `1|1|0|0|0|0` ledger. It commits only the selector replacement and
   `00050` row in one PostgreSQL transaction. Require the phase selector to
   become `5933952d71f9da90a2a80a05ce6e0378` with every ABI/ACL/dependency
   invariant unchanged.
3. Dispatch a fresh `scope=probe` — read-only — and require
   `1|1|1|0|0|0` plus the normalized selector identity. Never rerun the first
   probe or the mutation attempt.
4. `scope=configure-url`, `confirm=apply` — stages only the hash-pinned `00100`
   file. Under the ledger and stopped-state locks, it requires `00050=1` and
   all three later rows/catalog objects absent, then commits DDL and the
   `00100` ledger row in one PostgreSQL transaction.
5. Accept the application and safe owner/admin production-URL writer before
   continuing. Then dispatch `scope=target-claims`, `confirm=apply`. It requires
   `00050/00100=1/1` and `00200/00300=0/0`, stages only `00200`, and
   atomically records only `00200`.
6. Accept the exact target-bound claim behavior and the signed-in production
   lifecycle UI before dispatching `scope=postdeploy`, `confirm=apply`. It
   requires `00050/00100/00200/00300=1/1/1/0`, stages only `00300`, and
   atomically records only `00300`.
7. Dispatch `scope=verify` — read-only. It requires all four rows exactly
   once, rechecks the public-URL constraint/RLS/audit boundary and safe/unsafe
   runtime values, the service-only exact-target wrappers and target assertion,
   the canonical Full Lifecycle v2 plan digest, the service-only validated
   completion boundary and its fail-closed runtime, PostgREST reload, stopped
   database state, and stopped GitHub worker workflows.

Every mutation stages exactly one file in an isolated temporary directory and
uses `psql --single-transaction` for its locked catalog guard, migration DDL,
and ledger insert. It reloads PostgREST only after commit. On any identity,
ledger, catalog, ACL, runtime, safety, worker, CI, or deployment mismatch, stop.
Never reset, rerun an already recorded version, down-migrate, or broaden the
scope. Contain a defect with a newly reviewed forward migration.

## Atomic job recording release (2026-08-27)

Migration `20260827000100_record_job_seeker_job_atomically.sql` is a protected,
one-file hosted change. Its frozen SHA-256 is
`2f51bf64ba3fd2bc711e6fbf9e660a2cc0dd5ef4b1f85d932ee574e79e9c7d13`.
It has not been applied merely because it exists in this worktree.

Apply it only by manually dispatching `apply-hosted-migrations.yml` from the
exact deployed `main` SHA with `scope=job-seeker-atomic-record`. The scope binds
the repository and Supabase project identities, requires the target ledger row
and new catalog objects to be absent, verifies the prerequisite job-seeker
tables/enums/function/foreign keys and forced RLS, stages exactly this one file,
then commits its DDL and ledger row in one PostgreSQL transaction. It reloads
PostgREST and reads back the exact function signature, authenticated-only ACL,
validated owner-consistent constraints, retired legacy foreign keys, ledger,
and forced-RLS state. Any mismatch stops the run; containment is forward-only.
The broad `scope=all` path is blocked until this version is recorded exactly
once under its frozen file hash.

## Graph/Phase 1C atomic-wrapper cutover (2026-08-27)

This is an ordered database protocol cutover, never a bundled apply. The
protected file identities are:

- `20260827000150_fence_legacy_graph_protocol.sql` — SHA-256
  `a4b505841d94cc89dfc82e24837dedb78356b56c5f5698c0748f8b6735341a49`;
- `20260827000200_graph_phase1c_release_lineage.sql` — SHA-256
  `23197552df3f442ae8264bf71bd28a7c479e09a64bf6e298c615b767a96572be`;
- forward containment `20260827000210_contain_legacy_graph_artifact_payloads.sql`
  — SHA-256 `c37a55efe74e9a9b4118924e1b2cbd0378a76f0d98c9747c6c66fffda9697de1`.

The mandatory release order is exact:

1. Publish the matching application, worker, workflow, and migration files to
   exact `surgeservicesllc/SoftwareFactory` `main`. Require the four exact-head
   CI jobs green and the exact SHA READY in Vercel Production. Keep graph and
   Phase 1C worker dispatch paused; keep every organization and project at
   autonomous mode OFF, every automatic action OFF, and every organization
   kill switch ON. The hosted workflow verifies that neither worker workflow
   has an active run, but that check does not pause dispatch on the owner's
   behalf.
2. Dispatch `apply-hosted-migrations.yml` with
   `scope=graph-protocol-fence`. This scope stages only `20260827000150`, pins
   its hash and exact repository/project/ledger/catalog/safety identities, and
   commits its revocations plus its ledger row in one PostgreSQL transaction.
   It installs no v2 authority. Verify 00150 exactly once, 00200 absent, and
   every listed legacy graph/Phase 1C entry point non-executable by `anon`,
   `authenticated`, and `service_role`.
3. Keep dispatch paused and drain. Do not start 00200 until `graph_runs` has
   zero `RUNNING` rows, `agent_runs` has zero `running` rows, there is no fresh
   or future-dated active/draining worker heartbeat, and no legacy graph call
   or lock remains. A future-skewed heartbeat is ambiguous active evidence and
   fails closed; it is never treated as stale or ignored.
   Recheck autonomy OFF, all nine automatic actions OFF, and kill switches ON.
   An old call that entered before 00150 may finish; never reset or rerun 00150
   to hurry it.
4. If `00200` stops at `legacy graph artifact payload is sensitive or
   oversized`, do not rerun it against the same catalog. Its protected
   `--single-transaction` invocation rolls back both DDL and ledger. Publish
   forward migration
   `20260827000210_contain_legacy_graph_artifact_payloads.sql` (SHA-256
   `c37a55efe74e9a9b4118924e1b2cbd0378a76f0d98c9747c6c66fffda9697de1`)
   plus `.github/workflows/graph-artifact-containment.yml`. From the exact
   green/READY `main` release, dispatch `operation=probe`; it may report only
   the positive candidate count, payload-free manifest SHA-256, aggregate
   classification, and four zero downstream blocker counts. Never log a
   payload or row identifier.
5. Dispatch `operation=contain` only with that exact count and manifest. The
   workflow rechecks them while holding the graph state locks, stages only the
   hash-pinned `00210` file, removes the unsafe bodies, preserves private
   immutable digest/classification evidence, validates both payload guards,
   and records only `00210`. Before v2 exists, the migration and wrapper must
   require all nine legacy signatures to remain non-executable by `anon`,
   `authenticated`, and `service_role`; freeze `node_runs` with the artifact
   tables; reject fresh or future-skewed active/draining heartbeats; and
   validate payload constraints, FORCE RLS, zero app-role table ACLs, and both
   immutable triggers inside the same transaction before its ledger insert can
   commit. Repeat those checks after commit, including worker-stopped state.
   Require `00150/00200/00210=1/0/1` and zero remaining violations. A changed
   manifest or nonzero downstream blocker requires another reviewed forward
   repair.
6. Only after that exact acceptance, dispatch the same dedicated
   `graph-artifact-containment.yml` with `operation=lineage`. All three
   operations share the `apply-hosted-migrations` concurrency group, so no
   other production DDL scope can overlap them. `lineage` requires the same
   positive candidate count and manifest SHA-256 recorded from `probe`, then
   reconstitutes that exact manifest from the private containment-audit rows
   before locking, under the exclusive lock, and after commit. It also requires
   `00150/00200/00210=1/0/1`, all nine legacy signatures fully revoked in the
   pre-v2 state, the stopped/future-heartbeat safety state, exact
   evidence-linked tombstones, owner-only raw table/function ACLs for the
   private audit boundary, and the frozen unchanged `00200` SHA-256. It stages
   only `00200` and atomically validates its new ACL/RLS/audit catalog before
   committing its DDL and ledger row.
7. Require the postflight to read back all three ledger rows exactly once;
   eight private legacy claims/writes/recorders; and the intentionally replaced
   `decide_node_gate(uuid,boolean,text)` as authenticated-execute only (anonymous
   and service-role refused), `SECURITY DEFINER`, exact
   `search_path=pg_catalog`, owner/admin-gated, and evidence-bound for full
   lifecycle and automatic approvals. Also require service-only v2
   claim, repository/policy-scoped diagnosis, atomic abort and release-lineage
   writers; hardened `SECURITY DEFINER`/`search_path=pg_catalog`; exact table
   and function ACLs (including raw ACL entries); exact manifest and tombstone
   identity; enabled and forced RLS; and the still-drained, autonomy-OFF,
   automatic-actions-OFF, kill-switch-ON state. Reload PostgREST only after the
   transaction succeeds. Keep dispatch paused until this evidence is saved.

Current recovery state on 2026-08-28: `00150` is hosted exactly once; protected
run `33144659265` rolled `00200` back at the payload preflight; `00210` and the
unchanged `00200` remain pending separate `contain` and `lineage` acceptance
runs. The final reviewed `00210` identity is pinned above and must match before
publication or dispatch.

`scope=all` refuses to run unless both 00150 and 00200 are already recorded
exactly once and their frozen repository hashes plus the v2 catalog/safety
postflight still match. Never bundle the files, use `db push` to introduce
either one, repair their ledger rows, reset, down-migrate, rerun 00150, or add a
direct grant. A mismatch stops the release; containment is a new reviewed
forward migration.

## Any-model safe Step 8 -> Step 9 release (2026-08-22, ADR-115)

This section is the current release procedure and supersedes older command-model
instructions below. The implementation is a local release candidate only. It has
not been frozen as a final commit, pushed to `main`, deployed by Vercel, or applied
through the protected database scope. Do not describe the behavior in this section
as production behavior until all evidence steps below are complete.

The execution contract is deliberately asymmetric:

- `openai` / `gpt-5.3-codex` is the only executable Factory identity. It retains
  the existing manual Phase 1C path.
- Every other syntactically valid, bounded provider/model pair, including Claude
  and alternate OpenAI models, is admitted as `record_only`. Submission persists
  the command, task, immutable route, and disposition, but creates no
  `agent_runs`, worker dispatch, branch, commit, pull request, or deployment.
- Invalid or out-of-bounds provider/model values still fail closed. Setting
  `SOFTWAREFACTORY_CODEX_MODEL` to any nondefault value also fails closed; an
  environment variable cannot widen the worker/database execution contract.
- Step 8 advances after the selected posting's command is durably recorded. Step
  9 reads project-scoped command history and, for `record_only`, explicitly says
  that no execution artifacts exist by design. History must never bleed between
  projects, and its safe projection must not expose raw command parameters.

Hosted migration `20260822000600_route_bots_onto_the_executable_model.sql` is
already applied. That repair aligns legacy Codex rows with the sole executable
identity; it does not make any other provider or model executable.

The protected database tail remains pending and must land only as one atomic,
forward-only chain:

1. `20260822000300_contract_bot_mutator_acls.sql`;
2. `20260822000850_normalize_hosted_pre_repair_function_acls.sql`;
3. `20260822000900_repair_hosted_plpgsql_catalog_and_lint.sql`;
4. `20260822001000_factory_any_model_record_only.sql`;
5. `20260822001100_contract_resume_extraction_function_acl.sql`;
6. `20260822001200_contract_clear_function_acls.sql`.

Do not apply `00300` through its retired standalone scope, do not run a broad
push to introduce any member of this chain, and never reset, down-migrate, replay
history, or use `migration repair` as a substitute for the transaction. Use only
`scope=factory-any-model-record-only`. The scope must first verify the exact
`main` checkout and matching successful Vercel Production deployment, immutable
prerequisite ledger/catalog state, exact final file hashes, safety containment,
and the active task's direct owner release instruction. No magic RED phrase,
predeclared-SHA approval, expiry, or repeat approval is required (ADR-116). It
then rehearses all six files under rollback
and applies all six plus their ledger rows in one transaction. `00850` is the
exact hosted pre-repair ACL normalizer: it grants the required service-role
execution on `claim_provider_connect_session` and removes the three unintended
service-role grants found by read-only probe `32591774367`, without replacing a
function or changing its OID or non-ACL contract. Pending `00900` preserves the
claim function's measured legacy `organization_id`/`purpose` OUT names. The last
two files are forward-only containment for direct `service_role` function EXECUTE
grants that hosted Supabase default privileges left behind on the resume and
clear-control functions.

After the transaction, require exact ledger/catalog/ACL/lint/health evidence,
autonomy and automatic actions OFF, the global kill switch ON, workers/executors
disconnected, and zero runs for every `record_only` command. Finally, perform a
signed-in production Step 8 submission with Claude or another non-Codex model,
verify truthful Step 9, reload, and prove the same project-scoped history remains.
Only that complete evidence permits a deployed/production-ready claim.

**The current total is 26** within the dated, test-guarded probe list below. That phrase describes
the measured list, not today's total outstanding migration count. Later exact evidence proves
`20260821000300_project_pipeline_selection` and
`20260822000100_project_agent_selection` are hosted, while
`20260821000400_command_factory_routing` remains separately gated and
`20260822000150_normalize_legacy_bot_function_acls`,
`20260822000200_register_bot_for_ai_account`, and the separately gated
`20260822000300_contract_bot_mutator_acls` follow-up are the current exact
forward candidates.
Do not add any of them to the 19-row measurement or
infer a new overall missing count without another complete ledger probe. As of this release,
the repository total is 209 migration files after integration with current `origin/main`. Those two numbers do not stand in a prefix relationship, and the reason
matters: the
hosted ledger is **not a contiguous prefix** of the local files. It has gaps in the middle and
rows well past them. Any sentence of the form "everything after `X` is outstanding" is therefore
false, and every apply decision made from one has been wrong.
(The guard test derives the repository total from the migration directory, checks that each
version named below is a real file, and checks that the probe in
`.github/workflows/apply-hosted-migrations.yml` asks about exactly this set — so the list and the
probe cannot drift apart.)

## Applied to hosted — 2026-08-31, the Services CRM chain

Dispatched from `main` at `52a2eda` after PR #469 merged with CI green.
Seven scopes, in dependency order, each reporting `success` and each having
run its own postflight before reporting it:

| Scope | Version | Run |
|---|---|---|
| `pest-ipm` | `20260830001200` | 33351874168 |
| `chemicals-compliance` | `20260830001300` | 33351958922 |
| `billing-contracts` | `20260830001400` | 33352013667 |
| `branches-org-sales` | `20260830001500` | 33352126394 |
| `documents-canvassing-marketing` | `20260830001600` | 33352184485 |
| `forms-timesheets-licences` | `20260830001700` | 33352222216 |
| `customer-portal` | `20260830001800` | 33352257894 |

Each scope's postflight is the evidence, not the exit code: forced RLS on
every new table, the ABSENCE of DELETE proven rather than assumed (hosted
default privileges grant ALL at creation, so a capability expressed as a
missing grant only means something if the grant was there to revoke),
`anon` and `service_role` shut out, and every trigger the increment relies
on confirmed present. The portal scope additionally proves its resolver is
executable by no role at all and that its nine caller-scoped functions are
definers reachable only by `authenticated`.

`operating-dashboards` (`20260830001900`) applied from `main` at
`e3996aa`, run 33353775899. Its postflight asserts the inverse property to
the portal's: that none of its five functions is a definer, because these
aggregate across a whole book and a definer would aggregate across every
tenant's at once.

Four scopes are NOT yet applied — they are still on a branch, and each
carries its own postflight file under `.github/hosted-apply/postflight/`:

| Scope | Version | What its postflight proves |
|---|---|---|
| `recurring-billing` | `20260830002000` | `crm_invoices_plan_period_key` exists **and is partial**. A total index over the same columns would look right in a catalogue listing while refusing every hand-raised invoice. |
| `equipment-fleet` | `20260830002100` | The ledger takes select and insert only, and the meter trigger is present — a meter that can run backwards is a maintenance record that cannot be trusted. |
| `revenue-forecast` | `20260830002200` | Neither function is a definer. Both read across a whole book, and a definer would read across every tenant's at once. |
| `commercial-portal` | `20260830002300` | The inverse: all seven projections **are** definers, because a portal user is not a member of the organization they are reading and an invoker would return nothing. What makes that safe is re-proved beside it — `crm_portal_account_for` is executable by no role at all. It also checks that adding `reported_by_portal_user_id` to `crm_pest_sightings` did not loosen that table: forced RLS still on, the same-organization key present, and DELETE still absent for `authenticated`.  |

Apply them in that order; each depends on the tables the ones above it
created. Note the two postflight polarities in the table above are
deliberate and are the single easiest thing to get backwards in this
chain: a dashboard or forecast function that became a definer would
silently aggregate every tenant, and a portal projection that became an
invoker would silently return nothing.

The extracted SQL under `.github/hosted-apply/` — both `postflight/` and
`guard/` — is executed by nothing but a production dispatch, so
`tests/unit/migration-path-references.test.ts` checks the reference both
ways: every path a workflow names is a real file, and every file present is
named by a workflow. A postflight nothing runs is worse than none, because
the scope still reports success.

## Historical release tail before ADR-115 — 2026-08-22 (superseded)

The evidence in this section records an earlier checkpoint. It is not the
current apply procedure; use the ADR-115 atomic-chain instructions above.

Exact application commit `30d7e824691bdd4f8fa72481b21c91d3da6e3a31` is
current `main`. Vercel deployment `dpl_FrvCToHvFhkzfwnkmEeeTyfuE3v2` is READY
at `https://softwarefactory-116001qbk-surgeservices-projects.vercel.app` and
owns the stable production aliases. GitHub deployment `6036292508` and status
`17160408639` bind that deployment to the exact SHA.

This is not database-apply evidence. Exact-head CI run `32570540183` failed:
all three browser/accessibility shards passed, while quality job `97025270055`
failed before build because the LF migration chain rejected all seven
non-canonical legacy function-source hashes at the 00150 preflight. The local
repair canonicalizes CRLF and lone CR to LF before every `md5(prosrc)`
comparison. Native PostgreSQL 17.10 and 18.4 full chains pass, but the repair is
not committed, pushed, deployed, or approved for hosted execution. No hosted
database mutation followed `30d7e824`; 00150, 00200, and 00300 remain unhosted.

Supabase Preview check `97025325852` failed independently in the older
`20260814002500_provider_credential_vault.sql` migration with SQLSTATE `42P07`
because `provider_credentials` already exists. Identical failures on prior
heads classify that check as preview schema/ledger drift, not authorization to
repair history or weaken this release gate.

- `20260821000300_project_pipeline_selection` is **hosted**. Apply run
  `32536895799` and its after-ledger listing are recorded below.
- `20260822000100_project_agent_selection` is **hosted**. Apply run
  `32548916762` (2026-08-22 03:25Z, `scope=agent-selection`) recorded the
  ledger row and reloaded the schema cache; the live authenticated functions
  were then observed failing closed for a non-manager.
- `20260821000400_command_factory_routing.sql` is **unhosted**. Its reviewed
  repository blob is exactly 34,999 bytes with SHA-256
  `e45149db3ca7c66a27934b0b49ac160e1b5ef597fc8f34ad8547de4759086598`.
  Production still serves the pre-routing application copy. Until the function
  is hosted, the application intentionally fails closed with Not Connected/503.
- `20260822000150_normalize_legacy_bot_function_acls.sql` is **unhosted**,
  protected, forward-only, and frozen at exact repository file SHA-256
  `6b24b6ebb57e59b9c4398c3e439221c27c300663a7b6932ff192996ffe6bcd93`.
  Apply it only through `scope=bot-legacy-acl-normalization`, with 00100 once
  and 00150/00200/00300 absent. It accepts only an exact coherent all-seven
  Supabase `service_role` overgrant (or the exact already-normalized vanilla
  state), refuses any mixed count or other catalog/ACL drift, revokes only the
  seven direct service-role grants, and records 00150 in the same protected
  transaction. It creates no function, trigger, policy, worker, or autonomy
  path and performs no history repair.
- `20260822000200_register_bot_for_ai_account.sql` is **unhosted** and protected.
  Its frozen SHA-256 is
  `658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`.
  Apply it only through `scope=bot-account-binding`, after confirming 00100 and
  00150 are each present once and 00200/00300 are absent. This is the EXPAND
  half of a rolling cutover. The scope checks the hash and a clean pre-apply
  catalog. Before the first DDL, both the migration and workflow pin
  line-ending-canonical `md5(prosrc)` values (CRLF and lone CR become LF) plus
  return/argument/default/cost/rows/support/transform,
  owner, language, kind, volatility, `SECURITY DEFINER`, search path, overload,
  and authenticated-only ACLs of
  `register_bot` plus all six legacy mutators. Historical bindings must resolve
  to an existing same-tenant subscription account with the exact provider,
  purpose, and credential reference. The migration-local postflight rejects
  custom default-privilege grantees and proves exact definitions/ACLs for all ten
  new functions plus the exact revision columns/defaults/constraints/triggers;
  its exception rolls the protected single transaction back. The exact DDL file
  and direct version-only `schema_migrations` insert execute in that same psql
  transaction; protected scopes never use a later `migration repair`, so a
  runner crash cannot leave committed DDL without its ledger row. The scope also
  preserves all seven legacy definitions and ACLs, verifies the added revision columns/triggers,
  checked-mutation RPCs, service-only readiness recorder, and records exactly
  one ledger row. It intentionally does not revoke legacy execution before the
  old production app is replaced; those paths temporarily bypass revision
  tokens and service-only readiness. Revoke them only through a separately
  approved forward CONTRACT migration after exact-app deployment and signed-in
  acceptance.
  The workflow defaults to read-only `scope=probe`; `scope=all` refuses to push unless
  00150, 00200, and 00300 are already recorded exactly once by their dedicated scopes.
  This workflow does not prove runtime create/bind/assign/configure/readiness/
  audit behavior, linked-database lint, application health, or containment;
  each is a mandatory post-apply release gate.
- `20260822000300_contract_bot_mutator_acls.sql` is **unhosted**, protected,
  forward-only, and frozen at SHA-256
  `79914bc97660eef908b6a0fa0c90abfdd15da1683b383ad568e34bf3bd32c5f7`.
  It may be applied only through `scope=bot-account-binding-contract`, with
  00150 and 00200 recorded exactly once and 00300 absent. Before
  any database access the dispatch must run from `refs/heads/main`, name the
  exact checked-out 40-character application SHA in `contract_app_sha`, and
  provide `contract_acceptance=exact-app-vercel-accepted`. With only
  `deployments: read`, the workflow queries GitHub's Deployments API and fails
  closed unless the latest `Production` deployment created by `vercel[bot]` has
  exact matching SHA/ref, task `deploy`, and a latest Vercel-bot `success`
  status with a `*.vercel.app` environment URL. GitHub's deployment object does
  not expose the Vercel project ID, so before dispatch the operator must also
  verify through the Vercel dashboard/API that the deployment belongs to exact
  project `prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`; no `VERCEL_TOKEN` Actions secret
  exists or is introduced. The manual attestation also confirms the signed-in
  owner create/bind/assign/configure/readiness/audit/reload journey. The scope
  then proves the complete frozen EXPAND catalog: all helper/checked definitions
  and ACLs, revision columns/constraints, triggers, and all six legacy
  definitions/signatures/owners/`SECURITY DEFINER`/search paths/authenticated-
  only ACLs. It changes only those six legacy `EXECUTE` ACLs, re-reads the
  line-ending-canonical sources and every catalog contract field unchanged,
  verifies authenticated/PUBLIC/anon/service-role denial, and inserts exactly
  one ledger row in the same transaction as the six
  revokes; target absence plus the ledger primary key makes a race/retry roll back.

  The mandatory order is **ACL normalizer (`20260822000150`) -> EXPAND
  (`20260822000200`) -> deploy and accept the exact application SHA in Vercel
  production -> CONTRACT (`20260822000300`)**.
  The candidate server must translate cached pre-EXPAND request shapes into the
  checked RPC contracts; missing-function fallback exists only for a truly
  pre-EXPAND database and must not attempt a revoked legacy RPC after CONTRACT.
  `scope=all` refuses to push until all three protected versions are separately
  recorded exactly once by their dedicated scopes and the full live contracted
  function/ACL/revision/default/constraint/trigger catalog is still exact.
- Production safety was contained and remeasured at 2026-08-22 03:22Z: the
  global kill switch is ON, raw autonomous mode and all nine automatic actions
  are OFF, and the worker/executor remains disconnected across the three named
  SoftwareFactory projects. This clears the previously recorded state drift;
  it does not authorize a worker, autonomous action, or an unrelated migration.
- A separately authorized release must remeasure any remaining linked-lint
  findings, preserve that all-off baseline before and after the exact apply,
  apply only the exact reviewed migration, and verify its
  ledger row, immutable-table protections, owner/outsider/anonymous ACL and RLS
  behavior, stored effective-risk recheck, exact replay-before-mutable-state
  behavior, and the continued absence of worker dispatch/autonomous authority.
  Only a matching deployed application and live owner acceptance can change
  the production claim.

## Version collision, and one ledger row that lies — 2026-08-19 15:2xZ

`20260819000700` was claimed twice. `20260819000700_bot_credential_ref_privileged_parity`
(the ADR-036 CHECK-constraint parity fix) landed on main at 09:18Z in PR #252.
Later the same day I added `20260819000700_record_verification_as_worker` without
checking, from a branch that predated it, so two files carried one version.

Supabase's ledger keys on the fourteen-digit version, so this is not cosmetic:
`scope=broker-functions` runs `32267960981` and `32269079027` applied **my**
file and then ran `repair 20260819000700`. Production therefore records version
`20260819000700` as applied while the DDL that version now names — the security
constraint — **has never run**. Left alone, a later `scope=all` would skip it
forever and the denylist parity fix would silently never land.

Resolution, in this order:

1. The verification boundary is renumbered to `20260819000900`; the security fix
   keeps `20260819000700`, since it had the number first.
2. `20260819000700_bot_credential_ref_privileged_parity` is added to the
   `scope=broker-functions` file list so it actually executes. It is
   `drop constraint if exists` + `add constraint`, so applying it is replay-safe.
3. `repair 20260819000900` records the renumbered file.

**Do not read the pre-existing `20260819000700` ledger row as evidence that the
constraint exists.** Confirm it directly:
`select conname from pg_constraint where conname = 'bots_credential_ref_not_privileged'`
and check that its definition names all fourteen privileged references.

**Closed 2026-08-21, run `32531787440` (`scope=probe`, read-only).** That direct check now
answers `bots_credential_ref_not_privileged | covers_all_five_added = t`, so the parity fix is
live on production and `20260819000700` is no longer listed above as unhosted. The row and the
constraint finally agree. The same run also shows the whole `20260819` range —
`000100` through `001200` — recorded on both sides of the ledger, which is the prerequisite
`scope=lifecycle` depends on: `20260821000200` rebuilds `claim_planned_graph` and
`list_graph_runs` from `20260819001000` and `20260819000800`, and would create functions
referencing columns that do not exist if those files had never run.

## Scope order matters: run `scope=lifecycle` last — 2026-08-21

The workflow's surgical scopes replay whole files, and **whichever replayed file runs last wins
the function body**. Three files define `create_graph_from_plan`; two define
`claim_planned_graph`. `scope=broker-functions` replays the older ones.

So: **if you ever dispatch `scope=broker-functions` after `scope=lifecycle`, dispatch
`scope=lifecycle` again afterwards.** Otherwise production keeps a pre-lifecycle
`create_graph_from_plan` that ignores `lifecycle_stage`, `gate_kind` and `is_feedback`, and
lifecycle graphs are planted with no gates at all. Nothing is corrupted — the lifecycle body is
a strict superset of the older one, and re-running the scope restores it — but the failure is
silent. A graph runs straight through every gate and looks like it succeeded.

Confirm rather than assume, with the query the `scope=lifecycle` step runs at the end:

```sql
select pg_get_function_identity_arguments(oid) as signature,
       strpos(pg_get_functiondef(oid), 'graph_gates') > 0 as knows_about_gates
  from pg_proc where proname = 'claim_planned_graph';
```

Exactly one row, and `knows_about_gates = t`. Two rows means a `text`-only overload was
resurrected by a replay, and the live claim is the one that reports no gates.

## The ledger, measured — 2026-08-18 05:40Z, run `32103778884` (`scope=probe`, read-only)

This supersedes every count and every high-water mark stated below it. The run mutated nothing:
the three apply steps were skipped by their `if:` conditions, and the log shows it.

**Absent from the hosted ledger — 26 probed marker objects:**
| Version | Migration | Marker object the probe asks about |
|---|---|---|
| `20260814002500` | provider_credential_vault | table `provider_credentials` |
| `20260814002600` | store_provider_credential | function `store_provider_credential` |
| `20260815000200` | phase2e_portfolio_scheduling | table `scheduling_decisions` |
| `20260815000300` | phase2e_portfolio_scheduler | function `portfolio_capacity_verdict` |
| `20260815000400` | phase2e_project_scoped_agents | body of `plan_phase1c_task_and_run` |
| `20260815000500` | phase2e_breaker_aware_scheduling | function `breaker_cooldown_seconds` |
| `20260815000600` | phase2e_portfolio_visibility | function `portfolio_scheduling_queue` |
| `20260815000800` | report_per_project_view | body of `generate_operations_report` |
| `20260815000900` | guard_project_deletion | function `refuse_project_deletion` |
| `20260815001000` | cross_project_dependencies | function `declare_cross_project_dependency` |
| `20260815001100` | connection_routing_decisions | table `connection_routing_decisions` |
| `20260815001200` | improvement_ledger | table `improvement_ledger` |
| `20260815001300` | improvement_measurement | function `capture_improvement_baseline` |
| `20260815001400` | factory_self_audit | function `audit_factory_health` |
| `20260815001500` | factory_detectors | function `detect_factory_improvements` |
| `20260815001600` | detector_intake | function `propose_improvements_from_detections` |
| `20260816000100` | ai_accounts_auth_broker | table `ai_accounts` |
| `20260816000200` | ai_account_verification | function `list_ai_accounts_for_verification` |
| `20260816000300` | resume_ai_auth_session | function `find_open_ai_auth_session` |
| `20260816001600` | phase2c_resource_reservations | table `resource_reservations` |
| `20260821000200` | agentic_sdlc_lifecycle | table `graph_gates` |
| `20260821000400` | command_factory_routing | table `factory_command_routes` |
| `20260821000400` | command_factory_routing | function `list_factory_command_routing_candidates` |
| `20260821000400` | command_factory_routing | function `submit_factory_command` |
| `20260822000600` | route_bots_onto_the_executable_model | body of `normalize_phase1c_command` |
| `20260822001300` | contract_audit_guard_function_acl | function `reject_activity_event_mutation` |

The last six were added on 2026-08-22. Issue a Command runs through
`list_factory_command_routing_candidates` and `submit_factory_command`, and their
migration has no history row on the remote — so the one surface an owner actually
uses was the only thing this report could not answer for. A blank ledger row means
nothing on its own: every Phase 2E version above reads blank in the ledger and `t`
in the probe.

**Present in the hosted ledger:** every other local version, including the whole
`20260817` range — `000100` through `001100`. So the run-review controls, the owner-operated
safety controls, `20260817000700_bot_assignment_configuration` (the Assign Bots wizard's
configuration columns and `assign_bots_to_project`), the custom pipeline templates and the
per-posting model/effort override are **applied on production**.
`20260818000100_removable_accounts_keep_usage_evidence` (drops the usage table's
account cascade so `remove_ai_account` stops dying against the append-only
trigger — probe run 32188102707's 42501) was applied by `scope=broker-functions`
run `32191182958` and verified by probe run `32191381794` (the rolled-back
removal returned `t`). `20260818000200_seed_standard_model_catalogue` (the per-organization
standard model catalogue) was applied by run `32199155823` and measured by
probe run `32199285229` — both organizations hold 8 enabled model
configurations, and a rolled-back `set_agent_provider_assignment` as the
impersonated owner succeeded. `20260819000100_graph_worker_execution` (the
graph executor's service-role claim/persist boundary: `claim_planned_graph`,
`record_node_state_as_worker`, `record_graph_artifact_as_worker`,
`complete_graph_run_as_worker` — all create-or-replace plus grants,
idempotent) was applied by `scope=broker-functions` run `32208528984` and
exercised by the first two real worker dispatches (runs `32208699123`,
`32208975669` — claims, parallel dispatch, containment, and honest FAILED
closes all recorded on production). Its bounded re-claim revision (applied by
run `32209731806`) was then production-proven by worker run `32209893742`:
both failed-only graphs were re-claimed to their three-run cap, and every
node failed on a real provider answer — a session limit — which exposed that
capacity refusals were spending convergence attempts. The current revision
therefore closes capacity-voided runs as CANCELLED (retryable, uncounted,
with a total-run ceiling of 10), and `20260819000200_replant_exhausted_graph`
re-plants one copy of the owner's exhausted first-day readiness graph (fixed
id, so replays are no-ops forever) for the capacity-aware worker to claim
after the limit resets. Worker run `32211229999` then production-verified
the capacity semantics end to end: the re-planted graph was claimed, every
refusal was classified, the run closed CANCELLED, and the drain stopped —
the graph keeps its chances. `20260819000300_tolerant_fan_in` adds the
per-node `tolerates_partial_inputs` bit (guarded ALTER) and re-declares
`create_graph_from_plan` to persist it (applied by run `32212056032`);
`20260819000400_list_graph_runs` adds the member-facing run read and widens
the node provider check for deterministic attributions (applied by run
`32212821411`); the stale-run reclaim revision of `20260819000100` was
applied by run `32213217318`. The post-reset live-proof dispatch (worker
run `32228988434`) then recorded **the first real production node
success**: on graph run `e51c57a5-…` the rollback inspector completed
through the CLI with its artifact, the run closed PARTIAL, and every other
failure was the worker's old 8-turn ceiling — fixed in code (24 turns) —
which is why `20260819000500_replant_with_room_to_work` re-plants one final
fixed-id copy whose MODEL nodes carry the measured eight-minute timeout.
All of these re-apply through the same replay-safe `scope=broker-functions`
path. `20260821000300_project_pipeline_selection` (the `project_pipelines` table and
its `select_project_pipeline` / `deselect_project_pipeline` / `list_project_pipelines`
functions, which is what makes the AI Factory's Use button record anything) was newer than
that measurement and is now **applied**: run `32536895799`, 2026-08-21 23:27Z,
`scope=pipeline-selection`. Its one-file scope is what let it reach production without
re-running unrelated migrations; it is still in the `broker-functions` batch scope as well.
The run's after-ledger listing prints the version local and remote, and the step reloaded the
PostgREST schema cache, so the Configure Pipeline step no longer reads **Not Connected** on
this database. Earlier revisions of this document and of `todo.md` said the opposite; that
claim was drawn from the ledger's old high-water mark and is withdrawn.

**And the ledger still understates the schema.** The same run's object probe returned 19 of 19
present, among them `scheduling_decisions`, `provider_capacity_limits`,
`projects.engineering_priority`, `projects.strategic_focus` and
`set_project_engineering_priority` — all owned by `20260815000200`, which has no ledger row. That
is unledgered DDL: live schema with no history behind it.

### What follows from that

- The gap is, at least in part, **bookkeeping rather than missing schema**. Where the probe shows
  a marker present, the correct action is `migration repair --status applied <version>` — record
  the history that is already true. Re-running the file would be the wrong move.
- Where the probe shows a marker **absent**, that file genuinely has not run and applying it is
  real DDL against production.
- The probe now reports one row per absent version with a `present` boolean, so it distinguishes
  "absent" from "never asked". The older query printed only what existed, which is why the two
  cases looked alike.
- **Nobody has run the mutating scopes on the strength of this measurement.** Only `scope=probe`
  was run. `AGENTS.md` puts RED actions behind explicit owner approval in Phase 1, and the
  approval section below requires a fresh exact approval per apply — so the repair-versus-apply
  decision above is written down for the owner, not acted on.

### The next run, for whoever executes it

1. `scope=probe` again — it now covers all 19 and prints `f` for anything truly missing.
2. For each version whose marker came back `t`: `migration repair --status applied <version>`.
3. For each version whose marker came back `f`: apply that file, then record it.


> ## Probe before you apply — 2026-08-17 20:5xZ (supersedes every count below as a basis for action)
>
> **The ledger understates the live schema, and every apply decision made from
> it alone has been wrong.** Two runs settled this:
>
> - Run `32068091179` applied the `20260815` range the ledger called
>   outstanding, and stopped at the second file: the enum labels and
>   `organizations.maximum_concurrent_runs` already existed. Nothing was
>   damaged — the failing statement was an `ALTER TABLE`, which is atomic — but
>   the premise was false.
> - Run `32068262957` ran the new read-only `scope=probe` and printed what
>   actually exists. Of the objects the project controls need, **13 of 19 were
>   already live** while the ledger listed their whole range as unapplied.
>
> The method that works is therefore: **`scope=probe` first, apply only what it
> reports missing, and record each file as it lands.** Run `32068584897` did
> exactly that for the six genuinely absent objects — `archive_project`,
> `unarchive_project`, `update_agent_run_review`, `delete_agent_run`, and the
> two `agent_runs.review_*` columns — and a confirming probe (`32068654691`)
> shows 19 of 19 present.
>
> A full `db push` still cannot be used: it refuses outright, because local
> files sort before the remote's last migration. That refusal is the CLI
> protecting production, not a problem to route around with `--include-all`.
>
> The counts in the sections below remain a true description of the *ledger*.
> They are not a description of the database, and should not be used to decide
> what to apply.

> ## Measured live, 2026-08-16 17:07Z — the first full listing (supersedes every earlier measure)
>
> Workflow run `31960618697` (`apply-hosted-migrations.yml`, `scope=broker-functions`, password-only
> pooler connection) printed the complete local-vs-remote ledger. The facts, correcting the earlier
> count-only interpretation below:
>
> - The remote ledger matches local **exactly and contiguously through `20260814002300`** — 64 rows.
> - The one remote-only row was **`20260814000200`** (the pre-split name of `000210`/`000220`/`000250`,
>   all three of which remote records) — **not** `20260814002000`; `20260814000100` was already
>   correctly recorded. The run reverted the stale `000200` row (history only, no DDL).
> - The run then surgically applied and recorded **`20260816000400`** and **`20260816000500`**
>   (both purely `create or replace function` + grants), because production Remove was failing
>   with `PGRST202` on the missing `remove_ai_account`. These two rows now sit above the
>   contiguous prefix with a gap — the position pin below stays at `20260814002300` and the
>   outstanding count keeps counting them, with this note as the reconciliation.
> - **DDL drift, unledgered:** production demonstrably runs schema from migrations that have no
>   ledger rows — the credential vault (`20260814002400`–`002600`) and the broker
>   (`20260816000100`–`000300`) all work live. Something applied their DDL without recording
>   history. A future full `db push` would therefore replay non-idempotent DDL and fail;
>   reconcile by probing each outstanding migration's objects and `migration repair --status
>   applied` the ones already live, before any full push.
>
> ## Measured against hosted, 2026-08-16 (owner SQL, count-only — detail corrected above)
>
> The owner ran, in the production project's SQL Editor:
> `select count(*), max(version) from supabase_migrations.schema_migrations;`
> → **count 65, max `20260814002300`** (screenshot evidence, 2026-08-16).
>
> **The count arithmetic confirms the `20260814002000` derivation at the bottom of this
> document.** The repository holds exactly **64** files at or before `20260814002300`; hosted
> holds **65** rows. The one extra hosted row is `20260814002000_graph_engineering` — applied
> under that version, then renamed locally to `20260814000100` — precisely the remote-only
> version that makes the Supabase integration's comparison fail on every merge and blocks
> every apply path. It is a ledger-bookkeeping problem, not missing schema: the graph
> engineering DDL is present on hosted.
>
> ### Owner order of operations (repair first, then push)
>
> ```bash
> supabase link --project-ref qpuofpmagrmyamahqwxw
> supabase migration list        # confirm: remote shows 20260814002000, not 20260814000100
> # History repair only — no DDL runs:
> supabase migration repair --status reverted 20260814002000
> supabase migration repair --status applied  20260814000100
> supabase migration list        # re-list; the comparison error should be gone
> supabase db push               # applies the 24 outstanding below, in order
> ```
>
> If `migration list` shows anything other than the predicted state, stop and re-derive —
> do not force the repair.
>
> ### The 24 outstanding, in apply order
>
> `20260814002400_connection_registry_multi_account` · `20260814002500_provider_credential_vault`
> · `20260814002600_store_provider_credential` · `20260815000100`–`20260815000600` (Phase 2E
> scheduling, six files) · `20260815000700_project_archive_operation` ·
> `20260815000800_report_per_project_view` · `20260815000900_guard_project_deletion` ·
> `20260815001000_cross_project_dependencies` · `20260815001100_connection_routing_decisions` ·
> `20260815001200_improvement_ledger` · `20260815001300_improvement_measurement` ·
> `20260815001400_factory_self_audit` · `20260815001500_factory_detectors` ·
> `20260815001600_detector_intake` · `20260816000100_ai_accounts_auth_broker`
> · `20260816000200_ai_account_verification` · `20260816000300_resume_ai_auth_session` · `20260816000400_inspect_ai_auth_sessions` · `20260816000500_remove_ai_account`
>
> Each is described, with its verifying suite, in the per-section tables below. None grants
> execution authority or new `service_role` table privileges. **Before pushing**, note the 2E
> capacity defaults (portfolio ceiling 4, 1 reserved, 2 per project, 1 per worker) take effect
> on apply — raise them first with `set_portfolio_capacity_limits` if the factory should run
> wider. After pushing, re-run the post-apply checks listed in the rehearsal section.
>
> The historical position `20260813001400` and the 2026-08-14 measurement (45 rows /
> `20260814000200`) below are retained as history; the measured position above is the one
> to trust.

These two numbers have gone stale three times, because several agents add migrations in parallel
and none of them is reading this paragraph. `tests/integration/hosted-runbook-counts.test.ts` now
derives both from the migration directory and fails when they drift, so the next person to add a
migration is told to update this sentence rather than discovering later that it lied. The tables
below are not machine-checked and can still fall behind the totals.

> ## Measured against hosted, 2026-08-14 21:00Z — this section supersedes the table below
>
> This runbook told its reader to re-list rather than trust its documented position. That was
> right, and doing so found the position had moved. Read this first.
>
> **The ledger holds 45 rows and ends at `20260814000200`, not `20260813001400`.** The repository
> holds 57 migrations, so **twelve** are unapplied, not six. Nothing in the ledger is missing from
> the repository.
>
> **Migration 1 below is already applied.** `20260813001500_expose_bounded_run_routing.sql` is in
> the ledger *and* its `public.get_agent_run_detail(uuid, uuid)` exists in hosted, so this is a
> real apply rather than an orphaned ledger row. Its frozen identity still matches — 13,121 bytes,
> SHA-256 `3e1bea8f5dab912d…`. **Do not seek fresh RED approval for it; it is done.**
> `20260813001600_autonomy_decision_audit.sql` is likewise applied.
>
> The twelve genuinely unapplied, in apply order:
>
> | # | Migration |
> | --- | --- |
> | 1 | `20260813001550_serialize_concurrent_operations_writes.sql` |
> | 2 | `20260813001700_link_promoted_repair_task.sql` |
> | 3 | `20260814000210_phase2c_resource_persistence.sql` |
> | 4 | `20260814000220_declare_model_strength_and_context.sql` |
> | 5 | `20260814000300_agentos_isolation_model.sql` |
> | 6 | `20260814000310_declare_model_characteristics.sql` |
> | 7 | `20260814000400_agentos_inbox.sql` |
> | 8 | `20260814000500_agentos_templates_and_chains.sql` |
> | 9 | `20260814000600_agentos_compound_engineer_template.sql` |
> | 10 | `20260814000700_agentos_goals.sql` |
> | 11 | `20260814000800_agentos_triggers_and_automations.sql` |
> | 12 | `20260814002200_graph_anchors.sql` |
>
> Two of these — `20260813001550` and `20260813001700` — sort **below** the ledger's high-water
> mark. They were skipped rather than deferred, so `supabase db push` may not pick them up on its
> own; check that it does before assuming it did.
>
> Items 3, 4 and 6 were renumbered while resolving version collisions between concurrent
> workstreams. Item 6 additionally resolves a duplicate that existed on `main`, where
> `agentos_isolation_model` and `declare_model_characteristics` both claimed `20260814000300` and
> one of them could therefore never have been applied.
>
> **An agent cannot apply any of this.** Writing to hosted Supabase is refused by the Claude Code
> auto-mode classifier, which is the correct guard for a RED action against production. Verifying
> the position above was read-only and was allowed.

## What was believed unhosted when this runbook was written

The hosted ledger is current through `130014` = `20260813001400_resolve_emergency_stop.sql`.
Everything after that point is unhosted:

| # | Migration | What it does | Approval |
| --- | --- | --- | --- |
| 1 | `20260813001500_expose_bounded_run_routing.sql` | Widens assignment/run model checks 120→128, adds four no-secret constraints, bounded routing projection, revokes raw routing reads | **Fresh exact RED approval required.** Frozen at 13,121 bytes, SHA-256 `3E1BEA…3DD1A13`. Verify that identity before applying. |
| 2 | `20260813001550_serialize_concurrent_operations_writes.sql` | Fixes two real races found on real PostgreSQL: duplicate incident fingerprint, colliding rollback attempt | Ordinary forward migration |
| 3 | `20260813001600_autonomy_decision_audit.sql` | Append-only `autonomy_decisions` | Ordinary forward migration |
| 4 | `20260813001700_link_promoted_repair_task.sql` | `link_repair_promotion`, owner-only | Ordinary forward migration |
| 5 | `20260814000100_phase2c_resource_persistence.sql` | `resource_breakers`, `resource_breaker_events`, `resource_assignments` | Ordinary forward migration |
| 6 | `20260814000200_declare_model_strength_and_context.sql` + `20260814000250_declare_model_characteristics.sql` | Owner-declared model strength/context, and the function that sets them | Ordinary forward migration |
| 7 | `20260814001100_harden_github_connection_loss.sql` | Redefines `mark_github_connection_lost` so a revocation clears a stale suspension marker instead of reporting the wrong reason, a terminally deleted installation is recorded rather than aborting the call, and a connection with no installation row stops writing a null entity id | Ordinary forward migration. `create or replace` on one function; no table, constraint, or grant change |

Migration 1 is not mine and I have not verified its frozen identity — only that it applies. Treat
its approval requirement as still standing.

## Verification already done, so you are not applying blind

Run on a real PostgreSQL 16 cluster (not PGlite, which is single-connection and cannot show
ordering or concurrency problems):

| Check | Result |
| --- | --- |
| The whole chain applies in order from empty | **Pass** (48 files at the time of that run; 56 now — the later eight are covered in "Added 2026-08-14") |
| A baseline built to exactly `20260813001400`, then the six applied in order | **Pass, each individually reported** |
| RLS + FORCE RLS on every public table after apply | **Pass — 0 missing of 63** |
| `service_role` table privileges after apply | **Pass — exactly the four GitHub ingress tables** |
| `autonomous_release_allowed` still returns `EXECUTOR_NOT_CONNECTED` unconditionally | **Pass** |
| The three new Phase 2C tables carry RLS and FORCE RLS | **Pass** |
| `link_repair_promotion` present and `SECURITY DEFINER` | **Pass** |

Re-verified 2026-08-14 on a fresh PostgreSQL 16.13 cluster with migration 7 included:

| Check | Result |
| --- | --- |
| All 57 migrations apply in order from empty | **Pass** |
| RLS + FORCE RLS on every public table | **Pass — 0 missing of 83** |
| `service_role` table privileges | **Pass — exactly the four GitHub ingress tables, SELECT/INSERT/UPDATE only, no DELETE** |
| Both Phase 1D interlock constraints still present | **Pass** |
| Migration 7 behavior: suspended installation + revocation | **Pass — status `error`, `suspended_at` cleared, prior state preserved as activity evidence** |
| Migration 7 behavior: terminally deleted installation | **Pass — records the loss, returns true, leaves `deleted`/`deleted_at` untouched** |

What this does **not** prove: that the hosted ledger rows match what the catalogue says, or that
hosted-only objects behave identically. The ledger on that project was reconciled by hand once
already, so re-list before applying rather than trusting the documented position.

## Rehearsal on real PostgreSQL 16, 2026-08-14 23:2x UTC

The exact owner scenario was rehearsed end to end on a real PostgreSQL 16.13 cluster with a real ledger, after the version-collision fix. PGlite cannot do this: it has no `supabase_migrations.schema_migrations`, so it cannot show a ledger failure at all — which is precisely the failure mode that matters here.

| Step | Result |
| --- | --- |
| Baseline built to exactly `20260813001400` | **41 ledger rows**, matching the documented hosted position |
| The unhosted migrations applied in filename order, each recorded | **All applied**, ledger ends at 57 |
| Whole chain from empty, as a separate check | **All 57 applied**, 57 ledger rows |

Post-apply verification against that cluster:

| Check | Result |
| --- | --- |
| Public tables | 83 |
| Tables without RLS + FORCE RLS | **none** |
| `service_role` table privileges | exactly `github_change_requests`, `github_installations`, `github_repositories`, `github_webhook_deliveries` |
| `anon` write grants | **none** |
| SECURITY DEFINER functions | 172, **none** without a pinned `search_path` |
| SECURITY DEFINER executable by `anon` | exactly `subscribe_to_newsletter` |
| `autonomous_release_allowed` present | yes |

### Added later the same day

| Migration | What it adds | Verified by |
|---|---|---|
| `20260814002300_guard_resource_assignment_candidates` | A `jsonb_has_sensitive_keys` check on `resource_assignments.candidates` | Applied on the real cluster above; the guard was exercised directly against realistic payloads |

`resource_assignments` already refused credential-shaped text in `agent_id`, `provider`, and `model`, and every other structured-evidence jsonb column in the schema is guarded. `candidates` — which holds those same three identifiers per candidate, plus named rejections and notes — was not. That is an inconsistency rather than a discovered leak: the column is written by the routing layer from server-computed scoring, not from user or model input. It is closed anyway because the column is browser-readable through the table's member SELECT policy, and "notes" is the kind of field a later change quietly widens.

Exercised on the real cluster: benign candidate evidence and an empty array pass; an `api_key` in the payload and a nested `access_token` are both rejected.

### The collision, demonstrated rather than asserted

Replaying the pre-fix state against a real ledger produces exactly the predicted failure:

```
ERROR:  duplicate key value violates unique constraint "schema_migrations_pkey"
DETAIL:  Key (version)=(20260814000300) already exists.
```

The first migration records its version. The second **still applies its DDL** and then fails to record — schema changed, ledger not updated, push aborted partway. That is the half-applied state this fix prevents. With the shipped versions (`20260814000250` and `20260814000300`), both are accepted.

What this rehearsal does **not** prove: that the hosted ledger's actual contents match the documented position. Re-list before applying, as the step below says. It also cannot prove hosted-only behavior — Supabase's own roles, extensions, and defaults differ from a bare cluster.

## Order of operations

1. `supabase link` the exact project `qpuofpmagrmyamahqwxw`, then `supabase migration list` and
   confirm the remote ledger really ends at `20260813001400`. If it does not, stop — the position
   this runbook assumes is wrong, and the difference matters.
2. Apply migration 1 only under its own fresh RED approval, after checking the frozen byte size and
   SHA. It is independent of 2–6; skipping it does not block them.
3. Apply 2–7 in order with `supabase db push`.
4. Re-run the post-apply checks above against hosted.

## After applying

Nothing starts executing. Every interlock is unchanged by design:

- `autonomous_release_allowed` still returns false unconditionally.
- The global kill switch stays ON and all nine automatic actions stay OFF.
- A promoted repair reaches `queued` and stops, because no Phase 1C worker is registered and no
  provider credential exists.

What *does* change is that three surfaces stop erroring and start being truthfully empty: repair
promotion, the Resource Manager console, and routing.

## Then: declare your models

Routing refuses every model until an owner declares its strength and context limit — deliberately,
because an undeclared model must not be assumed strong enough or large enough. Until you do this,
`POST /api/resources/route` correctly returns `NO_ELIGIBLE_WORKER` and names the undeclared models
separately, so the cause is visible rather than looking like a scoring bug.

- `GET /api/resources/models` lists which models are still undeclared.
- `POST /api/resources/models` declares one: `{provider, model, strengthTier, contextLimitTokens}`.
  Sending `null` for either withdraws that declaration, which stays possible on purpose — an owner
  who realises they declared the wrong tier should be able to say "I no longer claim this" rather
  than substitute another guess.

## Added 2026-08-14 — AgentOS and Phase 1D visibility

Eight further migrations are unhosted. All eight apply cleanly in order against real PostgreSQL
(PGlite) on top of everything before them, verified by the suites named beside each.

| Migration | What it adds | Verified by |
|---|---|---|
| `20260814000300_agentos_isolation_model` | 9 tables: environments, MCP connections, skills, default-deny agent grants | `agentos-isolation.behavior` |

Note: `declare_model_characteristics` was renumbered from `20260814000300` to `20260814000250` on 2026-08-14. It had collided with `agentos_isolation_model`, which two agents had independently timestamped the same. See "Version collisions" below.
| `20260814000400_agentos_inbox` | Inbox messages, one open question per run, answer/resume routines | `agentos-inbox.behavior` |
| `20260814000500_agentos_templates_and_chains` | Templates, chain steps, the two completion paths | `agentos-chains.behavior` |
| `20260814000600_agentos_compound_engineer_template` | Seeds the built-in nine-step workflow (idempotent, per organization) | `agentos-chains.behavior` |
| `20260814000700_agentos_goals` | Goals, definition of done, append-only progress, the three rails | `agentos-goals.behavior` |
| `20260814000800_agentos_triggers_and_automations` | Triggers, deliveries, cron automations | `agentos-triggers.behavior` |
| `20260814000900_agentos_safe_list_reads` | Five browser projections for the AgentOS console | `agentos-routes.contract` |
| `20260814001000_phase1d_decision_visibility` | Makes `autonomy_decisions` readable + per-project autonomy status | `phase1d-decision-visibility.behavior` |

What they do **not** do, which is what makes them safe to apply:

- No execution authority. Every AgentOS surface reports `*_RUNNER_NOT_CONNECTED`, and the goal
  spawn decision returns `maySpawn: false` unconditionally.
- No new `service_role` table privileges, so the verified `026` ACL matrix is unchanged. The one
  function `service_role` may call is `agentos_record_trigger_delivery`, and it creates only a
  backlog task.
- No Phase 1D control is relaxed. `20260814001000` is read-only: two projections and their grants.
  A test asserts that reading the trail cannot change what the loop may do.
- Every table carries RLS and FORCE RLS with browser access limited to SELECT.

Order matters only in that `000600` needs `000500`, `000900` needs the tables before it, and
`001000` needs `20260813001600`. Applying them in filename order satisfies all three.

## Added 2026-08-15 — Phase 2E portfolio scheduling

The portfolio migrations, verified together by
`tests/integration/phase2e-portfolio-scheduling.behavior.test.ts` (two competing
projects, real claims through `claim_phase1c_run`; the suite pins the migration tail,
so it cannot pass without having applied every row below).

| Migration | What it adds | Verified by |
|---|---|---|
| `20260815000100_phase2e_scheduling_activity_types` | Five activity types. Enum values only, in their own file because PostgreSQL will not use a new enum value in the transaction that added it | applied by every suite |
| `20260815000200_phase2e_portfolio_scheduling` | Project priority/focus/pause/ceiling columns, organization ceilings and reserve, worker capacity, `provider_capacity_limits`, append-only `scheduling_decisions`, the priority and verdict functions, and the five owner controls | `phase2e-portfolio-scheduling.behavior` |
| `20260815000300_phase2e_portfolio_scheduler` | Portfolio-aware selection inside the existing claim path | `phase2e-portfolio-scheduling.behavior` |
| `20260815000400_phase2e_project_scoped_agents` | One logical agent per role per project, so two projects can run the same role at once | `phase2e-portfolio-scheduling.behavior` |
| `20260815000500_phase2e_breaker_aware_scheduling` | The cooldown rule in SQL, and selection that consults the 2C circuit breakers it already stored | `phase2e-portfolio-scheduling.behavior`, `breaker-cooldown-parity` |
| `20260815000600_phase2e_portfolio_visibility` | Three browser projections: the queue in scheduler order with reasons, portfolio capacity, per-project scheduling state | `phase2e-portfolio-scheduling.behavior` |
| `20260815000700_project_archive_operation` | `archive_project`/`unarchive_project`: owner-only, reason required, immutable events, deletes nothing; the claim path's `status = 'active'` filter is what stops new work | `phase2e-portfolio-scheduling.behavior` |
| `20260815000800_report_per_project_view` | The daily report gains a bounded per-project array (worst health first, archived included); policy version `phase1e-operations-v2` | `phase2e-portfolio-scheduling.behavior` |
| `20260815000900_guard_project_deletion` | An instructive BEFORE DELETE refusal naming the structural rule: every project's append-only activity trail already restricts deletion from its first recorded moment | `phase2e-portfolio-scheduling.behavior` |
| `20260815001000_cross_project_dependencies` | `declare_cross_project_dependency`/`release_cross_project_dependency`: owner-only, reason required, events in both projects, cycle-refusing; edges land in `task_dependencies`, which the claim gate already respects. Carries `submit_command` forward so replays ignore declared cross-project edges | `phase2e-portfolio-scheduling.behavior` |
| `20260815001100_connection_routing_decisions` | Append-only `connection_routing_decisions` + `record_connection_routing_decision`: the Identity Router's selections and refusals become durable, member-readable evidence with every rejected candidate and its named reason | `connection-registry` |
| `20260815001200_improvement_ledger` | Append-only `improvement_ledger` + four recorder functions: Phase 3's proposal/decision/implementation/evaluation lifecycle, refusing proposals without baselines, shortcuts past acceptance, re-decisions, and second evaluations | `improvement-ledger.behavior` |
| `20260815001300_improvement_measurement` | `capture_improvement_baseline` (fourteen-day telemetry window, unmeasured sources named rather than zeroed) + `evaluate_improvement_from_telemetry` (fixed direction table, derived outcome, refuses to guess when nothing compares) | `improvement-ledger.behavior` |
| `20260815001400_factory_self_audit` | `audit_factory_health`: eight telemetry domains read as evidence, each scored by a stated rule or reported unmeasured with a reason; overall score over measured domains only, with confidence and abstention | `improvement-ledger.behavior` |
| `20260815001500_factory_detectors` | `detect_factory_improvements`: five detectors with stated evidence floors — recurring fingerprints, flaky test kinds, sub-second model nodes, failing provider pairs, and a debt inventory — abstaining by name below their floors | `improvement-ledger.behavior` |
| `20260815001600_detector_intake` | `propose_improvements_from_detections`: findings become owner-decidable ledger proposals with machine-captured baselines and metric-named predictions; open questions are never re-proposed, rejections may be re-raised, and nothing is auto-accepted | `improvement-ledger.behavior` |
| `20260816000100_ai_accounts_auth_broker` | `ai_accounts` (provider sign-ins as first-class identities, no secrets stored) + `ai_auth_sessions` (the broker state machine a worker drives through the provider's real login: pending→initializing→awaiting_user→authenticated→verifying→connected, with failed/expired/revoked terminals) + nullable `bots.ai_account_id`; RLS+FORCE with no direct table access for any role, definer-function transitions, activity events throughout | `ai-accounts-auth-broker.behavior` |
| `20260816000200_ai_account_verification` | `list_ai_accounts_for_verification` + `mark_ai_account_verified`: the sweep's two hands — enumerate connected subscription accounts, record a shape-level pass as `last_verified_at` (no event; a routine pass is a timestamp, not a transition); demotion stays with `mark_ai_account_needs_reauth` | `ai-accounts-auth-broker.behavior` |
| `20260816000300_resume_ai_auth_session` | `find_open_ai_auth_session`: the open session an account already has, so a page refresh resumes the sign-in instead of superseding it (authenticated, member-checked, projection excludes the sealed code) | `ai-accounts-auth-broker.behavior` |
| `20260816000400_inspect_ai_auth_sessions` | `inspect_ai_auth_sessions`: bounded read-only session-state projection for the worker's log (status/timing/linkage, never the sealed code) — the diagnosis surface after two live runs and a watching owner disagreed about whether sessions existed | `ai-accounts-auth-broker.behavior` |
| `20260816000500_remove_ai_account` | `remove_ai_account`: stronger than disconnect — deletes the account, its credential, and its sessions; bots detach (never deleted) and read "no account attached" | `ai-accounts-auth-broker.behavior` |
| `20260816001400_project_repository_picker` | `set_project_github_repository` + `unlink_project_github_repository`: owner/admin choice of which GitHub repository an existing project connects to. Same advisory locks as handoff and the change-reservation trigger; one non-archived project per repository with the conflicting project named in the refusal; blocks while a change reservation is pending; immutable `connection.changed` activity evidence; grants to `authenticated` only | `project-repository-picker.behavior` |

What they do **not** do:

- No new execution authority. `20260815000300` replaces the body of a function that already
  existed; the only new refusals are ceilings, and the only new writes are audit rows.
- No new `service_role` table privileges. Both new tables are `SELECT`-to-`authenticated` and
  nothing else, so the verified ACL matrix is unchanged.
- Nothing is cancelled to reprioritise. The emergency reserve holds a slot open by capping
  ordinary work below the ceiling, so an incident never has to interrupt a running job.

Defaults are deliberately conservative and take effect the moment these apply: a portfolio
ceiling of 4 concurrent runs, 1 of them reserved for emergencies, 2 per project, and 1 per
worker. If the factory is currently running more than that, raise the ceilings with
`set_portfolio_capacity_limits` before applying rather than after.

## Version collisions

Two migrations must never share a version prefix. Supabase's ledger keys on the numeric prefix,
not the filename, so two files at `20260814000300_*` are two applies competing for one primary key
in `supabase_migrations.schema_migrations`. The first records the version, the second collides, and
`db push` fails partway with the schema half-applied against hosted.

That state existed in this repository on 2026-08-14 and is fixed: `declare_model_characteristics`
moved to `20260814000250`, which keeps it after the `20260814000220` migration whose columns it
depends on and leaves the AgentOS chain `000300`→`001000` intact. Neither file was hosted, so the
renumber carries no ledger consequence — this was safe to fix precisely because it was caught
before the apply.

Nothing else in the suite catches this class of defect. Both files applied cleanly in isolation,
both applied cleanly in filename order under PGlite (which has no ledger), and every behavioral
test passed, because the failure lives in the ledger rather than the schema. It surfaces for the
first time during the one operation that is hardest to reverse.

`tests/integration/migration-version-uniqueness.test.ts` now asserts uniqueness, that every
filename parses, and that filename order matches version order. It has happened three times, every
time from separate agents picking the same timestamp in parallel, so it is checked rather than
remembered.

The third was 2026-08-25: `20260825000200_run_cost_and_budget_in_graph_runs` (#416) landed on main
while `20260825000200_runs_state_their_closure_reason` was in flight on another branch. The second
renumbered to `20260825000300`. Worth knowing beyond the version itself: both files rebuild
`list_graph_runs`, and the in-flight one had been written against the older `20260823001000` body,
so merging it unchanged would have silently reverted the cost columns #416 had just added. When two
branches touch one `create or replace` function, the later file has to be rebuilt from whatever
actually reached main, not from whatever it was originally derived from — the version collision is
the loud half of that problem and the reverted body is the quiet half.

## Pending apply: `runs-closure-note` (20260825000300)

Not yet hosted. `graph_runs` gains `closure_note`; `complete_graph_run_as_worker` gains a defaulted
`p_closure_note`; `list_graph_runs` projects the column.

**Apply before the code that sends the note reaches production, not after.** The new function's
extra parameter is defaulted, so the currently deployed worker's seven-argument call still resolves
against it — but code that sends eight arguments to the old seven-parameter function fails, and it
fails on every run close. One direction is safe and the other bricks the worker.

```
scope=runs-closure-note
```

The step verifies all three halves read back — the column, the writer's parameter, and the
projection — and refuses if the ledger already records the version or if the file's hash has moved.

## Not covered here

- **A funded provider key and a registered Phase 1C worker.** Neither exists in any verified
  environment. Any key pasted into a chat transcript is compromised on arrival and must be rotated
  before use, not installed.
- **Vercel Deployment Protection.** Both `*.vercel.app` hosts still return `302` to
  `vercel.com/sso-api`, verified 2026-08-14. See `AI/PRODUCTION_OBSERVATION_EVIDENCE.md` — the
  monitoring consequence is smaller than it first appears, because `https://www.theagoras.com`
  returns `200` and is externally observable.

## Added for Phase 2D

| Migration | What it does | Approval |
| --- | --- | --- |
| `20260814002400_connection_registry_multi_account.sql` | Makes the connection registry describe capability, health and capacity so more than one account per provider becomes routable. Adds `connection_capability_types` (a closed, read-only vocabulary), `connections.capabilities` / `health` / `health_checked_at` / `max_concurrency` / `active_leases`, `project_connections.capability` / `priority`, two routing indexes, and the caller-scoped `list_project_connection_identities(uuid)` projection that never exposes `secret_reference`. | Ordinary forward migration |

It authorizes nothing on its own. No connection gains a capability it was not already
exercising, no project gains a mapping, and a newly created connection is deliberately
routable for nothing until a capability is declared — `capabilities` defaults to `[]` and
`health` defaults to `offline`, so a row existing is never mistaken for a verified account.

Verified on a real PostgreSQL 16.13 cluster with the whole chain applied from empty: all 65
migrations apply in order, 0 of 103 public tables are missing RLS or FORCE RLS, `service_role`
still holds table privileges on exactly the four GitHub ingress tables, and the new vocabulary
table is readable by `authenticated` but writable by nobody through a browser.

## Check this before running `supabase db push`

**A Supabase GitHub integration is installed on this repository.** It reports a
`Supabase Preview` check on pull requests — observed on PR #80, 2026-08-15,
with conclusion `skipped` and a details link to
`https://supabase.com/dashboard/project/qpuofpmagrmyamahqwxw/settings/integrations`.

That matters because this runbook tells you to apply migrations by hand. If the
integration is configured to apply migrations on merge to the production branch,
some or all of the migrations listed above may already be applied by the time
you read this, and a manual `db push` would be operating on a stale picture of
the ledger.

What is actually known, and what is not:

- **Known:** the integration is installed and posts checks on this repository.
- **Known:** the preview check was `skipped` on a pull request that changed
  `supabase/migrations/`, which is consistent with branch previews being off.
- **Not known:** whether merge-to-`main` apply is enabled. No credential in the
  agent environment can read the integration's settings or the hosted ledger.

So the first step of "Order of operations" above — re-list the remote ledger
before trusting any documented position — is not optional caution here. Open
the integrations page linked above, confirm what the integration is set to do
on merge, and only then decide whether a manual push is needed at all.

## The ledger drift blocking every apply, and the exact fix

The Supabase integration's config-parse failure is fixed. It now reaches the
migration comparison and fails there instead, on every merge to `main`:

```
Remote migration versions not found in local migrations directory.
```

That message names no version, so here is the derivation.

Supabase's ledger keys on the **numeric version prefix** only. A migration
renamed in a way that changes that prefix, *after* it was applied, leaves the
old version in the remote ledger with no local file to match — which is exactly
this error. Seven migration renames exist in this repository's history; six kept
a prefix that still exists locally and are harmless. One did not:

| Renamed from | Renamed to | Old prefix still present locally? |
| --- | --- | --- |
| `20260814002000_graph_engineering.sql` | `20260814000100_graph_engineering.sql` | **No** |

`AI/HANDOFF.md` records that `graph_engineering` "was already hosted and could
not move". If it was applied while still named `20260814002000`, the remote
ledger holds `20260814002000`, no local file carries that prefix, and the
comparison fails exactly as observed.

**This is a derivation, not a measurement.** No credential in the agent
environment can read the remote ledger, so confirm before acting:

```bash
supabase link --project-ref qpuofpmagrmyamahqwxw
supabase migration list          # remote column should show 20260814002000
```

If it is there and `20260814000100` is not, the schema effect is already
present and must not be re-run. Repair history only:

```bash
supabase migration repair --status reverted 20260814002000
supabase migration repair --status applied  20260814000100
supabase migration list          # re-list before trusting the result
```

If `migration list` shows something else, stop and re-derive — the table above
is the only candidate this analysis produced, not a guarantee that it is the
only one.

Until this clears, **no migration reaches hosted by any path**: the integration
fails at comparison, and a manual `db push` would be working from the same
mismatched ledger.
