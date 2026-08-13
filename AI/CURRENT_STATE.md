# Current state

Last reviewed: 2026-08-13

Phase: 1B - Production GitHub App Integration (live) · 1E - Production Operations (control plane implemented, not hosted)

Overall status: **Hosted Supabase is current through `027`. Owner Auth/onboarding succeeds, and candidate App `4582606` (`surge-softwarefactory-next`) is installed as `153479019` with connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, scoped exactly to `surgeservicesllc/SoftwareFactory`. A candidate-signed delivery was processed after synchronization, then project `b1f23696-437e-4d89-b55f-d7a949980e8f` was atomically handed off with its UUID and prior change/audit history preserved. Candidate-backed repository/file reads pass, and the live draft-only write path created PR `#8` with commit `204ed79e712cd262a7d631cda0febc7231f042be`; CI and Vercel Preview passed, the PR remained draft and unmerged, then it was closed and its temporary branch was deleted. Primary App `4573846` still has the webhook defect tracked by OPEN Support ticket `#4660724`, while installation `153445938` remains active as the rollback path. Main release `799d2cea189b6860a03987ae75c25765f9ac4aca` passed CI `31716263910` and is READY as Vercel deployment `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ`. Phase 1B remains incomplete only for the live second-tenant and remaining adverse lifecycle/disconnect/reverse-observation matrix. Phase 1C and Phase 2 remain Not Connected; Autonomous Mode and all automatic actions remain OFF.**

"Implemented" below means code/schema exists in the verified application release. A provider capability is called Connected only where the live evidence below records the exact observed path.

## Current replacement cutover

- Owner-only App `4582606` is independently keyed, uses the Phase 1B least-privilege permissions/events, retains the exact production callback/webhook, and stores its server-only values as Sensitive in Vercel Production and Preview.
- The deployed application keeps `primary` and `candidate` configuration cryptographically isolated. Install state binds slot plus App ID, repository tokens follow the persisted installation App ID, and webhook ingress rejects a signing-App/persisted-installation mismatch.
- Hosted migration `20260812002700_handoff_github_project_connection.sql` adds immutable exact-tuple RED approval/execution evidence and atomically rebinds a project between active same-account/same-repository installations. It serializes against change reservations and cross-App duplicate project links, requires a fresh processed signed target delivery for first handoff, preserves project/history identity, and permits an evidence-bound reverse handoff while both installations remain active.
- Candidate installation `153479019` and connection `85591f43-dd4e-46d2-8a1b-0f036b32639f` passed callback/sync, exact repository selection, post-sync signed webhook processing, owner handoff, repository/file reads, and draft-only write acceptance.
- PR `#8` on `softwarefactory/20260813154335-9e3952f8-f9d` used candidate App bot `surge-softwarefactory-next` as PR author and explicit `surgeservicesllc <surgeservicesllc@gmail.com>` author/committer on commit `204ed79e712cd262a7d631cda0febc7231f042be`. CI run `31716958685` and Vercel Preview passed; the PR stayed draft, was never merged, was closed after verification, and the branch was deleted. `main` was unchanged by the acceptance write.
- Primary installation `153445938` remains active and selected as the deliberate rollback boundary. A reverse handoff and explicit disconnect/loss journey remain to be observed before any primary retirement decision.

## Implemented application boundaries

