-- Still open? (ADR-249): a bounded recheck of a posting's URL, recorded on
-- the sightings row so every person who sees the posting sees the same
-- answer and nobody rechecks what was checked ten minutes ago. Only the
-- outcome is stored — a status from a fixed vocabulary, the HTTP status,
-- and a short note that names the phrase — never the page. The table's
-- grants and policies are unchanged: the write crosses one definer
-- function, exactly as sightings do.

alter table public.job_seeker_posting_sightings
  add column if not exists last_checked_at timestamptz,
  add column if not exists last_check_status text,
  add column if not exists last_check_http_status integer,
  add column if not exists last_check_note text,
  add column if not exists checks integer not null default 0;

do $$ begin
  alter table public.job_seeker_posting_sightings
    add constraint job_seeker_posting_sightings_check_status_known
      check (last_check_status is null or last_check_status in ('open', 'gone', 'moved', 'blocked', 'unreachable'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.job_seeker_posting_sightings
    add constraint job_seeker_posting_sightings_check_http_status_range
      check (last_check_http_status is null or last_check_http_status between 100 and 599);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.job_seeker_posting_sightings
    add constraint job_seeker_posting_sightings_check_note_length
      check (last_check_note is null or char_length(last_check_note) between 1 and 200);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.job_seeker_posting_sightings
    add constraint job_seeker_posting_sightings_check_consistent
      check ((last_checked_at is null) = (last_check_status is null) and checks >= 0);
exception when duplicate_object then null; end $$;

-- Record one recheck on an existing sightings row. Definer, so the browser
-- role keeps SELECT only; the caller must be signed in; the vocabulary is
-- checked here as well as by the table; and a row checked within the last
-- ten minutes is returned as it stands rather than rewritten, so a burst of
-- clicks is one outbound read, not ten. An unknown key answers no row.
create or replace function public.record_posting_recheck(
  p_url_key text,
  p_status text,
  p_http_status integer,
  p_note text
)
returns table (
  url_key text,
  last_checked_at timestamptz,
  last_check_status text,
  last_check_http_status integer,
  last_check_note text,
  checks integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_recent timestamptz;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if p_url_key is null or p_url_key !~ '^[0-9a-f]{32}$' then
    raise exception using errcode = '22023', message = 'a URL key is 32 hex characters';
  end if;
  if p_status is null or p_status not in ('open', 'gone', 'moved', 'blocked', 'unreachable') then
    raise exception using errcode = '22023', message = 'unknown recheck status';
  end if;
  if p_http_status is not null and (p_http_status < 100 or p_http_status > 599) then
    raise exception using errcode = '22023', message = 'an HTTP status is between 100 and 599';
  end if;
  if p_note is null or char_length(p_note) < 1 or char_length(p_note) > 200 then
    raise exception using errcode = '22023', message = 'a recheck note is 1 to 200 characters';
  end if;

  select s.last_checked_at into v_recent
    from public.job_seeker_posting_sightings s
   where s.url_key = p_url_key;
  if not found then
    return;
  end if;
  if v_recent is not null and v_recent > now() - interval '10 minutes' then
    return query
      select s.url_key, s.last_checked_at, s.last_check_status, s.last_check_http_status, s.last_check_note, s.checks
        from public.job_seeker_posting_sightings s
       where s.url_key = p_url_key;
    return;
  end if;

  return query
    update public.job_seeker_posting_sightings s
       set last_checked_at = now(),
           last_check_status = p_status,
           last_check_http_status = p_http_status,
           last_check_note = p_note,
           checks = s.checks + 1
     where s.url_key = p_url_key
    returning s.url_key, s.last_checked_at, s.last_check_status, s.last_check_http_status, s.last_check_note, s.checks;
end;
$function$;

revoke all on function public.record_posting_recheck(text, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.record_posting_recheck(text, text, integer, text) to authenticated;

comment on function public.record_posting_recheck(text, text, integer, text) is
  'Authenticated write boundary for a posting recheck: records the outcome on an existing sightings row, reusing a check under ten minutes old (ADR-249).';

-- The reader now carries the latest check, so every search card can print
-- it. A return type cannot be altered in place; the function is recreated
-- with the same grants and the same bound.
drop function if exists public.read_posting_sightings(text[]);
create function public.read_posting_sightings(p_url_keys text[])
returns table (
  url_key text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  times_seen integer,
  earliest_posted_on date,
  latest_posted_on date,
  reposts integer,
  closes_on date,
  last_checked_at timestamptz,
  last_check_status text,
  last_check_note text
)
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  select s.url_key, s.first_seen_at, s.last_seen_at, s.times_seen,
         s.earliest_posted_on, s.latest_posted_on, s.reposts, s.closes_on,
         s.last_checked_at, s.last_check_status, s.last_check_note
    from public.job_seeker_posting_sightings s
   where s.url_key = any (p_url_keys)
     and coalesce(cardinality(p_url_keys), 0) <= 1000;
$function$;

revoke all on function public.read_posting_sightings(text[]) from public, anon, authenticated, service_role;
grant execute on function public.read_posting_sightings(text[]) to authenticated;

comment on function public.read_posting_sightings(text[]) is
  'The sightings for up to 1,000 URL keys with their latest recheck, under the caller''s own read grant (ADR-241, ADR-249).';
