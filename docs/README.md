# Documentation index

SoftwareFactory's published default branch contains the Phase 1E operations and synthetic-journey source, Phase 2A advisory Anthropic/OpenAI provider layer, universal bot-fabric registry, public marketing/console routes, and the execution-inert Phase 1D decision layer. The exact local release tree additionally contains the Phase 1C Codex execution candidate and is pending merge/publication. Hosted Supabase project `qpuofpmagrmyamahqwxw` now has a reconciled ledger and the forward-only chain through `130014`; linked lint and focused bot/Phase 1C/Phase 1D runtime checks pass. Seven Actions secrets are configured, but the worker activation variable is absent, the workflow is not yet published, and no heartbeat or live Codex run exists. All automatic actions remain OFF and the global kill switch remains ON. Phase 1E production execution, provider execution, bot-provider execution, Phase 1D execution, and OpenAI/Codex worker execution are therefore **Not Connected**.

The exact combined pre-publication tree is green on bundled Node `24.19.0`: lint/typecheck, 115 test files/1,251 tests, and a production build with 74 page/route entries. See [Testing](TESTING.md) and [`AI/QUALITY_SCORECARD.md`](../AI/QUALITY_SCORECARD.md). Local results and hosted schema do not prove workflow publication or a live-provider run.

The candidate Phase 1B GitHub App path remains connected for exactly `surgeservicesllc/SoftwareFactory`. Manual Phase 1C does not enable Autonomous Mode, RED execution, merge, deployment, or rollback.

## Developer and operator guides

- [Local setup](LOCAL_SETUP.md) - install, configure, and run the application.
- [Architecture](ARCHITECTURE.md) - request, database, worker, Codex, GitHub, and trust boundaries.
- [Environment variables](ENVIRONMENT_VARIABLES.md) - public, Vercel server-only, worker runtime, and GitHub Actions secret names.
- [Supabase setup](SUPABASE_SETUP.md) - hosted identity, Auth, RLS, completed ledger reconciliation, and the forward chain through `130014`.
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
