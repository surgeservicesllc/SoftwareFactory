# Project context

## Product

SoftwareFactory is a standalone AI software-engineering command center. Its long-term purpose is to coordinate authenticated projects, provider connections, agents, source control, planning, validation, releases, monitoring, approvals, and auditable bounded automation from one trustworthy control plane.

Projects, users, organizations, agents, provider connections, and provider accounts are separate concepts joined only through explicit tenant-scoped relationships. An agent is not a provider login.

## Current phase

**Phase 1C — Full site production build-out and the first AI engineering execution loop.**

Phase 1C completes every primary surface against live tenant records and adds the commanded execution loop:
owner command → deterministic orchestrator plan → durable leased worker run → provider proposal → server-side
diff review → isolated branch → draft pull request → real repository CI → human review. It adds no merge,
deployment, or rollback authority.

Phase 1C is implemented and passes every local gate, but nothing in the loop has been observed live: hosted
migrations `011`-`016` are unapplied, no provider or worker credential is configured, and no run has executed.
Commanded execution is owner-gated and defaults OFF.

Phase 1B remains incomplete and is a prerequisite; its boundaries are summarized below.

**Phase 1B — Production GitHub App Integration.**

Phase 1B extends the Phase 1A foundation with:

- Supabase authentication, callback, onboarding, membership, and active-organization boundaries;
- hosted tenant-scoped persistence with RLS/FORCE RLS and audited workflows;
- a production GitHub App registration/install/callback model;
- installation/repository synchronization and safe loss/disconnect handling;
- short-lived, repository-scoped installation tokens;
- branch, commit, pull-request, check, tree, and content reads;
- signed/idempotent/redacted webhook ingestion;
- transactional project-to-repository linking and live dashboard/project/file views; and
- owner/admin-initiated file changes that create only a controlled branch, commit, and draft pull request.

The code/configuration existing is not the same as a verified connection. GitHub remains **Not Connected** until the real installation and complete production acceptance journey pass.

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

Phase 1B is complete only when current local gates, hosted Supabase migrations/lint/RLS checks, production deployment, and the real GitHub installation → repository sync → project link → file read → controlled branch/commit/draft PR → webhook/audit workflow all pass. `AI/QUALITY_SCORECARD.md` records the evidence.
