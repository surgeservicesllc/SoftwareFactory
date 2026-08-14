# Phase 1E completion — the closed loop

**PASS** proven by evidence · **PARTIAL** built, not proven live · **FAIL** built
and wrong · **BLOCKED** stopped on a named prerequisite.

Nothing in this phase calls a paid AI API. The whole loop is deterministic code,
GitHub and Vercel APIs, CI and Supabase — which is also why it is testable
without a credential.

## Scorecard

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Real production health signals ingested | **PASS** | Bounded HTTPS probe observed `https://www.theagoras.com` at 4/4 routes, 200, 190–933 ms — `AI/PRODUCTION_OBSERVATION_EVIDENCE.md` |
| 2 | Failure creates/deduplicates incident | **PASS** | `open_production_incident` deduplicates on fingerprint into one open incident |
| 3 | Severity assigned from evidence | **PASS** | `lib/operations/severity.ts`, severity escalates upward only |
| 4 | DEGRADED/CRITICAL entered correctly | **PASS** | `lib/operations/health.ts`; a connected monitor never resolves to UNKNOWN |
| 5 | Severe failure freezes releases | **PASS** | Automatic freeze on SEV1/SEV2, owner-only resume |
| 6 | Failed release resolves Last Known Good | **PASS** | `resolveLastKnownGood` takes the newest deployment that passed **its own** validation; a merely READY deployment is refused |
| 7 | Rollback executor performs a real rollback | **PARTIAL** | `lib/operations/rollback-executor.ts` implements the full sequence against an injected provider. No deployment token is configured, so it returns OWNER_ACTION_REQUIRED and keeps the freeze rather than pretending |
| 8 | Rollback status/evidence persists | **PASS** | Every execution returns an ordered `steps` trail; `rollback_operations` carries the record |
| 9 | Post-rollback validation runs | **PASS** | Recovery is observed against the real target. A provider reporting READY is explicitly not accepted as restoration |
| 10 | Failed rollback escalates | **PASS** | Promotion failure, non-READY settle, and still-sick production each escalate to SEV1 with the freeze retained — 14 tests |
| 11 | Investigator produces structured diagnosis | **PASS** | `lib/operations/investigator.ts`, deterministic, cites evidence |
| 12 | Eligible incident creates a real repair task | **PASS** | `lib/operations/promotion.ts` builds a valid Phase 1C command, proven against the real `submit_command` |
| 13 | Repair enters the existing 1C path | **PASS** | `routeRepair` dispatches into 1C or records `BLOCKED_BY_1C`. **No second coding engine exists** |
| 14 | Fix creates a real `factory/*` branch and draft PR | **BLOCKED** | Needs a claiming 1C worker — see `AI/PHASE_1C_COMPLETION.md` |
| 15 | 1D gates govern release | **PASS** | Unchanged; every automatic action remains OFF |
| 16 | Fixed deployment receives production validation | **PASS** (mechanism) / **BLOCKED** (live) | Validation path exists; nothing has deployed through it |
| 17 | Incident resolves only after recovery is proven | **PASS** | Resolution gated on restoration, passing validation, root cause and corrective action. A green deployment closes nothing |
| 18 | Root cause/corrective/preventive persist | **PASS** | Required for SEV1/SEV2 resolution by constraint |
| 19 | Retry/repair/rollback loops bounded | **PASS** | `lib/operations/self-healing.ts` — 13 tests |
| 20 | Activity/Reports/Dashboard truthful | **PASS** | Surfaces show Not Connected/Unknown rather than invented health |
| 21 | RLS/project isolation | **PASS** | 100 public tables, all RLS + FORCE RLS |
| 22 | No fake result shown as live | **PASS** | Every unproven path reports OWNER_ACTION_REQUIRED or BLOCKED |

## What the rollback executor refuses to do

Three refusals are the substance of it, and each is the opposite of a plausible
mistake made under pressure:

- **It will not roll back across a migration.** Checked before anything is
  promoted. Code can be reverted; applied schema cannot, and reversing a
  migration could destroy data the new code already wrote. It stops, keeps the
  freeze, and asks whether to roll forward or reverse the schema deliberately.
- **It will not lift the freeze on success.** A rollback restores the code; it
  does not fix the defect. Lifting protection is an owner decision.
- **It will not treat READY as restored.** The provider's opinion about its own
  deployment is not an observation of production. When no validator is
  configured it says restoration is unverified rather than assuming it.

## Self-healing limits

`assessHealing` counts *distinct* failures, not just attempts. Three repairs that
failed differently are a system working a hard problem; three that failed
identically are a system repeating itself. The identical-failure ceiling is
deliberately lower than the attempt ceiling, so the loop stops on "this is not
working" rather than on "we ran out of budget" — the first is the more useful
thing to tell a person.

## Completion

**~92%.** Every deterministic link is built and tested. Two rows are blocked and
both on the same thing: nothing claims a queued repair, and nothing deploys a
fix, because no Phase 1C worker is registered and no deployment token exists.

## Owner action

| What | Where | Field | Secret? | Verify by |
| --- | --- | --- | --- | --- |
| Deployment token | Vercel → Account Settings → Tokens | create a token scoped to the project | Yes — store as `VERCEL_TOKEN` in Vercel project env, server-only | `isDeploymentProviderConfigured()` returns true; a rollback returns something other than OWNER_ACTION_REQUIRED |
| 1C worker enable | GitHub → repo → Settings → Variables | `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED=true` | No | Workflow runs instead of skipping |
| Hosted migrations | Supabase | twelve unapplied | n/a | `AI/HOSTED_APPLY_RUNBOOK.md` |

No AI API funding is required for any of this, and none should be added.

## 2A ready

**No** — and not started. 1E's two blocked rows resolve through 1C, not through
a new phase.
