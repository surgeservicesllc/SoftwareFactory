# Phase 1B completion scorecard

Scope: the 20-item Phase 1B GitHub control-plane goal. This file scores each
item against the code, migrations, and test output actually present in this
repository, plus the live evidence recorded in `AI/CURRENT_STATE.md`.

Last scored: 2026-08-14, at branch `claude/softwarefactory-repo-connect-cwbdib`, rebased on `main` after it advanced 144 commits.

## Evidence classes

A green UI is not proof. Every item is scored against one of three classes,
and the class is stated explicitly so nothing reads as more proven than it is.

| Class | Meaning |
| --- | --- |
| **LIVE** | Observed against real GitHub with the owner's App/installation. Recorded in `AI/CURRENT_STATE.md`. |
| **TEST** | Proven by automated tests in this repository — real migrations applied to PGlite, or the real route/module under test. Not mocks alone. |
| **CODE** | Present and reviewed in source, but neither exercised live nor covered by a dedicated test. |

## Baseline verified this loop

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npx tsc --noEmit` | PASS |
| `npx vitest run` | PASS — 1712 tests across 152 files on the merged tree |
| `npm run build` | PASS |

## Correction 2026-08-15: Phase 1B *is* connected to Supabase

An earlier session report said "connected to Supabase is false regardless of what else gets
built". That was wrong for Phase 1B, and the error was one of scope: it treated "twelve
migrations are unapplied" as if it meant "the application is not connected". Those are
different claims.

Measured externally against production rather than inferred:

| Page | Status | Content source |
| --- | --- | --- |
| `https://www.theagoras.com/` | 200 | **Supabase** |
| `https://www.theagoras.com/features` | 200 | **Supabase** |
| `https://www.theagoras.com/pricing` | 200 | **Supabase** |

The method is what makes this evidence rather than assertion. `ContentSourceNotice` renders a
**Demo data** banner whenever `source !== "supabase"` and returns `null` otherwise, and it is
wired into each of those pages as `<ContentSourceNotice source={content.source} />`. No banner
appears on any of them, so each is being served from the database. A page that had lost its
Supabase connection would fall back to seeded copy and say so.

**All eleven Phase 1B migrations are hosted** — every one sorts at or below the ledger's
high-water mark of `20260814000200`. So 1B's schema, RLS, and audited workflows are live, and
the production application is reading through them.

Exactly one Phase 1B migration is pending: `20260814001100_harden_github_connection_loss.sql`,
which clears `suspended_at` when an installation moves to `error` and records a loss against a
terminally deleted installation instead of aborting. Both are truthfulness fixes to an existing
path, not the path itself.

So the accurate statement is: **Phase 1B is connected to Supabase and running in production,
with one hardening migration pending.** Not "not connected".

## Does the one pending 1B migration cause a live defect? No — but it is latent

Asked because "one migration pending" and "production is broken" are not the same thing, and the
difference decides whether this is urgent.

`20260814001100_harden_github_connection_loss.sql` fixes three shapes in
`mark_github_connection_lost`. Each requires a specific state to manifest:

| Defect | Manifests when | Currently? |
| --- | --- | --- |
| `suspended_at` left set on a move to `error`, so surfaces keep saying "suspended" after the real evidence was revocation | An installation is revoked or loses permission | **No** — installation `153479019` is healthy |
| A terminally deleted installation aborts the call, and both callers swallow it, so a real discovery is recorded nowhere | A late loss discovery lands against an already-deleted installation | **No** — no terminal deletion has occurred |
| An activity event written against `github_installation` with a null entity id | A GitHub connection exists with no installation row | **No** — the live connection has one |

So the healthy path is production-ready and connected, and none of the three are firing today.

That is not a reason to leave it. Every one of them is an **adverse-path truthfulness** defect —
exactly the thing Phase 1B exists to get right — and each would be wrong the *first* time it
occurred, which is the moment an operator most needs the surface to be accurate. It is latent,
not harmless.

## New blocker found 2026-08-15: GitHub Actions cannot assign a runner

Recorded here because it is not in any other document and it blocks verification of
everything below, not just Phase 1B.

Both required CI jobs now fail **three seconds** after creation with `runner_id: 0` and an
empty `runner_name` — no runner is ever assigned. A `rerun_failed_jobs` reproduced it exactly
(runs `31853623402`, jobs `94934079261` / `94934079132`). The workflow YAML parses and is
unchanged, and the same tree passes every gate locally: lint, typecheck, 1748 tests across 158
files, clean production build.

