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
- Decision: Keep repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` absent or not equal to literal `true` through migration, secret configuration, code publication, ordinary CI, and Vercel verification; every repository-dispatch and schedule worker trigger must skip while it is OFF. Omit branch-selectable manual workflow dispatch from this secret-bearing workflow. Treat setting the variable to `true` as the final exact owner-approved RED activation. Separately require `SOFTWAREFACTORY_REQUIRED_CHECKS` to contain 1-20 unique pipe-delimited exact GitHub check names. The reviewed workflow fixes `Lint, typecheck, test, and build|Browser and accessibility tests`. A run may pass CI only when GitHub returns the complete check set, every observed check is terminal with an acceptable conclusion, every required name is present with exact `success`, the identical passing fingerprint is observed twice, and the draft PR number/base/head still match.
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
