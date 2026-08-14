# Autonomous mode

Manual Phase 1C Codex execution is not Autonomous Mode. The published worker may act only after an authenticated user explicitly submits one connected-project command. It must claim a durable GREEN/YELLOW run and can end only at a validated open draft pull request plus observed CI state.

| Control | Scope | Enforced state/effect |
| --- | --- | --- |
| Global Kill Switch | organization | **ON** and database-locked ON by migration `010`; releasing it needs an owner-approved migration |
| Emergency STOP | organization | Owner-only, requires a written reason, audited (`stop_autonomous_operations`) |
| Autonomous Mode | both | OFF and database-constrained at each scope; zero end-to-end worker runs are verified |
| Maximum Autonomous Risk | both | GREEN, database-constrained at each scope; resolution takes the lower of the two |
| Auto Plan | both | OFF and database-constrained |
| Auto Code | both | OFF; the published manual Phase 1C worker is **Not Connected** and has no autonomous authority |
| Auto Test | both | OFF and database-constrained |
| Auto Repair | both | OFF; a failure opens bounded repair work for a human instead |
| Auto Review | both | OFF; review agents produce findings only |
| Auto Approve | both | OFF and database-constrained |
| Auto Merge | both | OFF; no merge endpoint, permission, or workflow |
| Auto Deploy | both | OFF; Vercel control-plane adapter **Not Connected** |
| Auto Rollback | both | OFF; no rollback executor |
| Manual Phase 1C GREEN/YELLOW worker | — | Published and schema-current; **Not Connected** until a funded-provider preflight and new current-base bounded run succeed |
| Phase 1C RED worker | — | Prohibited; owner approval does not widen the Phase 1C execution ceiling |
| Autonomous execution worker | — | **Not Connected** |

## Resolution: most restrictive wins

An organization sets a ceiling; a project may only narrow it. An automatic action survives
resolution only where **both** scopes enable it, and the effective risk ceiling is the lower of the
two. A project can never widen what its organization withheld.

Four envelope conditions sit outside both scopes and force every action off regardless of what
either one holds: the global kill switch, an emergency stop, an active release freeze, and the
absence of a connected executor. The resolver reports the mode an operator actually configured
rather than rewriting it, so the interface can say "mode is on, but everything is held because X"
instead of silently contradicting the setting.

`public.resolved_autonomy_controls(project_id)` holds the identical rule in the hosted database. It is
`security invoker`, so it cannot be used to read across a tenant boundary, reports the owner
emergency-stop state separately from a release freeze, and returns every action OFF while no
executor is connected.

## Observation scaffold

`lib/autonomy.ts` remains a pure observation-only prerequisite function. It may describe `WOULD_BE_ELIGIBLE` for hypothetical fresh GREEN evidence but always returns `executionAllowed: false` with the global kill switch, observation-only mode, and executor-not-connected blockers. Hosted project controls accept only OFF/false and GREEN values.

## Manual Phase 1C distinction

The Phase 1C path requires a new authenticated command for each run. It has fixed budgets, one repository/base SHA, a short database lease, cancellation checks, deterministic validation, protected-path/secret scans, and draft-PR-only publication. There is no loop that discovers work, approves its own action, merges, deploys, monitors production, or rolls back.

RED commands remain durable but blocked. Protected files also require exact current approved-path evidence, and no protected approval can authorize RED execution in this phase.

## What remains disabled

- automatic command generation or scheduling;
- automatic approval;
- pull-request approval or merge;
- default-branch mutation;
- production deployment or environment mutation;
- health-driven rollback;
- provider/workflow/branch-protection/secret administration; and
- Phase 2 multi-provider worker routing.

Migration `010_phase1d_observation_controls` keeps the kill switch ON and execution controls OFF. Hosted `20260813000600_phase1d_autonomy_controls.sql` adds the five missing actions and organization scope, extends both interlocks, and relaxes nothing. Forward migration `20260813001400_resolve_emergency_stop.sql` preserves the resolver security/ACL boundary while exposing the distinct owner emergency-stop signal. Hosted verification confirms every automatic action remains OFF and the global kill switch remains ON; schema presence does not make autonomous execution available.

## The decision layer

`lib/autonomy/` decides whether a change *would* be allowed to advance. It executes nothing.

| Module | Answers |
| --- | --- |
| `controls.ts` | What is this project allowed to do, once both scopes and the envelope are resolved? |
| `diff-risk.ts` | What risk does this diff actually carry, judged from its paths and content rather than its own declaration? |
| `gates.ts` | Was it verified? A missing result blocks; `not_connected` is reported separately from `not_run`. |
| `agents.ts` | What did Review, QA and Security find? Blocking findings stop progression; advisory ones do not. |
| `approval.ts` | `APPROVED_AUTOMATICALLY`, `OWNER_APPROVAL_REQUIRED`, or `NOT_APPROVED`. |
| `pipeline.ts` | How far did one pass get, and what stopped it? |

Two rules are worth stating plainly because they are what make the record meaningful:

- **Approval cannot outrank verification.** Owner approval is evaluated *after* the gates and the
  agents, so nobody can approve past a failing test or a blocking security finding. An unsound
  change is never escalated to a person, because asking someone to approve unverified work is not
  a decision they are in a position to make.
- **No self-approval, ever.** Whoever authored a change is refused as its approver at every risk
  level, including when they are the owner. An owner approving their own change does so as a
  second, separately attributed act.

The reviewing agents are deterministic rules engines, not model calls. Phase 1C is **Not Connected**,
and a rules engine can be tested, reproduces exactly, and cannot hallucinate an approval — which is
the property that matters at a gate.

## What is not built

There is no closed autonomous execution loop. The decision layer includes deterministic Backlog Autopilot selection, bounded retry decisions, failure recovery ordering, and a read-only deployment adapter that reports **Not Connected** when its provider is unavailable; none of these starts or mutates work. The durable, isolated manual Phase 1C worker is published, but Codex/OpenAI execution remains **Not Connected**: activation is absent, the exposed OpenAI secret was removed, and the configured provider project reported `credit_balance_exhausted`. Its first real claim failed before repository mutation. That run is now stale against current `main` and must remain historical evidence; a new command is required after funded-provider proof. The manual worker accepts only an authenticated owner command and can publish only an isolated branch and open draft pull request. There is no autonomous execution scheduler, approval executor, merge adapter, deployment mutator, connected post-deploy validator, or rollback executor.

Any future autonomous rollout requires Phase 1B acceptance, live Phase 1C worker evidence, sustained non-production observation, explicit allowlists and budgets, independent checks, branch protection, alerting, kill-switch drills, owner approval for the precise authority, and a separate reviewed decision, migration, and implementation that deliberately change the locked interlocks. Phase 1E migration `028` and the provider/bot/marketing/Phase 1C migration chain do not change migration `010` interlocks.
