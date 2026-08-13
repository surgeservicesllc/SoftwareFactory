# Documentation index

SoftwareFactory is implementing **Phase 1B: Production GitHub App Integration**. Hosted history is verified through `026`, and `surgeservicesllc@gmail.com` completed authenticated owner onboarding. Installation `153445938` is connected to `surgeservicesllc` with exactly `surgeservicesllc/SoftwareFactory` selected; the real connection, project, repository reads, draft-only writes, secret rejection, and Activity evidence have been exercised. The provider webhook remains blank/inactive and **Not Connected**, and the live second-tenant matrix remains pending, so Phase 1B is not complete.

## Developer and operator guides

- [Local setup](LOCAL_SETUP.md) — install, configure, and run the application.
- [Architecture](ARCHITECTURE.md) — server, database, GitHub, and trust boundaries.
- [Environment variables](ENVIRONMENT_VARIABLES.md) — public versus server-only configuration.
- [Supabase setup](SUPABASE_SETUP.md) — hosted/local configuration, Auth redirects, and RLS expectations.
- [Database migrations](DATABASE_MIGRATIONS.md) — migration inventory, verification, and promotion rules.
- [GitHub App integration](GITHUB_APP_INTEGRATION.md) — exact App registration, routes, permissions, secret handling, and acceptance checks.
- [Vercel setup](VERCEL_SETUP.md) — project identity, environment scopes, and manual promotion.
- [Testing](TESTING.md) — Phase 1B quality and live-integration evidence.
- [Security guide](SECURITY.md) and [security model](SECURITY_MODEL.md) — tenant isolation, GitHub tokens/webhooks, audit, and incident handling.
- [Autonomous mode](AUTONOMOUS_MODE.md) — controls remain OFF; Phase 1B does not merge or deploy.

## Status vocabulary

- **Demo Data:** seeded/static information, not production telemetry.
- **Not Connected:** no end-to-end verified provider installation/session is available.
- **Configured:** required code or secret references exist, but connectivity is not necessarily verified.
- **Queued:** intent was persisted; no worker execution is implied.

Configuration, a successful build, or a provider object existing in an account does not prove an end-to-end connection. `AI/CURRENT_STATE.md` is the evidence-based status record.

## Repository governance

Agents must read `AGENTS.md`, its required `AI/` memory files, and required `policies/` before material work. Authoritative code, migrations, provider configuration, and current test output take precedence over stale documentation.
