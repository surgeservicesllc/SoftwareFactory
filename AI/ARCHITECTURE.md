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
- Projects derives repository/default-branch state from an active unsuspended installation and selected healthy repository through an audited transaction. Retained rows alone do not count as connected.
- Files reads the real repository tree/content at explicit refs only for projects whose live connection evidence remains valid, and turns owner/admin intent into a controlled draft-PR flow.
- Activity reads immutable tenant events through caller-session RLS and returns a bounded browser shape without raw metadata.
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
- Local migrations `011_harden_direct_mutation_boundaries`, `012_github_change_audit`, and `013_reconcile_github_repository_grants` remove direct authenticated connection/member mutations, align database/server `github_pat_` detection, make terminal GitHub changes actor-attributed and auditable, and add a bounded service-role webhook repository-grant upsert. They are not hosted yet and require exact owner approval plus post-apply verification.
- Applied migration filenames are immutable; timestamp gaps are not renumbered.

## Secrets and token lifecycle

- Supabase URL/publishable key are browser-public; RLS remains mandatory.
- App private key, GitHub client/state/webhook secrets, Supabase service role, and future provider keys stay in Vercel server-only settings.
- Installation-start state is HMAC signed, expires in ten minutes, and is bound to user, organization, allowlisted return path, and an HttpOnly nonce cookie.
- Ephemeral GitHub user OAuth tokens verify installation access, are not persisted/returned, and are revoked best-effort.
- App JWTs are short-lived; installation tokens are further scoped to one repository ID and exact route permissions.

## Repository read/write boundary

Read routes normalize and schema-validate branches, commits, PRs, check runs, directory entries, and UTF-8 files. Repository coordinates, refs, paths, response sizes, binary content, and installation state are bounded.

Write flow:

1. Same-origin, authenticated owner/admin request.
2. Verify active connection, selected non-archived repository, project mapping, and synchronized default branch. Repository full names are normalized and compared literally, without SQL wildcard semantics.
3. Reject likely secrets and protected resource classes including repository memory/policies, Supabase, all application API routes, server-side provider/data libraries, Auth/session boundaries, and deployment/environment/infrastructure files; validate expected blob SHA and idempotency key.
4. Reserve `github_change_requests` evidence.
5. Read current default-branch reference/file state.
6. Create a unique `softwarefactory/*` branch.
7. Commit using the expected blob SHA.
8. Require an open draft pull request.
9. Complete or fail the audited request record.

There is no merge or deployment step.
There is also no HTTP local-repository write path; the legacy route, UI, and environment switch are removed.

## Webhook boundary

- Maximum raw body: 2 MiB.
- Verify HMAC-SHA256 before JSON parsing.
- Validate delivery/event headers and payload schema.
- Hash the raw payload; store only an allowlisted redacted subset.
- Deduplicate delivery ID and reject conflicting payload reuse.
- Reconcile installation/repository/PR/check/status events through bounded database functions. Newly granted repository metadata uses the service-role-only `013` function after hosted promotion.
- Unknown events/installations are ignored safely, not used to create tenant ownership.

## Security invariants

- Client input/provider output is untrusted.
- Every sensitive operation is server-authorized and RLS-scoped.
- Service role never enters the client and does not erase independent tenant checks.
- Secrets/file bodies are excluded from audit metadata.
- Important transitions append immutable events.
- RED/protected actions require exact owner approval.
- Auto approve/merge/deploy/rollback remain OFF.

## Deployment topology

- Vercel Production points at the hosted Supabase project and stores server-only GitHub/Supabase secrets.
- Preview GitHub values are configured; Preview Supabase isolation remains unverified.
- CI performs read-only validation and does not deploy or merge.
- Phase 1C needs a durable worker/sandbox outside request lifetimes; Phase 2 adds Claude only through supported API connections, never five browser-automated consumer logins.
