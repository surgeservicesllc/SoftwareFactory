# Architecture

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

The Phase 1E operations and synthetic journeys, Phase 2A provider layer, universal bot-fabric registry, public marketing site, and separated route groups are published on `main`; the Phase 1C path exists only in the local reconciled tree. Hosted Supabase visibly has the published post-`027` schema objects but its migration ledger still has exactly 26 rows through `027`. The duplicate applied `130002` source version and unrecorded applied versions require protected history reconciliation before the absent Phase 1C migrations can be promoted. Production targets and provider credentials/live calls are unverified, both execution switches are OFF, and no live worker heartbeat/run exists. Phase 1E operations, outbound provider execution, bot-provider readiness, and OpenAI/Codex worker execution remain **Not Connected**.

## Phase 2A advisory provider boundary

- `GET /api/providers` derives provider state from a live server-side health probe and bounded tenant configuration. Missing credentials report **Not Configured**; they never fall back to a fabricated connection.
- Model discovery and configuration, agent assignment, routing preview, and the organization execution switch use authenticated tenant/owner boundaries. Enabling provider execution requires explicit owner confirmation and does not enable Phase 1C or Autonomous Mode.
- Routing is deterministic and records its candidates/reasons. Owner override, agent assignment, project default, and automatic score remain subordinate to capability and connection eligibility. Fallback is one bounded attempt and never follows authorization, cancellation, or content-policy failures.
- A Phase 2A run sends bounded context to an official provider SDK and persists a schema-validated advisory artifact, usage, routing decision, and redacted events. It cannot access a Git workspace or perform any repository/delivery mutation.

## Control-plane request boundary

- Server Components remain the default. Client Components collect bounded intent and render safe projections.
- `POST /api/commands` authenticates the caller, enforces same origin and active organization, accepts only a connected project, and rejects likely secrets before persistence.
- The server resolves the immutable GitHub repository UUID, App/installation IDs, full name, default branch, and current branch SHA from the live project connection. Prompt text cannot select or override a repository.
- Command type and prompt produce a deterministic risk floor. The most severe of requested risk, type floor, and protected prompt signals wins.
- A fixed plan selects provider `openai`, model `gpt-5.3-codex`, logical role, 45-minute duration, four turns, 200,000 input tokens, 50,000 output tokens, one repair, and 15-minute CI observation.
- Migrations `130007`/`130008` independently enforce the same provider/model/role/budget/workflow and raise risk from both prompt and acceptance criteria. Direct PostgREST callers cannot lower or widen the execution configuration; `130008` also requires an authenticated organization owner and an exact top-level parameter allowlist.
- Only manual GREEN/YELLOW work creates a claimable run. RED remains blocked even if legacy approval state changes.
- Dispatch uses a short-lived repository-ID-scoped installation token and sends `softwarefactory_phase1c_command` with only `command_id`. Dispatch is a wake-up hint, never authorization; the schedule is a durable recovery path.

## Worker and lease boundary

