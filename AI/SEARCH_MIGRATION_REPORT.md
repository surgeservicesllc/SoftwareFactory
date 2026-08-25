# Search integration — migration report

Source: [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search)
at `e2c311a5b40512daf79a04b22c96d7e049afc745`. Licence: **MIT**, © 2026 Mads
Lorentzen. Attribution in `THIRD_PARTY_NOTICES.md`.

## 1. Source files reviewed

214 files. The census: 75 TypeScript, 53 Markdown, 35 Python, 13 JSON, 19 font
binaries, 3 YAML, 2 LaTeX.

All TypeScript lives under `.agents/skills/<board>-search/cli/` — six
standalone Bun CLIs, ~4,271 source LOC excluding tests:

| Skill | Board | Src LOC | Retrieval |
| --- | --- | --- | --- |
| `jobdanmark-search` | jobdanmark.dk | 903 | JSON search (POST) |
| `jobindex-search` | jobindex.dk | 815 | HTML (`var Stash` blob) |
| `freehire-search` | freehire.me | 696 | Public REST API |
| `jobnet-search` | jobnet.dk | 652 | JSON BFF |
| `jobbank-search` | jobbank | 585 | RSS + JSON-LD |
| `linkedin-search` | LinkedIn | 620 | Scrape |

Everything else — `salary_lookup.py`, `tools/` (PDF verification, robots
checking, security guards, skill linting), `cv/` and `cover_letters/` LaTeX
templates with bundled Lato/Raleway fonts, `documents/`, `templates/` — is not
Search.

## 2. Disposition

**ADAPTED** — `lib/job-seeker/board-search/`

- `http.ts` ← the six near-identical `helpers.ts` fetch/retry copies, merged
  into one. `htmlToText` is *not* here: it delegates to the existing
  `import-adapters.ts` implementation, which already handled more block tags
  and double-encoded entities.
- `jobnet.ts` ← `jobnet-search` search command and helpers.
- `jobindex.ts` ← `jobindex-search`, including the `var Stash` brace-counting
  extractor and the tree walk for `searchResponse`.
- `freehire.ts` ← `freehire-search` envelope handling, `toResult`,
  `formatSalary`.
- `jobdanmark.ts` ← `jobdanmark-search` POST search, `toContractDate`,
  `extractCity` (with its four-digit-street-number edge case).
- `types.ts`, `registry.ts` — new; no source counterpart.

**SKIPPED** — two boards, both refusals with reasons, plus the non-Search parts

| What | Why |
| --- | --- |
| `@bunli/core` / `@bunli/utils` CLI layer | Argument parsing for a terminal. A Next.js route is the caller. |
| `linkedin-search` | LinkedIn's terms prohibit automated collection — a separate permission from the MIT licence. This repo had already decided it: `import-adapters.ts` carries a LinkedIn adapter with no fetch at all. |
| `jobbank-search` | The source's own helper says Jobbank is Cloudflare-blocked and advises skipping it. A permanently failing board teaches people to ignore the failure notice. |
| Python tooling, LaTeX templates, fonts | Not Search. |

**MERGED** — Search does not own a recording path. Saving calls the existing
`insertScoredJob`, so a saved posting is scored, deduplicated and enters the
pipeline exactly as a manually recorded one does.

## 3. What changed from the source, and why

- **Retry budget.** Six retries at a 15s attempt timeout can exceed a minute.
  Replaced with a 12s wall-clock deadline for the whole operation.
- **Typed failures.** Bare `Error` → `BoardSearchError` carrying a code and the
  board that failed, so one board failing does not fail the search.
- **Dropped rather than defaulted.** A posting with no title/employer/id is
  skipped. Freehire's `"(untitled)"` default is not carried across.
- **No `FREEHIRE_API_URL`.** An env var redirecting where the server sends
  queries is a redirection of trust.
- **URL scheme enforced.** `.url()` accepts `javascript:`; both the parsers and
  the save route now require `http(s)`.

## 4. Files changed

New: 5 adapter modules, 2 API routes, 1 page, 1 component, 5 test files,
`THIRD_PARTY_NOTICES.md`, this report.
Modified: `lib/job-seeker/navigation.ts` (Search entry),
`tests/unit/job-seeker-navigation.test.ts` (nav contract),
`tests/e2e/responsive.spec.ts` (server-side gate assertion),
`app/api/job-seeker/jobs/route.ts` (pre-existing URL-scheme hardening).

## 5. Database changes

**None.** No migration was needed. Saved postings go into the existing
`job_seeker_jobs` with its existing RLS, ownership checks, bounds and dedupe
index; `source` already accepts a board key under its `^[a-z][a-z0-9_]{0,62}$`
CHECK. Reusing a table that already enforces what is needed is preferable to
adding one that would have to re-enforce it.

## 6. Dependencies

**None added.** The source used `node-html-parser` (absent here) and `zod` v3
(this repo has v4). The ported parsers work on JSON and string scanning, so no
HTML parser was required.

**No new environment variables.** All three boards are keyless public
endpoints.

## 7. Functionality added

Authenticated `Search` at `/job-seeker/search`: query four live boards by text
and place, see each board's results with the board's own total, and save any
result into the job list with honest board attribution. Failures are reported
per board beside the results that arrived.

## 8. Tests

70 new tests across 7 files, all passing; full suite **4,617 tests / 401 files**
green, with lint, typecheck and a production build.

**Unit** — parser normalization, malformed-payload handling (throwing rather
than returning empty), the retry deadline under a fake clock, network-failure
message hygiene.

**Route** — the auth-before-fetch boundary, cross-origin refusal, partial board
failure, re-validation of client-supplied postings, credential-shaped content,
duplicate saves reported as a state rather than an error.

**Behaviour, real PostgreSQL** (`job-seeker-search-persistence.behavior`) — the
full migration chain in PGlite: every registry board key satisfies the `source`
CHECK, a repeat save is refused by the unique index rather than by the route, a
saved job is invisible to a colleague in the same tenant, `anon` is refused the
table outright rather than filtered by RLS, and a saved posting survives a
later read.

**Browser** — the signed-out redirect for `/job-seeker/search` runs in CI. The
signed-in workflow (search → save → reload → verify attribution) is written in
`tests/e2e/job-seeker-journey.spec.ts` behind `JOB_SEEKER_E2E`; it really
contacts the boards, and has **not been executed** — this environment has no
Docker daemon, so no local Supabase stack.

## 9. Remaining external configuration

None to run Search. Two limits worth stating plainly:

- **No live board has been contacted.** Every test that runs uses fixtures,
  deliberately — a suite that calls jobindex.dk fails when someone else ships a
  marketing change. The gated journey does contact them and has not been run
  here. So the parsers are proven against recorded shapes, not against today's
  live HTML. Jobindex in particular reads a page's embedded payload and will
  break when that page changes; it is built to fail loudly when it does.
- **Therefore this is not SEARCH INTEGRATION: PASS.** That verdict was reserved
  for a real end-to-end run, and the end-to-end run is the one thing that has
  not happened. Running `JOB_SEEKER_E2E=1 npx playwright test
  tests/e2e/job-seeker-journey.spec.ts --project=desktop-chromium` against a
  local stack is what would settle it.
- **Coverage is Denmark-heavy.** Jobnet, Jobindex and Jobdanmark are Danish;
  only Freehire is international. That is what the source repository was.
