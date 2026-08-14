# Automatic rollback policy

Status: **Disabled in Phase 1A**

## Principle

A rollback is a production mutation, not an inherently safe undo button. It can reintroduce vulnerabilities, conflict with database state, lose data, or expand an incident. Auto Rollback defaults OFF and no Phase 1A component may execute a production rollback.

## Phase 1A behavior

- Controls may describe intended policy but must not claim a rollback occurred.
- A detected failure may create an incident and request owner attention.
- Operators follow provider-specific manual recovery procedures outside the control plane.
- Rollback recommendations must identify their evidence and limitations.

## Future eligibility

Automatic rollback may be considered only for a narrowly allowlisted deployment when every condition is true:

- an owner has explicitly enabled rollback for the exact project/environment and the change is within authorized risk;
- the previous application artifact is immutable, known healthy, compatible, and available;
- rollback changes application deployment only; it does not reverse data migrations, delete data, rotate secrets, modify DNS, or weaken security controls;
- health signals are independent, timely, and meet predeclared thresholds across more than one check where practical;
- post-deploy validation was associated with the exact deployment and baseline;
- an idempotent provider operation and concurrency lock prevent duplicate/conflicting rollbacks;
- an incident, audit trail, alert, and owner notification are created before or atomically with initiation; and
- the rollback action itself can be observed and validated.

## Automatic rollback is prohibited when

- root cause or current deployment identity is ambiguous;
- database/schema compatibility is uncertain;
- the preceding release included irreversible data, auth, security, secret, DNS, or infrastructure changes;
- telemetry is stale, unavailable, noisy, or inside a known monitoring outage;
- multiple deployments are in flight;
- an owner freeze, kill switch, or incident commander blocks automation; or
- rollback would exceed approved scope, time window, or retry limit.

### Which of these are implemented

`lib/autonomy/recovery.ts` evaluates this policy and executes nothing; every path ends at
`EXECUTOR_NOT_CONNECTED` or hands the decision to an owner. The prohibitions are enforced as
follows:

| Prohibition | Where |
| --- | --- |
| The preceding release included irreversible data, auth, security, secret, DNS, or infrastructure changes | `IRREVERSIBLE_RELEASE_FACTORS`, reused from the diff classifier so the definition cannot drift. Outranks controls, ceiling and owner approval alike |
| Root cause or current deployment identity is ambiguous | `DEPLOYMENT_IDENTITY_AMBIGUOUS` |
| Telemetry is stale, unavailable, noisy, or in a monitoring outage | `TELEMETRY_UNRELIABLE` |
| Multiple deployments are in flight | `CONCURRENT_DEPLOYMENTS` |
| An owner freeze or kill switch blocks automation | The `controls.ts` envelope, which forces every action off |
| Rollback would exceed the retry limit | `retries.ts`, bounded and escalating |
| The previous artifact is known healthy | `NO_VALIDATED_LAST_KNOWN_GOOD` — Last Known Good resolves only from a deployment whose own validation passed |

Not implemented: independent multi-signal health thresholds, the idempotent provider operation and
concurrency lock, and observing the rollback action itself. Each needs a deployment adapter, which
is **Not Connected**.

## Trigger and response model

1. Post-deploy validation observes a sustained, attributable failure outside the warm-up window.
2. Policy evaluates the deployment, environment, protected resources, and rollback eligibility from fresh state.
3. If ineligible or uncertain, stop and request owner action.
4. If eligible in a future authorized phase, create the incident/audit record, lock the environment, and initiate one rollback.
5. Validate recovery using `POST_DEPLOY_VALIDATION.md`.
6. If recovery fails, stop automation, escalate to the owner/incident commander, and preserve evidence.

## Phase 1E implementation status

Phase 1E implements this policy's decision path and none of its execution path. It changes no rule above.

- Rollback eligibility is evaluated fail-closed against the conditions in this document, and every blocker is recorded rather than the first one only.
- `EXECUTOR_NOT_CONNECTED` is unconditional: no deployment provider adapter exists, so an eligible-looking rollback is still recorded as blocked and nothing is executed.
- Last Known Good is evidence-bound. A deployment qualifies only when it succeeded **and** its own post-deploy validation passed; a provider "ready" status alone never qualifies.
- A failed rollback cannot be recorded without escalating the incident to SEV1 and flagging owner attention. This is a database CHECK constraint, not application logic, so recovery failure cannot degrade into silence.
- Rollback attempts are bounded at three per incident, after which the decision belongs to the owner.
- No database or data migration is reversed by any Phase 1E code path.

Enablement still requires everything below, plus an owner-approved migration relaxing the Phase 1D constraint that pins `auto_rollback` off.

## Required drills before enablement

- successful rollback of a disposable preview/staging deployment;
- stale/false health signal simulation;
- incompatible migration simulation;
- concurrent deployment/rollback lock test;
- provider timeout and ambiguous-response test; and
- verified alerting, kill switch, audit evidence, and recovery-time objective.

Record any future enablement as a new decision in `AI/DECISIONS.md`.