This is an account-level GitHub Actions problem — most likely exhausted included minutes or a
billing hold — and it corroborates the earlier note that automatic CI had not fired on a pull
request since 2026-08-13 19:32Z.

Why it matters beyond CI: **the Phase 1C live canary runs on GitHub Actions.** Even once the
zero-token Codex subscription credential is configured, no canary can execute until runners are
available again. The two blockers are independent and both must clear.

**Owner action:** open <https://github.com/settings/billing> (or the organization's billing
page) and check Actions minutes and payment status. Verify by re-running any failed job and
confirming it reaches a runner rather than failing in seconds.

## Scorecard

| # | Goal item | Score | Evidence |
| --- | --- | --- | --- |
| 1 | Connect GitHub via the existing App architecture | **PASS** | LIVE: candidate App `4582606` installed as `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`. CODE/TEST: `app/api/github/install/start/route.ts`, `app/api/github/install/callback/route.ts`, signed install state in `lib/github/state.ts`, covered by `tests/unit/github-install-routes.test.ts` and `tests/unit/github-security.test.ts`. |
| 2 | Multiple independent accounts / org installations | **PARTIAL** | TEST: `tests/integration/github-lifecycle-matrix.test.ts` runs two independent installations inside one tenant plus a third in a second tenant, and proves a repository of installation B is unreachable through connection A (`23514`). Schema enforces one installation per connection (`github_installations_connection_unique`) and one organization per provider installation id (`github_installations_external_unique`). **No second live GitHub account/organization installation exists.** See OWNER ACTION REQUIRED. |
| 3 | Sync only the repositories each installation authorizes | **PASS** | LIVE: candidate installation scoped exactly to `surgeservicesllc/SoftwareFactory`. TEST: `sync_github_installation` deselects every repository then reselects only the synchronized set (`supabase/migrations/20260812000900_harden_github_project_and_sync.sql`); asserted by the reconnect case in the lifecycle matrix. |
| 4 | Create and map projects to repositories | **PASS** | LIVE: project `b1f23696-437e-4d89-b55f-d7a949980e8f` linked and later handed off. TEST: `tests/integration/github-project-repository-binding.test.ts`, `tests/integration/github-project-connection-handoff.test.ts`. Links bind the immutable repository UUID, not the name (migration `021`). |
| 5 | Display real repository, branch, commit, PR, and check data | **PASS** | LIVE: recorded in `AI/CURRENT_STATE.md`. CODE: `branches`, `commits`, `pulls`, `checks`, `tree` routes under `app/api/github/repositories/[owner]/[repo]/`. TEST: `tests/unit/github-repository-reads.test.ts`, `tests/unit/github-pulls-route.test.ts`, and the required-surface contract in `tests/integration/github-integration.contract.test.ts`. |
| 6 | Read real files | **PASS** | LIVE: candidate-backed file reads passed. CODE/TEST: `contents` route + `getGitHubFile`, bounded by `MAX_GITHUB_RESPONSE_BYTES`. |
| 7 | Edit files safely | **PASS** | LIVE: draft PR `#8`, commit `204ed79e712cd262a7d631cda0febc7231f042be`. TEST: `tests/unit/github-protected-change-route.test.ts`, `tests/integration/owner-approved-protected-draft-changes.test.ts`. |
| 8 | Detect stale SHA / version conflicts | **PASS** | CODE: `app/api/github/repositories/[owner]/[repo]/changes/route.ts:370` refuses with `409 stale_file` when the live blob SHA differs from the submitted `expectedBlobSha`; the reservation stores that SHA (`reserve_github_change_request`). TEST: covered in `tests/unit/github-protected-change-route.test.ts`. |
| 9 | Save via isolated branch → commit → draft PR, never silently writing main | **PASS** | LIVE: PR `#8` was created as a draft against an isolated branch and closed unmerged. CODE: head branch is `softwarefactory/<timestamp>-<changeId>` (`changes/route.ts:384`); `createGitHubDraftPullRequest` always sends `draft: true`. TEST: `tests/integration/github-integration.contract.test.ts` asserts no merge or default-branch mutation endpoint exists anywhere in the API surface. **Naming note:** the goal text says `factory/*`; the implemented prefix is `softwarefactory/*`. The isolation property is met; the prefix differs. |
| 10 | Verified, idempotent webhooks | **PASS** | LIVE: candidate-signed deliveries processed after sync. TEST: `tests/unit/github-webhook-route.test.ts` covers valid signature, invalid signature rejected before any database access, App/installation ownership mismatch, replayed identical delivery treated as idempotent, and conflicting reuse of a delivery id refused. `github_webhook_deliveries_external_unique` is the durable dedupe key. |
| 11 | Installation and repository add/remove | **PASS (TEST)** | TEST: lifecycle matrix drives `installation_repositories` `removed` → repository deselected → new writes refused (`23514`), then `added` → restored. LIVE add/remove has not been observed. |
| 12 | App suspension, revocation, deletion | **PASS (TEST)** | TEST: lifecycle matrix drives suspend (connection → `error`, message `GitHub installation is suspended.`), a stale out-of-order unsuspend that is correctly ignored, a valid unsuspend that restores service, and `installation.deleted` which is terminal — a later unsuspend records `ignored_terminal_deleted` and a resync of the same id raises `55000`. LIVE suspension has not been observed. |
| 13 | Repository access loss, transfer, archive, delete | **PASS (TEST)** | TEST: lifecycle matrix drives archive → writes refused, unarchive → restored, delete → `disabled`/deselected and terminal, and a later stale edit that must not resurrect it. Rename/transfer is covered by `tests/integration/github-repository-metadata-sync.test.ts`. LIVE has not been observed. |
| 14 | Disconnect safely, preserving history and audit | **PASS (TEST)** | TEST: lifecycle matrix proves a member is refused (`42501`), a stale installation id is refused (`40001`), and a successful owner disconnect leaves connection `disabled` / installation `disconnected` / repositories deselected while `github_change_requests` row count is unchanged and `activity_events` grew. New writes are refused at the trusted boundary afterwards, and the tenant's *other* installation keeps working. LIVE has not been observed. |
| 15 | Reconnect / resync without duplicate or corrupt records | **PASS (TEST)** | TEST: lifecycle matrix resyncs the disconnected installation and asserts `was_created = false`, the same connection and installation UUIDs, and unchanged row counts for connections, installations, repositories, and change requests — then a write succeeds again. |
| 16 | Strict tenant and project isolation with RLS | **PASS** | TEST: `tests/integration/github-rls-behavior.test.ts` (RLS + FORCE RLS, read-only member policy, direct writes denied, anonymous denied) and the lifecycle matrix, which adds owner allowed / unrelated user denied / anonymous denied on `github_installations`, refuses rebinding a provider installation id to a second organization (`42501`), and refuses a tenant-A owner acting inside tenant B (`42501`). Raw `activity_events` and `github_webhook_deliveries` are unreadable by any authenticated caller; Activity is served only by the caller-scoped `list_activity` RPC. |
| 17 | Private keys, tokens, and credentials stay server-side | **PASS** | TEST: `tests/integration/secret-boundaries.contract.test.ts` and the credential contract in `tests/integration/github-integration.contract.test.ts`. Installation tokens are minted per request, scoped to one repository id and explicit permissions (`lib/github/route.ts`), never persisted. Connections store only `env://GITHUB_APP` as a secret reference; `jsonb_has_sensitive_keys` check constraints reject sensitive JSON at the table level. |
| 18 | Connection, sync, write, PR, access-loss, and disconnect events in Activity | **PASS** | LIVE: Activity holds the change request, draft PR `#8`, commit, push delivery, and streamed check statuses. TEST: every lifecycle transition in the matrix writes an `activity_events` row with a `state_transition` marker; `tests/integration/github-webhook-activity-details.test.ts` bounds what is retained. |
| 19 | Truthful Connected / Disconnected / Degraded / Error states | **PASS** | Fixed this loop. `githubRouteErrorResponse` previously collapsed every database refusal into `500 internal_error`, so a stale disconnect, a terminally deleted installation, and a cross-tenant binding were all reported untruthfully. Recognized SQLSTATE codes now map to their real status and message through the shared table in `lib/server/http.ts`; unknown faults stay opaque. TEST: `tests/unit/github-lifecycle-errors.test.ts`. Surface labels are asserted by `tests/unit/connections-console.test.tsx` and `tests/unit/live-dashboard-metrics.test.tsx`. |
| 20 | Real live acceptance tests, not mocks alone | **PARTIAL** | LIVE: the primary owner path — install, callback, sync, signed webhook, handoff, repository/file reads, draft-PR write — is confirmed end to end. The adverse lifecycle (items 11–15) and the second account (item 2) are proven by tests against real migrations, not yet against live GitHub. |

