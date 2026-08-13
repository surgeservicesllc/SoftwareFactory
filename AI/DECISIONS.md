# Architecture decision log

Use this append-only log for decisions that constrain future implementation. Change a decision by adding a superseding entry, not silently rewriting history.

## ADR-001 — Control plane before autonomous execution

- Date: 2026-08-12
- Status: Accepted
- Decision: Phase 1A builds state, policy, audit, and interface foundations only. It does not execute unrestricted production changes.
- Consequence: Commands may be persisted as queued intent while workers remain **Not Connected**.

## ADR-002 — Next.js App Router on Vercel-compatible infrastructure

- Date: 2026-08-12
- Status: Accepted
- Decision: Use the current repository-pinned Next.js, TypeScript, App Router, and Tailwind CSS. Prefer Server Components and narrow Client Component boundaries.
- Consequence: Agents must consult version-matched documentation under `node_modules/next/dist/docs/` before framework work.

## ADR-003 — Supabase as control-plane persistence

- Date: 2026-08-12
- Status: Accepted
- Decision: Use Supabase Postgres/Auth with UUID identifiers, tenant ownership, foreign keys, indexes, status constraints/enums, and RLS.
- Consequence: RLS cannot be disabled for convenience; service-role access is restricted to trusted server operations and does not replace authorization.

## ADR-004 — Separate projects, connections, agents, and users

- Date: 2026-08-12
- Status: Accepted
- Decision: A provider connection is a reusable authorization abstraction associated with projects through an explicit join. An agent is a role/capability definition, not a provider account.
- Consequence: Domain records do not embed provider logins or plaintext secrets.

## ADR-005 — Server-side secret references

- Date: 2026-08-12
- Status: Accepted
- Decision: Privileged provider credentials live in server-side environment/secret infrastructure. Database connection records may store only non-secret metadata and an opaque secret reference.
- Consequence: `NEXT_PUBLIC_` variables must never contain privileged credentials; logs and audit payloads are redacted.

## ADR-006 — Explicit risk tiers and protected resources

- Date: 2026-08-12
- Status: Accepted
- Decision: Classify actions GREEN, YELLOW, or RED using impact, reversibility, blast radius, and resource sensitivity. The most severe applicable criterion wins.
- Consequence: RED requires owner approval in Phase 1. Controls default OFF and protected resources tighten eligibility.

## ADR-007 — Audit state transitions

- Date: 2026-08-12
- Status: Accepted
- Decision: Important control-plane changes create append-only activity events with actor, organization, target, event type, timestamp, request/correlation identifier, and redacted metadata.
- Consequence: Operational dashboards and reports should derive claims from auditable records, not UI-only state.

## ADR-008 — No Phase 1A auto-merge or auto-deploy workflow

- Date: 2026-08-12
- Status: Accepted
- Decision: CI validates changes but does not merge pull requests or deploy production.
- Consequence: Future automation requires a separate decision, policy prerequisites, branch protections, validation evidence, and an owner-controlled rollout.

## ADR-009 — Demo truthfulness is a data contract

- Date: 2026-08-12
- Status: Accepted
- Decision: Seeded/static values are labeled **Demo Data**, and absent live integrations are labeled **Not Connected**.
- Consequence: Removing those labels requires live-source, freshness, and failure-state evidence.

## ADR-010 — Use a GitHub App with repository-scoped short-lived tokens

- Date: 2026-08-12
- Status: Accepted
- Decision: Phase 1B authenticates repository operations through a GitHub App. The server signs bounded App JWTs and mints short-lived installation tokens restricted to the selected repository ID and exact per-route permissions. Personal access tokens are not the application integration model.
- Consequence: App private keys, client/state/webhook secrets, OAuth tokens, and installation tokens stay server-only and out of database rows. A configured App is still **Not Connected** until its real installation and failure paths are verified.

## ADR-011 — GitHub file saves create an isolated branch and draft pull request

