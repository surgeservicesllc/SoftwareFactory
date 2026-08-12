# Testing

Phase 1A requires evidence at multiple layers. A passing render or production build alone is not sufficient.

## Quality gates

Run the repository scripts from the final `package.json`:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Focused suites use these scripts:

```bash
npm run test:unit
npm run test:integration
npm run test:coverage
npm run test:e2e
npm run test:e2e:ui
```

Vitest, jsdom, Testing Library, and jest-dom provide unit/integration foundations. Playwright runs Chromium projects at representative desktop, tablet, and mobile viewports, with `@axe-core/playwright` available for automated accessibility checks. Inspect `package.json` and the test configuration if a script changes. CI runs the core install/lint/typecheck/Vitest/build gates and a separate Playwright browser/accessibility job, all without deployment permissions.

## Unit tests

Use unit tests for pure policy/risk decisions, validation, formatting, data transformations, reducers, and isolated interactive components. Include negative cases and boundary values.

## Integration tests

Use integration tests for trusted server boundaries, command persistence, audit-event coupling, repository file operations, connection metadata/redaction, and Supabase behavior. RLS evidence must include two tenants plus anonymous denial and must not use service-role access for the user-under-test.

## End-to-end tests

Cover the primary application shell and representative flows:

- navigate all required sections;
- distinguish **Demo Data** and **Not Connected**;
- submit a Bot Manager command and verify it remains queued when no worker exists;
- modify/save a repository Markdown file and exercise unsaved-change protection;
- inspect autonomous/risk controls and confirm destructive defaults are OFF; and
- verify loading, error, empty, keyboard, and focus behavior.

Exercise at least representative mobile, tablet, and desktop viewports. Avoid assertions based only on screenshots; include semantic roles, visible state, navigation, and overflow checks.

## Test data

- Use deterministic, fictional organizations/projects/providers.
- Never copy production records or credentials into fixtures or snapshots.
- Label seeded presentation records **Demo Data**.
- Isolate database state per test and clean only known disposable resources.

## Final evidence

Record exact commands, commit/tree, date, result, and relevant coverage in `AI/QUALITY_SCORECARD.md` and `AI/CURRENT_STATE.md`. A skipped, flaky, stale, or narrower-than-required test is not passing evidence for the omitted scope.
