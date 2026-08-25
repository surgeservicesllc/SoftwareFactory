# Vendored source

Third-party code kept **verbatim**, so the ports elsewhere in this repository
can be audited against what they were adapted from.

Nothing here is built, typechecked, linted, tested, imported or deployed. The
root `tsconfig.json` excludes `vendor`, `eslint.config.mjs` ignores it, and
vitest only collects from `tests/unit` and `tests/integration`. A file here is
evidence, not a dependency.

## `ai-job-search`

- Upstream: <https://github.com/MadsLorentzen/ai-job-search>
- Commit: `d82df2fe5182c172070eeaa4259af6f21cfda64f` (2026-08-25)
- Licence: MIT, © 2026 Mads Lorentzen — see `ai-job-search/LICENSE`, kept intact
- Copied: 214 files, byte-for-byte, no edits

### What it is, and what it is not

A local-first Claude Code framework: markdown skills, slash commands, Python
helpers, LaTeX cover-letter templates, and six Bun/TypeScript CLI scrapers for
Danish job boards. **It contains no web application** — no React, no Next.js,
no page. A web surface built from it is built, not copied.

### Why it sits under `vendor/` rather than at the repository root

Eight of its top-level entries collide with this repository's own: `.claude`,
`.github`, `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `SECURITY.md`
and `tests`. Copied to the root, its CI workflows would join this repository's
own, its agent instructions would overwrite these, and its pytest files would
land in a directory this repository's tooling reads. Nested, every file is
preserved and none of that happens: GitHub reads workflows only from the root
`.github`, and the tooling exclusions above cover the rest.

### What was already adapted from it

`lib/job-seeker/board-search/` carries four of the six scrapers — Jobnet,
Jobindex, Jobdanmark and Freehire — rewritten against this repository's fetch
and error conventions, each crediting the upstream helper it came from.

Two were left out deliberately, and the reasons are recorded in
`lib/job-seeker/board-search/registry.ts`:

- **LinkedIn** — its terms prohibit automated collection. The MIT licence
  settles whether the code may be copied, not whether the service may be read
  this way; those are different permissions from different parties.
- **Jobbank** — the upstream helper says Cloudflare bot protection blocks it
  and to skip the portal. A board that always fails teaches people to ignore
  the failure notice, which is the notice that has to work when a board that
  usually answers stops.

Both remain here in full under `ai-job-search/.agents/skills/`, so revisiting
either decision starts from the real source rather than a memory of it.
