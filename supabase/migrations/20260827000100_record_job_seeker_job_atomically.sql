-- Record one scored job as a single, audited state transition.
--
-- Search and import previously performed three independent PostgREST inserts:
-- job, match, then application. A refusal on either child left an orphaned job,
-- and the next attempt was then reported as an ordinary duplicate. This RPC is
-- one PostgreSQL statement, so every row and its immutable activity event
-- commit together or none of them do.

-- A child must identify the same person and organization as its job. The old
-- single-column foreign keys proved only that some job with that id existed;
-- RLS on the child row could not prove that the referenced job had the same
-- owner. The redundant unique key exists solely as the referenced identity for
-- these composite foreign keys.
alter table public.job_seeker_jobs
  add constraint job_seeker_jobs_owner_identity_key
  unique (id, organization_id, user_id);

alter table public.job_seeker_matches
  add constraint job_seeker_matches_job_owner_fkey
  foreign key (job_id, organization_id, user_id)
  references public.job_seeker_jobs (id, organization_id, user_id)
  on delete cascade
  not valid;

alter table public.job_seeker_matches
  validate constraint job_seeker_matches_job_owner_fkey;

alter table public.job_seeker_applications
  add constraint job_seeker_applications_job_owner_fkey
  foreign key (job_id, organization_id, user_id)
  references public.job_seeker_jobs (id, organization_id, user_id)
  on delete cascade
  not valid;

alter table public.job_seeker_applications
  validate constraint job_seeker_applications_job_owner_fkey;

-- The validated composite constraints strictly subsume these original ones.
alter table public.job_seeker_matches
  drop constraint job_seeker_matches_job_id_fkey;

alter table public.job_seeker_applications
  drop constraint job_seeker_applications_job_id_fkey;

create or replace function public.record_job_seeker_job(
  p_organization_id uuid,
  p_source text,
  p_external_id text,
  p_url text,
  p_title text,
  p_company text,
  p_salary_text text,
  p_location text,
  p_work_model public.job_seeker_arrangement,
  p_description text,
  p_score integer,
  p_breakdown jsonb,
  p_reasons jsonb,
  p_gaps jsonb,
  p_threshold_used integer,
  p_qualified boolean
)
returns table (
  outcome text,
  job_id uuid,
  score integer,
  qualified boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_job_id uuid;
  v_application_stage public.job_seeker_stage;
begin
  if v_caller is null then
    raise exception using
      errcode = '42501',
      message = 'authentication is required';
  end if;

  if not coalesce(public.is_organization_member(p_organization_id), false) then
    raise exception using
      errcode = '42501',
      message = 'organization membership is required';
  end if;

  -- The unique dedupe index is the concurrency authority. ON CONFLICT handles
  -- two tabs racing without a check-then-insert window and turns only that
  -- already-recorded state into a normal result.
  insert into public.job_seeker_jobs (
    organization_id,
    user_id,
    source,
    external_id,
    url,
    title,
    company,
    salary_text,
    location,
    work_model,
    description
  ) values (
    p_organization_id,
    v_caller,
    p_source,
    p_external_id,
    p_url,
    p_title,
    p_company,
    p_salary_text,
    p_location,
    p_work_model,
    p_description
  )
  on conflict do nothing
  returning id into v_job_id;

  if v_job_id is null then
    return query
      select 'duplicate'::text, null::uuid, null::integer, null::boolean;
    return;
  end if;

  insert into public.job_seeker_matches (
    organization_id,
    user_id,
    job_id,
    score,
    breakdown,
    reasons,
    gaps,
    threshold_used,
    qualified
  ) values (
    p_organization_id,
    v_caller,
    v_job_id,
    p_score,
    p_breakdown,
    p_reasons,
    p_gaps,
    p_threshold_used,
    p_qualified
  );

  v_application_stage := case
    when p_qualified then 'QUALIFIED'::public.job_seeker_stage
    else 'FOUND'::public.job_seeker_stage
  end;

  insert into public.job_seeker_applications (
    organization_id,
    user_id,
    job_id,
    stage
  ) values (
    p_organization_id,
    v_caller,
    v_job_id,
    v_application_stage
  );

  insert into public.activity_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    description,
    metadata
  ) values (
    p_organization_id,
    v_caller,
    'job_seeker.job_recorded'::public.activity_event_type,
    'job_seeker_job',
    v_job_id,
    'A job was recorded in the job seeker pipeline.',
    pg_catalog.jsonb_build_object(
      'job_id', v_job_id,
      'source', p_source,
      'score', p_score,
      'qualified', p_qualified,
      'application_stage', v_application_stage
    )
  );

  return query
    select 'recorded'::text, v_job_id, p_score, p_qualified;
end;
$function$;

-- This function is a user-owned write boundary. It is intentionally not a
-- service-role helper, and no default PUBLIC execute grant remains.
revoke all on function public.record_job_seeker_job(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  public.job_seeker_arrangement,
  text,
  integer,
  jsonb,
  jsonb,
  jsonb,
  integer,
  boolean
) from public, anon, authenticated, service_role;

grant execute on function public.record_job_seeker_job(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  public.job_seeker_arrangement,
  text,
  integer,
  jsonb,
  jsonb,
  jsonb,
  integer,
  boolean
) to authenticated;

comment on function public.record_job_seeker_job(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  public.job_seeker_arrangement,
  text,
  integer,
  jsonb,
  jsonb,
  jsonb,
  integer,
  boolean
) is
  'Authenticated atomic boundary for one caller-owned job, its score, initial application, and immutable job_seeker.job_recorded evidence. A dedupe conflict returns outcome=duplicate and creates nothing.';

-- Schema constraints do not disable RLS, but reassert the protected posture at
-- the end of the forward migration so this boundary cannot ship over drifted
-- table settings.
alter table public.job_seeker_jobs enable row level security;
alter table public.job_seeker_jobs force row level security;
alter table public.job_seeker_matches enable row level security;
alter table public.job_seeker_matches force row level security;
alter table public.job_seeker_applications enable row level security;
alter table public.job_seeker_applications force row level security;

-- Direct INSERT remains for this release because the pre-existing manual job
-- route still uses the table boundary. The composite foreign keys above make
-- those direct child writes owner-consistent; contracting table INSERT belongs
-- in the same release that moves the final manual path onto this RPC.
