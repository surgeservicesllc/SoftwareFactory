# Security guide

SoftwareFactory treats the browser, repository content, GitHub responses/webhooks, Supabase rows, and future model output as untrusted. Next.js server code is the application authorization boundary; Supabase RLS is an independent tenant boundary.

## Non-negotiable rules

- App private keys, client/state/webhook secrets, OAuth/installation tokens, service-role keys, passwords, and database credentials never enter browser code, props, logs, source maps, database rows, fixtures, reports, screenshots, or source control.
- Every sensitive request authenticates the user and verifies active organization membership, connection, selected repository, and operation-specific role on the server.
- RLS and FORCE RLS remain enabled on every exposed table; test allowed access plus cross-tenant and anonymous denial.
- GitHub installation tokens are short-lived and scoped to the one repository ID and exact permissions required by the route.
- Webhooks are bounded, raw-body HMAC verified, delivery-ID deduplicated, schema validated, and stored only as hashes/redacted subsets.
- Standard file mutations require a safe path, expected blob SHA, verified default branch, project/connection mapping, idempotency key, owner/admin role, and draft PR outcome.
- Protected paths—including repository memory/policies, Supabase, all application APIs, server-side GitHub/Supabase code, Auth/session boundaries, and deployment/environment/infrastructure controls—plus likely secrets, direct default-branch writes, non-draft PRs, merges, deployments, and archived/disabled repositories fail closed.
- Important provider/database state transitions create append-only, redacted activity evidence.
- RED actions require exact, current owner approval; Phase 1B never auto-merges or auto-deploys.

## Privileged service-role boundary

The service-role client is restricted to server-only GitHub webhook/synchronization and audited privileged RPC operations. Those RPCs still validate actor/tenant/resource identifiers and restrict grants. Interactive reads and project/Auth operations use the caller's session and RLS. Never move service-role access into a Client Component or use it to bypass a policy failure.

## Current verification limits

Current lint/typecheck, full Vitest (38 files/263 tests), coverage (66.08% statements, 65.13% branches, 58.62% functions, 67.16% lines with required risk/constants thresholds), the full-chain RLS behavioral matrix (5/5 through migration `019`), the 34-route production build, local Playwright (12/12 desktop/tablet/mobile including axe), and source/client secret gates pass. Tracked and untracked non-fixture source contains no credential/private-key marker; only explicit fake detector fixtures in `github-repository-grants` and `github-rls-behavior` matched; rebuilt `.next/static` contains no privileged environment name, key marker, or `service_role` marker. Hosted migrations remain through `010`; local authorization/audit/reservation/recovery/metadata-ordering/CHECK-helper migrations `011`-`019` are not hosted and require exact owner approval plus complete post-apply verification. Migration `010` passed hosted fail-closed default/constraint/data/grant checks, while the last clean linked public-schema lint is through `009`; a post-`010` CLI attempt received account `403`, so no later hosted lint result is claimed. GitHub provider installation `153286187` is restricted to `surgeservicesllc/SoftwareFactory`, but the authenticated in-product callback, tenant connection, webhook, and file-to-draft-PR journey have not passed. The provider General form is blank/inactive and App-authenticated hook configuration returns `404`/no hook object, so GitHub remains **Not Connected** in SoftwareFactory.

See [Security model](SECURITY_MODEL.md), [Environment variables](ENVIRONMENT_VARIABLES.md), [GitHub App integration](GITHUB_APP_INTEGRATION.md), and `policies/PROTECTED_RESOURCES.md`. Report vulnerabilities through the private process in the repository-root `SECURITY.md`.
