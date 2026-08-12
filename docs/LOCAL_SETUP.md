# Local setup

## Prerequisites

- Node.js 22 or newer
- npm with the committed `package-lock.json`
- Git
- Optional Docker/Supabase CLI for local database work
- A separate development GitHub App only when testing a real local callback tunnel

## Start safely

```bash
git clone https://github.com/surgeservicesllc/SoftwareFactory.git
cd SoftwareFactory
npm ci
```

```powershell
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. With provider values empty, the application must show **Not Connected**. Do not copy production App private keys, webhook secrets, service-role keys, or database credentials into routine development configuration.

## Local Supabase

Follow [Supabase setup](SUPABASE_SETUP.md). A local stack is required for destructive reset/migration work. Never run `db reset` against hosted production.

## GitHub development testing

Prefer a separate development App and disposable repository/account. The callback and webhook need an HTTPS origin reachable by GitHub; update both the development App and local environment to that exact origin. Do not reuse production secrets or broaden permissions.

For UI/unit work without real providers, mock at the server/provider boundary and preserve **Not Connected** labels. Mocks do not satisfy production acceptance.

## Local file switch

`SOFTWAREFACTORY_ENABLE_LOCAL_FILE_WRITES=true` enables the legacy allowlisted local Markdown writer only in a trusted single-user process. It is unrelated to the GitHub-backed editor and must remain false in shared, preview, and production environments.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

See [Testing](TESTING.md) for exact Phase 1B evidence requirements.

## Common issues

- **Provider Not Connected:** expected until server configuration, authenticated installation, and health checks all pass.
- **Auth redirects incorrectly:** compare Supabase Auth redirect allowlist and `NEXT_PUBLIC_APP_URL`/GitHub callback origin.
- **GitHub configuration error:** validate presence/format without printing secrets; use one private-key variable form.
- **Supabase access denied:** inspect session, organization, RLS, and ownership; never disable RLS.
- **Node warning:** use Node 22+, which the repository targets.
- **Framework behavior differs:** read version-matched Next.js 16.3 docs under `node_modules/next/dist/docs/`.