- Date: 2026-08-12
- Status: Accepted
- Decision: The standard Phase 1B repository write flow verifies tenant/project/repository/default branch, rejects protected paths and likely secrets, requires the expected blob SHA and an idempotency key, then creates a `softwarefactory/*` branch, commit, and open draft PR.
- Consequence: The route cannot write directly to the default branch, silently overwrite stale content, create a non-draft PR, merge, modify workflows/protected paths, or deploy.

## ADR-012 — Webhook ingress uses a narrow audited service-role boundary

- Date: 2026-08-12
- Status: Accepted
- Decision: Public GitHub webhook ingress verifies the raw-body HMAC, size, delivery/event headers, schema, and replay identity before using a server-only Supabase service-role client for narrowly granted reconciliation functions. Stored payload evidence is redacted and hashed.
- Consequence: Interactive operations continue to use user JWTs and RLS. Service role never enters the browser and never substitutes for actor/tenant/resource checks in privileged functions.

## ADR-013 — Stop Phase 1B before Codex, autonomy, or Claude

- Date: 2026-08-12
- Status: Accepted
- Decision: Phase 1B ends at authenticated GitHub repository visibility and owner/admin-initiated draft-PR creation. Codex execution is Phase 1C, autonomous-loop enablement is later, and Claude logical agents are Phase 2.
- Consequence: OpenAI/Codex and Anthropic/Claude remain **Not Connected**; auto approve, merge, deploy, and rollback stay OFF and have no executor.

## ADR-014 — Fail closed at synchronized GitHub repository boundaries

- Date: 2026-08-12
- Status: Accepted
- Decision: Serialize installation synchronization by external installation ID before connection creation, re-resolve the installation's tenant/connection binding after upsert, match normalized repository full names literally rather than with SQL wildcard semantics, and persist only the synchronized GitHub default branch when linking a project. The standard file-change route also treats repository memory/policies, Supabase, every application API route, server-side GitHub/Supabase code, Auth/session boundaries, deployment/environment/infrastructure files, and security-sensitive subject paths as protected.
- Consequence: Concurrent first syncs cannot create competing connection identities, caller text cannot override provider-synchronized repository/default-branch state, `%` and `_` cannot broaden repository authorization matches, and protected control-plane code must use a separate owner-approved workflow rather than the standard draft-PR editor.

## ADR-015 — Exclude local artifacts from Vercel deployment source

- Date: 2026-08-12
- Status: Accepted
- Decision: Commit a fail-closed `.vercelignore` that excludes dependencies, build/test caches, local CLI metadata, environment files, private-key files, and ignored work artifacts from Vercel source uploads.
- Consequence: Production receives the reviewed repository source without unrelated local artifacts or credential-bearing file classes.

## ADR-016 — Phase 1D begins as an execution-inert observation boundary

- Date: 2026-08-12
- Status: Accepted
- Decision: The first Phase 1D increment may evaluate only explicit hypothetical GREEN inputs. Persisted Autonomous Mode remains constrained OFF, the organization kill switch is locked ON, automatic approval/merge/deploy/rollback are constrained OFF, and the evaluator always reports `executionAllowed: false` while no worker exists.
- Consequence: `WOULD_BE_ELIGIBLE` is hypothetical policy evidence, never approval or proof of execution. Enabling external action requires a separate owner-approved decision, non-production evidence, provider controls, and a forward migration that deliberately changes the interlocks.

## ADR-017 — Phase 1B live state is active-tenant evidence, not retained metadata

- Date: 2026-08-12
- Status: Accepted for local implementation; hosted migration/deployment evidence pending
- Decision: Bind every interactive GitHub route to the caller's exact active organization. Treat a project as connected only while its connection is connected, installation is active and unsuspended, and synchronized repository is selected, non-archived, and enabled. Expose immutable activity through a bounded caller-RLS API that omits metadata from browser responses. Remove the legacy HTTP local-repository writer, and route terminal GitHub change evidence and newly granted repository reconciliation through narrowly granted audited database workflows.
- Consequence: Retained connection/project rows cannot create a false Connected state or authorize repository access after loss. Local migrations `011`-`013` must receive exact owner approval and hosted verification before their authorization/audit/webhook guarantees are claimed in production; the Activity UI, route hardening, and webhook reconciliation also require a matching deployed commit and real authenticated acceptance.

