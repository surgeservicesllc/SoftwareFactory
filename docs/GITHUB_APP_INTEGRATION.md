# Production GitHub App integration

Status: **Implemented with a repository-scoped provider installation; in-product connection and webhook remain Not Connected pending authenticated callback and end-to-end verification.**

The GitHub App exists, its server-only values are configured in Vercel, and provider installation `153286187` is installed on `surgeservicesllc` with only `surgeservicesllc/SoftwareFactory` selected. That provider-side fact does not satisfy the product definition of Connected: the installation has not completed the authenticated SoftwareFactory callback, tenant connection persistence, repository synchronization, project linking, file read/change, draft pull request, or webhook acceptance journey.

## Registered App

| Field | Production value/evidence |
| --- | --- |
| Owner | `surgeservicesllc` |
| GitHub App name | `Surge SoftwareFactory` |
| App slug | `surge-softwarefactory` |
| App ID | `4573846` |
| Homepage URL | `https://softwarefactory-tan.vercel.app` |
| Callback URL | `https://softwarefactory-tan.vercel.app/api/github/install/callback` |
| Setup URL | Leave blank; the authenticated installation callback owns setup completion |
| Webhook URL | Required value: `https://softwarefactory-tan.vercel.app/api/github/webhooks`; provider General page currently appears blank/inactive |
| Installation scope | Any account; the installing user chooses repositories in GitHub |
| User authorization during installation | Enabled |
| Expiring user authorization tokens | Enabled |
| Device flow | Disabled |
| Redirect on installation update | Enabled |
| Verified provider installation | `153286187` on `surgeservicesllc` |
| Selected repository scope | Only `surgeservicesllc/SoftwareFactory` |
| Sole remaining App key fingerprint | `SHA256:myJc9wk9wLOrLLSykdd3AL5nIDN948lBxP+Ee7GHYBg=` |

The application webhook route and Vercel secret configuration exist, and the App permissions/events are configured. However, the GitHub App General form remains blank/inactive and App-authenticated hook configuration returns `404` with no hook object. Treat the provider webhook as **Not Connected** until the exact URL is retained as an active hook and a signed delivery is accepted.

## Repository permissions

| Permission | Access | Used for |
| --- | --- | --- |
| Metadata | Read | Required repository/installation identity |
| Contents | Read and write | Tree/file reads and controlled branch commit |
| Pull requests | Read and write | PR visibility and draft PR creation |
| Checks | Read | Check-run visibility |
| Commit statuses | Read | Status events/readiness evidence |
| Actions | Read | Workflow-run visibility |
| Workflows | No access | The standard Phase 1B route cannot modify workflow files |

Organization permissions: none. Account permissions: none. Administration, secrets, deployments, environments, members, and branch-protection write access are not requested.

Subscribed/handled events:

- `check_run`
- `check_suite`
- `installation`
- `installation_repositories`
- `pull_request`
- `push`
- `repository`
- `status`
- `workflow_run`

The route ignores unsupported events safely and records only redacted delivery evidence. Event selection in GitHub must match the permissions above; lifecycle events supplied by GitHub are still validated by the handler.

## Required Vercel variables

All GitHub values are server-only and must use Vercel encrypted/sensitive environment storage. Never add `NEXT_PUBLIC_` aliases.

| Variable | Purpose |
| --- | --- |
| `GITHUB_APP_ID` | Numeric App identity |
| `GITHUB_APP_SLUG` | App installation URL slug |
| `GITHUB_APP_CLIENT_ID` | OAuth client identity |
| `GITHUB_APP_CLIENT_SECRET` | Exchange the callback code; secret |
| `GITHUB_APP_PRIVATE_KEY_BASE64` | Preferred Vercel representation of the PEM private key; secret |
| `GITHUB_APP_PRIVATE_KEY` | Alternative raw/escaped PEM; configure one private-key form, not both |
| `GITHUB_APP_CALLBACK_URL` | Exact callback URL listed above |
| `GITHUB_APP_WEBHOOK_SECRET` | HMAC verification secret; at least 32 bytes |
| `GITHUB_APP_STATE_SECRET` | Installation-state signing secret; at least 32 bytes and distinct from the webhook secret |
| `SUPABASE_SERVICE_ROLE_KEY` | Narrow server-only webhook and audited privileged-RPC client |

The production/preview GitHub variable names are configured in the Vercel project without printing their values. The protected private-key value was rotated to the sole remaining GitHub App key; only its public fingerprint is recorded above. READY deployment `dpl_9oqg94scmdn5X86r7yyrgmsVtmBu` provider-resolves to application SHA `427190d050796e3f5ff5cf6154adc2c34e2e5694` and passes production hosting validation. Production Supabase public/runtime variables are configured. Preview Supabase configuration is not independently verified. None of this changes the in-product GitHub/webhook status from **Not Connected**.

## Connection flow

