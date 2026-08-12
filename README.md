# SoftwareFactory

SoftwareFactory is a standalone AI software-engineering command center for projects, agents, work queues, repository memory, provider connections, validation, approvals, releases, and executive reporting.

The repository is currently building **Phase 1A: the trustworthy control-plane foundation**. It does not yet run unrestricted autonomous production changes.

Production UI: [https://softwarefactory-tan.vercel.app](https://softwarefactory-tan.vercel.app) — verified Vercel deployment `dpl_Fi7jEzWFbtW3vrXDGuEodPumTuJ7` in project `surgeservices-projects/softwarefactory`. This is UI hosting only; Supabase, GitHub, AI-provider, and deployment/rollback automation connections remain **Not Connected**.

## Current trust boundary

- Seeded or static presentation values are labeled **Demo Data**.
- A provider without verified live connectivity is labeled **Not Connected**.
- A queued Bot Manager command records intent; it does not mean an AI worker executed it.
- Auto approve, merge, deploy, and rollback default OFF.
- RED-risk actions require explicit owner approval in Phase 1.
- Privileged provider keys and service-role credentials stay server-only and out of database rows.

See [`AI/CURRENT_STATE.md`](AI/CURRENT_STATE.md) for the evidence-based implementation status and [`AI/QUALITY_SCORECARD.md`](AI/QUALITY_SCORECARD.md) for release gates.

## Technology

- Next.js 16.3 with App Router
- React 19.2 and TypeScript strict mode
- Tailwind CSS 4
- Supabase Auth/Postgres architecture with Row Level Security
- Verified Vercel production UI hosting with deployment automation still **Not Connected**
- Vitest/Testing Library and Playwright testing foundations

## Local development

Requirements: Node.js 22 or newer and npm (matching `package.json`).

```bash
npm ci
```

Copy `.env.example` to `.env.local`. Leave provider values blank for explicitly labeled demo/disconnected behavior; never add real credentials to source control.

```powershell
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. See [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md) and [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md) for complete setup and secret-handling guidance.

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

CI runs locked install, lint, typecheck, Vitest, production build, and Playwright browser/accessibility tests. It has read-only repository permissions and does not merge or deploy.

## Architecture at a glance

The browser is untrusted and contains no privileged secrets. Next.js server boundaries authenticate, authorize, validate, apply risk policy, and persist auditable state. Supabase provides tenant-scoped persistence protected by RLS. Future GitHub, Vercel, and AI-provider adapters resolve credentials only on the server and are separate from projects, agents, and users.

```text
Browser
  -> Next.js server boundary
    -> authorization + risk policy + validation
      -> Supabase (RLS-protected control-plane data)
      -> server-only secret resolution
      -> future provider adapters / durable workers
```

The current phase has no verified production worker, GitHub App automation, Vercel deployment automation, or automatic rollback executor. The Phase 1A UI itself is live on the verified Vercel deployment linked above.

## Documentation

- [`docs/README.md`](docs/README.md) — documentation index
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system boundaries and flow
- [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md) and [`docs/DATABASE_MIGRATIONS.md`](docs/DATABASE_MIGRATIONS.md)
- [`docs/VERCEL_SETUP.md`](docs/VERCEL_SETUP.md)
- [`docs/TESTING.md`](docs/TESTING.md)
- [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md)
- [`docs/AUTONOMOUS_MODE.md`](docs/AUTONOMOUS_MODE.md)
- [`docs/GITHUB_APP_INTEGRATION.md`](docs/GITHUB_APP_INTEGRATION.md)

Repository memory lives under [`AI/`](AI/). Enforceable risk and automation constraints live under [`policies/`](policies/). Every coding agent must read the required files listed in [`AGENTS.md`](AGENTS.md) before material work.

## Provider setup

- Supabase: [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md)
- Vercel: [`docs/VERCEL_SETUP.md`](docs/VERCEL_SETUP.md)
- Future GitHub App: [`docs/GITHUB_APP_INTEGRATION.md`](docs/GITHUB_APP_INTEGRATION.md)

Configuration or UI hosting alone is not proof of a control-plane provider connection. The production UI is verified, while Supabase, GitHub, AI providers, and the in-product Vercel deployment/rollback integration remain **Not Connected** until authenticated server-side health and failure paths are verified.

## Security

Do not commit secrets or report them in public issues. Review [`SECURITY.md`](SECURITY.md), [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md), and [`policies/PROTECTED_RESOURCES.md`](policies/PROTECTED_RESOURCES.md). A suspected disclosure requires provider-side revocation/rotation; deleting a value from Git is not sufficient.

Deployment identity configured for SoftwareFactory.
