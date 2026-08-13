# Marketing site build — working plan

Last updated: 2026-08-13 (checkpoint 2: site built, tested, documented; all gates green)
Branch: `claude/universal-bot-interface-0caeda`
Owner of this file: whichever agent is currently working. **Update it before your session ends.**

## Goal

Build the marketing site from the approved mockups (Platform, Features, Pricing, Resources,
About), move the existing console homepage to **Solutions** in the main navigation, and wire
every page to Supabase. No page may ship with hard-coded content that pretends to be live data.

## Ground rules (from `AGENTS.md` — read it before editing)

- Truthful labels only. **Demo Data** for seeded values, **Not Connected** for absent providers.
- Row Level Security stays on for every exposed table. Marketing content is world-readable by
  design; that is an explicit `anon` SELECT policy, never a disabled RLS.
- No credential, key, or secret in browser code, logs, fixtures, or database rows.
- Marketing tables are content, not control plane. They must not grant any new write path to
  `anon`, and they must not touch the tenant tables.
- Run `npm run lint && npm run typecheck && npm test && npm run build` before every commit.
- Playwright needs `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium` in this sandbox.

## Architecture decision

Two Next.js route groups so the two shells never fight:

```
app/(marketing)/   -> MarketingShell: top nav + footer, public, indexable
app/(console)/     -> AppShell: sidebar, authenticated control plane
```

Marketing routes: `/` `/platform` `/features` `/solutions` `/pricing` `/resources` `/about`
Console routes keep their current paths (`/projects`, `/bot-manager`, `/files`, ...).

`/solutions` carries the former console homepage content, per the goal.

## Data model (migration `022_marketing_content`)

All tables live in `public`, RLS + FORCE RLS on, `anon`/`authenticated` get **SELECT only**,
writes are owner-gated through audited SECURITY DEFINER functions (same pattern as the bot
fabric in migration `021`).

| Table | Purpose |
| --- | --- |
| `marketing_pages` | slug, title, eyebrow, headline, subheadline, hero copy, SEO fields |
| `marketing_sections` | ordered content blocks per page (kind + JSON payload) |
| `marketing_stats` | hero stat rows (value, label, icon, page) |
| `marketing_features` | feature/capability cards (page, group, icon, title, body) |
| `marketing_pricing_plans` | name, price, cadence, blurb, cta, highlight flag, sort |
| `marketing_plan_features` | per-plan feature list + comparison-matrix values |
| `marketing_resources` | kind, title, summary, media, read time, level, url, featured |
| `marketing_resource_topics` | topic name, icon, resource count, sort |
| `marketing_team_members` | name, role, bio, headshot, linkedin, twitter, sort |
| `marketing_testimonials` | quote, author, title, avatar, page |
| `marketing_logos` | customer logo wall (name, wordmark, sort) |
| `newsletter_subscribers` | email, source page, confirmed_at, created_at |

`newsletter_subscribers` is the one table that accepts public input. It takes inserts **only**
through `subscribe_to_newsletter(email, source)` — a SECURITY DEFINER function that validates
the address, is idempotent per email, and returns no row data. `anon` gets no SELECT on it.

## Status

