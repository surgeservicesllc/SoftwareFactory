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

## ADR-018 — Semantic design tokens and a 12px minimum type size

- Date: 2026-08-12
- Status: Accepted
- Decision: All interface colour comes from semantic CSS custom properties declared once in `app/globals.css` (`--surface`, `--text-muted`, `--accent`, status families) and surfaced to Tailwind through `@theme inline`. Components reference token-backed utilities instead of literal hex values. No interface text is smaller than 12px: 12px for labels and metadata, 14px for secondary copy, 15px body, and headings above that.
- Rationale: The prior interface set body copy at 10-11px and metadata at 7-9px across 133 declarations, with roughly 500 literal hex values and nine competing grey text tones. Several of those tones (for example `#566271` on `#0b1017`, about 3.1:1) failed WCAG AA, and the failures were invisible to automated checks because gradient panel backgrounds made axe return "incomplete" rather than "violation" for contrast.
- Consequence: Contrast is a property of the token set rather than of each call site, so a token change is auditable in one place. Element resets live in `@layer base` so component classes can win the cascade; adding an unlayered element rule that competes with a component class is a regression. Reintroducing literal hex values or sub-12px type in application code contradicts this decision.

## ADR-019 — Plain language first, with the technical term kept alongside

- Date: 2026-08-12
- Status: Accepted
- Decision: User-facing copy leads with what a control does in ordinary words and keeps the exact technical or policy term as a secondary label rather than replacing it. Autonomy controls read "Merge pull requests / Auto merge", and command risk reads "Low / Medium / High" while still submitting `green`/`yellow`/`red`. Navigation is grouped, and destinations whose content is entirely seeded sit under a "Demo only" heading.
- Rationale: Truthfulness obligations under ADR-009 were being met by repeating the same **Demo Data** and **Not Connected** badges three to five times per page. Repetition produces banner blindness, which weakens the very contract it is meant to serve, while phase vocabulary ("Phase 1D observation ceiling", "declared maximum risk") left readers unable to tell which screens did anything real.
- Consequence: Structure carries the truthfulness contract — a grouped navigation heading and one notice per page — so exact labels stay meaningful where they appear. Precise terms are never deleted, only demoted next to their plain-language equivalent, and API values are unaffected by presentation wording.

## ADR-020 — Every surface reads live tenant records; empty replaces illustrative

- Date: 2026-08-12
- Status: Accepted
- Decision: Agents, Backlog, Runs, Reports, and the Bot Manager request list read their own Supabase tables (`agents`, `tasks`, `agent_runs`, `reports`, `commands`) through the caller's session. `lib/demo-data.ts` is deleted. When a table is empty the surface says so; it never substitutes illustrative rows. All list reads go through one server-only boundary, `lib/server/tenant-list.ts`, which authenticates, resolves the exact active organization, filters by `organization_id`, bounds the row count at 100, and returns no-store.
- Rationale: All five tables already existed with RLS and FORCE RLS, but no route or component ever read them, so five pages rendered seeded arrays beside live ones. Labelling those arrays **Demo Data** satisfied the letter of ADR-009 while leaving the product unable to show a real backlog or a real run. Reading the tables is strictly more truthful than labelling substitutes for them.
- Consequence: `DemoBadge`/`DemoNotice` remain exported but unused, because AGENTS.md fixes that exact wording for any future seeded content; `MetricCard`'s `demo` prop now defaults to false so live data cannot be mislabelled by omission. The navigation's "Demo only" group is gone — it would now be false. Columns are enumerated explicitly and never `*`: run `input`/`output`, report `content`, and command `parameters` stay server-side. An empty page is the correct output for a new workspace, not a defect.
- Not covered: this wires the application to Supabase. It does not configure credentials (those stay in Vercel and `.env.local`, never in source), and it does not apply hosted migrations `011`-`013`, which remain RED and need exact owner approval.
