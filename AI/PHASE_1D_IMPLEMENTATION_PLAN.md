# Phase 1D implementation plan — autonomous-loop controls

Audit date: 2026-08-13
Audited tree: `8938ea6` (`origin/main`, after the Phase 1E operations control plane, the
Phase 2A provider layer, the bot fabric, and the public marketing site were all merged).
Baseline verified before any Phase 1D edit: `npm run lint`, `npm run typecheck`, and
`vitest run` (82 files / 824 tests) all pass; `npm run build` succeeds.

## 1. What the audit actually found

The Phase 1D objective describes a closed loop:

> Backlog/Event → Orchestrator → Codex → Code → Tests → Review → PR → CI → Preview →
> Risk Gate → Auto Approve/Merge → Deploy → Validate → Report

Most of the **right-hand half** of that loop already exists, built by Phase 1E as a
production-operations control plane. Most of the **left-hand half** does not exist, and its
executor stages are blocked by the absence of Phase 1C.

| Loop stage | Real state in this tree | Owner |
| --- | --- | --- |
| Backlog / Event intake | PARTIAL — `operations_events` is a durable, deduplicated, bounded-attempt queue for ten operations event types. There is no backlog-driven work intake. | Phase 1E |
| Orchestrator | MISSING — no stage machine, no run record, no transition ledger. | — |
| Codex → Code | **BLOCKED** — Phase 1C never started. `lib/providers/*` (Phase 2A) can call Anthropic and OpenAI, but there is no worker, lease, sandbox, workspace, or budget. | — |
| Tests / Review | MISSING as gates. The repository runs its own CI; nothing models a gate set, a finding, or a blocking finding. | — |
| PR | PARTIAL — the GitHub editor creates an isolated branch, commit, and **draft** PR only. | Phase 1B |
| CI | PARTIAL — real GitHub Actions CI exists and is readable; nothing consumes its result as a gate. | Phase 1B |
| Preview | **BLOCKED** — Vercel hosts previews, but there is no in-product Vercel API connection. `VERCEL_TOKEN` is documented and unset. | — |
| Risk Gate | PARTIAL — `lib/risk.ts` classifies from *explicitly supplied factors* and evaluates authorization. Nothing classifies an actual diff. | Phase 1A |
| Auto Approve / Merge | MISSING — no approval decision type, no self-approval rule, no merge adapter. `AGENTS.md` forbids introducing an auto-merge workflow. | — |
| Deploy | **BLOCKED** — no deployment adapter. | — |
| Validate | COMPLETE — `deployment_validations`, health derivation, synthetic profiles, bounded HTTPS probes. | Phase 1E |
| Rollback | DECISION PATH COMPLETE, EXECUTION BLOCKED — Last Known Good resolves only from a deployment whose own validation passed; failed rollback must escalate to SEV1. | Phase 1E |
| Incident / Repair | CREATION COMPLETE, EXECUTION BLOCKED — bounded to three attempts, escalates instead of retrying. | Phase 1E |
| Report | COMPLETE — `generate_operations_report`. | Phase 1E |

### The controls the objective asks for, against what exists

The objective asks for global and project controls for **Autonomous Mode**, **Max Auto Risk**,
and nine automatic actions: Plan, Code, Test, Repair, Review, Approve, Merge, Deploy, Rollback.

`public.projects` currently has `autonomous_mode`, `maximum_autonomous_risk`, and **four** of
the nine: `auto_approve`, `auto_merge`, `auto_deploy`, `auto_rollback`. There is no
`auto_plan`, `auto_code`, `auto_test`, `auto_repair`, or `auto_review`. There is no
organization-level control record at all — only `organizations.autonomy_kill_switch_active`,
a single boolean locked ON by a CHECK constraint in hosted migration `010`. Nothing resolves
an organization setting against a project setting, so "most restrictive wins" has nothing to
operate on.

Emergency STOP **does** exist: Phase 1E's `stop_autonomous_operations` is owner-only, requires
a written reason, and is audited.

## 2. Component audit

Legend: **COMPLETE** (built and evidenced) · **PARTIAL** (some substrate exists) ·
**MISSING** (nothing exists) · **BROKEN** (exists and is wrong) · **BLOCKED** (cannot be done
safely or honestly in this phase).

