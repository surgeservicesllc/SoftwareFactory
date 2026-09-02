-- ---------------------------------------------------------------------------
-- Increment 33 — what people look up (ADR-237).
--
-- HubSpot's knowledge base is gated behind Service Hub; PestPac's help is a
-- ticket. The answer a customer wants at 06:00 — "what do I do before the
-- treatment?" — is the same answer the new hire wants, and it should be
-- written once, read by both, and found by the words in it.
--
-- This file adds one table and three functions:
--
--   crm_kb_articles               an article a member writes, with an
--                                 audience (staff or customer) and a
--                                 published moment; unpublished is a draft
--   crm_kb_search()               the member's search: every article of the
--                                 workspace, scored by the words that hit,
--                                 with the score and the excerpt printed so
--                                 the ordering can be checked
--   crm_portal_articles()         the customer's read: PUBLISHED, CUSTOMER-
--                                 audience articles of their own workspace
--                                 and nothing else, through the same scorer
--   crm_portal_visit_calendar()   one booked visit of the caller's account,
--                                 with the moments and the address a
--                                 calendar entry needs
--
-- The search is deliberately not a model. A word in the title counts three;
-- a word in the body counts one; a word matches whole, with or without a
-- plural s; a word shorter than three letters or in the small stop list
-- counts nothing. The rank is returned, so "why is this first?" has an
-- answer that is arithmetic.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_kb_audience as enum ('staff', 'customer');
exception when duplicate_object then null; end $$;

create table if not exists public.crm_kb_articles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 2 and 80),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  category text check (category is null or char_length(btrim(category)) between 1 and 60),
  audience public.crm_kb_audience not null default 'staff',
  -- Null is a draft. A customer never sees a draft, whatever its audience.
  published_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_kb_articles_title_no_secret check (not public.text_has_likely_secret(title)),
  constraint crm_kb_articles_body_no_secret check (not public.text_has_likely_secret(body)),
  constraint crm_kb_articles_category_no_secret check (not public.text_has_likely_secret(category))
);

create unique index if not exists crm_kb_articles_org_slug_key
  on public.crm_kb_articles (organization_id, slug);
create unique index if not exists crm_kb_articles_org_id_key
  on public.crm_kb_articles (organization_id, id);
create index if not exists crm_kb_articles_org_audience_published_idx
  on public.crm_kb_articles (organization_id, audience, published_at desc);

alter table public.crm_kb_articles enable row level security;
alter table public.crm_kb_articles force row level security;

drop policy if exists crm_kb_articles_select_member on public.crm_kb_articles;
create policy crm_kb_articles_select_member on public.crm_kb_articles
  for select to authenticated using (public.is_organization_member(organization_id));
drop policy if exists crm_kb_articles_insert_member on public.crm_kb_articles;
create policy crm_kb_articles_insert_member on public.crm_kb_articles
  for insert to authenticated with check (public.is_organization_member(organization_id));
drop policy if exists crm_kb_articles_update_member on public.crm_kb_articles;
create policy crm_kb_articles_update_member on public.crm_kb_articles
  for update to authenticated
  using (public.is_organization_member(organization_id))
  with check (public.is_organization_member(organization_id));
drop policy if exists crm_kb_articles_delete_member on public.crm_kb_articles;
create policy crm_kb_articles_delete_member on public.crm_kb_articles
  for delete to authenticated using (public.is_organization_member(organization_id));

revoke all on public.crm_kb_articles from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.crm_kb_articles to authenticated;

drop trigger if exists crm_kb_articles_set_updated_at on public.crm_kb_articles;
create trigger crm_kb_articles_set_updated_at
  before update on public.crm_kb_articles
  for each row execute function public.set_updated_at();

-- The words of a question that carry meaning: lower-cased, split on
-- anything that is not a letter or digit, a plural s dropped (so "ants"
-- finds "ant" and "stations" finds "station"), at least three characters,
-- and not in the stop list. Returned as a set so the scorer can count hits.
create or replace function public.crm_kb_terms(p_query text)
returns setof text
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select distinct term
    from (
      select case when char_length(raw) >= 4 and raw like '%s' then left(raw, -1) else raw end as term
        from regexp_split_to_table(lower(coalesce(p_query, '')), '[^a-z0-9]+') raw
    ) words
   where char_length(term) >= 3
     and term not in (
       'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her', 'was',
       'one', 'our', 'out', 'has', 'have', 'had', 'how', 'what', 'when', 'where', 'which',
       'who', 'why', 'with', 'this', 'that', 'these', 'those', 'from', 'into', 'about',
       'does', 'did', 'tell', 'customer', 'should', 'would', 'could', 'will',
       'your', 'they', 'them', 'their', 'there', 'then', 'than', 'also', 'just', 'like',
       'get', 'got', 'say', 'said', 'know', 'need', 'want', 'please', 'help', 'article',
       'knowledge', 'base', 'policy', 'handle', 'deal'
     );
$$;

revoke all on function public.crm_kb_terms(text) from public, anon, service_role;
grant execute on function public.crm_kb_terms(text) to authenticated;

