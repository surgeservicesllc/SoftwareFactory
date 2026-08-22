-- What was read out of an uploaded resume, and what a person did about it.
--
-- The upload table stores the file; this stores the reading of it. They are
-- separate rows on purpose: a resume can be read more than once (a model
-- becomes available, an extractor improves), and each reading is evidence of
-- what was proposed at that moment rather than a value that gets overwritten.
--
-- Nothing here is applied automatically. A row records a PROPOSAL; the profile
-- changes only when someone calls apply_resume_extraction with the fields they
-- accepted. That split is the whole safety argument for letting a model near
-- someone's career history: the model suggests, the person decides, and the
-- row keeps both halves so a wrong suggestion is traceable after the fact.

create table if not exists public.job_seeker_resume_extractions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  upload_id uuid not null references public.job_seeker_uploads(id) on delete cascade,

  -- 'reviewed' means a model read the document. 'pattern_only' means it did
  -- not, and `detail` says why. 'failed' means the file could not be read at
  -- all. A surface that collapsed the first two would claim an AI review on
  -- deployments that have no provider configured.
  status text not null check (status in ('reviewed', 'pattern_only', 'failed')),
  -- The model that read it, or null. Null with status 'reviewed' is refused
  -- below, because that combination is exactly the false claim to prevent.
  model text check (model is null or char_length(btrim(model)) between 1 and 200),
  detail text not null check (char_length(detail) between 1 and 2000),

  -- The proposed fields, in the same shape the API and the review screen use.
  proposal jsonb not null default '{}'::jsonb,
  -- Which pass produced each field: {"email":"pattern","summary":"model"}.
  sources jsonb not null default '{}'::jsonb,

  character_count integer not null default 0 check (character_count >= 0),
  truncated boolean not null default false,

  applied_at timestamptz,
  -- The fields the person actually accepted, which is rarely all of them.
  applied_fields jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),

  constraint job_seeker_extraction_proposal_is_object
    check (jsonb_typeof(proposal) = 'object'),
  constraint job_seeker_extraction_sources_is_object
    check (jsonb_typeof(sources) = 'object'),
  constraint job_seeker_extraction_applied_fields_shape
    check (public.job_seeker_text_list_valid(applied_fields, 20, 40)),
  -- A resume proposal is a few kilobytes; this stops a pathological document
  -- from turning one upload into an unbounded row.
  constraint job_seeker_extraction_proposal_bounded
    check (octet_length(proposal::text) <= 200000),
  -- "Reviewed by a model" and "we know which model" are the same fact.
  constraint job_seeker_extraction_reviewed_names_model
    check ((status = 'reviewed') = (model is not null)),
  -- Applied and the record of what was applied travel together.
  constraint job_seeker_extraction_applied_together
    check ((applied_at is not null) = (jsonb_array_length(applied_fields) > 0))
);

alter table public.job_seeker_resume_extractions enable row level security;
alter table public.job_seeker_resume_extractions force row level security;
revoke all on table public.job_seeker_resume_extractions from anon;
-- No UPDATE grant: applying is a definer function's job, so the audit row and
-- the profile write cannot come apart. A client that could update this table
-- directly could mark an extraction applied without ever touching the profile.
grant select, insert, delete on table public.job_seeker_resume_extractions to authenticated;

drop policy if exists job_seeker_extractions_select_own on public.job_seeker_resume_extractions;
create policy job_seeker_extractions_select_own
  on public.job_seeker_resume_extractions for select to authenticated
  using (public.is_organization_member(organization_id) and user_id = auth.uid());

drop policy if exists job_seeker_extractions_insert_own on public.job_seeker_resume_extractions;
create policy job_seeker_extractions_insert_own
  on public.job_seeker_resume_extractions for insert to authenticated
  with check (public.is_organization_member(organization_id) and user_id = auth.uid());

drop policy if exists job_seeker_extractions_delete_own on public.job_seeker_resume_extractions;
create policy job_seeker_extractions_delete_own
  on public.job_seeker_resume_extractions for delete to authenticated
  using (public.is_organization_member(organization_id) and user_id = auth.uid());

create index if not exists job_seeker_extractions_person_idx
  on public.job_seeker_resume_extractions (organization_id, user_id, created_at desc);
