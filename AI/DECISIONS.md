# Architecture decision log

Use this append-only log for decisions that constrain future implementation. Change a decision by adding a superseding entry, not silently rewriting history.

## ADR-001 — Control plane before autonomous execution

- Date: 2026-08-12
- Status: Accepted
- Decision: Phase 1A builds state, policy, audit, and interface foundations only. It does not execute unrestricted production changes.
- Consequence: Commands may be persisted as queued intent while workers remain **Not Connected**.

## ADR-002 — Next.js App Router on Vercel-compatible infrastructure

- Date: 2026-08-12
- Status: Accepted
- Decision: Use the current repository-pinned Next.js, TypeScript, App Router, and Tailwind CSS. Prefer Server Components and narrow Client Component boundaries.
- Consequence: Agents must consult version-matched documentation under `node_modules/next/dist/docs/` before framework work.

## ADR-003 — Supabase as control-plane persistence

- Date: 2026-08-12
- Status: Accepted
- Decision: Use Supabase Postgres/Auth with UUID identifiers, tenant ownership, foreign keys, indexes, status constraints/enums, and RLS.
- Consequence: RLS cannot be disabled for convenience; service-role access is restricted to trusted server operations and does not replace authorization.

## ADR-004 — Separate projects, connections, agents, and users

- Date: 2026-08-12
- Status: Accepted
- Decision: A provider connection is a reusable authorization abstraction associated with projects through an explicit join. An agent is a role/capability definition, not a provider account.
- Consequence: Domain records do not embed provider logins or plaintext secrets.

## ADR-005 — Server-side secret references

- Date: 2026-08-12
- Status: Accepted
- Decision: Privileged provider credentials live in server-side environment/secret infrastructure. Database connection records may store only non-secret metadata and an opaque secret reference.
- Consequence: `NEXT_PUBLIC_` variables must never contain privileged credentials; logs and audit payloads are redacted.

## ADR-006 — Explicit risk tiers and protected resources

- Date: 2026-08-12
- Status: Accepted
- Decision: Classify actions GREEN, YELLOW, or RED using impact, reversibility, blast radius, and resource sensitivity. The most severe applicable criterion wins.
- Consequence: RED requires owner approval in Phase 1. Controls default OFF and protected resources tighten eligibility.

## ADR-007 — Audit state transitions

- Date: 2026-08-12
- Status: Accepted
- Decision: Important control-plane changes create append-only activity events with actor, organization, target, event type, timestamp, request/correlation identifier, and redacted metadata.
- Consequence: Operational dashboards and reports should derive claims from auditable records, not UI-only state.

## ADR-008 — No Phase 1A auto-merge or auto-deploy workflow

- Date: 2026-08-12
- Status: Accepted
- Decision: CI validates changes but does not merge pull requests or deploy production.
- Consequence: Future automation requires a separate decision, policy prerequisites, branch protections, validation evidence, and an owner-controlled rollout.

## ADR-009 — Demo truthfulness is a data contract

- Date: 2026-08-12
- Status: Accepted
- Decision: Seeded/static values are labeled **Demo Data**, and absent live integrations are labeled **Not Connected**.
- Consequence: Removing those labels requires live-source, freshness, and failure-state evidence.

## ADR-010 — Use a GitHub App with repository-scoped short-lived tokens

- Date: 2026-08-12
- Status: Accepted
- Decision: Phase 1B authenticates repository operations through a GitHub App. The server signs bounded App JWTs and mints short-lived installation tokens restricted to the selected repository ID and exact per-route permissions. Personal access tokens are not the application integration model.
- Consequence: App private keys, client/state/webhook secrets, OAuth tokens, and installation tokens stay server-only and out of database rows. A configured App is still **Not Connected** until its real installation and failure paths are verified.

## ADR-011 — GitHub file saves create an isolated branch and draft pull request

- Date: 2026-08-12
- Status: Accepted
- Decision: The standard Phase 1B repository write flow verifies tenant/project/repository/default branch, rejects protected paths and likely secrets, requires the expected blob SHA and an idempotency key, then creates a `softwarefactory/*` branch, commit, and open draft PR.
- Consequence: The route cannot write directly to the default branch, silently overwrite stale content, create a non-draft PR, merge, modify workflows/protected paths, or deploy.

