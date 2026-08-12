# Documentation index

SoftwareFactory is in **Phase 1A: control-plane foundation**. These guides describe the current safe operating model and the intended path to live integrations. They do not imply that a provider is connected.

## Developer and operator guides

- [Local setup](LOCAL_SETUP.md) — install, configure, and run the application.
- [Architecture](ARCHITECTURE.md) — system boundaries, layers, data flow, and deployment shape.
- [Environment variables](ENVIRONMENT_VARIABLES.md) — public versus server-only configuration.
- [Supabase setup](SUPABASE_SETUP.md) — local/cloud project configuration and RLS expectations.
- [Database migrations](DATABASE_MIGRATIONS.md) — create, verify, and safely promote schema changes.
- [Vercel setup](VERCEL_SETUP.md) — preview/production configuration without CI auto-deploy.
- [Testing](TESTING.md) — quality layers and release evidence.
- [Security guide](SECURITY.md) and [security model](SECURITY_MODEL.md) — trust boundaries, tenant isolation, secrets, audit, and incident handling.
- [Autonomous mode](AUTONOMOUS_MODE.md) — control semantics and Phase 1 restrictions.
- [Future GitHub App integration](GITHUB_APP_INTEGRATION.md) — proposed least-privilege repository connection.

## Repository governance

Agents must read `AGENTS.md`, all files under `AI/`, and the five required files under `policies/` before material work. The repository-memory files describe current state and intent; the policies are enforceable constraints. Authoritative implementation and test evidence must be used to correct stale memory.

## Status vocabulary

- **Demo Data:** seeded/static information, not production telemetry.
- **Not Connected:** no verified live integration is available.
- **Queued:** intent was persisted; no worker execution is implied.

Any guide that discusses a future integration should be read as a design contract until `AI/CURRENT_STATE.md` records verified connectivity evidence.