- Next.js 16.3 App Router, React 19.2, TypeScript strict mode, Tailwind CSS 4, server-first Auth/tenant/provider boundaries, and caller-session Supabase RLS reads.
- Supabase sign-up/sign-in/magic-link/sign-out/callback/onboarding, organization membership, and active-organization selection.
- GitHub App installation start/callback, short-lived repository-ID-scoped installation tokens, bounded repository reads, signed/idempotent/redacted webhooks, transaction-serialized project linking by stable repository UUID, and an isolated branch + commit + draft-PR-only file-change flow.
- Every interactive GitHub route is bound to the caller's exact active organization. Revoked or insufficient-permission token creation is persisted best-effort as connection loss; rate-limit errors do not falsely revoke the connection.
- Callback browser failures return safely to Connections with bounded error state; JSON callers retain structured no-store errors. GitHub-returned web URLs are restricted to HTTPS `github.com` origins.
- Connections and dashboard states do not hard-code a personal account and show **Not Connected** when live GitHub evidence is absent. The current owner connection shows its real installation ID and repository-selection mode.
- Ordinary file changes require owner/admin authorization, keep one idempotency key for an unchanged retry intent, and can recover an already-created draft PR after an ambiguous database-completion response. Protected paths fail closed unless an active owner supplies the exact short-lived RED approval phrase, rationale, and rollback plan; generic non-placeholder secret assignments and provider-token patterns remain blocked, and the only provider outcome remains a draft PR.
- The deployed write boundary requires a strictly validated server-only commit identity before authorization, persistence, token minting, or provider mutation, and sends that same identity as both GitHub author and committer. It has no App-bot fallback and is never browser-, database-, or log-visible. Production and Preview configure the owner-approved identity; live ordinary and protected draft commits verify both fields.
- Change reservations expire after five minutes and may be reclaimed only for the exact original intent before the provider boundary is entered. The exact approval snapshot is bound to the reserved change, and the provider boundary is durably revalidated before the write-scoped installation token is minted; entry permanently prevents lease reclamation.
- Installation and repository webhook transitions are provider-time ordered. Deletion is terminal for an installation ID; repository deletion remains terminal until an explicit newer restore, and restored repositories stay unselected pending access synchronization.
- Provider-authoritative repository rename/default-branch changes propagate by stable repository UUID only to exact connection-linked projects and create redacted immutable activity evidence.
- Agents, commands, tasks, runs, and reports are read through bounded caller-member RPC projections; authenticated browser sessions no longer have direct SELECT on those sensitive base tables. Command creation also enforces same-origin requests.
- Authenticated direct reads of raw Activity and webhook-delivery rows are revoked. Activity uses a caller-member, row-limited RPC and returns only allowlisted, bounded GitHub/SoftwareFactory actor, source, resource, action, status, conclusion, and transition evidence; raw audit metadata and stored webhook subsets remain server-side. Webhook project attribution uses the stable repository UUID.
- Projects selects repositories by stable provider ID and renders live repository sync time, branch protection/SHA, commit author/date, PR author/created/updated time and detail-fetched mergeability, default-branch checks, and per-PR checks fetched against each displayed head SHA.
- Global browser headers include a restrictive CSP, framing/object denial, a narrow Supabase connection allowlist, and a narrow image allowlist; repository Markdown previews do not load external images.
- No direct default-branch write, merge, deployment, rollback, Codex worker, or Claude worker exists. The Phase 1D observation scaffold remains execution-inert: Autonomous Mode OFF, global kill switch ON, GREEN ceiling, all automatic actions OFF.
- The signed-out dashboard receives a server-verified authentication hint so it skips protected browser fetches; the focused production race regression passes 30/30 repeated runs.

## Phase 1E production-operations state

Phase 1E adds a production-operations control plane in source and in migration `028`. **Migration `028` is not applied to hosted Supabase and no monitor has observed a real production target**, so every Phase 1E surface currently reports **Not Connected** or **Unknown**. Nothing below claims live production observation.

- Ten new tables (`production_monitors`, `monitor_observations`, `project_health_snapshots`, `release_freezes`, `deployment_validations`, `rollback_operations`, `production_diagnoses`, `repair_attempts`, `operations_events`, `operations_audit_events`) carry RLS and FORCE RLS with browser SELECT only. Every write goes through an owner- or admin-scoped SECURITY DEFINER workflow, so `service_role` gains **no new table privileges** and the verified `026` ACL matrix is unchanged.
- The only connected monitoring adapter is a bounded HTTPS probe. Vercel deployment status, error-rate and latency telemetry, database liveness, jobs, and integrations are each recorded as **Not Connected** with the exact reason and the condition that would unblock them. A CHECK constraint makes it impossible to enable a monitor whose adapter is not connected.
- Project health is `healthy/degraded/critical/unknown/paused`, derived from connected monitors, open incidents, and failed deployments, with append-only history and a stored reason. A project with no connected monitor resolves to **UNKNOWN**, never HEALTHY.
- Incidents are created automatically from breached failure thresholds, carry SEV1–SEV4, deduplicate by fingerprint into one open incident per project, and escalate severity upward only. SEV1/SEV2 automatically freezes autonomous releases.
- Last Known Good resolves only from a deployment whose own post-deploy validation passed. Rollback eligibility is evaluated fail-closed against `policies/AUTO_ROLLBACK.md` and always records `EXECUTOR_NOT_CONNECTED`; **no rollback is executed and no database or data migration is ever reversed**. A failed rollback cannot be recorded without escalating to SEV1 with owner attention — enforced by a CHECK constraint.
- The Production Investigator is a deterministic rules engine, not a model: it returns cause, cited evidence, subsystem, confidence, recommended action, and risk, and never produces or stores intermediate reasoning.
- Self-healing creates bounded repair work (three attempts, escalation on the third failure) and records assignment as **Not Connected** because Phase 1C has no worker. A RED repair or work above the project risk ceiling is refused, so the GREEN/YELLOW/RED policy is not bypassed.
- Incident resolution is refused while monitors still fail, without a passing same-project validation, without root cause and corrective action, and — for SEV1/SEV2 — without a prevention reference. A successful deployment alone resolves nothing.
- `autonomous_release_allowed` returns false unconditionally and enumerates live blockers; `EXECUTOR_NOT_CONNECTED` is unconditional, so no configuration change can make it return true. Phase 1D interlocks are untouched: the kill switch stays locked ON and every project stays at Autonomous Mode OFF with a GREEN ceiling and all automatic actions OFF.
- Scheduled monitoring is **Not Connected**: checks are owner-triggered because no scheduler identity is authorized, and authorizing one must not widen `service_role`.

