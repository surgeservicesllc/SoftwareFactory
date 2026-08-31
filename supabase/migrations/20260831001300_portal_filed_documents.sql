-- ---------------------------------------------------------------------------
-- Increment 26 — the portal downloads a filed copy (ADR-222).
--
-- The customer portal has carried two Not Connected notices citing object
-- storage since the day it shipped, and both sentences went stale the
-- moment ADR-216 landed: a filed service document holds its FROZEN BYTES in
-- a column under RLS, so there has been a copy to hand over for eleven
-- increments while the portal kept saying there was not. The backlog called
-- this out; this file closes it.
--
-- What stays true: `crm_documents` (increment 8) is METADATA plus a storage
-- path and holds no bytes, so that list remains listed-not-opened, and the
-- corrected notice says which is which instead of blaming storage for both.
--
-- THE BOUNDARY, same as every portal read: the customer reaches nothing
-- directly. A SECURITY DEFINER projection resolves auth.uid() to exactly
-- one account through crm_portal_account_for and hands back only that
-- account's rows. The staff tables stay under their forced RLS; no policy
-- is widened.
--
-- The LIST and the BODY are separate functions on purpose. A list of two
-- hundred documents must not carry two hundred megabytes; the body comes
-- one document at a time, when somebody actually downloads it.
-- ---------------------------------------------------------------------------

create or replace function public.crm_portal_filed_documents()
returns table (
  id uuid,
  kind public.crm_service_document_kind,
  title text,
  content_type text,
  byte_size integer,
  filed_at timestamptz,
  -- The customer may be holding a printed copy of the old one, so a
  -- superseded filing stays listed and says so rather than vanishing.
  superseded boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select d.id, d.kind, d.title, d.content_type, d.byte_size, d.filed_at,
         exists (
           select 1 from public.crm_service_documents later
            where later.organization_id = d.organization_id
              and later.supersedes_id = d.id
         )
    from public.crm_portal_account_for(auth.uid()) me
    join public.crm_service_documents d on d.account_id = me.account_id
   order by d.filed_at desc
   limit 200;
$$;

create or replace function public.crm_portal_filed_document_body(p_document uuid)
returns table (
  title text,
  content_type text,
  body text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  -- One document, and only if it belongs to the caller's own account.
  -- Somebody else's id returns nothing — the same answer as "no such
  -- document", on purpose.
  select d.title, d.content_type, d.body
    from public.crm_portal_account_for(auth.uid()) me
    join public.crm_service_documents d on d.account_id = me.account_id
   where d.id = p_document;
$$;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'crm_portal_filed_documents()',
    'crm_portal_filed_document_body(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, service_role', v_function);
    execute format('grant execute on function public.%s to authenticated', v_function);
  end loop;
end;
$$;
