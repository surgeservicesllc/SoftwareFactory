# Architecture

## Current release boundary — exact AI-account bot identity (ADR-108/ADR-109)

The local, not-yet-deployed candidate makes subscription identity a database
fact. Authenticated managers call `ensure_ai_account_bot` with the exact tenant
AI-account UUID; PostgreSQL derives the provider and credential slot, returns
the exact bot UUID, and enforces organization/account/provider/reference
coherence. A default/non-additional request reuses that account's bound bot or
may adopt one and only one unambiguous matching legacy bot in place, preserving
its UUID, assignments, and history. An explicit additional request creates a
distinct bot with the same exact account binding. Similar provider names or
credential references never substitute for the account identity.

Both `bots` and `bot_assignments` carry positive revisions initialized at 1;
BEFORE UPDATE triggers increment them monotonically and refuse overflow. The
checked assignment boundaries lock the current open posting and compare its
assignment UUID, project UUID, and revision before delegating inside the same
transaction to the established audited mutation. Configuration, lifecycle,
and execution-preference edits use the same comparison, and all checked edit
paths refuse released rows. Client-callable history is therefore immutable and
stale managers fail instead of restoring an obsolete role, grant, status,
model, or work effort.

Readiness is computed from environment-or-vault credential presence on the
server and persisted only by
`record_bot_readiness_preserving_disabled`. That RPC is executable only by
`service_role`, carries the initiating owner/admin user for authorization and
audit, locks the bot, and compares the exact revision, account UUID, provider,
model, credential reference, and base URL that were evaluated. A stale check
fails; a check cannot author `Disabled`; an already Disabled bot is returned
unchanged. No opened credential value enters a bot/readiness response,
readiness detail, bot row, or activity row. Ready remains configuration
evidence, not a live provider call or executor.

This is deliberately an EXPAND compatibility change. Legacy registration,
assignment, and readiness mutation definitions, signatures, security mode,
pinned search paths, and exact ACLs stay unchanged. In particular, all six
legacy assignment/readiness RPCs retain their authenticated-only execute grant
and their public/anon/service-role denials while checked wrappers and the
service-only readiness recorder are added. This keeps the currently deployed
application working across a migration-first cutover, at the bounded cost that
old callers can still bypass revision tokens and service-only readiness. A
separately approved forward CONTRACT migration may revoke those grants only
after the exact replacement application is deployed and accepted.

The read side obtains the complete open-assignment roster: released history is
filtered in PostgreSQL, results are keyset-paged by assignment UUID until an
empty terminal page even when an intermediate response is short, and invalid
cursor progress or the bounded 100-data-page guard fails the whole read. Only
then does the snapshot assert `assignmentsComplete`. The assignment-derived
Assign and Configure steps therefore fail closed without that proof; Connect
separately requires a connected account and its exact bound Ready bot. Overall
Factory completion requires that identity to continue through the exact
selected project and an active configured assignment.

The role and modal flows preserve that identity. A new posting starts from the
Developer permission preset and prefers an organization role with the matching
slug; existing postings retain their authored role/configuration. With zero
roles, the inline starter control defaults to the reviewed Backend engineer
template, saves its complete definition through `/api/bot-roles`, and assigns
the returned UUID only to blank selected drafts. AI Factory owns the sole
full-app modal/focus boundary; embedded roster, assignment, configuration, and
starter-role surfaces replace content inside it and never nest another dialog.

The account-connect component serializes start, retry, close, and unmount
cleanup. Every async read is fenced by exact session UUID and generation, so a
late superseded poll cannot mutate state or report Connected. Close blocks a
racing retry and waits for an in-flight start before cancelling its exact
session; a failed cancellation keeps the overlay open and resumes polling.

