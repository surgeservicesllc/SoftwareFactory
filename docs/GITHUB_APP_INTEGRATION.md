# Production GitHub App integration

Status: **The owner repository connection and draft-only file-change path are live; the provider webhook remains Not Connected and Phase 1B acceptance is incomplete.**

The GitHub App exists, its server-only values are configured in Vercel, and installation `153445938` completed the authenticated production callback for owner `surgeservicesllc@gmail.com`. It is connected to `surgeservicesllc` with exactly `surgeservicesllc/SoftwareFactory` selected. Connection `d17c63a9-d995-481e-98ce-b737efb32ce5` and project `b1f23696-437e-4d89-b55f-d7a949980e8f` drive verified live Connections, Projects, Files, and Activity views. The webhook is a separate boundary and remains **Not Connected**.

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
| Verified provider installation | Personal `surgeservicesllc` installation `153445938` |
| Selected repository scope | Only `surgeservicesllc/SoftwareFactory` |

The application webhook route and Vercel secret configuration exist, and a GitHub App JWT validates App `4573846`. The webhook secret was freshly rotated in Sensitive Production and Preview scopes and the exact `0bd0485` artifact was redeployed. The documented App-JWT `PATCH /app/hook/config` still returns `404`; the normal owner UI reports that the exact URL/secret/Active update succeeded, but a reload is blank/inactive again. An invalid signature returns `401` with private no-store behavior, but no valid signed delivery exists. Treat the provider webhook as **Not Connected** until the exact URL is retained as an active hook and a signed delivery is accepted.

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
| `GITHUB_COMMIT_IDENTITY_NAME` | Server-owned name used for both author and committer on every controlled file commit |
| `GITHUB_COMMIT_IDENTITY_EMAIL` | Server-owned email used for both author and committer on every controlled file commit |
| `SUPABASE_SERVICE_ROLE_KEY` | Narrow server-only webhook and audited privileged-RPC client |

The exact Vercel project `surgeservices-projects/softwarefactory` is linked. Current production `dpl_AEirYPnCrKemJjiFX7bKGc7626jX` is READY at `https://softwarefactory-fa4gc8jfm-surgeservices-projects.vercel.app` and the stable alias, sourced from exact `main` application commit `0bd048565a9e002848c5553ccbe43ab0e217780e` after the webhook-secret rotation. The callback fix and explicit commit-identity boundary are deployed. The webhook remains blank/inactive and **Not Connected**.

The two commit-identity values are configuration, not request fields. They are configured in Vercel Production and Preview for the owner-approved public identity `surgeservicesllc <surgeservicesllc@gmail.com>`, stay in server-only environment storage, are never returned to the browser, persisted in Supabase, or logged, and have no authenticated-App fallback. Before authorization or persistence, the change route requires a bounded name and syntactically valid email. The Contents API request then supplies that same identity in both `author` and `committer`; missing or invalid configuration returns the safe `github_not_configured` response before any database or provider side effect.

## Connection flow

1. An authenticated organization owner/admin selects **Connect GitHub**.
2. `POST /api/github/install/start` verifies same-origin request, active user, and organization manager role.
3. The server creates signed state valid for ten minutes and sets a Secure/HttpOnly/SameSite=Lax nonce cookie.
4. The browser follows the returned GitHub installation URL.
5. GitHub returns `code`, `installation_id`, and signed `state` to the callback.
6. The callback verifies user/session/state/nonce/role, exchanges the one-time code, lists the user's installations through bounded documented `GET /user/installations`, selects the exact returned installation ID, verifies it belongs to this App, then reads repository state using an App installation token. This corrected flow is deployed and passed for installation `153445938`.
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

Repository migrations `011`-`026` are hosted; local and remote match, dry run/lint are clean, and prior RLS/catalog/browser-grant checks pass. The exact post-`026` ACL matrix has zero mismatches: `service_role` has only SELECT/INSERT/UPDATE on the four GitHub ingress tables and no table privileges on the other 19.

All exposed GitHub integration tables, including the protected-approval table added by `022`, use RLS and FORCE RLS. Browser-facing clients never receive service-role credentials, App private keys, webhook/state/client secrets, OAuth tokens, or installation tokens.

## Controlled file edits

The ordinary editor requires an owner/admin, an active project-to-connection mapping bound to the immutable tenant-scoped repository UUID, the verified synchronized repository default branch, the expected blob SHA, a bounded idempotency key, and content that passes sensitive-data checks. Repository full names remain normalized display/freshness metadata; they are not the authorization key.

It refuses:

- direct default-branch writes;
- non-draft or merge operations;
- archived/disabled/unselected repositories;
- stale SHA overwrites;
- files larger than 1 MiB or binary/non-UTF-8 files;
- unapproved protected resources, including repository control/memory, Supabase, every application API, server-side GitHub/Supabase code, Auth/session boundaries, deployment/environment/infrastructure controls, and security-sensitive subject paths;
- likely credentials in content, title, or commit message.

