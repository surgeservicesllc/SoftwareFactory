# Job Search integration — migration and acceptance report

Last reviewed: 2026-08-27

Source: [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search)
at exact head `79cd383e58f0af7948c7c6462a3a289e9b67421e` (2026-08-27).
Licence: **MIT**, © 2026 Mads Lorentzen. Attribution is preserved in
`THIRD_PARTY_NOTICES.md` and the upstream `LICENSE` is kept verbatim.

Status: **hosted database pass; application production acceptance pass**.
Search first reached `main` through #416 (`5cfd839`). Database-first commits
`1168e94958e9f24a927d087571384d63b12f303b` and
`f023024a90f2d37094276084df62bec135a3282e` are on `main`; exact-head CI run
`33110615299` passed all four required jobs and matching Vercel Production
deployment `6129989143` succeeded. The completed application behavior is exact
`main` `aabd82b3a626da94a2478ef26f043a51d059cd15`, with exact-head CI
`33114868741` and Vercel Production deployment `6130751384`; the stable alias
serves `/JobSearch` as `200`.

## 1. Exact source and capability census

`vendor/ai-job-search/` contains all **214 upstream files**, byte-for-byte at
the head above: 75 TypeScript, 53 Markdown, 35 Python, 13 JSON, 19 font files,
3 YAML, 2 LaTeX and the remaining licence/config/assets/placeholders. The
vendor tree is an audit reference, not a dependency: TypeScript, ESLint and
Vitest exclude it, and application code has no runtime import from it.

The source is a local-first Claude Code framework, not a web application. It
contains six board CLIs plus commands, skills, Python helpers, document
workflows, templates and fonts. Full-source integration here means every
upstream capability was captured and dispositioned; it does **not** mean
running third-party agent instructions, importing its CI, or silently granting
its local automation authority inside this multi-tenant product.

## 2. Runtime disposition

**Adapted into `lib/job-seeker/board-search/`:**

| Upstream skill | Runtime adapter | Retrieval | Location contract |
| --- | --- | --- | --- |
| `jobnet-search` | Jobnet | Public JSON BFF | Free-text location applied |
| `jobindex-search` | Jobindex | HTML `var Stash` payload | No free-text location; stated in the UI |
| `jobdanmark-search` | Jobdanmark | Public JSON POST search | Free-text location applied |
| `freehire-search` | Freehire | Public REST API | `cities` filter applied |

The six duplicated upstream fetch/retry helpers are one bounded server helper
with typed `BoardSearchError` outcomes. `types.ts` and `registry.ts` provide the
product contract and have no source counterpart. Search uses the existing
fact-only evaluator and Job Seeker pipeline rather than importing the
upstream's local files or inventing a parallel storage model.

**Captured but not activated:**

| Capability | Disposition |
| --- | --- |
| LinkedIn search | Excluded. LinkedIn's service terms prohibit this automated collection. The MIT licence governs copying source; it does not grant service access. |
| Jobbank search | Deferred. Upstream documents intermittent Cloudflare blocking and a WebSearch fallback. This product has no reliable, reviewed fallback instrument at this boundary today. That is an open integration condition, not a permanent impossibility claim. |
| Bun CLI layer | Not used. A bounded authenticated Next.js route is the caller. |
| Claude commands/skills and Gmail/Notion workflows | Not executed or imported. They assume a local personal workspace and ambient account authority that this multi-tenant control plane does not grant. |
| Python, LaTeX, fonts and local document directories | Retained as source evidence; not runtime Search dependencies. Existing Job Seeker documents use their reviewed server-side implementation. |

## 3. Product surface and navigation

`/JobSearch` is the canonical owner-named page. The signed-in global header
links **Job Search** directly to it. `/Job-Search` (the previously published
entry) and `/job-seeker/search` (the section entry) remain compatibility paths
and render the same `JobSearchPageContent`, the same `JobSearchPanel`, the same
server auth/workspace gate and the same APIs. The shell recognizes all three
as the Job Seeker product, and the global Job Search link reads active across
the compatibility paths and the wider `/job-seeker` workspace.