Migration `20260822000200_register_bot_for_ai_account.sql` is local and
unapplied at SHA-256
`39c8a4ae633e2e45dc71a754225ca54c9ef9dd27036f7b68dca6371e1c394981`.
Its protected `scope=bot-account-binding` verifies and applies only that exact
file after predecessor/absence and clean-catalog checks; broad apply refuses to
introduce it. The scope proves catalog, definition, security, search-path, ACL,
and ledger invariants. Runtime behavior, linked-database lint, application
health, and containment are separate mandatory post-apply release gates.
The combined final-candidate working tree passes lint, typecheck, production build, 331
Vitest files / 3,934 tests (7 skipped), and the corrected resource 404/social-
image browser regression across desktop/tablet/mobile. Its serialized broader
browser matrix passed 1,207 cases with 545 intentional viewport skips before
the one repeated resource-status defect was repaired. The final field audit also
fixed controlled Instructions editing and made required self-hosted/custom HTTPS
endpoints fail closed in both the form and registration API. Independent security,
broker, UI, and proxy reviews report no unresolved P0/P1/P2 findings. Final rebased-commit
gates, direct-main publication, and production apply remain pending exact RED
approval. No worker, graph executor, provider-login protocol, autonomy control,
approval, merge, deploy, or rollback authority changes.

## Current release boundary — immutable Factory command routing (ADR-106)

`POST /api/commands/route` is an authenticated, same-origin, organization-
owner-only boundary. Migration `20260821000400_command_factory_routing.sql`
(34,999 bytes; SHA-256
`e45149db3ca7c66a27934b0b49ac160e1b5ef597fc8f34ad8547de4759086598`)
delegates command/task/run creation to the established transaction, rechecks
the persisted effective risk, and stores an immutable route. That route binds
the selected project pipeline/template, configured bot assignment and bot,
role, provider, resolved model, work effort, and risk/configuration snapshot.
Exact idempotent replay reads the immutable route before consulting mutable
project, pipeline, roster, readiness, or capacity state, so later configuration
changes cannot rewrite or reroute history.

This boundary chooses and records; it does not dispatch or change an autonomy
control. No connected/fresh worker was observed, and approve, merge, deploy,
and rollback remain Not Connected. Missing hosted routing functions produce a
fail-closed Not Connected/503 response. Production currently hosts
`20260821000300` and the old application copy; `20260821000400` is unhosted.
The hosted release gate is not healthy: five linked lint errors/ten findings,
one raw organization with `autonomous_mode = true`, one raw organization with
`autonomy_kill_switch_active = false`, and two projects with effective kill off. These facts
supersede the older clean-lint/all-OFF/kill-ON global summary below.

## System context

```text
Browser (untrusted)
  -> Next.js server boundary
    -> Phase 2A: provider health/model discovery, routing preview, or owner-enabled advisory run
      -> official Anthropic/OpenAI adapter -> schema-validated advisory artifact
      -> no repository, approval, merge, deployment, or rollback authority
    -> Supabase Auth session + active organization + same-origin validation
    -> deterministic risk, plan, repository-ID and base-SHA binding
    -> Supabase command/task/run transaction (RLS + audit)
    -> repository_dispatch with opaque command UUID only

GitHub Actions one-shot worker (trusted server process; not a Vercel request)
  -> service-role lease/heartbeat/cancel RPCs
  -> repository-ID-scoped GitHub App token
  -> isolated factory/* Git workspace at exact base SHA
  -> @openai/codex-sdk with bounded workspace-write execution
  -> pinned-container deterministic validation + policy/secret scan
  -> commit + push isolated branch + open/recover draft PR
  -> exact-head GitHub CI observation
  -> durable bounded result, artifacts, validation, report, and activity evidence
```

The historical Phase 1E/2A/1D/1C source remains published, but the current production boundary is narrower than older evidence implied. Hosted production includes `20260821000300` and still serves the old copy; factory routing migration `20260821000400` is unhosted. Linked lint currently reports five errors/ten findings, and raw/effective control data contains the drift named above. No connected/fresh worker is present and no dispatch occurs. Phase 1E execution, outbound provider execution, Phase 1D execution, bot-provider execution, and OpenAI/Codex worker execution remain **Not Connected**.

## Phase 2A advisory provider boundary

