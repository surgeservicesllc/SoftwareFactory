# Security model

## Trust boundaries

The browser is untrusted. Next.js server code authenticates and authorizes. Supabase RLS independently restricts tenant data. GitHub responses, webhooks, repository content, Vercel state, and future model output remain external/untrusted even when cryptographically authenticated.

## Authentication and tenant authorization

- Supabase Auth sessions are resolved server-side and refreshed through the narrow proxy boundary.
- Sensitive routes require an authenticated user and active organization membership; interactive GitHub routes reject an organization, connection, installation, or repository outside that exact active organization.
- Installation/sync/disconnect/project creation/file changes require owner/admin where appropriate. Project creation serializes on the stable tenant/repository UUID and permits relinking only after every prior project for that repository is archived.
- Protected-file changes require the active organization owner specifically and an exact, current RED approval; an administrator cannot approve them.
- Repository calls verify the connection, installation, selected repository, and tenant before minting a token.
- Project/change authorization follows the immutable tenant-scoped repository UUID stored on the project connection, not a mutable repository name.
- Hidden/disabled UI controls are never authorization.
- RLS and FORCE RLS protect exposed tables; service-role operations require independent checks.
- Agents, commands, tasks, runs, and reports are exposed through bounded caller-member safe-projection RPCs; authenticated sessions have no direct SELECT on those sensitive base tables. Command writes also require same-origin requests.

## GitHub authentication

- Installation start uses HMAC-signed, ten-minute state plus an HttpOnly nonce cookie tied to user, organization, App slot, and App ID.
- Callback selects the configured App from the untrusted routing hint, verifies the complete state with that App's distinct secret, requires the signed App ID to match configuration, exchanges the one-time OAuth code, verifies user access and exact App identity, and never persists/returns the user token.
- App JWTs use the server-only private key and a bounded lifetime.
- Installation tokens are short-lived, repository-ID-scoped, and permission-reduced for each operation.
- Provider responses are size bounded and schema validated; redirects and API origins are allowlisted.

## Webhook security

- Read raw bytes before JSON parsing and cap them at 2 MiB.
- Verify `X-Hub-Signature-256` with the server-only secret using constant-time comparison.
- In the pre-release dual-App boundary, identify the signing App from its isolated secret and reject a delivery when that App ID differs from the persisted installation App ID.
- Validate GitHub delivery/event headers and an allowlisted payload shape.
- Enforce idempotency by delivery ID and payload hash; conflicting replay returns an error.
- Store only a redacted subset plus hash/status metadata. Authenticated clients cannot directly read webhook-delivery or raw Activity rows; `list_activity` may expose only bounded allowlisted actor/source/resource/action/status/conclusion/transition evidence, never the stored subset or unknown nested fields.
- Unknown events/installations are ignored safely and cannot mutate another tenant.
- Newly granted repository metadata is schema-bounded and reconciled only through a service-role RPC after signature, installation, tenant, and event validation. Installation/repository transitions also require provider ordering evidence and preserve terminal deletion. Migrations `011`-`027` are hosted; live candidate handoff evidence passes.

## Repository mutations

- Validate coordinates, refs, path, size, UTF-8 content, project/repository-UUID mapping, and synchronized default branch. Repository names are display/freshness metadata, not authorization keys.
- Reject credential-like content, including opaque non-placeholder values assigned to generic secret-bearing keys such as `PASSWORD`, `CLIENT_SECRET`, or `PRIVATE_KEY_BASE64`. For repository memory/policies, Supabase, application APIs, server-side provider/data libraries, Auth/session boundaries, deployment/environment/infrastructure files, and other protected paths, require the active owner to provide the exact path-bound RED confirmation, bounded rationale, and rollback plan.
- Reserve an idempotency record through a caller-authenticated RPC that revalidates the exact live tenant/project/connection/repository binding before provider writes. An unchanged browser save intent reuses its idempotency key.
- Persist immutable requester/approver/executor, path, content digest, expected blob SHA, base branch, rationale, rollback, decision, and expiry evidence before a protected provider write. A trigger and the provider-entry RPC revalidate that snapshot against the exact reservation. Approval expires within 15 minutes.
- Give each reservation a five-minute lease. Reclaim is allowed only for the original requester and exact intent before provider execution/evidence; persist and revalidate entry into the provider boundary before minting a write-scoped installation token so a started execution cannot be reclaimed or bypass approval ordering.
- Create a new `softwarefactory/*` branch, update with the expected blob SHA, and require GitHub to return an open draft PR.
- Never write directly to the default branch, merge, modify workflows, or deploy.
- Record completed/failed mutation evidence without file content or secrets. If the branch, commit, and draft PR exist at GitHub but database completion was ambiguous, a server-only recovery RPC records that same provider evidence instead of initiating a duplicate change.
- No HTTP local-repository writer or local-write environment switch remains as an alternate mutation path.

## Secrets

Only the Supabase URL and publishable/anonymous client key may use `NEXT_PUBLIC_`. Primary and candidate App private keys, GitHub client/state/webhook secrets, OAuth/installation tokens, Supabase service role, DB credentials, and future provider keys stay in environment-scoped secret storage. Candidate configuration is absent-or-complete and cannot reuse primary cryptographic material. Database connection rows hold only non-secret metadata/opaque references.

## Audit and privacy

Important operations append actor, tenant, target, event type, timestamp, request/correlation data, and redacted evidence. Activity events are immutable. Migrations `012`, `014`-`016`, `018`, and `022`-`024` are hosted; webhook payloads and change records deliberately avoid raw credentials and full file bodies.

Hosted migrations `011` and `017` remove direct authenticated writes so narrow audited workflows remain the intended mutation path.

Hosted migration `019` exposes only the SECURITY DEFINER sensitive-JSON wrapper required by provider-ingress CHECK expressions; recursive/text classifiers remain inaccessible. Hosted migration `026` closes the separately discovered default-ACL table-grant drift.

Migrations `020`-`027` are hosted. The pre-`027` matched-history/lint/catalog/browser-grant/ACL evidence passes; `027` adds immutable owner approval/execution and atomically preserved project/history during the live candidate handoff after exact signed-delivery proof. Candidate callback/sync/webhook/read/draft-write acceptance passes. Cross-tenant, anonymous, reverse-handoff, disconnect/loss, and remaining adverse behavior remain pending.

## Supply chain and delivery

- Use the committed lockfile and `npm ci`.
- CI has read-only repository access and no provider/deployment credentials.
- Review dependencies, workflows, migrations, Auth/RLS, and provider-permission changes as protected work.
- Never run untrusted pull-request code with protected secrets.
- Auto approve/merge/deploy/rollback remain OFF.
- The Phase 1D global kill switch is ON, the observation ceiling is GREEN, and the execution worker is **Not Connected**. A `WOULD_BE_ELIGIBLE` observation is never an execution grant.
- Global CSP/security headers deny framing and objects, restrict connections/images/forms/scripts/styles to required sources, and disable camera/microphone/geolocation/payment capabilities. Repository Markdown previews do not fetch external images.

## Incident response

1. Activate the relevant kill/containment path and preserve redacted evidence.
2. Revoke/rotate possibly exposed credentials at GitHub, Supabase, or Vercel.
3. Suspend/disconnect affected installations/projects without deleting audit history.
4. Notify the owner and record the incident.
5. Recover through a verified plan; never assume rollback is safe.
6. Reverify tenant isolation, provider permissions, webhook signatures, and production behavior before reconnecting.
