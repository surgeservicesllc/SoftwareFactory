# Local setup

## Prerequisites

- Node.js 22 or newer (matching the repository `engines` requirement)
- npm, using the committed `package-lock.json`
- Git
- Optional: Docker and the Supabase CLI for a local database

## Start in demo/local mode

```bash
git clone https://github.com/surgeservicesllc/SoftwareFactory.git
cd SoftwareFactory
npm ci
```

Copy the environment template without committing the result:

```powershell
Copy-Item .env.example .env.local
```

On macOS/Linux:

```bash
cp .env.example .env.local
```

Leave provider values blank to use the application's explicitly labeled demo/disconnected states. Then run:

```bash
npm run dev
```

Open `http://localhost:3000`. Do not interpret **Demo Data** as live state or **Not Connected** actions as implemented provider operations.

The repository-memory browser remains read-only by default. For a trusted, single-user local process only, set `SOFTWAREFACTORY_ENABLE_LOCAL_FILE_WRITES=true` to enable saving allowlisted Markdown files. Keep it `false` in preview, production, shared hosts, and any environment without an authenticated file-write boundary.

## Local quality checks

Run the same gates used by CI:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

See [Testing](TESTING.md) for focused and E2E commands available in the final package scripts.

## Optional local Supabase

Follow [Supabase setup](SUPABASE_SETUP.md). A local Supabase stack is optional for presentation-only development but required for migration and RLS behavior verification.

## Configuration rules

- `.env.local` and other real environment files stay untracked.
- Only values explicitly described as browser-public in [Environment variables](ENVIRONMENT_VARIABLES.md) may use `NEXT_PUBLIC_`.
- Do not copy production credentials into local configuration or test fixtures.
- Restart `npm run dev` after changing server environment variables.

## Common issues

- **Install differs from CI:** remove no lockfile and use `npm ci`; dependency changes must intentionally update `package-lock.json` through npm.
- **Provider shows Not Connected:** expected until its server-side configuration and verified integration are both present.
- **Supabase access denied:** do not disable RLS. Check authentication, tenant membership, ownership data, and the applicable policy.
- **Framework API confusion:** read the version-matched guide under `node_modules/next/dist/docs/`; this repository uses Next.js 16.3 conventions.
