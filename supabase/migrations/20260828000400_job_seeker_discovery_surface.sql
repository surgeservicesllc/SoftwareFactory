-- ---------------------------------------------------------------------------
-- Job Discovery: saving, saved searches, alerts, and a real search meter
-- ---------------------------------------------------------------------------
--
-- The owner's Job Discovery design shows four things the schema could not
-- answer, and each is added here rather than rendered as a plausible number:
--
--   * a bookmark on every posting, and a "Saved Jobs" count;
--   * a Saved Searches tab;
--   * an Alerts tab with an active count;
--   * "Search Credits — 1,250 / 2,000 used this week".
--
-- The last one is the reason this migration exists at all. A credit meter over
-- no event log can only ever be a decoration, and a decorated meter is worse
-- than none: it tells a person they have spent something. `job_seeker_search_events`
-- records one row per search actually run, so the number on the page is a
-- count of rows in a window rather than a figure chosen to look plausible.
--
-- The weekly allowance lives on preferences, not in the UI, because a quota
-- the page hard-codes is a quota nobody can change and no test can vary.
--
-- Every table follows the foundation's shape exactly: organization + user
-- ownership, RLS enabled AND forced, anon revoked, and the four owner-scoped
-- policies. A new job-seeker table that invents its own access rule is a hole
-- in a boundary that is otherwise uniform.

-- Saving a posting is a property of the posting row, which is already
-- per-user: `job_seeker_jobs` carries `user_id`, so a second table keyed by
-- (user, job) would duplicate an ownership the row already has. Null means
-- never saved; a timestamp is when, so "recently saved" is answerable.
alter table public.job_seeker_jobs
  add column if not exists saved_at timestamptz;

comment on column public.job_seeker_jobs.saved_at is
  'When the seeker bookmarked this posting. Null means not saved. A timestamp rather than a boolean so the list can be ordered by when it was saved.';

create index if not exists job_seeker_jobs_saved_idx
  on public.job_seeker_jobs (organization_id, user_id, saved_at desc)
  where saved_at is not null;

-- The discovery list is read newest-first and filtered by the seeker; without
-- this the page table-scans every posting the workspace has ever recorded.
create index if not exists job_seeker_jobs_discovered_idx
  on public.job_seeker_jobs (organization_id, user_id, discovered_at desc);

-- A saved search is the query itself, so it can be re-run. `query` is the
-- structured filter set the page holds, stored whole rather than as columns:
-- the filter vocabulary belongs to the product and will grow, and a column per
-- filter would need a migration every time it does.
create table if not exists public.job_seeker_saved_searches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  query jsonb not null default '{}'::jsonb,
  -- Recorded when the search is actually re-run, so "last run" is an
  -- observation rather than the row's own age.
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_seeker_saved_searches_name_unique
    unique (organization_id, user_id, name)
);

create index if not exists job_seeker_saved_searches_recent_idx
  on public.job_seeker_saved_searches (organization_id, user_id, created_at desc);

-- An alert is a saved search a person asked to be told about. It references
-- the search rather than copying its query: an alert whose criteria have
-- drifted from the search it was created from would notify about something
-- the person never asked for.
create table if not exists public.job_seeker_search_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_search_id uuid not null
    references public.job_seeker_saved_searches(id) on delete cascade,
  cadence text not null default 'daily'
    check (cadence in ('daily', 'weekly')),
  -- Active is the seeker's switch. Delivery is not built, and the API says so
  -- rather than the column implying a notification that never arrives.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_seeker_search_alerts_one_per_search
    unique (organization_id, user_id, saved_search_id)
);

create index if not exists job_seeker_search_alerts_active_idx
  on public.job_seeker_search_alerts (organization_id, user_id)
  where active;

-- One row per search actually run. This is what makes the credit meter a
-- measurement: the page counts rows inside a window instead of displaying a
-- number with nothing behind it.
create table if not exists public.job_seeker_search_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Which board answered, or 'internal' for a filter over already-recorded
  -- postings. A filter is not a board call and must not spend a credit, so the
  -- two are distinguishable in the log rather than merged.
  board text not null check (board ~ '^[a-z][a-z0-9_]{0,62}$'),
  -- What was asked, for the seeker's own history. Bounded, and never a place
  -- for credentials: the search routes strip those before they reach here.
  query jsonb not null default '{}'::jsonb,
  results_returned integer check (results_returned is null or results_returned >= 0),
  created_at timestamptz not null default now()
);

create index if not exists job_seeker_search_events_window_idx
  on public.job_seeker_search_events (organization_id, user_id, created_at desc);

-- The allowance, where it can be read and changed, rather than hard-coded in a
-- component. Default 2000 to match the owner's design; a workspace that needs
-- a different ceiling changes the row, not the bundle.
alter table public.job_seeker_preferences
  add column if not exists weekly_search_allowance integer not null default 2000
    check (weekly_search_allowance between 0 and 1000000);

comment on column public.job_seeker_preferences.weekly_search_allowance is
  'Board searches this seeker may run per rolling seven days. Read with a count of job_seeker_search_events to produce the credit meter; the meter is a measurement, never a decoration.';

-- ---------------------------------------------------------------------------
-- Row Level Security, identical in shape to the foundation's tables.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'job_seeker_saved_searches', 'job_seeker_search_alerts', 'job_seeker_search_events'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('revoke all on table public.%I from anon', v_table);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_select_own', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_organization_member(organization_id) and user_id = auth.uid())',
      v_table || '_select_own', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_insert_own', v_table);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.is_organization_member(organization_id) and user_id = auth.uid())',
      v_table || '_insert_own', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_update_own', v_table);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_organization_member(organization_id) and user_id = auth.uid())
         with check (public.is_organization_member(organization_id) and user_id = auth.uid())',
      v_table || '_update_own', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_delete_own', v_table);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.is_organization_member(organization_id) and user_id = auth.uid())',
      v_table || '_delete_own', v_table);
  end loop;
end;
$$;

-- A search event is evidence that a search happened. Rewriting one would make
-- the credit meter say something other than what occurred, which is the exact
-- failure this table exists to prevent.
create or replace function public.job_seeker_search_events_no_rewrite()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '42501',
    message = 'search events are append-only; the credit meter counts what happened';
end;
$function$;

drop trigger if exists job_seeker_search_events_immutable on public.job_seeker_search_events;
create trigger job_seeker_search_events_immutable
  before update or delete on public.job_seeker_search_events
  for each row execute function public.job_seeker_search_events_no_rewrite();