create index if not exists job_seeker_extractions_upload_idx
  on public.job_seeker_resume_extractions (upload_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Applying an extraction to the profile
-- ---------------------------------------------------------------------------

/*
 * One function, because three things have to happen together or not at all:
 * the profile takes the accepted values, the extraction records that it was
 * applied and with which fields, and an audit row says a person changed their
 * profile from a resume. Doing this from the client would let any of the three
 * happen without the others.
 *
 * `p_fields` names what the person accepted, in the API's own field names. A
 * field they did not accept is not written, and a field the proposal does not
 * carry is ignored rather than nulling the column — this can only ever fill in
 * or overwrite with a real value, never blank something out.
 */
create or replace function public.apply_resume_extraction(
  p_extraction_id uuid,
  p_fields text[]
)
returns table (
  extraction_id uuid,
  applied_fields jsonb,
  applied_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_caller uuid := auth.uid();
  v_row public.job_seeker_resume_extractions%rowtype;
  v_proposal jsonb;
  v_accepted text[];
  v_field text;
  v_written text[] := array[]::text[];
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;

  select * into v_row
    from public.job_seeker_resume_extractions
   where id = p_extraction_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'that resume reading no longer exists';
  end if;

  -- The extraction belongs to one person. Membership alone is not enough:
  -- a colleague in the same organization must not be able to write someone
  -- else's career history, and this function bypasses RLS.
  if v_row.user_id <> v_caller then
    raise exception using errcode = '42501',
      message = 'a resume reading can only be applied by the person it belongs to';
  end if;
  if not public.is_organization_member(v_row.organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  if v_row.applied_at is not null then
    raise exception using errcode = '23505',
      message = 'that resume reading has already been applied';
  end if;
  if v_row.status = 'failed' then
    raise exception using errcode = '22023',
      message = 'that resume could not be read, so there is nothing to apply';
  end if;

  v_proposal := coalesce(v_row.proposal, '{}'::jsonb);
  v_accepted := coalesce(p_fields, array[]::text[]);
  if array_length(v_accepted, 1) is null then
    raise exception using errcode = '22023',
      message = 'name at least one field to apply';
  end if;

  -- The profile row may not exist yet: a person can upload a resume before
  -- they have typed anything at all, and that is the case this feature is
  -- most useful for.
  insert into public.job_seeker_profiles (organization_id, user_id)
  values (v_row.organization_id, v_caller)
  on conflict (organization_id, user_id) do nothing;

  foreach v_field in array v_accepted loop
    /*
     * The name is checked before the proposal is consulted, so the error a
     * caller gets depends on what they asked for rather than on what happened
     * to be in the proposal. Checking presence first meant a misspelled field
     * reported "none of those fields were found" whenever the proposal did not
     * carry it — a message that sends someone looking at the wrong thing.
     */
    if v_field is null or v_field not in (
      'fullName', 'email', 'phone', 'linkedinUrl', 'location', 'summary',
      'employmentHistory', 'education', 'accomplishments', 'skills',
      'certifications', 'technologies', 'industries'
    ) then
      raise exception using errcode = '22023',
        message = format('%s is not a field a resume reading can apply', coalesce(v_field, 'null'));
    end if;

    -- A field the proposal does not carry is skipped rather than written as
    -- null, so accepting a field can never blank out what is already there.
    continue when not (v_proposal ? v_field);

    case v_field
      when 'fullName' then
        update public.job_seeker_profiles set full_name = v_proposal ->> 'fullName'
         where organization_id = v_row.organization_id and user_id = v_caller;
      when 'email' then
        update public.job_seeker_profiles set email = v_proposal ->> 'email'
         where organization_id = v_row.organization_id and user_id = v_caller;
      when 'phone' then
        update public.job_seeker_profiles set phone = v_proposal ->> 'phone'
         where organization_id = v_row.organization_id and user_id = v_caller;
      when 'linkedinUrl' then
        update public.job_seeker_profiles set linkedin_url = v_proposal ->> 'linkedinUrl'
         where organization_id = v_row.organization_id and user_id = v_caller;
      when 'location' then
        update public.job_seeker_profiles set location = v_proposal ->> 'location'
         where organization_id = v_row.organization_id and user_id = v_caller;
      when 'summary' then
        update public.job_seeker_profiles set summary = v_proposal ->> 'summary'
         where organization_id = v_row.organization_id and user_id = v_caller;
      when 'employmentHistory' then
        update public.job_seeker_profiles set employment_history = v_proposal -> 'employmentHistory'
         where organization_id = v_row.organization_id and user_id = v_caller;
      when 'education' then
        update public.job_seeker_profiles set education = v_proposal -> 'education'
         where organization_id = v_row.organization_id and user_id = v_caller;
      when 'accomplishments' then
        update public.job_seeker_profiles set accomplishments = v_proposal -> 'accomplishments'
         where organization_id = v_row.organization_id and user_id = v_caller;
      when 'skills' then
        update public.job_seeker_profiles set skills = v_proposal -> 'skills'
         where organization_id = v_row.organization_id and user_id = v_caller;
      when 'certifications' then
        update public.job_seeker_profiles set certifications = v_proposal -> 'certifications'
         where organization_id = v_row.organization_id and user_id = v_caller;
      when 'technologies' then
        update public.job_seeker_profiles set technologies = v_proposal -> 'technologies'
         where organization_id = v_row.organization_id and user_id = v_caller;
      when 'industries' then
        update public.job_seeker_profiles set industries = v_proposal -> 'industries'
         where organization_id = v_row.organization_id and user_id = v_caller;
      else
        -- Unreachable: the allowlist above already refused anything not named
        -- here. Kept as a backstop so adding a name to one list and forgetting
        -- the other raises instead of silently applying nothing.
        raise exception using errcode = '22023',
          message = format('%s is not a field a resume reading can apply', v_field);
    end case;

    v_written := v_written || v_field;
  end loop;

  if array_length(v_written, 1) is null then
    raise exception using errcode = '22023',
      message = 'none of those fields were found in that resume reading';
  end if;

  update public.job_seeker_profiles set updated_at = now()
   where organization_id = v_row.organization_id and user_id = v_caller;

  update public.job_seeker_resume_extractions
     set applied_at = now(),
         applied_fields = to_jsonb(v_written)
   where id = p_extraction_id
   returning * into v_row;

  insert into public.activity_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata
  ) values (
    v_row.organization_id,
    v_caller,
    'job_seeker.profile_updated'::public.activity_event_type,
    'job_seeker_profile',
    v_row.id,
    'Career profile filled in from an uploaded resume.',
    pg_catalog.jsonb_build_object(
      'extraction_id', v_row.id,
      'upload_id', v_row.upload_id,
      'status', v_row.status,
      -- The model is named so an applied field can be traced back to whether a
      -- model proposed it or a pattern did.
      'model', v_row.model,
      'applied_fields', v_row.applied_fields
    )
  );

  return query
    select v_row.id, v_row.applied_fields, v_row.applied_at;
end;
$function$;

revoke all on function public.apply_resume_extraction(uuid, text[]) from public, anon;
grant execute on function public.apply_resume_extraction(uuid, text[]) to authenticated;