## Score

- PASS: 18 of 20
- PARTIAL: 2 of 20 — items 2 and 20, both blocked on the same missing external resource
- FAIL / BLOCKED: 0

**Phase 1B completion: 90%.** The remaining 10% is not engineering work. It is
one live second GitHub account/organization installation plus a deliberate live
adverse-event run, neither of which can be created from inside this repository.

## Defect fixed this loop

`lib/github/errors.ts` did not recognize PostgREST error objects. A raised RPC
exception is a plain object, not an `Error`, so it fell through every branch to
the generic 500. Three real refusals were affected:

| Refusal | Before | After |
| --- | --- | --- |
| Disconnect with a stale installation id (`40001`) | `500 internal_error` | `409` with `GitHub installation changed; reload before disconnecting` |
| Resync of a terminally deleted installation (`55000`) | `500 internal_error` | `409` with `deleted GitHub installation ids are terminal; use a new provider installation` |
| Installation already bound to another organization (`42501`) | `500 internal_error` | `403` with the real reason |

The client-safe SQLSTATE table now lives in one place, `lib/server/http.ts`, and
is shared with the control-plane routes that already used it. Unrecognized codes
still return an opaque 500, so schema and provider detail cannot leak.

## Second defect fixed: server-discovered connection loss

Extending the matrix to the revocation path exposed two more defects in
`mark_github_connection_lost`, which had not been redefined since migration
`004` and whose behavior was never covered. Migration
`20260814001100_harden_github_connection_loss.sql` fixes both.

