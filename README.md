# SoftwareFactory

SoftwareFactory is a server-first, tenant-scoped software-engineering control plane for authenticated projects, GitHub App connections, logical agents, durable commands and runs, repository inspection, guarded changes, validation, approvals, reports, and immutable audit evidence.

## Current status

The published default branch contains the **Phase 2A advisory provider layer**: official Anthropic/OpenAI adapters, health/model discovery, deterministic routing, controlled fallback, independent-review checks, safe APIs, and provider settings/surfaces. Its provider schema is hosted, but provider execution is OFF and no live provider request is verified. Outbound AI execution therefore remains **Not Connected**.

The working tree additionally contains a local **Phase 1C Codex execution implementation candidate**. It can persist a manually submitted GREEN/YELLOW owner command, bind it to the exact connected repository and base SHA, plan a fixed bounded run, wake a durable worker, run the supported `@openai/codex-sdk` in an isolated workspace, validate and policy-scan the diff, push a `factory/*` branch, create or recover only a draft pull request, observe exact-head CI, and record bounded results.

The protected hosted-database work is complete. On 2026-08-13, exact owner approvals covered the catalog-proven ledger-only reconciliation and forward-only migrations through `20260813001400_resolve_emergency_stop.sql` on Supabase project `qpuofpmagrmyamahqwxw`. The linked ledger is reconciled, linked database lint is clean, the three repaired bot functions retain their signatures, `SECURITY DEFINER`, pinned `search_path`, and ACLs with zero `pg_catalog.nullif`, focused register/update/readiness runtime and audit behavior passed `1/1/1`, and the hosted Phase 1D resolver now reports the emergency-stop field. No reset, down-migration, or re-execution of schema-present `130004` occurred.

The seven required GitHub Actions secrets are configured, but the fail-closed activation variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` is absent. The reviewed Phase 1C worker workflow and application tree remain local pending merge/publication. There is no worker heartbeat, Codex thread, factory branch, or live Phase 1C run. Autonomous Mode and all nine automatic actions remain OFF, the global kill switch remains ON, and OpenAI/Codex remains **Not Connected**.

The exact combined pre-publication tree passes `npm run check` on bundled Node `24.19.0`: lint, typecheck, 115 test files/1,251 tests, and a production build with 74 page/route entries. Earlier focused coverage, Playwright/axe, audit, migration, and disabled-worker evidence remains recorded in [`AI/QUALITY_SCORECARD.md`](AI/QUALITY_SCORECARD.md); local results do not prove publication or a live provider run.

The Phase 1B owner repository path remains connected for exactly `surgeservicesllc/SoftwareFactory` through candidate App `4582606`, installation `153479019`, and connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`. Primary installation `153445938` remains rollback while GitHub Support ticket `#4660724` tracks its webhook defect. Phase 1B still has tenant/adverse/reverse/disconnect acceptance gaps.

