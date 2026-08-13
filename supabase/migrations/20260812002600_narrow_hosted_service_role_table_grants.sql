-- Supabase-managed default privileges can grant service_role broader access
-- than the explicit provider-ingress boundary declared by migration 004.
-- Reconcile every current public table, then restore only the four tables and
-- three operations required by the GitHub provider adapter.

revoke all privileges on all tables in schema public
  from service_role;

grant select, insert, update on table
  public.github_installations,
  public.github_repositories,
  public.github_webhook_deliveries,
  public.github_change_requests
  to service_role;