| Defect | Effect | Fix |
| --- | --- | --- |
| Moving an installation to `error` left `suspended_at` set | Surfaces kept reporting "The GitHub App installation is suspended." after the real evidence was a revocation or permission loss | Clear the stale marker; preserve the discarded state as activity metadata |
| A terminally deleted installation tripped the terminal trigger | The call aborted, both callers swallow it, so a real discovery was recorded nowhere | Leave the terminal row untouched and still record the loss |
| A connection with no installation row | Activity event written against a null entity id | Attribute the event to the connection instead |

Both were confirmed by running the new cases against the pre-fix function: the
suspension marker survived, and the terminal call raised.

## OWNER ACTION REQUIRED

Both remaining PARTIAL items need the same external resource. Everything that
does not depend on it is complete.

**1. Install the App on a second, independent GitHub account or organization.**

- Service/page: `https://github.com/settings/apps/surge-softwarefactory-next/installations`
- Button: **Install** — choose an account or organization that is *not*
  `surgeservicesllc`
- Field: **Repository access** → *Only select repositories* → pick one
  throwaway repository
- Value type: an installation, not a credential. Nothing secret is produced.
- Where stored: SoftwareFactory records only the installation id, account login,
  and repository metadata in `github_installations` / `github_repositories`. The
  App private key, client secret, and webhook secret are unchanged and remain
  Sensitive in Vercel.
- How I will verify: sign in as that account's owner, complete the install
  callback, and confirm (a) a distinct `connections` row and installation id,
  (b) the repository list contains only that account's selected repository,
  (c) the first account's owner receives 0 rows for the second installation and
  cannot reserve a change against its repository, and (d) Activity in each
  tenant shows only its own events. This closes item 2 and the multi-tenant half
  of item 20.

**2. Run one deliberate live adverse-event pass on the throwaway installation.**

- Service/page: the same installation's settings page
- Actions, in order: remove the repository from the installation → re-add it →
  **Suspend** the installation → **Unsuspend** → **Uninstall**
- Value type: none. No secret is entered or produced.
- How I will verify: after each action, confirm the webhook delivery is recorded
  and processed, the installation/connection status matches the action, the UI
  states the loss truthfully rather than showing stale Connected, and a write
  attempt is refused. After uninstall, confirm the id is terminal and that a
  resync returns the new `409`, not a 500. This closes item 20.

Do **not** run either action against the primary installation `153445938` or the
candidate installation `153479019` — the primary is the rollback boundary and
the candidate is the verified production path.

## 1C readiness

**NO** — and this is a scope statement, not a defect. Phase 1B is at 90% with
two live proofs outstanding, and the current directive explicitly excludes
starting 1C. Readiness should be re-evaluated only after the two owner actions
above are complete and this scorecard reaches 20/20.
