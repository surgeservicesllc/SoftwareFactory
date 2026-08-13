# Documentation index

SoftwareFactory is implementing **Phase 1B: Production GitHub App Integration**. Hosted history now includes migration `027`, and `surgeservicesllc@gmail.com` completed authenticated owner onboarding. Candidate App `4582606` is installed as `153479019` with connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, scoped exactly to `surgeservicesllc/SoftwareFactory`. Its post-sync signed webhook, atomic handoff of project `b1f23696-437e-4d89-b55f-d7a949980e8f`, candidate-backed file read, and draft-only PR `#8` write path passed. PR `#8` remained draft, passed CI and Vercel Preview, was closed unmerged, and its temporary branch was deleted. Primary installation `153445938` remains active as the rollback path. The live second-tenant and remaining adverse lifecycle/disconnect matrix are still pending, so Phase 1B is not complete; Phase 1C and Phase 2 remain **Not Connected**, and automatic actions remain OFF.

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