- `GET /api/providers` uses a live server-side health probe only when the organization execution switch is ON. While it is OFF, the route returns a local **Disabled** snapshot and makes no outbound provider call. Missing credentials during an enabled probe report **Not Configured**; they never fall back to a fabricated connection.
- Configured model-catalogue reads remain tenant-local. Live provider model discovery is owner/admin-only and requires the organization execution switch ON; otherwise it returns a disabled error without an outbound call. Model configuration, agent assignment, routing preview, and the execution switch use authenticated tenant/manager boundaries. Enabling provider execution requires explicit owner confirmation and does not enable Phase 1C or Autonomous Mode.
- Routing is deterministic and records its candidates/reasons. Owner override, agent assignment, project default, and automatic score remain subordinate to capability and connection eligibility. Fallback is one bounded attempt and never follows authorization, cancellation, or content-policy failures.
- A Phase 2A run sends bounded context to an official provider SDK and persists a schema-validated advisory artifact, usage, routing decision, and redacted events. It cannot access a Git workspace or perform any repository/delivery mutation.

## Control-plane request boundary

- Server Components remain the default. Client Components collect bounded intent and render safe projections.
- `POST /api/commands` authenticates the caller, enforces same origin and active organization, accepts only a connected project, and rejects likely secrets before persistence.
- The server resolves the immutable GitHub repository UUID, App/installation IDs, full name, default branch, and current branch SHA from the live project connection. Prompt text cannot select or override a repository.
- Command type and prompt produce a deterministic risk floor. The most severe of requested risk, type floor, and protected prompt signals wins.
- A fixed plan selects provider `openai`, model `gpt-5.3-codex`, logical role, 45-minute duration, four turns, 200,000 input tokens, 50,000 output tokens, one repair, and 15-minute CI observation.
- Migrations `130007`-`130011` independently enforce the same provider/model/role/budget/workflow and raise risk from prompt plus acceptance criteria. Direct PostgREST callers cannot lower or widen the execution configuration; `130010` requires an authenticated organization owner and exact top-level parameters, while `130011` adds canonical same-project dependencies and cumulative retry budgets.
- Only manual GREEN/YELLOW work creates a claimable run. RED remains blocked even if legacy approval state changes.
- Dispatch uses a short-lived repository-ID-scoped installation token and sends `softwarefactory_phase1c_command` with only `command_id`. Dispatch is a wake-up hint, never authorization; the schedule is a durable recovery path.

## Worker and lease boundary