1. An authenticated organization owner/admin selects **Connect GitHub**.
2. `POST /api/github/install/start` verifies same-origin request, active user, and organization manager role.
3. The server creates signed state valid for ten minutes and sets a Secure/HttpOnly/SameSite=Lax nonce cookie.
4. The browser follows the returned GitHub installation URL.
5. GitHub returns `code`, `installation_id`, and signed `state` to the callback.
6. The callback verifies user/session/state/nonce/role, exchanges the one-time code, verifies that user can access the installation and that it belongs to this App, then reads installation/repository state using an App installation token.
7. The ephemeral user OAuth token is never persisted or returned and is revoked best-effort after verification.
8. An audited database workflow serializes by external installation ID before first-or-existing connection creation, re-resolves the authoritative installation binding after upsert, stores only installation/account/repository metadata, and updates the provider-neutral connection.
9. The UI displays Connected only when the connection and installation are both active.

Cancellation, organization-approval pending, wrong App, expired/mismatched state, revoked installation, insufficient permission, rate limit, provider outage, and malformed responses fail closed with safe error codes.

## Server routes

| Route | Purpose |
| --- | --- |
| `POST /api/github/install/start` | Begin owner/admin installation with signed state |
| `GET /api/github/install/callback` | Verify installation and synchronize metadata |
| `GET /api/github/connections` | Tenant-scoped connection/install/repository status |
| `POST /api/github/connections/:id/sync` | Owner/admin reconciliation with live GitHub state |
| `POST /api/github/connections/:id/disconnect` | Exact-confirmation disconnect while preserving history |
| `GET /api/github/repositories` | Selected repositories for a connection |
| `GET /api/github/repositories/:owner/:repo/branches` | Branches and protection visibility |
| `GET /api/github/repositories/:owner/:repo/commits` | Commit history, optionally path-scoped |
| `GET /api/github/repositories/:owner/:repo/pulls` | Pull request visibility |
| `GET /api/github/repositories/:owner/:repo/checks` | Check runs for a ref |
| `GET /api/github/repositories/:owner/:repo/tree` | Directory listing at a ref |
| `GET /api/github/repositories/:owner/:repo/contents` | UTF-8 file read with SHA; 1 MiB maximum |
| `POST /api/github/repositories/:owner/:repo/changes` | Guarded branch + commit + draft PR transaction |
| `POST /api/github/webhooks` | Signed, bounded, idempotent webhook ingestion |

Every repository request checks the authenticated tenant connection and selected repository before minting a short-lived token scoped to the repository ID and exact read/write permissions required by that route.

## Database records

Migration `20260812000400_github_integration.sql` adds:

- `github_installations` — non-secret installation/account/permission/status metadata;
- `github_repositories` — selected repository/default-branch/visibility/sync metadata;
- `github_webhook_deliveries` — delivery ID, payload hash, redacted payload subset, processing state;
- `github_change_requests` — idempotency reservation and branch/commit/draft-PR evidence.

Migration `20260812000700_github_project_linking.sql` adds a transactional function that creates a safe-default project only from an active, selected, non-archived repository belonging to the caller's organization and primary GitHub connection.

Migration `20260812000800_fix_github_sync_ambiguity.sql` additively repairs qualified-column/conflict-target ambiguity. Migration `20260812000900_harden_github_project_and_sync.sql` serializes synchronization by external installation ID, treats the post-upsert installation row as the authoritative tenant/connection binding, and persists only the synchronized GitHub default branch when linking a project. A caller-supplied branch is only a freshness expectation; stale provider state fails closed.

Local forward migrations `011`-`019` form one unhosted hardening chain. `011`-`013` close initial direct mutation paths, add actor-attributed terminal evidence, and reconcile newly granted repositories. `014` propagates a provider-authoritative rename/default branch only to exact connection-linked projects. `015` recovers a provider-created draft PR after an ambiguous completion response. `016` makes installation deletion terminal and orders installation lifecycle changes by provider time. `017` closes remaining direct authenticated connection/project/link/change-request writes and reserves exact live change intent through an authenticated RPC. `018` orders repository events by provider time and preserves terminal repository deletion until an explicit newer restore, which remains unselected pending access synchronization. `019` grants service role only the SECURITY DEFINER sensitive-JSON wrapper required when provider-ingress table CHECK constraints run, while leaving recursive and text classifiers inaccessible. None is hosted; exact owner approval and complete post-apply verification are required before production claims use them.

All four GitHub tables use RLS and FORCE RLS. Browser-facing clients never receive service-role credentials, App private keys, webhook/state/client secrets, OAuth tokens, or installation tokens.

## Controlled file edits

The standard editor requires an owner/admin, an active project-to-connection mapping, the verified synchronized repository default branch, the expected blob SHA, a bounded idempotency key, and content that passes sensitive-data checks. Normalized repository full names are matched literally in application code, never through SQL `ILIKE` wildcard semantics.

It refuses:

