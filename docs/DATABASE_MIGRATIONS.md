# Database migrations

Supabase migrations live in `supabase/migrations/` and are the authoritative schema history. Once a migration is shared, correct it with a new migration instead of rewriting history.

## Creating a migration

```bash
npx supabase migration new descriptive_name
```

Each migration should be cohesive and include, where applicable:

- UUID primary keys and non-null timestamps;
- foreign keys with intentional delete/update behavior;
- status enums or checked values;
- organization/user ownership columns;
- indexes supporting tenant and common relationship/query paths;
- RLS enablement and explicit policies; and
- grants kept to least privilege.

Do not store plaintext provider secrets or authentication tokens in connection tables.

## Local verification

Apply the complete chain to a disposable local database:

```bash
npx supabase db reset
```

Then verify:

1. every required table, enum/constraint, index, and foreign key exists;
2. every exposed table reports `rowsecurity = true`;
3. authenticated users can access only rows authorized through their organization/membership;
4. a second tenant and anonymous session are denied;
5. expected mutations succeed and create required activity events; and
6. service-role credentials were not used to “prove” tenant isolation.

Useful inspection queries:

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

## Change safety

- Prefer expand/migrate/contract changes that remain backward compatible during rollout.
- An additive migration is generally YELLOW and needs enhanced validation.
- Destructive/irreversible production data or security/RLS changes are RED and require explicit owner approval.
- Take and verify recovery measures before an approved destructive production change.
- Do not write a down migration that creates more risk than a forward fix. Document the actual recovery plan.

## Promotion

1. Review SQL and risk classification.
2. Reset and test locally from an empty database.
3. Apply to preview/staging and run integration/RLS tests.
4. Confirm application compatibility and observation plan.
5. Obtain any required protected-resource approval.
6. Apply using least-privilege protected credentials.
7. Verify schema, RLS, application health, and audit evidence.

Never run a production migration from a pull-request CI job or an untrusted fork.
