# SoftwareFactory

SoftwareFactory is a server-first software-engineering control plane for tenant-scoped projects, GitHub App connections, repository inspection, guarded file changes, approvals, and auditable operational state.

The repository is implementing **Phase 1B: Production GitHub App Integration**. The code now includes Supabase authentication/onboarding, GitHub App installation and synchronization boundaries, live project/repository views, and a controlled file-to-draft-PR workflow. The real GitHub App installation and full production journey have not yet been verified, so GitHub remains **Not Connected** until that acceptance run succeeds.

Production UI: [https://softwarefactory-tan.vercel.app](https://softwarefactory-tan.vercel.app), in Vercel project `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`). See [`AI/CURRENT_STATE.md`](AI/CURRENT_STATE.md) for which release is live and which Phase 1B checks remain.

## Current trust boundary

- Seeded or static presentation values are labeled **Demo Data**.
- A provider without a verified live installation/session is labeled **Not Connected**.
- GitHub installation and repository tokens are minted server-side, scoped to one installation/repository, short-lived, and never returned to the browser.
- File saves create an isolated `softwarefactory/*` branch, commit, and draft pull request. They never write directly to the default branch, merge, or deploy.
- Protected paths and likely credential content are rejected by the standard file-change route.
- Auto approve, auto merge, auto deploy, and auto rollback remain OFF.
- OpenAI/Codex execution and Anthropic/Claude execution remain **Not Connected**.

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
```

GitHub provider responses and webhook payloads are treated as untrusted. Supabase RLS remains an independent tenant boundary. Vercel deployment automation, merge automation, rollback automation, Codex execution, and Claude execution are not part of Phase 1B.

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
