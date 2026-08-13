# Documentation index

SoftwareFactory `main` contains the Phase 1E operations and synthetic-journey source, Phase 2A advisory Anthropic/OpenAI provider layer, universal bot-fabric registry, public marketing/console routes, and the execution-inert Phase 1D decision layer; the local branch, three commits ahead and unpublished, adds the Phase 1C Codex execution candidate. Hosted Supabase contains the schema effects of `028`/`130001`-`130005`, but its ledger still has exactly 26 rows through `027`, so protected history reconciliation is required before any forward promotion. Local `130006`-`130011` are absent. No production target or journey has been observed, provider credentials/live calls are unverified, all execution switches/actions are OFF, Actions secrets/variables are absent, no active worker heartbeat exists, and no live Codex run has completed. Phase 1E production operations, provider execution, bot-provider readiness, Phase 1D execution, and OpenAI/Codex worker execution are therefore **Not Connected**.

The frozen local candidate is green on bundled Node `24.19.0`: 109 test files/1,169 tests, production build with 74 page/route entries, coverage 75.06/69.97/72.60/76.66, Playwright/axe 117/117, focused migration suites 8 files/104 tests, production dependency audit 0, and safe disabled-worker smoke. See [Testing](TESTING.md) and [`AI/QUALITY_SCORECARD.md`](../AI/QUALITY_SCORECARD.md). Local results do not prove hosted or live-provider acceptance.

The candidate Phase 1B GitHub App path remains connected for exactly `surgeservicesllc/SoftwareFactory`. Manual Phase 1C does not enable Autonomous Mode, RED execution, merge, deployment, or rollback.

## Developer and operator guides

- [Local setup](LOCAL_SETUP.md) - install, configure, and run the application.
- [Architecture](ARCHITECTURE.md) - request, database, worker, Codex, GitHub, and trust boundaries.
- [Environment variables](ENVIRONMENT_VARIABLES.md) - public, Vercel server-only, worker runtime, and GitHub Actions secret names.
- [Supabase setup](SUPABASE_SETUP.md) - hosted identity, Auth, RLS, protected ledger reconciliation, and forward `130006`-`130011` promotion.
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
