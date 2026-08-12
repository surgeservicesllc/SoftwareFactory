# Autonomous mode

Phase 1B does not authorize autonomous execution. Controls express future policy ceilings only; they do not grant a browser, model, GitHub App, or unconnected provider permission to act.

| Control | Phase 1B state/effect |
| --- | --- |
| Autonomous Mode | OFF; no live AI worker or unattended executor |
| Maximum Autonomous Risk | GREEN ceiling only; not an execution grant |
| Auto Approve | OFF; RED/protected actions require current owner approval |
| Auto Merge | OFF; no merge endpoint/workflow |
| Auto Deploy | OFF; Vercel control-plane adapter **Not Connected** |
| Auto Rollback | OFF; no rollback executor |

The GitHub file editor is an authenticated, owner/admin-initiated YELLOW workflow. It creates only an isolated branch, commit, and draft pull request. It does not constitute autonomous mode and cannot merge or deploy.

An action is eligible only at the intersection of authenticated actor/tenant rights, project policy, fresh risk classification, protected-resource rules, exact provider scope, current approval, validation evidence, absence of kill switches/freezes, and an implemented server-side executor. Missing, stale, ambiguous, OFF, or **Not Connected** means no execution.

Phase 1C may introduce bounded Codex execution only after explicit instruction and separate worker/sandbox/budget/cancellation evidence. Claude/Anthropic logical agents are deferred to Phase 2 and remain **Not Connected**. Enabling auto merge/deploy/rollback requires future policy decisions, non-production observation, exact owner approval, and operational drills.