The canonical path is registered in component layout, width/responsive, auth
return-path and global-navigation contracts. Loading, failure, all-boards-
failed, valid empty and populated results are distinct states. A board that
cannot apply the entered location says so beside its results instead of
pretending the filter was honored.

## 4. Current live-board contract corrections

Review against the exact source plus direct board responses found four
load-bearing runtime contracts:

- **Jobnet:** the working endpoint is `/FindJob/Search`, with
  `orderType=PublicationDate`; the older `/jobsearch` + numeric order pair is
  not the current BFF contract.
- **Jobindex:** company is now commonly nested at `company.name` (with the
  older scalar variants retained as fallbacks). `supid` is an internal area
  identifier, not a free-text city, so this adapter does not send a place name
  there. If the embedded response contains postings but normalization yields
  none, the adapter throws `board_response_unreadable` rather than reporting a
  false empty search.
- **Freehire:** its place filter is `cities`, not `location`.
- **Jobdanmark:** the POST contract accepts location and a valid zero-result
  response remains an empty result, not a parser failure.

All adapters still use the common 12-second wall-clock budget, enforce HTTP(S)
result URLs, drop rows lacking the facts needed to identify a job, and report a
failure per board without discarding successful peers.

## 5. Direct probe evidence

The real adapters were called directly and non-persistently after the contract
repairs:

| Board | Returned | Board-reported total | Observation |
| --- | ---: | ---: | --- |
| Jobnet | 2 | 4 | Current BFF request and response parsed |
| Jobindex | 2 | 736 | Embedded payload and nested company shape parsed; location intentionally not applied |
| Jobdanmark | 0 | 0 | London query completed with a valid empty response |
| Freehire | 2 | 6,752 | REST response parsed with current query contract |

These probes replace the stale claim that no live board was contacted. The
signed-in production walk then returned Jobnet 4/4, Jobindex 20 shown of 736,
Jobdanmark 0/0 and Freehire 25 shown of 6,752. That adds authentication and
deployed-browser evidence; third-party contracts may still change later.

## 6. Server-issued save provenance

A browser may carry a result back to the save route, but it is no longer the
authority for what the board returned. Each search hit receives a server-sealed
token containing a SHA-256 digest of the board and every normalized job field.
The seal's scope binds organization and user; the token expires after 30
minutes (with one minute of clock-skew tolerance). Save verifies it before
loading scoring inputs or writing anything.

Missing, expired, cross-user, cross-organization, board-swapped or field-
altered evidence returns the stable `search_result_invalid` refusal. The token
contains no board credential and introduces no new environment variable; it
uses the existing server secret-box boundary.

## 7. Atomic, audited Supabase persistence

The original Search recording path called three independent PostgREST inserts:
job, match, application. A match/application refusal could leave an orphaned
job, and the unique index then made a retry look like an ordinary duplicate.
Also, the child tables' original foreign keys named only `job_id`; child RLS
checked child ownership but did not prove the referenced parent carried that
same owner.

Forward migration
`20260827000100_record_job_seeker_job_atomically.sql` adds:

1. composite parent identity and child foreign keys over
   `(job_id, organization_id, user_id)`, validated before the old single-id
   keys are dropped;
2. authenticated-only `public.record_job_seeker_job(...)`, a
   `SECURITY DEFINER` function with exact `search_path=pg_catalog`;
3. caller derivation through `auth.uid()` plus explicit organization-membership
   validation — no caller-supplied user id enters the function;
4. one transaction for the job, deterministic match, initial FOUND/QUALIFIED
   application and immutable `job_seeker.job_recorded` activity event;
5. a concurrency-safe `duplicate` outcome that writes no child or extra event;
6. explicit RLS enabled+forced reassertion on all three exposed tables.

`insertScoredJob` keeps its existing TypeScript API so search/save and import
callers benefit without a parallel code path, but it performs exactly one RPC
and validates the returned outcome. A child constraint error rolls the whole
statement back.

