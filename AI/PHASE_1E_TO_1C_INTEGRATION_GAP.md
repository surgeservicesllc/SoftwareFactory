# Phase 1E repair work cannot reach Phase 1C execution

Found: 2026-08-13, by attempting the wiring rather than assuming it.
Status: **real gap, not yet closed.** The fix is identified and scoped below.

## What the chain claims

The Phase 1E objective ends with:

> Incident → Diagnosis → Repair Task → **Codex** → isolated branch → fix → tests → independent
> review → PR → normal 1D gates

Phase 1E builds the left half and Phase 1C builds the right half. They were built independently,
by different agents, and **they do not meet**.

## Why they do not meet

`create_repair_attempt` (migration `028`) writes a bare `public.tasks` row:

```
status          = 'backlog'
assignment_status = 'not_connected'
```

with no `command` and no `agent_run`.

`claim_phase1c_run` (migration `20260813000900`) selects an `agent_runs` row joined to a
`commands` row, a `tasks` row in `queued`/`in_progress`, a live GitHub connection, an installation,
and a selected repository.

So a Phase 1E repair task is not merely unclaimed — it is **unclaimable**. No worker, credential, or
configuration change would let one be picked up. The `not_connected` label was accurate about the
missing worker but understated the problem: even with a worker, the row could never be selected.

## Why this was not fixed in the same pass

The obvious fix — a `promote_repair_attempt` SQL function calling `submit_command` — was written and
then withdrawn, because Phase 1C's command parameters are a strict **exact-key** contract:

```
acceptanceCriteria, agentRole, budget, commandType, dependencyTaskIds,
executionMode, model, plan, provider, repositoryBinding, riskAssessment
```

The validation compares the sorted key array with `is distinct from`, so a parameter object must
carry exactly that set — and `budget`, `plan`, and `repositoryBinding` each have their own nested
validation. Reconstructing all of it inside a Phase 1E SQL function would duplicate validation that
already lives in `lib/orchestration/plan.ts`, and would drift from it the first time Phase 1C
changed. Shipping a version that merely passed a test would have been worse than shipping nothing,
because it would look connected.

## The fix

Promotion belongs in TypeScript, not SQL, reusing the module that already knows the contract:

1. In `lib/operations/`, add a promotion step that calls `createPhase1CExecutionPlan`
   (`lib/orchestration/plan.ts`) to build a valid Phase 1C command from the incident's diagnosis —
   `commandType: "fix_bug"`, acceptance criteria derived from the diagnosis, and the project's
   repository binding.
2. Submit it through `submit_command`, the same entry point every other command uses, so the
   database risk floor applies. A security-shaped repair is then forced to RED and to owner
   approval — Phase 1E must not get a privileged lane into execution.
3. Link the resulting `task_id` back onto `repair_attempts` and move `assignment_status` from
   `not_connected` to `pending`.
4. Respect the Phase 1E interlocks, with the distinction that already exists: a **release freeze**
   must *not* block promotion (a frozen project still needs repair — that is why freezing removes
   only release authority), but the organization-wide **emergency stop** must block it.
5. Refuse to promote an attempt with no diagnosis. Repair work is only as good as the diagnosis
   behind it, and promoting an undiagnosed incident hands a worker an instruction nobody derived.

Bounded attempts still apply: `create_repair_attempt` caps at three and escalates on the third.

## What this does and does not unblock

Closing this gap makes the chain continuous **in code**. It does not make it execute: Phase 1C needs
a registered worker and `OPENAI_API_KEY`, neither of which exists in any verified environment. A
promoted run would sit `queued`, which is the truthful state and visibly different from today's
state, where it could never run at all.
