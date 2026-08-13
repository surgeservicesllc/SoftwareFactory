# Documentation index

SoftwareFactory main contains the Phase 1E operations and synthetic-journey source, Phase 2A advisory Anthropic/OpenAI provider layer, universal bot-fabric registry, public marketing route group, and separated console routes; the reconciled working tree adds a local Phase 1C Codex execution candidate. Hosted Supabase contains post-`027` published schema objects but its ledger still has exactly 26 rows through `027`, so protected history reconciliation is required before Phase 1C promotion. No production target or journey has been observed, provider credentials/live calls are unverified, both execution switches are OFF, Actions secrets/activation are absent, no active worker heartbeat exists, and no live Codex run has completed. Phase 1E production operations, provider execution, bot-provider readiness, and OpenAI/Codex worker execution are therefore **Not Connected**.

Final reconciled local gates are green on bundled Node `24.19.0` (97 files/959 tests, production build with 62/62 page-data entries, coverage 72.37/66.79/68.80/74.13, 117/117 Playwright/axe, dependency audit 0, source/static secret-value scans, diff check, disabled-worker safe exit, and focused migration/API security audits). See [Testing](TESTING.md) and [`AI/QUALITY_SCORECARD.md`](../AI/QUALITY_SCORECARD.md) for exact evidence. Local results do not prove hosted or live-provider acceptance.

The candidate Phase 1B GitHub App path remains connected for exactly `surgeservicesllc/SoftwareFactory`. Manual Phase 1C does not enable Autonomous Mode, RED execution, merge, deployment, or rollback.

## Developer and operator guides

- [Local setup](LOCAL_SETUP.md) - install, configure, and run the application.
- [Architecture](ARCHITECTURE.md) - request, database, worker, Codex, GitHub, and trust boundaries.
- [Environment variables](ENVIRONMENT_VARIABLES.md) - public, Vercel server-only, worker runtime, and GitHub Actions secret names.
- [Supabase setup](SUPABASE_SETUP.md) - hosted identity, Auth, RLS, and the protected `028` -> `130001` through `130008` promotion.
- [AI providers](AI_PROVIDERS.md) - Phase 2A advisory adapters, routing, fallback, configuration, and authority boundary.
- [Database migrations](DATABASE_MIGRATIONS.md) - migration inventory, enum split, validation, and promotion rules.
- [GitHub App integration](GITHUB_APP_INTEGRATION.md) - App setup, repository permissions, opaque worker dispatch, draft-PR publication, and acceptance.
- [Vercel setup](VERCEL_SETUP.md) - hosting boundary and why Codex never runs in a request handler.
- [Testing](TESTING.md) - local, hosted, runner, and real-provider evidence requirements.
- [Security guide](SECURITY.md) and [security model](SECURITY_MODEL.md) - tenant, secret, lease, sandbox, repository, audit, and incident controls.
- [Autonomous mode](AUTONOMOUS_MODE.md) - manual Phase 1C execution is distinct from the still-disabled Phase 1D loop.

## Status vocabulary

- **Demo Data:** seeded/static information, not live telemetry.
- **Not Connected:** no verified end-to-end provider session, current heartbeat, or live execution evidence.
- **Configured:** code or protected configuration exists; connectivity is unproven.
- **Queued:** intent and a durable run exist; no worker claim is implied.
- **Draft PR:** reviewable source-control output; not a merge or deployment.

Configuration, a successful build, a workflow file, a stored secret name, a queued row, or a mocked SDK response does not prove a Connected worker. [`AI/CURRENT_STATE.md`](../AI/CURRENT_STATE.md) and [`AI/QUALITY_SCORECARD.md`](../AI/QUALITY_SCORECARD.md) are the evidence records.

## Repository governance

Agents must read [`AGENTS.md`](../AGENTS.md), all required `AI/` memory, and the policies before material work. Authoritative code, migrations, protected provider configuration, and current test/provider evidence take precedence over stale documentation. Protected database, workflow, and secret changes require exact owner approval.
