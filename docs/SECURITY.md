# Security guide

SoftwareFactory treats the browser, repository content, GitHub responses/webhooks, Supabase rows, and future model output as untrusted. Next.js server code is the application authorization boundary; Supabase RLS is an independent tenant boundary.

## Non-negotiable rules

- App private keys, client/state/webhook secrets, OAuth/installation tokens, service-role keys, passwords, and database credentials never enter browser code, props, logs, source maps, database rows, fixtures, reports, screenshots, or source control.
- Every sensitive request authenticates the user and verifies active organization membership, connection, selected repository, and operation-specific role on the server.
- RLS and FORCE RLS remain enabled on every exposed table; test allowed access plus cross-tenant and anonymous denial.
- GitHub installation tokens are short-lived and scoped to the one repository ID and exact permissions required by the route.
- Webhooks are bounded, raw-body HMAC verified, delivery-ID deduplicated, schema validated, and stored only as hashes/redacted subsets.
- Ordinary file mutations require an expected blob SHA, verified default branch, stable project/connection/repository-UUID mapping, idempotency key, owner/admin role, and draft PR outcome.
- Protected paths require an active owner, exact path-bound RED phrase, rationale, rollback plan, immutable approval evidence matching the exact reserved change, and an unexpired reservation/decision. The durable provider boundary is recorded and revalidated before any write-scoped token is minted. Admin-only, unapproved, expired, post-execution, or mismatched requests fail closed.
- Likely secretsâ€”including non-placeholder values assigned to generic secret-bearing keysâ€”direct default-branch writes, non-draft PRs, merges, deployments, archived/disabled repositories, and lease reclamation after provider execution/evidence always fail closed.
- Browser list reads use bounded safe-projection RPCs instead of broad authenticated base-table SELECT. Authenticated direct reads of raw Activity and webhook-delivery tables are revoked; `list_activity` returns only bounded allowlisted evidence. Command mutation is same-origin, and global CSP/security headers constrain resource loading.
- Important provider/database state transitions create append-only, redacted activity evidence.
- RED actions require exact, current owner approval; Phase 1B never auto-merges or auto-deploys.

## Privileged service-role boundary

The service-role client is restricted to server-only GitHub webhook/synchronization and audited privileged RPC operations. Those RPCs still validate actor/tenant/resource identifiers and restrict grants. Interactive reads and project/Auth operations use the caller's session and RLS. Never move service-role access into a Client Component or use it to bypass a policy failure.

## Current verification limits

Hosted Supabase is current through migration `026`; local and remote match, dry run/lint are clean, all 23 public tables have RLS and FORCE RLS, and the exact service-role ACL matrix has zero mismatches. `surgeservicesllc@gmail.com` is confirmed/authenticated and owner onboarding succeeded. Latest installation `153442281` is App-JWT verified and repository-scoped, but production callback failed on nonexistent `GET /user/installations/{id}`; the bounded documented list/exact-ID fix is local and unpublished. The webhook remains blank/inactive, so GitHub remains **Not Connected**.

See [Security model](SECURITY_MODEL.md), [Environment variables](ENVIRONMENT_VARIABLES.md), [GitHub App integration](GITHUB_APP_INTEGRATION.md), and `policies/PROTECTED_RESOURCES.md`. Report vulnerabilities through the private process in the repository-root `SECURITY.md`.