Authenticated direct INSERT is intentionally **not revoked in this
migration**: the existing manual `POST /api/job-seeker/jobs` route still writes
job/match/application directly. That remaining writer must move to the RPC and
gain regression coverage before a later forward ACL contraction. Revoking
first would make the manual product path fail.

## 8. Verification completed

- Focused RPC/unit and migrated-PostgreSQL persistence suite: **16/16** green.
  It proves one-RPC client wiring, recorded state/event identity, duplicate
  no-op, child-failure rollback, non-member refusal, cross-user child refusal,
  exact ACL/search path and forced RLS.
- Migration version/object/schema contracts: **64/64** green.
- Related Job Seeker route/import/foundation/journey regressions: **43/43**
  green.
- Full ESLint and TypeScript typecheck: green on the shared candidate.
- Canonical navigation, auth and responsive tests are present in the candidate.
- Full candidate Vitest: **407 files / 4,721 tests passed**, with 3 files / 7
  tests skipped; production build: **165 pages**, including `/JobSearch`.
- Save failure regression: a replacement search removes prior results/tokens;
  the exact safe server message is displayed; an expired result disables the
  futile retry and directs the person to search again.
- Database-first exact-head CI run `33110615299`: all four required quality and
  browser/accessibility jobs green.
- Hosted apply workflow `33111692239`: exact project
  `qpuofpmagrmyamahqwxw`, exact one-file SHA-256
  `2f51bf64ba3fd2bc711e6fbf9e660a2cc0dd5ef4b1f85d932ee574e79e9c7d13`,
  one ledger row, routine identity/owner/`SECURITY DEFINER`/exact search path/
  authenticated-only ACL, all three validated owner constraints, old-key
  removal, PostgREST reload and enabled+forced RLS accepted.
- Application behavior release
  `aabd82b3a626da94a2478ef26f043a51d059cd15`: exact-head CI `33114868741`,
  Vercel Production deployment `6130751384`, stable-alias `/JobSearch` health,
  desktop and 390px mobile acceptance.
- Remote production journey `33115019633` passed the returning-account gate.
  Its board sample exposed no unsaved row and skipped the mutation honestly.
- Authenticated production browser acceptance closed that sample gap: a sealed
  Jobnet result was saved and read back from the Supabase-backed Discovery UI
  at score 35/100 and initial stage FOUND. Activity rendered one immutable
  `job_seeker.job_recorded` event for entity
  `7637e796-b172-40d6-833f-408407b6f5b2`.

Together these are the exact database, application, deployment and signed-in
hosted acceptance chain.

## 9. Dependencies and configuration

No package was added. No board API key or endpoint override was added. The four
runtime boards are public/keyless. The source used `node-html-parser` and Bun
CLI packages; the product adapters use the repository's existing server
runtime and string/JSON parsing instead.

The migration was the only new external rollout requirement and is now applied
and verified on the exact production project. No new configuration is needed.

## 10. Required database-first rollout

1. **Complete:** freeze and publish the migration bytes/hash.
2. **Complete:** apply only `20260827000100_record_job_seeker_job_atomically.sql`
   forward to exact Supabase project `qpuofpmagrmyamahqwxw` before the
   application that calls its RPC.
3. **Complete for the hosted catalog boundary:** verify project identity,
   ledger, constraint definitions, function signature/owner/security/search
   path/ACL, forced RLS and PostgREST reload. Migrated-PostgreSQL tests cover
   audit, duplicate, rollback and ownership/tenant refusals; the signed-in
   hosted path is step 5.
4. **Complete:** after database acceptance, deploy exact application behavior
   revision `aabd82b3a626da94a2478ef26f043a51d059cd15`; verify CI
   `33114868741`, Vercel Production `6130751384`, alias and health.
5. **Complete:** signed-in production `/JobSearch` rendered every board,
   accepted a sealed Jobnet result, read it back with attribution/score/stage,
   and showed exactly one immutable activity event at desktop and mobile
   widths.
6. On any mismatch, stop. Contain database defects only with a new forward
   migration; do not reset, replay history or down-migrate.

The accurate verdict is **HOSTED DATABASE: PASS; APPLICATION PRODUCTION
ACCEPTANCE: PASS**.
