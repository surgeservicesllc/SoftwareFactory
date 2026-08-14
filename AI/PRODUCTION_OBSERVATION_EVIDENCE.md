# First real production observation — Phase 1E

Recorded: 2026-08-13. Observed by `probeHttpTarget` (`lib/operations/probe.ts`), the shipped
Phase 1E monitoring adapter, called through its normal code path.

This is the first time any Phase 1E code has observed a real production system. Everything prior
was behavioral evidence against a migrated schema. Two operational findings came out of it that
no amount of local testing would have surfaced.

## Observation

Target: `https://www.theagoras.com` · expected status 200 · degraded threshold 2000 ms · timeout 10 s

| Route | Outcome | Status | Latency |
| --- | --- | --- | --- |
| `/` | **pass** | 200 | 933 ms |
| `/platform` | **pass** | 200 | 706 ms |
| `/pricing` | **pass** | 200 | 190 ms |
| `/about` | **pass** | 200 | 336 ms |

The adapter classified every route correctly against real network behavior: all four served the
expected status inside the degraded threshold. The target passed `validateMonitorTarget` — public
HTTPS, standard port, no credentials, not a private or metadata address.

These observations are **not stored**. Migrations `028`/`029`/`030` are unhosted, so there is no
`monitor_observations` row, no health snapshot, and no incident. This is evidence that the adapter
works against real production, not evidence that monitoring is running.

## Finding 1 — the recorded production deployment cannot be observed externally

Both Vercel URLs return `302` to `https://vercel.com/sso-api` for **every** route, including public
marketing pages:

| Host | Result |
| --- | --- |
| `softwarefactory-7kfx3u1ey-surgeservices-projects.vercel.app` | `302` → `vercel.com/sso-api`, header `x-robots-tag: noindex` |
| `softwarefactory-surgeservices-projects.vercel.app` | `302` → `vercel.com/sso-api` |

That is Vercel Deployment Protection (SSO). Its consequences:

- **No external monitor can observe those URLs** — not this one, not any third-party uptime
  service. A monitor pointed at the deployment URL recorded throughout `/AI` as "current READY
  production" would fail every check and open a permanent incident caused by the protection layer
  rather than by the application.
- A monitor configured with the default `expected_status_code = 200` against such a target reports
  `fail`. The probe uses `redirect: "manual"` deliberately, so it reports the `302` rather than
  silently following it into an authentication page and calling that success — which is the
  correct behavior, and the reason the finding is visible at all.

**Owner action:** decide whether production should carry Deployment Protection. If it stays,
monitoring must target a protection-bypassed path or the custom domain; a protection-bypass token
would be a server-only secret and a separate owner decision.

## Finding 2 — `theagoras.com` is the only public path to the application

`AI/BACKLOG.md` carries an open owner-review item: *"Review unexpected `theagoras.com` Vercel
aliases, verify ownership and routing intent, and remove or retain them only through an explicitly
approved protected routing change."*

The evidence now answers the routing-intent half of that question:

| Host | Result |
| --- | --- |
| `theagoras.com` | `308` → `https://www.theagoras.com` |
| `www.theagoras.com` | `200`, serving this application |

Page titles confirm it is this codebase — "AI Software Factory", "Pricing — AI Software Factory",
"Platform — AI Software Factory" — the marketing pages built in the marketing workstream.

So `theagoras.com` is not a stray alias. With Deployment Protection on both `vercel.app` hosts, it
is **the only way any visitor or search engine can reach this application at all**. Removing it, as
the open review item contemplates, would take the entire public site offline.

That also means the marketing site's indexability is currently split: it ships `sitemap.ts`,
`robots.ts` and `index: true` metadata, but the `vercel.app` hosts serve `noindex` and redirect to
SSO. Only the custom domain is reachable and indexable.

**Owner action:** retain the aliases, or move production behind a different public host first. The
review item should not be closed by removal without replacing the public route.

## Reproducing this

The probe is the shipped adapter and takes no credentials:

```ts
import { probeHttpTarget } from "@/lib/operations/probe";

await probeHttpTarget({
  targetUrl: "https://www.theagoras.com/pricing",
  expectedStatusCode: 200,
  degradedLatencyMs: 2000,
  timeoutMs: 10_000,
});
```

Storing what it observes needs hosted migrations `028`/`029`/`030` and an owner-authorized monitor
row. Until then the adapter can be exercised but the pipeline behind it cannot run.