- `scripts/worker.mts` registers a worker and either polls or claims once. The reviewed GitHub Actions workflow runs one claim per invocation and also wakes every five minutes, but the job is skipped unless repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` equals literal `true`.
- `phase1c_workers` supplies heartbeat-derived connection truth. A one-shot worker started by approved default-branch repository dispatch or schedule records `idle` on clean exit; its fresh heartbeat is briefly Available/Connected, then becomes stale/**Not Connected** after the bounded threshold. Explicitly disabled, stale, or absent workers are **Not Connected**, a no-work observation is not end-to-end execution evidence, and branch-selectable manual workflow dispatch is absent.
- Service-role-only RPCs register/heartbeat/finish workers; claim and heartbeat runs; append events; record validation/artifacts; and complete, fail, or cancel a run. Direct table grants remain revoked.
- Claims use a UUID lease token, worker ID, bounded expiry, attempt counter, retryability, and cancellation checks. Stale leases are reclaimable only through the database contract.
- Member-facing list/detail/status RPCs expose bounded safe fields. Worker records, raw command input, raw model/provider failures, and service credentials are not broad browser-readable rows.
- Run events, artifacts, and validations are append-only. Activity events record material state transitions. Migration `130010` creates one provider-neutral standard roster per organization, serializes concurrent work by logical agent, and keeps provider/model only on execution runs. Migration `130011` persists dependencies atomically and prevents retry leases from resetting total turn/token budgets.

## Graph execution lane (ADR-092)

- A second, read-only execution lane runs recorded analysis graphs. Members plan graphs through `create_graph_from_plan` (console "Use template"); the graph executor worker (`scripts/graph-worker.mts`, workflow `graph-worker.yml` — manual dispatch, schedule gated on `SOFTWAREFACTORY_GRAPH_WORKER_SCHEDULED`) claims and runs them through five service-role definer functions (migrations `20260819000100`, `20260819000900`, `20260819001000`): `claim_planned_graph(worker_id, supported_executors)` (atomic FOR UPDATE SKIP LOCKED claim returning the whole projection; a graph needing an executor the caller does not declare is never claimed and stays PLANNED — ADR-093), `record_node_state_as_worker`, `record_graph_artifact_as_worker`, `complete_graph_run_as_worker`, `record_verification_as_worker`. The worker holds no table DML; the member write boundary is untouched.
- The claim's convergence rules: a graph is claimable when it has never run or when every previous run is FAILED or CANCELLED; three FAILED runs retire it, ten total runs is a hard ceiling, and CANCELLED (a provider capacity refusal — the run never truly executed) spends nothing. The claim also reclaims abandonment: a RUNNING run silent for over two hours closes FAILED with an event, its unfinished nodes close CANCELLED with the reason, and the graph re-enters the queue.
- Execution dispatches by declared node executor: MODEL nodes run through the pinned Claude CLI on the subscription credential (read-only tools, models tiered per node, no `ANTHROPIC_API_KEY` in the environment), DETERMINISTIC reduce nodes run through the engine's reducers, ANCHOR nodes fail honestly toward the Phase 1C workspace path. Edges carry data — each node's prompt receives its upstream outputs and an explicit missing list — and declared-tolerant fan-ins run with what completed while the run still closes PARTIAL. Token usage from the transport is recorded on the run.
- **What the executed path uses, and what it does not.** The engine carries more than the worker runs, and the module list is not a feature list. Executed today: compiler, topology/dependency analysis, scheduler (including tolerant fan-ins), runner with retries and budgets, fan-in completeness, reducers, provider bridge, contracts, and verification recording (`record_verification_as_worker`, surfaced by `list_graph_runs`). Present but **not wired to a stored graph**: `discovery` (a DISCOVERY_GRAPH executes as its recorded DAG — the worker adds no rounds, and the Templates view says so on the template itself), `handoffs`, `integration`, `optimizer` (it abstains below three observed runs of a shape, and no metrics aggregation feeds it yet), `connection-bridge` (one subscription credential, no identity routing), and `anchor-store` (ANCHOR nodes fail honestly toward the Phase 1C path rather than executing here). Each is real code with tests; none of it runs in the executor, and a reader should not infer otherwise from its presence.
- Members read results through `list_graph_runs` (definer, membership-checked, authenticated only) via `GET /api/graphs/runs` and the pipelines console's Graph runs view. File-writing graph nodes remain outside this lane by design.

## Execution isolation

- The worker builds a dedicated run directory outside the repository/home/filesystem root and stores a non-secret identity marker binding run, repository ID, base SHA, and branch.
- Git verifies the exact remote default-branch SHA before checkout. A moved base fails as `stale_base_sha`; no silent rebase or default-branch write occurs.
- The branch format is `factory/<run-uuid>-<bounded-slug>`. Recovery verifies remote, branch, ancestry, and marker identity before reuse.
- Provider credentials are excluded from general child-process environments. Git tokens are injected only into the individual Git command environment and redacted from bounded output.
- Codex uses an isolated `CODEX_HOME`, `sandboxMode: workspace-write`, `approvalPolicy: never`, network disabled, web search disabled, high reasoning effort, structured result schema, and bounded turns/tokens.
- Dependency bootstrap uses the exact pinned `node:22.22.0-bookworm` digest with `npm ci --ignore-scripts --no-audit --no-fund`. Deterministic validation uses that digest with network none, read-only root, dropped capabilities, no-new-privileges, PID/CPU/memory constraints, and bounded output.
- Required local validation is `git diff --check` plus every repository-defined lint, typecheck, test, and build script. Missing scripts are reported as skipped; failures enter at most one bounded repair cycle.
- Provider CI has an independent required-check allowlist. `SOFTWAREFACTORY_REQUIRED_CHECKS` must name 1-20 unique pipe-delimited checks; the reviewed workflow fixes the exact names `Lint, typecheck, test, and build` and `Browser and accessibility tests`. The publisher rejects truncated check sets, requires every observed check terminal and acceptable, requires every named check to be exact `success`, observes the same passing fingerprint twice, then revalidates the draft PR number/base/head.
- The policy scan blocks escaped/forbidden paths, symlinks, binary files, likely secrets, files over 2 MiB, more than 200 changed files, and more than 10 MiB total. Protected paths require a current exact approval naming every path; RED work is categorically blocked earlier.

## GitHub publication boundary

The worker mints repository-ID-scoped App tokens, commits as `surgeservicesllc <surgeservicesllc@gmail.com>`, pushes only the isolated `factory/*` branch, and creates or recovers only an open draft pull request. It records the branch, commits, PR, validation, changed paths, checks, and bounded Codex usage. Artifact replay must match immutable evidence, and migrations `130009`/`130010` persist the draft PR only when repository/project/run/base/head/URL/number are coherent.

An eligible retry may start cleanly from no provider evidence or a branch-only pre-push intent, or resume only from one exact branch/commit and optional matching draft PR. Partial/conflicting evidence is non-retryable. On coherent recovery the worker revalidates the remote branch head and, when present, the live draft PR before observing CI; it preserves the provider thread/usage only when the durable branch/commit evidence matches.

There is no default-branch commit, approval, merge, release, deployment, rollback, workflow modification, administration action, or secret-setting action in the worker.

## Persistence

- Hosted history is canonical through `130014`. Catalog-proven `028`/`130001`-`130005` were reconciled ledger-only; their DDL was not rerun.
- Hosted `130006` defines the intended global-kill/all-actions-OFF policy, while `130007`-`130011` provide Phase 1C compatibility, enums, orchestration, roster/recovery/reporting, dependencies, and cumulative budgets. Current raw/effective hosted rows have drifted from that intended control state; absence of a connected/fresh worker prevents dispatch but does not make the drift acceptable.
- Hosted `130012` repairs bot `NULLIF` qualification without changing function identity/security/ACLs; `130013` resolves Phase 1C function lint; `130014` adds the resolver's explicit emergency-stop result. Corrections remain forward-only.
- Local `130015` restores the original 128-character provider catalogue/API model bound by changing `provider_agent_assignments_model_check` and `agent_runs_model_check` from 120 to 128 while retaining the assignment regex and other constraint semantics. It adds four named no-secret constraints covering catalogue model/display-name, assignment model, and routing policy-version/selected-model text so credential-shaped scalars cannot enter browser-readable rows. It also replaces `get_agent_run_detail(uuid, uuid)` with a rolling-compatible bounded `routing` object: Phase 2A evidence is allowlisted/capped, Phase 1C command runs receive fixed-policy reasons without fabricated scores, and absent durable evidence returns null. To prevent bypass of that projection, it revokes authenticated raw SELECT on `provider_routing_decisions` and `provider_run_events`, retains tenant-scoped SELECT on `provider_model_configurations`, and leaves assignment reads behind their bounded function. The application accepts a missing field against hosted `130014`; `130015` remains unhosted pending its own exact RED approval and exact six-constraint-definition/128-character/no-secret regressions plus identity/signature/table-and-function-ACL/RLS/direct-denial/runtime/lint/health verification.

## Existing GitHub/App boundary

The Phase 1B candidate App path remains independently live for installation `153479019` and exactly `surgeservicesllc/SoftwareFactory`. App secrets remain isolated, tokens are short-lived and repository scoped, callbacks are signed, and webhook ingress is HMAC verified/idempotent/redacted. Primary installation `153445938` remains rollback. This connected repository boundary does not make the Phase 1C OpenAI worker Connected.

## Autonomous-mode boundary

Manual Phase 1C execution is not Autonomous Mode. The schema's intended policy locks the kill switch ON and Autonomous Mode, auto approve, auto merge, auto deploy, and auto rollback OFF, but current hosted raw/effective rows do not uniformly satisfy that policy. No worker/executor is connected, so the drift grants no dispatch, merge, or deploy path; it must nevertheless be contained before release. Phase 1D authority can change only through a separate owner-approved policy, migration, implementation, and rollout.

## Secret topology

- Vercel stores browser-public Supabase URL/publishable key and server-only application/GitHub secrets.
- The GitHub Actions worker requires seven protected repository secrets with the `SOFTWAREFACTORY_` prefix for a live run. Six non-OpenAI secrets remain configured; the compromised OpenAI credential is absent pending a funded replacement. GitHub does not allow Actions secret names beginning `GITHUB_`; the workflow maps the App values to runtime `GITHUB_*` variables only for the worker step.
- The non-secret `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` repository Actions variable is a final fail-closed gate. Missing/false skips all worker jobs; enabling it is a protected RED action.
- `SOFTWAREFACTORY_REQUIRED_CHECKS` is a mandatory non-secret policy input, not an enable switch. Missing/invalid input prevents worker startup, while missing or mismatched check evidence prevents CI success.
- No OpenAI key, service-role credential, App private key, installation token, or database password may enter source, Supabase rows, model prompts/output, browser responses, logs, fixtures, reports, or artifacts.

## Webhook boundary

- Maximum raw body: 2 MiB.
- Verify HMAC-SHA256 before JSON parsing.
- Validate delivery/event headers and payload schema.
- Hash the raw payload; store only an allowlisted redacted subset.
- Deduplicate delivery ID and reject conflicting payload reuse.
- Reconcile installation/repository/PR/check/status events through bounded database functions. Newly granted repository metadata uses the hosted service-role-only `013` function after signature, installation, tenant, and event validation.
- After `016`/`018` promotion, provider timestamps order lifecycle metadata, deletion is terminal for an installation ID, stale events are recorded as ignored, and a restored repository remains unselected until access is resynchronized.
- Repository rename/default-branch updates reach only projects linked through the same tenant connection and emit redacted immutable evidence through `014`.
- After `021`/`023` promotion, project attribution and metadata propagation follow the immutable repository UUID rather than mutable names; accepted GitHub activity may expose only bounded allowlisted actor/source/resource/action/status/conclusion/transition details.
- Unknown events/installations are ignored safely, not used to create tenant ownership.

## Dual-App replacement boundary

- Candidate App `4582606`, installation `153479019`, and connection `85591f43-dd4e-46d2-8a1b-0f036b32639f` are the live project path. Primary App `4573846`/installation `153445938` remains active as the rollback path, and its webhook defect remains tracked under Support `#4660724`.
- Candidate configuration is absent-or-complete and cryptographically isolated. Signed install state binds App slot plus App ID, callback verification uses that exact App, and all repository token minting follows the persisted installation `app_id`.
- Webhook ingress may verify either configured secret but rejects a signing-App/persisted-installation App-ID mismatch. Candidate installation `153479019` produced a processed signed delivery after synchronization, satisfying the first-handoff provenance/freshness gate; subsequent push and check-status deliveries are visible through bounded Activity evidence.
- The owner handoff uses an immutable exact-tuple RED approval plus single-use execution and an atomic database RPC. Both installations and repository copies must remain active/selected and refer to the same GitHub account/external repository. Pending changes and conflicting links block the transition; the live handoff preserved project `b1f23696-437e-4d89-b55f-d7a949980e8f` and its change/audit history.
- Candidate-backed read and draft-write acceptance passed through PR `#8`. The PR remained draft, CI and preview passed, it was closed unmerged, and its temporary branch was deleted. A reverse handoff and disconnect/loss observation remain pending before primary retirement.

## Production-operations plane (Phase 1E)

```text
Owner/admin request -> /api/operations/* (same-origin, tenant-scoped, no-store)
  -> bounded HTTPS probe (public targets only, no response body read)
    -> record_monitor_observation -> evaluate_project_health
      -> open_production_incident (fingerprint dedupe, SEV1-SEV4)
        -> freeze_project_releases (automatic for SEV1/SEV2)
        -> enqueue_operations_event (durable, idempotent)
          -> record_rollback_decision  ..... always blocked: no executor
          -> record_production_diagnosis .. deterministic rules engine
          -> create_repair_attempt ........ bounded to 3, assignment not_connected
            -> resolve_production_incident . gated on restoration + validation + cause
```

- Ten tables carry RLS and FORCE RLS; browsers receive SELECT only. Every write goes through a SECURITY DEFINER workflow that re-derives the caller from `auth.uid()`, so `service_role` gains no new table privileges and the verified migration-`026` ACL matrix is unchanged.
- `monitor_observations`, `project_health_snapshots`, `production_diagnoses`, and `operations_audit_events` are append-only: a trigger refuses UPDATE and DELETE for any role that could reach them.
- The only connected monitoring adapter is a direct HTTPS probe. `production_monitors_enabled_requires_connection` makes it impossible to enable a monitor whose adapter is Not Connected, so the product cannot present a signal it did not observe.
- `autonomous_release_allowed` returns false unconditionally and enumerates the live blockers. `EXECUTOR_NOT_CONNECTED` is appended without a condition, so no configuration change can make it return true.
- The probe validates its target before every request: HTTPS only, standard port, no credentials in the URL, and no loopback, private, carrier-grade-NAT, link-local, or cloud-metadata address. It does not follow redirects and never reads a response body, so production content cannot enter control-plane evidence. Residual limitation: a public hostname that resolves to a private address at DNS time is not detected.
- Scheduled monitoring is **Not Connected**. Checks are owner-triggered because no scheduler identity is authorized, and adding one must not widen `service_role`.

## Security invariants

- Client input/provider output is untrusted.
- Every sensitive operation is server-authorized and RLS-scoped.
- Service role never enters the client and does not erase independent tenant checks.
- Secrets/file bodies are excluded from audit metadata.
- Important transitions append immutable events.
- RED/protected actions require exact owner approval.
- Auto approve/merge/deploy/rollback remain OFF.
- Command mutations require same-origin requests. Global CSP/security headers deny framing and objects and restrict browser scripts, connections, images, forms, and other resource loads to required origins.

## Deployment topology

- The prior verified production baseline before this update was commit `0c662a24393f682073e6002c5aff9339292226d8`, with audited READY deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7`. It points at the hosted Supabase project and stores server-only GitHub/Supabase secrets. The explicit GitHub commit-identity names are configured for Production and Preview; live ordinary, protected, and candidate-backed draft commits verify the approved identity as both author and committer.
- Preview GitHub values are configured; Preview Supabase isolation remains unverified.
- CI performs read-only validation and does not deploy or merge.
- Phase 1C needs a durable worker/sandbox outside request lifetimes. Phase 2A uses supported server-side Anthropic/OpenAI API connections, never browser-automated consumer logins.

## Current deployment and activation status

The prior verified production baseline before this update was `0c662a24393f682073e6002c5aff9339292226d8`; CI run `31749352644` passed both required jobs and matching Vercel deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7` was READY. Hosted reconciliation/promotion through `130014` is complete; local `130015` is unapplied. The frozen current-update candidate passes its local final gate set, but its publication commit, CI, matching Vercel deployment, and hosted migration proof remain pending. One bounded worker run proved claim/heartbeat/provider-thread persistence and failed before repository mutation; no-claim diagnostic `31748582858` then classified `credit_balance_exhausted`. The activation variable and OpenAI secret are absent, while six non-OpenAI secrets remain. The remaining live-worker sequence requires a funded replacement, successful no-claim diagnostic, and new current-base GREEN command before bounded activation. Phase 1D remains execution-inert throughout.
