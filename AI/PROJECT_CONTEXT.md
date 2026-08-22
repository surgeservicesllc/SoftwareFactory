# Project context

## Product

SoftwareFactory is a tenant-scoped software-engineering control plane. It joins authenticated projects to provider connections, logical agents, durable commands, tasks, runs, validation, source-control artifacts, reports, approvals, and immutable audit evidence. A logical agent, provider credential, model, user, project, and repository are separate records and must never be treated as interchangeable.

## Active delivery tracks

Exact application commit `30d7e824691bdd4f8fa72481b21c91d3da6e3a31` is
currently on `main`, with `surgeservicesllc <surgeservicesllc@gmail.com>` as
both author and committer. Vercel production deployment
`dpl_FrvCToHvFhkzfwnkmEeeTyfuE3v2` is READY at
`https://softwarefactory-116001qbk-surgeservices-projects.vercel.app` and owns
the stable production aliases. GitHub deployment `6036292508` and successful
status `17160408639` bind that deployment to the exact commit.

Exact-head CI run `32570540183` is red. All three browser/accessibility shards
passed, but quality job `97025270055` failed in the migration-backed test suite
before build because `20260822000150` compared non-canonical function-source
bytes. The local repair canonicalizes CRLF and lone CR to LF before every
`md5(prosrc)` comparison. Full native PostgreSQL 17.10 and 18.4 migration chains
now pass. The repair is frozen in the current forward candidate but is not yet
published or deployed, and no hosted database mutation has occurred.

The release repairs the Claude bot Role-assignment and guided AI Factory
journey. Exact identity is tenant AI account -> account-bound bot -> selected
project -> revision-checked open assignment; provider/credential similarity is
never a substitute. Bot and assignment revisions advance monotonically,
checked writes refuse stale or released postings, and a service-role-only
readiness recorder compares the exact bot revision/account/provider/model/
credential reference/base URL while preserving management-authored Disabled.
Complete keyset pagination fails the roster and assignment-derived Factory
progress closed rather than treating a prefix as truth.

The UI has one application modal and no nested assignment/configuration/role
dialogs. A zero-role organization defaults to the reviewed Backend engineer
starter through the audited role API and uses its returned UUID; the separate
Developer permission preset remains the new-posting configuration default, and
existing posting role/configuration is preserved. Broker start/retry/close and
cleanup are serialized and generation-fenced.

Owner-screenshot containment found that `ProjectBots` treated a similar
`credentialRef` as proof of an exact AI-account link and hid the repair control.
An unbound Ready legacy bot could therefore be assigned while AI Factory
correctly kept steps 5-7 incomplete. The local fix removes that inference,
exposes the existing exact `/api/bots/connect/provision` Link-or-repair/adoption
path, awaits the parent refresh, and adds an accessible **Return to AI Factory**
action. The affected completion predicate remains connected account + exact
`aiAccountId` + current Ready + project assignment.

The UI containment is frozen in the current unpublished candidate. Focused UI
passes 75/75; focused ESLint, full typecheck, and lint/typecheck/build are green. The root
full suite passes 337 files / 4,054 tests, with 3 files / 7 tests skipped. A
first contention-only `supabase-wiring` timeout cleared isolated 2/2 and on the
full rerun. The current protected repository file identities are:

- `20260822000150_normalize_legacy_bot_function_acls.sql` —
  `6b24b6ebb57e59b9c4398c3e439221c27c300663a7b6932ff192996ffe6bcd93`;
- `20260822000200_register_bot_for_ai_account.sql` —
  `658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`;
- `20260822000300_contract_bot_mutator_acls.sql` —
  `79914bc97660eef908b6a0fa0c90abfdd15da1683b383ad568e34bf3bd32c5f7`.

All three remain unhosted. The mandatory order is ACL normalizer, EXPAND,
exact-app signed-in production acceptance, then CONTRACT. EXPAND preserves the
legacy definitions and execute ACLs while adding checked boundaries; CONTRACT
may revoke those grants only after separate exact approval. The published
application does not connect a worker or enable autonomous action, approval,
merge, deployment, or rollback. Containment remains kill switch ON, autonomy
OFF, and all automatic actions OFF.

The published default branch contains the Phase 2A advisory provider layer and the execution-inert Phase 1D decision layer. Hosted Supabase is reconciled through migration `20260813001400_resolve_emergency_stop.sql`; local migration `20260813001500_expose_bounded_run_routing.sql` is not hosted and awaits its own exact RED approval. `130015` restores the original 128-character provider catalogue/API bound for assignment/run model checks, rejects credential-shaped catalogue model/display-name, assignment model, and routing policy-version/selected-model text in browser-readable rows, adds bounded run-detail routing evidence, and closes raw authenticated reads of routing decisions/events while retaining RLS-scoped model-configuration reads. Provider execution remains OFF, provider credentials/live calls are unverified, the global kill switch remains ON, all nine automatic actions remain OFF, and no autonomous executor exists. Both provider execution and Phase 1D execution remain **Not Connected**.

The published repository contains a **Phase 1C implementation** for a manually requested Codex execution path:

`Owner command -> deterministic plan -> durable run -> Codex SDK worker -> isolated factory branch -> validation -> draft pull request -> CI observation -> SoftwareFactory result`

