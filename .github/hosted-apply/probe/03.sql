select conname,
       (strpos(pg_get_constraintdef(oid), 'SUPABASE_SECRET_KEY') > 0
        and strpos(pg_get_constraintdef(oid), 'SUPABASE_ACCESS_TOKEN') > 0
        and strpos(pg_get_constraintdef(oid), 'VERCEL_OIDC_TOKEN') > 0
        and strpos(pg_get_constraintdef(oid), 'POSTGRES_URL') > 0
        and strpos(pg_get_constraintdef(oid), 'GITHUB_CLIENT_ID') > 0) as covers_all_five_added
  from pg_constraint
 where conname = 'bots_credential_ref_not_privileged';
