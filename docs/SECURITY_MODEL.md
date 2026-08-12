# Security model

## Trust boundaries

The browser is untrusted. Next.js server code authenticates and authorizes. Supabase RLS independently restricts tenant data. GitHub responses, webhooks, repository content, Vercel state, and future model output remain external/untrusted even when cryptographically authenticated.

## Authentication and tenant authorization

- Supabase Auth sessions are resolved server-side and refreshed through the narrow proxy boundary.
- Sensitive routes require an authenticated user and active organization membership.
- Installation/sync/disconnect/project creation/file changes require owner/admin where appropriate.
- Repository calls verify the connection, installation, selected repository, and tenant before minting a token.
- Hidden/disabled UI controls are never authorization.
- RLS and FORCE RLS protect exposed tables; service-role operations require independent checks.

## GitHub authentication

- Installation start uses HMAC-signed, ten-minute state plus an HttpOnly nonce cookie tied to user and organization.
- Callback exchanges the one-time OAuth code, verifies user access and exact App identity, and never persists/returns the user token.
- App JWTs use the server-only private key and a bounded lifetime.
- Installation tokens are short-lived, repository-ID-scoped, and permission-reduced for each operation.
- Provider responses are size bounded and schema validated; redirects and API origins are allowlisted.

## Webhook security

- Read raw bytes before JSON parsing and cap them at 2 MiB.
- Verify `X-Hub-Signature-256` with the server-only secret using constant-time comparison.
- Validate GitHub delivery/event headers and an allowlisted payload shape.
- Enforce idempotency by delivery ID and payload hash; conflicting replay returns an error.
- Store only a redacted subset plus hash/status metadata.
- Unknown events/installations are ignored safely and cannot mutate another tenant.

## Repository mutations

- Validate coordinates, refs, path, size, UTF-8 content, project mapping, and synchronized default branch; match normalized repository full names literally without SQL wildcard semantics.
- Reject credential-like content and protected resource classes including repository memory/policies, Supabase, every application API route, server-side provider/data libraries, Auth/session boundaries, deployment/environment/infrastructure files, and security-sensitive subject paths.
- Reserve an idempotency record before provider writes.
- Create a new `softwarefactory/*` branch, update with the expected blob SHA, and require GitHub to return an open draft PR.
- Never write directly to the default branch, merge, modify workflows, or deploy.
- Record completed/failed mutation evidence without file content or secrets.

## Secrets

Only the Supabase URL and publishable/anonymous client key may use `NEXT_PUBLIC_`. The App private key, GitHub client/state/webhook secrets, OAuth/installation tokens, Supabase service role, DB credentials, and future provider keys stay in environment-scoped secret storage. Database connection rows hold only non-secret metadata/opaque references.

## Audit and privacy

Important operations append actor, tenant, target, event type, timestamp, request/correlation data, and redacted evidence. Activity events are immutable. Webhook payloads and change records deliberately avoid raw credentials and full file bodies.

## Supply chain and delivery

- Use the committed lockfile and `npm ci`.
- CI has read-only repository access and no provider/deployment credentials.
- Review dependencies, workflows, migrations, Auth/RLS, and provider-permission changes as protected work.
- Never run untrusted pull-request code with protected secrets.
- Auto approve/merge/deploy/rollback remain OFF.

## Incident response

1. Activate the relevant kill/containment path and preserve redacted evidence.
2. Revoke/rotate possibly exposed credentials at GitHub, Supabase, or Vercel.
3. Suspend/disconnect affected installations/projects without deleting audit history.
4. Notify the owner and record the incident.
5. Recover through a verified plan; never assume rollback is safe.
6. Reverify tenant isolation, provider permissions, webhook signatures, and production behavior before reconnecting.
