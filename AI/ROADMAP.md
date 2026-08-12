# Roadmap

Roadmap order follows safety dependencies. A later phase cannot inherit authority from an earlier phase.

## Phase 1A — trustworthy control-plane foundation

Status: **Complete baseline; deployed UI evidence retained.**

- Responsive shell, truthful demo/disconnected states, provider-neutral domain model, Supabase/RLS/audit foundations, risk/approval controls, tests, CI, documentation, and safe OFF defaults.
- No unrestricted production execution, merge, deployment, or rollback.

## Phase 1B — Production GitHub App Integration

Status: **Implementation and hosted schema gates pass; authenticated tenant behavior and live acceptance pending.**

Implemented:

- Supabase Auth/onboarding/active organization.
- Hosted schema through migration `009`, including serialized installation synchronization and authoritative synchronized-default-branch project linking.
- GitHub App install/callback/token/sync/disconnect boundaries.
- Repository/branch/commit/PR/check/file reads.
- Signed/idempotent/redacted webhook ingestion.
- Transactional project linking and live metrics/views.
- Controlled branch + commit + draft-PR file changes.

Exit work:

- verify hosted authenticated RLS allow/deny and privileged-RPC behavior (migration history through `009` and linked schema lint are green);
- [x] Rerun lint, typecheck, full Vitest, build, E2E, and secret/client scans on the exact hardened tree.
- deploy exact commit to Vercel; and
- pass the real installation/repository/project/file/draft-PR/webhook/disconnect workflow.

No merge or production deployment autonomy is implied.

## Phase 1C — Codex execution

Status: **Not Connected; not started.**

- Durable provider-neutral worker, leasing/heartbeat/cancellation/idempotency.
- Isolated workspaces, budgets/timeouts, sandbox/network restrictions, redacted traces.
- Bounded GREEN tasks, deterministic validation, and human-reviewed draft PRs.
- Kill switch, approval inbox, incident evidence, and observed non-production pilot.

Do not begin without explicit instruction after Phase 1B exits.

## Phase 1D — autonomous-loop controls

Status: **Not started; controls remain OFF.**

- Observation-only policy decisions and prerequisite evidence.
- No auto approve/merge/deploy/rollback until separate policy, provider, branch protection, validation, health, and rollback drills pass.

## Phase 2 — Claude and governed delivery

Status: **Not Connected; not started.**

- Use supported Anthropic API connections and logical roles, not browser automation of consumer accounts.
- Provider-neutral Bot Manager routing between Codex, Claude, and automation capabilities.
- Preview deployment/validation before any separately approved delivery automation.

## Later measured autonomy

- Narrow GREEN automation only after sustained evidence, explicit allowlists, budgets, alerts, kill switches, and owner-approved policy.
- RED actions remain owner-controlled absent a future independently reviewed policy revision.
