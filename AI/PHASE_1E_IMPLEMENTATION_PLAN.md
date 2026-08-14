# Phase 1E implementation plan — production operations

Original audit date: 2026-08-13
Original audited tree: `818f18d` (branch `claude/softwarefactory-phase-1e-ops-mjdiiq`, then identical to `origin/main`)
Current status: the Phase 1E schema is hosted in the reconciled production chain through `130014`. This document retains its original design audit while the maintained current-state files record later publication and acceptance evidence.

## 1. What the audit actually found

The Phase 1E objective assumes Phase 1A–1D are working and that the Factory already deploys. The repository contract says otherwise, and the code agrees with the contract:

| Assumed input | Real state in this tree | Consequence for Phase 1E |
| --- | --- | --- |
| Phase 1B complete | Incomplete. Candidate GitHub App path is live; second-tenant, disconnect/loss, and adverse lifecycle matrix are open. | Monitoring may read GitHub, but no Phase 1E claim may depend on unfinished 1B evidence. |
| Phase 1C Codex worker | **Published but Not Connected.** Durable worker/lease/sandbox/queue paths exist; the first claim failed before repository mutation and a no-claim diagnostic reported exhausted provider credits. | Self-healing still cannot assign or run Codex autonomously; live manual acceptance needs a funded replacement and new current-base command. |
| Phase 1D autonomy engine | Observation-only scaffold. `evaluateAutonomyObservation` always returns `executionAllowed: false`; migration `010` locks `organizations.autonomy_kill_switch_active` ON with a CHECK constraint and constrains every project to `autonomous_mode = false`, GREEN ceiling, and `auto_approve/auto_merge/auto_deploy/auto_rollback = false`. | No autonomous production executor exists to gate. Freeze is implementable; autonomous deploy and rollback execution are not. |
| Phase 1D "Last Known Good deployment records" | Do not exist. `public.deployments` exists as a Phase 1A table with **zero** writers in application code. | Last Known Good must be defined and populated by Phase 1E itself, from validated deployment evidence only. |
| Vercel deploy/rollback adapter | **Not Connected.** Vercel hosts the UI; there is no in-product deployment or rollback executor. | Rollback is recorded and evaluated, never executed, in this phase. |

