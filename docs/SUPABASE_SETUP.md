# Supabase setup

Production project: `qpuofpmagrmyamahqwxw` (`softwarefactory`). Provider health was verified as `ACTIVE_HEALTHY` on 2026-08-12.

Hosted migrations `001`, `002`, `003`, `004`, `005`, `007`, `008`, `009`, and `010` have been applied, and the hosted ledger includes `010_phase1d_observation_controls`. Migration `010` was applied transactionally after `unsafe_project_rows=0`; hosted checks confirmed kill-switch default true, both constraints validated, zero switch-off organizations, zero unsafe projects, authenticated controls-RPC execute, and anonymous execute denied. The last successful linked lint through `009` reported no schema errors (`[]`); a post-`010` CLI attempt was blocked by account `403`, so no post-`010` lint result is claimed. Authenticated cross-tenant, broader privileged-RPC, and real application-session verification remain pending.

Local forward migrations `011_harden_direct_mutation_boundaries`, `012_github_change_audit`, and `013_reconcile_github_repository_grants` are not in that hosted ledger. Because they alter authorization/grants, audit behavior, and a privileged webhook workflow, do not apply them to `qpuofpmagrmyamahqwxw` without exact current owner approval. After application, verify the ledger, linked lint, direct table grants, function grants/search paths, caller/tenant checks, immutable activity evidence, repository-grant reconciliation, and application health before promotion.

## Hosted Auth configuration

The linked Auth configuration uses:

- site URL: `https://softwarefactory-tan.vercel.app`;
- redirect URLs:
  - `https://softwarefactory-tan.vercel.app/auth/callback`
  - `http://localhost:3000/auth/callback`
  - `http://127.0.0.1:3000/auth/callback`;
- email sign-up enabled with confirmation;
- anonymous sign-in disabled;
- minimum password length 12;
- JWT expiry 3600 seconds;
- secure password change enabled;
- email frequency limit one minute;
- eight-digit OTPs; and
- TOTP enrollment/verification enabled.

Do not add wildcard redirect URLs. Local and production callbacks must remain exact.

## Application Auth flow

The repository implements email/password sign-up/sign-in, existing-user magic link, sign-out, callback exchange, onboarding, organization creation, membership resolution, and active-organization selection. Magic-link submission uses `shouldCreateUser: false`; a new user must complete sign-up/confirmation first.

A real authenticated production session and end-to-end GitHub installation have not yet been verified. Do not treat Auth configuration or a healthy project as proof of that journey.

## Local workflow

Prerequisites: Docker and an approved Supabase CLI installation.

```bash
npx supabase start
npx supabase db reset
```

`db reset` is destructive to the local disposable database. Never run it against the hosted project. Put local public URL/key values only in `.env.local`.

## Hosted migration workflow

1. Confirm CLI identity and exact project ref before every linked command.
2. Inspect `supabase migration list --linked` and ensure no unexpected migration appears.
3. Review the SQL and risk classification.
4. Run a dry run when supported.
5. Apply only the additive migration chain.
6. Run `supabase db lint --linked` and resolve every real finding with a new migration.
7. Verify table/RPC/RLS/FORCE RLS state and application compatibility.
8. Exercise allowed access plus cross-tenant and anonymous denial using user sessions, not service-role access.

Current stop condition: do not call the hosted data boundary fully verified until authenticated cross-tenant, anonymous-denial, privileged-RPC, audit, and real application-session checks pass. Migration history and linked schema lint are green.

## RLS expectations

- Every exposed table has RLS and FORCE RLS.
- Policies scope access through organization membership and resource ownership.
- `SELECT`, `INSERT`, `UPDATE`, and `DELETE` are considered separately.
- Owner/admin-only operations are enforced server-side and/or in reviewed security-definer functions.
- Security-definer functions pin `search_path`, validate `auth.uid()`, tenant membership, and exact resources, and expose only deliberate grants.
- Service-role tests do not prove RLS because service role bypasses it.

## Secret handling

The Supabase public URL and publishable key may reach the browser. The service-role key and database/CLI credentials may not. GitHub connection rows contain provider metadata and an opaque secret reference—not App keys, OAuth/installation tokens, webhook secrets, or user passwords.

## Troubleshooting

- **Permission denied:** inspect user session, active organization, membership, resource ownership, and policy predicates. Never disable RLS.
- **Migration history differs:** stop and verify the exact project/profile. Do not repair, delete, or renumber production migrations casually.
- **Lint ambiguity:** qualify table aliases/columns in a new additive migration, apply it, and rerun linked lint.
- **Auth redirect failure:** compare the exact site/redirect URLs above and the environment callback origin.
- **Build lacks configuration:** fail to **Not Connected**; never fall back to a privileged browser key.