| # | Component | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Risk vocabulary GREEN/YELLOW/RED | **COMPLETE** | `lib/risk.ts`, `policies/RISK_CLASSIFICATION.md` |
| 2 | Risk classification from explicit factors | **COMPLETE** | `classifyRisk`, empty input defaults YELLOW |
| 3 | Risk classification **of a diff** | **MISSING** | Nothing maps changed paths to factors |
| 4 | Risk authorization gate ordering | **COMPLETE** | `evaluateRiskAuthorization` — owner approval cannot override mode, ceiling, or failed validation |
| 5 | Project automatic-action controls | **PARTIAL** | 4 of 9 flags exist |
| 6 | Organization automatic-action controls | **MISSING** | Only the single locked kill switch |
| 7 | Most-restrictive-wins resolution | **MISSING** | No resolver |
| 8 | Emergency STOP | **COMPLETE** | `stop_autonomous_operations` (Phase 1E), owner-only, audited |
| 9 | Release freeze | **COMPLETE** | `freeze_project_releases`, automatic on SEV1/SEV2 |
| 10 | Gate sets (GREEN / YELLOW) | **MISSING** | No gate model, no findings, no blocking semantics |
| 11 | Review / QA / Security agents | **MISSING** | No agent records, no findings |
| 12 | Approval decision tri-state | **MISSING** | `evaluateRiskAuthorization` returns a different, execution-oriented vocabulary |
| 13 | No-self-approval rule | **MISSING** | Nothing compares author to approver |
| 14 | Orchestrator stage machine | **MISSING** | — |
| 15 | Branch-protection revalidation | **COMPLETE** | `lib/autonomy/merge-readiness.ts` — conflicts, stale approval, stale gates, dismissed reviews, and required checks re-asked against the current head |
| 16 | Merge executor | **BLOCKED** | `AGENTS.md` forbids an auto-merge workflow in this line of phases |
| 17 | Deploy executor | **BLOCKED** | No Vercel API connection; `VERCEL_TOKEN` unset |
| 18 | Preview validation | **BLOCKED** | Same |
| 19 | Post-deploy validation | **COMPLETE** | Phase 1E `deployment_validations`, probes, synthetic profiles |
| 20 | Last Known Good | **COMPLETE** | `last_known_good_deployment`, resolves only from a validated deployment |
| 21 | Rollback decision | **COMPLETE** | `record_rollback_decision`, fail-closed |
| 22 | Rollback execution | **BLOCKED** | No adapter; `policies/AUTO_ROLLBACK.md` disables it; migration `010` pins `auto_rollback = false` |
| 23 | Incident on failure | **COMPLETE** | `open_production_incident`, SEV1–SEV4, fingerprint dedup |
| 24 | Repair task creation | **COMPLETE** | `create_repair_attempt`, capped at three attempts |
| 25 | Repair execution (Codex) | **BLOCKED** | Phase 1C not started |
| 26 | Backlog Autopilot | **BLOCKED** | Depends on 14 and 25 |
| 27 | Reporting | **COMPLETE** | `generate_operations_report` |
| 28 | RLS / least privilege / server-only secrets | **COMPLETE and must stay complete** | 25+ tables with RLS + FORCE RLS; `service_role` holds table privileges on exactly four GitHub ingress tables |

## 3. Scope decision recorded for this phase

Phase 1D is implemented as the **decision layer of the autonomous loop**, not as an executor.

- Everything that **decides, restricts, or records** is built and fully exercised: the complete
  nine-action control model, organization-over-project resolution, diff risk classification,
  the GREEN and YELLOW gate sets with blocking findings, the approval tri-state with a
  no-self-approval rule, and the orchestrator stage machine.
- Everything that would **mutate a protected resource** — merge, deploy, rollback execution,
  Codex execution — is built up to the decision boundary, returns a named blocker, and stops.
  No provider mutation is performed and no surface implies one happened.
- **The Phase 1D interlocks are not relaxed.** Hosted migration `010` constrains every project
  to `autonomous_mode = false`, a GREEN ceiling, and all automatic actions off. This phase adds
  the five missing flags *to that same constraint* rather than loosening it. The control model
  becomes complete and correct while remaining fail-closed.

Relaxing those interlocks is a RED action under `policies/RISK_CLASSIFICATION.md`
("security controls disablement"). It requires explicit owner approval and a separate migration,
and an agent must not perform it. That is the single reason this phase does not close the loop.

## 4. Delivered in this change

