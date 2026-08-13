# Autonomous mode

SoftwareFactory now contains a **Phase 1D observation-only scaffold**. It can describe whether a freshly evidenced GREEN candidate would satisfy policy, but it cannot execute or authorize an external action. The current product phase remains Phase 1B until its live acceptance gates pass.

| Control | Scope | Enforced state/effect |
| --- | --- | --- |
| Global Kill Switch | organization | **ON** and database-locked ON by migration `010`; releasing it needs an owner-approved migration |
| Emergency STOP | organization | Owner-only, requires a written reason, audited (`stop_autonomous_operations`) |
| Autonomous Mode | both | OFF and database-constrained at each scope; zero end-to-end worker runs are verified |
| Maximum Autonomous Risk | both | GREEN, database-constrained at each scope; resolution takes the lower of the two |
| Auto Plan | both | OFF and database-constrained |
| Auto Code | both | OFF; requires the Phase 1C worker, which is **Not Connected** |
| Auto Test | both | OFF and database-constrained |
| Auto Repair | both | OFF; a failure opens bounded repair work for a human instead |
| Auto Review | both | OFF; review agents produce findings only |
| Auto Approve | both | OFF and database-constrained |
| Auto Merge | both | OFF; no merge endpoint, permission, or workflow |
| Auto Deploy | both | OFF; Vercel control-plane adapter **Not Connected** |
| Auto Rollback | both | OFF; no rollback executor |
| Execution Worker | — | **Not Connected** |

## Resolution: most restrictive wins

An organization sets a ceiling; a project may only narrow it. An automatic action survives
resolution only where **both** scopes enable it, and the effective risk ceiling is the lower of the
two. A project can never widen what its organization withheld.

Four envelope conditions sit outside both scopes and force every action off regardless of what
either one holds: the global kill switch, an emergency stop, an active release freeze, and the
absence of a connected executor. The resolver reports the mode an operator actually configured
rather than rewriting it, so the interface can say "mode is on, but everything is held because X"
instead of silently contradicting the setting.

`public.resolved_autonomy_controls(project_id)` holds the identical rule in the database. It is
`security invoker`, so it cannot be used to read across a tenant boundary, and it returns every
action OFF while no executor is connected.

## Observation decision

`lib/autonomy.ts` is a pure testable prerequisite function; it is not exposed as a runtime executor. A hypothetical candidate can report `WOULD_BE_ELIGIBLE` only when all of the following explicit inputs are true:

- a future observation input explicitly represents enabled mode; the current persisted project flag remains OFF;
- the fresh classification is GREEN;
- no protected resource is touched;
- required evidence is current;
- required checks are passing; and
- no owner-attention condition exists.

This result is not an approval. The response separately reports `executionAllowed: false` with three hard blockers: `GLOBAL_KILL_SWITCH_ACTIVE`, `OBSERVATION_ONLY`, and `EXECUTOR_NOT_CONNECTED`. Missing or stale evidence produces `BLOCKED`.

## Control API and persistence

`GET /api/projects/:projectId/controls` returns tenant-scoped control state plus the hard safety envelope. `PATCH` is same-origin, authenticated, active-tenant scoped, owner-only, bounded, validated, and optimistic-concurrency capable. It accepts only:

- only the literal `false` autonomous-mode value;
- the literal GREEN ceiling; and
- explicit `false` values for auto approve, merge, deploy, and rollback.

Migration `010_phase1d_observation_controls` keeps the kill switch ON and all execution controls OFF. Migration `20260813000500_phase1d_autonomy_controls` adds the five missing actions and the organization scope, extends both interlocks to cover them, and relaxes nothing. Hosted history extends through `027`; nothing in this chain makes autonomous execution available.

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

The reviewing agents are deterministic rules engines, not model calls. Phase 1C is Not Connected,
and a rules engine can be tested, reproduces exactly, and cannot hallucinate an approval — which is
the property that matters at a gate.

## What is not built

There is no closed autonomous execution loop. Codex/OpenAI worker execution is **Not Connected**, and there is no durable leasing worker, isolated workspace, approval executor, merge adapter, deployment adapter, post-deploy monitor, or rollback executor. The existing GitHub editor remains an authenticated owner/admin-initiated workflow that creates only an isolated branch, commit, and draft pull request.

Any future execution rollout requires Phase 1B acceptance, Phase 1C worker evidence, non-production observation, exact allowlists, independent validation, owner approval for the precise authority, and a separate migration/decision that deliberately changes the locked interlocks.
