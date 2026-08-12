# Post-deploy validation policy

Status: Contract for future deployment integration; production deployment is **Not Connected** in Phase 1A.

## Purpose

Deployment success means the exact released artifact is serving acceptable behavior in its target environment. A provider reporting “ready” or CI passing before deployment is necessary evidence, not sufficient post-deploy validation.

## Evidence requirements

Every validation record must include:

- project, environment, provider, deployment ID, commit SHA, and production/preview URL;
- started/completed timestamps, correlation ID, validator version, and policy version;
- baseline and thresholds used;
- individual check results with redacted diagnostics;
- final outcome: `passed`, `failed`, `inconclusive`, or `cancelled`; and
- linked incident, approval, and rollback/owner-decision records when applicable.

Missing, stale, or mismatched deployment evidence produces `inconclusive`, never `passed`.

## Validation stages

### 1. Identity and readiness

- confirm the provider deployment is terminal/ready and matches the intended project, environment, and commit;
- confirm TLS, hostname, and expected release identifier;
- wait through a bounded warm-up period without hiding prolonged readiness failures.

### 2. Availability and smoke checks

- validate health/readiness endpoints and primary public routes;
- execute representative read-only user journeys;
- verify critical assets and server/client rendering complete without fatal errors;
- check that unauthenticated and unauthorized requests fail as expected.

### 3. Data and integration safety

- verify schema compatibility and migration status without mutating production data;
- verify configured dependencies are reachable within expected bounds;
- ensure **Not Connected** dependencies degrade truthfully rather than presenting fabricated success;
- never log secrets or sensitive response bodies.

### 4. Quality and security signals

- compare error rate, latency, availability, and critical business indicators against thresholds and baseline;
- inspect security/CSP/auth failures and unexpected permission changes;
- run accessibility/performance checks where appropriate for the release type.

### 5. Observation window

- monitor sustained signals for a policy-defined period proportional to risk;
- attribute failures to the exact deployment and distinguish external monitoring/provider outages;
- complete only after all required checks remain within threshold.

## Outcomes

- **Passed:** all required evidence matches the deployment and thresholds remain satisfied.
- **Failed:** one or more attributable required checks breach policy; create/update an incident and evaluate rollback eligibility.
- **Inconclusive:** evidence is missing, stale, unavailable, or conflicting; freeze further automation and request owner attention.
- **Cancelled:** an owner or kill switch stopped validation; record who and why.

## Relationship to rollback

A failed validation does not automatically authorize rollback. Evaluate `AUTO_ROLLBACK.md` from fresh state. Database, auth/security, secret, DNS, and other protected-resource changes require owner-led containment or recovery in Phase 1.

## Phase 1A user-interface rule

Deployment and validation examples must say **Demo Data**. Provider-dependent actions must say **Not Connected**. No Phase 1A report may count a production deployment or rollback unless an independently verified live integration created the evidence above.
