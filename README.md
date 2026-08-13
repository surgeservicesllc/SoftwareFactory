# SoftwareFactory

SoftwareFactory is a server-first software-engineering control plane for tenant-scoped projects, GitHub App connections, repository inspection, guarded file changes, approvals, and auditable operational state.

The repository is implementing **Phase 1B: Production GitHub App Integration**. Application release `427190d050796e3f5ff5cf6154adc2c34e2e5694` adds fail-closed callback errors, provider URL validation, retry-safe file changes, installation/repository event ordering, linked-project metadata propagation, audited control-plane mutation boundaries, and the narrow service-role helper grant required by provider-ingress table constraints. Its local quality gates and CI pass, and its exact application tree is serving in production. Local forward migrations `011`-`019` are not applied to hosted Supabase; hosted/live provider gates remain pending. A real GitHub provider installation is restricted to `surgeservicesllc/SoftwareFactory`, but the authenticated SoftwareFactory callback/tenant connection, active webhook, and full production journey have not passed; GitHub therefore remains **Not Connected** in-product.

Production UI: [https://softwarefactory-tan.vercel.app](https://softwarefactory-tan.vercel.app), in Vercel project `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`). Provider metadata on READY deployment `dpl_9oqg94scmdn5X86r7yyrgmsVtmBu` records application SHA `427190d050796e3f5ff5cf6154adc2c34e2e5694`; production Playwright passes 12/12 and the deployed-client scan is clean. This provider-resolved application-release evidence remains valid across documentation-only successor commits that do not alter the runtime tree. See [`AI/CURRENT_STATE.md`](AI/CURRENT_STATE.md) for the remaining Phase 1B checks.

## Current trust boundary

- Seeded or static presentation values are labeled **Demo Data**.
- A provider without a verified live installation/session is labeled **Not Connected**.
- GitHub installation and repository tokens are minted server-side, scoped to one installation/repository, short-lived, and never returned to the browser.
- Every interactive GitHub request is bound to the authenticated user's active organization, and a project is counted as connected only while its connection, installation, and selected repository are all live.
- File saves create an isolated `softwarefactory/*` branch, commit, and draft pull request. They never write directly to the default branch, merge, or deploy.
- The Activity page reads immutable tenant events through a no-store server API and excludes event metadata from browser responses.
- No HTTP route writes directly to the local repository; the legacy local file writer and its environment switch have been removed.
- Protected paths and likely credential content are rejected by the standard file-change route.
- A retry of the same file-change intent reuses its idempotency key, and provider-created draft-PR evidence can recover a lost database-completion response without creating a second PR.
- GitHub lifecycle reconciliation treats deletion as terminal for an installation ID and applies installation/repository metadata only with provider ordering evidence.
- A bot record stores the NAME of a server-side credential variable, never a credential value. Control-plane variables (Supabase service role, GitHub App secrets, database URL, deployment tokens, anything `NEXT_PUBLIC_`) cannot be referenced.
- Bot readiness describes configuration only. It resolves the referenced variable to a presence boolean and makes no provider request, so "Ready to assign" never means a provider session exists.
- Auto approve, auto merge, auto deploy, and auto rollback remain OFF.
- OpenAI/Codex execution and Anthropic/Claude execution remain **Not Connected**. Registering, readying, and assigning a bot does not change that: no worker executes assigned work.

## Bot fabric

Connect any bot, give it a role you wrote, and move it between projects from `/bot-manager`.

- **Bots** are provider-neutral: Claude (Anthropic), Codex/GPT (OpenAI), Gemini (Google), Grok (xAI), Mistral, DeepSeek, Groq, OpenRouter, a self-hosted gateway, or any custom OpenAI-compatible HTTPS endpoint. Pick a provider tile and the name, model, and credential variable are pre-filled; the model field accepts any identifier your provider supports.
- **Credentials stay out of the product.** Set the value once as a server-side environment variable (see `.env.example`) and reference it by name. The server answers only "is this populated?"; the value never reaches a table, a response, or a log. Name your own references as `BOT_CREDENTIAL_<NAME>`.
- **Roles** are yours to write: name, mission instructions, risk ceiling, and capability labels. Nine starter roles — orchestrator, product, frontend, backend, database, QA, security reviewer, release manager, docs — can be adopted in one click and then edited.
- **Assignment** posts one bot to one project under one role. A bot holds at most one open posting, so moving it to another project or changing its role is a single click and a single audited transition. Pause or return a bot to the bench at any time.
- Every registration, edit, readiness check, role change, assignment, move, and release appends an immutable, redacted activity event.

## Technology

- Next.js 16.3 App Router, React 19.2, TypeScript strict mode, and Tailwind CSS 4
- Supabase Auth/Postgres with Row Level Security and audited security-definer workflows
- GitHub App authentication with signed state, repository-scoped installation tokens, signed/idempotent webhooks, and draft-PR-only writes
- Vercel hosting
- Vitest/Testing Library and Playwright

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
npm test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
```

Final results for the current tree belong in [`AI/QUALITY_SCORECARD.md`](AI/QUALITY_SCORECARD.md). Test files existing in the repository are not, by themselves, proof that the production integration works.

## Architecture at a glance

```text
Browser
  -> Next.js authenticated server boundary
    -> authorization + tenant/risk validation
      -> Supabase Auth/Postgres (RLS + immutable activity evidence)
      -> GitHub App adapter (server-only secrets + short-lived tokens)
        -> selected repository reads
        -> controlled branch + commit + draft PR
      -> bot fabric (bots, roles, assignments)
        -> credential reference resolved server-side to a presence boolean
        -> no executor
```

GitHub provider responses and webhook payloads are treated as untrusted. Supabase RLS remains an independent tenant boundary. Vercel deployment automation, merge automation, rollback automation, Codex execution, and Claude execution are not part of Phase 1B. The bot fabric is the registry a future worker would bind to; connecting one requires a separate owner-approved decision.

## Documentation

- [`docs/README.md`](docs/README.md) — documentation index
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — runtime and trust boundaries
- [`docs/GITHUB_APP_INTEGRATION.md`](docs/GITHUB_APP_INTEGRATION.md) — exact App setup, routes, permissions, and verification
- [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md) and [`docs/DATABASE_MIGRATIONS.md`](docs/DATABASE_MIGRATIONS.md)
- [`docs/VERCEL_SETUP.md`](docs/VERCEL_SETUP.md)
- [`docs/TESTING.md`](docs/TESTING.md)
- [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md)
- [`docs/AUTONOMOUS_MODE.md`](docs/AUTONOMOUS_MODE.md)

Repository memory lives under [`AI/`](AI/), and enforceable constraints live under [`policies/`](policies/). Every coding agent must follow [`AGENTS.md`](AGENTS.md).

## Security

Never commit credentials or paste them into issues, screenshots, fixtures, logs, or database rows. Review [`SECURITY.md`](SECURITY.md), [`docs/SECURITY.md`](docs/SECURITY.md), and [`policies/PROTECTED_RESOURCES.md`](policies/PROTECTED_RESOURCES.md). Revoke/rotate a possibly disclosed credential at its provider; deleting it from Git is insufficient.

Deployment identity configured for SoftwareFactory.
