# Autonomous mode

SoftwareFactory now contains a **Phase 1D observation-only scaffold**. It can describe whether a freshly evidenced GREEN candidate would satisfy policy, but it cannot execute or authorize an external action. The current product phase remains Phase 1B until its live acceptance gates pass.

| Control | Enforced state/effect |
| --- | --- |
| Global Kill Switch | **ON** and database-locked ON by migration `010` |
| Autonomous Mode | OFF and database-constrained; zero end-to-end worker runs are verified |
| Maximum Autonomous Risk | GREEN, database-constrained |
| Auto Approve | OFF and database-constrained |
| Auto Merge | OFF; no merge endpoint, permission, or workflow |
| Auto Deploy | OFF; Vercel control-plane adapter **Not Connected** |
| Auto Rollback | OFF; no rollback executor |
| Execution Worker | **Not Connected** |

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

Migration `010_phase1d_observation_controls` keeps the kill switch ON and all execution controls OFF. Hosted history now extends through `026`; this does not make execution available, and migration `026` does not change the Phase 1D interlocks.

## What is not built

There is no closed autonomous execution loop. Codex/OpenAI worker execution is **Not Connected**, and there is no durable leasing worker, isolated workspace, approval executor, merge adapter, deployment adapter, post-deploy monitor, or rollback executor. The existing GitHub editor remains an authenticated owner/admin-initiated workflow that creates only an isolated branch, commit, and draft pull request.

Any future execution rollout requires Phase 1B acceptance, Phase 1C worker evidence, non-production observation, exact allowlists, independent validation, owner approval for the precise authority, and a separate migration/decision that deliberately changes the locked interlocks.
