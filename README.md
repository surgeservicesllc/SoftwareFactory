# SoftwareFactory

SoftwareFactory is a server-first software-engineering control plane for tenant-scoped projects, GitHub App connections, repository inspection, guarded file changes, approvals, and auditable operational state.

The repository is implementing **Phase 1B: Production GitHub App Integration**. Hosted Supabase is current through migration `027`. Owner `surgeservicesllc@gmail.com` is authenticated, and owner-only candidate App `4582606` (`surge-softwarefactory-next`) is installed as installation `153479019` with connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, scoped exactly to `surgeservicesllc/SoftwareFactory`. A candidate-signed webhook was processed after synchronization, and project `b1f23696-437e-4d89-b55f-d7a949980e8f` was atomically handed off without changing its project identity or prior history. Candidate-backed Files read and draft-only write acceptance passed through draft PR `#8`; it stayed draft, passed CI and Vercel Preview, was closed unmerged, and its temporary branch was deleted. Primary App `4573846` still cannot retain its webhook under OPEN GitHub Support ticket [#4660724](https://support.github.com/ticket/personal/0/4660724), but its installation `153445938` remains active as the explicit rollback path. Phase 1B is still incomplete because the live second-tenant and remaining adverse lifecycle/disconnect matrix have not all passed. Phase 1C and Phase 2 remain **Not Connected**, and every automatic action remains OFF.

Production UI: [https://softwarefactory-tan.vercel.app](https://softwarefactory-tan.vercel.app), in Vercel project `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`). Current production is READY deployment `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ`, immutable URL `https://softwarefactory-7kfx3u1ey-surgeservices-projects.vercel.app`, sourced from `main` application commit `799d2cea189b6860a03987ae75c25765f9ac4aca` and served by the stable alias. CI run `31716263910` passed both jobs. No secret values are recorded here. See [`AI/CURRENT_STATE.md`](AI/CURRENT_STATE.md) for the remaining Phase 1B checks.

## Current trust boundary

- Seeded or static presentation values are labeled **Demo Data**.
- A provider without a verified live installation/session is labeled **Not Connected**.
- GitHub installation and repository tokens are minted server-side, scoped to one installation/repository, short-lived, and never returned to the browser.
- Every interactive GitHub request is bound to the authenticated user's active organization, and a project is counted as connected only while its connection, installation, and selected repository are all live.
- Project authorization and the project-picker UI follow stable GitHub repository IDs; mutable repository names are display metadata. Concurrent active relinks are serialized, while a repository may be relinked after every prior project for it is archived.
- File saves create an isolated `softwarefactory/*` branch, commit, and draft pull request. They never write directly to the default branch, merge, or deploy.
- Tenant list routes use caller-bound, row-limited RPC projections instead of granting browser sessions direct reads of sensitive control-plane base-table columns.
- Authenticated browser access to raw `activity_events` and `github_webhook_deliveries` rows is revoked. The Activity page uses a caller-member, row-limited `list_activity` RPC and exposes only allowlisted, bounded actor/source/resource/action/status/conclusion/transition evidence, never raw metadata or webhook payloads.
- No HTTP route writes directly to the local repository; the legacy local file writer and its environment switch have been removed.
- Unapproved protected paths and all likely credential content fail closed, including opaque values assigned to generic secret-bearing keys such as `PASSWORD`, `CLIENT_SECRET`, or `PRIVATE_KEY_BASE64`. An active organization owner may authorize one exact protected-file RED intent for at most 15 minutes by supplying the required path-bound phrase, rationale, and rollback plan; the database binds that snapshot to the exact reservation, and the write-scoped installation token is minted only after the durable provider-execution boundary. The outcome is still only a draft PR.
- A retry of the same file-change intent reuses its idempotency key, and provider-created draft-PR evidence can recover a lost database-completion response without creating a second PR.
- A five-minute reservation can be reclaimed only for the exact original intent before any provider execution/evidence exists; entering the provider boundary permanently disables lease reclamation.
- GitHub lifecycle reconciliation treats deletion as terminal for an installation ID and applies installation/repository metadata only with provider ordering evidence.
- The deployed replacement path keeps primary and candidate GitHub Apps cryptographically isolated, binds installation state and repository tokens to the exact App ID, validates webhook signing-App provenance, and blocks first handoff until the target installation has a fresh processed signed delivery. Hosted migration `027` preserved the existing project/history during the verified candidate handoff and supports an evidence-bound reverse handoff while both installations remain active.
- Connections displays the live installation ID and repository-selection mode. Projects uses stable repository IDs and displays live sync freshness, branch protection and SHA, commit authors/dates, PR authors/created/updated times, detail-fetched mergeability, default-branch checks, and checks fetched against each displayed PR head SHA.
- Controlled commits require the server-only Production/Preview deployment identity and send the same approved `surgeservicesllc <surgeservicesllc@gmail.com>` identity as both GitHub author and committer, with no App-bot fallback.
- Mutation routes require same-origin requests, and global response headers deny framing/objects and restrict scripts, connections, images, and other browser resources.
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
