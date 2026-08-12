# Backlog

Last triaged: 2026-08-12

Checked items have repository/test evidence. They describe Phase 1A foundations, not live provider connectivity.

## Phase 1A completion record

- [x] Implement the responsive command-center shell and all required primary destinations.
- [x] Provide truthful dashboard, project, Bot Manager, Files, Agents, Backlog, Runs, Reports, Connections, Activity, and Settings foundations.
- [x] Label seeded metrics/activity/report examples **Demo Data** and unavailable providers/workers **Not Connected**.
- [x] Define project fields and GREEN/YELLOW/RED safety controls with destructive settings OFF by default.
- [x] Persist authenticated commands/tasks/audit events transactionally when Supabase is configured; keep worker execution disconnected and RED owner-gated.
- [x] Provide repository file tree/search/open/edit/preview/save foundations, unsaved-change protection, and labeled history placeholder.
- [x] Define all required provider-neutral entities in ordered migrations with ownership, keys, constraints, indexes, RLS/FORCE RLS, policies, audit functions, and secret-shape rejection.
- [x] Establish unit, integration, E2E, responsive, and accessibility test foundations plus read-only non-deploying CI.
- [x] Run final lint, typecheck, unit/integration tests, production build, secret/client-bundle scan, RLS/workflow verification, and desktop/tablet/mobile browser tests; record evidence in `AI/CURRENT_STATE.md` and `AI/QUALITY_SCORECARD.md`.
- [x] Create repository memory, policies, local/Supabase/Vercel/migration/testing/security/autonomy/GitHub App documentation, `.env.example`, and security reporting guidance.
- [x] Deploy the Phase 1A UI to verified Vercel project `surgeservices-projects/softwarefactory`; production deployment `dpl_Fi7jEzWFbtW3vrXDGuEodPumTuJ7` is READY at `https://softwarefactory-tan.vercel.app`.
- [ ] Deliver the owner-facing final Phase 1A implementation report (completed functionality, exact tests, limitations, outstanding work, and Phase 1B recommendation).

## P1 — Phase 1B: connect the control plane

- [ ] Configure a hosted Supabase project, apply the migration chain, and repeat RLS allow/deny and transactional workflow tests against the real service.
- [ ] Add Supabase Auth onboarding, organization selection, membership administration, and authenticated project CRUD.
- [ ] Replace the project form and Settings policy preview with tenant-scoped live reads/mutations while preserving safe defaults and conflict handling.
- [ ] Implement the GitHub App installation, short-lived token exchange, repository selection, signed/idempotent webhooks, and reconciliation described in `docs/GITHUB_APP_INTEGRATION.md`.
- [ ] Build a durable job dispatcher/worker lease protocol with budgets, idempotency, cancellation, timeouts, redacted evidence, and a global kill switch; begin read-only.
- [ ] Add approval inbox, expiration, denial/revocation reasons, and visible policy-decision traces.
- [ ] Add connection health checks and freshness/source labels without returning credential material.
- [ ] Connect and verify the in-product Vercel adapter and repository/continuous-deployment linkage; keep deploy and rollback automation OFF until their separate policies and validation gates are satisfied.
- [ ] Add durable repository-file version history and authenticated repository-scoped write adapters; keep the local write switch development-only.
- [ ] Replace demo metrics/reports with tenant-scoped live records only after source and freshness are verified.

## P2 — delivery safety

- [ ] Implement isolated execution workspaces and repository-scoped installation tokens for bounded GREEN draft-PR creation.
- [ ] Add preview deployment integration and the post-deploy validation evidence contract.
- [ ] Discover and enforce branch protection, required checks, head SHA, approvals, and protected-resource exclusions before any merge eligibility decision.
- [ ] Run rollback drills and record recovery-time evidence before enabling automated rollback anywhere.
- [ ] Add cost/time/token budgets, provider rate-limit handling, incident alerts, and owner notifications.
- [ ] Define retention/redaction rules for run traces, reports, webhook payloads, and audit metadata.

## Maintenance debt

- [ ] Run local development and verification on Node 22+ to remove the Supabase Node 20 deprecation warning.
- [ ] Resolve the Vitest/Vite future native config-loader ESM warning before it becomes a breaking default.
- [ ] Expand E2E coverage beyond the dashboard/navigation foundation to authenticated command, project-control, approval, and file-save workflows once live test services exist.

## Deliberately deferred

- Unrestricted production execution.
- Automatic RED-risk approval.
- Production auto-merge, auto-deploy, or auto-rollback without separately approved policy and operational evidence.
- Plaintext provider credentials in Supabase, repository files, logs, or browser storage.
