-- The capability→stage mapping learns the two build-side specialists.
--
-- 20260823000700 derived a stage for every stage-less node from its
-- capability, 20260823000900 taught it the discovery trio, and
-- tests/unit/graph-stage-mapping-agreement.test.ts holds that SQL to
-- `stageForCapability()` so the two copies of the one rule cannot drift. The
-- application now defines `database` and `deployment`, so the SQL side gains
-- the same two branches — in this file rather than by editing either earlier
-- migration, both of which are applied and recorded on hosted and must never
-- change under their ledger rows.
--
-- `deployment` exists because the DEPLOYMENT stage had no capability of its
-- own and borrowed `implementation`. Any node written under that borrowing
-- already carries its stage explicitly, so this changes no existing row; what
-- it does is make the derivation correct for any stage-less row that appears
-- from here on.
--
-- Unlike 20260823000900 this needs no companion enum migration. Both target
-- values, IMPLEMENTATION and DEPLOYMENT, have been in `public.sdlc_stage`
-- since 20260821000200, so the casts below are already settled vocabulary and
-- there is no new value whose addition would have to commit first.
--
-- Idempotent by the same rule as its predecessors: `where lifecycle_stage is
-- null` means a replay is a no-op and an explicitly declared stage is never
-- overwritten by a derived one.

update public.graph_nodes
set lifecycle_stage = case capability
    when 'database' then 'IMPLEMENTATION'::public.sdlc_stage
    when 'deployment' then 'DEPLOYMENT'::public.sdlc_stage
  end
where lifecycle_stage is null
  and capability in (
    'database', 'deployment'
  );

do $postflight$
begin
  -- No node with a known capability may still be stage-less — the same gate
  -- the applied backfill's scope enforced, now over fourteen capabilities.
  if exists (
    select 1 from public.graph_nodes
     where lifecycle_stage is null
       and capability in (
         'qa', 'implementation', 'architecture', 'planning',
         'extraction', 'review', 'security_review', 'synthesis', 'reporting',
         'discovery', 'evaluation', 'decision',
         'database', 'deployment'
       )
  ) then
    raise exception using errcode = '55000',
      message = '20260830000500 postflight: a node with a known capability has no lifecycle stage';
  end if;
end;
$postflight$;
