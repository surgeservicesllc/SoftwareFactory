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

## Trigger and response model

1. Post-deploy validation observes a sustained, attributable failure outside the warm-up window.
2. Policy evaluates the deployment, environment, protected resources, and rollback eligibility from fresh state.
3. If ineligible or uncertain, stop and request owner action.
4. If eligible in a future authorized phase, create the incident/audit record, lock the environment, and initiate one rollback.
5. Validate recovery using `POST_DEPLOY_VALIDATION.md`.
6. If recovery fails, stop automation, escalate to the owner/incident commander, and preserve evidence.

## Required drills before enablement

- successful rollback of a disposable preview/staging deployment;
- stale/false health signal simulation;
- incompatible migration simulation;
- concurrent deployment/rollback lock test;
- provider timeout and ambiguous-response test; and
- verified alerting, kill switch, audit evidence, and recovery-time objective.

Record any future enablement as a new decision in `AI/DECISIONS.md`.