## ADR-018 - Provider lifecycle events are ordered and terminal states fail closed

- Date: 2026-08-12
- Status: Accepted for local implementation; hosted migrations `014`, `016`, and `018` pending
- Decision: Treat provider timestamps, not webhook arrival order, as lifecycle ordering evidence. Deletion is terminal for the same GitHub installation ID. Repository deletion remains terminal until an explicit newer restore event, and restored repositories remain unselected until a fresh access synchronization. Propagate repository rename/default-branch metadata only through the exact tenant connection linking the repository to a project.
- Consequence: Delayed suspend, unsuspend, rename, archive, delete, or restore deliveries cannot reactivate an installation, restore stale repository state, or rewrite an unrelated project. Ignored, stale, and terminal outcomes remain auditable. A genuine reinstall uses a new provider installation ID.

## ADR-019 - GitHub change intent uses audited reservation and provider-evidence recovery

- Date: 2026-08-12
- Status: Accepted for local implementation; hosted migrations `015` and `017` pending
- Decision: Remove direct authenticated writes to provider connections, projects, project links, and GitHub change-request rows. Reserve a file change through a caller-authenticated, tenant-validating RPC. Reuse one idempotency key while the same browser save intent is retried. If GitHub has already returned an isolated branch, commit, and open draft PR but database completion fails or its response is lost, finish the same request from that bounded provider evidence through a server-only recovery RPC.
- Consequence: Ambiguous retries do not intentionally create a second branch or draft PR; the recovery path cannot merge, deploy, or write the default branch. Hosted guarantees cannot be claimed until the complete migration chain is owner-approved, applied, and verified.

## ADR-020 - Provider-ingress CHECK helpers use a minimal wrapper grant

- Date: 2026-08-12
- Status: Accepted for local implementation; hosted migration `019` pending
- Decision: PostgreSQL evaluates table CHECK expressions with the invoking role's function privileges. Grant the service-role provider-ingress boundary execute only on the SECURITY DEFINER `jsonb_has_sensitive_keys(jsonb)` wrapper used by those constraints. Keep its recursive implementation and the standalone text secret classifier inaccessible to service role.
- Consequence: Service-role inserts still pass the same sensitive-JSON constraints without exposing broader classifier internals or widening authenticated mutation authority. Hosted behavior must be verified after exact owner-approved promotion.

## ADR-021 - Browser list and activity reads use explicit safe projections

- Date: 2026-08-12
- Status: Accepted for local implementation; hosted migrations `020` and `023` pending
- Decision: Remove authenticated direct SELECT from the agents, commands, tasks, agent-runs, and reports base tables. Serve those lists through caller-bound, tenant-member SECURITY DEFINER RPCs with a 100-row ceiling and allowlisted columns; return agent capabilities only when serialized JSON is at most 8 KiB. Treat activity metadata as an internal audit payload: the browser may receive only bounded allowlisted actor, source, resource, action, status, conclusion, and transition evidence; raw metadata/provider payloads stay server-side.
- Consequence: Adding a UI field requires an explicit server/database projection decision rather than inheriting every base-table or audit column. Caller membership, row limits, output size, RLS behavior, and metadata redaction require hosted verification after promotion.

## ADR-022 - Immutable GitHub repository identity is the authorization key