`AGENTS.md` additionally forbids introducing an auto-merge or production deployment workflow, requires **Demo Data**/**Not Connected** labels wherever evidence is absent, and requires RED actions to carry explicit owner approval. `policies/AUTO_ROLLBACK.md` states plainly that automatic rollback is disabled and that a detected failure "may create an incident and request owner attention".

### Scope decision recorded for this phase

Phase 1E is implemented as a **production-operations control plane**, not as an autonomous production mutator:

- Everything that only **observes** or **restricts** is built and can run automatically: monitoring ingestion, health derivation, incident creation/deduplication/severity, release freeze, diagnosis, repair-work creation, resolution gating, event orchestration, and reporting.
- Everything that would **mutate production** — rollback execution, deployment, merge, Codex execution — is built up to the decision boundary, records immutable evidence, and stops at a named blocker (`EXECUTOR_NOT_CONNECTED`, `OWNER_APPROVAL_REQUIRED`, …). No provider mutation is performed and no UI implies one happened.
- Freeze is safe to automate precisely because it only removes authority. Resume and stop-all are owner-only.

This is the maximum honest slice of the objective against the real tree. Every remaining item is listed under §4 as BLOCKED with its exact unblocking condition.

## 2. Component audit

Legend: **COMPLETE** (built and evidenced) · **PARTIAL** (some substrate exists) · **MISSING** (nothing exists) · **BROKEN** (exists and is wrong) · **BLOCKED** (cannot be done safely/honestly in this phase).

### 2.1 Monitoring control plane (objective §2)

| Item | Status before 1E | Notes |
| --- | --- | --- |
| Monitor definitions (provider-neutral) | MISSING | No table, no adapter, no route. |
| Uptime/health signal | MISSING | Implementable now with a bounded server-side HTTPS probe. |
| Vercel deployment status | BLOCKED | No Vercel API connection exists. Surfaces as **Not Connected**. |
| Application/API error + latency signals | PARTIAL | Latency is measurable from the probe. Error-rate telemetry has no provider → **Not Connected**. |
| Critical route failures | MISSING | Implementable as bounded route probes. |
| Authentication health | MISSING | Implementable as an unauthenticated-request-is-rejected probe (no credentials used). |
| Database connectivity | PARTIAL | Supabase is connected; a bounded read-only liveness probe is implementable. |
| Failed jobs / integration failures | BLOCKED | No job runner and no integration telemetry provider. **Not Connected**. |
| Synthetic critical journeys | MISSING | Implementable read-only/safe-write only; destructive steps rejected. |

### 2.2 Project health (objective §3)

Status: **PARTIAL/BROKEN for the requirement.** `public.projects.health_status` uses enum `health_status` = `unknown|healthy|degraded|unhealthy` — it has no `critical` and no `paused` value, is never written by any application code, and has no history or reason. Phase 1E adds a distinct `project_health_state` enum (`healthy|degraded|critical|unknown|paused`), a derivation function over documented real signals, and append-only history with reasons.

### 2.3 Incident engine (objective §4)

Status: **PARTIAL.** `public.incidents` exists with `severity` (`low|medium|high|critical`), `status` (`open|investigating|mitigated|resolved|closed`), `detected_at`, `resolved_at`, and a deployment FK. It has **no writer anywhere in the application**, no SEV1–SEV4, no source/symptom/impact/evidence/root-cause/prevention fields, and no deduplication. Phase 1E extends it additively and adds automatic, deduplicated creation.

### 2.4 Automatic protection and emergency controls (objective §5)

Status: **MISSING.** No freeze concept exists. Implementable and safe: a freeze only subtracts authority. Owner controls Freeze / Resume / Stop autonomous operations are added; Resume and Stop are owner-only and audited.

### 2.5 Auto rollback (objective §6)

Status: **BLOCKED for execution; decision path implementable.** There is no deployment provider adapter and no Last Known Good record. Phase 1E adds deployment validation records, a Last Known Good resolver, rollback eligibility evaluation that fails closed under `policies/AUTO_ROLLBACK.md`, immutable rollback records, and **failed-rollback severity escalation with owner attention**. Execution itself returns `EXECUTOR_NOT_CONNECTED`.

### 2.6 Production Investigator (objective §7)

Status: **MISSING; implementable as a deterministic evidence engine.** No LLM worker is connected (Phase 1C/2 Not Connected), so the investigator is a rules engine over incident/deployment/commit/health/change evidence returning likely cause, evidence, affected subsystem, confidence, recommended action, and risk. It stores conclusions and evidence only — never intermediate reasoning.

### 2.7 Self-healing (objective §8)

Status: **BLOCKED for execution; creation path implementable.** Codex is Not Connected, so no branch/fix/test/review/PR can be produced autonomously. Phase 1E creates bounded repair work from a diagnosis, enforces a maximum attempt count, escalates on repeated failure, and records assignment as **Not Connected**. The 1D GREEN/YELLOW/RED gates are not bypassed because nothing executes.

### 2.8 Synthetic testing (objective §9)

Status: **MISSING; implementable.** Basic/Standard/Critical profiles with non-destructive step validation enforced in both TypeScript and the database.

### 2.9 Operations UI (objective §10)

Status: **MISSING.** No operations route, page, or component exists.

### 2.10 Event automation (objective §11)

Status: **MISSING.** No queue, no dedupe, no durable processing. Implementable with an append-only event table, unique dedup key, claim/complete transitions, and bounded attempts.

### 2.11 Incident resolution (objective §12)

Status: **MISSING.** Implementable as a gated RPC that refuses to resolve without restored production evidence, passing validation, root cause, and corrective action.

### 2.12 Reporting (objective §13)

Status: **PARTIAL.** `public.reports` and `/api/reports` exist as a bounded list projection; no report is generated and no operational content exists. Phase 1E adds an operations summary projection.

### 2.13 Security and testing (objective §14)

Status: **COMPLETE and must stay complete.** 25/25 public tables have RLS + FORCE RLS; `service_role` holds table privileges on exactly four GitHub ingress tables. Phase 1E adds tables under the same rules and grants `service_role` **no new table privileges** — provider ingestion goes through narrow SECURITY DEFINER functions instead, so the verified ACL matrix is preserved.

## 3. Execution plan (safe work, done autonomously in this phase)

1. Migration `028_phase1e_production_operations.sql`: enums, nine new tables (all RLS + FORCE RLS, no browser writes), additive incident/project columns, and owner-scoped SECURITY DEFINER workflows for ingestion, health, incidents, freeze, rollback decisions, diagnosis, repair, resolution, and events.
2. `lib/operations/*`: pure, unit-tested policy modules — severity classification, fingerprint/dedup, health derivation, freeze policy, rollback eligibility, investigator, repair bounds, synthetic profiles, event contracts, monitor adapters.
3. Server routes under `/api/operations/*`: tenant-scoped, same-origin for mutations, owner-only for emergency and RED-adjacent controls, `no-store`, fail-closed.
4. Operations UI: portfolio health, incidents, freezes, monitors, rollbacks, repairs, owner attention, plus per-project operations detail.
5. Tests: pglite behavioral tests for schema/RLS/dedup/severity/freeze/rollback-failure/repair-bounds/resolution/event idempotency; unit tests for every pure module; contract tests for routes and the preserved 1D interlocks.
6. Documentation: update `/AI` and `/policies` to state exactly what is live and what remains Not Connected.

## 4. Explicitly BLOCKED, with unblocking conditions

| Blocked capability | Blocker | Unblocking condition |
| --- | --- | --- |
| Autonomous production deployment | No deploy adapter; `AGENTS.md` forbids it in this line of phases | A separately approved provider adapter phase plus an owner-approved policy revision. |
| Rollback execution | No deploy adapter; `policies/AUTO_ROLLBACK.md` disables it; migration `010` pins `auto_rollback = false` | Provider adapter, the six drills in `AUTO_ROLLBACK.md`, and an owner-approved migration relaxing the 1D constraint. |
| Codex repair execution | Phase 1C Not Connected | Phase 1C worker with leases, sandbox, budgets, and redacted traces. |
| Vercel deployment/error/latency telemetry | No Vercel API connection | An owner-authorized Vercel connection with a server-only token. |
| Failed-job and integration telemetry | No job runner or telemetry provider | A connected provider emitting real signals. |
| Live production incident acceptance evidence | Requires a real failing production target and owner authorization to probe it | Owner supplies a monitored target; until then monitors ship disabled and unconfigured. |

Nothing in the shipped UI or reports may present any blocked capability as available. Each renders **Not Connected** with the reason above.

## 5. Delivered in this change

| Objective section | Delivered status | Where |
| --- | --- | --- |
| §2 Monitoring control plane | **PARTIAL by design.** One connected adapter (bounded HTTPS probe) plus a provider registry that names every unconnected provider and its unblocking condition. A monitor cannot be enabled unless its adapter is connected — enforced by a CHECK constraint, not by convention. | `production_monitors`, `monitor_observations`, `lib/operations/probe.ts`, `lib/operations/providers.ts`, `lib/operations/target.ts` |
| §3 Project health | **COMPLETE.** `healthy/degraded/critical/unknown/paused` derived from real signals, with append-only history and a stored reason for every state. Absence of evidence resolves to UNKNOWN. | `evaluate_project_health`, `project_health_snapshots`, `lib/operations/health.ts` |
| §4 Incident engine | **COMPLETE.** SEV1–SEV4, automatic creation, fingerprint deduplication into one open incident per project, upward-only severity escalation, and full evidence columns. | `open_production_incident`, `incidents` additions, `lib/operations/severity.ts`, `lib/operations/fingerprint.ts` |
| §5 Automatic protection | **COMPLETE.** SEV1/SEV2 freezes autonomous releases automatically; freeze is idempotent; resume and stop-all are owner-only, require a written reason, and are audited. | `freeze_project_releases`, `resume_project_releases`, `stop_autonomous_operations`, `/api/operations/controls` |
| §6 Auto rollback | **DECISION PATH COMPLETE; EXECUTION BLOCKED.** Last Known Good resolves only from a deployment whose own validation passed. Eligibility is evaluated fail-closed against `AUTO_ROLLBACK.md`. A failed rollback cannot be recorded without escalating to SEV1 with owner attention — enforced by a CHECK constraint. No database or data migration is ever reversed. | `last_known_good_deployment`, `record_rollback_decision`, `record_rollback_outcome`, `lib/operations/rollback.ts` |
| §7 Production Investigator | **COMPLETE as a deterministic engine.** Returns likely cause, cited evidence, affected subsystem, confidence, recommended action, and risk. Confidence requires corroboration. No intermediate reasoning is produced, stored, or returned. | `lib/operations/investigator.ts`, `production_diagnoses` |
| §8 Self-healing | **CREATION COMPLETE; EXECUTION BLOCKED.** Diagnosis creates bounded repair work capped at three attempts; the third failure escalates instead of retrying. Eligibility never bypasses GREEN/YELLOW/RED — a RED repair is refused without owner approval and work above the project ceiling is refused. Assignment is recorded as `not_connected`. | `create_repair_attempt`, `record_repair_failure`, `lib/operations/repair.ts` |
| §9 Synthetic testing | **COMPLETE for read paths; writes recorded not executed.** Journeys are stored per project with Basic/Standard/Critical profiles, and safety is enforced by CHECK constraint as well as in TypeScript: destructive paths and undeclared writes cannot be stored at all, and a declared safe write needs a reversal note. Execution stops at the first failing step; a declared write is recorded as `skipped` because Phase 1E has no authority to mutate a monitored production system. | migration `130002`, `synthetic_journeys`, `lib/operations/journey.ts`, `/api/operations/synthetics` |
| §10 Operations UI | **COMPLETE.** Portfolio health, project health with reasons, incidents, monitors, provider status, audit trail, owner controls, and per-project production detail. | `app/operations/page.tsx`, `components/operations-console.tsx`, `components/project-operations-panel.tsx` |
| §11 Event automation | **COMPLETE.** All ten event types, durable queue, unique dedupe key per organization, claim/complete with `for update skip locked`, idempotent completion, bounded attempts, and dead-lettering. Each event's planned actions are declared as data, marking deferred ones explicitly. | `operations_events`, `enqueue/claim/complete_operations_event`, `lib/operations/events.ts` |
| §12 Incident resolution | **COMPLETE.** Resolution is refused while monitors still fail, without a passing same-project validation, without root cause and corrective action, and — for SEV1/SEV2 — without a prevention reference. A successful deployment alone resolves nothing. | `resolve_production_incident`, `incidents_resolution_requires_cause` |
| §13 Reporting | **COMPLETE.** Daily report covers portfolio health, incidents, observed unavailability, failed deployments, rollbacks, repairs, recurring failures, frozen projects, owner decisions, and top risks. Executed rollbacks and repairs are reported as zero with `executor: not_connected`. | `generate_operations_report`, `/api/operations/reports`, `/api/operations/projects/[projectId]` |
| §14 Security and testing | **COMPLETE.** All ten new tables carry RLS + FORCE RLS with no browser writes; `service_role` gains no new table privileges; evidence tables are append-only; probes cannot reach private or metadata addresses. | migration `028`, `tests/integration/phase1e-*.test.ts` |

### Evidence

- `npm run lint`, `npm run typecheck`: pass.
- `vitest run`: 82 files / 819 tests pass on the merged tree, including 28 Phase 1E behavioral tests, a 3-test end-to-end journey, 16 boundary contracts, and 55 policy/probe/console unit tests.
- `npm run build`: compiles cleanly, including 12 operations APIs and the Operations page.
- Playwright: 117/117 across desktop, tablet, and mobile including axe on the merged tree.
- The end-to-end demonstration and the failed-rollback escalation run against the real migrated schema in `tests/integration/phase1e-incident-journey.behavior.test.ts`.

### What the demonstration proves, and what it cannot

The journey test walks Monitor → Detect → Incident → Freeze → Rollback decision → Diagnose → Repair task → Validate → Resolve against the real schema, and separately proves failed-rollback escalation to SEV1 with owner attention. Two stages of the stated target are asserted as **blocked rather than simulated**: the Codex fix (no connected or authorized autonomous repair worker) and the deploy (no deployment adapter). The test records the exact blockers instead of skipping them.

This is a control-plane demonstration against a migrated database, not live production evidence. Migration `028` is hosted in the reconciled chain through `130014`, but no monitor has yet observed an owner-authorized real production target. Until that observation exists, every Phase 1E surface reports **Not Connected** or **Unknown** rather than implying observation.


## 6. Completion status

Assessed against the nine objective sections, counting only what has evidence.

| Area | Completion | Basis |
| --- | --- | --- |
| §1 Audit | 100% | This document, produced before any edit. |
| §2 Monitoring + health | ~70% | Health derivation, history, and reasons are complete. One of five signal families has a connected adapter: the HTTPS probe covers uptime, latency, critical routes, auth, and project-reported database/job/integration endpoints. Vercel deployment status and error-rate telemetry have no provider. |
| §3 Incident engine | 100% | Automatic creation, fingerprint dedupe, SEV1–SEV4, upward-only escalation, and every required evidence field. |
| §4 Protection + rollback | ~60% | Freeze, resume, stop, reversal of stop, Last Known Good, eligibility, and failed-rollback escalation are complete. Rollback **execution** does not exist. |
| §5 Investigator + self-healing | ~50% | Structured diagnosis and bounded repair-work creation with risk gating are complete. Codex execution, isolated branch, fix, tests, review, and PR do not exist. |
| §6 Synthetics + operations UI | ~90% | Journeys are stored, safety-enforced, and executed for read paths; the operations UI covers every required view. Declared writes are recorded rather than executed. |
| §7 Automation | 100% | All ten event types, durable queue, idempotent completion, bounded attempts, dead-lettering. |
| §8 Resolution + reporting | 100% | Gated resolution and the daily report with every required section. |
| §9 Security + testing | 100% | RLS + FORCE RLS on 53/53 tables, no new `service_role` grants, append-only evidence, server-only secrets, RED operations owner-gated, and the full test matrix. |

**Overall: roughly 85% of the objective is implemented, and the remaining ~15% is execution authority that this phase must not grant.** Rollback execution, Codex repair execution, and autonomous deployment are each blocked by a named, tested interlock rather than missing by oversight.

### Live integrations

| Integration | State |
| --- | --- |
| Outbound HTTPS probe (uptime, latency, critical route, auth, project-reported DB/job/integration, synthetic) | **Implemented**, target-validated, never observed against a real production target yet |
| Supabase control plane (RLS, workflows, audit) | **Connected** in source and schema; migrations `028`/`130002` are hosted and ledger-reconciled, but no real monitor target has been observed |
| GitHub App | **Connected** for the owner repository path (Phase 1B) |
| Vercel deployment status / rollback execution | **Not Connected** |
| Error-rate and latency telemetry provider | **Not Connected** |
| Direct database, job runner, and integration reads | **Not Connected** |
| Codex execution worker | **Not Connected** (published, but funded-provider success and a draft-PR acceptance run are absent) |
| Scheduled monitoring | **Not Connected** (no authorized scheduler identity) |

### Security findings from this phase

1. **`service_role` scope held.** Provider ingestion runs through SECURITY DEFINER workflows rather than table grants, so `service_role` still holds table privileges on exactly the four GitHub ingress tables. Verified by test, not by inspection.
2. **Probe SSRF surface bounded.** Monitor targets are restricted to public HTTPS origins on the standard port with no credentials, refusing loopback, private, carrier-grade-NAT, link-local, and cloud-metadata addresses. Redirects are not followed and no response body is read.
3. **Residual limitation, recorded not hidden.** A public hostname that resolves to a private address at DNS time is not detected; catching it needs resolve-then-connect-by-IP handling.
4. **Safety in the schema, not only the route.** Monitor enablement, rollback escalation, incident resolution, and synthetic step safety are CHECK constraints, so bypassing the application cannot bypass them.
5. **No secret path widened.** No new credential, environment variable, or browser-reachable privilege was introduced.

### Known limitations

- Migrations `028`/`130002` are hosted in the reconciled production chain through `130014`. A fresh live-target observation is still required before a monitor may be described as Connected or healthy.
- Monitoring is owner-triggered rather than continuous; a scheduler identity must be authorized without widening `service_role`.
- Synthetic write steps are declared and validated but never issued.
- Health depends on what the monitored project's own endpoints report; SoftwareFactory does not read a monitored project's database or job runner directly.

### Phase 2A readiness

Phase 2A (the provider execution layer) is already merged on `main` and its tests pass alongside Phase 1E. The two are complementary and do not conflict: Phase 2A routes AI work to providers, Phase 1E observes production and refuses to act on it. Phase 1E leaves Phase 2A's interlocks untouched — `ai_provider_execution_enabled` still defaults OFF, and no Phase 1E path invokes a provider.

The natural next joins are: give the Production Investigator an optional Phase 2A provider run for narrative diagnosis, keeping the deterministic engine as the source of the structured verdict; and design a separately authorized repair-worker binding without treating manual Phase 1C as autonomous authority. Migrations `028`/`130002` are hosted, but neither join should begin before a first real observed incident and its explicit authority boundary, because a diagnosis engine with no observed production data has nothing to diagnose.
