-- ---------------------------------------------------------------------------
-- Posting sightings: the ledger behind the freshness verdict (ADR-241)
-- ---------------------------------------------------------------------------
--
-- The complaint every job board shares is the ghost job: a posting that has
-- been open for months, reposted so it looks new, or left up after the role
-- closed. No board says how long a posting has really been up. This product
-- can, because it sees the same URL come back search after search.
--
-- One row per posting URL, holding only what the board itself published:
-- the URL, which board answered, the company and title as the board wrote
-- them, the posting and closing dates the board stated, and how often and
-- when THIS product has seen it. Nothing personal is stored — no person, no
-- workspace, no query — which is what allows every signed-in person to read
-- every row: the value of "first seen here 62 days ago, on 9 searches" is
-- that it is counted across everyone who searched, not one person's diary.
--
-- Writes cross one SECURITY DEFINER boundary so a browser can never author a
-- sighting directly: the search route records what the boards returned, as
-- the signed-in caller, through record_posting_sightings; nothing else holds
-- INSERT or UPDATE. The table is RLS-enabled and forced, readable by
-- authenticated only, and carries no service_role grant (the pinned grants
-- contract).

create table if not exists public.job_seeker_posting_sightings (
  -- md5 of the exact URL the board returned; the row's identity, so a
  -- posting is one row however many people meet it.
  url_key text primary key check (url_key ~ '^[0-9a-f]{32}$'),
  url text not null check (url ~ '^https?://' and char_length(url) <= 800),
  -- The board that returned it, as job_seeker_jobs.source spells boards.
  source text not null check (source ~ '^[a-z][a-z0-9_]{0,62}$'),
  company text not null check (char_length(btrim(company)) between 1 and 300),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  times_seen integer not null default 1 check (times_seen >= 1),
  -- The posting date the board stated, earliest and latest ever seen for
  -- this URL. When the latest moves forward the posting was re-dated: that
  -- is what "reposted" means here, counted rather than guessed.
  earliest_posted_on date,
  latest_posted_on date,
  reposts integer not null default 0 check (reposts >= 0),
  closes_on date,
  constraint job_seeker_posting_sightings_seen_order
    check (last_seen_at >= first_seen_at),
  constraint job_seeker_posting_sightings_posted_order
    check (earliest_posted_on is null or latest_posted_on is null
           or latest_posted_on >= earliest_posted_on)
);

comment on table public.job_seeker_posting_sightings is
  'One row per job posting URL this product has returned from a board: the board''s own dates plus how often and when the posting has been seen here. Public facts only; readable by every signed-in person; written only through record_posting_sightings (ADR-241).';

create index if not exists job_seeker_posting_sightings_last_seen_idx
  on public.job_seeker_posting_sightings (last_seen_at desc);

alter table public.job_seeker_posting_sightings enable row level security;
alter table public.job_seeker_posting_sightings force row level security;

revoke all on table public.job_seeker_posting_sightings from public, anon, authenticated, service_role;
grant select on table public.job_seeker_posting_sightings to authenticated;

drop policy if exists job_seeker_posting_sightings_read on public.job_seeker_posting_sightings;
create policy job_seeker_posting_sightings_read
  on public.job_seeker_posting_sightings
  for select to authenticated
  using (true);

