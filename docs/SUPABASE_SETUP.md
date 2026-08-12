# Supabase setup

Runtime status in Phase 1A: **Not Connected** until valid project configuration and an observed health/read/write path are verified.

## Choose an environment

Use a local Supabase stack for schema/RLS development. Use distinct hosted projects for preview/staging and production when live environments are introduced. Do not point routine local tests at production.

## Local workflow

Prerequisites: Docker and a Supabase CLI available through your approved installation method.

```bash
npx supabase start
npx supabase db reset
```

`db reset` is destructive to the local database only. Confirm the CLI is linked to the intended local environment before running database commands.

The CLI output provides a local project URL and publishable/anonymous key. Put them only in `.env.local` using the names in [Environment variables](ENVIRONMENT_VARIABLES.md). Prefer `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; the client accepts `NEXT_PUBLIC_SUPABASE_ANON_KEY` as a legacy fallback. Phase 1A request handlers do not require a service-role key.

## Hosted project workflow

1. Create/select the correct Supabase organization and environment-specific project.
2. Record ownership and recovery contacts outside the repository.
3. Configure the browser-public URL and publishable key in the matching Vercel environment.
4. Do not configure a service-role key for Phase 1A request handlers. They use user JWTs, RLS, and reviewed `SECURITY DEFINER` RPCs. A future service-role use requires a specific reviewed server operation and independent tenant authorization.
5. Apply migrations using the protected process in [Database migrations](DATABASE_MIGRATIONS.md).
6. Verify authentication, organization membership, RLS allow/deny behavior, audit emission, and connection health.
7. Only then update status from **Not Connected**.

## RLS expectations

- Enable RLS in the same migration that creates every exposed table.
- Define explicit policies; enabling RLS without required policies can make the application unusable but is safer than disabling it.
- Scope rows through organization membership and/or user ownership.
- Cover `SELECT`, `INSERT`, `UPDATE`, and `DELETE` separately as needed; do not assume a read policy authorizes writes.
- Test at least two tenants and anonymous access to prove denial as well as allowed behavior.
- Never use the service-role client in a test that claims to prove RLS; it bypasses RLS.

## Connection records

Supabase connection rows contain non-secret metadata such as project reference, display name, status, and an opaque secret reference. They do not contain service-role keys, passwords, or access tokens.

## Troubleshooting

- **Permission denied:** inspect the authenticated user, organization membership, row ownership, and policy predicates. Do not disable RLS.
- **Schema mismatch:** reset the local database and apply the full migration chain; do not edit an already-shared migration.
- **Build lacks environment values:** demo/disconnected rendering should remain safe; runtime-dependent actions stay unavailable.