- Date: 2026-08-12
- Status: Accepted for local implementation; hosted migration `021` pending
- Decision: Persist the tenant-scoped `github_repositories.id` UUID on each GitHub project connection and require every change request to match that exact project/connection/repository binding. Repository full names and default branches remain synchronized display/provider metadata, not authorization keys. Backfill only an unambiguous unique match.
- Consequence: Repository rename cannot break or transfer authorization, and a stale same-name repository cannot inherit project access. Project creation, metadata propagation, file changes, and webhook project attribution must follow the stable UUID and fail closed when no exact binding exists.

## ADR-023 - Protected files require exact owner approval before draft-PR execution

- Date: 2026-08-12
- Status: Accepted for local implementation; hosted migration `022` pending
- Decision: Supersede ADR-011/ADR-014 only for protected-path handling: an active organization owner may authorize one exact protected-file change by entering the path-bound RED confirmation phrase and bounded rationale/rollback plan. Persist immutable requester/approver/executor, path, content digest, expected blob SHA, base branch, decision, and expiry evidence atomically before any provider write. Give reservations a five-minute lease, mark the provider-execution boundary before the first write, and permit reclaim only for the original exact intent while no provider execution or evidence exists.
- Consequence: Admins and unapproved/expired/mismatched protected requests fail closed; likely secrets remain prohibited. Approval authorizes only the existing isolated branch, commit, and open draft-PR flow for at most 15 minutes. It never authorizes a default-branch write, merge, deployment, workflow permission, or autonomous action.

## ADR-024 - Raw Activity and webhook evidence stay behind a bounded RPC

- Date: 2026-08-13
- Status: Accepted for local implementation; hosted migration `024` pending
- Decision: Revoke authenticated direct SELECT on `activity_events` and `github_webhook_deliveries`. Expose Activity only through caller-member `list_activity`, capped at 100 rows and rebuilt from bounded allowlisted scalar evidence.
- Consequence: Raw audit metadata and even stored redacted webhook subsets stay server-side. Any new browser-visible field requires an explicit projection change and hosted tenant/redaction verification.

## ADR-025 - Protected execution integrity and repository relinking are serialized

- Date: 2026-08-13
- Status: Accepted for local implementation; hosted migration `025` pending
- Decision: Bind each protected approval snapshot to its exact reserved change, revalidate it at provider entry, and mint the write-scoped installation token only after that durable boundary. Detect non-placeholder values assigned to generic secret-bearing keys. Serialize project linking by tenant/repository UUID, rejecting concurrent active duplicates while allowing relink after all prior projects are archived.
- Consequence: Approval cannot be attached to a different or already-started change, privileged GitHub token minting cannot precede the database execution boundary, opaque credentials cannot evade prefix-only checks, and mutable repository names cannot race active-link ownership.

## ADR-026 - Reconcile hosted service-role table grants explicitly

- Date: 2026-08-13
- Status: Accepted, applied, and verified in hosted Supabase
- Decision: Hosted verification after applying migrations `011`-`025` found Supabase-managed default ACL drift granting `service_role` ALL table privileges on 22 public tables. Add one forward migration that revokes all `service_role` privileges on every public table, then grants only SELECT, INSERT, and UPDATE on `github_installations`, `github_repositories`, `github_webhook_deliveries`, and `github_change_requests`. Preserve the separately reviewed function EXECUTE boundary.
- Consequence: Post-apply verification reports zero ACL-matrix mismatches: `service_role` retains only SELECT/INSERT/UPDATE on the four GitHub ingress tables and has no table privileges on the other 19. Phase 1B remains incomplete for Auth/provider acceptance; no reset or history repair is permitted.

## ADR-027 - Verify user installation access through the documented bounded list endpoint

- Date: 2026-08-13
- Status: Accepted locally; publication and production retry pending
- Decision: GitHub does not provide `GET /user/installations/{id}`. After exchanging the callback code, request bounded documented `GET /user/installations`, then require an exact match for the callback installation ID and App before minting an installation token or persisting tenant state.
- Consequence: Installation `153442281` is provider-scoped and App-JWT verified, but GitHub remains **Not Connected** until this local fix is published and the authenticated production callback succeeds. A list result without the exact ID fails closed.