-- Record what a search returned. Each element: {url, source, company, title,
-- postedOn?, closesOn?}. An element the schema would refuse (no http URL, an
-- empty company or title, a source that is not a board key) is skipped and
-- not counted, because it is the board's malformed answer rather than the
-- caller's mistake; the count returned is the number of sightings written.
create or replace function public.record_posting_sightings(p_sightings jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_row jsonb;
  v_url text;
  v_source text;
  v_company text;
  v_title text;
  v_posted date;
  v_closes date;
  v_recorded integer := 0;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if p_sightings is null or jsonb_typeof(p_sightings) <> 'array' then
    raise exception using errcode = '22023', message = 'sightings must be a JSON array';
  end if;
  if jsonb_array_length(p_sightings) > 400 then
    raise exception using errcode = '22023', message = 'at most 400 sightings per call';
  end if;

  for v_row in select value from jsonb_array_elements(p_sightings) loop
    if jsonb_typeof(v_row) <> 'object' then continue; end if;
    v_url := btrim(coalesce(v_row->>'url', ''));
    v_source := btrim(coalesce(v_row->>'source', ''));
    v_company := left(btrim(coalesce(v_row->>'company', '')), 300);
    v_title := left(btrim(coalesce(v_row->>'title', '')), 300);
    if v_url !~ '^https?://' or char_length(v_url) > 800 then continue; end if;
    if v_source !~ '^[a-z][a-z0-9_]{0,62}$' then continue; end if;
    if v_company = '' or v_title = '' then continue; end if;

    v_posted := null;
    v_closes := null;
    begin
      if (v_row->>'postedOn') ~ '^\d{4}-\d{2}-\d{2}' then
        v_posted := substr(v_row->>'postedOn', 1, 10)::date;
      end if;
      if (v_row->>'closesOn') ~ '^\d{4}-\d{2}-\d{2}' then
        v_closes := substr(v_row->>'closesOn', 1, 10)::date;
      end if;
    exception when others then
      -- A date the board wrote badly is no date; the sighting still counts.
      v_posted := null;
      v_closes := null;
    end;

    insert into public.job_seeker_posting_sightings
      (url_key, url, source, company, title, earliest_posted_on, latest_posted_on, closes_on)
    values
      (md5(v_url), v_url, v_source, v_company, v_title, v_posted, v_posted, v_closes)
    on conflict (url_key) do update set
      last_seen_at = now(),
      times_seen = public.job_seeker_posting_sightings.times_seen + 1,
      source = excluded.source,
      company = excluded.company,
      title = excluded.title,
      -- least/greatest ignore nulls: a board that states no date this time
      -- neither erases nor moves what an earlier sighting recorded.
      earliest_posted_on = least(public.job_seeker_posting_sightings.earliest_posted_on, excluded.earliest_posted_on),
      latest_posted_on = greatest(public.job_seeker_posting_sightings.latest_posted_on, excluded.latest_posted_on),
      reposts = public.job_seeker_posting_sightings.reposts
        + case
            when excluded.latest_posted_on is not null
             and public.job_seeker_posting_sightings.latest_posted_on is not null
             and excluded.latest_posted_on > public.job_seeker_posting_sightings.latest_posted_on
            then 1 else 0
          end,
      closes_on = coalesce(excluded.closes_on, public.job_seeker_posting_sightings.closes_on);
    v_recorded := v_recorded + 1;
  end loop;

  return v_recorded;
end;
$function$;

revoke all on function public.record_posting_sightings(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_posting_sightings(jsonb) to authenticated;

comment on function public.record_posting_sightings(jsonb) is
  'Authenticated write boundary for posting sightings: upserts one row per URL, counting times seen and re-dated postings. Returns the number of sightings recorded (ADR-241).';

-- Read the sightings for a set of URL keys in one call, so a search with
-- hundreds of results asks once instead of building a URL the gateway
-- would refuse. Invoker: the caller's own SELECT grant and the read policy
-- are what answer.
create or replace function public.read_posting_sightings(p_url_keys text[])
returns table (
  url_key text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  times_seen integer,
  earliest_posted_on date,
  latest_posted_on date,
  reposts integer,
  closes_on date
)
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  select s.url_key, s.first_seen_at, s.last_seen_at, s.times_seen,
         s.earliest_posted_on, s.latest_posted_on, s.reposts, s.closes_on
    from public.job_seeker_posting_sightings s
   where s.url_key = any (p_url_keys)
     and coalesce(cardinality(p_url_keys), 0) <= 1000;
$function$;

revoke all on function public.read_posting_sightings(text[]) from public, anon, authenticated, service_role;
grant execute on function public.read_posting_sightings(text[]) to authenticated;

comment on function public.read_posting_sightings(text[]) is
  'The sightings for up to 1,000 URL keys, under the caller''s own read grant (ADR-241).';