## Data and security state

- Hosted Supabase project `qpuofpmagrmyamahqwxw` (`softwarefactory`) is current through migration `027`. The earlier selected local CLI profile was unauthorized or associated with the wrong account and was not used for mutation; the live promotion used the approved cutover path for the exact project.
- Hosted migration history includes `001`-`005` and `007`-`027`. Local and remote history matched before the additive `027` promotion, and the live candidate handoff proves its approval/execution and rebind RPC path is active.
- Hosted migrations `011`-`027` provide:
  - `011` closes initial direct connection/member mutations and aligns `github_pat_` detection.
  - `012` adds actor-attributed completed/failed change evidence.
  - `013` adds bounded service-role repository-grant reconciliation.
  - `014` propagates exact linked-project repository metadata.
  - `015` recovers completion from an existing branch/commit/draft PR.
  - `016` makes installation deletion terminal and provider-time ordered.
  - `017` closes remaining direct connection/project/link/change-request writes and adds an authenticated exact-binding reservation RPC.
  - `018` provider-orders repository metadata and preserves terminal deletion/explicit restore semantics.
  - `019` grants service role only the SECURITY DEFINER sensitive-JSON wrapper required by provider-ingress table CHECK evaluation; recursive/text helpers remain inaccessible.
  - `020` revokes authenticated base-table SELECT on agents/commands/tasks/runs/reports and exposes bounded caller-member safe-projection RPCs.
  - `021` binds each project connection and change request to the immutable tenant-scoped GitHub repository UUID; repository names remain mutable display metadata.
  - `022` records immutable, exact, owner-only RED protected-change approval before provider execution and adds a five-minute pre-provider reservation lease with exact-intent reclamation.
  - `023` projects bounded verified GitHub activity details and attributes project events through the stable repository UUID.
  - `024` revokes authenticated direct reads of raw Activity/webhook-delivery rows and exposes a caller-member, 100-row `list_activity` safe projection.
  - `025` detects opaque generic secret assignments, binds protected approval snapshots to exact pre-provider reservations, enforces provider-boundary-before-write-token ordering, and serializes stable repository relinking while allowing relink after archival.
- `026` revokes all public-table privileges from `service_role` and restores only SELECT/INSERT/UPDATE on the four GitHub ingress tables.
- `027` adds two RLS/FORCE-RLS immutable handoff-evidence tables, generic non-secret GitHub configuration references, external-repository serialization, exact owner approval/execution RPCs, and the atomic reversible project handoff.
- Post-`027` catalog verification reports 25/25 public tables with RLS and FORCE RLS, 34 policies, zero policyless tables, and narrow owner-read/no-browser-mutation grants on both immutable handoff-evidence tables. The clean pre-`027` linked lint/dry-run baseline, 22 secret guards, false tested raw authenticated/browser grants, and zero service-role ACL-matrix mismatches remain intact. The live apply and owner handoff passed; the complete live second-tenant/adverse matrix remains pending.
- The authenticated owner application session passes. Only one actual user/email is authorized, so a live second tenant was intentionally not created; local behavioral tests cover tenant denial, but real two-tenant/anonymous/RPC acceptance remains pending.
- Privileged GitHub/Supabase secrets remain in server-side Vercel settings, not source, browser code, logs, fixtures, or database rows.