| Objective section | Delivered | Where |
| --- | --- | --- |
| Controls: nine automatic actions, both scopes | **COMPLETE** as a model, fail-closed by constraint | `lib/autonomy/controls.ts`, migration `20260813000500` |
| Most restrictive wins | **COMPLETE** | `resolveEffectiveControls` — organization off beats project on; lower ceiling wins; STOP and kill switch force everything off |
| Emergency STOP | **COMPLETE** (integrated, not rebuilt) | Phase 1E `stop_autonomous_operations`, consumed by the resolver |
| Risk classification before work | **COMPLETE** | `classifyRisk` (existing) |
| Risk classification of the final diff | **COMPLETE** | `lib/autonomy/diff-risk.ts` |
| Gates: GREEN set | **COMPLETE** | `lib/autonomy/gates.ts` |
| Gates: YELLOW set | **COMPLETE** | same |
| Blocking findings stop progression | **COMPLETE** | same |
| Review / QA / Security agents | **COMPLETE** as finding producers | `lib/autonomy/agents.ts` |
| Approval tri-state | **COMPLETE** | `lib/autonomy/approval.ts` |
| No self-approval | **COMPLETE** | same — the author is refused as approver at every scope |
| Orchestrator stage machine | **COMPLETE** as a decision machine | `lib/autonomy/pipeline.ts` |
| Merge / Deploy / Rollback execution | **BLOCKED, named** | Every path returns its exact blocker |
| Merge revalidation | **COMPLETE** | `merge-readiness.ts` — a push after approval or verification invalidates it; protection is never inferred as satisfied |
| Recovery decision machine | **COMPLETE** | `lib/autonomy/recovery.ts` — freeze first, rollback fail-closed on four conditions, bounded repair, escalation |
| Never auto-reverse a destructive migration | **COMPLETE** | A destructive release resolves `OWNER_ONLY` regardless of controls, ceiling or approval |
| Bounded retries | **COMPLETE** | `lib/autonomy/retries.ts` — per-stage caps, exponential backoff, escalate rather than retry once spent, and never retry a permanent failure |
| Backlog Autopilot selection | **COMPLETE** | `lib/autonomy/autopilot.ts` — orders eligible P0–P3 work by priority then lower risk, and explains every exclusion |
| Deployment tracking (read) | **COMPLETE, provider Not Connected** | `lib/deploy/vercel.ts` — real read contract; reports **Not Connected** with a reason while `VERCEL_TOKEN` is unset |

## 5. Explicitly BLOCKED, with unblocking conditions

| Blocked capability | Blocker | Unblocking condition |
| --- | --- | --- |
| Turning any automatic action ON | Hosted migration `010` CHECK constraint plus the locked organization kill switch | Owner-approved migration that deliberately relaxes the interlock, after sustained non-production evidence |
| Auto-merge | `AGENTS.md` forbids introducing an auto-merge workflow in this line of phases | An owner-approved policy revision |
| Deploy execution, preview validation | No Vercel API connection; `VERCEL_TOKEN` unset in every environment checked | An owner-authorized Vercel connection with a server-only token. The **read** adapter is built and will report live data the moment a token exists; no write path exists at all. |
| Rollback execution | No deploy adapter; `policies/AUTO_ROLLBACK.md` disables it | Adapter, the six drills in that policy, and an owner-approved migration |
| Codex code and repair execution | Phase 1C not started | A Phase 1C worker with leases, sandbox, budgets, and redacted traces |
| Backlog Autopilot execution | Depends on the two rows above | Both unblocked |

Nothing in the shipped UI, API, or reports may present any blocked capability as available.
Each renders **Not Connected** with the reason above.

## 6. What the demonstration proves, and what it cannot

The end-to-end test walks a GREEN change through classify → gates → agents → approval →
merge decision, and separately walks a failed deploy through incident → rollback decision →
repair task → resolution, against the real migrated schema.

Two stages are asserted as **blocked rather than simulated**: the merge and the deploy. The
test records the exact blocker instead of skipping the stage, so a future phase that connects
an executor will see those assertions fail and have to update them deliberately.

This is a control-plane demonstration against a migrated database. It is not evidence that any
autonomous action ran in production, because none can.


## 7. Credential state observed at implementation time

Every provider credential this loop would need is absent from the environment
this phase was built in: `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`, `OPENAI_API_KEY`, and
`ANTHROPIC_API_KEY` are all unset.

That is worth recording plainly: the executor stages are not merely
policy-blocked, they are **materially impossible** here. Applying the hosted
migration, reading real deployment state, and running a Codex worker each
require a credential that does not exist in this environment, so no amount of
further implementation in this phase could have closed them.


### The failed-deploy demonstration

`tests/integration/phase1d-loop-journey.behavior.test.ts` records the chain rather than
asserting it:

1. **Deploy** — deployment state is read through `lib/deploy/vercel.ts`, which reports
   `not_connected` with its reason. `latestReadyProduction` correctly resolves nothing, because
   a failed read must never look like "nothing is deployed".
2. **Validate** — a `failed` validation is recorded for the new release through Phase 1E's real
   `record_deployment_validation`.
3. **Last Known Good holds** — the failed release does not become Last Known Good; the previously
   validated one still does.
4. **Incident** — a SEV1 is opened against that deployment, and freezes releases automatically.
5. **Controls** — the freeze propagates into the Phase 1D envelope; a tenant asking for all nine
   actions resolves to none.
