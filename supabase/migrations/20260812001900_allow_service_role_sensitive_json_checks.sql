-- Provider ingress writes metadata directly through the explicitly granted
-- service-role table boundary. PostgreSQL evaluates CHECK expressions as the
-- invoking role, so that role needs EXECUTE on the public SECURITY DEFINER
-- wrapper used by the JSON constraints. Keep its recursive implementation and
-- the standalone text classifier inaccessible.

grant execute on function public.jsonb_has_sensitive_keys(jsonb)
  to service_role;

revoke all on function public.jsonb_has_sensitive_keys_internal(jsonb, integer)
  from service_role;
revoke all on function public.text_has_likely_secret(text)
  from service_role;

comment on function public.jsonb_has_sensitive_keys(jsonb) is
  'SECURITY DEFINER sensitive-JSON classifier used by table CHECK constraints. Authenticated callers and the service-role provider-ingress boundary may execute only this wrapper; recursive internals remain inaccessible.';
