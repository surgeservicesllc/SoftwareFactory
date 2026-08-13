# Documentation index

SoftwareFactory's published default branch contains the Phase 1E operations and synthetic-journey source, Phase 2A advisory Anthropic/OpenAI provider layer, universal bot-fabric registry, public marketing/console routes, the execution-inert Phase 1D decision layer, and the manual Phase 1C Codex worker/recovery path. Hosted Supabase project `qpuofpmagrmyamahqwxw` has a reconciled ledger and the forward-only chain through `130014`; linked lint and focused bot/Phase 1C/Phase 1D runtime checks pass. Local `130015` restores the assignment/run model checks from 120 to the original 128-character provider catalogue/API contract, adds four no-secret constraints covering catalogue model/display-name, assignment model, and routing policy-version/selected-model text, adds bounded routing detail, and closes authenticated raw routing-decision/event reads while retaining model-catalogue reads, but is unhosted pending fresh exact RED approval. Six non-OpenAI worker secrets remain configured, the exposed OpenAI secret and activation variable are absent, and the first live claim failed safely before repository mutation. A no-claim diagnostic identified `credit_balance_exhausted`. The failed run is stale against the prior verified production baseline and must not be retried; acceptance requires a new command after funded-provider proof. All automatic actions remain OFF and the global kill switch remains ON. Phase 1E production execution, provider execution, bot-provider execution, Phase 1D execution, and OpenAI/Codex worker execution are therefore **Not Connected**.

The frozen current-update candidate passes local Node `24.19.0` lint/typecheck, 118 Vitest files/1,311 tests, coverage 76.70/71.47/74.04/78.11, a 74/74-route production build, Playwright/axe 117/117, production dependency audit 0, and clean diff-check. These are local final-candidate results, not CI or production evidence; publication commit, CI, matching Vercel deployment, and hosted `130015` verification remain pending. The prior verified production baseline remains commit `0c662a24393f682073e6002c5aff9339292226d8` with CI run `31749352644` and READY deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7`. See [Testing](TESTING.md) and [`AI/QUALITY_SCORECARD.md`](../AI/QUALITY_SCORECARD.md). Neither candidate nor baseline proves the still-missing successful draft-PR journey.

The candidate Phase 1B GitHub App path remains connected for exactly `surgeservicesllc/SoftwareFactory`. Manual Phase 1C does not enable Autonomous Mode, RED execution, merge, deployment, or rollback.

## Developer and operator guides

- [Local setup](LOCAL_SETUP.md) - install, configure, and run the application.
- [Architecture](ARCHITECTURE.md) - request, database, worker, Codex, GitHub, and trust boundaries.
- [Environment variables](ENVIRONMENT_VARIABLES.md) - public, Vercel server-only, worker runtime, and GitHub Actions secret names.
- [Supabase setup](SUPABASE_SETUP.md) - hosted identity, Auth, RLS, completed ledger reconciliation through `130014`, and local/unhosted `130015` promotion requirements.
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