This implementation is not yet a Connected worker capability. Under exact owner RED approval and scoped forward-only deltas, the hosted ledger was reconciled for catalog-proven `028`/`130001`-`130005` without rerunning their DDL, and forward migrations `130006`-`130014` were applied to exact project `qpuofpmagrmyamahqwxw`. Linked lint is clean; bot register/update/readiness runtime and audit behavior passed `1/1/1`; the repaired bot functions contain zero `pg_catalog.nullif` while retaining signatures, `SECURITY DEFINER`, pinned `search_path`, and ACLs; and the hosted autonomy resolver reports emergency-stop state while all actions remain OFF and the kill switch remains ON. The workflow is published and six non-OpenAI worker secrets remain configured, but activation is absent/OFF and the exposed OpenAI key was removed. The first live claim recorded a heartbeat and provider thread before failing safely without a repository change; no-claim diagnostic run `31748582858` then identified `credit_balance_exhausted`. The failed run's immutable base SHA now predates current `main`, so it must not be retried; a new command must be bound to the then-current base after funded-provider proof. OpenAI/Codex therefore remains **Not Connected**.

Separately, retained Phase 1C/`130015` local evidence passes Node `24.19.0`
lint/typecheck, 118 Vitest files / 1,311 tests, coverage
76.70/71.47/74.04/78.11, a 74/74-route production build, Playwright/axe
117/117, production dependency audit 0, and clean diff-check. Publication and
hosted `130015` proof remain pending for that independent workstream. Neither
that evidence nor this release proves a successful provider execution or
draft-PR journey.

Phase 1B retains its verified owner path: candidate GitHub App `4582606`, installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, and project `b1f23696-437e-4d89-b55f-d7a949980e8f` are connected for exactly `surgeservicesllc/SoftwareFactory`. Primary installation `153445938` remains the rollback path while its webhook defect is tracked by GitHub Support ticket `#4660724`. The live second-tenant, reverse-handoff, disconnect, and remaining adverse matrix are still incomplete.

The only live SoftwareFactory owner identity is `surgeservicesllc@gmail.com`. Reviewed commits and worker-created commits use `surgeservicesllc <surgeservicesllc@gmail.com>` as both author and committer.

## Phase 1C authority boundary

Phase 1C allows only an authenticated, manually submitted GREEN or YELLOW command against the exact active project/repository binding captured at submission. The database independently recomputes the risk floor and fixes the provider, model, logical role, budgets, and draft-PR workflow so browser input cannot widen execution authority.

RED commands are persisted truthfully but remain blocked from worker execution. An owner approval does not widen the Phase 1C ceiling. Autonomous Mode remains OFF, the Phase 1D global kill switch remains ON, and automatic approval, merge, deployment, and rollback remain OFF.

The implementation uses the server-side TypeScript `@openai/codex-sdk` from a reviewed GitHub Actions worker. Vercel request handlers only persist and dispatch intent; they never run Codex. The worker must claim a short lease from Supabase, revalidate an immutable repository snapshot, execute in an isolated workspace, pass deterministic validation and protected-path/secret policy scans, push a `factory/*` branch, create or recover only a draft pull request, observe exact-head CI, and persist bounded redacted evidence.

## Truthful status language

- **Demo Data** means seeded or static presentation data.
- **Not Connected** means no verified end-to-end provider session or worker heartbeat/run is available.
- **Configured** means code or protected configuration exists; it does not prove connectivity.
- **Queued** means intent and a durable run exist; it does not prove a worker claimed or executed it.
- A draft pull request is not a merge or deployment.
- Local migrations and passing mocks are not hosted database evidence.

## Product principles

1. Truth before theater: status follows fresh durable evidence.
2. Safe by default: external mutation starts OFF and fails closed.
3. Server-side trust: provider credentials and privileged workflows never enter the browser.
4. Independent tenant defense: application checks and Supabase RLS both enforce ownership.
5. Immutable provider identity: execution is bound to repository IDs and an exact base SHA, not prompt text or a mutable repository name.
6. Bounded execution: time, turns, tokens, retries, output, changed files, and CI observation have hard limits.
7. Review before delivery: Phase 1C ends at a validated draft pull request and recorded CI state.
8. Auditability: leases, events, artifacts, validations, cancellation, retry, and results are durable and redacted.
9. Progressive authority: the Phase 1C draft-PR worker, Phase 2A advisory provider execution, and Phase 1D autonomy are separate authority surfaces; enabling one never enables another.

## Phase 1C exit criteria

Phase 1C is complete only after the exact reconciled and published tree passes all release and live-acceptance gates. Hosted reconciliation through `130014`, prior workflow/publication evidence, and the frozen current update's local final-candidate gates are complete; current publication CI/deployment and exact RED promotion/verification of local `130015` remain pending. The remaining provider exit gate is a funded-provider diagnostic followed by a new current-base command producing a real Codex execution, isolated branch/commit, open draft pull request, deterministic validation, stable exact-head required-check success, safe UI/detail evidence, and immutable audit trail. Applying `130006` or `130015` does not authorize Phase 1D or provider execution. `AI/QUALITY_SCORECARD.md` is the evidence record.