## ADR-012 — Webhook ingress uses a narrow audited service-role boundary

- Date: 2026-08-12
- Status: Accepted
- Decision: Public GitHub webhook ingress verifies the raw-body HMAC, size, delivery/event headers, schema, and replay identity before using a server-only Supabase service-role client for narrowly granted reconciliation functions. Stored payload evidence is redacted and hashed.
- Consequence: Interactive operations continue to use user JWTs and RLS. Service role never enters the browser and never substitutes for actor/tenant/resource checks in privileged functions.

## ADR-013 — Stop Phase 1B before Codex, autonomy, or Claude

- Date: 2026-08-12
- Status: Accepted
- Decision: Phase 1B ends at authenticated GitHub repository visibility and owner/admin-initiated draft-PR creation. Codex execution is Phase 1C, autonomous-loop enablement is later, and Claude logical agents are Phase 2.
- Consequence: OpenAI/Codex and Anthropic/Claude remain **Not Connected**; auto approve, merge, deploy, and rollback stay OFF and have no executor.

## ADR-014 — Fail closed at synchronized GitHub repository boundaries

- Date: 2026-08-12
- Status: Accepted
- Decision: Serialize installation synchronization by external installation ID before connection creation, re-resolve the installation's tenant/connection binding after upsert, match normalized repository full names literally rather than with SQL wildcard semantics, and persist only the synchronized GitHub default branch when linking a project. The standard file-change route also treats repository memory/policies, Supabase, every application API route, server-side GitHub/Supabase code, Auth/session boundaries, deployment/environment/infrastructure files, and security-sensitive subject paths as protected.
- Consequence: Concurrent first syncs cannot create competing connection identities, caller text cannot override provider-synchronized repository/default-branch state, `%` and `_` cannot broaden repository authorization matches, and protected control-plane code must use a separate owner-approved workflow rather than the standard draft-PR editor.

## ADR-015 — Exclude local artifacts from Vercel deployment source

- Date: 2026-08-12
- Status: Accepted
- Decision: Commit a fail-closed `.vercelignore` that excludes dependencies, build/test caches, local CLI metadata, environment files, private-key files, and ignored work artifacts from Vercel source uploads.
- Consequence: Production receives the reviewed repository source without unrelated local artifacts or credential-bearing file classes.

## ADR-016 — Phase 1D begins as an execution-inert observation boundary

- Date: 2026-08-12
- Status: Accepted
- Decision: The first Phase 1D increment may evaluate only explicit hypothetical GREEN inputs. Persisted Autonomous Mode remains constrained OFF, the organization kill switch is locked ON, automatic approval/merge/deploy/rollback are constrained OFF, and the evaluator always reports `executionAllowed: false` while no worker exists.
- Consequence: `WOULD_BE_ELIGIBLE` is hypothetical policy evidence, never approval or proof of execution. Enabling external action requires a separate owner-approved decision, non-production evidence, provider controls, and a forward migration that deliberately changes the interlocks.

## ADR-017 — Phase 1B live state is active-tenant evidence, not retained metadata

- Date: 2026-08-12
- Status: Accepted for local implementation; hosted migration/deployment evidence pending
- Decision: Bind every interactive GitHub route to the caller's exact active organization. Treat a project as connected only while its connection is connected, installation is active and unsuspended, and synchronized repository is selected, non-archived, and enabled. Expose immutable activity through a bounded caller-RLS API that omits metadata from browser responses. Remove the legacy HTTP local-repository writer, and route terminal GitHub change evidence and newly granted repository reconciliation through narrowly granted audited database workflows.
- Consequence: Retained connection/project rows cannot create a false Connected state or authorize repository access after loss. Local migrations `011`-`013` must receive exact owner approval and hosted verification before their authorization/audit/webhook guarantees are claimed in production; the Activity UI, route hardening, and webhook reconciliation also require a matching deployed commit and real authenticated acceptance.

