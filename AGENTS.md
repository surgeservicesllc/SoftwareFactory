# SoftwareFactory agent instructions

These instructions apply to every agent and every material change in this repository. A material change includes application code, database/schema work, infrastructure, security controls, provider integrations, automation behavior, or a release decision.

## Required context before material work

Before planning or editing, read all of the following files in full:

- `AI/PROJECT_CONTEXT.md`
- `AI/CURRENT_STATE.md`
- `AI/ARCHITECTURE.md`
- `AI/ROADMAP.md`
- `AI/BACKLOG.md`
- `AI/DECISIONS.md`
- `AI/HANDOFF.md`
- `AI/QUALITY_SCORECARD.md`
- `policies/RISK_CLASSIFICATION.md`
- `policies/AUTO_MERGE_POLICY.md`
- `policies/PROTECTED_RESOURCES.md`
- `policies/AUTO_ROLLBACK.md`
- `policies/POST_DEPLOY_VALIDATION.md`

Treat those files as a maintained repository contract. If implementation and memory disagree, inspect the authoritative code, migrations, configuration, and test output; fix the discrepancy in the same change. Update `AI/CURRENT_STATE.md`, `AI/BACKLOG.md`, `AI/HANDOFF.md`, and `AI/QUALITY_SCORECARD.md` whenever their claims are affected.

## Trust and safety rules

- Phase 1A is a control-plane foundation. It does not authorize autonomous production changes.
- Never imply that a command, agent, integration, deployment, rollback, or report is live when it is not. Use the exact labels **Demo Data** and **Not Connected** where applicable.
- Default destructive or externally mutating controls to OFF. Runtime and product RED actions always require explicit owner approval in Phase 1. Repository releases follow the narrow owner-directed authorization rule below.
- Never place credentials, tokens, private keys, service-role keys, database passwords, or webhook secrets in browser code, logs, fixtures, database rows, or source control.
- A connection record is metadata plus a reference to server-side secret material; it is not a credential store.
- Keep Row Level Security enabled for every exposed Supabase table. Add ownership checks, foreign keys, indexes, and audit events with schema changes.
- Important state transitions must create immutable activity/audit events.
- Do not introduce an auto-merge or production deployment workflow in Phase 1A.

## Owner-directed repository releases

A direct owner request in the active task to push, deploy, or apply the task's reviewed repository changes is sufficient authorization for that bounded release. The request may name the destination in ordinary language, such as `main`, production, or a specific hosted migration scope. It also authorizes the ordinary commit, push, deployment, migration-apply, verification, and bounded retry mechanics needed to finish that same request.

- No magic phrase, separately submitted approval form, predeclared exact commit or artifact hash, artificial expiration, or repeated approval after commits, rebases, gate runs, or safe retries is required within the requested scope.
- Resolve and record the actual commit, artifact, branch, environment, and migration identities during execution. Exact technical gates must still prove that the built, pushed, deployed, or applied identity is the intended final identity.
- Passing authorization does not waive tests, required checks, branch protection, migration preflight/postflight checks, secret scanning, audit, rollback/containment planning, or post-deploy validation. A failed or contradictory gate still stops the release.
- Do not expand the request to another repository, branch, environment, migration, destructive data operation, secret/auth change, billing action, DNS change, or protection change that the owner did not request. A material scope expansion needs new owner direction; completing or retrying the same bounded release does not.
- This rule does not approve a RED command or other action initiated through the SoftwareFactory product, enable auto-merge/deploy/rollback, lift a freeze or kill switch, or let an automated system approve changes to its own guardrails. Those runtime and autonomy controls remain governed by their specific policies and approval records.

## Engineering expectations

- Use the App Router, TypeScript strict mode, Tailwind CSS, and server-first boundaries.
- Keep privileged operations server-only. Add `"use client"` only at the smallest interactive boundary.
- Do not hard-code personal projects, accounts, repositories, or credentials.
- Add or update tests for changed behavior, including loading, error, empty, authorization, and responsive states where relevant.
- Before claiming completion, run lint, typecheck, tests, and a production build; review tracked files for secrets; verify RLS migrations; and exercise primary layouts at mobile, tablet, and desktop widths.
- Record meaningful architecture or policy choices in `AI/DECISIONS.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
