# Architecture

## System context

```text
Browser (untrusted)
  -> Next.js server boundary
    -> Supabase Auth session + active organization + server validation
      -> Supabase Postgres (RLS/FORCE RLS + immutable activity evidence)
      -> GitHub App adapter (server-only primary/candidate secrets selected by installation App ID)
        -> short-lived token scoped to one installation/repository/permission set
        -> GitHub API / signed webhooks (untrusted provider data)
```

Vercel hosts Next.js but is not an in-product deployment adapter. Codex/OpenAI and Claude/Anthropic workers are outside the Phase 1B runtime and **Not Connected**.

The Phase 1D observation module is an inert policy boundary: it may calculate `WOULD_BE_ELIGIBLE` for freshly evidenced GREEN work, but returns `executionAllowed: false`. The global kill switch is ON, observation-only is fixed, and no executor adapter is connected.

## Presentation and application services

- Server Components are preferred for data-bearing views; client boundaries are narrow interactive forms/editors.
- Auth/onboarding resolves the user and active tenant before live control-plane views.
- Connections shows real Supabase/GitHub metadata only after exact active-organization reads; otherwise it says **Not Connected**.
- Projects derives repository/default-branch authorization and UI matching from the immutable tenant-scoped GitHub repository UUID on the project connection. It renders live sync freshness, branch protection/SHA, commit and PR dates/authors, detail-fetched mergeability, default-branch checks, and per-PR checks against each displayed head SHA; retained rows alone do not count as connected.
- Files reads the real repository tree/content at explicit refs only for projects whose live connection evidence remains valid. Ordinary owner/admin intent enters the controlled draft-PR flow; an exact protected-file intent additionally requires an active owner, path-bound RED confirmation, rationale, rollback plan, and unexpired recorded approval.
- Activity reads immutable tenant events through the caller-member, 100-row `list_activity` RPC and returns an allowlisted bounded projection of actor/source/resource/action/status/conclusion/transition evidence. Authenticated direct SELECT on raw Activity and webhook-delivery rows is revoked.
- Agents, commands, tasks, runs, and reports use caller-bound list RPCs that cap results at 100 and omit sensitive base-table columns. Agent capabilities are returned only when their serialized JSON is at most 8 KiB. Authenticated sessions do not receive direct SELECT on those base tables.
- Live dashboard metrics derive from tenant rows; seeded sections retain **Demo Data** labels.

## Persistence

- Migrations `001`-`003` define the core control plane and audit/approval workflows.
- `004` defines GitHub installation, repository, webhook-delivery, and change-request state plus privileged reconciliation functions.
- `005` defines authenticated organization onboarding.
- `007` transactionally links an active selected repository to a safe-default project.
- `008_fix_github_sync_ambiguity` additively qualifies the repository installation column and named conflict constraint; it is applied remotely, local/remote history matches, and linked public-schema lint is clean.
- `009_harden_github_project_and_sync` serializes external-installation synchronization before connection creation, re-resolves the authoritative tenant/connection binding after upsert, and makes the synchronized repository default branch the only persisted project-branch authority. It is applied remotely; local/remote history matches through `009` and linked lint is clean.
- RLS and FORCE RLS apply to every exposed table. User-facing requests use caller JWT/RLS; narrow service-role operations still validate actor/organization/resource through audited functions.
- `010_phase1d_observation_controls` is applied to hosted Supabase. It adds a database-locked organization kill switch, constrains projects to Autonomous Mode OFF and GREEN with all automatic action flags OFF, and hardens the owner-only controls RPC/audit language. Hosted checks confirm the default/constraints/data/grants remain fail closed; there is still no executor.
- Hosted migrations `011`-`027` implement the hardening chain described above. The verified pre-`027` dry-run/lint, RLS/catalog/browser-grant, and zero-mismatch service-role ACL baseline remains recorded. Hosted `027` adds immutable RED handoff approvals/executions, external-repository serialization, exact target-delivery provenance/freshness checks, and the owner-only atomic reversible project rebind; its live candidate handoff path passed.
- Applied migration filenames are immutable; timestamp gaps are not renumbered.

## Secrets and token lifecycle

- Supabase URL/publishable key are browser-public; RLS remains mandatory.
- App private key, GitHub client/state/webhook secrets, Supabase service role, and future provider keys stay in Vercel server-only settings.
- GitHub commit attribution comes from two dedicated server-only environment values. The route validates them before tenant persistence or provider contact, never accepts them from the browser, never stores/logs them, and supplies the same explicit identity as both Contents API `author` and `committer` with no App-bot fallback.
- Installation-start state is HMAC signed, expires in ten minutes, and is bound to user, organization, allowlisted return path, and an HttpOnly nonce cookie.
- Ephemeral GitHub user OAuth tokens verify installation access, are not persisted/returned, and are revoked best-effort. GitHub has no `GET /user/installations/{id}` route: the deployed callback uses bounded documented `GET /user/installations` and requires an exact installation-ID/App match before proceeding. Primary installation `153445938` and candidate installation `153479019` passed this production path.
- App JWTs are short-lived; installation tokens are further scoped to one repository ID and exact route permissions.

## Repository read/write boundary

Read routes normalize and schema-validate branches, commits, PRs, check runs, directory entries, and UTF-8 files. Repository coordinates, refs, paths, response sizes, binary content, and installation state are bounded.

Write flow:

1. Same-origin, authenticated owner/admin request. A protected path requires the active organization owner specifically.
2. Verify active connection, selected non-archived repository, project mapping, and synchronized default branch. Repository full names are normalized and compared literally, without SQL wildcard semantics.
3. Reject likely secrets. For a protected resource class, require the exact `APPROVE RED DRAFT PR FOR <path>` phrase plus bounded rationale and rollback plan; bind approval to the path, content digest, expected blob SHA, branch, requester/approver/executor, and a maximum 15-minute decision window.
4. Reserve `github_change_requests` evidence through a caller-authenticated RPC that revalidates the exact live tenant/project/connection/repository UUID binding. Protected approval evidence is append-only, recorded atomically, and trigger-bound to that exact pre-provider reservation.
5. Within the five-minute reservation lease, revalidate approval/intent and mark the persisted provider-execution boundary before minting the write-scoped GitHub installation token. An expired reservation is reclaimable only by the original requester for the exact intent and only while no provider execution/evidence exists.
6. Create a unique `softwarefactory/*` branch.
7. Commit using the expected blob SHA and the strictly validated server-only deployment identity as both author and committer.
8. Require an open draft pull request.
9. Complete or fail the audited request record. If GitHub created the draft PR but database completion was ambiguous, recover that same provider evidence rather than create a second PR.

There is no merge or deployment step.
There is also no HTTP local-repository write path; the legacy route, UI, and environment switch are removed.

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
- Phase 1C needs a durable worker/sandbox outside request lifetimes; Phase 2 adds Claude only through supported API connections, never five browser-automated consumer logins.
