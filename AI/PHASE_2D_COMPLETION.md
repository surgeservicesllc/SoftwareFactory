# Phase 2D completion scorecard

Scope: the 36-item Phase 2D multi-account connection layer.

Audited tree: `origin/main` at `2b81217`. Audit date: 2026-08-14.

Loop 1 built the registry and the router. Rows below marked **(loop 1)** changed as a result; everything else is unchanged from the audit.

## The headline

The existing `connections` model is a **good foundation that was never built for
multi-account routing**. It already has the right shape for one connection per
provider per organization: a stable id, a provider enum that already names all
five providers 2D needs, an account label, an opaque `secret_reference` that
holds no secret value, `last_verified_at`, ownership, and RLS.

What it has never had is the three things that make *multiple* accounts
routable rather than merely storable:

1. **Connections do not declare capabilities.** `agents.capabilities` exists;
   `connections.capabilities` does not. So goal 9 — agents request capabilities
   rather than accounts — has nothing to resolve against.
2. **`project_connections` maps a project to a connection but not to a purpose.**
   It records *that* a connection is attached, not *what capability it serves*
   for that project. With one connection per provider that distinction is
   invisible; with two it is the whole problem.
3. **There is no Identity Router.** No module in the tree resolves
   project + capability → connection. `lib/providers/routing.ts` selects a
   *provider* (`ANTHROPIC` / `OPENAI`); it never selects *which connection of
   that provider*. That is exactly the `Provider ≠ Connection` distinction goal 1
   asks for, and it is currently collapsed.

Two smaller gaps follow from the same cause: the status enum cannot express
`degraded` / `offline` / `unauthorized` (goal 17), and nothing tracks capacity
(goal 31).

So 2D is not "schema exists, add UI". It is: make the registry describe
capability, health and capacity honestly, then add the one server-side resolver
that turns that description into an authorized choice.

## Evidence classes

| Class | Meaning |
| --- | --- |
| **LIVE** | Observed against the real external account. |
| **TEST** | Proven by automated tests against real migrations or the real module. |
| **CODE** | Present and reviewed, not exercised. |
| **ABSENT** | Does not exist in this tree. |

## Scorecard

