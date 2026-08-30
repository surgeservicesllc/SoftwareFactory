# Job Search sources: connected vs credential-gated

Generated from `lib/job-seeker/board-search/catalogue.ts` on 2026-08-29.
The catalogue is the runtime truth — an integrity test
(`tests/unit/board-search-catalogue.test.ts`) holds its `live` rows equal
to the adapter registry, so this document cannot honestly drift far: when
they disagree, the catalogue file wins and this file needs regenerating.

**52 sources** (27 general, 25 marketing):
13 connected live adapters, 6 official APIs awaiting owner
credentials, 33 honest link-outs, 0 documented refusals.
No source is listed as searchable unless searching it is real; scraping
prohibited surfaces (LinkedIn, Indeed, Glassdoor) is refused by policy.

## General sources (27)

| Source | Standing | The honest sentence the UI carries |
| --- | --- | --- |
| Remotive | **Connected** (live adapter) | Searched over Remotive's public API within its stated call budget; results link back to Remotive and are ~24h delayed by the board's design. |
| Remote OK | **Connected** (live adapter) | Searched over the public JSON feed with the attribution and link-back its legal notice requires. |
| Jobicy | **Connected** (live adapter) | Searched over the public remote-jobs API using its free-text tag search. |
| Himalayas | **Connected** (live adapter) | Recent listings fetched from the public jobs API and filtered locally against the search term. |
| Arbeitnow | **Connected** (live adapter) | Europe-centric feed read over the public job-board API and filtered locally. |
| We Work Remotely | **Connected** (live adapter) | Read over the board's official RSS feed — its published integration surface — and filtered locally. |
| Jobnet (Denmark) | **Connected** (live adapter) | Denmark's public employment service, searched over its open API. |
| Jobindex (Denmark) | **Connected** (live adapter) | Denmark's largest job board, searched over its published surface. |
| JobDanmark | **Connected** (live adapter) | Danish job board searched over its published surface. |
| Freehire | **Connected** (live adapter) | Searched over the board's public API; the one connected board that states salary and work arrangement as data. |
| USAJOBS | Requires owner credentials — **Not Connected** | The U.S. federal government's job API is official and free but requires a registered API key and user agent from developer.usajobs.gov. Not connected until the owner supplies one; the link opens USAJOBS search directly. |
| Adzuna | Requires owner credentials — **Not Connected** | Adzuna aggregates millions of listings behind an official API that requires a free app_id/app_key pair from developer.adzuna.com. Not connected until the owner registers; the link opens Adzuna search directly. |
| Jooble | Requires owner credentials — **Not Connected** | Jooble's aggregation API is official and free but issues per-site keys on request. Not connected until the owner obtains one; the link opens Jooble search directly. |
| Careerjet | Requires owner credentials — **Not Connected** | Careerjet's search API requires an affiliate ID. Not connected until the owner registers; the link opens Careerjet search directly. |
| Reed.co.uk | Requires owner credentials — **Not Connected** | Reed's Jobseeker API (the UK's largest board) requires a free API key from reed.co.uk/developers. Not connected until the owner registers; the link opens Reed search directly. |
| ZipRecruiter | Requires owner credentials — **Not Connected** | ZipRecruiter's job search API is partner-only. Not connected without a partner key; the link opens ZipRecruiter search directly. |
| LinkedIn Jobs | Deep link-out (person's own browser) | LinkedIn's terms prohibit automated collection, and this repository has twice declined to scrape it; that decision stands. The link opens LinkedIn's own job search in your browser — the permitted path — carrying your search AND your filters (place, radius, posted date, work model, seniority, salary floor) in LinkedIn's own URL parameters. |
| Indeed | Deep link-out (person's own browser) | Indeed's publisher API is closed to new partners and scraping is prohibited, so the link opens Indeed's own search in your browser — carrying your search, place, radius and posted date in Indeed's own URL parameters (salary floor and remote travel in the query text, per Indeed's search tips). |
| Glassdoor | Link-out (person's own browser) | Glassdoor retired its public API, so the link opens Glassdoor's own search in your browser. |
| Monster | Link-out (person's own browser) | Monster has no open API; the link opens Monster's own search in your browser. |
| Google for Jobs | Link-out (person's own browser) | Google's job surface is a search feature without a public API; the link runs the search in your browser, where Google's job panel appears. |
| Dice | Link-out (person's own browser) | Dice (tech-focused) has no open API; the link opens Dice's own search in your browser. |
| Wellfound (AngelList Talent) | Link-out (person's own browser) | Wellfound (startup jobs) restricts automated access; the link opens its jobs page in your browser. |
| SimplyHired | Link-out (person's own browser) | SimplyHired has no open API; the link opens its own search in your browser. |
| The Muse | **Connected** (live adapter) | A sample of listings read from the public JSON API and filtered locally; the API exposes no free-text search, so a term samples the board rather than searching all of it. |
| Working Nomads | **Connected** (live adapter) | The board's open JSON feed of curated remote listings, filtered locally. |
| Jobspresso | **Connected** (live adapter) | Read over the board's official job feed — its published integration surface — and filtered locally. |

## Marketing-focused sources (25)

| Source | Standing | The honest sentence the UI carries |
| --- | --- | --- |
| AMA Job Board | Link-out (person's own browser) | The American Marketing Association's board has no open API; the link opens it in your browser. |
| MarketingHire | Link-out (person's own browser) | Marketing-specialty board without an open API; the link opens it in your browser. |
| MarketingJobs.com | Link-out (person's own browser) | Marketing-specialty board without an open API; the link opens it in your browser. |
| MarketerHire | Link-out (person's own browser) | Freelance marketing talent marketplace; matching happens inside its own product, so the link opens it in your browser. |
| Superpath | Link-out (person's own browser) | Content-marketing community job board without an open API; the link opens it in your browser. |
| ProBlogger Job Board | Link-out (person's own browser) | Long-running content and blogging job board without an open API; the link opens it in your browser. |
| Mediabistro | Link-out (person's own browser) | Media, PR, and marketing job board without an open API; the link opens it in your browser. |
| Adweek Jobs | Link-out (person's own browser) | Advertising-industry board without an open API; the link opens it in your browser. |
| Built In — Marketing | Link-out (person's own browser) | Built In's marketing category across its city hubs; no open API, so the link opens it in your browser. |
| Working in Content | Link-out (person's own browser) | Content-strategy and content-marketing job board without an open API; the link opens it in your browser. |
| Campaign Jobs | Link-out (person's own browser) | UK advertising-industry board without an open API; the link opens it in your browser. |
| Hey Marketers | Link-out (person's own browser) | Marketing-only job board without an open API; the link opens it in your browser. |
| PRSA Jobcenter | Link-out (person's own browser) | The Public Relations Society of America's board has no open API; the link opens it in your browser. |
| O'Dwyer's PR Jobs | Link-out (person's own browser) | The long-running PR trade publication's job board; no open API, so the link opens it in your browser. |
| Dribbble Jobs | Link-out (person's own browser) | Design and creative board (brand, visual, and marketing design roles) without an open API; the link opens it in your browser. |
| Behance Job List | Link-out (person's own browser) | Adobe's creative job list (brand and marketing design roles) without an open API; the link opens it in your browser. |
| AIGA Design Jobs | Link-out (person's own browser) | The professional design association's board (brand and marketing design roles) without an open API; the link opens it in your browser. |
| Coroflot | Link-out (person's own browser) | Design and creative job board without an open API; the link opens it in your browser. |
| Krop | Link-out (person's own browser) | Creative-industry job board without an open API; the link opens it in your browser. |
| Creative Circle | Link-out (person's own browser) | Creative and marketing staffing agency; roles are placed through its recruiters, so the link opens it in your browser. |
| Aquent | Link-out (person's own browser) | Creative and marketing staffing agency; roles are placed through its recruiters, so the link opens it in your browser. |
| Onward Search | Link-out (person's own browser) | Digital, creative, and marketing staffing agency; the link opens it in your browser. |
| 24 Seven Talent | Link-out (person's own browser) | Marketing, fashion, and creative staffing agency; the link opens it in your browser. |
| Robert Half — Marketing & Creative | Link-out (person's own browser) | Staffing firm whose marketing and creative practice absorbed The Creative Group; the link opens its job search in your browser. |
| Content Writing Jobs | Link-out (person's own browser) | Content-marketing and writing job board without an open API; the link opens it in your browser. |

## Requirement → implementation → evidence

Where each part of the JobSearch goal lives and what proves it:

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Provider-adapter architecture | `lib/job-seeker/board-search/registry.ts` (13 adapters, one interface; a source is added by writing one adapter file and one catalogue row) | `tests/unit/board-search-*.test.ts` fixture-pinned parsers; request-contract test pins the exact adapter map |
| Normalized job shape | `board-search/types.ts` (company, title, external id, source, URL, location, work model, salary text, description, posted/closes dates; discovery date recorded on save) | Parser tests assert the shape per board |
| Unified search + dedupe with attribution | `board-search/unify.ts` — `dedupeAcrossBoards` (normalized company+title identity, richer-record-wins, `sources[]` retained, `primarySourceIndex` for saving) | `tests/unit/board-search-unify.test.ts`; unified view's source badges |
| Fast search + incremental loading | Server route fans out to boards concurrently; panel renders 25 at a time behind Show more with "Showing X of Y" | Panel test "renders a long unified list incrementally" |
| Filters (keywords AND/OR, exclude keywords/companies, work model, title-derived seniority, title-derived marketing specialty, posting-text-derived industry, salary minimum, only-with-salary, date posted, source picker, minimum match score) with chips + Clear All | `unify.ts` `applyUnifiedFilters` shared by route, panel and alert engine; seniority/specialty via the job title, industry via the posting text — each labeled as derived, never invented | Route tests + panel tests (32) + derivation unit tests for all three |
| Location + radius | `geo.ts` over `data/cities.json` — an offline gazetteer derived from GeoNames cities15000 plus the GeoNames US postal-code set (41,488 ZIPs) (CC BY 4.0, geonames.org), server-side haversine; remote and unresolvable-place postings kept and counted; an unknown centre reports "distance not applied" with the reason; the alert engine honors a saved radius | Geo unit tests (fold/resolve/haversine/keep-rules); 3 route radius tests; 2 panel tests incl. the honest not-applied notice |
| Favorites, hide job, viewed/unviewed | `job_seeker_result_marks` (20260829000400, forced RLS, own-row policies, no update path) + `/api/job-seeker/search/marks` + panel star/Hide/Viewed controls keyed on the posting URL; “hidden by you” counted separately from “hidden by your filters”, with Show hidden and Favorites only | Marks route tests (6); panel tests for favorite/hide/viewed incl. failure revert and controls staying unrendered until real marks load |
| Saved searches (name, query, filters, sources, sort, min score, alert settings; Save/Run/Update/Duplicate/Delete; RLS) | `app/api/job-seeker/saved-searches/route.ts` over ADR-141's tables, forced RLS + double ownership filters | Saved-searches route tests (13); journey E2E saves and reruns one |
| AI matching (0–100, strongest matches, gaps, never invented) | `lib/job-seeker/evaluate.ts` deterministic scoring from the recorded Career Profile; `match: null` + stated basis without a profile | Search-route tests incl. 422 for min-score without profile; "Why this match score" expansion in the panel |
| Alerts (ASAP/Daily/Weekly/Off; dedupe → filter → score → save → email; never-repeat; sent/failed tracked) | Migration `20260829000300` (delivery ledger, UNIQUE never-repeat, service_role-only definer functions) + `/api/job-seeker/alerts/run` on Vercel Cron + `lib/job-seeker/alerts.ts` | 11-test real-SQL behavior suite; 10 planning tests; 7 runner tests; journey E2E delivers a real SMTP email and proves never-repeat from outside (run 33269486606) |
| Email content (company, title, location, salary, posted, match score, reasons, direct link) | `composeAlertEmail` — absent facts are omitted, never invented | Compose tests; the E2E asserts links and the never-repeat promise in the delivered body |
| Production email transport | Resend over raw REST, env-gated; every surface says **Not Connected** and fails closed until `RESEND_API_KEY`, `JOB_ALERT_EMAIL_FROM`, `CRON_SECRET` exist | Live production probe: `/api/job-seeker/alerts/run` → 503 `alerts_not_configured` |
| Mobile/tablet/desktop UX | Responsive panel; CI runs desktop and mobile browser projects; layout suites assert 320px reachability | Browser/accessibility CI shards; component-layout suite |
| E2E acceptance | Journey workflow: full chain on a real local stack, production build, real browser, real SMTP sink | Run `33269486606` on main `71060d0`, all green |
