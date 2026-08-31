-- ---------------------------------------------------------------------------
-- Increment 16 — wood-destroying-organism inspection reports (ADR-204).
--
-- An NPMA-33 is not a form. It is a legal document a buyer, a lender and a
-- court all read, and its failure mode is not a missing field — it is a
-- report that READS AS CLEAN WHEN NOBODY LOOKED.
--
-- Everything below follows from refusing to let that happen.
--
-- `visible_evidence` is a NOT NULL boolean, and that single choice is the
-- design. "No visible evidence of wood-destroying organisms was observed"
-- is a POSITIVE recorded finding — an inspector went, looked, and says so
-- with their name on it. Model "clean" as the ABSENCE of finding rows and
-- two completely different facts collapse into one shape:
--
--   * an inspection that happened and found nothing, and
--   * an inspection nobody finished.
--
-- Here they cannot. The first is `status = 'issued'` with
-- `visible_evidence = false`. The second is a draft, and a draft is not a
-- document.
--
-- The second thing this file protects is the inspector. `obstructions` and
-- `inaccessible_areas` are first-class columns rather than notes, because
-- a WDO report that does not say what could NOT be inspected is the one
-- that ends in a lawsuit. Both travel to the customer's copy.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_wdo_status as enum ('draft', 'issued');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_wdo_finding_kind as enum (
    'live_infestation', 'visible_damage', 'previous_infestation',
    'previous_treatment', 'conducive_condition'
  );
exception when duplicate_object then null; end $$;

-- A diagram is a coordinate space, not an image. The generic structure
-- outline ships and works today; an uploaded floor plan needs object
-- storage, which this project has not connected, so it is a declared kind
-- rather than a silent assumption.
do $$ begin
  create type public.crm_wdo_diagram_kind as enum ('outline', 'uploaded_plan');
exception when duplicate_object then null; end $$;

create table if not exists public.crm_wdo_inspections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  property_id uuid not null,
  work_order_id uuid,
  inspector_technician_id uuid not null,
  report_number text not null check (char_length(btrim(report_number)) between 1 and 60),
  inspected_on date not null default current_date,
  structures_inspected text not null
    check (char_length(btrim(structures_inspected)) between 1 and 1000),

  -- The headline answer, and the reason this table exists. Not nullable:
  -- an inspector who has not answered it has not finished the inspection.
  visible_evidence boolean not null,

  -- What could not be reached, and why. A report silent about its own
  -- blind spots is the dangerous kind.
  obstructions text check (obstructions is null or char_length(obstructions) between 1 and 2000),
  inaccessible_areas text
    check (inaccessible_areas is null or char_length(inaccessible_areas) between 1 and 2000),
  recommendation text check (recommendation is null or char_length(recommendation) between 1 and 4000),

  diagram_kind public.crm_wdo_diagram_kind not null default 'outline',
  diagram_storage_path text
    check (
      diagram_storage_path is null
      or (diagram_storage_path ~ '^[a-z0-9][a-z0-9._/-]*$'
          and char_length(diagram_storage_path) between 3 and 301
          and diagram_storage_path !~ '://')
    ),

  status public.crm_wdo_status not null default 'draft',
  issued_at timestamptz,
  -- A correction is a NEW report naming the one it replaces. The original
  -- stays, on the same discipline crm_applications uses: an issued
  -- document is not edited into a different document.
  supersedes_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_wdo_inspections_property_same_account
    foreign key (organization_id, account_id, property_id)
    references public.crm_properties (organization_id, account_id, id) on delete cascade,
  constraint crm_wdo_inspections_work_order_same_org
    foreign key (organization_id, work_order_id)
    references public.crm_work_orders (organization_id, id) on delete set null,
  constraint crm_wdo_inspections_technician_same_org
    foreign key (organization_id, inspector_technician_id)
    references public.crm_technicians (organization_id, id) on delete restrict,
  constraint crm_wdo_inspections_issued_iff_moment
    check ((status = 'issued') = (issued_at is not null)),
  -- An uploaded plan without its path is a diagram that does not exist;
  -- the built-in outline never carries one.
  constraint crm_wdo_inspections_plan_iff_path
    check ((diagram_kind = 'uploaded_plan') = (diagram_storage_path is not null)),
  constraint crm_wdo_inspections_not_self_superseding check (supersedes_id is distinct from id),
  constraint crm_wdo_inspections_structures_no_secret
    check (not public.text_has_likely_secret(structures_inspected)),
  constraint crm_wdo_inspections_obstructions_no_secret
    check (not public.text_has_likely_secret(obstructions)),
  constraint crm_wdo_inspections_inaccessible_no_secret
    check (not public.text_has_likely_secret(inaccessible_areas)),
  constraint crm_wdo_inspections_recommendation_no_secret
    check (not public.text_has_likely_secret(recommendation))
);