-- The member's search, as the caller (RLS decides what is visible). With no
-- query every article is returned at rank 0, newest first. The excerpt is
-- the first 200 characters of the body around the first term that hit, or
-- the opening of the body when nothing hit.
create or replace function public.crm_kb_search(
  p_organization uuid,
  p_query text default null,
  p_audience public.crm_kb_audience default null,
  p_published_only boolean default false
)
returns table (
  id uuid,
  slug text,
  title text,
  category text,
  audience public.crm_kb_audience,
  published_at timestamptz,
  updated_at timestamptz,
  rank integer,
  title_hits integer,
  body_hits integer,
  excerpt text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with terms as (select public.crm_kb_terms(p_query) as term),
  scored as (
    select a.id, a.slug, a.title, a.category, a.audience, a.published_at, a.updated_at, a.body,
           (select count(*) from terms t where lower(a.title) ~ ('\m' || t.term || '(?:e?s)?\M'))::integer as title_hits,
           (select count(*) from terms t where lower(a.body) ~ ('\m' || t.term || '(?:e?s)?\M'))::integer as body_hits,
           (select min(regexp_instr(lower(a.body), '\m' || t.term || '(?:e?s)?\M'))
              from terms t where lower(a.body) ~ ('\m' || t.term || '(?:e?s)?\M')) as first_hit
      from public.crm_kb_articles a
     where a.organization_id = p_organization
       and (p_audience is null or a.audience = p_audience)
       and (not p_published_only or a.published_at is not null)
  )
  select s.id, s.slug, s.title, s.category, s.audience, s.published_at, s.updated_at,
         (3 * s.title_hits + s.body_hits)::integer as rank,
         s.title_hits, s.body_hits,
         case
           when s.first_hit is null then left(s.body, 200)
           else substr(s.body, greatest(s.first_hit - 60, 1), 200)
         end as excerpt
    from scored s
   where (select count(*) from terms) = 0 or (3 * s.title_hits + s.body_hits) > 0
   order by rank desc, s.published_at desc nulls last, s.updated_at desc, s.title;
$$;

revoke all on function public.crm_kb_search(uuid, text, public.crm_kb_audience, boolean) from public, anon, service_role;
grant execute on function public.crm_kb_search(uuid, text, public.crm_kb_audience, boolean) to authenticated;

-- The customer's read: published, customer-audience articles of the
-- caller's own workspace, with the body, through the same scorer. A
-- definer because a portal user is not a member of the organization they
-- read; the resolver is what scopes it.
create or replace function public.crm_portal_articles(p_query text default null)
returns table (
  id uuid,
  slug text,
  title text,
  category text,
  body text,
  published_at timestamptz,
  rank integer,
  excerpt text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with me as (select organization_id from public.crm_portal_account_for(auth.uid()) limit 1),
  terms as (select public.crm_kb_terms(p_query) as term),
  scored as (
    select a.id, a.slug, a.title, a.category, a.body, a.published_at,
           (select count(*) from terms t where lower(a.title) ~ ('\m' || t.term || '(?:e?s)?\M'))::integer as title_hits,
           (select count(*) from terms t where lower(a.body) ~ ('\m' || t.term || '(?:e?s)?\M'))::integer as body_hits,
           (select min(regexp_instr(lower(a.body), '\m' || t.term || '(?:e?s)?\M'))
              from terms t where lower(a.body) ~ ('\m' || t.term || '(?:e?s)?\M')) as first_hit
      from public.crm_kb_articles a
      join me on me.organization_id = a.organization_id
     where a.audience = 'customer'
       and a.published_at is not null
  )
  select s.id, s.slug, s.title, s.category, s.body, s.published_at,
         (3 * s.title_hits + s.body_hits)::integer as rank,
         case
           when s.first_hit is null then left(s.body, 200)
           else substr(s.body, greatest(s.first_hit - 60, 1), 200)
         end as excerpt
    from scored s
   where (select count(*) from terms) = 0 or (3 * s.title_hits + s.body_hits) > 0
   order by rank desc, s.published_at desc, s.title
   limit 200;
$$;

revoke all on function public.crm_portal_articles(text) from public, anon, service_role;
grant execute on function public.crm_portal_articles(text) to authenticated;

-- One booked visit on the caller's own account, with what a calendar entry
-- needs: the moments, the site and its address, the technician's name. A
-- visit that is not theirs, or is not booked (no scheduled start), returns
-- no row — the same shape as "does not exist", on purpose.
create or replace function public.crm_portal_visit_calendar(p_work_order uuid)
returns table (
  id uuid,
  service_type text,
  status public.crm_work_order_status,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  property_label text,
  address text,
  technician_name text,
  organization_name text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select w.id, w.service_type, w.status, w.scheduled_start, w.scheduled_end,
         p.label, p.address,
         case when t.id is null then null
              else t.first_name || coalesce(' ' || t.last_name, '') end,
         o.name
    from public.crm_portal_account_for(auth.uid()) me
    join public.crm_work_orders w on w.account_id = me.account_id and w.id = p_work_order
    join public.organizations o on o.id = w.organization_id
    left join public.crm_properties p on p.id = w.property_id
    left join public.crm_technicians t on t.id = w.technician_id
   where w.scheduled_start is not null
   limit 1;
$$;

revoke all on function public.crm_portal_visit_calendar(uuid) from public, anon, service_role;
grant execute on function public.crm_portal_visit_calendar(uuid) to authenticated;
