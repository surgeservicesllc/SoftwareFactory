# Architecture decision log

Use this append-only log for decisions that constrain future implementation. Change a decision by adding a superseding entry, not silently rewriting history.

> **Filenames in the ADRs below were renumbered.** Concurrent branches shifted the
> migration chain, so several Phase 1C migrations moved: `phase1c_enums` to `20260813000800`,
> `phase1c_codex_execution` to `20260813000900`, and `logical_agent_roster` to
> `20260813001000`. The decisions themselves are unchanged; only the names they point at moved,
> and the references here have been corrected so they resolve.

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
- Status: Accepted; promotion status superseded by ADR-052
- Decision: Every AI provider implements one `ProviderAdapter` contract (`createRun`, `getRun`, `cancelRun`, `listEvents`, `getResult`, `listModels`, `checkHealth`) and returns one schema-validated artifact. Adapters use the official provider SDKs with server-only credentials read from the environment; a missing credential resolves to **Not Configured** rather than an error. Routing is a pure function whose decision carries structured reasons and scored candidates, with precedence owner request, then agent assignment, then project default, then automatic score. Two rules sit above that precedence and cannot be overridden: a provider that does not declare a required capability is never selected, and a provider that is not `connected` is never selected. An explicit request for an unavailable provider fails as `OVERRIDE_TARGET_UNAVAILABLE`.
- Consequence: Adding a provider is an adapter plus a capability declaration, not a change to the Orchestrator. A routing decision is reproducible and auditable from its recorded inputs. No caller can silently obtain a different provider than the one it asked for, and no provider is chosen because it happened to be the fallback.

## ADR-033 - Phase 2A provider runs are advisory and separately switched on

- Date: 2026-08-13
- Status: Accepted; promotion status superseded by ADR-052
- Decision: A Phase 2A provider run reads bounded context and returns an analysis artifact. It has no repository, merge, deployment, or approval authority; applying a recommendation remains the existing owner-driven branch, commit, and draft-pull-request flow. Outbound execution is gated by `organizations.ai_provider_execution_enabled`, which defaults OFF and is owner-only, so a configured credential is never by itself consent to spend. Fallback requires the project policy to allow it *and* the failure class to be declared fallback eligible; credential, authorization, cancellation, and content-policy failures are never fallback eligible. An independent-review step cannot be satisfied by the agent that produced the work under review, whichever provider executed it.
- Consequence: Enabling a provider changes what SoftwareFactory can analyze, not what it can change. Fallback cannot be used to shop a refused request to a second provider or to paper over a broken credential, and a single agent cannot both implement and approve. Widening this boundary requires a separate owner-approved decision and a forward migration that deliberately changes the interlocks.

## ADR-034 - Phase 1E is a production-operations control plane, not a production mutator

- Date: 2026-08-13
- Status: Accepted; implemented and hosted; live observation pending
- Decision: Build the Phase 1E objective as far as the tree honestly allows and stop at the mutation boundary. Everything that only observes or restricts is implemented and may run automatically: monitoring ingestion, health derivation, incident creation and deduplication, severity classification, release freeze, diagnosis, bounded repair-work creation, resolution gating, durable event orchestration, and reporting. Everything that would mutate production is built up to the decision boundary, records immutable evidence, and stops at a named blocker. Freeze is automatic precisely because it only removes authority; resume and organization-wide stop are owner-only. Rollback and repair execution record `EXECUTOR_NOT_CONNECTED` and `WORKER_NOT_CONNECTED` rather than acting, because no deployment provider adapter exists, `policies/AUTO_ROLLBACK.md` disables automatic rollback, migration `010` pins `auto_rollback` off, and Phase 1C is Not Connected.
- Consequence: The stated Phase 1E target chain is demonstrated end to end against the real migrated schema with two stages asserted as blocked rather than simulated — the Codex fix and the deploy. Migration `028` adds ten RLS/FORCE-RLS tables and grants `service_role` no new table privileges, so the verified `026` ACL matrix is unchanged; provider ingestion runs through narrow SECURITY DEFINER workflows instead of table grants, which also leaves scheduled monitoring **Not Connected** until a scheduler identity is authorized without widening `service_role`. Four constraints carry the safety guarantees rather than convention: an unconnected monitor cannot be enabled, a failed rollback cannot be recorded without escalating, an incident cannot be resolved without root cause and corrective action, and `EXECUTOR_NOT_CONNECTED` is appended unconditionally so no configuration change can grant release authority. Phase 1B remains incomplete, Phase 1C and Phase 2 remain Not Connected, Autonomous Mode stays OFF, the global kill switch stays ON, and no automatic approve, merge, deploy, or rollback exists.

## ADR-035 - Monitoring may never present a signal it did not observe

- Date: 2026-08-13
- Status: Accepted; implemented
- Decision: A monitoring surface fails in a specific way: an empty chart looks identical to a healthy one. So absence of evidence resolves to **UNKNOWN**, never HEALTHY; a monitor whose provider adapter is not connected cannot be enabled at all, enforced by the `production_monitors_enabled_requires_connection` CHECK constraint; a probe that cannot run records nothing rather than an `unknown` observation that would corrupt the failure count; and every unconnected provider is listed with the exact reason and the condition that would unblock it. The single connected adapter validates its target before every request — HTTPS only, standard port, no credentials, and no loopback, private, carrier-grade-NAT, link-local, or cloud-metadata address — does not follow redirects, and never reads a response body, so production content cannot enter control-plane evidence.
- Consequence: The product cannot fabricate monitoring, and the failure mode when a provider is missing is an explicit Not Connected with a reason rather than a silent gap. One residual limitation is recorded rather than hidden: a public hostname that resolves to a private address at DNS time is not detected, because that needs resolve-then-connect-by-IP handling. Migration `028` is hosted; live monitoring remains unproven until an owner-authorized production target is observed.

## ADR-036 - The bot fabric is a control-plane registry, not an execution surface

- Date: 2026-08-12
- Status: Accepted, published, and hosted
- Decision: Model provider-neutral bots, organization-authored roles, and bot-to-project assignments as first-class tenant records. A bot stores metadata plus the NAME of a server-side environment variable; the value is resolved only on the server, only to a presence boolean, and never enters a table, a browser response, a log, or audit metadata. Privileged reference names (Supabase service role, GitHub App private key and secrets, database URL, Vercel token, and any `NEXT_PUBLIC_` variable) are rejected by both the application allowlist and a table CHECK constraint. Readiness describes configuration only: `ready` means the reference and configuration resolve server-side, and the check performs no provider request. Assignment is declarative routing intent; a bot holds at most one open posting so moving it between projects is a single audited transition.
- Consequence: Registering a bot, authoring a role, and posting a bot cannot start work. OpenAI/Codex and Anthropic/Claude remain **Not Connected**; the published Phase 2A advisory layer and published-but-disabled Phase 1C worker do not turn this registry into an executor. Connecting a bot would require separate owner-approved activation and verified live-session evidence before any surface may say "Connected".

## ADR-037 - Cascade layers govern the anchor reset

- Date: 2026-08-12
- Status: Accepted
- Decision: Keep the global `a { color: inherit }` reset inside `@layer base`. Unlayered rules outrank every cascade layer, so an unlayered reset silently defeated `@layer components` classes: `.primary-action` rendered correctly as a button and at 1.19:1 contrast as a link.
- Consequence: Component and utility classes control anchor color as intended. Accessibility scanning now covers `/bot-manager` in addition to the dashboard, so a regression of this class fails a gate instead of shipping.

## ADR-038 - Marketing content is a separate, world-readable schema

- Date: 2026-08-13
- Status: Accepted; promotion status superseded by ADR-052
- Decision: Serve the public marketing site from its own `marketing_*` schema rather than from tenant tables or hard-coded copy. Published rows carry an explicit `anon` SELECT policy, because marketing copy is public by design; RLS and FORCE RLS stay enabled and no marketing table grants INSERT, UPDATE, or DELETE to `anon` or `authenticated`. No marketing table references a tenant table or carries an `organization_id`. The single public write path is `subscribe_to_newsletter`, a SECURITY DEFINER function that validates and normalizes the address, is idempotent per email, and returns a constant status; `newsletter_subscribers` is excluded from the SELECT-policy loop, so a browser can never read it back.
- Consequence: Marketing content can be edited without a deploy once the migration is hosted, and the public surface cannot be used to enumerate subscribers or reach tenant data. Widening the marketing schema's grants, or adding an `organization_id` to it, requires a superseding decision.

## ADR-039 - Marketing pages state their content provenance

- Date: 2026-08-13
- Status: Accepted
- Decision: `lib/marketing/queries.ts` never throws. An unconfigured or unreachable Supabase, or a missing page row, returns seeded content tagged `source: "seed"`, and the page renders a **Demo Data** notice. A missing page row falls back wholesale rather than mixing live and seeded sections.
- Consequence: A marketing page always renders, and never presents seeded copy as live. Removing the fallback requires removing the notice with it; removing the notice alone would make the page lie.

## ADR-040 - Two route groups separate the public site from the control plane

- Date: 2026-08-13
- Status: Accepted
- Decision: `app/(marketing)/` carries the public header/footer shell and is indexable; `app/(console)/` keeps the sidebar shell and stays `noindex`, with `robots.ts` disallowing console paths and `sitemap.ts` listing marketing routes only. The former console homepage is now `/solutions`, reached from the main navigation, and each shell owns exactly one skip link.
- Consequence: The two visual systems and their metadata no longer share a layout. The console's lime palette is not reused on marketing pages; only shared primitives cross the boundary.

## ADR-041 - The control plane is served under /solutions

- Date: 2026-08-13
- Status: Accepted; supersedes the route-group half of ADR-040
- Decision: Every control-plane page lives under `/solutions` in `app/(portal)/`, and the `app/(console)/` group is removed. The portal layout renders the marketing global navigation above the console shell, offsetting the shell's fixed sidebar and header by `--shell-top: 73px`; the shell defaults that variable to `0`, so nothing else is affected. Permanent redirects map each former top-level path and its subpaths to the new home, and `lib/github/state.ts`'s return-path allowlist moves with them. The two shells' mobile menu buttons carry distinct accessible names, and the console `nav` is labelled "Console" rather than "Primary", because both landmarks now render on the same page.
- Consequence: A visitor arriving from the public site keeps that wayfinding inside the console, and existing links, bookmarks, and in-flight provider callbacks continue to resolve. `/solutions` is no longer a marketing page: it is `noindex` by root-layout inheritance, disallowed in `robots.txt`, and absent from `sitemap.ts`. Adding a console page outside `app/(portal)/solutions/`, or re-listing a disallowed path in the sitemap, fails `tests/integration/console-routing.contract.test.ts`.

## ADR-042 - Phase 1D ships the decision layer, not an executor

- Date: 2026-08-13
- Status: Accepted
- Decision: Phase 1D implements the control model, diff risk classification, gate sets, reviewing agents, the approval tri-state, and the orchestrator stage machine. It implements no merge, deploy, or code executor, and it relaxes no interlock. `implement`, `merge` and `deploy` are reached, evaluated, and blocked by a named blocker rather than skipped.
- Rationale: The executor stages depend on a Connected Phase 1C worker and a Vercel adapter, neither of which has live evidence, and `AGENTS.md` forbids introducing an auto-merge or production deployment workflow in this line of phases. The decision layer is the part that can be built honestly, and it is the part that makes an executor safe to add later.
- Consequence: Tests assert the blockers by name, so a future phase that connects an executor fails them on purpose and has to update the assertions deliberately. Authority cannot be gained by accident.

## ADR-043 - Risk is classified from the diff, not from a self-declaration

- Date: 2026-08-13
- Status: Accepted
- Decision: `lib/autonomy/diff-risk.ts` derives risk factors from changed paths plus credential- and destructive-SQL-shaped content, and the loop reclassifies when the change is finished. A diff that classifies higher than it was declared blocks and must be re-gated.
- Rationale: `classifyRisk` answers "given these factors, how risky is this?" — it cannot answer "what factors does this change have?". Leaving that to the caller means the thing being judged supplies the evidence for its own judgement, which is exactly what an autonomous loop must not be trusted to do.
- Consequence: Work that opens GREEN and ends up touching a migration is judged as what it became. An unrecognised change inherits the existing YELLOW default, so lack of a signal is never read as safety.

## ADR-044 - Approval is evaluated after verification, and never by the author

- Date: 2026-08-13
- Status: Accepted
- Decision: `evaluateApproval` checks controls, then the change's soundness (gates, findings, risk escalation), then who is approving. Owner approval cannot satisfy a failing gate, an unsound change is returned as `NOT_APPROVED` rather than escalated to a person, and the author of a change is refused as its approver at every risk level including RED and including when they are the owner.
- Rationale: `OWNER_APPROVAL_REQUIRED` and `NOT_APPROVED` mean operationally different things — one waits for a person, the other waits for a better change. Collapsing them would send unverified work to a human and retry things that need a decision. Allowing self-approval would make the audit record describe a signature nobody independent gave.
- Consequence: An owner who wants to approve their own change does so as a second, separately attributed act.

## ADR-045 - Phase 1C uses a durable, lease-bound Codex worker that can publish only a draft PR

- Date: 2026-08-13
- Status: Accepted, published, and hosted; successful end-to-end live run pending
- Decision: Supersede ADR-013 only for a manually submitted Phase 1C GREEN/YELLOW execution path. A Vercel request authenticates the owner intent, resolves the exact tenant/project/GitHub repository ID and base SHA, computes a deterministic plan, and persists durable command/task/run state. It may wake the worker with an opaque command UUID, but it never runs Codex. A reviewed Node worker using pinned `@openai/codex-sdk` must claim a short Supabase lease, reauthorize the immutable binding, verify the exact base SHA, create an isolated `factory/*` workspace, run bounded Codex with workspace-write/no-approval/no-workspace-network settings, pass deterministic pinned-container validation and secret/protected-path policy checks, then push only the isolated branch and create or recover only an open draft pull request. Exact-head CI, validations, artifacts, usage, cancellation, retry, reports, and terminal state are durable, bounded, redacted, and auditable. Provider, model, logical agent, project, account, and repository remain separate identities. RED commands are not executable in Phase 1C even when approval evidence exists.
- Consequence: `@openai/codex-sdk`, the worker source, GitHub Actions one-shot workflow, schema, APIs, and UI can be reviewed locally without claiming connectivity. OpenAI/Codex remains **Not Connected** until protected configuration, hosted migrations, a fresh worker heartbeat, and one real end-to-end draft-PR/CI run pass. The worker has no default-branch, approval, merge, deployment, rollback, workflow, administration, or secret-setting authority. Autonomous Mode remains OFF, the global kill switch remains ON, and all automatic actions remain OFF.

## ADR-046 - Commit PostgreSQL enum additions before the Phase 1C schema uses them

- Date: 2026-08-13
- Status: Superseded by ADR-049 for migration numbering and promotion state
- Decision: Apply Phase 1E migration `20260812002800_phase1e_production_operations.sql`, the Phase 2A provider migration `20260813000100_provider_execution_layer.sql`, Phase 1E synthetic-journey migration `20260813000200_phase1e_synthetic_journeys.sql`, bot-fabric migrations `20260813000300_bot_fabric_activity_types.sql` and `20260813000400_bot_fabric.sql`, and marketing migration `20260813000500_marketing_content.sql` first. Put only the new `architect` and `performance` `agent_role` values and Phase 1C activity event values in `20260813000800_phase1c_enums.sql`. Put every dependent Phase 1C table, constraint, function, trigger, policy, grant, and data path in the subsequent `20260813000900_phase1c_codex_execution.sql` migration.
- Consequence: PostgreSQL commits enum additions before dependent use, avoiding the unsafe-new-enum-value failure that can occur when `ALTER TYPE ... ADD VALUE` and use share one migration transaction. This original numbering was superseded by ADR-049 before promotion; the canonical hosted chain now uses `130008` for Phase 1C enums, `130009` for execution, and `130010` for roster/recovery/report hardening.

## ADR-047 - Logical agents are provider-neutral and recovery requires coherent immutable evidence

- Date: 2026-08-13
- Status: Superseded by ADR-049 for migration numbering and promotion state
- Decision: Migration `20260813001000_logical_agent_roster.sql` creates an idempotent organization-wide standard roster for Orchestrator, Product, Architect, Frontend, Backend, Database, QA, Security, Performance, Release, and CEO Reporter. Standard rows remain logical identities; provider/model are execution or explicit assignment data, not provider-account identity. Existing factory-created role references are rebound without overwriting user-created agents or their explicit Phase 2A assignments. The same migration reconciles provider-table service-role ACLs, narrows command submission to authenticated organization owners, includes acceptance criteria in the authoritative SQL risk floor, serializes active work by logical agent, and allows retry/recovery only from no-provider/branch-only intent or one coherent immutable branch/commit/optional-draft-PR evidence set. Artifact replay, live draft recovery, stale-lease terminalization, cancellation precedence, terminal pull-request projection, and success/failure/cancellation reports must all agree with the exact run/project/repository/base/head identities.
- Consequence: A logical role is not an OpenAI/Anthropic account, parallel workers cannot run the same logical agent concurrently, and partial or conflicting provider evidence cannot be treated as a retryable continuation. General Phase 1C commands map to Orchestrator rather than a provider-bound catch-all. Members see bounded structured reports and provider status; raw or unbounded evidence remains server-side. This decision was ultimately promoted in the renumbered hosted chain through `130014`; live success remains unproved because provider credits are exhausted.

## ADR-048 - Worker activation and CI success use two separate fail-closed allowlists

