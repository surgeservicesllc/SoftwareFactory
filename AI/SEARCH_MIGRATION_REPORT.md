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
| `jobdanmark-search` | jobdanmark.dk | 903 | HTML + JSON-LD |
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
- `types.ts`, `registry.ts` — new; no source counterpart.

**SKIPPED**

| What | Why |
| --- | --- |
| `@bunli/core` / `@bunli/utils` CLI layer | Argument parsing for a terminal. A Next.js route is the caller. |
| `linkedin-search` | LinkedIn's terms prohibit automated collection — a separate permission from the MIT licence. This repo had already decided it: `import-adapters.ts` carries a LinkedIn adapter with no fetch at all. |
| `jobbank-search` | The source's own helper says Jobbank is Cloudflare-blocked and advises skipping it. A permanently failing board teaches people to ignore the failure notice. |
| `jobdanmark-search` | Unported, not rejected. Largest adapter; no obstacle in principle. |
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

Authenticated `Search` at `/job-seeker/search`: query three live boards by text
and place, see each board's results with the board's own total, and save any
result into the job list with honest board attribution. Failures are reported
per board beside the results that arrived.

## 8. Tests

54 new tests across 5 files, all passing; full suite **4,601 tests / 399 files**
green, with lint, typecheck and a production build.

Covered: parser normalization, malformed-payload handling (throwing rather than
returning empty), the retry deadline, network-failure message hygiene, the
auth-before-fetch boundary, cross-origin refusal, partial board failure,
re-validation of client-supplied postings, credential-shaped content, duplicate
saves, and the signed-out redirect for the new route.

## 9. Remaining external configuration

None to run Search. Two limits worth stating plainly:

- **The live boards are not exercised by any test.** Every test uses fixtures,
  deliberately — a suite that calls jobindex.dk fails when someone else ships a
  marketing change. So the parsers are proven against recorded shapes, not
  against today's live HTML. Jobindex in particular reads a page's embedded
  payload and will break when that page changes; it is built to fail loudly
  when it does.
- **Coverage is Denmark-heavy.** Jobnet and Jobindex are Danish; only Freehire
  is international. That is what the source repository was.
