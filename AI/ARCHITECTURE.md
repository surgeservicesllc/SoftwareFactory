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
- The bot fabric registers bots, roles, and assignments through caller-session reads and audited SECURITY DEFINER writes. The browser receives a credential reference *name* and a presence boolean; the credential value is resolved only in `lib/bots/credentials.ts`, only from `process.env`, and only to a boolean. `lib/bots/catalog.ts` is browser-safe public metadata.

## Public marketing site

- `app/(marketing)/` renders the public site with its own header/footer shell and is indexable; `app/(console)/` keeps the sidebar shell and stays `noindex`. `robots.ts` disallows console paths and `sitemap.ts` lists marketing routes only.
- Marketing pages are Server Components. `lib/marketing/queries.ts` reads the `marketing_*` schema through the caller's Supabase client, never throws, and reports whether the response came from Supabase or the seeded fallback so the interface can label it.
- The marketing schema is content, not control plane: published rows are world-readable by explicit `anon` policy, RLS and FORCE RLS remain enabled, nothing grants a browser INSERT/UPDATE/DELETE, and no marketing table references a tenant table.
- The schema's behavior is verified executably, not only textually: `tests/integration/marketing-rls-behavior.test.ts` applies the migration to in-process PostgreSQL and exercises it as the real `anon` and `authenticated` roles.
- Newsletter subscription is the only public write. It runs through `subscribe_to_newsletter`, which validates and normalizes the address, is idempotent per email, and returns a constant status so the endpoint cannot enumerate subscribers.

## Persistence

- Migrations `001`-`003` define the core control plane and audit/approval workflows.
- `004` defines GitHub installation, repository, webhook-delivery, and change-request state plus privileged reconciliation functions.
- `005` defines authenticated organization onboarding.
- `007` transactionally links an active selected repository to a safe-default project.
- `008_fix_github_sync_ambiguity` additively qualifies the repository installation column and named conflict constraint; it is applied remotely, local/remote history matches, and linked public-schema lint is clean.
- `009_harden_github_project_and_sync` serializes external-installation synchronization before connection creation, re-resolves the authoritative tenant/connection binding after upsert, and makes the synchronized repository default branch the only persisted project-branch authority. It is applied remotely; local/remote history matches through `009` and linked lint is clean.
- RLS and FORCE RLS apply to every exposed table. User-facing requests use caller JWT/RLS; narrow service-role operations still validate actor/organization/resource through audited functions.
- `010_phase1d_observation_controls` is applied to hosted Supabase. It adds a database-locked organization kill switch, constrains projects to Autonomous Mode OFF and GREEN with all automatic action flags OFF, and hardens the owner-only controls RPC/audit language. Hosted checks confirm the default/constraints/data/grants remain fail closed; there is still no executor.
- Local migrations `011`-`019` are one pending hardening chain. `011`-`013` close initial direct mutation paths, align `github_pat_` detection, add actor-attributed terminal change evidence, and reconcile repository grants. `014` propagates provider-authoritative repository names/default branches to exact linked projects. `015` recovers an already-created draft PR after an ambiguous database-completion response. `016` makes installation deletion terminal and orders installation lifecycle events by provider time. `017` removes remaining direct authenticated connection/project/link/change-request writes and introduces a narrow authenticated reservation RPC. `018` orders repository metadata events by provider time and preserves terminal deletion until an explicit newer restore. `019` grants the service-role provider-ingress boundary only the SECURITY DEFINER sensitive-JSON wrapper needed for table CHECK evaluation; recursive and text classifiers remain inaccessible. None is hosted yet; the complete chain requires exact owner approval and post-apply verification.
- `020_bot_fabric_activity_types` adds the bot fabric audit labels in its own transaction, because PostgreSQL forbids using an enum label in the transaction that created it. `021_bot_fabric` adds `bots`, `bot_roles`, and `bot_assignments`: RLS and FORCE RLS with member-select policies, authenticated `select` grants only, audited SECURITY DEFINER mutation functions gated on `assert_bot_fabric_manager`, tenant-composite foreign keys to projects and roles, a credential-reference shape/denylist constraint, an HTTPS-only endpoint constraint, and a partial unique index enforcing one open posting per bot. Neither is hosted.
- `20260813000100_marketing_content` adds the marketing schema described above. It is not hosted.
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
4. Reserve `github_change_requests` evidence through a caller-authenticated RPC that revalidates the exact live tenant/project/connection/repository binding.
5. Read current default-branch reference/file state.
6. Create a unique `softwarefactory/*` branch.
7. Commit using the expected blob SHA.
8. Require an open draft pull request.
9. Complete or fail the audited request record. If GitHub created the draft PR but database completion was ambiguous, recover that same provider evidence rather than create a second PR.

There is no merge or deployment step.

## Bot fabric boundary

- A bot is metadata plus an opaque secret reference. Reference names are validated against an allowlist (known provider variables plus the reserved `BOT_CREDENTIAL_*` namespace) and a denylist of control-plane credentials, in both the application and a table CHECK constraint.
- Readiness is computed from configuration alone: catalog membership, model presence, HTTPS endpoint where required, and whether the referenced variable is populated on this server. No provider request is made, so `ready` never implies a verified session.
- Assignment binds one bot to one project under one role. It is routing intent; there is no executor, and audit metadata records `executor_connected: false`.
- Connecting a real worker to these records is a later, separately approved phase. It would require verified-session evidence before any surface may report "Connected".
There is also no HTTP local-repository write path; the legacy route, UI, and environment switch are removed.

## Webhook boundary

- Maximum raw body: 2 MiB.
- Verify HMAC-SHA256 before JSON parsing.
- Validate delivery/event headers and payload schema.
- Hash the raw payload; store only an allowlisted redacted subset.
- Deduplicate delivery ID and reject conflicting payload reuse.
- Reconcile installation/repository/PR/check/status events through bounded database functions. Newly granted repository metadata uses the service-role-only `013` function after hosted promotion.
- After `016`/`018` promotion, provider timestamps order lifecycle metadata, deletion is terminal for an installation ID, stale events are recorded as ignored, and a restored repository remains unselected until access is resynchronized.
- Repository rename/default-branch updates reach only projects linked through the same tenant connection and emit redacted immutable evidence through `014`.
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
