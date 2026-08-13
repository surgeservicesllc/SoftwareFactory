# Project context

## Product

SoftwareFactory is a standalone AI software-engineering command center. Its long-term purpose is to coordinate authenticated projects, provider connections, agents, source control, planning, validation, releases, monitoring, approvals, and auditable bounded automation from one trustworthy control plane.

Projects, users, organizations, agents, provider connections, and provider accounts are separate concepts joined only through explicit tenant-scoped relationships. An agent is not a provider login.

## Current phase

**Phase 1B — Production GitHub App Integration.**

Phase 1B extends the Phase 1A foundation with:

- Supabase authentication, callback, onboarding, membership, and active-organization boundaries;
- hosted tenant-scoped persistence with RLS/FORCE RLS and audited workflows;
- a production GitHub App registration/install/callback model;
- installation/repository synchronization and safe loss/disconnect handling;
- short-lived, repository-scoped installation tokens;
- branch, commit, pull-request, check, tree, and content reads;
- signed/idempotent/redacted webhook ingestion;
- transactional project-to-repository linking by immutable repository identity and live dashboard/project/file views;
- caller-bound, bounded browser projections that keep sensitive control-plane columns, raw Activity metadata, and stored webhook-delivery evidence server-side;
- owner/admin-initiated ordinary file changes that create only a controlled branch, commit, and draft pull request; and
- a separate, short-lived owner-only RED approval path for an exact protected-file draft change, with its immutable snapshot revalidated before a write-scoped token is minted, without default-branch, merge, or deployment authority;
- an explicit, server-only deployment commit identity used as both GitHub author and committer, with no App-bot fallback;
- generic secret-assignment rejection even when an opaque value lacks a known provider token prefix; and
- stable repository-ID project linking serialized against concurrent active duplicates while permitting an intentional relink after archival; and
- a cryptographically isolated dual-App replacement path with exact owner RED approval, signed target-delivery provenance, atomic history-preserving handoff, and an evidence-bound reverse path while both installations remain active.

The code/configuration existing is not the same as a verified connection. A GitHub repository connection may be called Connected only after the real callback, tenant persistence, repository scope, and live reads pass. Each App webhook is an independent capability: it remains **Not Connected** until GitHub retains the active endpoint and a valid signed delivery succeeds for that exact App/installation. Candidate App `4582606` meets that boundary; primary App `4573846` does not.

An inert Phase 1D observation-only scaffold may be developed while Phase 1B acceptance is pending. It does not change the current phase or authorize execution: the global kill switch stays ON, the ceiling is GREEN, automatic approval/merge/deploy/rollback stay OFF, and the worker remains **Not Connected**.

## Truthful status language

- **Demo Data** means seeded/static presentation data, not live telemetry.
- **Not Connected** means no verified end-to-end provider installation/session is available.
- **Configured** means code or protected environment values exist; it does not prove connectivity.
- A draft pull request is not a merge or deployment.
- A persisted command/task is intent; it is not proof an AI worker ran.

## Phase 1B non-goals

- Codex/OpenAI worker execution (Phase 1C);
- Claude/Anthropic agents or consumer-account browser automation (Phase 2);
- direct writes to a repository default branch;
- automatic pull-request approval or merge;
- automatic production deployment or rollback;
- workflow, branch-protection, administration, secrets, or deployment write permissions;
- plaintext provider credentials in tables/source/logs/browser code; and
- claims of live operation based only on configuration, mocks, or a page render.

## Product principles

1. **Truth before theater.** State describes verified events and source freshness.
2. **Safe by default.** Mutating/external controls begin OFF and fail closed.
3. **Server-side trust.** Authorization and provider secrets remain behind trusted boundaries.
4. **Independent tenant defense.** Application checks and Supabase RLS both enforce ownership.
5. **Least privilege.** GitHub tokens are short-lived, repository-ID-scoped, and permission-reduced.
6. **No silent overwrite.** Repository changes require the expected blob SHA and isolated branch.
7. **Owner control.** RED/protected-resource actions need exact current approval.
8. **Auditability.** Material transitions emit immutable, redacted evidence.
9. **Progressive autonomy.** No later-phase authority is inferred from Phase 1B features.

## Phase 1B exit criteria

Phase 1B is complete only when current local gates, hosted Supabase migrations/lint/RLS checks, production deployment, and the real GitHub installation → repository sync → project link → file read → controlled branch/commit/draft PR → webhook/audit workflow all pass, including the required live tenant/failure matrix. `AI/QUALITY_SCORECARD.md` records the evidence.
