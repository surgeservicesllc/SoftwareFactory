# Autonomous mode

Autonomous controls express the maximum policy an owner is willing to consider. They do not grant a model, browser, or unconnected provider permission to act.

## Controls

| Control | Meaning | Phase 1A default/effect |
| --- | --- | --- |
| Autonomous Mode | Master eligibility switch for unattended execution | OFF; no unrestricted production executor exists |
| Maximum Autonomous Risk | Highest risk tier eligible for unattended consideration | GREEN at most; RED always needs owner approval |
| Auto Approve | Whether qualifying non-owner approvals may be resolved by policy | OFF; cannot approve RED or protected-resource actions |
| Auto Merge | Whether an eligible validated PR may merge | OFF; unavailable under Phase 1A policy |
| Auto Deploy | Whether an eligible artifact may deploy | OFF; provider **Not Connected** |
| Auto Rollback | Whether a narrowly eligible deployment may revert after validation failure | OFF; unavailable under Phase 1A policy |

## Effective authorization

An action is permitted only by the intersection of:

- authenticated actor and tenant permissions;
- project Autonomous Mode and maximum-risk settings;
- the action's freshly evaluated risk classification;
- protected-resource rules;
- action-specific automation control;
- current approval, branch/environment protection, and provider scope;
- passing validation and absence of freezes/kill switches; and
- an implemented, verified server-side executor.

If any element is OFF, missing, expired, stale, ambiguous, or **Not Connected**, the action does not execute. Client-side state never overrides server policy.

## Phase 1A behavior

- The interface may let an owner inspect or configure controls.
- Potentially destructive controls start OFF.
- A submitted command is queued intent, not proof of AI work.
- No production auto-merge, auto-deploy, or auto-rollback is configured.
- RED always requests explicit owner approval and does not execute autonomously.
- Demo metrics and activity remain labeled **Demo Data**.

## Required audit events

Record project, actor, prior value, new value, policy version, reason, and time for:

- Autonomous Mode changed;
- maximum risk changed;
- auto approve/merge/deploy/rollback changed;
- approval requested, granted, denied, expired, or revoked;
- execution started/stopped, kill switch activated, or provider unavailable; and
- deployment/rollback initiated and validated in a future connected phase.

## Future enablement sequence

1. Implement an isolated durable worker with budgets, leases, idempotency, and cancellation.
2. Prove policy decisions in observation-only mode.
3. Start with read-only commands, then GREEN draft-PR creation in non-production projects.
4. Add owner-visible evidence, alerts, a kill switch, and incident drills.
5. Enable one bounded capability for one allowlisted project through explicit owner approval.
6. Expand only from measured outcomes; do not infer permission for adjacent actions.
