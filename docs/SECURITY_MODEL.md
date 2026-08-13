# Security model

## Trust boundaries

The browser is untrusted. Next.js server code authenticates and authorizes. Supabase RLS independently restricts tenant data. GitHub responses, webhooks, repository content, Vercel state, and future model output remain external/untrusted even when cryptographically authenticated.

## Authentication and tenant authorization

- Supabase Auth sessions are resolved server-side and refreshed through the narrow proxy boundary.
- Sensitive routes require an authenticated user and active organization membership; interactive GitHub routes reject an organization, connection, installation, or repository outside that exact active organization.
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
- Newly granted repository metadata is schema-bounded and reconciled only through a service-role RPC after signature, installation, tenant, and event validation. Installation/repository transitions also require provider ordering evidence and preserve terminal deletion. The required forward migrations are local and not hosted yet.

## Repository mutations

- Validate coordinates, refs, path, size, UTF-8 content, project mapping, and synchronized default branch; match normalized repository full names literally without SQL wildcard semantics.
- Reject credential-like content and protected resource classes including repository memory/policies, Supabase, every application API route, server-side provider/data libraries, Auth/session boundaries, deployment/environment/infrastructure files, and security-sensitive subject paths.
- Reserve an idempotency record through a caller-authenticated RPC that revalidates the exact live tenant/project/connection/repository binding before provider writes. An unchanged browser save intent reuses its idempotency key.
- Create a new `softwarefactory/*` branch, update with the expected blob SHA, and require GitHub to return an open draft PR.
- Never write directly to the default branch, merge, modify workflows, or deploy.
- Record completed/failed mutation evidence without file content or secrets. If the branch, commit, and draft PR exist at GitHub but database completion was ambiguous, a server-only recovery RPC records that same provider evidence instead of initiating a duplicate change.
- No HTTP local-repository writer or local-write environment switch remains as an alternate mutation path.

## Secrets

Only the Supabase URL and publishable/anonymous client key may use `NEXT_PUBLIC_`. The App private key, GitHub client/state/webhook secrets, OAuth/installation tokens, Supabase service role, DB credentials, and future provider keys stay in environment-scoped secret storage. Database connection rows hold only non-secret metadata/opaque references.

## Audit and privacy

Important operations append actor, tenant, target, event type, timestamp, request/correlation data, and redacted evidence. Activity events are immutable. Local migration `012` makes completed and failed GitHub change requests explicitly actor-attributed and retains only bounded branch/commit failure evidence; `014` audits exact linked-project metadata propagation; `015` audits completion recovery; and `016`/`018` audit applied, stale, ignored, and terminal provider transitions. None is hosted yet. Webhook payloads and change records deliberately avoid raw credentials and full file bodies. The live Activity API uses the caller's RLS session and does not return event metadata to the browser.

Local migrations `011` and `017` remove direct authenticated writes to connections, memberships, projects, project links, and GitHub change requests so narrow audited workflows remain the intended mutation path. Until the complete local chain is explicitly approved and applied to hosted Supabase, that hosted hardening is pending rather than assumed.

Local migration `019` addresses the separate provider-ingress CHECK-expression boundary: service role may execute only the SECURITY DEFINER sensitive-JSON wrapper referenced by table constraints. Its recursive implementation and the standalone text classifier remain inaccessible. This grant is local/unhosted and requires exact owner-approved promotion plus a real service-role insert/rejection matrix.

## Supply chain and delivery

- Use the committed lockfile and `npm ci`.
- CI has read-only repository access and no provider/deployment credentials.
- Review dependencies, workflows, migrations, Auth/RLS, and provider-permission changes as protected work.
- Never run untrusted pull-request code with protected secrets.
- Auto approve/merge/deploy/rollback remain OFF.
- The Phase 1D global kill switch is ON, the observation ceiling is GREEN, and the execution worker is **Not Connected**. A `WOULD_BE_ELIGIBLE` observation is never an execution grant.

## Incident response

1. Activate the relevant kill/containment path and preserve redacted evidence.
2. Revoke/rotate possibly exposed credentials at GitHub, Supabase, or Vercel.
3. Suspend/disconnect affected installations/projects without deleting audit history.
4. Notify the owner and record the incident.
5. Recover through a verified plan; never assume rollback is safe.
6. Reverify tenant isolation, provider permissions, webhook signatures, and production behavior before reconnecting.