## ADR-028 - Controlled commits use one explicit server-only deployment identity

- Date: 2026-08-13
- Status: Accepted locally; publication, deployment configuration, and live verification pending
- Decision: Require one strictly validated server-only name/email pair for controlled GitHub file commits. Validate it before authorization, tenant persistence, token minting, or provider mutation, and send the same identity in both Contents API `author` and `committer`. Do not accept attribution from the browser, persist it in Supabase, write it to logs, or fall back to the authenticated GitHub App bot.
- Consequence: Missing or malformed attribution returns the safe `github_not_configured` response without a database or GitHub side effect. Production acceptance must configure the exact owner-approved deployment identity and prove both fields on a real draft-PR commit; the boundary still cannot write the default branch, create a non-draft PR, merge, or deploy.

## ADR-029 - Live repository acceptance and webhook acceptance are independent gates

- Date: 2026-08-13
- Status: Accepted, deployed, and verified for the owner repository path
- Decision: Supersede the pending acceptance status in ADR-027 and ADR-028 without changing their technical boundaries. Treat a tenant GitHub repository connection as Connected only after the production callback, exact installation/repository scope, tenant persistence, project link, live reads, and immutable activity evidence pass. Require `GITHUB_COMMIT_IDENTITY_NAME` and `GITHUB_COMMIT_IDENTITY_EMAIL` in server-only Production and Preview settings, and accept controlled writes only when a real ordinary draft and a real owner-approved protected RED draft expose the owner-approved `surgeservicesllc <surgeservicesllc@gmail.com>` identity as both author and committer. Treat the GitHub App webhook as a separate capability that remains **Not Connected** until GitHub retains the active endpoint and a valid signed delivery succeeds.
- Consequence: Installation `153445938`, connection `d17c63a9-d995-481e-98ce-b737efb32ce5`, project `b1f23696-437e-4d89-b55f-d7a949980e8f`, ordinary draft PR `#6`, and protected draft PR `#7` satisfy the live owner repository path. The earlier App-bot-attributed drafts `#4` and `#5` were closed unmerged and their isolated branches were deleted. Phase 1B remains incomplete because the webhook and live second-tenant/failure/disconnect matrix are not verified; Phase 1C/Phase 2 stay **Not Connected**, Autonomous Mode stays OFF, the global kill switch stays ON, and automatic approve/merge/deploy/rollback stay OFF.

## ADR-030 - Replace a defective GitHub App through a verified, reversible dual-App handoff

- Date: 2026-08-13
- Status: Accepted locally; publication, hosted migration `027`, candidate installation, signed delivery, and production handoff pending
- Decision: Keep the existing App and installation available while a separately keyed candidate App is introduced through an explicit `primary`/`candidate` configuration slot. Candidate configuration is all-or-nothing and must use distinct App identity, OAuth credentials, private key, state secret, and webhook secret. Installation state binds both the App slot and App ID; repository token operations select configuration from the persisted installation App ID; webhook ingress identifies the signing App by its configured secret and rejects a signature whose App ID does not match the persisted installation. A first project handoff requires a processed, HMAC-verified webhook delivery for the exact target installation. Migration `027` adds an owner-only, exact-confirmation RPC that atomically rebinds the existing project/link between active installations of the same GitHub account and immutable external repository, blocks pending change reservations and conflicting active links, preserves project/change history, and appends immutable handoff evidence. A reverse handoff is allowed only from that evidence while both installations remain active.
- Consequence: Provider-side webhook persistence on candidate App `4582606` is necessary but not sufficient for cutover. The candidate remains **Not Connected** until the dual-App code is published and deployed, migration `027` is hosted, the App is installed for exactly `surgeservicesllc/SoftwareFactory`, callback/sync and a signed processed delivery pass, and the owner executes and verifies the handoff. Existing App `4573846` and installation `153445938` remain the live project path and rollback boundary during the observation window; Support ticket `#4660724` remains evidence of its broken webhook. No default-branch write, merge, deployment, rollback, Codex/Claude execution, or automatic action is authorized.