6. **Rollback** — Last Known Good resolves from the validated release; execution is refused with
   `EXECUTOR_NOT_CONNECTED` and nothing is reversed.
7. **Repair** — bounded repair work is created and left unassigned.
8. **Retries** — the budget is spent one attempt at a time, then the loop escalates.

Every stage without an executor carries its exact blocker, and the journey asserts those names.

## 8. Integration register

What this phase's decision layer touches, and in which direction.

| Integration | Direction | State | Detail |
| --- | --- | --- | --- |
| Phase 1E operations schema | reads | **Connected** | `resolved_autonomy_controls` reads `release_freezes` so an active freeze appears in the decision envelope. The loop journey drives Phase 1E's real incident, freeze, Last Known Good, rollback-decision and repair functions. |
| Phase 1E repair bounds | mirrored | **Connected** | `MAX_ATTEMPTS.repair` is 3, matching the database-enforced cap, so the rule does not exist in only one half of the loop. |
| Phase 1A risk policy | reads | **Connected** | `diff-risk.ts` derives factors and defers to `classifyRisk`/`compareRisk`; it introduces no second risk vocabulary. |
| Supabase (hosted) | writes schema | **Not Connected** | Migration `20260813000500` is unapplied. `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID` and `SUPABASE_DB_PASSWORD` are unset here. |
| Vercel deployments | reads | **Not Connected** | `lib/deploy/vercel.ts` implements the real read contract and reports the reason. `VERCEL_TOKEN` is unset. No write path exists. |
| GitHub CI | reads | **Available, not wired** | CI results are readable and the `ci` gate models them, but nothing ingests a run automatically; a gate result is supplied by its caller. |
| GitHub merge | writes | **Absent by policy** | `AGENTS.md` forbids introducing an auto-merge workflow in this line of phases. The decision path returns `MERGE_EXECUTOR_NOT_CONNECTED`. |
| Codex / execution worker | writes | **Owned by Phase 1C (PR #9)** | Another agent is building it. This phase deliberately does not duplicate it; see §9 for the seam it should bind to. |

## 9. The seam a Phase 1C worker binds to

Phase 1C is being built separately (PR #9). This phase does **not** implement a worker, and a
future one should not reimplement these decisions. The contract is:

1. **Ask what you may do.** `resolveEffectiveControls(organization, project, envelope)`, with the
   envelope read from `public.resolved_autonomy_controls(project_id)` rather than assumed. Then
   `isActionPermitted(controls, action, risk)`. A worker must never consult a single project row
   directly — that skips the organization ceiling and the envelope.
2. **Ask what to work on.** `selectAutopilotWork` returns an ordered queue and an explained
   exclusion list. Do not re-sort it; the ordering encodes "safer first within a priority".
3. **Do the work, then be judged on the result.** `runPipeline` reclassifies the finished diff
   rather than trusting the opening declaration, runs the gates and the agents, and returns the
   approval decision. A worker supplies gate *results*; it does not decide whether they suffice.
4. **On failure, ask before retrying.** `evaluateRetry(stage, attemptsUsed)` returns `RETRY`,
   `ESCALATE` or `STOP`. Escalation is not a failure of the worker; it is the designed end of a
   bounded budget.
5. **Never author and approve.** `evaluateApproval` refuses when `approverId === authorId`, at
   every risk level. A worker that is both is refused, which is the intended behaviour.

The three stages that block by name — `CODEX_WORKER_NOT_CONNECTED`,
`MERGE_EXECUTOR_NOT_CONNECTED`, `DEPLOY_EXECUTOR_NOT_CONNECTED` — are asserted in
`tests/integration/phase1d-loop-journey.behavior.test.ts`. Connecting an executor is *supposed*
to fail those assertions. Update them deliberately; do not weaken them to "either blocked or not".

## 10. Phase 1E readiness

Phase 1E is already implemented and merged; the question this phase answers is whether Phase 1E
can now rely on a decision layer above it. It can:

- **Freeze propagates upward.** A SEV1/SEV2 freeze is visible in the Phase 1D envelope and holds
  every automatic action off, so Phase 1E's protective action is not something the loop can
  route around.
- **Rollback keeps its decision path.** Phase 1D adds no competing rollback authority. Last Known
  Good still resolves only from a validated deployment, and rollback execution still returns
  `EXECUTOR_NOT_CONNECTED`.
- **Repair inherits a bound, not a new one.** The retry cap mirrors the database's, so a repair
  cannot be retried more times by going through the decision layer than by going through Phase 1E.
- **Autopilot respects health.** No new work is selected for a project Phase 1E reports as
  degraded, critical or paused.

Phase 1E's own remaining gap is unchanged by this phase: migrations `028`/`029` are unhosted and
no monitor has observed a real production target.