- `scripts/worker.mts` registers a worker and either polls or claims once. The reviewed GitHub Actions workflow runs one claim per invocation and also wakes every five minutes, but the job is skipped unless repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` equals literal `true`.
- `phase1c_workers` supplies heartbeat-derived connection truth. A one-shot worker started by approved default-branch repository dispatch or schedule records `idle` on clean exit; its fresh heartbeat is briefly Available/Connected, then becomes stale/**Not Connected** after the bounded threshold. Explicitly disabled, stale, or absent workers are **Not Connected**, a no-work observation is not end-to-end execution evidence, and branch-selectable manual workflow dispatch is absent.
- Service-role-only RPCs register/heartbeat/finish workers; claim and heartbeat runs; append events; record validation/artifacts; and complete, fail, or cancel a run. Direct table grants remain revoked.
- Claims use a UUID lease token, worker ID, bounded expiry, attempt counter, retryability, and cancellation checks. Stale leases are reclaimable only through the database contract.
- Member-facing list/detail/status RPCs expose bounded safe fields. Worker records, raw command input, raw model/provider failures, and service credentials are not broad browser-readable rows.
- Run events, artifacts, and validations are append-only. Activity events record material state transitions. Migration `130008` also creates one provider-neutral standard roster per organization, serializes concurrent work by logical agent, and keeps provider/model only on execution runs.

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

The worker mints repository-ID-scoped App tokens, commits as `surgeservicesllc <surgeservicesllc@gmail.com>`, pushes only the isolated `factory/*` branch, and creates or recovers only an open draft pull request. It records the branch, commits, PR, validation, changed paths, checks, and bounded Codex usage. Artifact replay must match immutable evidence, and migration `130007` persists the draft PR only when repository/project/run/base/head/URL/number are coherent.

An eligible retry may start cleanly from no provider evidence or a branch-only pre-push intent, or resume only from one exact branch/commit and optional matching draft PR. Partial/conflicting evidence is non-retryable. On coherent recovery the worker revalidates the remote branch head and, when present, the live draft PR before observing CI; it preserves the provider thread/usage only when the durable branch/commit evidence matches.

There is no default-branch commit, approval, merge, release, deployment, rollback, workflow modification, administration action, or secret-setting action in the worker.

## Persistence

- Hosted migrations `001`-`027` remain the verified Phase 1A/1B history.
- Pending `028` adds the Phase 1E production-operations control plane without connecting a production target or production mutator.
- Pending `130001` adds the Phase 2A provider configuration, routing, advisory-run, event, RLS/FORCE RLS, and owner/admin RPC boundary.
- Pending `130002` adds Phase 1E synthetic journeys with database-enforced safe-step/profile constraints and observation-only execution.
- Pending `130003`/`130004` add the bot-fabric event values and provider-neutral registry; pending `130005` adds the separate marketing schema. These published source layers remain unhosted and are not bot execution evidence.
- Pending `130006` adds Phase 1C enum values only. It is separated so PostgreSQL commits new enum values before `130007` uses them.
- Pending `130007` adds Phase 1C orchestration fields to commands/tasks/runs; task dependencies; worker heartbeat; append-only run events/artifacts/validations; safe status/list/detail RPCs; cancellation/retry; service-role lease/result RPCs; deterministic normalization/planning/queueing; RED blocks; RLS/FORCE RLS; exact grants; indexes; secret checks; and activity/report terminal evidence.
- Pending `130008` initializes/backfills the provider-neutral eleven-role roster; rebinds factory-created provider-bound role references without erasing user assignments; maps general work to Orchestrator; enforces owner-only command submission and prompt-plus-criteria risk parity; reconciles provider-table service-role ACLs; hardens artifact, retry, stale-lease, cancellation, and recovery coherence; publishes bounded structured terminal reports; and narrows agent/report projections.
- All nine pending migrations are unhosted and require an exact owner-approved protected promotion in order `028` -> `130001` -> `130002` -> `130003` -> `130004` -> `130005` -> `130006` -> `130007` -> `130008`.

## Existing GitHub/App boundary

The Phase 1B candidate App path remains independently live for installation `153479019` and exactly `surgeservicesllc/SoftwareFactory`. App secrets remain isolated, tokens are short-lived and repository scoped, callbacks are signed, and webhook ingress is HMAC verified/idempotent/redacted. Primary installation `153445938` remains rollback. This connected repository boundary does not make the Phase 1C OpenAI worker Connected.

## Autonomous-mode boundary

Manual Phase 1C execution is not Autonomous Mode. Migration `010` still locks the global kill switch ON and Autonomous Mode, auto approve, auto merge, auto deploy, and auto rollback OFF. The worker refuses RED and cannot merge or deploy. Phase 1D authority can change only through a separate owner-approved policy, migration, implementation, and rollout.

## Secret topology

- Vercel stores browser-public Supabase URL/publishable key and server-only application/GitHub secrets.
- The GitHub Actions worker requires seven protected repository secrets with the `SOFTWAREFACTORY_` prefix. GitHub does not allow Actions secret names beginning `GITHUB_`; the workflow maps the App values to runtime `GITHUB_*` variables only for the worker step.
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

- Vercel Production deployment `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ` serves the stable alias from main release `799d2cea189b6860a03987ae75c25765f9ac4aca`, points at the hosted Supabase project, and stores server-only GitHub/Supabase secrets. The explicit GitHub commit-identity names are configured for Production and Preview; live ordinary, protected, and candidate-backed draft commits verify the approved identity as both author and committer.
- Preview GitHub values are configured; Preview Supabase isolation remains unverified.
- CI performs read-only validation and does not deploy or merge.
- Phase 1C needs a durable worker/sandbox outside request lifetimes. Phase 2A uses supported server-side Anthropic/OpenAI API connections, never browser-automated consumer logins.

## Pending deployment and activation status

The retained Vercel production deployment is READY, but it predates the Phase 1E, Phase 2A, bot-fabric, marketing, and route-group main integrations and does not contain the local Phase 1C tree. Those source layers are published on `main`, but migration `028` and migrations `130001` through `130008` are unhosted, no production target/journey/provider execution has been observed, and the Phase 1C worker/schema are inactive. The fail-closed sequence keeps the Phase 2A organization switch and Phase 1C worker activation OFF, obtains exact approval, applies/verifies pending migrations `028` -> `130001` -> `130002` -> `130003` -> `130004` -> `130005` -> `130006` -> `130007` -> `130008`, configures worker secrets, verifies required checks, publishes and passes CI/Vercel while worker jobs stay skipped, then enables only the separately approved bounded capability and returns it to OFF afterward.