## ADR-018 - Provider lifecycle events are ordered and terminal states fail closed

- Date: 2026-08-12
- Status: Accepted for local implementation; hosted migrations `014`, `016`, and `018` pending
- Decision: Treat provider timestamps, not webhook arrival order, as lifecycle ordering evidence. Deletion is terminal for the same GitHub installation ID. Repository deletion remains terminal until an explicit newer restore event, and restored repositories remain unselected until a fresh access synchronization. Propagate repository rename/default-branch metadata only through the exact tenant connection linking the repository to a project.
- Consequence: Delayed suspend, unsuspend, rename, archive, delete, or restore deliveries cannot reactivate an installation, restore stale repository state, or rewrite an unrelated project. Ignored, stale, and terminal outcomes remain auditable. A genuine reinstall uses a new provider installation ID.

## ADR-019 - GitHub change intent uses audited reservation and provider-evidence recovery

- Date: 2026-08-12
- Status: Accepted for local implementation; hosted migrations `015` and `017` pending
- Decision: Remove direct authenticated writes to provider connections, projects, project links, and GitHub change-request rows. Reserve a file change through a caller-authenticated, tenant-validating RPC. Reuse one idempotency key while the same browser save intent is retried. If GitHub has already returned an isolated branch, commit, and open draft PR but database completion fails or its response is lost, finish the same request from that bounded provider evidence through a server-only recovery RPC.
- Consequence: Ambiguous retries do not intentionally create a second branch or draft PR; the recovery path cannot merge, deploy, or write the default branch. Hosted guarantees cannot be claimed until the complete migration chain is owner-approved, applied, and verified.

## ADR-020 - Provider-ingress CHECK helpers use a minimal wrapper grant

- Date: 2026-08-12
- Status: Accepted for local implementation; hosted migration `019` pending
- Decision: PostgreSQL evaluates table CHECK expressions with the invoking role's function privileges. Grant the service-role provider-ingress boundary execute only on the SECURITY DEFINER `jsonb_has_sensitive_keys(jsonb)` wrapper used by those constraints. Keep its recursive implementation and the standalone text secret classifier inaccessible to service role.
- Consequence: Service-role inserts still pass the same sensitive-JSON constraints without exposing broader classifier internals or widening authenticated mutation authority. Hosted behavior must be verified after exact owner-approved promotion.

## ADR-021 - The bot fabric is a control-plane registry, not an execution surface

- Date: 2026-08-12
- Status: Accepted for local implementation; hosted migrations `020` and `021` pending
- Decision: Model provider-neutral bots, organization-authored roles, and bot-to-project assignments as first-class tenant records. A bot stores metadata plus the NAME of a server-side environment variable; the value is resolved only on the server, only to a presence boolean, and never enters a table, a browser response, a log, or audit metadata. Privileged reference names (Supabase service role, GitHub App private key and secrets, database URL, Vercel token, and any `NEXT_PUBLIC_` variable) are rejected by both the application allowlist and a table CHECK constraint. Readiness describes configuration only: `ready` means the reference and configuration resolve server-side, and the check performs no provider request. Assignment is declarative routing intent; a bot holds at most one open posting so moving it between projects is a single audited transition.
- Consequence: Registering a bot, authoring a role, and posting a bot cannot start work. OpenAI/Codex and Anthropic/Claude remain **Not Connected**, Phase 1C and Phase 2 remain unstarted, and no executor is introduced. A future worker binds to these records only under a separate owner-approved decision; connecting one would require verified-session evidence before any surface may say "Connected".

## ADR-022 - Cascade layers govern the anchor reset

- Date: 2026-08-12
- Status: Accepted
- Decision: Keep the global `a { color: inherit }` reset inside `@layer base`. Unlayered rules outrank every cascade layer, so an unlayered reset silently defeated `@layer components` classes: `.primary-action` rendered correctly as a button and at 1.19:1 contrast as a link.
- Consequence: Component and utility classes control anchor color as intended. Accessibility scanning now covers `/bot-manager` in addition to the dashboard, so a regression of this class fails a gate instead of shipping.
