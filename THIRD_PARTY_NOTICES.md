# Third-party notices

This file records third-party work whose source SoftwareFactory adapts, and the
licence terms that adaptation is made under. It is not a dependency list —
`package.json` and the lockfile are the record for installed packages. This file
covers code and design that were **read and adapted into this repository's own
source**, where the upstream licence asks for its notice to travel with the copy.

---

## ai-job-search — Mads Lorentzen

- Upstream: https://github.com/MadsLorentzen/ai-job-search
- Licence: MIT
- Copyright (c) 2026 Mads Lorentzen

### What SoftwareFactory adapts

`ai-job-search` is a Claude Code framework: skills, slash commands, and Bun CLIs
that run a job search from a person's own machine against local files. The Job
Seeker product here is a hosted, multi-tenant web application with Supabase as
its system of record, so nothing is vendored verbatim — the upstream work is
adapted. These are the pieces whose design or logic was carried across:

| Upstream | Adapted into |
|---|---|
| `.agents/skills/freehire-search/cli` — the freehire.me public JSON search, its envelope handling, retry/backoff, result reshaping, and HTML cleaning | `lib/job-seeker/portals/freehire.ts` |
| `.agents/skills/freehire-search/url-reference.md` — the documented endpoint, parameters, and job shape | the request builder and wire types in the same file |
| `.claude/commands/apply.md` — the drafter → independent reviewer → revision loop, and its factual-grounding rule | the reviewer lane in the Job Seeker application pipeline |
| `.claude/commands/apply.md` §5d — ATS parseability and keyword-coverage verification, including the covered / synonym-only / missing (have it) / missing (gap) vocabulary | the ATS verification lane |
| `.claude/commands/rank.md` — triage banding, location and language vetoes, deadline urgency | the ranking lane |

Where SoftwareFactory already had a stronger implementation — deterministic
scoring with the weights enforced in the database, RLS-scoped ownership,
immutable document versions — that implementation was kept and the upstream
design merged into it rather than over it.

### MIT licence

```
MIT License

Copyright (c) 2026 Mads Lorentzen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`ai-job-search` is an independent open-source project. It is not affiliated with
Anthropic, and its author does not endorse this product.

---

## Upstream services these adapters read

An adapter reads a third party's service; the licence above covers the code, not
the data. Each entry states what is read and on what terms, because a hosted
product is a different posture from a personal machine and the difference is
decided here, once, rather than per call site.

| Service | Read | Terms |
|---|---|---|
| freehire.me | `GET /api/v1/agent/jobs/search`, `GET /api/v1/jobs/{slug}` | Public, unauthenticated reads of an open-source aggregator (backend: `strelov1/freehire`, MIT). Base URL is overridable via `SOFTWAREFACTORY_FREEHIRE_API_URL` for a self-hosted instance. Best-effort, no SLA — an outage degrades this source and is reported as unavailable, never as an empty result. |
| Greenhouse job boards | `GET /v1/boards/{token}/jobs` | Public, keyless postings API. |
| Lever | `GET /v0/postings/{site}` | Public, keyless postings API. |
| LinkedIn | — | **Not read.** The upstream repo's `linkedin-search` skill scrapes LinkedIn's guest endpoints and states it is for personal use only under LinkedIn's terms. That is a defensible posture for a tool on one person's machine and not one this product takes on its users' behalf, so no LinkedIn scraping adapter was ported. The LinkedIn entry in the import registry remains credential-gated with no fetch implementation, which is what makes it incapable of reading anything until a real API credential exists. |