| # | Goal | Score | Evidence |
| --- | --- | --- | --- |
| 1 | Account ≠ Connection ≠ Provider ≠ Agent ≠ Project ≠ Repository ≠ Worker | **PASS (loop 1)** | Provider and Connection are now separable: `routeConnectionIdentity` answers "which connection", `lib/providers/routing.ts` still answers "which provider", and a mapping names a capability rather than a provider. Account remains a label, which is correct — the account is the provider's, the connection is ours. |
| 2 | Multiple GitHub accounts / org installations coexist | **PARTIAL** | Schema supports it: `github_installations_connection_unique` is one installation per connection, and `github_installations_external_unique` binds an installation id to exactly one organization. `tests/integration/github-lifecycle-matrix.test.ts` proves two independent installations in one tenant stay isolated. **No second live GitHub account exists** — carried over from Phase 1B item 2. |
| 3 | Multiple Vercel accounts / teams coexist | **FAIL — ABSENT** | `connection_provider` names `vercel`, but `lib/deploy/vercel.ts` reads a single process-wide `VERCEL_TOKEN` and never consults a connection row. One account is structurally the maximum. |
| 4 | Multiple Supabase project connections coexist | **FAIL — ABSENT** | Same shape: `lib/supabase/env.ts` resolves one project from environment. No connection row participates. |
| 5 | Multiple Claude worker / session connections | **PARTIAL** | `lib/providers/claude-cli-transport.ts` reaches Claude through the Claude Code CLI on the owner's subscription at zero API cost, which is the right substrate. It resolves one ambient session, not a chosen connection. |
| 6 | Multiple Codex worker / session connections | **PARTIAL** | Phase 1C is re-architected to zero-token subscription Codex, but is Not Connected pending the owner credential, and resolves one ambient session. |
| 7 | Stable id, provider, account label, capabilities, status, ownership | **PASS (loop 1)** | `connections.capabilities` added, validated against the closed `connection_capability_types` vocabulary by trigger. Health, `health_checked_at`, `max_concurrency` and `active_leases` added alongside. |
| 8 | Project explicitly maps required connections | **PASS (loop 1)** | `project_connections.capability` and `.priority` added. A mapping now records what it is *for*. A legacy mapping with a null capability stays readable and is never routable — proven in `tests/integration/connection-registry.test.ts`. |
| 9 | Agents request capabilities, not hard-coded credentials | **PASS (loop 1)** | Eight capabilities in `connection_capability_types`; the router takes a capability and never an account. |
| 10 | Identity Router resolves project + capability → authorized connection | **PASS (loop 1)** | `lib/connections/identity-router.ts`, 17 cases in `tests/unit/identity-router.test.ts`. |
| 11 | Router never guesses an account | **PASS (loop 1)** | Every refusal is a named code. A lone connection is not the answer for a capability nobody mapped it to (`NO_MAPPING`), and a priority tie refuses (`AMBIGUOUS_MAPPING`) rather than tiebreaking non-deterministically. |
| 12 | Owner / project overrides work | **PASS (loop 1)** | `policy.overrideConnectionId` selects among eligible connections. An override naming an ineligible connection is refused (`OVERRIDE_NOT_ELIGIBLE`), never silently downgraded — an override chooses, it does not grant. |
| 13 | Secrets / session material outside browser, GitHub, prompts, logs | **PASS** | `secret_reference` is a constrained URI (`env://`, `vault://`, `secret-manager://`, `supabase-vault://`) and never a value. `connections_settings_no_sensitive_data` rejects sensitive JSON at the table. Covered by `tests/integration/secret-boundaries.contract.test.ts`. |
| 14 | No consumer passwords stored | **PASS** | Same constraints; `text_has_likely_secret` rejects credential-shaped text. |
| 15 | GitHub uses installation-scoped temporary credentials | **PASS** | `lib/github/route.ts` mints a token per request scoped to one repository id and explicit permissions; nothing is persisted. |
| 16 | Worker credentials / session references least privilege | **PARTIAL** | True for GitHub. Worker sessions are ambient rather than referenced, so "least privilege" is not expressible per connection. |
| 17 | Health supports CONNECTED / DEGRADED / OFFLINE / UNAUTHORIZED / ERROR / DISABLED | **PASS (loop 1)** | `connections.health` carries exactly those six, constrained. It is a separate column from the `connection_status` lifecycle on purpose: they are different axes, and conflating them is what made `error` mean three things. |
| 18 | Heartbeat / last verification persists | **PASS** | `connections.last_verified_at`, maintained by sync and loss paths. |
| 19 | Lost / revoked connection stops new work safely | **PASS (GitHub)** | `reserve_github_change_request` revalidates the whole live binding at the trusted write boundary; proven for every loss mode in the lifecycle matrix. Not generalized to other providers. |
| 20 | Connection loss affects only mapped projects | **PASS (GitHub)** | Proven in the lifecycle matrix: the tenant's other installation keeps working through a disconnect. |
| 21 | Reconnect restores mapping without duplicate identity | **PASS (GitHub)** | Lifecycle matrix asserts `was_created = false` and unchanged row counts across a full disconnect/resync. |
| 22 | Disconnect preserves audit / history | **PASS** | `disconnect_github_connection` preserves change requests and appends activity; asserted in the matrix. |
| 23 | Account handoff / remap a project safely | **PASS (GitHub)** | `handoff_github_project_connection` rebinds atomically with immutable exact-tuple approval evidence, live-verified in Phase 1B. This is the strongest existing precedent for 2D and the router should reuse its shape. |
| 24 | Existing runs retain historical connection identity | **PARTIAL** | `github_change_requests.connection_id` is retained. Provider runs record a routing decision but not a connection identity, because none exists. |
| 25 | Routing respects project / account / provider restrictions | **PASS (loop 1)** | `policy.permittedProviders` refuses an out-of-policy mapping (`PROVIDER_NOT_PERMITTED`) rather than skipping it. |
| 26 | Fallback uses only explicitly eligible connections | **PASS (loop 1)** | Fallback ranges only over connections the project mapped to the capability and that pass every eligibility check. `allowFallback: false` refuses instead. |
| 27 | Cross-account fallback is audited | **PASS (loop 3)** | Append-only `connection_routing_decisions` (migration `20260815001100`): every routed submission records the router's answer — selection with `used_fallback` and the full `rejected[]` list, or refusal with its named code — before the command acts on it, and a recording failure fails the submission. RLS member-read, definer-only write, immutability proven against the migrated chain in `connection-registry.test.ts`. |
| 28 | 2A provider routing integrates with Identity Router | **PARTIAL (loop 2)** | The seam now exists where connections are actually chosen: `POST /api/commands` consults `routeConnectionIdentity` with `repository.write` before persisting. For a project with capability-labelled mappings the router is binding — a refusal refuses the command (409, router's named reason), a selection disagreeing with the resolved primary binding is surfaced as a contradiction (409, never a tiebreak), and a registry read failure fails closed (503) instead of degrading to the unrouted path. Legacy projects proceed exactly as before and the response says so (`connectionRouting.mode: "legacy"`). Five route tests. Remaining for PASS: the 2A provider-selection module itself still never consults connection identity (its live path is OFF by owner decision), and no real project mapping is capability-labelled yet. |
| 29 | 2B graph nodes resolve connections through router | **FAIL — ABSENT** | `lib/graph/` resolves providers, not connections. |
| 30 | 2C portfolio shows connection / account health per project | **PARTIAL** | Portfolio surfaces project health. Per-project connection identity and health are not shown, because a project's connection set is not capability-labelled. |
| 31 | Concurrency / rate / capacity limits enforced | **PASS (loop 4)** | Re-scored against the Phase 2E scheduler, which landed after this audit: `portfolio_capacity_verdict` enforces a connection-specific ceiling at claim time, counted live from running runs with unexpired leases — self-correcting on lease expiry, which a stored counter structurally cannot be. The previously untested connection-level branch is now proven end-to-end (`phase2e-portfolio-scheduling.behavior.test.ts`: withheld at ceiling with the audited reason, neighbour unaffected, released with capacity). The router's capacity input is the same live count (`routable-candidates.ts` counts `agent_runs`, never `active_leases` — proven by a test where the stored counter claims exhaustion and is ignored), and the two declared ceilings (`connections.max_concurrency`, connection-specific `provider_capacity_limits`) reconcile strictest-wins. "Lease acquisition" needed no new machinery: the lease **is** the run lease. |
| 32 | RLS prevents cross-user / org connection access | **PASS** | RLS + FORCE RLS on `connections` and `project_connections`; owner allowed / unrelated denied / anonymous denied proven in `tests/integration/github-rls-behavior.test.ts` and the lifecycle matrix. |
| 33 | Workers receive only target-project credentials / context | **PARTIAL** | GitHub tokens are repository-scoped per request. Worker sessions are ambient, so scoping is by process, not by project. |
| 34 | Hosted schema / RLS / indexes support multi-account operation | **PARTIAL (loop 1)** | The schema now expresses capability, health and capacity, with two routing indexes. Verified on a real PostgreSQL 16.13 cluster: 65 migrations apply, 0 of 103 tables missing RLS/FORCE RLS, `service_role` still on exactly four tables. **Unhosted** — no Supabase credential exists in this environment. |
| 35 | At least two distinct real connection identities proven | **BLOCKED** | Requires a second real account on some provider. Carried over from Phase 1B item 2. |
| 36 | No paid AI-token dependency | **PASS** | Phase 1C is zero-token subscription Codex; `claude-cli-transport.ts` reaches Claude on the owner's subscription with a verified live canary. No paid key is a configuration field on either path. |

## Score after loop 4 (2026-08-15, master loop iteration 14)

- PASS: 22 of 36
- PARTIAL: 11 of 36
- FAIL (absent): 2 of 36 — goals 3, 4, 29
- BLOCKED: 1 of 36 — goal 35
- Weighted completion: **≈78%** (≈43% at audit, then ≈72% / ≈74% / ≈76% by loop)

Loop 3 closed row 27: identity-routing decisions are durable, append-only
evidence, recorded before they are acted on. Loop 4 closed row 31 partly by
re-audit — the 2E scheduler that landed after this audit already enforces
connection ceilings at claim time from live run counts — and partly by
repairing the router's capacity input to read that same live count instead
of the drift-prone stored counter, with the strictest of the two declared
ceilings.

Loop 2 closed the seam row 28 named as absent: the Identity Router is now
consulted where work is created (`POST /api/commands`), binding for
capability-labelled projects, legacy-transparent for unlabelled ones, and
failing closed on registry errors. What remains is binding real providers to
the registry (Vercel, Supabase, 2B graph nodes), persisting the fallback
audit (row 27), building lease acquisition (row 31), and the one live proof
that needs a second real account (row 35).

## Earliest missing capability

Per the loop's step 4, the earliest missing capability is **not** the router —
it is the registry the router would read. A resolver cannot match a capability
against connections that do not declare one, cannot prefer a healthy connection
over a degraded one when `degraded` is unrepresentable, and cannot queue against
capacity that is not recorded.

Order of work, therefore:

1. Extend `connections` with `capabilities`, capacity, and the three missing
   health states. Extend `project_connections` with the capability the mapping
   satisfies and whether it is authorized.
2. Add the Identity Router as one server-side resolver over that registry.
3. Bind 2A, 2B, and the GitHub path to it, so provider selection and identity
   selection stop being the same decision.

Steps 1 and 2 need no external credential. Step 3's live proof does.

## Blockers

- **Goal 35, and the live half of goals 2–6, need a second real account** on at
  least one provider. Same external resource Phase 1B items 2 and 20 need.
- **Hosted apply requires owner credentials.** No `SUPABASE_ACCESS_TOKEN` or
  database password exists in this environment, so any 2D migration lands
  unhosted and joins `AI/HOSTED_APPLY_RUNBOOK.md`.

## Phase 3 readiness

**NO.** 2D is ~43%, and the routing half — the part that makes it 2D rather than
1B — is unbuilt.