## ADR-031 - Activate the verified candidate App while retaining the primary rollback path

- Date: 2026-08-13
- Status: Accepted, deployed, and verified for the owner repository path
- Decision: Supersede only ADR-030's pending/live-path status. Hosted migration `027` and main release `799d2cea189b6860a03987ae75c25765f9ac4aca` are active. Candidate App `4582606`, installation `153479019`, and connection `85591f43-dd4e-46d2-8a1b-0f036b32639f` passed callback, synchronization, exact repository selection, a fresh post-sync candidate-signed processed delivery, owner RED approval/execution, and atomic handoff of project `b1f23696-437e-4d89-b55f-d7a949980e8f`. Keep App `4573846` and installation `153445938` active as the explicit reverse-handoff boundary while its webhook defect remains tracked by Support `#4660724`.
- Consequence: Candidate-backed Files reads and draft-only writes are live. Acceptance PR `#8` used candidate App bot `surge-softwarefactory-next` as PR author and explicit owner identity as commit author/committer, passed CI run `31716958685` and Vercel Preview, remained draft, was never merged, was closed after verification, and had its temporary branch deleted. Main release CI `31716263910`, READY production deployment `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ`, production Playwright 48/48, 13/13 public-route checks, invalid-webhook `401` private/no-store behavior, clean 30-minute logs, and 20 clean JavaScript assets pass. This does not authorize primary retirement, automated reverse handoff, default-branch writes, merge, deployment, rollback, Codex/Claude execution, or any automatic action; Phase 1B still awaits the live second-tenant and remaining adverse lifecycle/disconnect/reverse-observation matrix.

## ADR-032 - AI providers are interchangeable behind one adapter contract

- Date: 2026-08-13
- Status: Accepted for local implementation; hosted migration `020` and live provider evidence pending
- Decision: Every AI provider implements one `ProviderAdapter` contract (`createRun`, `getRun`, `cancelRun`, `listEvents`, `getResult`, `listModels`, `checkHealth`) and returns one schema-validated artifact. Adapters use the official provider SDKs with server-only credentials read from the environment; a missing credential resolves to **Not Configured** rather than an error. Routing is a pure function whose decision carries structured reasons and scored candidates, with precedence owner request, then agent assignment, then project default, then automatic score. Two rules sit above that precedence and cannot be overridden: a provider that does not declare a required capability is never selected, and a provider that is not `connected` is never selected. An explicit request for an unavailable provider fails as `OVERRIDE_TARGET_UNAVAILABLE`.
- Consequence: Adding a provider is an adapter plus a capability declaration, not a change to the Orchestrator. A routing decision is reproducible and auditable from its recorded inputs. No caller can silently obtain a different provider than the one it asked for, and no provider is chosen because it happened to be the fallback.

## ADR-033 - Phase 2A provider runs are advisory and separately switched on

- Date: 2026-08-13
- Status: Accepted
- Decision: A Phase 2A provider run reads bounded context and returns an analysis artifact. It has no repository, merge, deployment, or approval authority; applying a recommendation remains the existing owner-driven branch, commit, and draft-pull-request flow. Outbound execution is gated by `organizations.ai_provider_execution_enabled`, which defaults OFF and is owner-only, so a configured credential is never by itself consent to spend. Fallback requires the project policy to allow it *and* the failure class to be declared fallback eligible; credential, authorization, cancellation, and content-policy failures are never fallback eligible. An independent-review step cannot be satisfied by the agent that produced the work under review, whichever provider executed it.
- Consequence: Enabling a provider changes what SoftwareFactory can analyze, not what it can change. Fallback cannot be used to shop a refused request to a second provider or to paper over a broken credential, and a single agent cannot both implement and approve. Widening this boundary requires a separate owner-approved decision and a forward migration that deliberately changes the interlocks.