### Done
- [x] Read `AGENTS.md`, `AI/*`, `policies/*`; confirmed the truthful-language contract.
- [x] Bot fabric shipped on this branch (PR #2) — unrelated to this goal, already green locally.
- [x] `todo.md` created.
- [x] Migration `20260813000100_marketing_content` — 11 tables, RLS + FORCE RLS, `anon` SELECT on
      published rows only, seed matching the mockups, and the `subscribe_to_newsletter` RPC.
- [x] `lib/marketing/` — `types.ts` (shapes + price/matrix helpers), `content.ts` (seed mirror),
      `queries.ts` (never throws; falls back and reports `source`).
- [x] `components/marketing/` — `site-header`, `site-footer`, `primitives`, `icon` registry,
      `hero-visual` (CSS/SVG, no raster assets), `pricing-plans`, `resource-library`,
      `newsletter-form`.
- [x] Route groups: `app/(console)/` + `app/(marketing)/`; console nav "Dashboard" → `/solutions`;
      each shell owns exactly one skip link.
- [x] `/platform`, `/features`, `/solutions`, `/pricing`, `/resources`, `/about`, `/` all built.
- [x] `POST /api/newsletter` → `subscribe_to_newsletter`, same-origin, bounded, uniform response.
- [x] Per-page `generateMetadata` from content; marketing group `index: true`, console `noindex`.
- [x] Playwright: 81/81 across desktop/tablet/mobile — render, real horizontal-scroll check,
      nav, pricing toggle, resource search, and axe per page.
- [x] Fixed 5 real defects the new axe sweep surfaced: 4 contrast tokens below 4.5:1
      (`#6d7a8c`, `#4a5768`, `#657283`, `#536070`), an invalid `<dl>` structure in `StatRow`,
      unclipped hero glows causing mobile overflow, a grid item stretched by the comparison
      table, and a scroll region with no keyboard access.

- [x] Unit tests: `marketing-types`, `marketing-content`, `marketing-queries` (mocked Supabase,
      covering fallback, wholesale fallback on a missing page row, per-table degradation, and
      testimonial scoping). `lib/marketing` sits at 97.61% statement coverage.
- [x] Integration contract test incl. **seed parity** — the migration seed and
      `lib/marketing/content.ts` cannot drift on page slugs, plan prices, highlight, or matrix rows.
- [x] `sitemap.ts` (marketing routes only) and `robots.ts` (console paths disallowed).
- [x] Root metadata retitled to the marketing brand; console group carries its own title template.
- [x] `AI/CURRENT_STATE.md`, `AI/BACKLOG.md`, `AI/HANDOFF.md`, `AI/QUALITY_SCORECARD.md`,
      `AI/ARCHITECTURE.md`, `AI/DECISIONS.md` (ADR-023/024/025) and `README.md` updated.

### Remaining
- [ ] **Owner approval to host migration `20260813000100`.** Until then every marketing page
      renders the seeded fallback and shows a **Demo Data** notice. This is the only thing standing
      between the current build and "100% wired to Supabase" — the query layer, RLS, policies and
      the subscribe RPC are all written and tested; they simply are not applied to the hosted
      project yet, and applying them is an owner-gated protected action under `AGENTS.md`.
- [ ] Verify against a real anon session once hosted: published-only reads, no browser write path,
      and that `newsletter_subscribers` is unreadable.
- [ ] Replace placeholder leadership headshots and third-party wordmarks with licensed assets.
- [ ] Per-page OG images (`opengraph-image.tsx` per route).
- [ ] Optional: an authenticated editor UI for marketing content (owner/admin only, audited),
      so copy can be changed without SQL.

## Open questions for the owner

1. **Hosted migrations.** `011`–`021` are still unhosted pending owner approval; `022` will join
   that queue. Marketing pages therefore render from the seeded fallback until it is applied.
   Confirm whether `022` may be promoted ahead of the tenant chain, since it touches no tenant data.
2. **`/features` and `/` have no mockup.** Being built in the same design language as the five
   supplied screens. Flag if a specific layout is wanted.
3. **Headshots and logos.** The mockups show real photos and third-party wordmarks. Shipping
   with neutral placeholders and `marketing_team_members.headshot_url` pointing at them; supply
   licensed assets to swap in.

## Notes for the next agent

- The mockups are the source of truth for layout, spacing, and colour. Palette: near-black
  `#080b10` ground, `#0d1118` panels, violet→blue gradient (`#7c5cff` → `#4d8dff`) for accents
  and headline spans, one accent per card row.
- The console palette (lime `#c6f135`) is deliberately **not** reused on marketing pages. Keep
  the two visual systems separate; only shared primitives cross over.
- Every marketing page is a Server Component. Data fetching goes through `lib/marketing/queries.ts`,
  which must never throw — it falls back to seeded content and marks the response `source: "seed"`
  so the UI can label it honestly.
