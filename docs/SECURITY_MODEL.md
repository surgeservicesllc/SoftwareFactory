# Security model

## Trust boundaries

The browser is untrusted. Next.js server code is the application authorization boundary. Supabase enforces a second tenant boundary through RLS. GitHub, Vercel, AI providers, webhook payloads, and model output are external/untrusted even when authenticated.

## Authentication and tenant authorization

- Resolve the authenticated identity on the server.
- Verify active organization membership and resource ownership on every sensitive read/mutation.
- Keep RLS enabled on every exposed table and test allow plus deny behavior.
- Never treat a hidden/disabled UI control, agent instruction, or provider response as authorization.
- Service-role access bypasses RLS and is restricted to explicit server operations with independent checks.

## Secrets

- Privileged credentials never enter client modules, props, browser storage, source maps, logs, audit metadata, reports, fixtures, screenshots, or database rows.
- Only intentionally public Supabase URL and anonymous/publishable client configuration may use `NEXT_PUBLIC_`; RLS is still mandatory.
- Connection records contain redacted metadata and opaque server-side secret references.
- Use environment-scoped secret managers, least privilege, rotation, and short-lived provider credentials when available.
- If disclosure is suspected, revoke/rotate first; Git history cleanup alone does not neutralize a credential.

## Mutations and integrations

- Validate input server-side and constrain resource identifiers to the authorized tenant/project.
- The Phase 1A local repository-file write switch is for a trusted single-user development process only. It stays disabled in hosted environments until authenticated tenant/project authorization and durable version history exist.
- Use idempotency keys, replay protection, timeouts, bounded retries, and concurrency locks for external mutations.
- Verify webhook signatures against the raw body before parsing; store provider delivery IDs to reject replay/duplicates.
- Treat model/provider text as data, never executable authority. Prevent prompt or repository content from expanding scopes.
- RED actions require exact, current, explicit owner approval in Phase 1.

## Audit and privacy

Important actions emit append-only activity events with actor, tenant, target, type, time, correlation ID, and redacted evidence. Audit records exclude secrets and unnecessary personal/provider payloads. Retention and deletion must preserve legal/security needs without collecting data “just in case.”

## Supply chain and CI

- Use the committed lockfile and `npm ci`.
- CI receives read-only repository contents and no deploy/merge credentials.
- Review dependency and workflow changes as elevated risk.
- Never execute untrusted pull-request code with protected secrets.

## Incident response

1. Stop the affected automation and preserve redacted evidence.
2. Revoke/rotate possibly exposed credentials.
3. Contain the affected project, connection, worker, or environment.
4. Notify the owner and create an incident/audit record.
5. Recover using a verified plan; do not assume rollback is safe.
6. Validate isolation and behavior, then document root cause and prevention.

Report suspected vulnerabilities through the private process in the repository `SECURITY.md`.
