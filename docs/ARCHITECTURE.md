# Architecture overview

SoftwareFactory is a server-first Next.js control plane. Phase 1B adds authenticated, tenant-scoped GitHub App integration without adding autonomous merge, deployment, rollback, Codex, or Claude execution.

## Components

| Component | Responsibility | Trust level/status |
| --- | --- | --- |
| Browser UI | Present safe state and collect intent | Untrusted client |
| Next.js server | Authenticate, authorize, validate, redact, and coordinate provider operations | Trusted application boundary |
| Supabase Auth/Postgres | Identity, organizations, projects, GitHub metadata, RLS, and audit evidence | Hosted through `026`; local=remote, dry run/lint and exact ACL matrix pass. `service_role` has SELECT/INSERT/UPDATE on four GitHub ingress tables and no table privileges on the other 19; authenticated tenant behavior pending |
| GitHub App adapter | Sign App JWTs, mint repository-scoped installation tokens, normalize provider responses | Latest installation `153442281` is App-JWT verified and repository-scoped. Production callback failed on nonexistent `GET /user/installations/{id}`; bounded list/exact-ID fix is local and unpublished |
| GitHub webhook route | Verify raw-body HMAC, deduplicate delivery IDs, store redacted payloads, reconcile state | Implemented; live delivery not yet verified |
| Vercel | Serve Next.js application and server functions | Current production `dpl_BbcaKQVC6Nh7YQo4rJH6VwTaqm77` is READY at `https://softwarefactory-nd3orq8r6-surgeservices-projects.vercel.app` and stable alias, source `main` `3434387`; callback fix not deployed. Deploy/rollback adapter **Not Connected** |
| AI workers | Future task execution | Codex and Claude **Not Connected** |

## Authenticated request path

1. Supabase Auth resolves the server-side user session.
2. The server resolves the active organization and verifies membership/role.
3. Every interactive GitHub route requires its requested organization, connection, installation, and repository to match that active organization.
4. RLS independently restricts tenant rows.
5. A GitHub request verifies the selected connection and repository remain live for that tenant; removed, archived, disabled, suspended, lost, and disconnected resources are **Not Connected**.
6. The server mints a short-lived installation token scoped to that single repository and the exact requested permissions.
7. GitHub output is size-bounded, schema-validated, normalized, and returned without token material.
8. Mutations reserve an idempotent database record through a caller-authenticated exact project/connection/repository-UUID RPC and append actor-attributed terminal audit evidence. The same browser intent retains its key across ambiguous retries.

Installation synchronization is serialized by external installation ID before connection creation and re-reads the post-upsert installation row as the authoritative tenant/connection binding. Project links persist the immutable tenant-scoped GitHub repository UUID plus the synchronized default branch; repository names are mutable display metadata, and any caller-supplied branch is an optimistic freshness expectation. Project creation also takes a tenant/repository transaction lock, refreshes provider state after the lock, rejects a second non-archived project for that UUID, and allows an intentional relink only after all prior projects for it are archived.

## GitHub installation flow

```text
Authenticated owner/admin
  -> POST /api/github/install/start
  -> signed 10-minute state + HttpOnly nonce cookie
  -> GitHub App installation and user authorization
  -> GET /api/github/install/callback
  -> verify state, user access, App identity, installation, repositories
  -> revoke ephemeral user OAuth token
  -> persist installation/repository metadata and activity evidence
```

The App private key, client secret, state secret, webhook secret, user OAuth token, and installation token never enter application tables or the browser.

## Controlled file-change flow

```text
Open selected repository file at verified ref/SHA
  -> reject likely secrets
  -> for a protected path, require exact active-owner RED phrase + rationale + rollback plan
  -> verify project + connection + default branch
  -> reserve exact intent and immutable protected approval evidence if required
  -> revalidate the exact approval and enter the durable provider boundary
  -> mint the repository-scoped write token only after that boundary
  -> create softwarefactory/* branch from current default-branch SHA
  -> update file using expected blob SHA
  -> create draft pull request
  -> persist commit/PR evidence
```

The route cannot write directly to the default branch, create a non-draft PR, merge, or deploy. A stale file SHA fails closed rather than silently overwriting changes. Protected approval expires within 15 minutes. Its immutable snapshot must match the exact reserved change, requester/approver/executor, path, digest, expected SHA, and branch before it can be attached or used. The change reservation expires after five minutes and may be reclaimed only by the original requester for the exact intent before any provider execution/evidence; entering the persisted provider boundary permanently blocks reclaim. Generic secret-key assignments with real values are rejected even when the value does not match a provider-specific token prefix; deliberate placeholders remain allowed.

There is no HTTP local-repository writer. The removed legacy `/api/files` route and local-write environment switch cannot be used as an alternate path around GitHub's isolated-branch/draft-PR boundary.

## Webhook path

The webhook route reads at most 2 MiB, verifies `X-Hub-Signature-256` over raw bytes, applies an event-specific schema, hashes the full payload, stores only a redacted subset, and deduplicates on the delivery ID. Unknown events and unknown installations are retained as ignored evidence. Hosted migration `013` upserts bounded newly granted repository metadata, `014` keeps exact connection-linked projects aligned, `016` makes installation deletion terminal and provider-ordered, `018` provider-orders repository metadata while preserving terminal deletion until an explicit newer restore, and `021`/`023` attribute project activity through the immutable repository UUID with bounded actor/resource/state/check details. Migration `024` additionally revokes authenticated direct reads from both raw Activity and webhook-delivery tables. The accepted Phase 1B events are documented in [GitHub App integration](GITHUB_APP_INTEGRATION.md).

## Activity read path

`GET /api/activity` requires the active organization and calls the tenant-member `list_activity` RPC through the caller's session. The RPC caps results at 100, trims display fields, and rebuilds evidence only from bounded allowlisted scalar values. Authenticated users have no direct SELECT on `activity_events` or `github_webhook_deliveries`; raw metadata, redacted webhook subsets, nested provider payloads, and unknown fields are deliberately excluded from the browser response. The Activity page labels its separate seeded illustration **Demo Data**.

Agents, commands, tasks, runs, and reports use caller-member, tenant-scoped list RPCs with a maximum of 100 rows and explicit safe columns. Agent capabilities are returned only when their serialized JSON is at most 8 KiB. Authenticated clients have no direct SELECT on those base tables, so input/result payloads, idempotency/provider references, report bodies, and raw run errors do not leak through a broad table grant.

## Data architecture

Migrations `001`-`026` define the hosted control-plane history (with no `006`). Every one of 23 exposed public tables has RLS and FORCE RLS. Post-`026` verification reports zero ACL-matrix mismatches: `service_role` has only SELECT/INSERT/UPDATE on four GitHub ingress tables and no table privileges on the other 19.

Command mutation routes enforce same-origin requests. Global response headers set a restrictive Content Security Policy, deny framing/objects, restrict connections to SoftwareFactory/Supabase, allow images only from self/data/blob/GitHub avatars, and limit other browser capabilities. Repository Markdown previews suppress external images.

## Deployment boundary

Vercel serves the UI and server routes. It does not provide a SoftwareFactory deployment executor. The repository CI validates only and has no merge/deploy permission. Durable AI work cannot rely on a Vercel request lifetime and is deferred to Phase 1C.

See `AI/ARCHITECTURE.md`, `AI/DECISIONS.md`, [Security model](SECURITY_MODEL.md), and the files under `policies/` for deeper contracts.
