-- Postflight for scope=knowledge-base (20260902000800): the articles table
-- is fenced and forced with the slug unique per workspace; the member
-- search is INVOKER and STABLE; the customer read and the visit calendar
-- are DEFINER and STABLE; every function is granted to authenticated only.
do $$
declare
  v_rls boolean;
  v_forced boolean;
  v_fn text;
  v_secdef boolean;
  v_volatile char;
begin
  select c.relrowsecurity, c.relforcerowsecurity into v_rls, v_forced
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'crm_kb_articles';
  if v_rls is null then
    raise exception 'postflight: public.crm_kb_articles is missing';
  end if;
  if not v_rls or not v_forced then
    raise exception 'postflight: crm_kb_articles must have RLS enabled and forced';
  end if;
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'crm_kb_articles_org_slug_key'
  ) then
    raise exception 'postflight: the article slug is not unique per workspace';
  end if;
  foreach v_fn in array array['crm_kb_search', 'crm_kb_terms'] loop
    select p.prosecdef, p.provolatile into v_secdef, v_volatile
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_secdef is null then
      raise exception 'postflight: public.% is missing', v_fn;
    end if;
    if v_secdef or v_volatile = 'v' then
      raise exception 'postflight: public.% must be SECURITY INVOKER and not VOLATILE', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['crm_portal_articles', 'crm_portal_visit_calendar'] loop
    select p.prosecdef, p.provolatile into v_secdef, v_volatile
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_secdef is null then
      raise exception 'postflight: public.% is missing', v_fn;
    end if;
    if not v_secdef or v_volatile <> 's' then
      raise exception 'postflight: public.% must be SECURITY DEFINER and STABLE', v_fn;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.crm_kb_search(uuid, text, public.crm_kb_audience, boolean)', 'execute')
     or has_function_privilege('service_role', 'public.crm_kb_search(uuid, text, public.crm_kb_audience, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.crm_kb_search(uuid, text, public.crm_kb_audience, boolean)', 'execute')
     or has_function_privilege('anon', 'public.crm_portal_articles(text)', 'execute')
     or has_function_privilege('service_role', 'public.crm_portal_articles(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.crm_portal_articles(text)', 'execute')
     or has_function_privilege('anon', 'public.crm_portal_visit_calendar(uuid)', 'execute')
     or has_function_privilege('service_role', 'public.crm_portal_visit_calendar(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.crm_portal_visit_calendar(uuid)', 'execute') then
    raise exception 'postflight: knowledge base function grants are wrong';
  end if;
  raise notice 'postflight knowledge-base: articles fenced with slug unique per workspace; search invoker; customer read and visit calendar definer, stable, authenticated-only';
end $$;