Production UI: [https://softwarefactory-tan.vercel.app](https://softwarefactory-tan.vercel.app), Vercel project `surgeservices-projects/softwarefactory`. Production serves remote `main` commit `62b5c5a`; latest audited READY deployment is `dpl_4ukaw6y622L6ST99XB9GVpty2cAd`. It does not contain the unpublished local Phase 1C tree.

Only `surgeservicesllc@gmail.com` is the live SoftwareFactory owner. Repository and worker commits use `surgeservicesllc <surgeservicesllc@gmail.com>` as author and committer.

## Safety boundary

- Browser and provider/model output are untrusted. Sensitive work remains server authorized and independently RLS scoped.
- Projects, users, organizations, connections, repositories, logical agents, providers, and models are separate identities.
- Repository selection comes only from the authenticated connected project. Prompt text cannot select a repository or branch.
- RED commands are persisted truthfully but cannot execute in Phase 1C; owner approval does not widen this ceiling.
- Codex runs outside Vercel request lifetimes with bounded time, turns, tokens, retries, output, changed files, and CI observation.
- The worker requires an explicit pipe-delimited `SOFTWAREFACTORY_REQUIRED_CHECKS` allowlist. The reviewed workflow requires exact CI jobs `Lint, typecheck, test, and build` and `Browser and accessibility tests`; missing, renamed, incomplete, non-successful, or unstable evidence fails closed.
- The worker verifies the exact base SHA, uses an isolated `factory/*` branch, and publishes only an open draft PR.
- Validation uses a pinned restricted Docker image. Changed files pass containment, binary/symlink, secret, protected-path, count, and size checks.
- No Phase 1C path writes the default branch, approves or merges a PR, deploys, rolls back, modifies provider/workflow settings, or configures secrets.
- The Phase 1D decision layer and forward-only resolver repair are hosted, but it has no executor. Autonomous Mode is OFF, the global kill switch is ON, and all nine automatic actions remain OFF.
- **Demo Data**, **Not Connected**, **Configured**, and **Queued** are evidence labels, not marketing labels. Queued intent is not a worker run.

## Technology

- Next.js 16.3 App Router, React 19.2, TypeScript strict mode, Tailwind CSS 4
- Supabase Auth/Postgres with RLS/FORCE RLS and audited security-definer workflows
- GitHub App authentication with short-lived repository-ID-scoped tokens
- `@openai/codex-sdk` 0.147.0 and a reviewed Node/GitHub Actions worker
- Pinned Docker validation runtime
- Vercel hosting, GitHub Actions, Vitest/Testing Library, Playwright/axe

## Local development

Requirements: Node.js 22 or newer and npm.

```bash
npm ci
```

Copy `.env.example` to `.env.local`, configure only the environment you intend to test, and keep real credentials out of source control.

```powershell
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. See [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md), [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md), and [`docs/GITHUB_APP_INTEGRATION.md`](docs/GITHUB_APP_INTEGRATION.md).

## Quality commands

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm test
npm run build
npm run test:e2e
```

Worker entry points:

```bash
npm run worker
npm run worker:once
```

The worker is disabled by default. Its hosted schema is current through forward-only migration `130014`, and its seven protected Actions secrets are configured, but it still requires publication of the exact reviewed tree, a dedicated safe work root, Docker, the exact required-check allowlist, and repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED=true` during the approved bounded acceptance window. Migration `130006` remains decision-only and grants no automatic authority. Missing/false activation skips every workflow job. Do not enable it against production outside the exact protected release sequence in [`AI/PHASE_1C_IMPLEMENTATION_PLAN.md`](AI/PHASE_1C_IMPLEMENTATION_PLAN.md).

## Architecture at a glance

```text
Browser
  -> Next.js Auth/tenant/risk/repository boundary
    -> Supabase durable command/task/run
    -> opaque repository dispatch
      -> lease-bound GitHub Actions worker
        -> exact GitHub repository/base SHA
        -> isolated Codex workspace
        -> deterministic validation + policy scan
        -> factory branch + draft PR + exact-head CI
        -> bounded Supabase result/audit evidence
```

## Documentation

- [`docs/README.md`](docs/README.md) - documentation index
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - trust and runtime boundaries
- [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md) - Vercel/runtime/Actions secret names
- [`docs/DATABASE_MIGRATIONS.md`](docs/DATABASE_MIGRATIONS.md) and [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md)
- [`docs/GITHUB_APP_INTEGRATION.md`](docs/GITHUB_APP_INTEGRATION.md) - Phase 1B App and Phase 1C worker repository scopes
- [`docs/AI_PROVIDERS.md`](docs/AI_PROVIDERS.md) - Phase 2A advisory providers, routing, fallback, and execution switch
- [`docs/TESTING.md`](docs/TESTING.md) - local, hosted, and real-provider evidence requirements
- [`docs/SECURITY.md`](docs/SECURITY.md) and [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md)
- [`docs/AUTONOMOUS_MODE.md`](docs/AUTONOMOUS_MODE.md) - manual Phase 1C is not autonomous execution

Repository memory lives under [`AI/`](AI/), enforceable controls live under [`policies/`](policies/), and every agent must follow [`AGENTS.md`](AGENTS.md).

## Security

Never commit or display credentials. Do not place API keys, service-role keys, App private keys, OAuth/installation tokens, webhook/state secrets, database passwords, or generated workspace state in source, Supabase rows, prompts, model output, logs, fixtures, reports, screenshots, or browser payloads. Revoke and rotate a possibly disclosed credential at its provider; deleting it from Git is insufficient.