## Provider and release truth

| Provider/capability | Status | Evidence/meaning |
| --- | --- | --- |
| Supabase hosted project | Current through migration `027` | The additive handoff migration is hosted and its live exact-owner approval/execution/rebind path passed. The verified pre-`027` lint/RLS/ACL baseline remains recorded; migration `027` adds two explicitly RLS/FORCE-RLS evidence tables with narrow grants. The live second-tenant/adverse matrix remains pending. |
| Primary GitHub App | Connected rollback path; webhook impaired | App `4573846`, installation `153445938`, and prior connection `d17c63a9-d995-481e-98ce-b737efb32ce5` remain active for rollback. Its webhook still reloads blank/inactive under OPEN Support ticket [#4660724](https://support.github.com/ticket/personal/0/4660724). |
| Candidate GitHub App | Connected for the owner repository path | App `4582606`, installation `153479019`, and connection `85591f43-dd4e-46d2-8a1b-0f036b32639f` passed callback, sync, exact repository selection, a post-sync candidate-signed processed delivery, handoff, repository/file reads, and draft-only write acceptance. Distinct secrets remain Sensitive in Vercel Production and Preview. |
| GitHub project binding | Connected through candidate | Project `b1f23696-437e-4d89-b55f-d7a949980e8f` now uses candidate connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`; its UUID and prior change/audit history were preserved. |
| GitHub webhook | Connected for candidate App only | Candidate-signed deliveries for installation `153479019` are processed after sync, including push and streamed check-status Activity evidence. This does not repair or relabel the primary App webhook. |
| Supabase Auth owner | Confirmed and authenticated | `surgeservicesllc@gmail.com` completed onboarding; the SoftwareFactory organization/workspace and owner membership exist. Only this real user/email is authorized for live acceptance. |
| Vercel UI hosting | Current production READY | `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ`, immutable `https://softwarefactory-7kfx3u1ey-surgeservices-projects.vercel.app`, stable alias, source `main` application commit `799d2cea189b6860a03987ae75c25765f9ac4aca`. Deploy/rollback adapter remains **Not Connected**. |
| Vercel deploy/rollback adapter | **Not Connected** | Hosting the UI is not an in-product deployment or rollback executor. |
| OpenAI/Codex worker | **Not Connected** | Phase 1C was not started. |
| Anthropic/Claude worker | **Not Connected** | Phase 2 was not started. |
| Auto approve/merge/deploy/rollback | OFF | No autonomous production authority or executor exists. |
| Production monitoring (HTTPS probe) | Implemented; **no observed target** | The adapter exists and is tested, but migration `028` is unhosted and no owner-authorized production target has been monitored. |
| Vercel deployment/error/latency/job/integration telemetry | **Not Connected** | No provider connection exists. Each is listed in the UI with its reason and unblocking condition. |
| Rollback execution | **Not Connected** | Every rollback decision records `EXECUTOR_NOT_CONNECTED`. Nothing is executed. |
| Codex repair execution | **Not Connected** | Repair work is created and left unassigned. |
| Scheduled monitoring | **Not Connected** | Checks are owner-triggered; no scheduler identity is authorized. |

## Verification evidence

- Main application release `799d2cea189b6860a03987ae75c25765f9ac4aca` has tree `a7731dc5626f1d014a446e94e989a1ac3f4f72a1`; both author and committer are `surgeservicesllc <surgeservicesllc@gmail.com>`. CI run `31716263910` passed both the quality/build and browser/accessibility jobs.
- Hosted migration `027` is applied. The live exact-owner approval, single-use execution, candidate delivery gate, and atomic project rebind passed for the exact owner/project/installations.
- Local and exact production Playwright each pass 48/48 across desktop, tablet, and mobile, including axe checks. The production signed-out browser-error race additionally passes 30/30 repeated runs.
- The preceding release source/rebuilt-static scan found zero high-confidence non-fixture credentials, zero privileged/static marker matches, zero tracked key/container files, and only `.env.example`. Main release CI additionally passed the current secret-boundary contracts; no secret value or temporary provider helper was committed during cutover.
- Production deployment `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ` is READY at `https://softwarefactory-7kfx3u1ey-surgeservices-projects.vercel.app` and the stable alias, sourced from `main` application commit `799d2cea189b6860a03987ae75c25765f9ac4aca`.
- Prior production Playwright 48/48, focused race 30/30, HTTP/security checks, and exact-main CI remain green; current CI run `31716263910` again passed the browser/accessibility job.
- Later documentation-only successors do not supersede this application/runtime evidence unless application code changes.
- Hosted evidence is current through `027`, and owner onboarding is confirmed. Candidate installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, and project `b1f23696-437e-4d89-b55f-d7a949980e8f` pass the live callback/sync/webhook/handoff/read/draft-write journey. Connections, Projects, Files, and Activity show real repository sync, branches, commits, checks, pull requests, tree/content, and immutable transitions.
- Ordinary draft PR `#6` (commit `e789303`) and owner-approved protected RED draft PR `#7` (commit `6a808de`) are open, draft, and unmerged. Both use `surgeservicesllc <surgeservicesllc@gmail.com>` as author and committer. Earlier App-bot-attributed PRs `#4` and `#5` were closed unmerged and their isolated branches were deleted; `main` stayed unchanged.
- Candidate-backed draft PR `#8` was authored by App bot `surge-softwarefactory-next`; commit `204ed79e712cd262a7d631cda0febc7231f042be` uses the approved owner identity for both author and committer. CI run `31716958685` and Vercel Preview passed. The PR remained draft, was never merged, was closed with verification evidence, and its isolated branch was deleted; `main` remained unchanged.
- Activity records the completed change request, draft PR `#8`, commit `204ed79e`, candidate-backed push delivery, and streamed check statuses for installation `153479019`.
- A fake generic password assignment was rejected before any pull request. Invalid signatures return `401` with private no-store behavior. Candidate-signed deliveries now process successfully; App `4573846` remains independently impaired and is not relabeled.
- GitHub Support ticket [#4660724](https://support.github.com/ticket/personal/0/4660724), subject **GitHub App 4573846 cannot retain its single webhook**, remains OPEN as the primary-App defect record. Primary installation `153445938` stays active as the rollback boundary.
- The temporary downloaded App PEM and ignored provider-verification helper scripts were deleted after use; no secret or helper artifact remains in the repository checkout.

## Phase 1E verification evidence

- Local gates on the Phase 1E tree: `npm run lint`, `npm run typecheck`, `vitest run` (62 files / 538 tests), and a 60-entry production build all pass. Coverage is statements 78.02%, branches 77.79%, functions 70.00%, lines 79.15%.
- Playwright passes 51/51 across desktop, tablet, and mobile including axe, with `/operations` added to the audited route set.
- `tests/integration/phase1e-operations.behavior.test.ts` (28 tests) exercises the real migrated schema: threshold detection, deduplication, upward-only severity, automatic freeze, owner-only resume with acknowledgement, Last Known Good resolution, blocked and failed rollbacks, bounded repair attempts, resolution gating, event idempotency and dead-lettering, cross-tenant denial, anonymous denial, append-only enforcement, and sensitive-value rejection.
- `tests/integration/phase1e-incident-journey.behavior.test.ts` walks the ordered end-to-end journey and separately proves failed-rollback escalation to SEV1 with owner attention, plus refusal to resolve on a successful deployment alone. The Codex-fix and deploy stages are asserted as **blocked with named reasons**, not simulated.
- `tests/integration/phase1e-operations.contract.test.ts` (16 tests) guards same-origin and role checks on every mutation, the execution envelope on every response, absence of any provider deployment call, no new `service_role` table grants, and the preserved Phase 1D interlocks.
- This is control-plane evidence against a migrated database. It is **not** live production evidence: migration `028` is unhosted and no real production target has been observed.

## Release blockers

1. Observe the rollback window and exercise the evidence-bound reverse handoff plus explicit disconnect/loss behavior before retiring any primary-App access. Keep Support ticket `#4660724` open as the primary-App defect record.
2. Complete the live second-tenant/anonymous/RPC matrix and remaining stale-SHA, approval-expiry, revoked/insufficient-permission, rate-limit, ordering, deletion/restore, idempotency, and recovery cases.
3. Keep Phase 1B incomplete, Phase 1C/Phase 2 **Not Connected**, Autonomous Mode OFF, the global kill switch ON, and every automatic action OFF until those gaps close.
4. Apply hosted migration `028` and configure an owner-authorized production target before any Phase 1E surface may claim observation. Until then Phase 1E is implemented but unproven against real production.