- direct default-branch writes;
- non-draft or merge operations;
- archived/disabled/unselected repositories;
- stale SHA overwrites;
- files larger than 1 MiB or binary/non-UTF-8 files;
- repository control/memory (`.github/**`, `CODEOWNERS`, `AGENTS.md`, `CLAUDE.md`, `AI/**`, `policies/**`);
- all Supabase paths, every `app/api/**` route, server-side GitHub/Supabase libraries, Auth/session boundaries, and root proxy/middleware;
- deployment, environment, and infrastructure controls such as `.env*`, `.vercel/**`, `vercel.json`, Docker/Compose, Terraform, and common platform manifests;
- security-sensitive subject paths whose names identify authorization, permissions, roles, RLS, sessions/cookies, cryptography/encryption, secrets/credentials/private keys, webhooks, deployments/releases/rollback, DNS, or billing; and
- likely credentials in content, title, or commit message.

Successful writes create `softwarefactory/*` branch state, commit to that branch, open a draft pull request, and persist redacted audit evidence. Browser retries reuse the same idempotency key while the save intent is unchanged. If GitHub created the draft PR but database completion was ambiguous, the server can complete that same reserved request from bounded provider evidence rather than creating another PR. Nothing is merged or deployed.

## Webhook guarantees

- Verify HMAC-SHA256 over the unparsed body with constant-time comparison.
- Reject missing/invalid signatures and bodies over 2 MiB.
- Require syntactically valid GitHub delivery/event headers.
- Apply an event-specific schema before reconciliation; accepted `installation_repositories` additions require full bounded repository metadata.
- Deduplicate by delivery ID; reject reuse of an ID with different payload bytes.
- Store a SHA-256 hash plus an allowlisted/redacted payload subset, not the raw payload.
- Mark revoked/suspended installation or repository-selection changes in control-plane state through audited database functions.
- After migration `013` is hosted, upsert newly granted repository metadata through its service-role-only RPC before recording the repository-selection reconciliation.
- After migrations `014`, `016`, and `018` are hosted, propagate repository rename/default-branch metadata only through the exact linked connection; order installation/repository transitions by provider timestamps; keep deletion terminal; and audit ignored stale or terminal events.
- Return quickly; Phase 1B performs bounded reconciliation only and never starts an AI worker.

## Production acceptance checklist

Do not change GitHub from **Not Connected** until all items are observed against the real service:

- [ ] Production release contains the current routes and migrations.
- [ ] GitHub App webhook endpoint visibly retains the exact URL and is active (currently appears blank/inactive); a signed delivery is accepted.
- [ ] An authenticated SoftwareFactory owner/admin starts the installation flow.
- [x] GitHub provider installation `153286187` is installed on `surgeservicesllc` with only `surgeservicesllc/SoftwareFactory` selected.
- [ ] Callback verifies the installation and returns to Connections.
- [ ] Connection shows the real account, installation ID, repository count, and fresh sync time.
- [ ] Manual sync handles success and revoked/insufficient-permission failure.
- [ ] A project links transactionally to a selected repository and the synchronized default branch; a stale branch expectation fails closed.
- [ ] Dashboard count derives from the live tenant records.
- [ ] Projects displays real branches, commits, pull requests, and checks.
- [ ] Files reads a real repository file and its SHA.
- [ ] A safe test edit creates only a controlled branch, commit, and draft PR.
- [ ] A stale SHA, SQL-wildcard-like repository name, and representative paths from every protected-resource class fail closed.
- [ ] Pull request/webhook updates reconcile and create immutable activity evidence.
- [ ] Delayed installation/repository events are ignored by provider time, deleted installation IDs stay terminal, and a newer explicit repository restore remains unselected until access sync.
- [ ] Disconnect requires exact confirmation, removes active linkage, and preserves history.

## Troubleshooting

- **`github_not_configured`:** one or more server-only variables are absent/invalid. Do not log values.
- **State invalid/expired:** restart the installation from SoftwareFactory; do not reuse the callback URL.
- **Awaiting organization approval:** an organization owner must approve the App in GitHub; SoftwareFactory remains **Not Connected**.
- **Connection lost:** check installation revocation/suspension, selected repositories, and current permissions; then reconnect or sync.
- **Permission denied:** compare the exact App settings above. Do not add administration/workflow permissions as a shortcut.
- **Rate limited/provider unavailable:** preserve existing metadata, show the safe error, and retry only after the provider allows it.
- **Webhook blank/inactive or App-auth configuration `404`:** no hook object currently exists. Enter the exact production endpoint, enable Active, save, reload the General page, and confirm it remains visible/available through App authentication before sending or observing a delivery.
- **Webhook rejected:** confirm the retained endpoint, active setting, event, delivery ID, body size, and that GitHub/Vercel hold the same webhook secret without printing it.
- **Stale SHA conflict:** reload the file from GitHub and reapply the intended edit; never force overwrite.
