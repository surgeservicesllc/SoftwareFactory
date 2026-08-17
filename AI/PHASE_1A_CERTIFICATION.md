# Phase 1A per-page certification

Certified: 2026-08-15T23:19Z, by the master certification loop (iteration 17).

## What was checked, and how

Every route in the factory's page inventory — the same list
`tests/e2e/pages.spec.ts` walks for headings, viewport containment, and axe
accessibility on every CI run — was fetched **live on the production origin**
`https://softwarefactory-tan.vercel.app` and its HTTP status recorded. This is
a live check against the deployed surface, not an inspection of source.

Two things this certification deliberately does not claim:

- **It does not claim the signed-in experience.** These fetches are
  unauthenticated, so each page certifies its signed-out or unconfigured
  state — which is the state every visitor meets first, and the state the e2e
  suite proves renders a truthful heading, a contained layout, and no axe
  violations at mobile, tablet, and desktop widths.
- **It does not claim a specific deployment id.** No Vercel credential exists
  in this environment to interrogate the deployment API. What it can prove is
  freshness by construction: `/solutions/portfolio/{id}` only entered the
  route table on 2026-08-15, and it serves 200 rather than 404, so the live
  deployment carries the current route inventory.

## Results — every route, live

| Route | Status | Verdict |
| --- | --- | --- |
| `/` | 200 | PASS |
| `/solutions` | 200 | PASS |
| `/solutions/operations` | 200 | PASS |
| `/solutions/projects` | 200 | PASS |
| `/solutions/portfolio` | 200 | PASS |
| `/solutions/portfolio/00000000-0000-4000-8000-00000000dead` | 200 | PASS — the honest missing state, not a 404 or a fabricated project |
| `/solutions/files` | 200 | PASS |
| `/solutions/bot-manager` | 200 | PASS |
| `/solutions/connections` | 200 | PASS |
| `/solutions/activity` | 200 | PASS |
| `/solutions/settings` | 200 | PASS |
| `/solutions/agents` | 200 | PASS |
| `/solutions/resources` | 200 | PASS |
| `/solutions/workflows` | 200 | PASS |
| `/solutions/backlog` | 200 | PASS |
| `/solutions/runs` | 200 | PASS |
| `/solutions/reports` | 200 | PASS |
| `/solutions/agentos` | 200 | PASS |
| `/solutions/autonomy` | 200 | PASS |
| `/auth/sign-in` | 200 | PASS |
| `/auth/sign-up` | 200 | PASS |

**21 of 21 PASS.**

## What stands behind the statuses

A 200 alone would be a thin certification. Behind each row:

- `tests/e2e/pages.spec.ts` asserts, on every CI run, that the same route
  renders its level-1 heading, stays inside the viewport at 360px, 768px and
  1280px, and passes an axe scan.
- The unit suites assert each console's four truthful states — loading,
  error, empty, and signed-out — and that no page invents data it cannot
  read: null counts render "Unknown", missing projects render the
  can't-distinguish-missing-from-invisible sentence, unconnected providers
  render **Not Connected**.
- The security suites assert every exposed table sits behind RLS with FORCE
  RLS, anonymous callers can execute exactly one function, and the client
  bundle carries no credential-shaped strings.

## Re-certification

Re-run the fetch loop against the production origin and update the table and
date. If any route stops answering 200, that is a production incident, not a
documentation problem — the runbook path is the operations console, and the
route must not be deleted from this table to make the count pass.
