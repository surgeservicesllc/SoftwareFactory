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