create unique index if not exists crm_wdo_inspections_org_id_key
  on public.crm_wdo_inspections (organization_id, id);
create unique index if not exists crm_wdo_inspections_org_number_key
  on public.crm_wdo_inspections (organization_id, upper(btrim(report_number)));
create index if not exists crm_wdo_inspections_org_account_idx
  on public.crm_wdo_inspections (organization_id, account_id, inspected_on desc);
create index if not exists crm_wdo_inspections_org_property_idx
  on public.crm_wdo_inspections (organization_id, property_id, inspected_on desc);
create index if not exists crm_wdo_inspections_org_status_idx
  on public.crm_wdo_inspections (organization_id, status, inspected_on desc);

do $$ begin
  alter table public.crm_wdo_inspections
    add constraint crm_wdo_inspections_supersedes_same_org
    foreign key (organization_id, supersedes_id)
    references public.crm_wdo_inspections (organization_id, id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- The findings, and where they sit on the diagram.
--
-- Coordinates are normalized to 0..1 so the diagram is independent of
-- whatever it is drawn over — an outline at one size today, an uploaded
-- plan at another later. They travel together or not at all: half a
-- coordinate is a mark nobody can place.
--
-- A finding WITHOUT coordinates is legitimate and common — an inspector
-- records "subterranean termite damage, crawlspace joists" long before
-- anyone puts a pin in a drawing. It is listed in the report and simply
-- not drawn, and the surface says how many of the findings are placed
-- rather than quietly drawing the subset it can.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_wdo_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null,
  kind public.crm_wdo_finding_kind not null,
  organism text check (organism is null or char_length(btrim(organism)) between 1 and 120),
  area text not null check (char_length(btrim(area)) between 1 and 300),
  position_x numeric(5, 4) check (position_x is null or (position_x >= 0 and position_x <= 1)),
  position_y numeric(5, 4) check (position_y is null or (position_y >= 0 and position_y <= 1)),
  note text check (note is null or char_length(note) between 1 and 2000),
  treatment_note text check (treatment_note is null or char_length(treatment_note) between 1 and 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_wdo_findings_inspection_same_org
    foreign key (organization_id, inspection_id)
    references public.crm_wdo_inspections (organization_id, id) on delete cascade,
  -- Both halves of a coordinate, or neither.
  constraint crm_wdo_findings_position_complete
    check (num_nonnulls(position_x, position_y) in (0, 2)),
  constraint crm_wdo_findings_area_no_secret check (not public.text_has_likely_secret(area)),
  constraint crm_wdo_findings_note_no_secret check (not public.text_has_likely_secret(note)),
  constraint crm_wdo_findings_treatment_no_secret
    check (not public.text_has_likely_secret(treatment_note))
);

create index if not exists crm_wdo_findings_org_inspection_idx
  on public.crm_wdo_findings (organization_id, inspection_id, kind);

-- ---------------------------------------------------------------------------
-- Issuing a report: the one invariant that spans two tables.
--
-- A CHECK cannot express this, and the front end must not be where it
-- lives — a member holds the same privileges through PostgREST directly,
-- so a rule enforced only in a route is a rule with a door beside it.
--
-- It refuses in BOTH directions, which is the part worth being deliberate
-- about. Everyone remembers to stop a report that claims evidence with
-- nothing recorded. The one that matters more is the inverse: a report
-- declaring the structure clean WHILE a live-infestation finding sits on
-- it. That is the document that gets somebody a mortgage on a house with
-- termites in it.
-- ---------------------------------------------------------------------------

create or replace function public.crm_wdo_issue_report(p_inspection uuid)
returns public.crm_wdo_inspections
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_report public.crm_wdo_inspections;
begin
  select * into v_report from public.crm_wdo_inspections where id = p_inspection;
  if not found then
    -- RLS already narrowed this to the caller's organization, so "not
    -- found" and "not yours" are deliberately the same answer.
    raise exception 'no such inspection' using errcode = 'no_data_found';
  end if;

  -- Refusing a second issue belongs HERE rather than on the trigger, and
  -- the reason is subtle: every evaluation inside one statement shares the
  -- same transaction `now()`, so a trigger comparing the old and new
  -- issued_at sees no difference and lets it through. `select (f(x)).*`
  -- evaluates f once per output column, so that hole would be fourteen
  -- silent re-issues from one ordinary-looking line of application code.
  if v_report.status = 'issued' then
    raise exception 'report % was already issued on %',
      v_report.report_number, v_report.issued_at::date
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- The CONTRADICTION check is deliberately not here. It is on the trigger
  -- below, because this function is not the only way to set `status`: a
  -- member holds the same privileges through PostgREST and could PATCH the
  -- column directly. A rule enforced only in the function it is named
  -- after is a rule with a door beside it.
  update public.crm_wdo_inspections
     set status = 'issued', issued_at = now()
   where id = p_inspection
  returning * into v_report;

  return v_report;
end;
$$;

revoke all on function public.crm_wdo_issue_report(uuid) from public, anon, service_role;
grant execute on function public.crm_wdo_issue_report(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- An issued report is not edited into a different report. The trigger says
-- so rather than the update policy, because a policy that refused the row
-- outright would also block the supersede link being written onto it.
-- ---------------------------------------------------------------------------

create or replace function public.crm_wdo_guard_issued()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_adverse integer;
begin
  /*
   * Issuing: draft -> issued. This is where the invariant that spans two
   * tables is enforced, and it is on the TRIGGER rather than in
   * crm_wdo_issue_report on purpose. PostgREST is not the only door — a
   * member could PATCH `status` straight onto the row — so a check that
   * lived only in the function would be a check with a way around it.
   *
   * It refuses in BOTH directions. Everyone remembers to stop a report
   * claiming evidence it never recorded. The one that matters more is the
   * inverse: a report declaring a structure clean WHILE a live-infestation
   * finding sits on it. That is the document that gets somebody a mortgage
   * on a house with termites in it.
   */
  if old.status = 'draft' and new.status = 'issued' then
    select count(*) filter (
      where kind in ('live_infestation', 'visible_damage', 'previous_infestation')
    )
      into v_adverse
      from public.crm_wdo_findings
     where inspection_id = new.id;

    if new.visible_evidence and v_adverse = 0 then
      raise exception
        'this report says visible evidence was observed but records no infestation, damage or previous infestation'
        using errcode = 'check_violation';
    end if;

    if not new.visible_evidence and v_adverse > 0 then
      raise exception
        'this report says no visible evidence was observed while % adverse finding(s) are recorded against it',
        v_adverse
        using errcode = 'check_violation';
    end if;

    -- An issued report carries the moment it was issued. The CHECK pairs
    -- them; this makes the pairing happen rather than refusing the row for
    -- a caller who set the status and nothing else.
    if new.issued_at is null then
      new.issued_at := now();
    end if;
    return new;
  end if;

  if old.status <> 'issued' then
    return new;
  end if;

  -- The only thing that may change on an issued report is being pointed at
  -- by nothing — every column of substance is frozen.
  if row(new.account_id, new.property_id, new.inspector_technician_id, new.report_number,
         new.inspected_on, new.structures_inspected, new.visible_evidence,
         new.obstructions, new.inaccessible_areas, new.recommendation,
         new.diagram_kind, new.diagram_storage_path, new.status, new.issued_at)
     is distinct from
     row(old.account_id, old.property_id, old.inspector_technician_id, old.report_number,
         old.inspected_on, old.structures_inspected, old.visible_evidence,
         old.obstructions, old.inaccessible_areas, old.recommendation,
         old.diagram_kind, old.diagram_storage_path, old.status, old.issued_at) then
    raise exception
      'report % was issued on %; correct it with a new report that supersedes it',
      old.report_number, old.issued_at::date
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_wdo_guard_issued() from public, anon, authenticated, service_role;

drop trigger if exists crm_wdo_inspections_guard_issued on public.crm_wdo_inspections;
create trigger crm_wdo_inspections_guard_issued
  before update on public.crm_wdo_inspections
  for each row execute function public.crm_wdo_guard_issued();

-- A finding cannot be added to, or changed on, a report already issued —
-- the document would stop matching the findings it was issued against.
create or replace function public.crm_wdo_guard_issued_findings()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status public.crm_wdo_status;
  v_number text;
begin
  select status, report_number into v_status, v_number
    from public.crm_wdo_inspections where id = new.inspection_id;
  if v_status = 'issued' then
    raise exception
      'report % is issued; its findings can no longer change', v_number
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_wdo_guard_issued_findings()
  from public, anon, authenticated, service_role;

drop trigger if exists crm_wdo_findings_guard_issued on public.crm_wdo_findings;
create trigger crm_wdo_findings_guard_issued
  before insert or update on public.crm_wdo_findings
  for each row execute function public.crm_wdo_guard_issued_findings();

-- ---------------------------------------------------------------------------
-- The staff summary. SECURITY INVOKER, on ADR-199's rule: it reads across
-- a whole book, and a definer would read across every tenant's at once.
--
-- `unplaced_findings` is reported rather than smoothed away, for the same
-- reason `unscheduled` is its own standing in the fleet report: a diagram
-- showing four of five marks is not a diagram of the inspection.
-- ---------------------------------------------------------------------------

create or replace function public.crm_wdo_summary()
returns table (
  inspections integer,
  issued integer,
  drafts integer,
  with_evidence integer,
  clean integer,
  reports_with_obstructions integer,
  findings integer,
  unplaced_findings integer,
  latest_inspected_on date
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    count(*)::integer,
    count(*) filter (where i.status = 'issued')::integer,
    count(*) filter (where i.status = 'draft')::integer,
    -- Both counted over ISSUED reports only. A draft has not answered the
    -- question yet, and counting it either way would be an answer.
    count(*) filter (where i.status = 'issued' and i.visible_evidence)::integer,
    count(*) filter (where i.status = 'issued' and not i.visible_evidence)::integer,
    count(*) filter (
      where i.obstructions is not null or i.inaccessible_areas is not null
    )::integer,
    coalesce((select count(*) from public.crm_wdo_findings f
               where f.organization_id = i.organization_id), 0)::integer,
    coalesce((select count(*) from public.crm_wdo_findings f
               where f.organization_id = i.organization_id
                 and f.position_x is null), 0)::integer,
    max(i.inspected_on)
  from public.crm_wdo_inspections i
  group by i.organization_id;
$$;

revoke all on function public.crm_wdo_summary() from public, anon, service_role;
grant execute on function public.crm_wdo_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- The customer's copy. ISSUED reports only — a draft is not a document,
-- and showing one would let an unfinished inspection read as a finding.
-- Definer, on ADR-203's reasoning: the caller is not a member.
-- ---------------------------------------------------------------------------

create or replace function public.crm_portal_wdo_reports()
returns table (
  id uuid,
  report_number text,
  property_id uuid,
  property_label text,
  inspected_on date,
  issued_at timestamptz,
  structures_inspected text,
  visible_evidence boolean,
  obstructions text,
  inaccessible_areas text,
  recommendation text,
  findings integer,
  superseded boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    i.id, i.report_number, i.property_id, p.label, i.inspected_on, i.issued_at,
    i.structures_inspected, i.visible_evidence,
    -- What could not be inspected goes to the customer too. It is the part
    -- of the report they most need and are least likely to be told.
    i.obstructions, i.inaccessible_areas, i.recommendation,
    (select count(*)::integer from public.crm_wdo_findings f where f.inspection_id = i.id),
    exists (
      select 1 from public.crm_wdo_inspections later
       where later.supersedes_id = i.id and later.status = 'issued'
    )
  from public.crm_portal_account_for(auth.uid()) me
  join public.crm_wdo_inspections i
    on i.account_id = me.account_id and i.organization_id = me.organization_id
  left join public.crm_properties p on p.id = i.property_id
  where i.status = 'issued'
  order by i.inspected_on desc
  limit 200;
$$;

revoke all on function public.crm_portal_wdo_reports() from public, anon, service_role;
grant execute on function public.crm_portal_wdo_reports() to authenticated;

-- The findings on one report, for the customer. Coordinates travel so the
-- customer's copy can draw the same diagram the inspector drew.
create or replace function public.crm_portal_wdo_findings(p_inspection uuid)
returns table (
  id uuid,
  kind public.crm_wdo_finding_kind,
  organism text,
  area text,
  position_x numeric,
  position_y numeric,
  note text,
  treatment_note text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select f.id, f.kind, f.organism, f.area, f.position_x, f.position_y, f.note, f.treatment_note
    from public.crm_portal_account_for(auth.uid()) me
    join public.crm_wdo_inspections i
      on i.account_id = me.account_id and i.organization_id = me.organization_id
    join public.crm_wdo_findings f on f.inspection_id = i.id
   where i.id = p_inspection
     and i.status = 'issued'
   order by f.kind, f.area
   limit 500;
$$;

revoke all on function public.crm_portal_wdo_findings(uuid) from public, anon, service_role;
grant execute on function public.crm_portal_wdo_findings(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security. Neither table is deletable: a WDO report and its
-- findings are the record somebody relied on, and the way to withdraw one
-- is to supersede it.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_wdo_inspections', 'crm_wdo_findings'] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_set_updated_at', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      v_table || '_set_updated_at', v_table);

    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format(
      'revoke all on table public.%I from public, anon, authenticated, service_role', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_select_member', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_organization_member(organization_id))',
      v_table || '_select_member', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_insert_member', v_table);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.is_organization_member(organization_id))',
      v_table || '_insert_member', v_table);

    execute format('drop policy if exists %I on public.%I', v_table || '_update_member', v_table);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_organization_member(organization_id))
         with check (public.is_organization_member(organization_id))',
      v_table || '_update_member', v_table);

    execute format('grant select, insert, update on table public.%I to authenticated', v_table);
  end loop;
end;
$$;