- Date: 2026-08-13
- Status: Accepted and published; activation gate exercised, successful live proof pending
- Decision: Keep repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` absent or not equal to literal `true` through migration, secret configuration, code publication, ordinary CI, and Vercel verification; every repository-dispatch and schedule worker trigger must skip while it is OFF. Omit branch-selectable manual workflow dispatch from this secret-bearing workflow. Treat setting the variable to `true` as the final exact owner-approved RED activation. Separately require `SOFTWAREFACTORY_REQUIRED_CHECKS` to contain 1-20 unique pipe-delimited exact GitHub check names. The reviewed workflow fixes `Lint, typecheck, test, and build|Browser and accessibility tests 1/3|Browser and accessibility tests 2/3|Browser and accessibility tests 3/3`. A run may pass CI only when GitHub returns the complete check set, every observed check is terminal with an acceptable conclusion, every required name is present with exact `success`, the identical passing fingerprint is observed twice, and the draft PR number/base/head still match.
- Consequence: Configuration of secrets or publication of the workflow cannot start a worker while the activation variable remains OFF. Missing/invalid required-check configuration prevents worker startup; missing, renamed, truncated, unstable, or non-successful required evidence cannot degrade to a pass. After the bounded acceptance window, activation returns to OFF unless the owner separately approves continued operation. A clean one-shot exit records `idle`; its heartbeat is briefly Available/Connected while fresh and becomes stale/Not Connected after the bounded threshold, without being treated as end-to-end execution proof.

## ADR-049 - Reconcile hosted history before applying the canonical inert/Phase 1C forward chain

- Date: 2026-08-13
- Status: Accepted and completed for hosted reconciliation and forward promotion
- Decision: Supersede ADR-046 and ADR-047 only for migration numbering and promotion order. Hosted Supabase has exactly 26 ledger rows through `027`, while catalog evidence shows the schema effects of `028` and the canonical hosted-source `130001`-`130005` layers are already present; two historically published source files shared version `130002`. Never rerun that DDL or mutate immutable `130001` to fold in Phase 1C. Under exact owner RED approval, first prove each catalog/source mapping and repair only the corresponding history rows, then re-list and dry-run. Apply absent forward migrations in order: `130006` Phase 1D decision-only controls; `130007` additive/narrowing provider compatibility; `130008` Phase 1C enums; `130009` Phase 1C execution; `130010` provider-neutral roster/recovery/report hardening; and `130011` canonical same-project dependencies, derived non-empty acceptance criteria, idempotent dependency replay, and cumulative turns/input/output budgets across retries.
- Consequence: The production ledger converged without re-executing schema-present DDL or rewriting published migration source. PostgreSQL commits Phase 1C enums before dependent use. Dependencies cannot cross tenants/projects or refer forward, and a retry consumes the original run's remaining provider budget instead of resetting it. Hosted migrations `130006`-`130014` grant no automatic authority: Autonomous Mode remains OFF, the global kill switch remains ON, every automatic action remains OFF, and no executor is connected. Phase 1C remains **Not Connected** until a real bounded draft-PR/CI run passes.

## ADR-050 - Verify provider startup before consuming a durable run attempt

- Date: 2026-08-13
- Status: Accepted, published, and exercised; provider credits block successful diagnostic completion
- Decision: Every enabled command or recovery-schedule worker job must verify the reviewed Codex CLI version and perform a non-billable lookup of the exact configured OpenAI model before Docker preload or durable claim. A separate allowlisted repository-dispatch event, `softwarefactory_phase1c_preflight`, may additionally execute one bounded, non-stored OpenAI response; that event must skip Docker preload and durable claim entirely. Do not multiplex this diagnostic authority through caller-controlled payload fields. If Codex emits a structured terminal provider error before the SDK iterator exits with a generic CLI error, retain only the bounded redacted structured message while preserving event-persistence failures.
- Consequence: Invalid credentials, inaccessible models, CLI drift, and response-execution failures stop before a lease or retry budget is consumed. The diagnostic event cannot claim queued work or mutate a repository, and a passing preflight is evidence only of provider startup, not Phase 1C completion. OpenAI/Codex remains **Not Connected** until a real command completes the isolated branch, draft-PR, validation, exact-head CI, report, and audit journey.

## ADR-051 - A stale failed run remains evidence; acceptance starts a new current-base command

- Date: 2026-08-13
- Status: Accepted
- Decision: Do not use the remaining retry on failed run `f4594556-6f72-4763-a480-6993939e3651`. Its immutable planned base is older than current `main`, and the worker correctly rejects a changed default-branch head as `stale_base_sha`. After a fresh funded key passes the distinct no-claim provider diagnostic, submit a new safe GREEN owner command so repository resolution captures the then-current base SHA. Leave the old command/run immutable as failure-boundary evidence.
- Rationale: Updating a persisted run's base SHA would break its exact-intent and audit identity, while retrying it would knowingly consume the last attempt on a deterministic stale-base rejection. A new command preserves both fail-closed repository binding and truthful history.
- Consequence: Publication must pause between planning the new command and its worker claim so `main` cannot drift again. The new command still requires the normal owner, risk, activation, validation, draft-only PR, exact-head CI, and deactivation controls; this decision widens no authority.

## ADR-052 - Provider scalar storage and run routing use bounded, rolling-compatible boundaries

- Date: 2026-08-13
- Status: Accepted locally; migration `20260813001500_expose_bounded_run_routing.sql` is unhosted and requires fresh exact RED approval
- Decision: Supersede only the promotion-status portions of ADR-032, ADR-033, and ADR-038: provider migration `130001` and marketing migration `130005` are hosted in the reconciled chain through `130014`, while provider execution remains OFF and live provider evidence remains absent. Restore the immutable `130001` provider catalogue/API model-identifier contract by widening `provider_agent_assignments_model_check` and `agent_runs_model_check` from the accidental `130007` limit of 120 characters to 128, retaining the assignment character regex, nullability, trimming, and every other authorization/constraint semantic. Add `provider_model_configurations_text_not_secret`, `provider_routing_decisions_policy_version_not_secret`, `provider_agent_assignments_model_not_secret`, and `provider_routing_decisions_selected_model_not_secret`, backed by immutable `text_has_likely_secret(...)`, so credential-shaped catalogue model/display-name, assignment model, and routing policy-version/selected-model scalar text cannot persist in browser-readable rows. Enforce the matching default-model/model/display-name rejection at provider runtime/API boundaries before serialization or RPC, and fail closed rather than expose a dirty pre-`130015` catalogue row. In the same forward migration, replace `get_agent_run_detail(uuid, uuid)` while preserving its signature, `SECURITY DEFINER`, pinned `search_path`, and authenticated-only ACL and project a new bounded `routing` object. Command-backed Phase 1C runs report the fixed server policy and logical-role binding with an empty candidate list rather than fabricated scores. Phase 2A runs expose only allowlisted routing sources, reason codes, providers, models, eligibility, scores, and ineligibility codes from their immutable routing-decision row, capped at 20 reasons, 10 candidates, and 10 ineligibility codes per candidate with bounded/redacted text. Runs without durable routing evidence return null. Revoke authenticated raw SELECT on `provider_routing_decisions` and `provider_run_events` so the bounded projection cannot be bypassed; retain tenant-scoped authenticated SELECT on `provider_model_configurations` for Settings/model-catalogue use, and leave provider-assignment reads behind their existing bounded function. The application accepts an absent or null routing field so code may roll out safely while hosted Supabase remains at `130014`; it labels missing evidence rather than inferring why a provider was selected.
- Rationale: The stored assignment/run constraints must not reject a model identifier that the immutable provider catalogue and HTTP contract accept. Browser-readable provider scalars must also remain metadata rather than a credential channel, regardless of whether they arrive through an RPC or direct row path. Provider/model names alone answer what executed, not why. Returning or leaving direct access to raw routing/event JSON would widen or bypass the browser data boundary and could expose unbounded or secret-shaped provider metadata. Requiring the new field before its migration is hosted would turn a safe projection enhancement into a deployment-order outage.
- Consequence: Local source and tests do not make the constraint restorations, scalar-secret checks, ACL closure, or projection hosted. Applying only the complete `130015` migration to project `qpuofpmagrmyamahqwxw` is a new RED production-database action requiring exact owner approval, ledger and final source-hash identity, exact definitions for both widened and all four no-secret constraints, 128-character assignment/run/project regression, valid scalars plus negative credential-shaped catalogue/assignment/routing scalar checks through reviewed RPC/direct paths, both raw-SELECT revokes and retained model-catalogue SELECT, function-definition/signature/security/search-path/ACL comparison, bounded Phase 1C/2A/legacy routing runtime checks, raw-table/RLS/tenant denial, linked lint, and health. Stop on any mismatch and contain only with another forward migration. The change enables no provider call, worker, autonomy action, merge, deployment, rollback, or secret path; activation remains OFF and the OpenAI secret remains absent.

## ADR-053 - The execution switch is also consent for outbound provider probes

- Date: 2026-08-13
- Status: Accepted locally; current-update publication pending
- Decision: Treat `organizations.ai_provider_execution_enabled` as the explicit organization consent boundary for every outbound AI-provider call, including health probes and live model discovery, not only billed advisory runs. While the switch is OFF, `GET /api/providers` supplies a local **Disabled** snapshot to the bounded status service and makes no provider request. Configured catalogue reads remain tenant-local, but live provider discovery requires both an enabled organization and an owner/admin caller; it otherwise fails closed without reaching an adapter. Provider/default-model and discovered catalogue scalars are validated for shape and likely secrets before serialization or RPC, and dirty pre-`130015` catalogue rows fail closed.
- Rationale: A credential being configured is not consent to contact or spend against a provider, and a read-looking status route must not become an implicit network side effect. Live catalogue discovery can reveal account-specific availability and can incur provider-side logging or rate limits, so ordinary membership is insufficient authority.
- Consequence: OFF means no outbound status, discovery, or advisory execution call. Enabling the switch authorizes only these bounded provider calls within existing tenant, role, budget, and advisory-only limits; it does not authorize Phase 1C, repository mutation, Autonomous Mode, merge, deployment, or rollback. **Connected** still requires a successful enabled live probe/run and cannot be inferred from local configuration or a Disabled snapshot.

## ADR-054 - Post-deploy validation is decided separately from where it is stored

- Date: 2026-08-14
- Status: Accepted locally; no deployment integration exists to produce the evidence
- Decision: Split post-deploy validation into storage and decision. Phase 1E's `deployment_validations` accepts what an owner recorded; `lib/autonomy/post-deploy.ts` decides whether that record is evidence about the deployment in front of it. `evaluatePostDeployValidation` reaches `passed` only by exhausting every way of not reaching it — attribution first (project, environment, provider, deployment, and commit must match, so a mismatched record can neither pass nor fail this deployment), then evidence completeness, completion, and freshness, then the check results. The pipeline's `validate` stage routes the absent case through the same function rather than around it, so no evidence yields `inconclusive` rather than a satisfied stage.
- Rationale: `policies/POST_DEPLOY_VALIDATION.md` requires that missing, stale, or mismatched evidence produce `inconclusive`, never `passed`. The stage previously reported satisfied unconditionally. It was unreachable — `merge` blocks first — so nothing was wrong today, but it was the wrong default at exactly the point where connecting a deploy executor would have made a run that validated nothing report success.
- Consequence: `inconclusive` freezes further automation and requests owner attention; `failed` opens an incident and re-opens the rollback question under `AUTO_ROLLBACK.md` without ever authorizing a rollback; `cancelled` records who and why. No validator produces this evidence, thresholds and baselines are carried as references rather than computed, and the observation window's duration is not enforced — only its declared completion is read. A test asserts the `validate` stage is unreachable so that connecting an executor forces the path to be reviewed.

## ADR-055 - The decision log is raised above documentation-only, and status memory is not

- Date: 2026-08-14
- Status: Accepted locally
- Decision: Classify `AI/DECISIONS.md` as `safety-relevant-memory` (YELLOW). The status memory — current state, handoff, roadmap, backlog, scorecard — stays `documentation-only` (GREEN). Policy documents, `AGENTS.md`, and `CLAUDE.md` remain RED.
- Rationale: `policies/PROTECTED_RESOURCES.md` lists safety-relevant AI memory among the paths requiring elevated review and prohibits an automated system from weakening its own guardrails. The decision log is where those guardrails are recorded, so an otherwise-GREEN diff could have deleted the entry requiring owner approval for RED. YELLOW rather than RED follows the policy's own wording: documentation-only clarification "may be GREEN/YELLOW", and only a semantic reduction in protection is RED.
- Consequence: Editing the decision log requires enhanced gates and a security-agent review; it does not require an owner signature. Status memory stays GREEN deliberately — every material change is required to update it, so pinning it above GREEN would mean no change could ever complete. The classifier still cannot distinguish a clarification from a weakening, and over-classifies where that distinction matters.

## ADR-056 - The site renders differently for a verified viewer

- Date: 2026-08-14
- Status: Accepted
- Decision: Every route-group layout resolves a `Viewer` on the server through `lib/auth/viewer.ts` and passes it into the header and shell, so the signed-in navigation is present in the first server render rather than appearing after hydration. The viewer comes from `auth.getUser()`; cookie contents never produce a signed-in viewer, and `readViewer` never throws — an unconfigured or unreachable Supabase resolves to signed-out so the public marketing site still renders. `lib/navigation.ts` derives the entries and is deliberately not `server-only`, because it holds link labels rather than secrets and is shared by server layouts and the client header. Signed in, a public entry whose destination a console entry already claims is dropped, so `Dashboard` and `Solutions` do not both link to `/solutions`. Super administrators are configured by the server-only `SUPER_ADMIN_EMAILS` variable, which replaces the documented default list rather than extending it, and the role is granted only when the provider reports the address as confirmed. `/solutions/admin` re-checks the role on the server on every request.
- Consequence: Showing a navigation entry is presentation, never authorization; each destination still enforces its own access, and a hidden link is not a control. Reading the session makes the marketing pages dynamic — they stay public and unchanged for anonymous visitors, but they are no longer statically prerendered. The confirmed-email requirement couples the super-administrator role to Supabase's email confirmation setting: enabling `mailer_autoconfirm` would let an unverified sign-up claim a listed address, so that setting and this role must be changed together or not at all. Manually confirming an address in the Supabase dashboard is the supported way to grant the role while no custom SMTP exists.

## ADR-057 - Repair work is promoted through the ordinary command path, and the command is assembled in TypeScript

- Date: 2026-08-14
- Status: Accepted locally; execution remains Not Connected and migration `20260813001700` is unhosted
- Decision: A Phase 1E repair attempt reaches Phase 1C by being submitted through `submit_command`, the same entry point a person's command uses, with the parameter object assembled in TypeScript by `lib/operations/promotion.ts` from `createPhase1CExecutionPlan`. The database function `link_repair_promotion` does only the part that must be privileged and transactional — recording the link — and re-validates every precondition the route checked. The organization-wide emergency stop blocks promotion; a release freeze deliberately does not.
- Rationale: `create_repair_attempt` wrote a bare `backlog` task with no command, and `claim_phase1c_run` selects an `agent_runs` row joined to a `commands` row. Repair work was therefore unclaimable rather than merely unassigned, and the `not_connected` label understated it: no worker or credential would have helped. The obvious fix — a `promote_repair_attempt` SQL function — was written and withdrawn, because Phase 1C validates parameters against an exact-key allowlist with nested validation for `budget`, `plan`, and `repositoryBinding`; reconstructing that in SQL would duplicate `lib/orchestration/plan.ts` and drift from it the first time Phase 1C changed. A version that merely passed a test would have been worse than shipping nothing, because it would have looked connected. Going through `submit_command` rather than around it means the database risk floor applies: a security-shaped repair is forced to RED and owner approval exactly as if a person had typed the request, so self-healing gets no privileged lane into execution.
- Consequence: The route must resolve `baseSha` from a live repository read behind an installation token, because a stale or invented SHA would send a worker at the wrong tree; a GitHub failure there refuses rather than guesses. Promotion is owner-only, since it starts a Codex engineering command. The "already promoted" guard keys on `state = 'assigned'`, which only promotion sets — not `task_id`, which `create_repair_attempt` already populates, and not `assignment_status`, which promotion sets to `pending`; both wrong guards were written first and caught by the double-promotion test. Freezing removes only release authority, so a frozen project can still be repaired — that distinction is the point of having a freeze separate from a stop. This adds no executor: with no registered worker and no provider credential the promoted run sits `queued`, which the route states in its own response, and on hosted Supabase the route fails with a missing-function error until an owner applies the migration.

## ADR-058 - Circuit breaker state is stored, and the threshold that opens it is not duplicated

- Date: 2026-08-14
- Status: Accepted locally; migration `20260814000300` is unhosted
- Decision: Persist Resource Manager circuit-breaker state in `public.resource_breakers` (mutable, one row per organization and target), its transitions in append-only `public.resource_breaker_events`, and routing decisions in append-only `public.resource_assignments`. The read-modify-write happens in `record_resource_breaker_fault` under a row lock, but the fault threshold is passed in from `FAULT_THRESHOLDS` in `lib/resources/breakers.ts` rather than copied into SQL.
- Rationale: `lib/resources/breakers.ts` is a pure fold over a record nobody stored, so every request began with a closed breaker. Three consecutive outages spread across three requests never reached a threshold of three — the breaker that exists to stop a failing provider absorbing work could not fire at all. Storing the count fixes that; storing it in the database under a lock also fixes the concurrent case, where two requests folding the same breaker in application memory would each read the old count and lose an increment. The threshold stays in TypeScript because two copies of a rule are two rules, and this one decides when a provider is cut off.
- Consequence: A closed breaker may hold a non-zero fault count — that is precisely a breaker accumulating toward its threshold. The first version of `resource_breakers_closed_is_clean` required a zero count there and so reset the counter on every write, reintroducing the exact defect the table exists to fix; the behavior test caught it because it drives faults through separate calls rather than one. `lib/resources/store.ts` fails soft on a read and hard on a write: an unreadable breaker must not block work it never observed failing, while a fault that cannot be recorded is a lost observation that would leave a failing provider looking healthy. A prediction is stored only when evidenced, in both the module and a CHECK constraint, so `history.ts` returning null below its minimum sample count cannot be laundered into a number that later outcomes are measured against. `resource_assignments.node_id` is deliberately not a foreign key, so a Phase 2B graph node can reuse it without a migration; Phase 2B does not exist, and today the routed unit is a Phase 1C task.

## ADR-059 - A console route whose bare path belongs to marketing gets no redirect

- Date: 2026-08-14
- Status: Accepted
- Decision: Every console page under `/solutions/<name>` carries a permanent redirect from `/<name>`, **except** where `/<name>` is a live public marketing page. `/solutions/resources` therefore has no bare-path redirect, and `tests/integration/console-routing.contract.test.ts` asserts the exception in both directions: a marketing route name must not appear in the redirect list, and a console page colliding with one must still exist under `/solutions`.
- Rationale: the redirect list was written when the console moved wholesale from bare paths to `/solutions`, so "every console route has a redirect" was true and the contract test enforced it. Adding a console page named `resources` made that rule wrong rather than incomplete: `app/(marketing)/resources` is a public page, and satisfying the test by adding `"resources"` to the list would have 308-redirected it to the console. A permanent redirect on a public URL is cached by browsers and search engines, so the marketing page would have gone offline for returning visitors even after a revert.
- Consequence: the redirect list can no longer be derived by walking the console tree, and the test says why. A future console page whose name collides with a marketing page is reachable only at its full `/solutions/` path, which is correct — the bare path already belongs to something. The near-miss was caught by the production build listing both routes, not by the test, which is worth remembering: the contract test asserted the old rule faithfully and would have accepted the regression.

## ADR-060 - An undeclared model property is never a permissive default

- Date: 2026-08-14
- Status: Accepted locally; migration `20260814000220` is unhosted
- Decision: Add owner-declared `strength_tier` and `context_limit_tokens` to `provider_model_configurations`, both nullable. Null means **undeclared**, and `lib/resources/candidates.ts` resolves it in the refusing direction: undeclared strength becomes `economical` (the weakest tier, so the model cannot pass the `requiresStrongModel` eligibility gate) and undeclared context becomes `0` (so `CONTEXT_TOO_SMALL` fires for any work at all). `POST /api/resources/route` builds candidates from the organization's real `agents` and `provider_model_configurations` rows rather than from code constants, and records each decision.
- Rationale: Phase 2C's eligibility rules need two facts Phase 2A's catalogue never carried. Inferring them from the model's name would need a lookup table that is wrong the first time a provider ships a model nobody updated it for — and wrong silently, in the direction of claiming capability. The columns are additive and touch no constraint that the pending, frozen `20260813001500` redefines, so they do not conflict with that owner-approved-pending work. Only six of Phase 2A's eight capability names map onto Phase 2C's vocabulary: `structured_output` is an output format rather than a kind of work, and `reporting` is not the same claim as `synthesis` — summarising findings is not combining them, and `synthesis` gates work onto strong models, so a wrong mapping there would hand judgement work to a model nobody said could do it.
- Consequence: five Phase 2C capabilities (`frontend`, `backend`, `database`, `research`, `production_investigation`) have no Phase 2A source, so work requiring them has no eligible model until an owner declares one. That is the intended outcome. Until an owner fills in both columns, routing returns `NO_ELIGIBLE_WORKER` for anything demanding — so the response names the undeclared models separately, because "no eligible worker" and "nobody finished declaring the models" have different fixes and only one is the router's. The route selects and starts nothing: no claim, no token, no provider call, asserted by contract test. It is manager-level rather than owner-only, because choosing a worker grants no authority the task did not already carry and the database risk floor still applies when that task is submitted. The manager is deliberately not called from the Phase 1C claim path yet — that path is hosted and live, nothing executes regardless, so changing it now buys no behavior and risks conflicting with concurrent agents.

## ADR-061 - Declaring a model's characteristics is its own function, not more parameters on the upsert

- Date: 2026-08-14
- Status: Accepted locally; migration `20260814000250` (renumbered from `20260814000300` to resolve a version collision) is unhosted
- Decision: `public.declare_model_characteristics(organization, provider, model, strength_tier, context_limit_tokens)` sets the two columns added by `20260814000220`, gated by `can_manage_organization`. Passing null clears a declaration. `GET`/`POST /api/resources/models` expose it.
- Rationale: the columns had no writer, so routing was permanently unable to find an eligible worker for demanding work. That refusal is correct — undeclared fails closed — but it was a state nobody could leave without hand-written SQL. Extending `upsert_provider_model_configuration` with two more defaulted parameters would *not* have replaced it: PostgreSQL keys functions by signature, so the old overload would have survived alongside the new one, calls with the original argument count would have kept hitting the old function and silently left the new columns untouched, and calls omitting the new defaults would have been ambiguous. A distinct name avoids the whole class.
- Consequence: null clears rather than being rejected, so an owner who declared the wrong tier can withdraw the claim instead of substituting another guess — the API documents that omitting a field also clears it, because the function sets rather than merges and pretending otherwise would let a partial request silently wipe the field it did not mention. Declaring is owner/administrator rather than member, because a tier decides what work a model may be given. The OUT parameters are named `declared_*` rather than matching the column names: sharing a name made every unqualified reference in the body ambiguous, and plpgsql reported it only at call time — the same collision class that has now bitten this schema four times.

## ADR-062 - The probe's address check happens at connect time, not before it

- Date: 2026-08-14
- Status: Accepted
- Decision: `lib/operations/guarded-lookup.ts` is passed to undici as `connect.lookup` on a shared `Agent` used by `probeHttpTarget`. Every resolved address is checked by `lib/operations/address.ts`, and a single blocked answer fails the whole lookup even when a public address was offered alongside it.
- Rationale: `validateMonitorTarget` rejects an obviously private *hostname*, which only catches the careless operator. A public-looking name can resolve to `127.0.0.1` or `169.254.169.254`, and this was recorded as a known residual limitation rather than fixed. The obvious fix — resolve, check, then fetch — does not actually close it: the name is free to answer with a public address for the check and a private one for the connection that follows, which is DNS rebinding and is the whole attack. Checking a resolution that is then thrown away proves nothing about the address the socket reaches. Supplying the lookup that undici itself uses means the address checked *is* the address connected to, so there is no second resolution to disagree with the first.
- Consequence: filtering a mixed answer down to its public addresses was the first instinct and is wrong — a hostname answering with both is a rebinding setup, and connecting to the acceptable half is luck rather than a control, so any blocked answer fails outright. A blocked address is reported as `unknown` with a distinct reason rather than as `fail`, because the target was reachable and we refused it; an operator who cannot tell those apart will keep retrying a monitor that will never be allowed to run. The address parser rejects octal, hex and decimal-integer spellings rather than passing them to `Number()`, which accepts all three. IPv4-mapped IPv6 needed both the dotted and the **hex** form: `::ffff:7f00:1` is `127.0.0.1` and was a live bypass in the first implementation, caught by a test written before the code was trusted. Redirects remain unfollowed, so no redirect-chain policing is needed.

## ADR-063 - Every Supabase RPC call site is checked against the migrated schema

- Date: 2026-08-14
- Status: Accepted
- Decision: `tests/integration/supabase-rpc-contract.test.ts` parses every `.rpc("name", {...})` call site out of `app/`, `lib/` and `scripts/`, applies the real migration chain, and asserts against `pg_proc` that each function exists, that every argument name passed is one the function declares, and that no argument without a default is omitted.
- Rationale: this is the one class of Supabase wiring defect nothing else here catches. `supabase-js` accepts an arbitrary object, so `.rpc("do_thing", { p_projct_id })` type-checks, lints, and passes every unit test; PostgREST fails to find a matching function only against a real database, at request time. With 77 distinct RPCs across the application and no generated database types, that surface was entirely unverified.
- Consequence: a call whose parameter object spreads another value is checked for existence and for the explicit keys, but not for completeness — `reserve_owner_approved_protected_github_change` spreads twelve of its fifteen arguments, and asserting totality there would be a false positive rather than a finding, which is how a test like this gets deleted. A first assertion checks the parser actually matched call sites, because a parser that silently matched nothing would make every other assertion vacuously true. The check was mutation-tested by introducing `p_strenght_tier` and confirming it failed with the mismatch named.

## ADR-064 - A dependency cycle is refused at write time, and a dead prerequisite is named

- Date: 2026-08-14
- Status: Accepted; migration `20260814001000` is unhosted
- Decision: `task_dependencies` gains a BEFORE trigger rejecting any edge that would close a cycle, computed by walking the prerequisite closure. Readiness moves into `task_dependencies_unmet`, and `task_dependencies_unsatisfiable` names prerequisites that are cancelled or failed.
- Rationale: the table already refused a self-edge and a duplicate, but not a cycle — A→B→C→A satisfied every constraint. Because readiness is computed rather than stored, such a graph would simply never become ready again, with no row anywhere saying why: the work stops permanently and silently, which is the worst shape a failure can take. Write time is the only place the whole graph is visible at once; detecting cycles at read time would mean every reader reimplementing the check, and a reader that forgot would report a deadlocked graph as merely idle.
- Consequence: a self-edge is now reported as a cycle rather than by the CHECK constraint, because a BEFORE trigger runs first — and a self-edge *is* a cycle, so that message is the more useful of the two. `completed` is the only status that satisfies a prerequisite, which means a `cancelled` or `failed` prerequisite blocks its dependent forever; that is the honest count, and `task_dependencies_unsatisfiable` exists so the permanent case is distinguishable from ordinary waiting rather than looking identical to it. `work_locks` conflict on prefix overlap in **both** directions, so `lib/` blocks `lib/operations/` and the reverse — comparing only exact prefixes would make the lock look like it worked while permitting exactly the collision it exists to prevent.

## ADR-065 - `agentos.yml` is applied through an RPC, and deleting is off by default

- Date: 2026-08-15
- Status: Accepted locally; migrations `20260814001300` and `20260814001400` are unhosted
- Decision: `agentos_export_project_config` and `agentos_apply_project_config` are the only push/pull path, both `security definer`. Export requires membership; apply requires `can_manage_organization`. `p_prune` defaults to false, so a push adds and updates but never removes; anything the file omits comes back as `extra` drift. The CLI (`scripts/agentos.mts`) needs `--prune` **and** `--yes`, and prints what it would remove before removing it.
- Rationale: `authenticated` holds SELECT and nothing else on every `agentos_*` table (`20260814000300`), so a CLI writing through PostgREST could not insert a row even with a valid session — the write path had to be an RPC regardless, which is the right shape anyway because applying a configuration has invariants that belong in one place rather than in whichever client is writing. Deleting is off by default because a push that silently removed an agent when someone edited a file on a laptop is exactly the destructive default `AGENTS.md` forbids; reporting drift instead makes the divergence visible without acting on it. Two flags rather than one because `--prune` alone reads as "make it match", and the person typing it has usually not yet seen what does not match.
- Consequence: a builtin template is refused on push **and** excluded from export — exporting it would hand back a file that push refuses, which is the round trip breaking on any organization that seeded the compound-engineer workflow, and the fix had to be on both sides rather than one. A repository grant resolves against installed repositories, so a YAML edit cannot invent repository access by naming a string. Grant sets are replaced wholesale for an agent the file names, because deleting a line is how an author revokes a capability and merging would make revocation impossible from the file. Every plpgsql local is `v_`-prefixed: a local named `agent_id` shadows the column, making `where agent_id = agent_id` a tautology that deletes **every organization's** grants, and the regression that catches it is a cross-organization bystander — an in-organization test misses it entirely, because a later agent in the same push rewrites what an earlier one wiped.

## ADR-066 - The config file is faithful to the database's constraints, not to a tidier idea of them

- Date: 2026-08-15
- Status: Accepted
- Decision: in `lib/agentos/project-config.ts`, an MCP connection name permits underscores (`^[a-z][a-z0-9_-]{0,62}$`) and an agent name is free text up to 120 characters, each matching the column that stores it. Template step actors stay slug-shaped, matching `agentos_task_template_steps.agent_name`.
- Rationale: the first draft applied one tidy slug rule everywhere. That is stricter than three of the columns it describes, and the failure mode is not a rejected push — it is `pull` emitting a file that its own parser then refuses, which is the round trip breaking in the least obvious direction and only for workspaces that happen to contain a name the tidy rule dislikes.
- Consequence: an agent whose name is not slug-shaped cannot be named by a template step, because that column is slug-shaped. Rather than let that surface as a constraint violation at push time, `parseProjectConfig` reports it as an undefined-agent reference at parse time. Duplicate names within a collection are refused outright: names are the identity a push matches on, so two entries sharing one is an ambiguity whose resolution would be arbitrary, not a redundancy to collapse.

## ADR-067 - The graph engine's lock table is renamed, and object collisions are now a test rather than a merge accident

- Date: 2026-08-15
- Status: Accepted; migrations `20260814002000`, `20260814002100` and `20260814002200` are unhosted
- Decision: the Phase 2B graph engine's lock objects are prefixed `graph_` — table `graph_work_locks`, type `graph_work_lock_state`, and functions `acquire_graph_work_lock`, `heartbeat_graph_work_lock`, `release_graph_work_lock`, `expire_abandoned_graph_work_locks`. `20260814000100_graph_engineering.sql` and `20260814000200_graph_write_boundary.sql` are renumbered to `20260814002000` and `20260814002100`. `tests/integration/migration-object-collisions.test.ts` asserts that no two migrations create the same table or type, and that the applied schema contains no overloaded `public` function.
- Rationale: merging `main` brought `20260814001200_phase2b_task_graph_and_handoffs.sql`, whose `public.work_locks` is a path-prefix lock for specialist agents, alongside this branch's `public.work_locks`, a resource lease for the graph scheduler. Same name, different columns, different purpose, two agents who never saw each other's file, and nothing textually conflicting for git to flag. Both names had equal claim; the graph engine's was renamed because every other table it creates is already `graph_`-prefixed, so the collision was the one member of that family missing the prefix.
- Consequence: the loud half of this was the table — `relation "work_locks" already exists` halts the chain, though it surfaces as a wasm stack trace naming no migration. The quiet half was worse and is the reason for the second assertion: both migrations defined `release_work_lock(uuid)` with `create or replace`, identical signature, different body. Postgres replaced one with the other silently, and the losing subsystem's locks would never have been released — no error, no failing test, no symptom until something wedged. Function redefinition is a normal idiom here (41 functions are redefined by a later migration), so "defined twice" cannot be flagged; an overload set in the applied schema can be, and it is also a real hazard on its own terms, because PostgREST routes `/rpc/<name>` by name and every function in this schema is called that way. The renumbering fixes a second defect found while resolving this: versions `20260814000100` and `20260814000200` are already rows in the hosted ledger, so `db push` believed both graph migrations applied and would have skipped them permanently. Those two rows now point at no file; `scripts/hosted-ledger-repair.sql` leads with a query that finds that class rather than asserting a position that has already gone stale once.

## ADR-068 - Claude is reached by two transports behind one adapter, and the free one is the default

- Date: 2026-08-15
- Status: Accepted; the subscription transport has no configured credential in any verified environment
- Decision: `lib/providers/claude-auth.ts` resolves Claude authentication with subscription as the default and per-token API billing as an explicit opt-in, mirroring `lib/worker/auth.ts` for Codex. `lib/providers/claude-cli-transport.ts` executes an advisory task through the Claude Code CLI with a built-not-inherited child environment, read-only tools, one turn, and the result schema passed in `outputFormat`. `AnthropicProviderAdapter` selects between that and the existing Messages API path; both keep the same provider id, capabilities, run registry and structured result.
- Rationale: a transport rather than a second adapter, because Phase 2A requires one provider abstraction and a separate pipeline for the free path would have been easier to write and would have quietly become a second provider. Subscription as the default, because a cost rule that holds for Codex and not for Claude is a rule with a hole in it. The child environment is constructed from `controlledProcessEnvironment` rather than `process.env` because a machine running SoftwareFactory may itself be signed in to Claude — this repository's development container is — and an inherited credential would make a successful run prove nothing about the configured one. That isolation is why the live canary cannot yet exercise the credential path, and the isolation is worth more than the green box.
- Consequence: the live canary failed on its first run and earned its place doing so. Claude executed correctly, read the right files, and answered in a schema it invented, because the shared system prompt says "matching the required schema" without ever including the schema — true on the API path, where `output_config` carries it structurally, and false on a transport that carries nothing out of band. The answer is now read from `structured_output` rather than the free-text `result`: enforcement, not persuasion. Two further consequences follow from the same reasoning. `listModels` refuses with `capability_unsupported` instead of returning an empty list, because the CLI exposes no catalogue and an empty list would read as "this provider has no models", which is false and would be believed. And `checkHealth` performs a real one-turn round trip rather than parsing the credential, because a check that only confirmed the credential parses would report **Connected** for a revoked token.


## ADR-069 - Portfolio priority is arithmetic, preemption is a subtraction, and agents are per project

- Date: 2026-08-15
- Status: Accepted; migrations `20260815000100` through `20260815000600` are unhosted
- Decision: `public.effective_work_priority` is an `immutable` function of project priority, strategic focus, emergency status, queue age, a fairness interval and a supplied clock. Emergencies are P0; focus is worth one tier; waiting is worth one tier per interval; neither focus nor waiting can reach P0. `public.portfolio_capacity_verdict` answers whether one candidate may start now and which of the portfolio, project, provider or connection ceilings is binding. `claim_phase1c_run` filters and orders on both, and `20260815000400` gives each project its own logical agents cloned from the organization roster.
- Rationale: the goal asks for preemption and for running work never to be destroyed to reprioritise, and those are the same requirement read from either end. Rather than cancel work, the organization ceiling carries a reserve that only effective-P0 work may occupy, so ordinary work stops short of the ceiling and a slot is always free for an incident the moment any run finishes. That is one subtraction in one expression, with no kill path to get wrong. Aging promotes by whole tiers rather than by score, because a score-based bonus either cannot overtake the tier above it — no anti-starvation guarantee at all — or can reach P0 and empty the emergency reserve with routine work. Tier promotion with a floor of P1 gives a bounded worst case: any queued item reaches P1 in bounded time, and oldest-first within a tier does the rest.
- Consequence: the per-project agent change is the one that had to happen for any of the rest to matter, and it was not obvious from the goal. `claim_phase1c_run` refuses a second concurrent run for one agent, correctly — `agents.current_assignment` names a single task. The logical roster was one QA and one Backend for the whole organization, so two projects doing the same kind of work serialised against each other no matter how much capacity existed. Priorities, ceilings and a reserve would all have been enforced on a factory that still executed one project at a time. `agents.project_id` already existed; the organization row remains the definition of a role and the project-scoped agent is cloned from it on first use, so the console now shows a roster plus the per-project agents each project has actually used.

## ADR-070 - The circuit-breaker cooldown is stated twice, and a test holds the two copies equal

- Date: 2026-08-15
- Status: Accepted
- Decision: `public.breaker_cooldown_seconds` restates `COOLDOWN_MS` from `lib/resources/breakers.ts` in SQL, and `tests/unit/breaker-cooldown-parity.test.ts` reads the constant out of the TypeScript and the `case` expression out of the migration and fails if they disagree, or if a fault class is missing from either. Half-open is not stored: an open breaker past its cooldown admits work, and admitting it restarts the cooldown clock.
- Rationale: Phase 2C's breakers worked and nothing read them, so a provider failing every request kept being handed work while an open breaker in the database said so. Selection is one atomic SQL statement and cannot call into the application, so the rule has to exist in SQL. Two copies of a rule is a defect waiting for someone to change one of them; the alternative — a test that reads both and refuses drift — keeps the duplication honest instead of pretending it is not there.
- Consequence: restarting the clock is what makes "exactly one trial request" true rather than aspirational, and it needs no new column and no new state machine. A second poller in the same window sees an open breaker still inside its cooldown and waits. A trial that never reports back does not wedge the breaker: it frees again after another cooldown. The parity test also pins the *ordering* of the cooldowns, not only their equality, because a change that scaled all five by the same factor would preserve parity while discarding the reasoning that a rate limit clears faster than output that will not parse.

## ADR-071 - AI accounts are identities in the database, and the sign-in is a state machine a worker drives

- Date: 2026-08-16
- Status: Accepted; migration `20260816000100` is unhosted (runbook row added, position unchanged)
- Decision: `public.ai_accounts` records each provider sign-in as a first-class row — provider, auth method, display name, lifecycle status, verification timestamps — holding no secret, only the vault `purpose` its credential is sealed under, with one account per (organization, purpose). `public.ai_auth_sessions` is the broker: pending → initializing → awaiting_user → authenticated → verifying → connected, with failed/expired/revoked terminals, driven exclusively by narrow definer functions (owner-side callable by `authenticated`, worker-side by `service_role`) that each write an activity event. The person's confirmation code crosses the tables only as a sealed envelope; the login URL flows the other way so the browser can open the provider's real page. `bots.ai_account_id` is a nullable composite FK, so a bot's execution identity is a database fact and a legacy bot reads as "no account attached" rather than breaking.
- Rationale: the connect-command flow that shipped first proves the vault and the seal, but it makes the operator's machine the broker — a person copies a command, a terminal runs the provider login, and the web page cannot honestly show progress because nothing it can read knows any. Moving the broker into a session row makes every step observable by polling one projection, makes "connected" a database transition that also seals the credential in the same function (no order in which a crash leaves the label without the token), and gives multiple accounts isolation by construction, since each account owns a distinct vault purpose. The relay-code column is sealed rather than digested because, unlike the connect code, the broker must *read it back* — it is input to the provider's CLI, not merely proof of possession.
- Consequence: the state machine is deliberately wider than the first worker will use — `verifying` exists so "the worker checked the minted token actually works" is a state the browser can watch, not a hope. Failure text is sanitized inside the database (`text_has_likely_secret`, with a withheld-message fallback) so a worker echoing a provider error cannot land a token shape in an audit-adjacent column. The RLS-count guard moves 109 → 111, the tail pins move to `20260816000100`, and the runbook's outstanding set becomes 20; the grants suite needed only its pinned table list extended, because the new tables follow the vault's rule — no direct table access for any role, including `service_role`.

## ADR-072 - The verified Claude connection path is owner-frozen

- Date: 2026-08-16
- Status: Accepted; ordered by the owner in production
- Decision: after the owner verified the end-to-end Claude connection live ("Claude connected, it is working perfectly"), the connection path is frozen at main `74843ef`: no modification to the worker (`lib/worker/auth-broker.ts`, `scripts/auth-broker.mts`, `.github/workflows/auth-broker.yml`), the broker migrations (`20260816000100`–`000700`), the connect UI (`components/ai-account-connect.tsx`), or the `app/api/ai-accounts/**` routes and `lib/ai-accounts/**` without a specific owner instruction. The freeze is recorded in `policies/PROTECTED_RESOURCES.md`, which automated agents already treat as binding. Diagnosis remains allowed — logs, read-only probes, findings — but a fix is a proposal to the owner, not a push.
- Rationale: the path reached working through a chain of live-diagnosed defects (a keystroke that never registered, a scheduling change that traded away coverage, migrations applied out-of-band), and each fix carried real regression risk to the previous fix. A verified-working authentication path is the highest-value, lowest-tolerance asset this product has; the owner's explicit freeze converts "please be careful" into a policy automated loops can obey mechanically.
- Consequence: future work touching adjacent features (bot wiring, fleet views, Codex-specific UI copy) must be shaped to avoid the frozen files or arrive as an owner proposal first. The staleness self-handover keeps workers current with merges that do not touch the frozen set. If the owner reports a defect in the frozen path, the finding-and-proposal loop applies — the freeze is who decides, not whether defects get fixed.

## ADR-073 - The verified Codex connection path joins the owner freeze

- Date: 2026-08-16
- Status: Accepted; ordered by the owner in production ("lock down both the Claude and Codex connections")
- Decision: after the first live Codex connection completed end to end (device-auth flow, account "Codex Daniel", identity `daniel.hughen@gmail.com`, verified 19:06:41Z), the owner extended the ADR-072 freeze to the Codex path at its then-current main configuration: the `codex login --device-auth` driver in `lib/worker/auth-broker.ts` (CLI pinned `@openai/codex@0.147.0`, completion detected via `$CODEX_HOME/auth.json`, nothing pasted back), `lib/ai-accounts/device-login.ts` (the `#sf-device-code=` URL-fragment contract), the device-code branch of `components/ai-account-connect.tsx`, and migrations `20260816000800`–`20260816001200`. `policies/PROTECTED_RESOURCES.md` carries the operative wording.
- Rationale: the Codex path reached working through its own live defect chain — an envelope cap sized for Claude tokens, a verifying-transition guard only the abandoned paste flow could satisfy, a relay loop that drove cancelled sessions blind — and each fix is now proven by a real connected account. The same argument that froze Claude applies: a verified authentication path's regression risk outweighs any incremental cleanup.
- Consequence: both provider paths now change only by owner instruction; diagnosis-and-proposal remains the loop for defects. The freeze inherits ADR-072's boundary — adjacent features must route around the frozen files. A future CLI version bump for either provider is a change to a frozen file and therefore an owner decision, even when upstream deprecates the pinned version.

## ADR-074 - GitHub install legs converge on the configured callback host

- Date: 2026-08-16
- Status: Accepted
- Decision: the GitHub App install launcher (`/api/github/install/launch`) and callback (`/api/github/install/callback`) each compare the request host against the host of the configured `*_CALLBACK_URL` and, on any other alias of the deployment, 303 to themselves on the configured host — query untouched, before any cookie or session work. The state lifetime (token `exp` and cookie `maxAge`, one constant) rises from 10 to 30 minutes. `verifyGitHubInstallState` now fails with three distinct notices — invalid (structure/signature), expired, and started-in-a-different-browser-session (missing cookie) — instead of one blended message, and the Connections console strips the one-shot `github*` notice parameters from the URL as soon as it reads them.
- Rationale: one production deployment answers on the canonical domain and on platform aliases, but GitHub returns the browser only to the host registered on the App — and both the anti-forgery state cookie and the Supabase session cookie are host-scoped. Launching from an alias set the cookie where the callback could never read it, which produced the live `github_state_invalid` ("expired or does not match this session") failure of 2026-08-16 — and because the failure notice rode in bookmarkable query parameters that nothing cleared, the stale banner re-greeted the owner on every reload, masquerading as a persistent fault. Host convergence removes the class of failure rather than one instance; the redirect target comes from server configuration, never the request, so it cannot be steered off-site. Ten minutes was also genuinely too short for an owner finishing an organization install on a tablet; thirty keeps the state short-lived while fitting observed reality.
- Consequence: every install attempt now runs launch → GitHub → callback on exactly one host regardless of where the person browsed, so the sign-in session the callback needs is the one the launcher just verified. A wrong-host arrival costs one extra 303. The webhook path still only updates known installations — the browser callback remains the sole row-creating path, which is why fixing its state flow is what makes `/api/github/connections` return data after an install that previously failed at the callback.

## ADR-075 - A never-started run re-plans to the observed head instead of dying stale

- Date: 2026-08-16
- Status: Accepted
- Decision: when workspace preparation refuses a claim because the planned base SHA no longer matches the live base branch, and the run carries no recovery evidence, the worker asks the database to move the plan: `replan_phase1c_run` (migration `20260816001300`, service_role only) updates `agent_runs.base_sha` to the observed head only while the caller still holds the live lease and the run has no commit (`head_sha is null`). The worker then emits a `replanned_base` run event naming both SHAs and retries preparation once. If the database refuses, the original `stale_base_sha` failure stands. Post-execution staleness — the pre-push and pre-merge base assertions — is untouched and still fails closed.
- Rationale: the planned-exact-base rule assumed a quiet repository. Under the autonomous loop, main moves every few minutes, and on 2026-08-16 three live owner commands died `stale_base_sha` without executing — the strictness designed to protect review integrity was starving the product of its first canary. For a run that never started, "execute against the repository" honestly means the current head; the immutability that matters — never building on one base and publishing against another, never orphaning pushed work — is exactly what the `head_sha is null` guard and the workspace's factory-branch refusals preserve.
- Consequence: queued commands survive merges. The command's submitted parameters remain the historical record; the run row records where execution actually happened, and the audit trail shows the move. The surgical apply path gains migration `20260816001300`; the service-role function pin list gains `replan_phase1c_run`; tail pins move to `20260816001300`.

## ADR-076 - Subscription usage is recorded evidence, captured by the auth-broker sweep

- Date: 2026-08-16
- Status: Accepted
- Decision: per-account provider usage (the subscription's session and weekly windows) is append-only evidence in `ai_account_usage_observations` (migration `20260816001500`), written only by the worker's `record_ai_account_usage` (service_role definer, window payload allowlisted down to its keys) and read only through the member projection `list_ai_account_usage`. The auth-broker worker captures it automatically — at startup, every ~5 idle minutes, and immediately after a sign-in connects — by opening each connected subscription credential inside the same containment `verifyStoredAccounts` uses and probing the provider's own usage endpoint (`lib/worker/usage-probe.ts`; Anthropic's OAuth usage endpoint today, `unsupported` recorded truthfully for providers with no proven endpoint). The Bot Manager renders exactly the latest observation per account — measured windows, a named failure, or "no usage recorded yet" — via `GET /api/ai-accounts/usage`, which treats a database predating the migration as an empty list rather than an outage.
- Rationale: the owner asked for per-bot usage on the Bot Manager with zero manual steps. A number the page computed or defaulted would violate the truthful-status contract, so usage had to be observed evidence with visible staleness. A dedicated scheduled workflow cannot deliver "automated" here — GitHub throttles this repository's cron to near-zero — but the auth-broker worker already lingers through ~6-hour windows precisely because of that, so its sweep is the one reliably-running place to capture from. The probe never demotes an account: connectivity verdicts stay with the verification sweep and real use, so a flaky usage endpoint cannot take a working credential offline.
- Consequence: the owner-frozen connect path (ADR-072/073) gains a read-only sibling under the owner's explicit instruction: `scripts/auth-broker.mts` carries a bounded hook (capture call sites and a cadence constant) and login semantics are untouched. The service-role function pin list gains `record_ai_account_usage`; the policyless-table allowlist and the hosted-like grants matrix gain `ai_account_usage_observations`; the migration tail pins and the hosted-apply runbook's outstanding set move to `20260816001500`. Observations accumulate append-only (~300 rows/account/day at the idle cadence); retention pruning is a future owner decision, not a delete path this phase adds.

## ADR-077 - Navigation subpages link only surfaces that exist

- Date: 2026-08-17
- Status: Accepted
- Decision: the console sidebar implements the owner's subpage design as collapsible groups that open expanded — Projects (All Projects, Archived), Pipelines (Templates, Backlog), Bots (Connect Bot, My Bots, Bot Activity), Settings (General, Bots & Integrations), Watch (Operations, Activity), Advanced (Files, Agents, Resources, AgentOS, Autonomy) — plus a Quick actions section, with top-level labels renamed to the design (Overview, Bots, Integrations). Every href resolves to a real page or a real, anchored page section (`#connect` on Bot Manager, `#providers` on Settings, `#add-project` on Projects). Design subpages with no backing capability — Secrets, My Projects/Shared with Me/Starred, pipeline Active/Schedules/Archived, Members/Teams/Permissions/Billing — are not rendered. The one new capability added to honor a subpage honestly is the Projects Archived view: `GET /api/projects` accepts an explicit `?status=archived` (default reads still exclude archived), and the projects console renders archived rows as records with unarchive pointed at the portfolio page's owner controls.
- Rationale: a navigation entry is a claim that the destination exists. Linking a secrets store or a billing page this product does not have would violate the truthful-status contract the same way a fake status badge would; omitting the entry is the honest rendering of an aspirational design. Groups open expanded so every destination stays one tap away and visible to the accessibility tree — the e2e reachability contract (`tests/e2e/console.spec.ts`) now pins the full 30-label set across all three viewports. Subpage hrefs carrying a query or fragment are never marked `aria-current`, because the pathname alone cannot distinguish them; the page itself states which filter it shows.
- Consequence: nav labels diverge from three page headings (Overview/Dashboard, Bots/Bot Manager, Integrations/Connections) — headings are unchanged this round. The Backlog subpage survives under Pipelines even though the design omits it, because the page exists and must stay reachable. When Members/Teams/Billing or pipeline schedules gain real backing, their entries join the existing groups rather than being redesigned in.

## ADR-078 - Edit and delete controls stop exactly at the audit boundary

- Date: 2026-08-17
- Status: Accepted
- Decision: every mutable record gets first-class edit and delete controls on the surfaces where it lives, and every evidence record stays immutable. Projects: name/description edit via `update_project_details` (migration `20260817000100`; owner/admin, create-path bounds, archived refused, the existing `audit_project_change` trigger records `project.updated`) exposed as `PATCH /api/projects/[projectId]` with dialogs on the All Projects table and the project inspector; archive/unarchive (the delete that keeps history, reason required) surfaced as dialogs and in-place controls on the same surfaces, calling the existing owner-guarded RPCs. Bots: rename existed; retire (`retire_bot`, releases assignments, records `bot.retired`, keeps run history) gains a confirm-in-place control on the Bot Manager roster. AI accounts already had rename/disconnect/remove; runs keep cancel and retry. Deliberately refused: editing or deleting runs, activity events, or any audit record — and any hard project delete.
- Rationale: the owner asked for "everything editable and deletable, in all places." For configuration records that is a real gap this closes. For evidence records it would be self-falsification: the repository contract ("important state transitions must create immutable activity/audit events") exists so that every report and status claim can be trusted; a deletable audit row is not an audit row, and a deletable run row makes "success rate" a fiction. Archive-with-reason is the honest delete for projects because runs, tasks, commands, and events keep their foreign keys; `retire_bot` is the honest delete for bots because the roster row goes while the history stays. Graph templates are code — their edit surface is a pull request, not a form.
- Consequence: the surgical hosted-apply allowlist and the migration tail pins move to `20260817000100`. Every destructive control states its consequence in place before acting (reason-carrying archive dialog, remove-bot confirm naming what is released and what is kept), keeping the default-OFF posture for destruction while making the safe mutations one click. When a true hard-delete is ever wanted, it needs its own ADR against the audit contract, not an extension of this one.

## ADR-080 - The owner operates the safety controls

- Date: 2026-08-17
- Status: Accepted (explicit owner order: "make every single button on the Safety page editable, wired to Supabase, and the action actually does something")
- Decision: the Phase 1D scaffold interlocks — the CHECK constraint locking the kill switch ON, the green-observation-only constraints at both scopes, and the trigger refusals stating "scaffold-only" — give way to owner-gated operations in migration `20260817000600`. `set_autonomy_kill_switch` (owner-only; releasing requires a reason) and `set_organization_autonomy_controls` (owner-only, partial updates) write the real columns and record immutable `autonomy.kill_switch_changed` / `autonomy.controls_changed` activity events; `get_organization_autonomy_controls` is the member-scoped read. Three rules survive as database refusals: the autonomous risk ceiling can never be RED at either scope (new CHECK constraints plus trigger and RPC refusals); organizations and projects are born fail-closed, so authority is only ever an attributed post-creation update; and admins cannot touch these — owner means owner. The Safety page renders live state with real switches (owner) or read-only badges (members), an in-place reason flow for kill-switch release, and per-row "switched on, held off" honesty naming the kill switch, autonomous mode, or a missing capability (merge endpoint, deployment adapter) as the reason a requested action is not effective.
- Rationale: Phase 1D wrote "locked ON until a separately approved future migration introduces a proven executor rollout" — a deliberate exit clause. A Phase 1C worker now exists and claims work, and the owner has ordered the controls operable in writing; this migration is that separately-approved release. Editability moves to the owner; enforcement does not move into the browser — the switch this page shows is the column the server checks, resolution still refuses what the envelope or a missing capability refuses, and every transition is attributed and audit-evented so the trail explains every position the switches have ever held.
- Consequence: the phase1d behavior suite's "nothing was relaxed" section is replaced by "the owner-operated contract" (44 tests green against the migrated schema). Auto-merge and auto-deploy flags are recorded intent with no acting machinery — building a merge endpoint or deployment adapter remains its own future ADR, and the UI says so in place. Tail pins, the surgical allowlist, and runbook counts move to `20260817000600`.

## ADR-081 - The hosted ledger is measured per migration, not assumed to be a prefix

- Date: 2026-08-18
- Status: Accepted
- Decision: `AI/HOSTED_APPLY_RUNBOOK.md` stops describing the hosted position as a high-water mark with everything after it outstanding, and states instead the measured set of ledger-absent versions. The `scope=probe` step in `.github/workflows/apply-hosted-migrations.yml` names, for each of those versions, one object that migration introduces, and prints a `present` boolean per version — so a genuinely missing object appears as `f` rather than as a row that never appears. The two files that only `create or replace` an existing function are probed by a substring of the body they introduce (`agent.project_id = new.project_id` for `20260815000400`, `phase1e-operations-v2` for `20260815000800`), because existence proves nothing about a replacement. The rule the probe feeds: marker present means repair the history row (`migration repair --status applied`); marker absent means the file has genuinely not run and applying it is real DDL. `tests/integration/hosted-runbook-counts.test.ts` holds the runbook's list, the workflow's probe list, and the migration directory in agreement.
- Rationale: probe run `32103778884` printed a ledger with nineteen versions missing from the middle of the sequence and every row above them present, including the whole `20260817` range. No prefix describes that, so the model every earlier count rested on was not stale but wrong — and the specific claim it produced, that the Assign Bots wizard has no configuration columns on production, was false while `20260817000700` was in fact applied. The older probe could not have caught this: it printed only objects that existed, so "absent" and "not asked about" rendered identically, and reading nineteen rows told you nothing unless you already knew nineteen was the expected count. Deriving the counts from a stated position, as the previous guard test did, encoded the wrong model into the thing meant to catch drift in it.
- Consequence: repair-versus-apply becomes a per-file decision an owner can make from one read-only run, rather than a batch decision taken on a false premise. The nineteen-row table is a measurement and carries its run id, so it ages honestly: it is true of 2026-08-18 and a later probe supersedes it. Dated "unhosted" notes elsewhere in `AI/CURRENT_STATE.md`, `AI/HANDOFF.md` and `AI/DECISIONS.md` are left as written and superseded by the dated corrections at the top of the first two, because rewriting historical records to match a later measurement would destroy the evidence trail that made this discoverable. No mutating scope was run: `AGENTS.md` puts RED actions behind explicit owner approval in Phase 1, and the runbook requires a fresh exact approval per apply.

## ADR-082 - A layout harness asserts it is measuring something before it measures it

- Date: 2026-08-18
- Status: Accepted
- Decision: the component layout suite gains four preconditions, each asserted rather than assumed. The Playwright harness webServer may serve a build or permit reuse but not both (`reuseExistingServer: false`, pinned by `tests/integration/responsive-coverage.contract.test.ts`). Every case asserts it renders no sign-in gate heading, and asserts it read no endpoint the fixture server cannot answer; the fixture server answers an unserved URL with a 503 that names it, rather than a 200 with no keys. `open()` collects page errors so a mount-time throw fails with the exception instead of an empty `#root`. The harness defines the `NEXT_PUBLIC_SUPABASE_*` values the browser-configuration gate reads, and the portfolio fixture is produced by calling `buildPortfolio` — the route's own pure aggregator — instead of transcribing its output.
- Rationale: a deliberate defect was introduced into the assign wizard and the entire width sweep stayed green. Four independent causes were behind that, each sufficient alone: a reused `vite preview` serving a build from hours earlier; `overflowing()` returning early because a fixed overlay never widens the document; `process.env` shimmed to `{}` at build time, so every component consulting `isBrowserSupabaseConfigured()` rendered its signed-out state; and unserved endpoints answering 200 with an empty body, which crashed two consoles into rendering nothing while the sweep reported them fitting at every width. The common shape is that a gate, an error card and a blank page all fit every width and reach every control, so they pass every assertion below them unconditionally. Coverage that is derived — which this suite already had — still says nothing if what it renders is a few centred words.
- Also: `responsive.spec.ts` sets a per-test timeout scaled to the number of routes it walks, because thirty-four navigations against a cold `next dev` — which compiles each route on first request — cannot finish inside the default 45s. Ten such failures appeared the moment the long-lived reused servers were cleared, reported as `net::ERR_ABORTED; maybe frame was detached?`, which reads like a layout failure and is a stopwatch. Same species as the stale harness: a result that depended on a server happening to be warm from an earlier run.
- Consequence: the suite then found a real defect on its first honest run — `portfolio-controls` overflowing from 320px to 430px, because a `<select>` of project names has its widest option as its min-content width. Fixed there and on three other selects carrying raw classes rather than the `.input` token that already had the remedy. Thirteen endpoints gained fixtures shaped like their routes, and adding a console that reads a fourteenth now fails until its fixture exists. A dev server was tried as the staleness fix and reverted: compiling per request took the suite from ten minutes to over twenty-five, and one build per run costs seconds.

## ADR-083 - The console sidebar collapses to a rail, and the content width is derived from it

- Date: 2026-08-18
- Status: Accepted
- Decision: the console column gains a compact rail. A toggle at the top of the sidebar switches between a 16rem column and a 4rem rail; the choice is stored under `softwarefactory:sidebar-compact` and read through `useSyncExternalStore` with a `false` server snapshot. Both the column's width and the main region's left padding read one custom property (`--sidebar-w`) declared on the shell root, so the content's available width is derived from the column's rather than maintained beside it. In the rail, navigation links render their icon with the label in `sr-only`, groups render as their own link instead of growing a flyout, and the prose card, section headings and identity card are dropped. The mobile drawer never collapses — it closes. Submenus animate on a grid track from `0fr` to `1fr` with `invisible` while closed.
- Rationale: three items in the standing navigation brief were unmet. There was no way to collapse the sidebar on desktop, so a 1280px laptop gave up 256px permanently; the width was written twice (`w-64` on the aside, `xl:pl-64` on the main) with no way for the two to disagree loudly, so "recalculate the available width" had nothing deriving it; and the submenu appeared instantly while only its chevron animated. A grid track is what makes the reveal smooth without a hard-coded height that goes stale the first time a subpage is added, and `invisible` is what keeps the clipped links out of the tab order — `overflow-hidden` hides them from the eye and not from the keyboard. A flyout from the rail was rejected because it would open over the content, which the same brief forbids outright. `useSyncExternalStore` rather than `localStorage` in an effect: reading storage during render hydrates into a mismatch, and the effect-plus-`setState` workaround is a render the person sees at the wrong width.
- Also: the column's breakpoint moves from `xl` to `lg`, so 1024-1279 gets the rail rather than the phone's drawer — the brief asks for three tiers and there were two. Which tier applies is read from `matchMedia` through the same store pattern, with the widest tier as the answer wherever `matchMedia` does not exist, because a fallback should be the fullest navigation rather than the most reduced. Collapsed submenus carry `inert` and `aria-hidden` as well as the clipping class: a mounted-but-clipped list is still tabbable and still in the accessibility tree, and in a test environment with no stylesheet `invisible` is only a class name.
- Superseded in part by ADR-090: the toggle and its stored preference were removed on owner instruction, so the rail is now decided by viewport width alone. The `--sidebar-w` derivation, the three tiers, and the submenu grid animation described here all still hold.
- Consequence: two tests measure the promise rather than the classes that produce it — the column narrows by more than 100px while the content's usable width grows by more than 100px, every top-level destination stays reachable by accessible name in the rail, and a collapsed submenu's links are hidden to Playwright's visibility rules. Both were mutation-checked. Groups in the rail lose their disclosure, so a subpage is two steps away while collapsed; expanding restores the chevrons, and the group's own highlight still shows when a subpage is current. The `xl` breakpoint still governs where the column exists at all — reducing the tablet footprint further would be a separate change to that boundary, not to this one.

## ADR-084 - A console page carries one menu button, and the site's links live in its drawer

- Date: 2026-08-18
- Status: Accepted
- Decision: `SiteHeader` gains `showMobileMenu` (default true) and the portal layout passes `false`, so below `lg` a console page renders exactly one hamburger — the console shell's. The console drawer gains a "Site" section listing `globalNavigation(...)` for the same viewer, rendered in the drawer only, because on a wide screen those links are already visible in the header above.
- Rationale: the console renders the global header and its own navigation drawer, so a phone showed two identical hamburger icons in two stacked bars — 137px of chrome before any content, and nothing to tell them apart but accessible names nobody sees. The owner's screenshot boxes that second bar. Suppressing a menu is only safe if its destinations survive somewhere, so they move rather than disappear; the console's button is the one kept because it opens the navigation the page is about. The alternative — merging both drawers behind the header's button — was rejected: `AppShell` is rendered standalone in the layout harness with no header above it, so its own opener has to exist regardless, and moving the trigger would have meant lifting drawer state into a shared store for one caller's benefit.
- Consequence: `tests/e2e/responsive.spec.ts` counts the menu buttons on `/solutions` at 390px and then opens the drawer to confirm Platform and Pricing are still one tap away; removing the suppression reports "Expected: 1, Received: 2". A future non-portal use of `AppShell` keeps both its bar and its opener, and any surface that renders `SiteHeader` without its own drawer keeps the header's menu by default.

## ADR-085 - Creating a bot names its account, and the roster can put a bot on a project

- Date: 2026-08-18
- Status: Accepted
- Decision: "Create Bot" opens a dialog listing the organization's connected AI accounts and provisions against the one chosen, instead of calling `provisionBot(connectedAccounts[0].provider)`. When accounts exist but none is connected it says so — with the count and where Reconnect is — rather than opening the add-an-account chooser; with no accounts at all the chooser is still the answer. Each bot on the roster gains **Add to project**, which posts `{bots:[{botId, roleId}]}` to `POST /api/projects/:id/bots`, the same endpoint the project page's Assign Bots wizard uses, so readiness is resolved server-side and the least-privilege defaults apply. The dialog repeats the server's refusal verbatim and names a missing prerequisite (no projects, no roles) with a link rather than rendering an empty dropdown beside a disabled button.
- Rationale: the owner's screenshot shows four accounts, all needing to sign in again, and a "Create Bot" button that opened "Add AI Account" without a word — the console offered to add a fifth account as its answer to "create a bot". Taking the first connected account was also wrong on its own terms: with several accounts there was no way to say which one a bot should run on. And assignment existed only on the project page, so a person looking at their bots had no action available on one; adding it to the roster is where the intent already is. Posting through the wizard's endpoint rather than a new one keeps a single authorization and readiness path — the wizard remains the way to depart from the safe defaults.
- Consequence: `tests/unit/bot-manager-home.test.tsx` covers both flows, including the all-accounts-need-reauth case that motivated this, and both were mutation-checked. The harness fixture for `/api/ai-accounts` now returns `canManage`, which the route returns for an owner or admin and the fixture had omitted — every management control had therefore been absent from the width sweep. Supplying it immediately failed three checks: the roster carried `truncate` on the row rather than the name, clipping its own rename and remove buttons at 320 and 375. That is the same defect the accounts panel documents having fixed, in the copy no test could see.

## ADR-086 - Accounts and bots are selected as sets, and acted on together

- Date: 2026-08-18
- Status: Accepted
- Decision: the account row becomes a column — name and its SELECT control on the first line, the account's facts under it, the state badge at the head of the action row — matching the owner's design. Every account row and every bot row carries a SELECT control whose state is `aria-pressed`, and a bar above each list states the count with the action that applies to it. Selecting accounts offers "Create N bots", which provisions one bot per selected account **sequentially**, passing `additional` after the first of a provider. Selecting bots offers "Add N to a project", which sends the whole selection in **one** request to `POST /api/projects/:id/bots`. Accounts that cannot back a bot are counted separately and named in the bar rather than silently skipped. Each control's accessible name is an `aria-label`, not an `sr-only` span.
- Rationale: the badge was placed by whatever the name's length left over, because the row was one wrapping flex container; as a column each part has a fixed place and the badge sits where it explains the buttons next to it. Selection is a set because the useful actions are plural: several accounts become several bots, and `assign_bots_to_project` already takes up to 25 postings atomically — sending them together is the difference between "these five bots are on the project" and "three are, and you get to work out which two are not". Provisioning is sequential for the opposite reason: `ensureProviderBot` decides whether an organization already has a bot for a provider, so four simultaneous requests for one provider would each read "none yet" before any of them wrote. Counting the unusable accounts separately keeps the button's number honest; a disabled control with no explanation would not.
- Consequence: `tests/unit/bot-manager-home.test.tsx` covers the atomic multi-assign, the per-account provisioning with its skip count, and the pressed state; the first two were mutation-checked by sending one bot instead of the selection and by letting unconnected accounts count. A browser check drives both lists at 320/768/1440 with everything selected, because the selected state — a border, a filled control, and a bar that appears above the list — is a layout that did not previously exist. Pressed state is exposed to assistive technology rather than carried by colour alone.

## ADR-087 - A journey step finishes where it started

- Date: 2026-08-18
- Status: Accepted
- Decision: `BotManagerHome` accepts an optional `projectContext` and `onFinished`. The AI Factory passes the project its journey is already scoped to, and the panel gains an in-place **Add Bots** row: it provisions a bot for each selected connected account that lacks one, identifies the new bots by the ids that appear between two reads of `/api/bots`, assigns those plus any directly selected bots to the project in one atomic call, and returns the caller. The role is chosen in that row rather than in a second dialog. Without a `projectContext` — the standalone Bot Manager — the assign dialog still asks which project, because none is implied. Accounts that cannot back a bot are excluded from the count the button promises.
- Rationale: Connect Bots inside the AI Factory could only connect. The selection had nowhere to go, so finishing the step meant closing the overlay and starting the assign step over from a project picker the page had already filled in — the journey knew the project and made the person say it again. New bots are identified by diffing the roster rather than derived from the account because `/api/bots/connect/provision` answers "made one" or "already had one" and never names a row; deriving an id from the account would be a guess, and a wrong guess assigns the wrong bot to a project.
- Consequence: `tests/unit/bot-manager-home.test.tsx` covers the direct multi-bot case, the create-then-assign case, and the absence of the in-place row when no project is in context; the first two were mutation-checked by dropping `onFinished` and by assigning without the bots that appeared. A `bot-manager-in-journey` harness case puts the row in the width sweep, and its browser check first selects an account that needs signing in again to confirm the offer stays absent for a selection the next request would refuse. Two labels were corrected on the way: "Create 0 bots" now names its reason, and the bulk bar always counts so it never renders the same string as every row's own button.

## ADR-088 - An account that needs signing in again can still back a bot

- Date: 2026-08-18
- Status: Accepted
- Decision: `lib/bots/accounts.ts` states, in one place, which AI accounts can back a bot: `connected` or `needs_reauth`. `pending`, `disconnected` and `revoked` cannot, and an unrecognized status is treated as unusable rather than guessed at. The console separates two facts it had been conflating — "cannot back a bot", which is counted against every offer and whose reason is named, and "needs signing in again", which does not stop creation or assignment and is stated as its own consequence: the bot is created and assigned, but does not run until someone reconnects.
- Rationale: the console was enforcing a rule the server does not have. `evaluateBotReadiness` resolves readiness from whether the credential resolves on the server and nothing else, and that is the same test `POST /api/projects/:id/bots` applies before assigning. `mark_ai_account_needs_reauth` writes only `status` and `last_error` and never touches the vault, so an account whose last verification returned 403 still holds its credential and a bot referencing that slot is `ready` by the server's own definition. The cost of the stricter rule was not cosmetic: a workspace whose accounts had all 403'd was shown "None can create a bot", no Add Bots row, and an empty team with nothing to select — the guided journey had no way forward at all, for a reason that was not true.
- Consequence: the three states that genuinely have no credential material are still refused, so nothing is promised that the assign endpoint would reject. `tests/unit/bot-account-eligibility.test.ts` pins the rule including the unknown-status case; `bot-manager-stalled` reproduces the owner's screenshot as a harness case — four stale accounts, no bots — and asserts a way forward exists from it. Reverting the predicate to `connected` alone fails one browser check and four unit tests. Separately: the intermittent single failure seen in combined gate runs is a live `next dev` rewriting `.next/dev/types` while `tsc` reads it; Next re-adds that path to `tsconfig.json` on every build, so it cannot be excluded, and the operational rule is not to typecheck while a dev server is running.

## ADR-089 - A refusal reaches the person who has to act on it

- Date: 2026-08-18
- Status: Accepted
- Decision: every mutation in the AI-accounts section returns database failures through `databaseErrorResponse` rather than a bespoke house sentence. That helper is the shared policy: it maps the codes it has vetted as client-safe (`22023`, `23502`, `23514`, `42501`, `40001`, `55000`, `P0002`) to a status and passes the database's own message, and stays generic for every other code. Rename keeps one bespoke translation for `23505`, which is deliberately not on that list because a raw unique-violation message names a constraint.
- Rationale: an owner pressed Remove and read "The account could not be removed. (42501)". `42501` is `insufficient_privilege` and covers two unrelated problems — an authorization refusal, whose message is a sentence written in this repository, and a missing privilege on a table, which names the table. The route discarded the message on the reasoning that it might leak schema detail; the effect was to leak nothing and explain nothing, on the one surface where the difference is the whole diagnosis. The original caution was right about unrecognised codes, and the shared helper already implements exactly that distinction, so the fix is to stop bypassing it.
- Consequence: `tests/unit/ai-accounts-routes.test.ts` pins both halves — a `42501` reaches the client with its sentence, and an `XX000` does not reach it at all — and both fail when the bespoke handler is restored. `remove_ai_account` gained behavioural coverage against the real migrated schema for the states production holds: a disconnected account whose credential is already gone, a repeat removal (false rather than a raise), a member, and an outsider's organization id. All four pass, so the hosted failure is a privilege difference on that database rather than the function's logic; the `scope=probe` step now prints the owner of every function and table in this section and whether `authenticated` may execute each, because a `SECURITY DEFINER` function whose owner differs from the tables it writes is exactly how this class of 42501 arises.

## ADR-090 - The console column begins with the menu

- Date: 2026-08-18
- Status: Accepted
- Decision: the console sidebar renders no wordmark and no collapse control. `FactoryMark` is deleted, the "Collapse navigation" button is deleted, and the stored `softwarefactory:sidebar-compact` preference with its `useSyncExternalStore` plumbing is deleted with them. The navigation is the column's first child. The compact rail survives as a width-driven form only: `compact = !expandable`, so 1024-1279 still gets the 4rem rail and 1280 and up gets the full column.
- Rationale: the owner marked both blocks on the live page and asked for them gone, with the navigation moved up into the space they occupied. The mark had already been argued twice — removed as a duplicate of the site header's, then restored at every width against a reference image — and an owner looking at the running product is the authority that ends that loop, not a third re-derivation. Removing the toggle leaves the preference unreachable: nothing can set it, so keeping the store would be dead state that still costs a subscription, a storage read, and a hydration path. The rail itself is not dead, which is why it stays — between 1024 and 1279 it is the only form that fits beside content, and that tier is chosen by `matchMedia`, never by the person.
- Amended by ADR-091: the retract control was asked for again, for pointer devices, and returns at the foot of the column. The wordmark does not return, and the menu still begins the column — that half of this decision stands.
- Consequence: the mobile drawer now carries no identity, which is a real loss and the accepted cost — the drawer is a full-screen overlay above the site header, so when it is open nothing on screen names the product. The e2e guarantee that every route shows a brand link is unaffected: it measures the drawer closed, where the site header answers. `tests/unit/app-shell.test.tsx` asserts both absences and that the navigation is the column's first child, mutation-checked by inserting a block above the menu. The e2e case that clicked the toggle to measure the column narrowing is deleted, since there is no control to click; the tablet-band case that measures the same rail from the viewport still runs.

## ADR-091 - The column retracts where a pointer can ask it to

- Date: 2026-08-19
- Status: Accepted
- Decision: the retract control returns, at the foot of the navigation column rather than the head of it, and is offered only when the column is both wide enough to have two forms (`min-width: 1280px`) and driven by a hovering, fine pointer (`(hover: hover) and (pointer: fine)`). The `softwarefactory:sidebar-compact` preference returns with it and is read through the same gate, so `compact = !expandable || (canRetract && chosenCompact)`.
- Rationale: the owner asked for the bar to "retract and expand when on Windows or macOS devices". That is a question about how a device is driven, and the reliable way to ask it is the pointer, not the platform name. `navigator.platform` reports `MacIntel` on iPadOS, so a tablet would be handed the desktop control; `navigator.userAgentData` is Chromium-only, so Safari and Firefox — on the very machines this is for — fall back to a string browsers have spent years freezing. A hovering fine pointer is what Windows and macOS have and touch devices do not, and it keeps Linux and ChromeOS desktops working, which naming two platforms would have broken for no reason anyone wanted. The control sits at the foot because ADR-090 removed it from the head on owner instruction and moved the menu up; returning it above the menu would undo that instruction while appearing to satisfy this one. The preference is gated rather than read directly so that someone who retracts on a desktop and later opens the same account on a tablet does not arrive at a rail with no control to widen it.
- Consequence: `readPointerDesktop` returns `false` where `matchMedia` is absent, which inverts the fallback used for the width query — the widest tier is always a safe layout, but a desktop affordance offered on the strength of a guess is not. jsdom has no `matchMedia`, so every existing unit test sees the full column and no control, and the new cases stub both queries to model a wide pointer device, a touch device, and the 1024-1279 band. Two are mutation-checked: dropping the pointer gate fails the touch case, and moving the control above the menu fails the position case. The e2e case that measures the column narrowing while the content grows is restored and runs on the desktop and tablet projects, which report a fine pointer, and skips on mobile for the same reason the control is withheld there.

## ADR-092 - Graphs execute through a worker boundary that spends chances honestly

- Date: 2026-08-19
- Status: Accepted
- Decision: recorded graphs are executed by a dedicated worker (`scripts/graph-worker.mts`) through four service-role `SECURITY DEFINER` functions in migration `20260819000100` — `claim_planned_graph`, `record_node_state_as_worker`, `record_graph_artifact_as_worker`, `complete_graph_run_as_worker` — mirroring the Phase 1C worker pattern rather than widening the member-gated run lifecycle. The claim is atomic (FOR UPDATE SKIP LOCKED; the RUNNING run, PENDING node_runs, and the whole node/contract/edge/budget projection are one call), and the worker recompiles the stored rows through the same compiler the console previews with. Three execution semantics are part of the decision: edges carry data (a node's prompt receives its upstream outputs, and missing inputs oblige the node to state incompleteness); a graph whose every run FAILED is re-claimable, bounded at three FAILED runs; and a run in which nothing succeeded because the provider refused capacity (session/rate limit) closes CANCELLED — void, uncounted against the three, under a total-run ceiling of ten — and stops the drain. Migration `20260819000200` re-plants exactly one fixed-id copy of the owner's first-day readiness graph, whose three chances were consumed by infrastructure faults (missing shim, missing CLI, session limit) that are now fixed.
- Rationale: the audit found a complete engine, a complete schema, and a live-proven subscription transport with no wire between them — every planned graph dead-ended. Extending by a worker-facing boundary keeps RLS and member-gating untouched and keeps the worker's privileges enumerable by function name in the security-invariants test. The convergence semantics came from production, one dispatch at a time: run 32209893742 proved a session limit would burn a graph's whole retry budget in thirty seconds, which is spending chances on a refusal that is not an answer. Distinguishing FAILED (a genuine failed execution, counts) from CANCELLED (the provider withheld fuel, does not) is the same distinction the engine already draws between FAILED and CAPACITY_WITHHELD outcomes.
- Consequence: `tests/integration/graph-worker-execution.behavior.test.ts` pins the whole path against the real migrated chain — measured parallel fan-out, fan-in data delivery, containment, terminal finality, re-claim and both caps, CANCELLED voiding with node-level truth preserved, and the re-plant's replay shape (one copy, ever). File-writing nodes remain deliberately outside this executor: they belong to the Phase 1C workspace path and its isolation discipline, and the executor's read-only tool list is what makes parallel analysis nodes collision-proof by construction. The re-plant precedent is bounded on purpose: future exhausted graphs retire normally, and re-planning them is a person's decision in the console.

## ADR-093 - A worker declares what it can execute, and the claim honours it

- Date: 2026-08-19
- Status: Accepted
- Decision: `claim_planned_graph` takes a second, required argument — the executors the calling worker provides — and skips any graph containing a node whose executor is not among them. Migration `20260819001000` replaces the one-argument form rather than overloading it, and rejects an empty set with `22023` instead of matching everything. `lib/worker/executor-support.ts` holds the set (`DETERMINISTIC`, `MODEL`); the store passes it on every claim and the dispatcher in `scripts/graph-worker.mts` reads the same constant, so the two halves cannot drift.
- Rationale: two shipped templates contain ANCHOR nodes — "run the tests and record the result as evidence", "attempt a reproduction and record the observation". The analysis worker has no workspace and no command execution, so it failed those nodes honestly and non-retryably. That was the right answer in the wrong place: the run had already been created, everything below the anchor was BLOCKED, and the graph spent one of its three chances producing a PARTIAL that said only what was knowable before the claim. Ten runs later the graph would retire having never had a chance at a worker that could run it. Refusing the claim costs nothing and loses nothing: the graph stays PLANNED with its full budget, waiting. The argument is required rather than defaulted because a default is exactly how a caller that forgot to declare its executors would quietly start claiming anchor work again.
- Consequence: the in-band ANCHOR refusal in the dispatcher stays as the floor under this, and now names the cause — reaching it means the claim was served by a database predating `20260819001000`. `tests/integration/graph-worker-execution.behavior.test.ts` drains every other claimable graph first, so the null claim it then asserts is a refusal of the anchor graph rather than an empty queue, and proves no run was created and that an anchor-capable worker still gets it. The accepted cost is that a graph no worker can run is now invisible rather than visibly failing: it produces no runs at all. That is the honest state — nothing executed — but it means "planned and unclaimable" is a state the console does not yet name, and naming it is open work.

## ADR-094 - A failed usage probe must not impersonate a broken account

- Date: 2026-08-19
- Status: Accepted
- Decision: three coordinated changes around the AI-account usage evidence. (1) `probeAnthropicUsage` treats HTTP 429 as pacing, not failure-of-anything: it honors a small `Retry-After` (≤10s) with exactly one in-pass retry, and when it still cannot measure, records a detail that says what 429 means — the account itself is unaffected. (2) Migration `20260819001100` widens `list_ai_account_usage` to carry the latest observation AND the latest *measured* observation per account, so one failed probe cannot erase the last real numbers from the console; the Bot Manager renders those numbers under their own timestamp with the failed newer probe named beneath them, and a never-measured account reads "Usage not measured yet" in muted text — the amber tone is gone from all probe-failure states, because account health is the badge's statement and the probe's failure is not evidence about it. (3) The auth-broker's startup usage capture is skipped on push-triggered runs: those are handovers whose predecessor probed within the last five minutes, and today's merge trains turned that into a burst of identical reads — the probable cause of the 429 itself. Dispatch, schedule, and manual runs still probe immediately.
- Rationale: the owner saw "Usage unavailable … The usage endpoint answered HTTP 429." in amber beside a green Connected badge and read it as the account being broken. Every layer had told a small truth that composed into a lie: the probe recorded a bare status code, the projection returned only the newest row, the component painted any non-measured row amber, and the workflow's push trigger multiplied probes by the day's merge cadence. The account was connected, verified minutes earlier, and ready for use.
- Consequence: `tests/unit/account-usage.test.tsx` pins all five render states including both new ones and asserts the amber class is gone from probe-failure states; `tests/unit/usage-probe.test.ts` pins the single bounded retry (honored small Retry-After, refused large one, no retry without the header, at most one retry ever); `ai-account-usage.behavior.test.ts` proves the widened projection carries the measurement past a newer failure and stays null for a never-measured account. `20260816001500` gained a guarded drop of `list_ai_account_usage` so the replayed sequence converges in any order — the same lesson `list_graph_runs` taught in apply 32272188607. The accepted cost of skipping startup capture on push handovers: after a merge, a *brand-new* account connected during the handover gap waits up to ~5 minutes for its first observation, which the connect-time capture already covers in the common case.

## ADR-095 - Usage is a property of the connection, and this connection cannot measure it

- Date: 2026-08-19
- Status: Accepted
- Decision: an HTTP 403 from the Anthropic usage endpoint is recorded as `unsupported` — "usage is not measurable for this connection" — with the provider's own behavior stated in the detail, rather than as an `unavailable` failure the next sweep implies it might cure. `captureUsageForAccounts` accepts a caller-owned `unmeasurable` set: within one worker's window an account that answered 403 is not re-probed (still counted truthfully as unsupported), and a fresh worker re-checks once, so a provider policy change is noticed within one handover. The Bot Manager renders the recorded reason for unsupported observations instead of the generic "not measurable for this provider yet" sentence.
- Rationale: measured, in three steps. The probe diagnostic showed every post-reset probe answered 403 while carrying a valid bearer. The client-identity fix (User-Agent, Content-Type mirrored from the pinned CLI's own bundle — PR #278) changed nothing: four more 403s. The CLI bundle then supplied the mechanism: the interactive login requests `user:profile, user:inference, user:sessions:claude_code, user:mcp_servers`, while a token consumed via `CLAUDE_CODE_OAUTH_TOKEN` — which is what `claude setup-token` mints and what the auth-broker seals — is inference-scoped, and the same token demonstrably runs graph inference in production while usage declines it. That is not a fault to retry every five minutes (288 identical evidence rows a day); it is a durable property of the credential type this system deliberately uses.
- Consequence: the owner's Bot Manager now states the exact truth: the account is Connected and fully operational for running bots, and usage is not measurable for this connection type, with the reason on the card. Real usage numbers require a fuller-scoped interactive sign-in flow (sealing the claude.ai OAuth token with refresh handling) — recorded in `AI/BACKLOG.md` as a designed increment, not smuggled in. `tests/unit/usage-probe.test.ts` pins the 403 mapping and the memo (probe once per worker, count truthfully, never re-record); the component test pins the connection-aware rendering. The 429 retry and last-measured projection from ADR-094 stay: they serve transient failures, which still exist.

## ADR-096 - Job Seeker: person-scoped data with the approval gate in the schema

- Date: 2026-08-20
- Status: Accepted
- Decision: the /job-seeker surface (owner goal) is built on eight `job_seeker_*` tables (migrations `20260820000100`/`000200`) scoped by BOTH organization_id and user_id, with RLS requiring organization membership AND row ownership on every operation — career data is personal even inside a tenant, so an admin cannot read a member's employment history. Three invariants live in the schema: the approval gate (no application stage at or beyond APPLIED unless approval_status='approved', with decision evidence required — CLOSED exempt so rejected applications can close), duplicate protection (unique on normalized company+title+external id per person), and score integrity (each match component bounded by its published weight, total equal to the sum, qualified derived from the person's threshold). Generated documents are append-only versions; outreach cannot claim 'sent' without a sent_at, and nothing sets one because no send integration exists. The page hard-gates server-side (readViewer → redirect to sign-in), unlike the /solutions pages' client-rendered signed-out states, because the requirement is "only accessible to logged-in users" and a redirect is that requirement. Scoring weights (30/20/15/10/10/10/5, threshold default 80) are defined in `lib/job-seeker/scoring.ts` and in `job_seeker_breakdown_valid`, held equal by a behavior test.
- Rationale: the goal demands "approval gate cannot be bypassed" and "never fabricate" — both are strongest as database CHECKs, matching how the repository already enforces truthfulness (usage windows, outreach evidence, append-only observations). Direct RLS table access (the projects pattern) fits a CRUD-heavy personal surface better than the definer-function boundary used for privileged multi-role flows; the validators are granted to authenticated because CHECK constraints execute as the writing role.
- Consequence: increment 1 ships profile+preferences CRUD, the gated page, navigation, and honest empty states naming next steps for discovery/applications/analytics. `job-seeker-foundation.behavior.test.ts` proves ownership privacy, shape refusal, the dupe key, the gate (including the approved path and the CLOSED exemption), document immutability, sent-honesty, and engine-schema weight equality against the real migrated chain. Remaining increments recorded in AI/BACKLOG.md: job recording + scoring UI, application workspace + CRM, agent orchestration through the graph engine, uploads (needs a storage bucket decision), analytics.

## ADR-097 - The Job Seeker surface is verified by a real-stack browser journey, and embed reads tolerate PostgREST's one-to-one shape

- Date: 2026-08-21
- Status: Accepted
- Decision: the owner's "prove every capability works, wired to Supabase" goal is answered by `tests/e2e/job-seeker-journey.spec.ts` — one serial Playwright test, guarded by `JOB_SEEKER_E2E=1`, that runs only against a real stack: `supabase start` (the full production migration chain on real Postgres, PostgREST, and GoTrue), the production `next build` served by `next start`, and a pre-confirmed fake user minted through GoTrue's admin API. It signs in, onboards a workspace, fills every field of every section with fake data, uploads a resume, records and scores a job, exercises the duplicate refusal, walks prepare → review → approve → applied, saves a contact, drafts outreach, reads analytics, and proves persistence by reloading. Alongside it, `toView` in the jobs route reads embedded relations through `firstEmbed()`, which accepts a single object or an array.
- Rationale: the mocked suites all passed while the live surface was broken in three ways, and one of them was a wiring bug of exactly the kind mocks canonize: `job_seeker_matches` and `job_seeker_applications` both carry `unique (job_id)`, so live PostgREST returns those embeds as objects, while the code — and every mock written from the code — assumed arrays. Only a browser driving the real stack could catch that, the no-workspace dead end, and the empty-history-entry 422. The journey is env-guarded because it needs infrastructure CI does not provision today; it is committed rather than kept as a scratch script because it is the reproducible definition of "everything works".
- Consequence: the no-workspace path is now a first-class flow (server redirect to onboarding with `?next=`, client 409 call-to-action pinned by a unit test), untouched added history entries are pruned before save (unit-pinned), and the embed shapes are tolerated in both forms. Re-running the journey requires wiping the `job_seeker_*` tables with TRUNCATE — generated documents refuse row deletes by design — and, in sandboxes that forbid rlimit syscalls, excluding the nonessential Supabase services from `supabase start`. Open work: a CI lane that provisions the stack and runs the journey on a schedule instead of on demand.
## ADR-098 - Use records a project's pipeline, and planning a graph keeps its own button

- Date: 2026-08-18
- Status: Accepted
- Decision: `project_pipelines` records which templates a project runs — many per project, built-in or custom — with RLS and FORCE RLS, every table privilege revoked from `anon`, `authenticated` and `service_role`, and three definer functions as the only path: `select_project_pipeline` and `deselect_project_pipeline` (owner/administrator, audit-evented, advisory-locked per project-and-key) and `list_project_pipelines` (member). **Use** on a template card toggles that record — grey and `aria-pressed` when selected, accent when not — and the AI Factory's Configure Pipeline step reads it: done only when at least one pipeline is selected, with the chosen names on the page rather than only inside the overlay. The heavier act Use used to perform, planning a real graph, moves to its own **Plan graph** button and its own dialog. A built-in carries no `template_id`, because it lives in source; a custom one carries its row id, so deleting the template takes its selections with it.
- Rationale: the owner reported that Use did nothing that lasted. It did do something — it opened a dialog that planned a graph — but that is scheduling work, not choosing a pipeline, and neither act left a mark the journey could read. So Configure Pipeline was `done: activeProject !== null`: it went green the moment step 2 finished, which made it the one step on the page nobody could work on, and the one whose green tick asserted something no record supported. Names are resolved at read time from `GRAPH_TEMPLATES` for a built-in and from `graph_templates` for a custom one rather than denormalized onto the selection, so a template renamed in code or in the editor cannot leave a stale label behind. Selecting is idempotent because a person pressing a toggle twice has expressed one intention; a repeat returns the existing row and writes no activity event, since an audit trail of unchanged state is noise rather than evidence.
- Consequence: `tests/integration/project-pipeline-selection.behavior.test.ts` runs the real migration chain — many selections, the idempotent repeat, per-project scoping, custom-template cascade, the archived-project refusal, a mismatched organization id, and owner-allowed / member-denied / outsider-denied / anonymous-denied in both directions plus the absence of any direct browser write path. `tests/unit/project-pipelines-routes.test.ts` and the two component suites cover the boundary and the toggle. The migration is **unhosted** as of this change, so `/api/project-pipelines` reports PGRST202 as **Not Connected** and the console disables Use naming that reason, rather than rendering an empty selection set that would make a working button look broken; `.github/workflows/apply-hosted-migrations.yml` carries the file in its `broker-functions` scope, and `AI/HOSTED_APPLY_RUNBOOK.md` states it is outstanding.

## ADR-099 - A lifecycle gate belongs to the graph node, not the node run

- Date: 2026-08-21
- Status: Accepted
- Decision: `graph_gates` is keyed `unique (node_id)`. A gate opened on one run is the same gate on every later run of that graph, and a decision made against one run is visible to all of them.
- Rationale: `claim_planned_graph` inserts a fresh set of `node_runs` at PENDING on every claim — the worker re-runs a graph from the beginning. A gate keyed to a node *run* would therefore be a new, undecided gate each time, and a lifecycle could never pass its first human decision however many times someone approved it. Keyed to the node, an approval is a fact about the work rather than about one attempt at it, which is what makes progress monotonic under a re-running worker. The request-driven executor this branch originally built never had to solve this, because it advanced one persistent run; the move to main's worker is what surfaced it.
- Consequence: re-running a lifecycle after each approval re-executes the stages before the gate. With no provider connected that costs nothing today, and it is exactly what main's worker already does for every other graph — if it becomes expensive the answer is resumable claims, not run-keyed gates. `open_node_gate_as_worker` is idempotent on the key and returns an existing decision untouched, so a re-claim cannot manufacture a second gate or reopen a decided one. Asserted by "carries that approval into the next run" and mutation-checked by scoping the claim's gate join to the current run, which reproduces the bug as `expected null to be 'APPROVED'`.

## ADR-100 - A gate-held node reports as failed to the engine and as held to everyone else

- Date: 2026-08-21
- Status: Accepted
- Decision: a node waiting at a gate returns `{ status: "FAILED", retryable: false, gateHeld: true }` from the worker's executor. The engine treats it as a failure; `runClaimedGraph` excludes it from the failure count, records it as VERIFYING rather than FAILED, and reports it in `awaitingGate`.
- Rationale: the scheduler's only mechanism for stopping dependents is a dependency that did not complete, and a node awaiting a decision genuinely has not completed. But it did not fail, and counting it as one would spend the graph's three chances on a lifecycle that is merely waiting for a person. `capacityWithheld` already carries exactly this shape — "this did not fail, it did not happen" — so the new flag follows a pattern the codebase had already argued through rather than inventing a second vocabulary for the same idea.
- Consequence: `nodesFailed` had to stop counting held nodes as well; it is computed from the engine's state map, where the node is FAILED, and the count is what a reader sees. A test drove the real worker to a held gate and caught it reporting one failure where none had occurred. Anything reading `finalState` sees PARTIAL, which is accurate: work stopped short of the goal and a decision is owed.

## ADR-101 - A rejected gate answers 200, and an approval says the work has not resumed

- Date: 2026-08-21
- Status: Accepted
- Decision: `POST /api/graph-gates/{id}/decide` returns 200 for a rejection, carrying the recorded decision; and an approval's note states that the worker picks the graph up on its next claim.
- Rationale: rejecting is a decision, not a failed request. The stage stays blocked and its dependents stay skipped — that is the intended outcome — and a 4xx would tell the caller their request was malformed when it was granted exactly as sent. Separately, "approved" reads like "and now it is running": the worker is a polling claimant, so approval changes what the *next* claim will do and nothing at the moment of the click. A console that let someone infer otherwise would be the same class of error as reporting a queued run as work in progress.
- Consequence: the route keeps no authority check of its own — `decide_node_gate` refuses a human gate without manager authority and an automatic approval without anchors, and `databaseErrorResponse` already classifies both codes as client-safe, so the caller receives the sentence this repository wrote. A second check here could drift from the one that actually holds. The panel shows that sentence verbatim rather than a friendlier substitute, because it is the only text that says why.

## ADR-102 - The hosted lifecycle gets its own scope, and scope order is a documented property

- Date: 2026-08-21
- Status: Accepted
- Decision: `.github/workflows/apply-hosted-migrations.yml` gains `scope=lifecycle`, which applies exactly `20260821000100` and `20260821000200` and records both in history. It does not use `scope=all`, and it does not extend `scope=broker-functions`. Alongside it, the fact that replayed scopes overwrite each other's function bodies is written down as a property of the system rather than left to be rediscovered.
- Rationale: the hosted ledger is not a contiguous prefix of the repository — probe run `32531787440` shows nineteen versions absent in the middle while every row above them is present — so `scope=all` would sweep nineteen unrelated migrations onto production as a side effect of shipping two. Each of those nineteen is a separate decision with a separate blast radius, and bundling them removes the owner's ability to make any of them. A narrow scope keeps them outstanding and separately decidable. The prerequisite for the narrow scope was measured, not assumed: `20260821000200` rebuilds `claim_planned_graph` and `list_graph_runs` verbatim from `20260819001000` and `20260819000800`, and the same probe shows the whole `20260819` range recorded on both sides of the ledger.
- Consequence: the surgical scopes replay whole files, so the last one dispatched wins any function both define. Running `scope=broker-functions` after `scope=lifecycle` reinstates a `create_graph_from_plan` that ignores `lifecycle_stage`, `gate_kind` and `is_feedback`, and lifecycle graphs are then planted with no gates — a failure with no symptom, since the graph runs to completion looking successful. Nothing is corrupted, because the lifecycle body is a strict superset and re-running the scope restores it, so the remedy is ordering rather than repair. `AI/HOSTED_APPLY_RUNBOOK.md` states it where an owner will read it, and `tests/integration/hosted-scope-replay.behavior.test.ts` proves against real PostgreSQL that the replay survives, that no dropped `claim_planned_graph` overload is resurrected by it, and that replaying the lifecycle scope afterwards restores both bodies and the grants the drop discarded.

## ADR-103 - A replayed migration drops a function it shares before creating it

- Date: 2026-08-21
- Status: Accepted
- Decision: any migration in a replayed scope that defines a function another replayed migration also defines must `drop function if exists` it first, with its full argument list. Applied here to `create_graph_from_plan` in `20260819000300` and `20260821000200`, and to `claim_planned_graph` in `20260819000100` and `20260821000200`.
- Rationale: `create or replace` cannot change an existing function's return type. The day any version of a shared function widens its signature, every replay of an older one dies on that statement — and because the workflow applies files in a loop with `ON_ERROR_STOP`, it dies *halfway through the list*, leaving the migrations behind it unapplied. That is not hypothetical: apply run `32272188607` failed exactly there and left a security migration unapplied behind it. Dropping first makes a replay structurally safe regardless of which version ran last.
- Consequence: `tests/unit/migration-versions.test.ts` enforces it across every file the workflow names, so a new migration that redefines a shared function cannot merge without the guard. The drop discards grants, so each file re-grants after creating — `20260819000100` and `20260821000200` both already did, and the replay test asserts `service_role` can execute and `authenticated` cannot once the dust settles. The drop does *not* prevent an older file's replay from recreating an overload a newer one removed; only list order does that, which is why `20260819001000` runs after `20260819000100` in `scope=broker-functions` and drops both overloads before creating the two-argument one.

## ADR-104 - FirstMate contributes a briefing invariant, not a runtime dependency

- Date: 2026-08-21
- Status: Accepted
- Decision: adapt the Bearings information architecture reviewed at FirstMate commit `738460d401b1115dab617c3859077973977615cb` as a SoftwareFactory-native, read-only Factory Briefing. Every represented work record belongs to exactly one lane—Needs owner now, Underway, Recently finished, or Up next—under deterministic precedence. A task owns its linked run; cancelled records are omitted with disclosure; unknown states demand inspection; bounded display caps retain total counts. The browser reads eight existing caller-scoped safe projections with `no-store`, in parallel, using source timeouts, batch cancellation, and stale-response protection. Any missing, malformed, or saturated source is named and prevents an empty lane from being called clear. Briefing-specific response modes minimize fields at the server boundary. The summary exposes no prompt-derived task title, command prompt, inbox body or choices, provider output, graph node/artifact/verification detail beyond the verdict needed for fail-visible classification, secret, raw database row, or mutating control; malformed graph verification evidence fails the source read closed. Actions navigate to authoritative screens that re-read and re-authorize state.
- Rationale: FirstMate's strongest reusable idea is one quiet, complete bearings view, while its implementation is a single-user Bash/session distribution built around local state, ambient provider sessions, and terminal backends. SoftwareFactory already has stronger multi-tenant persistence, RLS, audit, worker leases, graph execution, and draft-PR boundaries. Importing FirstMate's runtime would duplicate those systems and weaken their trust model; reimplementing the information invariant makes the fragmented state legible without widening authority.
- Consequence: the Dashboard replaces its standalone attention block with `FactoryBriefing`; the existing detailed consoles remain authoritative. The recorded logical Orchestrator may be labelled as coordinator but must not be described as a live mission supervisor. A future single server-side briefing projection, durable keyed decisions, explicit analysis-versus-code contracts, restart checkpoints, or graph-to-Phase-1C child runs are separate reviewed increments. FirstMate's Relay/public intake, shell/tmux workers, flat-file state, raw launch escape hatches, credentials, merge scripts, and autonomous modes are not adopted. No copied FirstMate code or assets are included, so no third-party source file was introduced; the reviewed project remains credited here with its pinned commit and MIT license.

## ADR-105 - Public job boards are identifier-driven, not credential-gated

- Date: 2026-08-21
- Status: Accepted
- Decision: the Greenhouse and Lever import adapters are reclassified as PUBLIC adapters and given real `fetchPostings` implementations against the providers' public, keyless APIs (`boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`, `api.lever.co/v0/postings/{site}?mode=json`). What each needs is not a credential but an *identifier* — which company's board to read — and that is user input on the page, not an environment secret; their former `SOFTWAREFACTORY_GREENHOUSE_BOARDS`/`_LEVER_SITES` requirements are dropped as an artifact of misclassification. `POST /api/job-seeker/import` takes `{source, identifier}`, fetches at most 40 postings per request (the response always states the board's true total), and records each through the same evaluate → job → match → application chain as manual entry via the shared `lib/job-seeker/record.ts`; a posting that trips the credential scanner is skipped and counted, a unique-index conflict is a counted duplicate, and every count in the response is a count of something that happened. LinkedIn remains a CREDENTIALED adapter: detection-gated on its named variables, no fetch implementation, Not Connected on the page.
- Rationale: the owner's goal — the discovery page 100% operational — was blocked on "credentials" two of the three sources never actually needed. Probed live before writing code: Greenhouse answers a 575-posting board and a clean 404 for a missing token; Lever answers postings ({text, categories.location, workplaceType, descriptionPlain, lists, hostedUrl, id}), 404 `Document not found` for a missing site, and `[]` for an empty one. Greenhouse ships its content entity-escaped with entities inside, so HTML-to-text decodes twice around the tag strip. Lever's public payload names no company, so the site identifier the person typed is the attribution stored.
- Consequence: the discovery page has two real ways in — manual recording and public-board import — and job rows carry `via {source}` attribution. The journey's discovery phase now exercises the live provider round-trip (a missing board's verbatim refusal, then a real board imported and scored; locally proven: 40/40 imported rows scored and in the pipeline). The accepted trade: the journey carries one external dependency, taken deliberately because live import is the capability under proof; and one import request reads at most 40 postings, bounded work stated in the reply rather than hidden pagination.

## ADR-106 - A Factory command binds one immutable route before mutable state can change

- Date: 2026-08-21
- Status: Accepted for the release candidate; not yet hosted
- Decision: an authenticated organization owner may submit or exactly replay a Factory command through the database-owned routing transaction. The transaction delegates command/task/run creation to the established submission boundary, rechecks the stored effective risk, deterministically selects an eligible project pipeline and configured bot assignment, and writes an immutable route containing pipeline/template, assignment, bot, role, provider, resolved model, work effort, and risk/configuration snapshots. The API returns that locked database snapshot rather than its pre-transaction estimate. An idempotent replay resolves this durable route before reading mutable project, pipeline, roster, readiness, or capacity state. Missing hosted routing functions fail closed as Not Connected/503. Selection creates no worker dispatch or autonomous authority.
- Rationale: a TypeScript selection can explain candidates, but it cannot make history durable or prevent a retry from being silently rerouted after an owner edits pipeline selection, assignments, bot configuration, risk, readiness, or capacity. Replaying before mutable reads makes the original accepted route the authority; the database's owner check, locks, effective-risk recheck, immutable table, and audit boundary prevent a caller or later configuration from rewriting it.
- Consequence: `20260821000400_command_factory_routing.sql` is frozen at 34,999 bytes with SHA-256 `e45149db3ca7c66a27934b0b49ac160e1b5ef597fc8f34ad8547de4759086598`. It remains unhosted while production has `20260821000300` and the old application copy. Submission introduces no dispatch or autonomy change; no connected/fresh worker was observed, and merge/deploy/rollback remain Not Connected. Hosting requires separate authorization after containing and remeasuring the current blockers: five linked lint errors/ten findings, one raw organization with `autonomous_mode = true`, one with `autonomy_kill_switch_active = false`, two projects effective-kill-off, and no connected/fresh worker; then exact ledger, ACL/RLS, immutability, risk, replay, and live owner-acceptance evidence.

## ADR-107 - Logical agents are selectable into a project's AI Factory

- Date: 2026-08-22
- Status: Accepted
- Decision: the owner's goal "make the agents on /solutions/agents selectable into the AI Factory" ships as the exact mirror of pipeline selection (the hosted-proven 20260821000300 pattern): migration `20260822000100_project_agent_selection.sql` adds `project_agents` (RLS + FORCE RLS, every table privilege revoked from anon/authenticated/service_role) with three definer functions — owner/administrator `select_project_agent`/`deselect_project_agent` and member `list_project_agents` — each audit-evented ('agent.selected'/'agent.deselected') and advisory-locked per project-and-agent. An agent is selectable into a project when it belongs to the same organization and is either organization-wide (the standard roster) or already bound to that project; an agent bound to another project is refused in the database. `/api/project-agents` exposes GET/POST/DELETE, reporting the unapplied-migration state as itself (Not Connected, 503 on writes) rather than as an empty list. One shared component, `ProjectAgentSelector`, renders the toggles on /solutions/agents (standalone, with its own project picker) and inside the AI Factory's new "Select Agents" step (the journey hands in its project), so the two surfaces read and write the same records and cannot disagree. The step is done when at least one agent is included, with the included names as its on-page evidence.
- Rationale: the Agents page defined the eleven standard roles and their per-agent provider/model assignment, but nothing connected the roster to the factory: there was no record saying "this factory uses these agents" for the journey to read. The pipeline-selection precedent already answers every design question this raises — where authority lives (definer functions under the caller's identity), what selection means (routing intent, never execution), how absence is reported (Not Connected, never a vacuous empty), and how the factory consumes it (scoped to the journey's project, evidence on the page).
- Consequence: `project-agent-selection.behavior.test.ts` proves the contract against the real migration chain (16 cases: stickiness, idempotency, per-project scoping, audit events, cross-project and cross-tenant refusals, member read-only, outsider/anonymous denial, no direct table path, archive semantics); `project-agents-routes.test.ts` pins the route boundary (10 cases) and `project-agent-selection.test.tsx` the component (5 cases). The factory journey grows to nine steps and its suite pins the new step's done/evidence semantics. The apply workflow gains `scope=agent-selection` (one file, replay-safe) for the hosted database; until it runs there, the page says Not Connected and the step's evidence names the missing migration.

## ADR-108 - A subscription bot is the exact AI account it runs as

- Date: 2026-08-22
- Status: Accepted for the local release candidate; protected publication and hosted migration pending
- Decision: provisioning from an AI account carries that exact tenant
  `ai_accounts.id` into `ensure_ai_account_bot`. PostgreSQL derives provider and
  credential slot, returns the exact bot UUID, and enforces tenant/account/
  provider/reference coherence on later bot writes. A default/non-additional
  request reuses that account's bot or may adopt one unambiguous matching
  legacy bot in place and never guesses among several; an explicit additional
  request creates another distinct bot with the same exact account binding.
  `bots.revision` and `bot_assignments.revision` initialize at 1, increment on
  every update, and refuse overflow. An existing posting may be assigned,
  moved, configured, paused/released, or have model/work effort changed only
  when its expected assignment UUID, project UUID, and revision still match
  under the same row lock and transaction; checked edits refuse released
  history. Existing role/configuration is preserved unless explicitly changed,
  and the client verifies both the write result and committed read model.

  Readiness is persisted only by the service-role-only
  `record_bot_readiness_preserving_disabled`, which carries an owner/admin actor
  and compares exact bot revision, account UUID, provider, model, credential
  reference, and base URL under lock. A stale check fails, a check cannot author
  Disabled, and an already Disabled bot is returned unchanged. Legacy
  registration/assignment/readiness mutation definitions, signatures,
  `SECURITY DEFINER` attributes, and pinned search paths remain unchanged;
  `register_bot` also retains its ACL. Legacy assignment/readiness mutation
  execute ACLs are intentionally revoked and replaced with authenticated
  checked wrappers plus the service-only readiness recorder.

  The roster filters released history before keyset-paging open assignments by
  UUID until an empty terminal page. Short pages are not terminal; invalid
  progress or the page bound fails the entire read. AI Factory uses one modal
  and embeds its roster/editor/starter flow. With no roles, Backend engineer is
  the starter default saved through the audited role API, and the returned UUID
  fills blank selected drafts; Developer is the separate new-posting permission
  preset, while an existing posting retains its role/configuration. Broker
  start/retry/close/unmount cleanup is serialized and every async result is
  fenced by exact session UUID plus generation.
- Rationale: provider plus credential-variable name is not an execution
  identity. Two accounts may share a provider, credential slots are numbered,
  and a legacy bot may already carry assignments that must not move to a newly
  generated id. Likewise, checking a posting before the RPC is a time-of-check/
  time-of-use race: another manager can move or tighten it between the read and
  the row lock, after which a stale wizard silently restores old permissions.
  Readiness calculated only from environment variables reports a valid sealed
  subscription credential missing, while readiness calculated without
  respecting Disabled grants an implicit re-enable. All four are identity
  failures, not presentation defects.
- Consequence: migration
  `20260822000200_register_bot_for_ai_account.sql` is frozen at SHA-256
  `39c8a4ae633e2e45dc71a754225ca54c9ef9dd27036f7b68dca6371e1c394981`.
  Its protected `scope=bot-account-binding` verifies predecessor/absence state
  and the exact hash, applies only that file, performs catalog/runtime checks,
  and records one ledger row; broad apply refuses to introduce it. Until a
  final rebased head passes all gates, receives fresh exact RED approval, is
  published, hosted, deployed, and accepted in an authenticated owner session,
  this remains a candidate and production retains the old behavior. None of
  it executes a bot or changes provider-login protocol, worker, autonomy,
  approval, merge, deploy, or rollback authority.

## ADR-109 - Bot-account binding ships EXPAND before legacy mutation grants CONTRACT

- Date: 2026-08-22
- Status: Accepted for the local release candidate; supersedes ADR-108 only for migration promotion order and legacy assignment/readiness ACL handling
- Decision: `20260822000200_register_bot_for_ai_account.sql` is the EXPAND half
  of a rolling database/application cutover. It adds exact AI-account binding,
  revisions, triggers, checked assignment boundaries, and the service-only
  readiness recorder without changing the definitions, signatures,
  `SECURITY DEFINER` attributes, pinned search paths, or exact ACLs of the six
  legacy RPCs used by the currently deployed application: `assign_bot`,
  `assign_bots_to_project`, `update_bot_assignment_configuration`,
  `update_bot_assignment`, `set_bot_assignment_execution`, and
  `record_bot_readiness`. Each retains authenticated execution and the existing
  public/anon/service-role denials. Revocation is deferred to a separately
  reviewed, owner-approved forward CONTRACT migration after the exact
  replacement application SHA is deployed and its signed-in create, bind,
  assign, configure, readiness, audit, and reload behavior is accepted.

  The immutable `bot.registered` event for a newly bound bot and the
  `bot.updated` event for an adopted legacy bot both carry the exact
  `ai_account_id`. Before applying, the migration and protected workflow refuse
  any pre-existing new helper/checked function, revision trigger, revision
  column, or revision constraint rather than replacing or normalizing unknown
  catalog state. Before any DDL they also pin exact definition hashes, owner,
  language, kind, volatility, security, search path, overload set, and ACL for
  `register_bot` plus all six delegated legacy mutators; a missing, cross-tenant,
  non-subscription, or otherwise incoherent historical binding is refused.
  After DDL, the migration itself proves the exact ten-function catalog and
  exact revision/default/constraint/trigger catalog, including rejection of an
  unexpected grantee inherited from custom default privileges. The protected scope proves migration identity, predecessor/
  target ledger state, clean pre-apply catalog, exact legacy definition/
  security/search-path/ACL preservation, new catalog/ACL state, and one ledger
  row. The DDL and direct version-only ledger insert share one protected psql
  transaction; a later history repair is forbidden, closing the commit-to-ledger
  crash window. Runtime behavior, linked-database lint, application health, and global
  kill-switch/autonomy/worker containment are explicit post-apply release gates,
  not claims made by that scope.
- Rationale: the migration is intentionally applied before the matching Vercel
  application during this release procedure, and `origin/main` calls all six
  legacy RPCs. Revoking their authenticated grants in the database migration
  would make the live old application fail immediately during the cutover
  window. Additive checked boundaries allow the new application to adopt the
  stronger contracts while the old copy continues to function. Refusing dirty
  pre-existing catalog state keeps `CREATE OR REPLACE` and trigger replacement
  from laundering an unexpected partial apply or manual change into the
  approved migration identity.
- Consequence: between EXPAND apply and the later CONTRACT migration, an
  authenticated manager can still use the legacy assignment functions without
  an expected revision, and legacy readiness remains authenticated rather than
  service-only. This is a real, bounded compatibility risk, contained by keeping
  worker/executor disconnected, raw autonomy and automatic actions OFF, and the
  global kill switch ON. It must not become permanent through omission: the
  follow-up revocation remains open release work, requires its own exact source
  identity and approval, and may proceed only after the deployed application no
  longer depends on the legacy execute grants.

## ADR-110 - CONTRACT is an independently pinned, exact-app-gated ACL migration

- Date: 2026-08-22
- Status: Accepted for the local release candidate; protected publication and hosted execution pending
- Decision: the CONTRACT half is the new forward migration
  `20260822000300_contract_bot_mutator_acls.sql`, frozen at SHA-256
  `e3bad45af18ed07d3ab7adcfc9a326103fc09fd2b398f664c733de73fac7c1e2`.
  It contains one atomic `DO` statement and changes only `EXECUTE` ACLs for the
  six legacy direct mutators named in ADR-109. Before the first revoke it
  requires the complete frozen `20260822000200` catalog: exact definitions,
  signatures, owners, `SECURITY DEFINER`, search paths, and ACLs for all helper,
  checked, readiness, and legacy functions; exact revision columns and positive
  constraints; and exact enabled triggers. The six legacy functions must still
  have authenticated-only execution, with PUBLIC, anon, and service-role denied.
  Unexpected overloads, missing objects, definition drift, ACL drift, history
  mismatch, or replay stop the transaction. After revocation, the same six
  definitions and security metadata must be unchanged and authenticated,
  PUBLIC, anon, and service-role execution must all be denied; the function
  owner remains able to execute so checked `SECURITY DEFINER` wrappers can
  delegate internally.

  `assign_bots_to_project_checked` also refuses an exact current `paused`
  posting while holding its row lock. Moving or bulk-assigning cannot implicitly
  reactivate it through the legacy delegate; a manager must first use the
  explicit revision-checked status transition to resume it.

  The independently hash-pinned
  `scope=bot-account-binding-contract` requires predecessor `20260822000200`
  exactly once, target `20260822000300` absent, one-file application, and one
  target ledger row inserted in the same transaction as the revokes (never by a
  later `migration repair`). Because the workflow cannot prove an authenticated browser
  journey by itself, it also requires the exact checked-out 40-character
  application SHA and the manual attestation
  `exact-app-vercel-accepted` before any database access. The pre-connection
  machine gate also requires `refs/heads/main` and the latest GitHub `Production`
  deployment created by `vercel[bot]` to have exact matching SHA/ref, task
  `deploy`, and a latest successful Vercel-bot status with a Vercel URL. The
  operator separately verifies exact Vercel project
  `prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`, which GitHub deployment metadata does not
  expose; no `VERCEL_TOKEN` Actions secret is added. Broad `scope=all` refuses
  both protected versions until EXPAND and CONTRACT have each been separately
  recorded by their dedicated scopes, then re-proves the full live contracted
  function/ACL/revision/default/constraint/trigger catalog before `db push`.
- Rationale: a predecessor ledger row proves history, not live catalog identity,
  and revoking the compatibility grants before the replacement server is the
  exact accepted Vercel deployment would break the migration-first release.
  Conversely, leaving the grants indefinitely preserves revision-free writes
  and browser-owned readiness. The only safe sequence is **EXPAND -> exact
  application/Vercel acceptance -> CONTRACT**, with a clean catalog stop at
  both database boundaries.
- Consequence: cached old-shaped requests remain supported by the candidate
  server only by deriving the missing identity/revision tuple server-side and
  calling checked RPCs. Legacy fallbacks are limited to exact missing-function
  evidence from a genuinely pre-EXPAND database; once checked functions exist,
  a revoked legacy RPC is never retried. Applying CONTRACT still requires a new
  exact RED authorization and post-apply ledger/catalog/ACL/lint/health/
  containment verification. It enables no worker, autonomous action, provider
  execution, merge, deployment, rollback, or secret path.

## ADR-111 - Contain the failed bot catalog gate with a forward ACL normalizer and stable identities

- Date: 2026-08-22
- Status: Accepted; application publication is complete, while the
  cross-platform repair and hosted execution require a new exact owner approval
- Decision: EXPAND run `32568221857` stopped before DDL because hosted Supabase
  gives all seven legacy routines an additional direct `service_role` EXECUTE
  ACL through its default function privileges. A second independent defect was
  the use of raw `md5(pg_get_functiondef(...))`: PostgreSQL 17 and 18 can
  deparse an identical routine differently. Add protected forward migration
  `20260822000150_normalize_legacy_bot_function_acls.sql`; it accepts only the
  exact coherent vanilla 0/7 or hosted 7/7 service-role posture, rejects mixed
  states, revokes only the seven direct overgrants, and verifies the exact
  owner-plus-authenticated ACL inside one atomic statement. EXPAND/CONTRACT and
  their hosted guards use line-ending-canonical `md5(prosrc)` (CRLF and lone CR
  become LF) plus explicit full catalog fields and structural trigger checks
  instead of deparser hashes.
- Frozen exact repository file identities: 00150 SHA-256
  `6b24b6ebb57e59b9c4398c3e439221c27c300663a7b6932ff192996ffe6bcd93`;
  corrected 00200 SHA-256
  `658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`;
  corrected 00300 SHA-256
  `79914bc97660eef908b6a0fa0c90abfdd15da1683b383ad568e34bf3bd32c5f7`.
- Release evidence: exact commit
  `30d7e824691bdd4f8fa72481b21c91d3da6e3a31` is on `main`, authored and
  committed by `surgeservicesllc <surgeservicesllc@gmail.com>`. Vercel
  production deployment `dpl_FrvCToHvFhkzfwnkmEeeTyfuE3v2` is READY; GitHub
  deployment `6036292508` and status `17160408639` bind it to the exact SHA and
  production URL. Exact-head CI run `32570540183` is red: all three browser
  shards passed, while quality job `97025270055` failed before build because
  the LF migration chain rejected all seven non-canonical `prosrc` hashes.
  Native PostgreSQL 17.10 and 18.4 full chains pass after canonicalizing CRLF
  and lone CR to LF. This repair remains local, and no hosted database mutation
  has occurred.
- Rationale: a retry cannot repair a deterministic catalog mismatch, and
  weakening the guard would hide unknown drift. A separately hashed forward
  normalizer makes the one proven environmental delta explicit and fail-closed.
  Line-ending-canonical source hashes plus transparent catalog fields preserve
  identity across PostgreSQL majors and client newline conventions without
  trusting a version-dependent pretty-printer.
- Consequence: 00150 must land exactly once before corrected 00200, and 00300
  remains gated on exact production application acceptance after EXPAND. The
  read-only audit reports server version, ledger, source hashes, and named ACL
  posture. No old workflow may be rerun and no reset, down-migration, history
  repair, broad push, worker, or autonomous execution is authorized. The
  repaired commit requires green exact-head CI and fresh RED authorization
  before any hosted execution.

## ADR-112 - The signed-in header names the products, not the pages

- Date: 2026-08-19
- Status: Accepted
- Decision: `SIGNED_IN_NAV` becomes two entries — `AI Factory` at `/solutions` and `Job Seeker` at `/job-seeker` — with `Admin` still appended for a confirmed super administrator. Projects, Runs and Activity are removed from the global header. `SiteHeader` resolves the current destination by the longest matching href rather than by any prefix match.
- Rationale: the owner's reference shows exactly these three entries, and named both addresses explicitly. `AI Factory` is wired to `/solutions`, the console entry point, and deliberately not to `/solutions/ai-factory` — a page inside the console that happens to share the name. The three removed entries were a short, arbitrary excerpt of the console's own column, which lists them beside everything else it holds, so the header was repeating a fraction of the menu one row above it. `Job Seeker` sits outside `/solutions` because it is the one person-scoped surface: the page hard-gates on the server and every row is RLS-scoped to organization membership *and* row ownership.
- Also: the entries now nest, which the old active test could not express. `/solutions` is a prefix of `/solutions/admin`, so on the admin page both entries matched and the header rendered two links with `aria-current="page"` and two underlines at once. The longest match is the entry a person is actually on; a set without nesting — the public navigation — behaves exactly as before.
- Consequence: the signed-in header had no browser coverage at all, because the whole e2e suite browses signed out. A `site-header` harness case renders it as a signed-in super administrator and one test reads the rendered entries, their two hrefs, and the account controls beside them. That case is deliberately absent from the layout sweep's `CASES`: the sweep clicks every control it finds, and this one contains sign-out. The nesting fix is mutation-checked — restoring the prefix test fails the admin case.

## ADR-113 - Operations is a destination, not a category

- Date: 2026-08-19
- Status: Accepted
- Decision: the console sidebar's `Watch` group is removed, and `Operations` becomes a top-level destination placed directly above `Reports`. The group's other child, `Activity`, is removed from the column with it.
- Rationale: the owner marked the group header and its `Activity` child on the live page and asked for both gone, with Operations promoted. The structure agrees with the instruction: `Watch` named a category rather than a place, and put a disclosure and a click in front of the one destination inside it people actually want. Removing a group is only safe when its destinations survive it, and both did — Operations by promotion, and Activity because `Bots → Bot Activity` already pointed at `/solutions/activity` under a name that says whose activity it is. The duplicate is what was removed, not the page.
- Consequence: the column drops from six disclosure groups to five (Projects, Pipelines, Bots, Settings, Advanced) and reads Overview, AI Factory, Projects, Pipelines, Bots, Job Seeker, Runs, Operations, Reports, Integrations, Secrets, Settings, Advanced. `tests/unit/app-shell.test.tsx` asserts the group's absence, that Operations resolves to `/solutions/operations`, and the adjacency itself — `Reports` at exactly one index after `Operations` — which is mutation-checked by swapping the two. The e2e reachability contract in `console.spec.ts` loses the `Watch` and `Activity` entries but no destination; `pages.spec.ts` still renders and axe-checks `/solutions/activity`, which remains a real page.

## ADR-114 - The model a bot is given is the model the executor accepts

- Date: 2026-08-22
- Status: Accepted
- Decision: `executionModel()` and `EXECUTION_PROVIDER` are exported from `lib/orchestration/plan.ts` and are the single source of the pair a Phase 1C command can run on. `ensureProviderBot` asks that function for the executing provider instead of taking `suggestedModels[0]`, so an operator's `SOFTWAREFACTORY_CODEX_MODEL` pin moves the plan and every newly provisioned bot together. The catalog's openai list leads with the same value, `GET /api/projects/:id/bots` and `GET /api/bots/providers` publish it, and the roster's model picker marks each option **runs** or **cannot run**. Migration `20260822000600` moves already-provisioned bots off the models the catalog itself produced and clears posting overrides naming one, each repair written as an activity event. A model the console never offered is left alone.
- Rationale: the plan fixed `gpt-5.3-codex` while `ensureProviderBot` named new bots `gpt-5.1-codex`. `selectFactoryCommandRoute` and `submit_factory_command` both compare the pair exactly, so **every command in every workspace was refused** — at the last step of the journey, after a project, a pipeline and a bot had all been chosen, with `PROVIDER_MODEL_MISMATCH`. Nothing was misconfigured; the console had shipped a bot its own executor could never match. The defect was possible because one fact lived in two files with nothing tying them, and it was invisible because the refusal named two internal concepts ("the command's fixed execution provider and model") that appear on no screen. Repairing rows is not optional cleanup: fixing the constants alone would leave every existing workspace blocked, since the bad model is already written. Overrides are cleared rather than rewritten because null means "use the bot's model", which is now correct, while setting the executable model would assert an intention nobody expressed.
- Consequence: `tests/unit/execution-model-agreement.test.ts` ties the catalog to the plan, and `tests/integration/executable-model-migration.contract.test.ts` ties the migration's literal to `DEFAULT_CODEX_MODEL` — SQL cannot import the constant, so the third copy is checked by reading the file. `tests/integration/executable-model-repair.behavior.test.ts` seeds rows *before* the repair migration and applies it, which is the upgrade a live workspace experiences rather than a fresh install that never had the defect; it proves the repaired bot is routable, that a hand-typed model and another provider are untouched, that the repair is replayable, and that each change is audit-evented. The refusal now names the bot, both models, and where to change one, pinned by `tests/unit/factory-command-routing.test.ts`. `STANDARD_MODEL_CATALOGUE` grew by one entry, and `provider-surfaces` now derives its count from the catalogue rather than repeating a literal, and asserts every entry has a display name — an unnamed model silently renders its raw identifier.

## ADR-115 - Admit every valid Factory model, but execute only the identity the worker implements

- Date: 2026-08-22
- Status: Accepted as an unpublished release candidate; protected hosted apply
  and production acceptance are pending
- Supersedes: ADR-114 only where ADR-114 allowed an environment pin to move the
  executable model. Its exact worker/posting agreement and hosted `00600` repair
  remain in force.
- Decision: classify the selected posting's provider/model at command admission.
  Exact `openai` / `gpt-5.3-codex` is the sole executable identity and retains
  the existing manual Phase 1C plan. Every other syntactically valid, bounded
  provider/model pair is `record_only`: persist the command, task, immutable
  route, and execution disposition, but create no `agent_runs` and expose no
  route to a worker, repository branch, commit, pull request, merge, or
  deployment. Reject invalid identities. Reject every nondefault
  `SOFTWAREFACTORY_CODEX_MODEL` value before planning rather than treating an
  environment variable as execution authorization.
- Decision: Step 8 is complete when the command is durably recorded. Step 9
  reads a caller-authorized, project-scoped safe projection and renders the
  recorded-only disposition truthfully, including the deliberate absence of
  execution artifacts. Reload must preserve that project-only history, and the
  projection must not expose raw command parameters. Record-only history is
  excluded from executable capacity calculations and provider-run APIs refuse
  it even if called directly.
- Decision: hosted `20260822000600_route_bots_onto_the_executable_model.sql` is
  already applied and continues to align legacy Codex rows with the one
  executable identity. The new database contract must land only as the atomic,
  forward-only `20260822000300` -> `20260822000900` -> `20260822001000` ->
  `20260822001100` -> `20260822001200` chain.
  The retired standalone CONTRACT scope is non-mutating; only
  `scope=factory-any-model-record-only` may rehearse and apply the chain after
  exact-main, exact READY Vercel, owner-acceptance, ledger, catalog, ACL, lint,
  health, and containment gates.
- Rationale: a connected Claude or alternate OpenAI account is valid routing
  intent even when this factory has no executor for it. Rejecting that intent
  made Step 8 unusable; pretending it was executable would be worse, because it
  would fabricate runs and make Step 9 promise artifacts no worker can create.
  A durable record-only mode preserves user intent and project history while
  keeping the execution boundary honest and closed.
- Consequence: adding another executable provider/model requires a new decision
  plus synchronized worker, claim, database, policy, and acceptance changes; a
  catalog entry, connected account, UI selection, or environment variable is
  insufficient. Until the candidate has a frozen commit, green exact-head CI,
  matching Vercel deployment, atomic hosted apply, zero-run postflight, and
  signed-in Step 8 -> Step 9/reload evidence, it must not be described as
  deployed or production ready. Workers, autonomy, and automatic actions remain
  OFF and the global kill switch remains ON.

## ADR-116 - Owner-directed releases use technical gates, not a magic RED approval ceremony

- Date: 2026-08-22
- Status: Accepted by direct owner instruction
- Decision: an owner's direct request in the active task to push, deploy, or
  apply the named release is sufficient repository release authority. Agents
  must not demand a second magic phrase, a commit/hash declared before it
  exists, an artificial expiry window, or repeated approval after routine
  rebases and validation. The exact artifact is frozen and reported by the
  executor as evidence rather than used as a conversational password.
- Decision: this changes release authorization only. Exact repository/main/head
  identity, green required CI, exact READY production deployment, immutable
  migration hashes and prerequisites, rollback rehearsal, forward-only apply,
  ledger/catalog/ACL/lint/health verification, audit evidence, stop-on-drift,
  workers/autonomy/actions OFF, and the kill switch remain mandatory. Product
  RED commands, protected draft changes generated by the product, secrets,
  destructive data work, auth/RLS, billing, DNS, and autonomous authority keep
  their existing approval and safety boundaries unless the owner separately
  changes those policies.
- Rationale: binding release authority to a specially formatted sentence and a
  not-yet-created commit delayed a release without adding technical assurance.
  Artifact identity, tests, provider identity, database preflights, atomicity,
  containment, and postflight evidence are the controls that prevent the
  failure modes. The owner's plain-language instruction already establishes
  intent and scope.
- Consequence: release tooling may request identifiers needed to verify the
  artifact being executed, but it may not require a magic acceptance value or
  conversational re-approval. Any target or scope beyond the owner's direct
  request still requires new authority; uncertainty or a failed technical gate
  still stops the release.

## ADR-117 - Job Seeker is a product with its own navigation, not a page of the console

- Date: 2026-08-22
- Status: Accepted
- Decision: `lib/job-seeker/navigation.ts` holds the section's own left navigation — Overview with its five sections, then Job Search, Applications, Resume Library, Cover Letters, Contacts & Outreach, Interview Tracker, Notes & Documents, Analytics, Settings — and `AppShell` swaps its whole navigation set while the path is under `/job-seeker`. `/job-seeker` lands on an Overview dashboard rather than on the Career Profile form. The six existing panels gain real routes (`/job-seeker/profile` and siblings) instead of `?section=` query state, and the in-page tab strip is hidden when a route names its section, because the left navigation is now the wayfinding. The auth gate moves from `page.tsx` to a section `layout.tsx`. Resume Library, Cover Letters and Notes & Documents are one component over `job_seeker_documents` filtered by `kind`; Contacts & Outreach reads the contacts and outreach tables together; Interview Tracker is derived from applications at an interview stage rather than from a second table; Settings is the preferences surface that already governs matching.
- Rationale: a person in Job Seeker is managing a job search, and the console's destinations — Projects, Bots, Runs, Secrets — are noise against that task. The owner's design shows a different navigation, which is the correct reading: this is a second product sharing a shell, not a page of the first. Landing on Career Profile meant a returning person's first sight was data entry rather than where their search stood. Interviews are derived rather than stored because an interview *is* an application at a stage, and keeping a second copy is how two screens start disagreeing about how many you have. `isActiveHref` gained an exact-match set because `/job-seeker` is both Overview's href and the prefix of every sibling, so prefix-matching would light Overview up while someone stood in Resume Library; the group still highlights from its children, which is what the design shows.
- Consequence: `tests/unit/job-seeker-navigation.test.ts` checks every href against the file that would serve it, so an entry cannot promise a destination that does not exist. `tests/unit/job-seeker-overview-model.test.ts` pins the arithmetic on the cases where a wrong answer would look plausible — an unscored job counted as a low score, an application counted as submitted before it was, a percentage taken over every recorded job rather than over the applications. The thirteen new routes are registered in the width sweep, which the responsive-coverage contract required before it would pass. Documents are listed with a 280-character preview rather than their full 60k, and the list carries versions because the table keeps every one: a tailored resume is evidence of what was actually sent.

## ADR-118 - Contract the hosted resume function ACL in a new forward version

- Date: 2026-08-22
- Status: Accepted for the protected atomic release
- Decision: preserve immutable hosted migrations `20260822000400` and
  `20260822000500`. Add `20260822001100` to freeze the exact
  `apply_resume_extraction(uuid,text[])` signature, source, owner, language,
  SECURITY DEFINER/search-path contract, overload count, and known hosted ACL
  input; revoke function access from PUBLIC, anon, authenticated, and
  service_role; then grant EXECUTE only to authenticated and require exactly
  owner plus authenticated in postflight. Rehearse and apply the complete
  `00300 -> 00850 -> 00900 -> 01000 -> 01100 -> 01200` chain in the same protected
  transaction.
- Rationale: hosted probe `32587973532` proved that every Job Seeker table,
  column, index, policy, constraint, RLS, source, and catalog fingerprint was
  exact. The only mismatch was direct `service_role EXECUTE` left by Supabase
  function default privileges. `00500` contracted table grants but revoked the
  function only from PUBLIC and anon; its earlier verifier omitted
  service_role, so the residual grant was real and invisible locally until the
  hosted default was reproduced.
- Consequence: no applied migration is edited or replayed, no final-state gate
  is weakened, and service_role loses the unintended person-facing function
  path before the atomic transaction becomes visible. The regression suite
  reproduces the three-entry hosted input and proves `00500` leaves it while
  `01100` closes it. Workers, autonomy, and automatic actions remain OFF and
  the global kill switch remains ON.

## ADR-119 - A clear control refuses rather than destroys what it cannot safely delete

- Date: 2026-08-22
- Status: Accepted
- Decision: `clear_backlog_tasks(uuid, text, boolean)` and `clear_all_pipelines(uuid, text, boolean)` (migration `20260822000800`, with the two `activity_event_type` labels `task.backlog_cleared` and `command.pipelines_cleared` added separately in `20260822000700`) are the only way the Backlog and All Pipelines pages clear. Both are SECURITY DEFINER, refuse a caller who is not an owner or admin, refuse a reason under ten characters, skip anything currently running, and skip anything whose deletion would cascade into run history unless the caller explicitly opts in. Every call writes an audit row, including one that deleted nothing. `components/clear-surface-button.tsx` is one component for both surfaces; `app/api/tasks/clear/route.ts` and `app/api/commands/clear/route.ts` carry no authority of their own and only classify the function's refusals.
- Rationale: the destructive decision is identical on both pages, and the moment it is two implementations they start to disagree — one grows a confirmation step the other lacks, one reports counts the other swallows. The refusals matter more than the deletions: `commands -> tasks -> agent_runs` is `ON DELETE CASCADE` the whole way, so an unguarded "clear all" on either page silently destroys run history that `delete_agent_run` protects individually. Skipping is the default and opting in is a labelled checkbox, because a person pressing "clear the page" is asking about the page, not about the evidence behind it. The reason floor is enforced in the browser as well as the database, since discovering a ten-character rule after a confirmation dialog is a worse experience than the field simply being required.
- Consequence: the control reports what it kept and why — `"3 pipelines cleared. Kept: 1 still running, 2 with run history."` — because "cleared" over a list that still has rows in it is the kind of small lie that costs someone their trust in the surface. `tests/integration/clear-backlog-and-pipelines.behavior.test.ts` covers 15 cases against real PostgreSQL, including the manager check, the reason floor, the live-work skip, the cascade skip and its opt-in, replay, and the audit row on an empty clear. Building the fixtures required suspending `tasks_phase1c_plan` and `tasks_phase1c_queue` for construction only: the planner triggers refuse the completed-task shape these tests need to delete.
- Hosted: applied by run `32582241930`, `scope=clear-controls`, both versions absent from the ledger beforehand. The post-apply readback measured `security_definer t`, `member_may_execute t`, `anon_may_execute f` for both functions, and both enum labels present. That readback was produced by the step that ran the DDL, so `scope=probe` gained the same read plus `service_role` EXECUTE — an apply grading its own work cannot distinguish a wrong assertion from a wrong migration.

## ADR-120 - Contract hosted clear-control function ACLs in a forward migration

- Date: 2026-08-22
- Status: Accepted for the protected atomic release
- Decision: preserve immutable hosted migration `20260822000800`. Add
  `20260822001200` to freeze the exact signatures, sources, owners, languages,
  SECURITY DEFINER/search-path contracts, overload counts, and known hosted ACL
  inputs of `clear_backlog_tasks(uuid,text,boolean)` and
  `clear_all_pipelines(uuid,text,boolean)`; revoke function access from PUBLIC,
  anon, authenticated, and service_role; then grant EXECUTE only to
  authenticated and require exactly owner plus authenticated in postflight.
  Rehearse and apply the complete `00300 -> 00850 -> 00900 -> 01000 -> 01100 -> 01200`
  chain in the same protected transaction.
- Rationale: read-only hosted probe `32590061431` proved both clear-control
  functions retained direct `service_role EXECUTE` from Supabase function
  default privileges. Migration `00800` revoked PUBLIC and anon but omitted
  service_role, and its original postflight did not measure service-role
  privilege, so the unintended direct grant survived and must be removed before
  the protected release can pass.
- Consequence: no applied migration is edited or replayed and no final-state
  gate is weakened. The new version accepts only the frozen clean or exact
  hosted overgrant input and converges both functions to the same
  owner-plus-authenticated ACL before the atomic transaction becomes visible.
  Workers, autonomy, and automatic actions remain OFF and the global kill
  switch remains ON.

## ADR-121 - Normalize the measured hosted pre-repair function ACLs without replacing identities

- Date: 2026-08-22
- Status: Accepted for the protected atomic release
- Decision: add forward migration
  `20260822000850_normalize_hosted_pre_repair_function_acls.sql` immediately
  before pending `00900` in the protected chain. Freeze the exact catalog and
  ACL state measured by read-only run `32591774367`: twelve guarded routines are
  already exact; `normalize_bot_assignment_configuration`,
  `record_claim_anchoring`, and `validate_pipeline_template_areas` have the
  Supabase-default `service_role EXECUTE` overgrant; and
  `claim_provider_connect_session` is owner-only although its server boundary
  requires service-role execution. Revoke and rebuild only those four ACLs.
  Preserve every routine OID, source, signature, owner, language, volatility,
  SECURITY DEFINER setting, search path, argument/result contract, and comment.
- Rationale: the earlier sixteen-function gate described the intended ACLs as
  though they were already hosted, so the protected run stopped safely before
  DDL. The claim function also retains the hosted legacy OUT names
  `organization_id` and `purpose`. Recreating it merely to adopt newer local OUT
  labels would change its OID and external row contract without fixing the ACL
  defect. Pending, unapplied `00900` therefore freezes the measured claim result
  hash `3b2b93799687f2d2de6b154376542759` and catalog hash
  `a7ca5a02b1faa50ebba452c4a4f46195`.
- Consequence: the one protected transaction is now
  `00300 -> 00850 -> 00900 -> 01000 -> 01100 -> 01200`. Its exact hosted-input
  gate, rollback rehearsal, migration postflight, 00900 preflight, ledger,
  catalog, lint, health, and containment checks stop on any mixed or unexpected
  state. No applied migration is edited or replayed, and workers, autonomy, and
  automatic actions remain OFF with the global kill switch ON.

## ADR-122 - The containment gate measures what can exist, and the audit guard loses its hosted default grant

- Date: 2026-08-22
- Status: Accepted
- Decision: two repairs to the protected release's containment gate and its
  inputs, with no state requirement weakened. First, the gate's two audit
  evidence clauses become trail-agreement: the newest
  `autonomy.kill_switch_changed` event per org (if any) must show the switch
  engaged, and the newest autonomy-affecting event per pinned project (if
  any) must not show autonomy on. The old clauses demanded change events the
  platform forbids from ever being written - `update_project_controls`
  refuses turning project autonomy ON, so the OFF-flip event cannot exist,
  and a tenant whose kill switch has been ON since creation has no change to
  record. Second, the gate's source comparison for
  `reject_activity_event_mutation()` used `btrim(...)` with the default
  space-only character set against a body that begins and ends with
  newlines, so it read false on every database including a pristine one; it
  now trims `' \n'`. Third, `20260822001300_contract_audit_guard_function_acl`
  behind `scope=audit-guard-acl-contract` removes the hosted Supabase default
  `service_role EXECUTE` grant the 20260812000300 revoke never covered,
  accepting only the clean or exact known-overgrant input.
- Rationale: probe evidence, clause by clause. Runs 32591774367, 32594887321,
  32599024205, and 32599284961 walked the refusals from the sixteen-function
  gate to containment, and the last one isolated
  `reject_mutation_function_posture f` as the only red clause while every
  state, census, worker, and event clause read green. A local reproduction
  then showed the btrim comparison false even on the clean chain, which means
  that clause alone could refuse the chain forever regardless of any owner
  action.
- Consequence: the containment gate still requires every autonomy mode OFF,
  GREEN ceilings, no auto action, the kill switch ON with an agreeing audit
  trail, the exact four-project census, the append-only audit posture, and a
  disconnected worker table. The owner engaged the kill switch and turned
  Autonomous Mode OFF in the active workspace through the Safety page, which
  wrote the real events the trail-agreement clauses read. Workers, autonomy,
  and automatic actions remain OFF and the global kill switch remains ON.

## ADR-123 - A partial mixed-era AgentOS foundation is cleared, never completed in place

- Date: 2026-08-22
- Status: Accepted
- Decision: add `20260822001400_clear_partial_agentos_foundation.sql` behind
  `scope=agentos-foundation-cleanup`. Hosted records `20260814000300` as
  applied while only 4 of its 32 named objects exist; protected-chain run
  `32600709789` stopped at `20260822000900`'s first in-file guard ("expected
  0 or 32 named objects; found 4") - the first failure inside the chain
  itself after every workflow gate passed. The cleanup returns the roster to
  the proven-absent state: it no-ops on 0 and on a complete foundation,
  refuses any remnant table that holds rows, drops children before parents
  with RESTRICT semantics only, and verifies zero named objects afterward,
  all in one transaction.
- Rationale: 00900 restores the foundation only from proven absence because
  a fragment's fingerprint is ambiguous, and completing a fragment in place
  would duplicate the protected restore outside its rehearsed transaction.
  The remnants are the leading objects of a partial autocommit apply whose
  history row was recorded anyway - the same mixed-era pattern the runbook
  documents - and they can hold no meaningful data, which the row-count
  guard enforces rather than assumes.
- Consequence: hosted's roster goes to zero, the protected chain's first
  guard takes its 'absent' branch, and the restore creates all 32 objects
  inside the atomic transaction. A full local replay reaches 001400 with a
  complete foundation and does nothing. Workers, autonomy, and automatic
  actions remain OFF and the global kill switch remains ON.

## ADR-124 - submit_command is carried to its pre-chain version before the chain freezes it

- Date: 2026-08-22
- Status: Accepted
- Decision: add `scope=command-carry-forward`, which applies the genuinely
  unapplied `20260815001000_cross_project_dependencies.sql` and then new
  `20260822001500_contract_command_submission_acls.sql`. Protected-chain run
  `32601908933` passed the AgentOS restore for the first time and stopped at
  `20260822001000`'s input guard on exactly
  `public.submit_command(uuid,text,public.risk_level,jsonb,text)`: hosted
  still runs the 20260813001100-era body because 20260815001000 never ran
  there (probe: `declare_cross_project_dependency` absent), while the guard
  freezes the carried source `adb50eb74e1721274f23d0d69b79e2e8` and an
  owner-plus-authenticated ACL. The ACL contraction is source-agnostic - the
  function legitimately has a pre-chain and a post-chain body - and accepts
  only owner-granted, non-grantable EXECUTE entries for known roles before
  converging all three command-submission functions.
- Rationale: the guard's expectation derives from the local chain, and the
  local chain includes 20260815001000; the only honest convergence is to
  apply the missing file, not to relax the guard to hosted's stale body. The
  ACL half preempts the hosted default-privilege grant class that recurred
  five times today.
- Consequence: hosted's submit_command reaches the exact identity the atomic
  chain rehearses against, the cross-project dependency doorway ships with
  its documented owner-only controls, and the ledger records both versions
  truthfully. Workers, autonomy, and automatic actions remain OFF and the
  global kill switch remains ON.

## ADR-125 - The rehearsal lint names each trigger function's relation instead of never running

- Date: 2026-08-22
- Status: Accepted
- Decision: the protected chain's pre-commit lint called
  `extensions.plpgsql_check_function_tb(signature::regprocedure, 0::regclass,
  ...)` for all 27 roster functions, three of which are the Phase 1C trigger
  functions. plpgsql_check categorically raises `missing trigger relation` /
  `Trigger relation oid must be valid` when asked to lint a trigger function
  without the relation that types NEW and OLD, so that clause could not
  complete against any database state; it had simply never been reached
  before, because every earlier chain run refused at an earlier gate. Chain
  run `32603384774` - the first to pass the carry-forward-unblocked input
  guard - aborted inside the rehearsal transaction on exactly that error,
  committing nothing. The lint's VALUES rows now carry a `trigger_relation`
  column: `public.commands` for `normalize_phase1c_command()`, `public.tasks`
  for `plan_phase1c_task_and_run()` and `queue_phase1c_run_for_task()` -
  copied from `20260822001000`'s own `trigger_expectations` - and
  `coalesce(trigger_relation::regclass, 0::regclass)` for everything else.
- Rationale: correcting a provably unsatisfiable clause is not weakening a
  gate. As written the lint rejected every possible database, including a
  perfect one; as corrected it actually lints the three trigger bodies for
  the first time, which is strictly more verification, with the same roster,
  levels, and fail-closed handling. `scope=probe` gained a rolled-back
  begin/create-extension/lint/rollback block proving the mechanics against
  the current hosted bodies plus a residue readback, so the fix is measured,
  not assumed.
- Consequence: the rehearsal can reach its rollback for the first time. The
  frozen six-file chain is untouched; only the workflow's lint invocation and
  its pinning test changed. Workers, autonomy, and automatic actions remain
  OFF and the global kill switch remains ON.

## ADR-126 - The lint's first real finding is fixed at its source, and findings become sentinel rows

- Date: 2026-08-22
- Status: Accepted
- Decision: with ADR-125's relations in place, chain run `32604992678`
  completed the rehearsal lint for the first time and the gate refused on one
  genuine warning: `public.agentos_resolved_agent_grants(uuid)` initialized
  `environment_networking public.agentos_network_mode := 'limited'`, and
  plpgsql_check warns (42804) that the text literal has no assignment cast to
  the enum. The initializer now carries the explicit
  `::public.agentos_network_mode` cast in both creator copies - the original
  `20260814000300_agentos_isolation_model.sql` (the full local path) and the
  restore copy in `20260822000900` (the hosted path) - keeping the two bodies
  byte-identical; 00900's own source pin moves to
  `a1231a4a5329b1dab132b6e774d97bb3` and the workflow's frozen REPAIR sha to
  `512869badb309e99f9c58c6886ecd1af10e3b29ec636ed700b93b539f2f0f694`. The
  same run also proved the gate's evaluation could never pass: the captured
  rehearsal stdout legitimately contains blank lines (void-returning SELECTs
  under -Atq), so plain non-emptiness refused even a finding-free rehearsal.
  Finding rows are now sentinel-prefixed (`LINTROW|`, every field coalesced
  so a NULL cannot erase its row's sentinel) and the gate greps for the
  sentinel.
- Rationale: the lint gate worked exactly as designed the first time it
  could run, and the honest response to a real finding is to repair the
  linted body, not to waive the warning level. Editing a frozen chain file
  re-freezes identity through the workflow constant, the pinning tests, and
  exact-head CI. Verified empirically in the supabase postgres 17.6 image:
  all 148 migrations apply with the fix, both creator paths produce the
  pinned md5, and the full 27-function roster lints with zero findings.
- Consequence: the rehearsal can produce a clean lint verdict for the first
  time. Workers, autonomy, and automatic actions remain OFF and the global
  kill switch remains ON.

## ADR-127 - The chain is applied; one wrong pinned contract and the unreached postflights get their own scope

- Date: 2026-08-23
- Status: Accepted
- Decision: chain run `32607123713` committed the protected six-file
  transaction - rehearsal green with a clean lint, six ledger rows recorded,
  fourteen-identity contract unchanged - and then refused at the post-commit
  RECORD_ONLY_READY check. The detail probe (run 32607361788) showed hosted's
  post-apply posture matches every measurable expectation: exact wrapper
  sources and ACLs, RLS-forced tables with owner/authenticated-only grants,
  and zero record-only agent runs. Replaying the exact gate query on the
  clean local full chain reproduced the refusal: the pinned contract md5 for
  `public.list_factory_commands(uuid,integer,uuid)` (`6abaeb0d...`) matches
  no database; the true post-chain identity is
  `162d47956f98e7b005c7abe1df680ee9`. The pin is corrected in both workflow
  sites and the test fixture, and a new read-only
  `scope=record-only-postflight` re-runs exactly the three post-commit
  verifications, the health checks, and the PostgREST reload the protected
  step never reached - refusing unless the ledger already records the six
  rows, and writing nothing but the NOTIFY.
- Rationale: the production database is in the intended state; what failed
  was a verification constant, provably wrong under every state, so
  correcting it and re-running the verification is the honest completion of
  the release evidence - not a waiver. The chain scope itself can never
  re-run (its history gate now refuses), so the unreached postflights need a
  dedicated scope.
- Consequence: the record-only routing is live and verified end to end once
  the postflight scope reads back green. Workers, autonomy, and automatic
  actions remain OFF and the global kill switch remains ON.

## ADR-128 - A record-only Claude command launches one real analysis graph

- Date: 2026-08-23
- Status: Accepted
- Decision: the owner accepted the record-only Step 8/9 and then directed
  that Step 9 must actually run the bot. The Claude bot's honest execution
  surface already exists and is production-proven: the graph engine, the
  subscription CLI transport, and the graph worker that drains MODEL and
  DETERMINISTIC nodes with read-only tools. New migration
  `20260823000100_command_analysis_graphs.sql` adds a one-to-one
  command-to-graph link table, `launch_command_analysis_graph` (delegates to
  `create_graph_from_plan` with the command's own stored prompt as the goal,
  idempotent through the unique link, refuses everything that is not a
  record-only Claude command), and `list_command_analysis_graphs` (latest
  run state and artifact count, fail-closed to empty for non-members). The
  command submit route launches the graph for record-only Claude commands
  and wakes the graph worker by repository_dispatch
  (`softwarefactory_graph_planned`, added to graph-worker.yml alongside its
  existing manual dispatch and gated schedule); the command type maps to an
  analysis template proven claude-drainable
  (`ANALYSIS_TEMPLATE_BY_COMMAND_TYPE`, invariant-tested against
  `WORKER_SUPPORTED_EXECUTORS`). Step 9 and the Bots request card report the
  analysis state exactly as the database holds it, replacing the untruthful
  "Waiting for a worker to pick it up" hint on record-only commands.
- Rationale: this is real execution inside the boundary Phase 2A draws -
  analysis artifacts only, never a repository write, merge, or deploy; those
  stay with the manual Codex lane and its isolation discipline. The
  subscription transport spends no per-token API credit. The kill switch and
  autonomy are untouched: an analysis run happens only as the direct
  mechanical consequence of an owner-issued command, the same wake contract
  the Phase 1C dispatch always had.
- Consequence: the Claude bot genuinely runs when the owner issues a
  command: planned graph, claimed run, node transitions, artifacts, and
  verifications - all durable, all visible in Step 9. Hosted apply goes
  through the new one-shot `scope=command-analysis-graphs` with the file
  sha pinned.

## ADR-129 - The Run analysis tap is proven end to end, and the doorway gets a rehearsal that writes nothing

- Date: 2026-08-23
- Status: Accepted
- Context: the owner tapped Run analysis twice and the hosted database kept
  no trace either time - `command_analysis_graphs` read 0 link rows after
  both (probe runs 32613345163 and 32642517130). Nothing in the repository
  could see why: the behavior suite exercises
  `launch_command_analysis_graph` on real PostgreSQL through PGlite, which
  proves the function and says nothing about the hosted stack in front of
  it, and this session has no Vercel runtime logs.
- Decision: add two dispatch-only scopes to `apply-hosted-migrations.yml`.
  `analysis-launch-doorcheck` rehearses the newest record-only command's
  launch as its own organization owner inside `BEGIN ... ROLLBACK`, so the
  database's verbatim answer reaches the run log while the database keeps
  none of it, then re-sends `NOTIFY pgrst, 'reload schema'`.
  `analysis-launch-commit` commits that same launch once, with the plan the
  button would send held as a checked-in fixture
  (`supabase/fixtures/production_readiness.launch-plan.json`, emitted by
  `scripts/emit-analysis-plan.mts`, pinned by sha in the workflow and
  deep-equality-pinned against a fresh compile in
  `tests/unit/analysis-launch.test.ts`).
- Rationale: a rolled-back rehearsal is the only way to ask production the
  exact question the button asks without writing anything, and a pinned
  fixture keeps the committed launch identical to the code path it stands
  in for rather than a hand-copied approximation that could drift.
- Consequence: the doorcheck (run 32614371816) returned a graph id, placing
  the fault above the database. The commit (run 32643074805) linked command
  `0e9a4765` to graph `e3097ed8`; the graph worker claimed it and run
  `6d6c0a07` reached **COMPLETED with 7 artifacts** (13:42:37Z to
  13:48:30Z) - Step 9's first real analysis run. A second command,
  `d8777258`, then gained graph `a9fc2de2` at 13:44:25Z **through the
  application itself**, which is the edge path working again; its run
  `cc39a49f` finished PARTIAL with 5 artifacts, reported as PARTIAL rather
  than dressed up. The endpoint now surfaces request-shape refusals with
  their real status instead of a generic 500, so a future failed tap leaves
  a usable clue.

## ADR-130 - Deleting a selection of pipelines borrows the whole-list clear's rules rather than writing softer ones

- Date: 2026-08-23
- Status: Accepted
- Context: the Pipelines page could clear everything or nothing. The owner
  asked for the middle: tick one or more rows and delete exactly those. The
  tempting shortcut is a route that deletes by id, since the caller has
  already named the rows - which is precisely how a surface acquires a
  second, weaker deletion path beside its audited one.
- Decision: `20260823000200` adds `delete_selected_pipelines(uuid, uuid[],
  text, boolean)` as the scoped sibling of `clear_all_pipelines`, keeping
  every refusal that function makes - owner or admin only, a reason of ten
  characters or more, live work never deleted, run history never taken
  unless explicitly included - and adding two the whole-list clear never
  needed: ids are scoped to the caller's organization (a foreign id is
  *counted* as not found, never echoed and never acted on) and a selection
  is capped at 200. It reuses the `command.pipelines_cleared` activity
  label with `scope: 'selection'` in its metadata, so no enum label is
  added and the file stays one transaction.
- Rationale: naming rows explicitly is a smaller blast radius for the same
  decision, not a licence to reach past the rules that decision already
  has. One vocabulary in the audit log keeps both scopes legible to
  whoever reads it later.
- Consequence: `POST /api/commands/delete` carries no authority of its own
  and reports the database's own sentence on refusal. The Pipelines page
  gains a checkbox per row, a select-all that shows an indeterminate state
  for a partial selection, and a Delete selected (N) button that confirms
  before firing, requires the reason the database requires, and names what
  was kept - still running, with run history, no longer here - rather than
  claiming a clean sweep. Selection is offered on Active as well as All
  Pipelines: picking one row out of a live list is ordinary, and the
  function's own refusal keeps live work safe. Hosted apply goes through
  the one-shot `scope=delete-selected-pipelines` with the file sha pinned.

## ADR-131 - Selecting a pipeline stops it, because the rule protecting live work was protecting rows that could never finish

- Date: 2026-08-23
- Status: Accepted
- Context: ADR-130 gave the selection delete the whole-list clear's rule that
  queued and running commands are never touched. The owner immediately hit
  it: two record-only pipelines that had sat `queued` for one and fourteen
  hours - waiting for a Codex worker that, by design, will never claim a
  record-only command - answered "0 pipelines deleted. Kept: 2 still
  running." The rule was written to protect work in flight. Applied to an
  explicit selection it protected rows nobody could ever finish, and gave
  the owner no way at all to remove them.
- Decision: `20260823000300` drops and recreates
  `delete_selected_pipelines` so a selection means stop, then delete. A
  selected command in `queued` or `running` has its agent runs, its
  non-terminal tasks and itself moved to `cancelled` before removal, and the
  stop happens even in the cases where the row is then kept. Three things
  the change deliberately does not do: it does not race a worker (the agent
  runs are locked `FOR UPDATE` first, and `claim_phase1c_run` selects `FOR
  UPDATE ... SKIP LOCKED`, so a claim in flight skips a run this
  transaction is cancelling); it does not delete run history without the
  explicit flag; and it never deletes a command the improvement ledger
  cites, with or without the flag. The return gains `stopped_count`,
  `kept_with_evidence` and `unlinked_analyses` and loses `kept_running`,
  which is why the old body is dropped rather than replaced - one name, one
  selection-delete path.
- Rationale: cancelling is safe against this schema's own guards, and that
  is checked rather than assumed: the two RED-block triggers rewrite a
  status only on a move *into* queued/running/succeeded, and the Phase 1C
  planners fire on INSERT, so a move to `cancelled` passes through both
  untouched.
- Consequence: a second defect surfaced while writing this and would
  otherwise have bitten on the first real press -
  `command_analysis_graphs.command_id` is `on delete restrict`, so both of
  the owner's rows (each carrying an analysis graph since ADR-129) would
  have failed on a foreign key rather than deleting. The link row is now
  removed first and **the graph, its run and its artifacts survive**: the
  bot's findings outlive the request that asked for them, stay readable
  under Graph runs, and the result line says so rather than letting
  "deleted" imply the analysis went too. `factory_command_routes` is
  handled the same way. Both are addressed through `to_regclass`-guarded
  dynamic SQL, because a database may hold either, both or neither.

## ADR-132 - Routing evidence was made immutable in a way that made commands immortal

- Date: 2026-08-23
- Status: Accepted
- Context: the owner selected two pipelines, pressed delete, and got
  `factory command routing evidence is immutable`.
  `factory_command_routes` (20260821000400) carries a BEFORE UPDATE OR DELETE
  trigger that raises unconditionally, and its foreign key to `commands` is
  ON DELETE RESTRICT. Those two rules together do not make routing evidence
  immutable - they make the COMMAND immortal. No surface, function, or role
  could ever delete a routed command, which is not a rule anybody wrote down.
- Decision: `20260823000400` keeps the guarantee and drops the accident. An
  UPDATE is still refused unconditionally, with the same message and errcode.
  A DELETE is still refused, except inside the audited pipeline delete, which
  announces itself with a transaction-local setting that only that SECURITY
  DEFINER function sets and withdraws immediately after the statement.
- Rationale: `factory_command_routes` has no grants at all - `revoke all ...
  from public, anon, authenticated, service_role` - so no client role can
  reach the table with or without the setting. The trigger's real job is
  discipline between definer functions, and this names the one function
  allowed to release a route: the one deleting that route's own command,
  under owner-or-admin, with a recorded reason, in the same transaction. The
  file's postflight and the apply scope both re-assert that no client role
  holds DELETE on the table, and the scope proves by behaviour, in a
  rolled-back transaction against the real hosted rows, that ordinary UPDATE
  and DELETE are still refused (`update refused=t delete refused=t`,
  run 32652305439).
- Consequence: a routed pipeline can be deleted through the audited path and
  no other path gained anything. The released-route count goes to the audit
  event rather than the return shape, so the console keeps the columns it
  reads. This was the third distinct blocker between the owner and a working
  delete - after the live-work rule (ADR-131) and the analysis link's own
  restrict foreign key - and each was invisible until the one before it was
  removed.

## ADR-133 - A migration that died one function short is finished from measurement, not from the file

- Date: 2026-08-23
- Status: Accepted
- Context: owner-directed. `20260814002500_provider_credential_vault` was
  applied to hosted but never recorded in the ledger, and it stopped partway.
  Two costs followed: `POST /api/bots/connect/claim` calls
  `resolve_provider_connect_session` first, so every CORRECT sign-in code was
  answered `connect_session_invalid` and each retry minted another code that
  failed identically; and Supabase's preview branch, which replays every
  migration the ledger does not record, replayed the file into the table that
  already existed and died with 42P07 on every commit to main.
- Decision: measure first. `scope=probe` gained an exact object inventory for
  that file - both tables with their real column lists, the index, all six
  functions, the RLS flags and the client grants. Probe run 32652393423
  answered precisely: everything present and correctly postured except one
  function. `20260823000500` creates that one function, byte-for-byte as the
  original declares it, and its preflight refuses if the database is missing
  more than the probe found.
- Rationale: the runbook is explicit that NOT VISIBLE is not absent and that
  re-running the file raises 42P07. Re-applying the whole file was never an
  option, and guessing which half to apply would have been the same mistake
  in a new costume. The measurement made the repair a one-function change.
- Consequence: the apply scope creates the function, reads it back, re-checks
  that all nine of the original's objects are present, and only THEN records
  20260814002500 in the ledger - so the ledger can never claim "applied"
  about a database still short a function. Run 32653491713 did all of that:
  both rows recorded, posture verified. A correct sign-in code resolves
  again, and the preview branch has nothing left to replay for this file.

## ADR-134 - The Autonomy page's Clear archives, because three guards say projects are permanent

- Date: 2026-08-23
- Status: Accepted
- Context: the owner asked for a Clear control that empties the Autonomy
  page's "What the loop may do" section. That list is `from public.projects`
  with the resolved autonomy envelope per row, so emptying it appeared to
  mean deleting projects. The owner was told exactly what that destroys and
  chose it; then, when the append-only audit trail turned out to block it,
  was told that too and chose to preserve every event and release only its
  project pointer.
- Decision: neither, because a third guard settles it.
  `refuse_project_deletion` (20260815000900) states that a project's
  append-only activity trail makes it undeletable "from its first recorded
  moment, forever", that this is deliberate, that there is **no escape
  hatch**, and that "the supported end of a project's life is
  archive_project". Releasing the audit pointer would have destroyed the very
  property that guard exists to guarantee. So `20260823000600` adds
  `clear_autonomy_projects`, which archives every project through
  `archive_project`, and narrows `list_autonomy_status` to exclude archived
  projects.
- Rationale: archiving reaches the identical visible outcome - the section is
  empty - while deleting nothing. `archive_project` is already owner-only,
  already requires a reason, already writes an immutable event per
  transition, and deliberately keeps every run, task, command and activity
  row. And the list change is a truthfulness gain rather than a concession:
  the claim path filters on `project.status = 'active'`, so an archived
  project is precisely one the loop may do nothing with, and listing it under
  "what the loop may do" was already misleading.
- Consequence: Clear sits beside Refresh in the section it clears, confirms
  before firing, requires the ten-character reason the database requires, and
  reports what it archived alongside the sentence "Nothing was deleted".
  Projects remain on the Projects page and can be unarchived. The apply scope
  proves, in a rolled-back transaction against the real hosted rows, that a
  project still cannot be deleted. Three guards were met on the way here and
  all three are intact; the finding worth carrying forward is that when a
  system refuses the same operation in three independent places, the refusal
  is the design speaking.
- Amendment (2026-08-23): the first hosted apply of `20260823000600` failed on
  its own postflight - `projects_guarded_deletion is missing` - and the
  migration rolled back cleanly, applying nothing. The finding was real:
  `20260815000900` is one of the migrations hosted has never recorded, so the
  friendly trigger is absent there. What is *not* absent is the protection.
  That trigger's own comment says "nothing can pass the RESTRICT behind this
  trigger anyway", and the `activity_events -> projects` foreign key with
  `ON DELETE RESTRICT` is present on hosted. So the postflight now asserts the
  constraint that actually enforces permanence on every database, and merely
  reports the trigger's absence as a notice; the scope's rolled-back proof
  accepts SQLSTATE `23503` as well as the trigger's sentence. The lesson is to
  assert the enforcing object rather than the explaining one - the explanation
  is a courtesy, the constraint is the guarantee.

## ADR-135 - Signing in lands on a chooser, and the header names two products rather than three

- Date: 2026-08-23
- Status: Accepted
- Context: the owner asked for two things at once. First, that every signed-in
  person land on `/decision`, a screen offering the two products side by side,
  and that the page be reachable "only on initial login". Second, that the
  global navigation drop Administration and rename `AI Factory` to
  `Software Factory`.
- Decision:
  - `/decision` is a top-level route carrying the global header and no console
    sidebar, because the whole point of the screen is that the person has not
    yet said which console they want. Three gates run before it renders, in
    the order that makes each meaningful: signed out redirects to sign-in with
    a `next` back here; no workspace redirects through onboarding and back;
    and a closed gate redirects to `/solutions`.
  - "Only on initial login" is a marker cookie (`sf-decision`, HTTP-only,
    host-only, `SameSite=Lax`, 15 minutes) opened at the two places a session
    actually comes into existence - the password route and the auth callback -
    and closed by the act of choosing.
  - Choosing is a Server Action form submission, not a link. A link would be
    prefetched, and a prefetch that closed the gate would dismiss the chooser
    before the person had read it.
  - The default destination now lives in exactly one place. The sign-in *page*
    used to substitute `/solutions` when no `next` was supplied, which reached
    the route as an explicit request and silently overrode the route's own
    default; it now forwards only a `next` the caller actually asked for. The
    generic "Sign In" entries in the header and footer dropped their pinned
    `?next=/solutions` for the same reason. A prompt that says "sign in to see
    your pipelines" still carries its own `next`.
  - `globalNavigation` returns the two products for every signed-in viewer.
    `isSuperAdmin` is still accepted - the header uses it for the Super admin
    badge - but no longer adds an entry.
- Rationale: the gate grants nothing. It decides whether one chooser screen is
  shown; `/decision` still resolves the viewer through `readViewer()`, so a
  forged cookie earns a redirect rather than a page. Removing the Admin link
  removes a link, not access: `/solutions/admin` enforces its own
  authorization and the console column still lists it under Administration for
  the viewers who have it. The rename makes one thing have one name - the
  header entry, the decision card and the page title all now say Software
  Factory. The sidebar's separate `AI Factory` entry is a different
  destination (the guided journey at `/solutions/ai-factory`) and is
  unchanged.
- Consequence: the callback's default moved from `/auth/onboarding` to
  `/decision`, which also fixes an old wart - a returning person signing in by
  magic link was being shown "Name your workspace" for a workspace they
  already had. The honest limit of the gate is recorded in its own module:
  someone who lands on the chooser and navigates away without choosing can
  return to it until the cookie expires. Closing it on any other navigation
  would need middleware on every route, which is a much larger mechanism than
  a chooser screen warrants.
- Amendment (2026-08-23): the gate shipped with its default inverted and the
  page was unreachable. The marker meant "this person may see the chooser" and
  was written only by a fresh sign-in, so every session that already existed -
  the owner's included - carried nothing and was redirected to `/solutions`.
  A default of *closed* makes the absence of information mean denied, and
  absence is the ordinary case here: a session predating the feature, a
  cleared cookie jar and a brand-new login are indistinguishable, and all
  three should see the page. The marker now records the **decision** instead:
  absent means "has not chosen since signing in" and the chooser renders,
  `chosen` means the person picked a product and `/decision` sends them to the
  console. Signing in clears it, which is what "land all users on it" requires
  per login; signing out clears it too, so a shared browser inherits nothing.
  The general rule this is an instance of: a gate whose closed state is also
  its uninitialised state will deny every case it has never seen, and the
  first such case is always the existing users.

## ADR-136 - The lifecycle vocabulary is the eight stages the database holds, and the goal's ten map onto them

- Date: 2026-08-23
- Status: Superseded in part by ADR-137 (2026-08-23, same day)
- Superseded: the refusal to grow the enum was conditional, and its condition was met. ADR-137 built `discovery`, `evaluation` and `decision` as real capabilities with typed packages, then added DISCOVERY, EVALUATION and DECISION — which is exactly what this ADR named as the prerequisite. The eight are now eleven, and nine of the goal document's ten map one to one (REQUIREMENT still covers GOAL and PRD). What still stands is the reasoning: a stage is added when something produces it, never to make a picture match.
- Decision: `sdlc_stage` stays the eight values it has — GOAL, PRD, ARCHITECTURE, IMPLEMENTATION, REVIEW, TEST, DEPLOYMENT, MONITORING. The graph-engineering goal document's ten (REQUIREMENT, DISCOVER, EVALUATE, DECIDE, ARCHITECT, BUILD, REVIEW, TEST, DEPLOY, MONITOR) are a presentation of those eight, not a second vocabulary to add. Six map one to one — ARCHITECT/ARCHITECTURE, BUILD/IMPLEMENTATION, REVIEW, TEST, DEPLOY/DEPLOYMENT, MONITOR/MONITORING. REQUIREMENT covers GOAL and PRD, which is the request and the structured requirement it becomes. DISCOVER, EVALUATE and DECIDE have no stage of their own.
- Rationale: the three unmapped stages are the reason to decide rather than drift. Nothing in the system produces a node in them today: no template declares a discovery, evaluation or decision capability, and `NODE_CAPABILITIES` has no member that would resolve to one. Adding three enum values would create a vocabulary the database can express and nothing can populate — a stage filter that is permanently empty, and the "do not stop after creating scaffolding" rule broken in the same commit that claimed to satisfy the goal. The eight stages are not a smaller idea than the ten; they are the ones a node can actually be in. Discovery does exist in the engine (`lib/graph/discovery.ts`, the DISCOVERY_GRAPH the canary proved), and when a stored graph can add rounds mid-run — the limitation recorded on 2026-08-19 — a DISCOVERY stage will have something real to hold. That is when the enum should grow, and the migration is additive (`add value if not exists`) so waiting costs nothing.
- Also: this settles what a per-stage page may claim. A page per stage is buildable against the eight; a page per goal-document stage is not, because three of them would read live-looking and always be empty. `/solutions/ai-factory` today is the setup journey — connect a repository, assign bots, issue a command — and is not the lifecycle; naming it as the lifecycle surface would be the same untruth in the navigation.
- Consequence: the mapping is recorded here rather than in code, because code that nothing calls is the scaffolding this rejects. A future session building stage pages reads this ADR, builds the eight, and presents REQUIREMENT as GOAL and PRD together if the goal document's wording is wanted in the UI. If DISCOVER/EVALUATE/DECIDE are later wanted as first-class stages, the prerequisite is a capability that produces them, not an enum value.

## ADR-137 - The lifecycle grows DISCOVERY, EVALUATION and DECISION, because capabilities now produce them

- Date: 2026-08-23
- Status: Accepted
- Context: ADR-136 mapped the goal document's ten stages onto the database's
  eight and refused to grow the enum, naming the precondition: "the
  prerequisite is a capability that produces them, not an enum value." The
  owner then supplied the design for exactly those stages - the Step 2-4
  boards: an open-source scout that searches, dedupes and shortlists; an
  evaluator that scores a fixed 100-point rubric; a decider that weighs
  USE/CONNECT/ADAPT/FORK/BUILD - and asked for the graph to be built out.
- Decision: meet the precondition, then grow. Three new node capabilities
  (`discovery`, `evaluation`, `decision`) with typed, versioned output
  contracts in `lib/graph/stage-packages.ts`; one template
  (`open_source_scout`) whose seven nodes fan three parallel scans out of a
  clarified requirement, consolidate a shortlist, score it, and decide; and
  only then the additive migrations - 20260823000800 grows `sdlc_stage` by
  the three values between PRD and ARCHITECTURE, 20260823000900 extends the
  capability-to-stage derivation. Two files because PostgreSQL refuses to use
  an enum value in the transaction that added it, and the hosted apply runs
  each file under `psql -1` (the clear-controls precedent).
- The honesty constraint that shaped the contracts: the node executor reads
  with Read/Glob/Grep and has **no network**. So a discovery candidate must
  declare how it is known - REPOSITORY, DEPENDENCY, or MODEL_KNOWLEDGE - a
  recalled candidate can never claim VERIFIED_IN_REPO (schema refinement, not
  prompt hope), and popularity metrics are absent from the schema entirely: a
  stars count the executor cannot observe would be an invitation to recall
  one and present it as a reading. Live source lookups are an owner-gated
  tool-surface change, recorded in the backlog, not a template edit.
- Consequences: SDLC_STAGES is eleven; the owner's ten-stage presentation
  maps on with REQUIREMENT still covering GOAL+PRD and the other nine now one
  to one. REJECTION_RETURNS_TO sends DISCOVERY back to PRD, EVALUATION to
  DISCOVERY, DECISION to EVALUATION; ARCHITECTURE deliberately still returns
  to PRD, because every graph with an ARCHITECTURE stage has a PRD and only
  some have a DECISION. The evaluation rubric's weights are fixed in code
  (100 points, ten categories) so runs stay comparable; the weighted total is
  computed from the scores rather than trusted from the model. A decision
  package must weigh all five paths exactly once and choose one of them -
  enforced by the contract layer, so prose or a skipped path routes into a
  retry instead of downstream. The per-stage pages the other session's lane
  is building against SDLC_STAGES will pick the three up automatically.

## ADR-138 - One request through all ten phases is one template, not a second engine

- Date: 2026-08-23
- Status: Accepted
- Context: the owner's boards state the product's headline - "One Request In.
  Multiple Bots. Full Automation Out." - as an execution graph whose nodes
  are the ten steps, and directed that it be built out of existing code. The
  pieces all existed and none of them walked the whole road: the scout
  stopped at DECISION, and the agentic SDLC jumped from PRD to ARCHITECTURE.
- Decision: `full_lifecycle`, a fourteen-node BUILD template that stitches
  the scout's look-before-you-build chain into the SDLC's build half. Goal
  and requirements (REQUIREMENT as GOAL+PRD), three parallel scans into a
  tolerant consolidation (DISCOVER), the fixed rubric (EVALUATE), the five
  paths (DECIDE, AUTOMATIC gate), then design against the decision
  (ARCHITECT, HUMAN gate), implement, fresh-eyes review, anchored test
  evidence, deploy behind the owner's gate, and monitor with the feedback
  edge back to the goal. `isLifecycle: true`, so the orchestrator may
  iterate it. No new capability, contract, gate kind, executor, table or
  column - the entire template is existing machinery in a new arrangement,
  which is what the owner asked for.
- Budget honesty: thirteen sequential levels at the measured eight-minute
  model envelope, attempted twice, is 208 minutes of worst case, so the
  template declares 220 and the graph worker's job timeout rises from 180 to
  240 minutes (GitHub caps a hosted job at 360). The budget-fit suite pins
  the whole chain: node envelope → template budget → workflow timeout.
- What "working" means within this repository's own policies: MODEL nodes run
  through the proven record-only worker path; the ANCHOR test node demands
  recorded evidence; ARCHITECTURE and DEPLOYMENT stop at HUMAN gates because
  Phase 1 keeps externally visible acts owner-approved, and the kill switch
  stays ON. A graph that reaches the deploy gate and waits for the owner is
  the design succeeding, not falling short.
- Proof: tests/integration/full-lifecycle.behavior.test.ts launches the
  template through the same `create_graph_from_plan` the product uses and
  asserts: at least one stored node in every one of the eleven stages, no
  forward edge running backwards through the stage order, HUMAN gates at
  exactly ARCHITECTURE and DEPLOYMENT, AUTOMATIC at PRD/DECISION/REVIEW/TEST,
  and the recorded MONITOR→goal feedback edge.

## ADR-139 - Anchors are observations by instruments that cannot be persuaded, and the launch button wakes a worker

- Date: 2026-08-23
- Status: Accepted
- Context: the owner launched `full_lifecycle` from the Workflows page and
  the graph sat PLANNED. Two independent gaps: `POST /api/graphs` recorded
  the graph but woke nothing (only the command routes dispatched the
  worker, and the schedule is off by default), and `claim_planned_graph`
  correctly refused to hand a graph containing ANCHOR nodes to a worker
  that declared only DETERMINISTIC and MODEL. Both halves were truthful in
  isolation and together produced a button that said "run this" and meant
  "file this".
- Decision, wake half: the launch route resolves the project's GitHub
  binding and dispatches the graph worker best-effort after
  `create_graph_from_plan`. The wake sits in its own try so it can never
  fail a launch that already succeeded, and the response carries
  `workerWoken` plus a note naming which world the caller is in. A launch
  with no verified binding is still a created graph - claimable by
  schedule or manual dispatch - and says so.
- Decision, anchor half: the worker declares ANCHOR, executed by
  `lib/worker/anchor-node-executor.ts` as observations, never actions. The
  TEST anchor reads the CI check-run verdict GitHub recorded for the
  worker's own checked-out commit (a read-scoped workflow token; skipped
  and in-progress runs are not verdicts either way; green succeeds with
  the observation as evidence, red fails naming the checks). The MONITOR
  anchor probes the production URL and records status and latency -
  unreachable is itself the observation. The DEPLOY anchor is refused by
  policy, on the record: Phase 1 keeps deployment owner-approved, and the
  refusal text says the policy is holding rather than reporting a fault.
  None of these are retryable, because re-asking an instrument the same
  question milliseconds later is not a new observation.
- Why observation rather than execution: re-running a thirty-minute test
  suite inside an eight-minute node envelope would either lie about
  coverage or blow the envelope - and the budget estimator applies the
  slowest node to every level of every graph, so one slow anchor inflates
  the whole catalogue's budgets. CI already ran the suite for this exact
  commit; the anchor's job is to fetch that verdict and preserve it as
  evidence, which is what "record the results rather than describing
  them" has meant since the executor kinds were defined.
- The claim-matching rule survives unchanged: the executor-matching test
  now uses an explicitly narrow worker, because the rule it pins - a
  worker never receives a graph it cannot finish - protects the queue
  from any future executor kind, not from ANCHOR specifically.
- Amendment (same day): the guide-driven end-to-end walk found the same
  "recorded, then silence" gap at gate decisions - an approved gate
  stranded the run until the next manual dispatch. The decide route now
  applies the identical best-effort wake on approvals only (a rejection
  wakes nothing: the stage staying blocked is the outcome), reporting
  `workerWoken` truthfully. The stale "no executor is connected" wording
  on the Workflows page and launch control was retired at the same time,
  and the owner's step-by-step guide lives at docs/FULL_LIFECYCLE_GUIDE.md.
## ADR-140 - A node's detail is a read of columns already stored, and a field nothing writes is not projected

- Date: 2026-08-23
- Status: Accepted
- Context: round 7 recorded "clicking a node still reveals nothing" and rounds
  8, 9 and 10 each left it standing. The goal document asks a node for its job,
  inputs, dependencies, attempts, artifacts, timing and output.
  `list_graph_runs` projected node_key, executor, capability, state, provider,
  model, latency_ms and error_message — none of which answer any of those. The
  panel could report that a node FAILED and nothing about what it had been
  asked to do, how long it took, what it was waiting on, or what it produced.
- Finding: nothing was missing but the read. `node_runs` has stored
  `queued_at`, `started_at`, `completed_at` and `blocked_reason` since
  20260814000100 and `record_node_state_as_worker` writes all four;
  `graph_nodes` has stored `job` and `max_attempts`; `graph_artifacts` has
  carried `node_run_id`; `graph_edges` has always known which node feeds which.
  The migration adds no table, no column, no backfill, and touches no writer.
- Decision, shape: the new fields go *inside* the `nodes` jsonb rather than
  into new return columns, so `create or replace` suffices where 20260821000200
  had to drop and recreate. New keys in a jsonb payload are additive for every
  existing reader, so a browser running the previous bundle keeps working. The
  route needed no change at all: it already passes `row.nodes` through verbatim.
- Decision, dependencies: projected per node as `depends_on`, not as a
  run-level edge list. It is why the signature could stay fixed, and it is the
  better shape for the question — a reader looking at one node wants to know
  what that node waited for, and answering from the node's own row means the
  browser never joins two arrays and cannot get that join wrong.
- Decision, the omission: `node_runs.attempt` is deliberately NOT projected.
  The column exists and is never written — `claim_planned_graph` inserts one
  row per node at its default of 0, `record_node_state_as_worker` updates
  state, provider, model and timing but never `attempt`, and the runner counts
  attempts in memory. Projecting it would put a permanent 0 on every node under
  a heading that reads like measured fact, which is worse than the field being
  absent. `max_attempts` — the configured ceiling — is real and is shown, so a
  reader learns what the node is allowed without being told a retry count
  nobody records. An integration test asserts both halves: that the key is
  absent from the projection, and that every stored `attempt` is still 0. If a
  writer is ever added, project it and delete that test.
- Decision, timing: the three timestamps are projected raw and durations are
  derived by the caller. A duration computed in SQL would have to pick a clock
  for a node that never finished, and any pick would be a guess presented as a
  measurement. `lib/graph/node-detail.ts` returns null in the three cases where
  a duration is not knowable — never started, not yet finished, clocks out of
  order — and the panel omits the row rather than rendering an em dash.
- Also: wall time is not `latency_ms`, and neither is labelled as the other.
  `latency_ms` is the executor's own call time and is legitimately shorter than
  the time the node occupied; the table keeps showing the former under
  "Latency" and the detail shows the latter under "Ran for". Presenting either
  as the other would misattribute the gap between them.

## ADR-140 - A gate nothing can decide is a wall: automatic gates live on anchors and decide themselves

- Date: 2026-08-24
- Status: Accepted
- Context: the owner-directed end-to-end test with test data produced the
  first live full_lifecycle run (graph 91959362, run 6ac300ae) and it
  deadlocked at the PRD gate. Three facts composed into the deadlock:
  `decide_node_gate` correctly refuses to approve an AUTOMATIC gate with
  zero anchors; `anchorsFor` correctly counts only ANCHOR-executor output
  as evidence (a model's confidence about its own work is not an
  observation); and no code path anywhere decided an automatic gate at
  all. The templates had placed automatic gates on MODEL nodes - PRD,
  DECISION and REVIEW - whose gates therefore could never be approved by
  anyone, human or machine. The five PARTIAL agentic_sdlc graphs in the
  hosted queue all halted exactly there.
- Decision, template half: an automatic gate may only sit on an ANCHOR
  node. full_lifecycle and agentic_sdlc keep their two HUMAN gates
  (ARCHITECTURE, DEPLOYMENT) and exactly one AUTOMATIC gate each - on the
  TEST anchor. PRD, DECISION and REVIEW lose their gates: their quality
  control is real but different in kind - contract-enforced typed
  packages and fresh-eyes verifications - and pretending a wall is a gate
  helped nobody. The full-lifecycle behavior suite now pins the
  structural rule itself: every automatic gate sits on an anchor.
- Decision, decider half: `decide_automatic_gate_as_worker`
  (20260824000100) is the missing decider. It refuses a human gate
  unconditionally - a worker approving one would be an automated system
  approving its own guardrail - refuses zero anchors exactly as
  `decide_node_gate` does for a person, and returns an already-decided
  gate as the person left it. The worker offers it every automatic gate
  the run halted at, after `completeRun`, because the claim's reopen rule
  requires the decision to be newer than the run's close; the same drain
  loop then re-claims the graph and continues.
- Reporting: a gate-held node is FAILED to the engine (the only way to
  stop its dependents) but not to a reader. The run's stored
  incompleteness now appends which counted nodes actually halted at open
  gates, and the drain line lists them separately from failures.
- The worker's claim schema also caught up: its lifecycle_stage enum was
  the old eight stages and silently nulled the three newest; it now
  derives from SDLC_STAGES.
- Amendment (2026-08-24, same walk): the re-run after the decider landed
  proved eight stages flowing and then found the next strand - the
  architecture node hit the subscription's session limit and the PARTIAL
  close locked the graph out of the queue forever, though its failure was
  fuel rather than work. A lifecycle whose every terminal failure was
  capacity now closes CANCELLED regardless of how far it got: an analysis
  run's partial findings are an answer, a lifecycle's intermediate
  packages are not - its product is the shipped change. The record of
  what ran survives; the graph stays claimable for a dispatch after the
  limit resets. Pinned by the worker-execution behavior suite.

## ADR-141 - A lifecycle resumes from its own recorded results

- Date: 2026-08-24
- Status: Accepted
- Context: the worker re-executes a claimed graph from the beginning -
  the right shape for an analysis graph, whose value is fresh findings.
  Three consecutive live provider windows showed what that costs a
  lifecycle: each window was spent re-proving stages the graph had
  already completed and capped before reaching new ground (run 2469db25
  carried eight nodes and died at architecture; run 6a8d5121, one window
  later, carried seven and died at decide - a window BEHIND where the
  previous one ended). Under a shared subscription window the lifecycle
  could never converge.
- Decision: `read_prior_node_results_as_worker` (20260824000200, hosted
  scope lifecycle-resume) returns the most recently completed recorded
  result per node from a graph's own earlier non-answering runs
  (CANCELLED, PARTIAL, FAILED) - scoped in SQL to lifecycle graphs, read
  only, service_role execute only. `runClaimedGraph` substitutes those
  results instead of re-executing the nodes: zero tokens, zero latency,
  the artifact recorded again under the new run for lineage, the reuse
  named in the run summary and drain log so nothing reads fresher than
  it is. Verifications are not re-recorded for reused reviewers - the
  original rows stand.
- Bounds: analysis graphs are excluded by the join, not by worker
  etiquette; a COMPLETED run's graph never re-claims at all, so nothing
  can cannibalize a delivered answer; gate semantics are unchanged - a
  reused gated node still waits at OPEN and passes through APPROVED.
- Proof: the worker-execution behavior suite runs a lifecycle across a
  simulated session-limit window boundary (window one records one
  result and voids; window two reuses it - the executor is provably not
  called for it - and completes, with the artifact carried into the new
  run), and the analysis twin records a result that the read then
  refuses to offer.

## ADR-142 - The per-run stage page renders recorded packages, and its read is authenticated-only

- Date: 2026-08-24
- Status: Accepted
- Context: The owner's design boards ask for a per-run step page - the
  request at the top, the ten-step strip, what the stage produced, the
  decision where the stage holds one. The runs projection deliberately
  carries artifact counts, not payloads, so the recorded stage packages
  (the page's whole substance) had no member-facing read.
- Decision: `list_graph_run_artifacts` (20260824001000, hosted scope
  run-artifacts-read) returns one run's artifact rows with payloads
  verbatim - membership-checked, the run joined to the caller's
  organization, authenticated execute only (service_role revoked; the
  worker has its own writers). `GET /api/graphs/runs/[graphRunId]/
  artifacts` serves it unchanged. The page
  (`/solutions/lifecycle/run/[graphRunId]/[stage]`) renders a payload
  structurally only when a typed stage package parses it
  (decision/evaluation/discovery), and otherwise shows the exact JSON:
  verbatim beats paraphrase, and figures the boards imagined but nothing
  computes (confidence, estimated completion) are absent rather than
  invented.
- Bounds: `list_graph_runs` keeps counts only - a listing should not
  carry bodies; the page reads the newest hundred runs and says so when
  an id is older; gate decisions go through the shared GateDecision and
  the existing decide route, unchanged.

## ADR-143 - The resume read includes gate-halted work: an approved gate never re-pays

- Date: 2026-08-24
- Status: Accepted
- Context: Within hours of ADR-141 shipping, the live test lifecycle
  proved its gap. Run 6152cee2 executed the architecture node for real
  and halted at the ARCHITECTURE human gate (node recorded VERIFYING,
  artifact written first); the gate was approved; and the next claim
  re-executed the node from scratch, spending the rest of the 21:20
  provider window on work the database already held (run e3c4b582,
  CANCELLED on the session limit). The resume read offered only
  COMPLETED node runs, and a gate-halted node is never COMPLETED.
- Decision: 20260824001100 (hosted scope resume-gate-halted) widens
  `read_prior_node_results_as_worker` to node runs in
  (COMPLETED, VERIFYING). VERIFYING is precisely "work done and
  recorded; decision pending" - the artifact is written before the
  state transition, so the reuse is of real recorded work. No worker
  change: reuse substitution and the gate check compose - a reused
  result still halts at an OPEN gate (now at zero cost), still fails on
  REJECTED, and passes through on APPROVED.
- Bounds: unchanged otherwise - lifecycle graphs only, non-answering
  runs only, artifact required, service_role execute only. The behavior
  suite pins it: a gated lifecycle halts, the gate is approved, and the
  second window calls the executor for exactly the one genuinely new
  node.

## ADR-144 - The gate-approval watermark counts answers, not runs

- Date: 2026-08-25
- Status: accepted (migration 20260825000100, hosted apply scope
  gate-approval-voided)
- Context: live lifecycle d7241cf4 stranded on a three-step sequence:
  its run halted at the approved-later ARCHITECTURE human gate
  (PARTIAL), the owner approved the gate, and the next claim's run was
  voided by a provider session limit (CANCELLED, per the void rule).
  claim_planned_graph's reopen clause compared gate.decided_at against
  max(completed_at) over ALL runs - the void's close was newer, so the
  approval read as stale and nothing could ever claim the graph again.
  The queue diagnosis reported it honestly ("no fresh gate approval"),
  which is how the strand was found.
- Decision: the freshness watermark considers only runs that answered -
  states outside FAILED and CANCELLED. A voided or failed run answers
  nothing (that is already why those states leave a graph claimable
  elsewhere in the same function), so it cannot consume an approval.
  lib/worker/queue-diagnosis.ts mirrors the same filter so the drain's
  explanation cannot drift from the claim's truth.
- Bounds: an approval is still consumed by the next ANSWER - a later
  PARTIAL halt (the next gate) or COMPLETED close supersedes it, and
  the 3-failure / 10-run ceilings still retire runaway graphs. Pinned
  by the worker-execution case "keeps a gate approval fresh across a
  capacity-voided run" (halt, approve, void, then a third window that
  must claim and complete) and a queue-diagnosis unit case.

## ADR-145 - Turn budgets scale by capability, and the artifact guard fails one node, not the drain

- Date: 2026-08-25
- Status: accepted
- Context: the 07:20 window's drive surfaced two defects in one drain
  (worker run 32821441484). First, the lifecycle's implement node
  exhausted the flat 24-turn budget twice (graph run f200de80) while its
  nine upstream stages reused cleanly - implementation surveys a
  repository before it can describe a build, and the one-size envelope
  measured for scouts was the failure, not the work. Second, on the next
  graph (0dafc3b9) a node's real output tripped the
  graph_artifacts_payload_no_sensitive_data constraint - the guard doing
  its job - and the raw throw killed the whole drain for every
  organization's graphs.
- Decision: (1) the transport ceiling rises to 48 and the node executor
  grants IMPLEMENTATION_NODE_MAX_TURNS = 48 to implementation-capability
  nodes; every other capability keeps the measured 24. Both constants
  stay pinned against the ceiling in tests so a silent clamp cannot
  recur. (2) The engine records a node's artifact BEFORE its COMPLETED
  mark, and a guard refusal fails exactly that node with a fixed message
  that never restates the payload; any other storage error still stops
  the drain, because a database outage should. State finality is
  preserved - the node was never COMPLETED when the write was refused.
- Bounds: the guard itself is untouched; secret-shaped content still
  never enters the artifact record. Pinned by the worker-execution case
  "contains a sensitive-shaped output" (node FAILED with the clean
  message, siblings COMPLETED, run PARTIAL, queue intact) and the
  transport/executor turn-budget pins.

## ADR-146 - An overload keeps its retries; a limit does not; both wait

- Date: 2026-08-25
- Status: accepted
- Context: the live queue holds two consecutive runs of the same graph,
  six minutes apart, that together prove two joined defects. Run
  28b4dedf (2026-08-24 06:02Z) and run bfb6e0e7 (06:08Z) lost six nodes
  between them to `API Error: 529 Overloaded` - the provider's own
  message ends "usually temporary - try again in a moment" - and not one
  of those six nodes was ever retried. `isCapacityRefusal` matched
  session limits, rate limits and 529 alike, and the executor spends no
  attempts on a capacity refusal, so the single most retryable error the
  provider returns was the only one that never got a second attempt. An
  ordinary transport failure got three. Underneath that sat a second
  defect that would have made the first fix worthless:
  `RetryPolicy.backoffMs` shipped declared and defaulted to 2000ms, the
  compiler dropped it when building CompiledNode, and the runner
  re-queued a retrying node straight into the next scheduling tick.
  Every graph retry the engine has ever performed fired into the same
  instant that had just refused it.
- Decision: (1) split the classification. `isQuotaRefusal` covers what
  will not pass until a named reset - session limits, rate limits, 429 -
  and is never retried inside the run. `isTransientOverload` covers 529,
  "Overloaded" and "capacity", and keeps the same attempts a transport
  failure gets. `isCapacityRefusal` remains their union and remains what
  the run's void decision reads, so an overload that exhausts every
  attempt still leaves a lifecycle CANCELLED and claimable rather than
  recorded as an answer it never gave. (2) `backoffMs` is carried onto
  CompiledNode and honoured by the runner: one wait per scheduling
  round, not one per node, because an overloaded provider refuses
  whatever is in flight and the whole batch returns asking for the same
  pause. The wait is injectable (`deps.delay`) so a test can prove it
  happened without spending it.
- Bounds: `minimumGraphDurationMs` now counts the waits between attempts
  in its worst case - a ceiling that excluded the waiting would be one a
  run could pass with nothing wrong. The retry ceilings are unchanged:
  three attempts in the executor, `maxAttempts` in the runner. Pinned by
  four cases that fail without the change - the classification split,
  the retried 529, the per-round wait, and the wait not multiplying by
  graph width - plus guards that an exhausted overload stops retrying
  and a clean round waits for nothing.

## ADR-147 - Job Search has one canonical product entry and one audited recording transaction

- Date: 2026-08-27
- Status: accepted; hosted migration applied and verified; application production accepted
- Context: Search arrived in increments: four adapted public-board clients,
  `/job-seeker/search`, then the owner-named `/Job-Search` entry and a complete
  vendored upstream reference. The active goal names `/JobSearch` exactly and
  asks for a global product entry. Review also found two trust gaps beneath the
  page. Save accepted a browser-reposted job without evidence that the server
  had returned it, and `insertScoredJob` committed job, match and application
  in three independent requests, so a child refusal could strand an orphan
  that the next attempt called a duplicate. Child foreign keys named only the
  job id while child RLS checked the independently supplied child owner,
  leaving no schema proof that parent and child belonged to the same person.
  The exact upstream source reviewed for the correction is the complete
  214-file MIT snapshot at
  `79cd383e58f0af7948c7c6462a3a289e9b67421e`.
- Decision: `/JobSearch` is canonical and the signed-in global header names it
  **Job Search**. `/Job-Search` and `/job-seeker/search` remain compatibility
  entries but render the same content, use the same auth gate, and select the
  same Job Seeker shell; aliases do not own behavior. The four adapted,
  keyless boards remain Jobnet, Jobindex, Jobdanmark and Freehire, and each
  declares whether it can truthfully apply free-text location. LinkedIn stays
  excluded because service terms are authority separate from an MIT licence.
  Jobbank is deferred until the upstream's intermittent Cloudflare/WebSearch
  fallback has a reliable reviewed product contract; the deferral is not a
  permanent impossibility claim.
- Decision: every returned posting is accompanied by a short-lived sealed
  token scoped to organization and user and containing a digest of board plus
  every normalized job field. Save verifies that evidence before scoring or
  persistence. Persistence crosses one authenticated-only `SECURITY DEFINER`
  function, `record_job_seeker_job`, with exact
  `search_path=pg_catalog`. It derives ownership from `auth.uid()`, verifies
  organization membership, and writes job, match, initial application and
  immutable `job_seeker.job_recorded` evidence in one transaction. The dedupe
  index remains the concurrency authority and returns a no-write `duplicate`
  outcome. Composite `(job_id, organization_id, user_id)` foreign keys prove
  child/parent ownership identity. RLS stays enabled and forced.
- Bounds: direct, non-persistent probes (Jobnet 2/4, Jobindex 2/736,
  Jobdanmark 0/0 for London, Freehire 2/6752) prove current board contracts,
  not production acceptance or future third-party stability. The new RPC is
  supplied by forward migration
  `20260827000100_record_job_seeker_job_atomically.sql`. Database-first workflow
  run `33111692239` applied its exact SHA-256
  `2f51bf64ba3fd2bc711e6fbf9e660a2cc0dd5ef4b1f85d932ee574e79e9c7d13` to
  project `qpuofpmagrmyamahqwxw` and verified ledger, routine identity/ACL,
  constraints, PostgREST reload and forced RLS. Application release
  `aabd82b3a626da94a2478ef26f043a51d059cd15` passed exact-head CI
  `33114868741`, exact Vercel Production deployment `6130751384`, health and
  signed-in production search/save/readback. The accepted record was attributed
  `jobnet`, scored 35/100, initialized at FOUND and matched exactly one immutable
  event. Authenticated direct INSERT is not revoked in
  this migration because the existing manual jobs POST route still uses it;
  move and test that final writer before a later forward ACL contraction. No
  reset, down-migration, worker, autonomous action or deployment is implied by
  accepting this source decision.

## ADR-148 - A run states why it ended, in the run's own row

- Date: 2026-08-25
- Status: accepted
- Context: `lib/worker/graph-run.ts` composes a run-level explanation
  before every close - whether the fan-in was whole, that a
  capacity-voided run is void rather than failed, and the correction
  that matters most to a reader: "N of the nodes counted above did not
  fail: they halted at an open lifecycle gate and continue once the gate
  is decided." Its own comment says the record should carry that "rather
  than leaving the correction to whoever happens to know the
  distinction". It was left to whoever happens to know. The message
  reached `GraphRunStore.completeRun`, whose parameter was named
  `_detail` because nothing read it: `complete_graph_run_as_worker` had
  no parameter to carry it and `graph_runs` had no column to hold it.
  Every run-level explanation this engine has produced was computed and
  discarded. The live queue shows the cost - ten CANCELLED runs, none of
  which states a reason.
- Decision: `graph_runs` gains `closure_note`, written by
  `complete_graph_run_as_worker` from that same assessment and projected
  by `list_graph_runs` (migration 20260825000300). This is the argument
  `node_runs.blocked_reason` has made since 20260814000100, one level
  up: a run whose reason is invisible sends the reader to the event log
  to learn something the row already knew. A note that trims to nothing
  is stored as null, because an empty note reads as "a reason was
  recorded and it was blank".
- Bounds: no backfill. Runs closed before the column existed have no
  note because none was ever stored, and writing a plausible one now
  would put invented text under a heading that reads like a record. The
  migration is backward compatible with the code already deployed - the
  new parameter is defaulted, so the live worker's seven-argument call
  still resolves - which fixes the release order: apply the migration
  first, then deploy the code that sends the note. The `list_graph_runs`
  body is restated from 20260825000200 rather than the older
  20260823001000, because that file landed on main while this change was
  in flight and rebuilding from the stale version would have silently
  reverted its cost columns.

## ADR-149 - Revenue: Stripe subscriptions behind the storefront that already existed

- Date: 2026-08-25
- Status: accepted
- Context: the owner directed, verbatim, that the site needs a revenue
  avenue. The storefront predated this decision by two weeks:
  `marketing_pricing_plans` (20260813000500) has advertised Free / Basic
  $29 / Pro $79 / Enterprise with yearly discounts, and every "Start
  Free Trial" button pointed at `/sign-in` with nothing behind it. The
  gap was not a pricing page; it was that no mechanism existed by which
  money could move or a plan could mean anything.
- Decision: organization-level Stripe subscription billing, mirrored
  into Supabase, enforced at the two creation boundaries that cost
  compute. Specifically: (1) `billing_customers` /
  `billing_subscriptions` / `billing_events` (migration 20260825000400,
  scope=billing-foundation) with forced RLS, member-only reads, and no
  browser write path - the verified Stripe webhook (service_role, the
  same posture as the GitHub webhook) is the only subscription writer,
  idempotent by event id; (2) a deliberately thin Stripe REST client
  (three endpoints plus HMAC signature verification, no SDK dependency,
  no Stripe key of any kind in the browser - Checkout and the portal are
  Stripe-hosted redirects); (3) entitlements resolved from the newest
  standing subscription (`active`, `trialing`, and `past_due` for
  Stripe's retry grace) with Free as the absence of one, enforced as
  HTTP 402 refusals naming plan, limit, and current count on project
  creation and graph launches - creation-gating only, never revocation
  of existing work; (4) the pricing page's cards become real checkout
  buttons only for plans whose Stripe price is actually configured, and
  `/solutions/billing` (Settings → Billing) shows plan, meters, and the
  portal. Plan copy stays in the marketing tables; plan entitlements
  live in `lib/billing/plans.ts` so a limit and its enforcement version
  together.
- Bounds: absent configuration everything renders **Not Connected** and
  the storefront behaves exactly as before - no dead checkout, no
  pretend success. Prices are never hard-coded; the charged amount is
  Stripe's price object, the advertised amount is the marketing row, and
  the go-live runbook (docs/BILLING_GO_LIVE.md) is the owner's checklist
  for making them agree. Attribution is by ids only (metadata uuid or
  the customer mapping); a subscription the mirror cannot attribute is
  recorded and never guessed at. Seat enforcement waits for a member
  invite surface to exist; Enterprise stays contact-only. The quota gates
  the Workflows Launch route; command-driven analysis graphs
  (`launch_command_analysis_graph`) count toward the month's usage but are
  gated by their own command budgets rather than refused here — pricing a
  command's implicit graph is a follow-on, recorded in the backlog. The quota
  check is a read-before-write soft limit by design - one concurrent
  overshoot costs at most one row and corrects on the next attempt.

## ADR-150 - The ten-step Factory is one release-identity-bound protocol

- Date: 2026-08-27
- Status: accepted locally; production publication, hosted cutover, and
  signed-in owner acceptance pending
- Context: the existing ten-step presentation could describe progress without
  proving that Requirements, planning, implementation, review, CI, deployment,
  and monitoring belonged to the same repository revision and release. Legacy
  graph claim/read functions also remained callable, so a mixed-version worker
  could create evidence outside the new protocol.
- Decision: Factory v2 binds every lifecycle launch to the exact active
  project, primary repository, base SHA, policy, and protocol version; carries
  immutable Phase 1C command, draft PR, exact-head checks, merge, deployment,
  health, and monitor lineage; and renders the exact graph/run requested by the
  URL. Cutover is forward-only and split into two protected one-shot scopes:
  `20260827000150_fence_legacy_graph_protocol.sql` first, followed only after
  exact acceptance by `20260827000200_graph_phase1c_release_lineage.sql`.
  Their stable LF-normalized SHA-256 identities are
  `A4B505841D94CC89DFC82E24837DEDB78356B56C5F5698C0748F8B6735341A49`
  and `23197552DF3F442AE8264BF71BD28A7C479E09A64BF6E298C615B767A96572BE`.
- Bounds: candidate `ead498b495ac59d920e6f76df7917ea830dbcf8c` is locally
  audited but not deployed, and neither migration is hosted. The former Claude
  bot/account was explicitly removed on 2026-08-23; production Steps 8/9 need a
  fresh supported owner account connection rather than a planner exception.
  No decision here authorizes credential recovery, worker/provider execution,
  autonomy, automatic action, kill-switch release, reset, replay, or
  down-migration. Those execution surfaces remain OFF and the kill switch ON.

## ADR-151 - The AI Factory viewer gate resolves before protected client reads

- Date: 2026-08-28
- Status: accepted locally; production publication pending
- Context: a signed-out or unavailable tenant could leave the real AI Factory
  on its loading shell while the browser waited for every protected workspace
  read. Adding a leaf-page viewer check removed the fan-out but duplicated the
  portal layout's verified Supabase lookup.
- Decision: the leaf page passes a server-verified signed-in presentation hint
  to `AiFactoryConsole`; a known signed-out viewer renders the gate immediately
  and starts no protected reads. `readViewer` uses request-scoped
  `React.cache`, as prescribed by the Next 16 data-access guidance, and a
  five-second fail-closed deadline so an unavailable identity provider cannot
  hold the public shell indefinitely.
- Bounds: this is presentation and availability behavior, not authorization.
  Every API enforces its own verified identity and tenant policy. No viewer
  result is shared between requests, and timeout never grants access.

## ADR-152 - Executable release workflows have a tested size budget

- Date: 2026-08-28
- Status: accepted locally; recovery publication pending
- Context: GitHub accepted a protected migration dispatch but never planned a
  job because its workflow blob was 517,320 bytes, above the platform's 500 KB
  limit. The run remained queued with zero jobs, which can look like runner or
  database contention even though no executable step exists.
- Decision: keep operational explanations in `AI/HOSTED_APPLY_RUNBOOK.md`, keep
  the workflow's dispatch help concise, and enforce a 490,000-byte UTF-8 ceiling
  in the graph-protocol scope contract. The recovery removes only comments/help
  text; scopes, hashes, release gates, SQL staging, and shell bodies are fixed.
- Bounds: a zero-job oversized workflow is not migration evidence. Recovery
  still requires a new exact-head CI/READY release and the separate 00150 then
  00200 one-shot acceptance sequence. It authorizes no worker, autonomy,
  automatic action, replay, reset, or down-migration.

## ADR-153 - Legacy graph payloads are contained by an exact manifest, forward only

- Date: 2026-08-28
- Status: accepted locally; hosted probe, containment, and lineage acceptance pending
- Context: exact run `33144600401` committed the `00150` legacy-authority
  fence. The next protected run, `33144659265`, reached unchanged migration
  `00200` and failed at its deliberate catalog guard because a pre-existing
  graph artifact payload is sensitive or exceeds one megabyte. The migration
  file and ledger insert ran inside one `psql --single-transaction`, so the
  error atomically rolled back every `00200` DDL statement and its ledger row.
  Editing the published migration, restoring legacy authority, resetting
  history, or down-migrating would destroy the release identity or reopen the
  fenced protocol.
- Decision: add forward migration
  `20260827000210_contain_legacy_graph_artifact_payloads.sql` (SHA-256
  `c37a55efe74e9a9b4118924e1b2cbd0378a76f0d98c9747c6c66fffda9697de1`).
  It removes only payload bodies that violate the sensitive-key or size guard,
  records no copy of them, retains a digest/byte-count/classification in a
  private immutable FORCE-RLS/no-ACL evidence table, replaces each body with a
  bounded evidence-linked tombstone, installs update immutability, and
  validates both payload constraints. One dedicated workflow separates
  payload-free `probe`, manifest-pinned `contain`, and prerequisite-pinned
  `lineage`, while sharing the `apply-hosted-migrations` concurrency group so
  no production DDL scope overlaps them. Probe emits only an exact candidate
  count, manifest SHA-256, and downstream blocker counts. Contain rechecks the
  same values while locking `node_runs` and artifact state, then stages only
  hash-pinned `00210`. Lineage requires accepted `00210`, the same positive
  count and manifest SHA-256 from probe, and reconstructs that manifest from
  private audit rows before locking, under lock, and after commit while checking
  exact evidence-linked tombstones and raw table/function ACLs. It then stages
  only the frozen unchanged `00200`.
  The legacy fence is always exact but changes shape at the intentional v2
  boundary: before v2, all nine legacy signatures are fully revoked; after v2,
  eight remain revoked and `decide_node_gate(uuid,boolean,text)` becomes an
  authenticated-only, owner/admin-checked, `SECURITY DEFINER`, pinned-search-
  path, evidence-bound RPC, with anonymous and `service_role` still refused. A
  fresh or future-dated active/draining heartbeat blocks. Constraints, FORCE
  RLS, exact raw ACLs, audit triggers, and stopped safety state are validated
  inside the DDL/ledger transaction and repeated after commit.
  Payloads and row identifiers are never logged.
- Bounds: `00150` remains hosted exactly once and must never be replayed.
  `00210` is irreversible containment of policy-violating payload bodies, so a
  changed manifest or any identity/evidence blocker stops rather than guessing.
  Unchanged `00200` remains absent and may be admitted only as a separate
  protected action after exact hosted `00210` acceptance. Workers, provider
  execution, autonomy, and all automatic actions stay OFF; the global kill
  switch stays ON. This decision authorizes no reset, down-migration, legacy
  grant restoration, status upgrade, or worker dispatch.

## ADR-154 - Full Lifecycle closes only through atomic exact-release validation

- Date: 2026-08-28
- Status: accepted locally; publication and hosted migration pending
- Context: the lifecycle could record a successful HTTP probe after deployment,
  but that alone did not prove that the public alias served the exact accepted
  merge, that Supabase was reachable, tenant APIs still refused anonymous
  access, required security headers were present, exact-release CI stayed
  green, or that all evidence closed atomically with the Phase 1C bridge.
- Decision: `20260828000300_graph_postdeploy_validation.sql` (SHA-256
  `0104f4b6514eb42fddb931b76a8026cea4834547f8dff011c2fff956d11579a5`)
  admits enhanced post-deploy completion only for the canonical
  `full_lifecycle` version-2 plan digest
  (`0ec1e97b80dc8696872d88162c5271f9ea822e7dea79556c5470730a025d3b49`)
  while preserving the launch function's signature, `SECURITY DEFINER`, pinned
  search path, ACL, and structural guards. The service-role-only terminal RPC
  accepts a completed version-2 run only when its single MONITOR anchor carries
  five distinct passing stages: release identity, public availability,
  Supabase/data integration, exact CI plus security/auth boundaries, and a
  bounded consecutive observation window. In one transaction it closes the
  run, writes the disabled production monitor and immutable observation,
  writes the passing deployment validation, and advances the exact Phase 1C
  bridge to `VALIDATED`; any identity, timing, evidence, or lineage mismatch
  rolls back all of them. Pre-release version-2 graphs keep their stored strict
  DEPLOY/MONITOR schemas and legacy completion path, so a forward migration
  never strands a run that was already planned. Exact lost-response replay
  writes no duplicates.
- Consequence: a 200 response, an immutable provider deployment URL, or a
  user-entered public alias cannot independently complete the lifecycle. The
  stable public URL is probed while the immutable Vercel deployment URL stays
  release identity, and `/api/health` binds the public surface back to the
  exact Vercel project/deployment ID and URL, deployment SHA/ref, and an
  independently configured exact Supabase project identity. The hosted gate
  additionally requires GitHub's Vercel-bot Production URL to equal the URL
  reported by the public alias, so two independent deployments serving the
  same SHA cannot satisfy the release join.
- Bounds: the monitor record remains disabled and this decision does not
  create a deployment, merge a pull request, dispatch a provider, enable a
  worker, enable autonomy or automatic action, or release the global kill
  switch. Hosted application remains forward-only after exact-head release
  acceptance.

## ADR-155 - A one-shot worker wake claims only its immutable target

- Date: 2026-08-28
- Status: accepted locally; publication and hosted migration pending
- Context: repository dispatch carried an opaque graph or Phase 1C command
  UUID, but the worker used that UUID only for graph queue diagnosis. Both
  database claims still selected the globally highest-priority eligible item.
  In a shared production queue, a wake for one owner-reviewed lifecycle could
  therefore execute an unrelated item, and an older item could indefinitely
  prevent the requested canary from advancing.
- Decision: forward migration `20260828000200_target_bound_worker_claims.sql`
  (LF SHA-256
  `f7d87242534e16bacd22c0244784a992bded3c335fcb0a38e85d8a6b9168eaa5`)
  adds service-role-only target claim RPCs. Uniquely named target-aware private
  selectors are now the
  authoritative graph and Phase 1C selectors: the target UUID is applied in
  stale cleanup, eligibility/admission, locking, and withheld-work diagnosis.
  Existing four-argument internal APIs delegate with a null target, preserving
  the disabled-by-default scheduled queue behavior, while dispatch/manual
  workflows require a UUID and execute once. A defensive projection assertion
  aborts if a future refactor returns a different identity. An ineligible
  Phase 1C target returns no row after its target-scoped stale cleanup, so that
  cleanup commits and the caller can report bounded persisted state without
  claiming a neighbor. The graph claim separately
  projects `project_production_url`; it never replaces the exact provider
  `deployment_url` recorded in release lineage.
- Consequence: a dispatch is a wake, not authority, but its identity is now a
  database filter. Eligibility, repository binding, budgets, leases, circuit
  breakers, exact audit writes, RLS, and existing public ACLs are unchanged.
  Any future claim-policy change must update the target-aware selector; the
  legacy scheduled wrapper inherits it automatically through the null-target
  delegation.
- Bounds: the migration and workflows do not enable either worker or its
  schedule. Every graph-worker event and every application dispatch is behind
  the same exact `SOFTWAREFACTORY_GRAPH_WORKER_ENABLED == true` fail-closed
  switch. They do not enable provider execution, autonomy, approval, merge,
  deployment, rollback, or automatic action, and do not release the global
  kill switch. A target that fails policy remains unclaimed.

## ADR-156 - The public production URL is explicit owner-managed evidence

- Date: 2026-08-28
- Status: accepted locally; publication and hosted migration pending
- Context: Full Lifecycle Step 10 must probe the public address customers use,
  which can differ from the exact provider deployment URL retained in release
  lineage. `projects.production_url` was readable but had no supported writer,
  and its original constraint checked only an `https://` prefix. A protected
  provider URL cannot be silently substituted without changing the evidence's
  meaning.
- Decision: forward migration
  `20260828000100_project_production_url_configuration.sql` (LF SHA-256
  `0856ddee447280a1bb4418f25d6a6d4650687e168fffcd5e98e8ce15edd62b27`) preserves
  `update_project_details(uuid,text,text)` and adds a separate authenticated
  owner/admin `SECURITY DEFINER` setter with pinned search path. Request and
  database boundaries both reject credentials and likely-secret-bearing path
  material (the database calls the existing secret predicate directly), query/fragment material,
  non-HTTPS, localhost/private/intranet, ambiguous numeric, IPv6-literal, and
  non-standard-port targets. Real changes use the existing immutable
  `project.updated` trigger; no-op replays do not fabricate events, archived
  projects refuse edits, and projects FORCE RLS remains asserted. The project
  detail UI is the human configuration surface.
- Consequence: a lifecycle claim may carry a separately configured stable
  public URL without overwriting exact deployment lineage. Lexical validation
  is not treated as DNS proof: the monitor's guarded connection-bound lookup
  still rejects a hostname whose actual socket address is private or reserved.
  A missing URL remains **Not Connected**, never an inferred default.
- Bounds: the migration and UI do not set a live value, initiate a probe,
  enable a worker, expand autonomy, authorize deployment, or release the kill
  switch. Hosted application and signed-in value/audit acceptance remain
  separate release evidence.

## ADR-157 - Production release authorization is non-replayable and identity-joined

- Date: 2026-08-28
- Status: accepted locally; publication and hosted acceptance pending
- Context: an Actions rerun retains the original `GITHUB_ACTOR` while naming
  the person who requested the rerun separately, and a manual workflow can be
  dispatched against a selected branch. Separately checking a Git SHA in
  GitHub, a generated Vercel hostname, and a public alias did not prove they
  represented one Vercel project/deployment.
- Decision: mutation scopes require the configured actor to equal both
  `GITHUB_ACTOR` and `GITHUB_TRIGGERING_ACTOR` and require run attempt 1; a
  failed mutation is retried only as a fresh dispatch with the same exact
  `release_sha`. Manual graph execution is main-only in addition to its global
  OFF-by-default switch. `/api/health` fails closed unless the request arrived
  through the configured production host and Vercel's system project ID,
  deployment ID/URL, target environment, Git SHA/ref, and Supabase project all
  match configured identities. The release workflow compares the health
  deployment URL with the exact Vercel-bot GitHub deployment status twice.
- Consequence: an earlier owner's failed approval cannot be replayed by a
  different actor; unreviewed manual graph refs cannot receive production
  worker credentials through the reviewed workflow; and alias, deployment,
  repository, and database evidence form one exact release identity.
- Bounds: project/deployment IDs and hostnames are non-secret identity values.
  No worker, provider, autonomy, automatic action, merge, deployment, reset,
  or down-migration is enabled or initiated by this decision.

## ADR-158 - The site sets up its own Stripe account contents

- Date: 2026-08-28
- Status: accepted
- Context: the billing release (ADR-149) required six values to travel
  by hand from two dashboards into Vercel. The owner tried; the
  configuration report (shape diagnostic, shipped mid-saga) proved the
  production runtime saw none of them across seven hours and four fresh
  deployments — the failure mode was never the code, it was six manual
  pastes with an invisible Production checkbox. The owner then asked,
  verbatim, to "do everything for me", and offered a browser session an
  isolated cloud container cannot reach; secrets must not transit the
  agent's transcript in any case.
- Decision: shrink the human part to the two values that are genuinely
  secrets, and have the deployment create everything else itself.
  (1) Prices become addressable by fixed lookup keys
  (`factory_<plan>_<cadence>`): `resolvePriceId` reads the env var
  first, then queries Stripe by lookup key with a 60-second per-instance
  cache, so per-price environment variables are now optional. (2) A
  super-administrator-only route, `POST /api/billing/bootstrap`,
  idempotently ensures the Basic/Pro products, the four lookup-keyed
  recurring prices at the advertised amounts, and the webhook endpoint
  aimed at the deployment — find-first on lookup key and webhook URL, so
  running it twice changes nothing. The webhook signing secret Stripe
  returns only at creation travels once, in the response, to the super
  administrator's screen; it is never logged or stored. Tenant
  organization owners are refused: the Stripe account belongs to the
  platform, and `isSuperAdmin` is the same authority the admin page
  uses. (3) `billingConnected` now also requires the webhook signing
  secret — a checkout that charges while the mirror is deaf would take
  money without granting anything, so "connected" means the whole loop.
- Bounds: the bootstrap needs `STRIPE_SECRET_KEY` and cannot install it;
  the two secret pastes into Vercel remain the owner's, by design — the
  transcript rule ("never place credentials in chat, logs") is why the
  agent refuses to ferry them even when offered dashboard access. The
  bootstrap writes only to the platform's own Stripe account, additively
  and idempotently; it never deletes, and a webhook that exists without
  a known secret is reported with instructions to reveal it in Stripe
  rather than recreated behind the working one's back.
## ADR-159 - Normalize the partially applied Phase 1C selector with one isolated forward migration

- Date: 2026-08-28
- Status: accepted locally; exact-head publication and protected hosted apply pending
- Context: exact application release
  `79ca52f5b92e7d95292210e05565d35d21b4a435` is live with all four CI jobs,
  exact READY Vercel identity, and public release-health join green. Protected
  read-only probe `33159805326` nevertheless stopped before the release-tail
  migrations because production has the `20260815000300` body of
  `claim_phase1c_run_budget_internal(text,text,text,integer)` (MD5
  `ed5840b9d8d0efdb513a8576df128e9b`) while its breaker helpers and table
  already have the later catalog shape. The required frozen `20260815000500`
  selector body is `5933952d71f9da90a2a80a05ce6e0378`. Seventeen older
  versions beginning at `20260815000200` are absent from the hosted ledger
  despite partial effects, so replaying history or merely marking it applied
  cannot establish truth.
- Decision: add only forward migration
  `20260828000050_normalize_breaker_aware_phase1c_selector.sql` (LF SHA-256
  `8914034508451d1550ebf3f1bedd8f7b71592f1809306e78c57774c458952896`)
  before the existing `00100`, `00200`, and `00300` release tail. Its
  preflight accepts only the exact stale or already-normalized selector body;
  verifies the unchanged ABI, postgres owner, `SECURITY DEFINER`, exact
  `search_path=pg_catalog`, owner-only execute ACL, exact breaker-helper
  identities, FORCE-RLS breaker table, browser/table ACL, constraints/policy,
  and absence of target-bound selector objects; replaces only the Phase 1C
  selector with the frozen breaker-aware body; then repeats the exact target
  catalog and ACL assertions. A dedicated hash-pinned
  `selector-normalization` workflow scope preserves exact-main, four-job CI,
  READY Vercel/health, stopped-runtime, single-file staging, linked lint,
  transaction/lock, ledger, schema reload, and postflight gates.
- Consequence: a clean migration chain and the exact observed partially
  applied hosted shape converge on the same function without changing its
  signature or authority, replaying `20260815000300`/`20260815000500`, or
  claiming their history was repaired. Local evidence is lint/typecheck
  green, 5,150 tests passed / 7 skipped across 442 files, and a 171/171-page
  production build. The remaining 17-version ledger drift stays explicit and
  requires separate object-by-object catalog proof, forward compensation, and
  only then protected reconciliation.
- Bounds: no token/account is copied between tenants, and no provider OAuth is
  inferred from catalog repair. Workers, provider execution, autonomy,
  schedules, the auth broker, and automatic actions remain OFF; the global
  kill switch remains ON. This decision authorizes no historical edit/replay,
  blind ledger insertion, reset, down-migration, worker dispatch, or claim of
  signed-in Steps 8-10 acceptance.

## ADR-160 - Bootstrap one exact verified Auth identity through a disposable secret boundary

- Date: 2026-08-28
- Status: accepted; one-shot production dispatch completed and disposed
- Context: the owner requested `blackstoneagencyllc@gmail.com` as a verified
  Supabase Auth account with a supplied password. A real password must not be
  committed, passed as a workflow input, copied into a database migration, or
  printed in logs. Direct `auth.users` writes would bypass GoTrue's supported
  password hashing and identity invariants.
- Decision: publish a temporary `workflow_dispatch` path fixed to exact
  repository `surgeservicesllc/SoftwareFactory`, `main`, Supabase project
  `qpuofpmagrmyamahqwxw`, and the one normalized email. Require an exact
  confirmation phrase, configured production actor equality for both actor
  fields, and run attempt 1 with no GitHub token permissions. Supply the
  password through a temporary encrypted repository secret and use the
  existing service-role secret only inside the runner. The script uses the
  GoTrue Admin API, refuses duplicates, idempotently creates or updates the
  exact identity, and re-reads its UUID, exact email, and parseable
  `email_confirmed_at`; it emits no credential or response payload.
- Consequence: the requested Auth identity can be created through Supabase's
  supported password boundary without persistent plaintext or an arbitrary
  admin endpoint. After one accepted run, delete the temporary password secret
  and remove the temporary workflow/test in a forward cleanup commit.
- Evidence: exact first-attempt run `33164766560` on exact release
  `298264b02fe5a29e3c139f8077e65d6270f19167` returned one bounded updated UUID
  after exact confirmed readback. The temporary password secret was deleted
  immediately, and the disposable workflow/test are removed by the next
  forward cleanup release.
- Bounds: an Auth identity is not organization membership or an application
  role. This decision grants neither, connects no provider, enables no worker,
  changes no autonomy/action setting, and does not release the global kill
  switch.

## ADR-161 - Accept the public project URL through a disposable signed-in boundary

- Date: 2026-08-28
- Status: accepted locally; exact production dispatch pending
- Context: protected first-attempt runs have installed the selector
  normalization and owner/admin-only URL writer, leaving the release ledger at
  `1|1|1|1|0|0`. The migration workflow proves catalog/ACL/runtime shape but
  intentionally cannot prove that the production application establishes a
  real user session, selects the intended tenant, persists a value, emits one
  immutable audit event, and reloads it. Existing remote journey inputs are
  plaintext and must never carry an owner's password.
- Decision: publish a temporary manual workflow serialized with production
  migrations. Read the owner email and project name only from temporary
  encrypted repository secrets, require that already-confirmed identity to be
  an exact owner/admin of one non-archived unset project, and use the existing
  service credential only to mint an ephemeral magic-link token. Consume that
  token through the production callback, select the exact organization, call
  the same-origin production URL API, verify one owner-attributed
  `project.updated` event, replay the identical write with zero new events, and
  reload the value through the signed-in portfolio API. Check exact
  main/four-job CI/READY deployment/public health, writer/predicate/constraint/
  RLS/audit catalog, stopped workflows, every autonomy/action flag, worker
  heartbeats/runs, and kill switches initially, immediately before mutation,
  and after reload.
- Consequence: application acceptance uses the production boundary without
  exposing, resetting, or storing a password and cannot silently pass on a
  skipped authorization job, preseeded URL, unconfirmed identity, broadened
  ACL, moved release, active worker, or duplicate audit event. Delete the two
  temporary selectors immediately after the accepted run and remove the
  disposable workflow/test in the next forward commit.
- Bounds: this changes only the one public URL and its existing immutable
  audit trail. It grants no membership, connects no provider, enables no
  worker/autonomy/automatic action, does not release the kill switch, and does
  not authorize replay, reset, down-migration, or historical ledger repair.
