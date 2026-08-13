# Architecture

## System context

```text
Browser (untrusted)
  -> Next.js server boundary
    -> Supabase Auth session + active organization + server validation
      -> Supabase Postgres (RLS/FORCE RLS + immutable activity evidence)
      -> GitHub App adapter (server-only secrets)
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
- Hosted migrations `011`-`026` implement the hardening chain described above. Local and remote history match; dry run/lint and prior RLS/catalog/browser-grant checks pass. Post-`026` verification reports zero ACL-matrix mismatches: `service_role` has only SELECT/INSERT/UPDATE on the four GitHub provider-ingress tables and no table privileges on the other 19.
- Applied migration filenames are immutable; timestamp gaps are not renumbered.

## Secrets and token lifecycle

- Supabase URL/publishable key are browser-public; RLS remains mandatory.
- App private key, GitHub client/state/webhook secrets, Supabase service role, and future provider keys stay in Vercel server-only settings.
- Installation-start state is HMAC signed, expires in ten minutes, and is bound to user, organization, allowlisted return path, and an HttpOnly nonce cookie.
- Ephemeral GitHub user OAuth tokens verify installation access, are not persisted/returned, and are revoked best-effort. GitHub has no `GET /user/installations/{id}` route: the local unpublished callback fix uses bounded documented `GET /user/installations` and requires an exact installation-ID match before proceeding.
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
7. Commit using the expected blob SHA.
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

- Vercel Production points at the hosted Supabase project and stores server-only GitHub/Supabase secrets.
- Preview GitHub values are configured; Preview Supabase isolation remains unverified.
- CI performs read-only validation and does not deploy or merge.
- Phase 1C needs a durable worker/sandbox outside request lifetimes; Phase 2 adds Claude only through supported API connections, never five browser-automated consumer logins.
