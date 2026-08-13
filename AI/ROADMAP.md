# Roadmap

Roadmap order follows safety dependencies. A later phase cannot inherit authority from an earlier phase.

## Phase 1A — trustworthy control-plane foundation

Status: **Complete baseline; deployed UI evidence retained.**

- Responsive shell, truthful demo/disconnected states, provider-neutral domain model, Supabase/RLS/audit foundations, risk/approval controls, tests, CI, documentation, and safe OFF defaults.
- No unrestricted production execution, merge, deployment, or rollback.

## Phase 1B — Production GitHub App Integration

Status: **Implementation/hardening gates, `main` publication, and production deployment pass; hosted promotion of `011`-`013`, authenticated tenant behavior, and live acceptance remain pending.**

Implemented:

- Supabase Auth/onboarding/active organization.
- Hosted schema through migration `009`, including serialized installation synchronization and authoritative synchronized-default-branch project linking.
- GitHub App install/callback/token/sync/disconnect boundaries.
- Repository/branch/commit/PR/check/file reads.
- Signed/idempotent/redacted webhook ingestion.
- Transactional project linking and live metrics/views.
- Controlled branch + commit + draft-PR file changes.
- Exact active-organization enforcement, truthful live connection/project/file state, live tenant Activity reads, no local HTTP writer, and local forward migrations `011`-`013` for mutation/audit/webhook hardening.

Exit work:

- obtain exact owner approval and apply/verify local migrations `011`-`013` on hosted Supabase (hosted ledger currently ends at `010`; linked lint is green only through `009`);
- verify hosted authenticated RLS allow/deny and privileged-RPC behavior;
- [x] Rerun lint, typecheck, full Vitest, build, E2E, and secret/client scans on the exact hardened tree.
- [x] Push implementation `e0ca6e7fe62234817e24273fb8ba3f6a12ffd278`, preserve its authorship through owner-authored empty marker/current main `7bd9d30e67bf018aba32f28d235d4a2f1232d65c`, and verify READY deployment `dpl_9i5hybTpGK6ZDufRuKWKT7Ys2gzY`, production Playwright 12/12, and expected HTTP status boundaries; and
- pass the real installation/repository/project/file/draft-PR/webhook/disconnect workflow.

No merge or production deployment autonomy is implied.

## Phase 1C — Full site build-out and Codex execution

Status: **Implemented and locally verified; Not Connected and not yet observed live.**

Implemented:

- Provider-neutral worker contract, registry, and an OpenAI Codex adapter on the supported server-side Responses API.
- Deterministic orchestrator: intent, acceptance criteria, risk classification, bounded decomposition, dependencies, and agent assignment.
- Durable leased run state machine in Postgres with heartbeat, lease reclaim, cancellation, bounded retry, and organization concurrency.
- Pre-commit diff review, diff-level secret scanning, isolated `factory/*` branches, and draft-pull-request delivery.
- Real repository CI as the validation authority, with a bounded repair loop driven by genuine failures.
- Every primary page built against live tenant records; no seeded demo content remains.
- Commanded execution as an owner-gated interlock defaulting OFF, independent of the Phase 1D kill switch.

Exit work:

- apply and verify hosted migrations `011`-`016` after exact owner approval;
- complete the authenticated GitHub connection, project link, draft-PR, and webhook journeys;
- configure the provider and worker tick credentials;
- observe one complete real run end to end; and
- verify cancellation, protected-path refusal, secret refusal, stale-SHA conflict, and CI repair against live providers.

No merge, deployment, or rollback autonomy is implied or implemented.

## Phase 1D — autonomous-loop controls

Status: **Observation-only scaffold and hosted locked controls implemented; execution not started and controls remain OFF.**

- [x] Add a fail-closed GREEN-only observation evaluator, Autonomous Mode OFF constraint, locked global kill switch, truthful UI/API boundary, and schema hardening migration.
- [x] Apply/verify hosted migration `010`: zero unsafe rows at preflight/after application, kill-switch default true, both constraints validated, authenticated RPC execute only, anonymous denied.
- [ ] Restore authorized post-`010` CLI lint and run observation against trustworthy non-production evidence.
- No auto approve/merge/deploy/rollback until separate policy, provider, branch protection, validation, health, and rollback drills pass.

## Phase 2 — Claude and governed delivery

Status: **Not Connected; not started.**

- Use supported Anthropic API connections and logical roles, not browser automation of consumer accounts.
- Provider-neutral Bot Manager routing between Codex, Claude, and automation capabilities.
- Preview deployment/validation before any separately approved delivery automation.

## Later measured autonomy

- Narrow GREEN automation only after sustained evidence, explicit allowlists, budgets, alerts, kill switches, and owner-approved policy.
- RED actions remain owner-controlled absent a future independently reviewed policy revision.
