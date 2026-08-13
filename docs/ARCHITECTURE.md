# Architecture overview

SoftwareFactory is a server-first Next.js control plane. Phase 1B adds authenticated, tenant-scoped GitHub App integration without adding autonomous merge, deployment, rollback, Codex, or Claude execution.

## Components

| Component | Responsibility | Trust level/status |
| --- | --- | --- |
| Browser UI | Present safe state and collect intent | Untrusted client |
| Next.js server | Authenticate, authorize, validate, redact, and coordinate provider operations | Trusted application boundary |
| Supabase Auth/Postgres | Identity, organizations, projects, GitHub metadata, RLS, and audit evidence | Hosted through `027`; live owner handoff passes; live second-tenant matrix remains pending |
| GitHub App adapter | Sign App JWTs, mint repository-scoped installation tokens, normalize provider responses | Candidate installation `153479019` is live for exactly `surgeservicesllc/SoftwareFactory`; primary `153445938` remains active rollback |
| GitHub webhook route | Verify raw-body HMAC, bind signing App provenance, deduplicate delivery IDs, store redacted payloads, reconcile state | Candidate-signed post-sync, push, and check deliveries process; primary webhook remains impaired |
| Vercel | Serve Next.js application and server functions | Production `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ` is READY at `https://softwarefactory-7kfx3u1ey-surgeservices-projects.vercel.app` and stable alias, source main commit `799d2cea189b6860a03987ae75c25765f9ac4aca`. Deploy/rollback adapter **Not Connected** |
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
  -> signed 10-minute state bound to App slot + App ID + HttpOnly nonce cookie
  -> exact GitHub App installation and user authorization
  -> GET /api/github/install/callback
  -> verify state, user access, App identity, installation, repositories
  -> revoke ephemeral user OAuth token
  -> persist installation/repository metadata and activity evidence
```

Primary and candidate App private keys, client/state/webhook secrets, user OAuth tokens, and installation tokens never enter application tables or the browser. Candidate configuration is complete-or-absent and must be cryptographically distinct. Repository token routing follows the persisted installation App ID.

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

The webhook route reads at most 2 MiB, verifies `X-Hub-Signature-256` over raw bytes, applies an event-specific schema, hashes the full payload, stores only a redacted subset, and deduplicates on the delivery ID. It matches either isolated App secret and rejects a signing-App ID that disagrees with the persisted installation App ID. Candidate installation `153479019` has processed signed production deliveries. Unknown events and installations are ignored safely. The accepted Phase 1B events are documented in [GitHub App integration](GITHUB_APP_INTEGRATION.md).

## Activity read path

`GET /api/activity` requires the active organization and calls the tenant-member `list_activity` RPC through the caller's session. The RPC caps results at 100, trims display fields, and rebuilds evidence only from bounded allowlisted scalar values. Authenticated users have no direct SELECT on `activity_events` or `github_webhook_deliveries`; raw metadata, redacted webhook subsets, nested provider payloads, and unknown fields are deliberately excluded from the browser response. The Activity page labels its separate seeded illustration **Demo Data**.

Agents, commands, tasks, runs, and reports use caller-member, tenant-scoped list RPCs with a maximum of 100 rows and explicit safe columns. Agent capabilities are returned only when their serialized JSON is at most 8 KiB. Authenticated clients have no direct SELECT on those base tables, so input/result payloads, idempotency/provider references, report bodies, and raw run errors do not leak through a broad table grant.

## Data architecture

Migrations `001`-`027` define the hosted control-plane history (with no `006`). The verified pre-`027` baseline has 23/23 RLS+FORCE tables and zero service-role ACL mismatches. Hosted `027` adds two RLS/FORCE-RLS evidence tables and atomically rebinds a project to a verified same-account/repository installation after a fresh signed delivery. Its live handoff preserved project/history and retained the primary rollback path.

Command mutation routes enforce same-origin requests. Global response headers set a restrictive Content Security Policy, deny framing/objects, restrict connections to SoftwareFactory/Supabase, allow images only from self/data/blob/GitHub avatars, and limit other browser capabilities. Repository Markdown previews suppress external images.

## Deployment boundary

Vercel serves the UI and server routes. It does not provide a SoftwareFactory deployment executor. The repository CI validates only and has no merge/deploy permission. Durable AI work cannot rely on a Vercel request lifetime and is deferred to Phase 1C.

See `AI/ARCHITECTURE.md`, `AI/DECISIONS.md`, [Security model](SECURITY_MODEL.md), and the files under `policies/` for deeper contracts.