For a protected path, the route first returns an approval-required response. Only an active organization owner may continue, and only by providing the exact `APPROVE RED DRAFT PR FOR <path>` phrase, a 20-500 character rationale, and a 20-500 character rollback plan. Migrations `022`/`025` atomically bind immutable approval evidence to the exact reserved change, requester/approver/executor, organization/project/connection/repository UUID, path, content digest, expected blob SHA, base branch, and a maximum 15-minute expiry before provider execution. Admin-only, expired, mismatched, post-execution, or secret-bearing approval attempts fail closed. Generic secret-key assignments with non-placeholder values are blocked even when the value lacks a provider-specific token prefix.

Successful ordinary or approved protected writes create `softwarefactory/*` branch state, commit to that branch with the explicitly configured deployment identity as both author and committer, open a draft pull request, and persist redacted audit evidence. Browser retries reuse the same idempotency key while the save intent is unchanged. A reservation expires after five minutes and is reclaimable only by its original requester for the exact immutable intent before any provider execution/evidence; the server persists and revalidates entry into the provider boundary before minting the write-scoped installation token or contacting GitHub. If GitHub created the draft PR but database completion was ambiguous, the server can complete that same reserved request from bounded provider evidence rather than creating another PR. Nothing writes the default branch, merges, or deploys.

Live acceptance created ordinary draft PR `#6` (commit `e789303`) and owner-approved protected RED draft PR `#7` (commit `6a808de`). Both are open, draft, and unmerged, and both expose `surgeservicesllc <surgeservicesllc@gmail.com>` as author and committer. Earlier acceptance PRs `#4` and `#5` revealed an App-bot attribution mismatch; both were closed unmerged and their isolated branches were deleted before the explicit identity fix was accepted. A fake generic password assignment was rejected before any PR was created.

## Webhook guarantees

- Verify HMAC-SHA256 over the unparsed body with constant-time comparison.
- Reject missing/invalid signatures and bodies over 2 MiB.
- Require syntactically valid GitHub delivery/event headers.
- Apply an event-specific schema before reconciliation; accepted `installation_repositories` additions require full bounded repository metadata.
- Deduplicate by delivery ID; reject reuse of an ID with different payload bytes.
- Store a SHA-256 hash plus an allowlisted/redacted payload subset, not the raw payload.
- Mark revoked/suspended installation or repository-selection changes in control-plane state through audited database functions.
- Hosted migration `013` supports service-role-only reconciliation of newly granted repository metadata after signature and tenant validation.
- Hosted migrations `014`, `016`, and `018` propagate exact linked metadata, order transitions by provider time, preserve terminal deletion, and audit stale/terminal outcomes.
- Hosted migrations `021`, `023`, and `024` use immutable repository identity and bounded `list_activity`; authenticated browser sessions cannot directly read raw Activity or webhook evidence.
- Return quickly; Phase 1B performs bounded reconciliation only and never starts an AI worker.

## Production acceptance checklist

Checked items below establish the Connected owner repository path. Do not mark the webhook Connected or Phase 1B complete until every remaining item is observed against the real service:

- [x] Production release contains the current routes and migrations.
- [ ] GitHub App webhook endpoint visibly retains the exact URL and is active (currently appears blank/inactive); a signed delivery is accepted.
- [x] An authenticated SoftwareFactory owner starts the installation flow.
- [x] GitHub provider installation `153445938` is connected to `surgeservicesllc` with only `surgeservicesllc/SoftwareFactory` selected.
- [x] Callback verifies the installation and returns to Connections.
- [x] Connection shows the real account, installation ID, repository-selection mode, repository count, and fresh sync time.
- [ ] Manual sync handles success and revoked/insufficient-permission failure.
- [x] Project `b1f23696-437e-4d89-b55f-d7a949980e8f` links to the selected repository through the live connection and synchronized `main` branch.
- [ ] Concurrent duplicate active links and stale branch expectations fail closed, while relink after archival succeeds, in live acceptance; local tests cover these cases.
- [ ] Dashboard connected-project count is separately rechecked from live tenant records; the live Projects view itself is verified.
- [x] Projects displays real repository sync freshness, branch protection/SHA, commits with authors/dates, pull requests with authors/created/updated times and detail-fetched mergeability, default-branch checks, and checks for each displayed PR head SHA.
- [x] Files reads the real repository tree, `README.md`, and its SHA.
- [x] A safe test edit creates only a controlled branch, commit, and draft PR (`#6`), with the approved author and committer.
- [ ] A stale SHA, renamed/same-name repository mismatch, unapproved/admin protected request, expired/mismatched owner approval, and invalid/expired/after-provider reservation reclaim all fail closed in live acceptance.
- [x] Likely-secret content is rejected before provider mutation.
- [x] One exact owner-approved protected-file test creates only an isolated branch, commit, and draft PR (`#7`), with immutable approval/execution evidence and no merge/deploy/default-branch write.
- [x] Connection, project, ordinary change, protected approval, provider-boundary, and draft-PR transitions create immutable Activity evidence.
- [ ] Pull-request webhook updates reconcile through a valid signed delivery.
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
- **Commit identity unavailable:** configure both server-only commit-identity variables with the exact approved deployment identity, redeploy, and verify both author and committer on a new draft-PR commit without printing the values in logs.
- **Stale SHA conflict:** reload the file from GitHub and reapply the intended edit; never force overwrite.
