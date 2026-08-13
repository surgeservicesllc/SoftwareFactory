# Supabase setup

Production project: `qpuofpmagrmyamahqwxw` (`softwarefactory`). The Supabase CLI is authorized as `surgeservicesllc@gmail.com` and linked to this exact project. Provider health was verified as `ACTIVE_HEALTHY` on 2026-08-12.

The hosted ledger is current through migration `026`; local and remote history match. Linked dry run is up to date and lint is clean. Catalog checks report 23/23 public tables with RLS and FORCE RLS, 32 policies, zero policyless tables, 22 secret guards, and false tested raw authenticated/browser grants.

Hosted migration `026` remediates the Supabase-managed default-ACL drift found after `025`. The exact post-apply ACL matrix has zero mismatches: `service_role` has only SELECT/INSERT/UPDATE on `github_installations`, `github_repositories`, `github_webhook_deliveries`, and `github_change_requests`, and no table privileges on the other 19 public tables.

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

`surgeservicesllc@gmail.com` is confirmed and authenticated. SoftwareFactory organization/workspace onboarding and owner membership succeeded. GitHub connection `d17c63a9-d995-481e-98ce-b737efb32ce5` and project `b1f23696-437e-4d89-b55f-d7a949980e8f` are persisted for the live owner repository path. Only this actual user/email is authorized, so a live second-tenant caller matrix remains unverified; local behavioral tests are supporting evidence only.

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

Current stop condition: the exact `service_role` table boundary is verified, but do not call the complete hosted tenant/provider boundary verified until authenticated cross-tenant, anonymous-denial, privileged-RPC, audit, provider-ingress, and real application-session checks pass.

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
