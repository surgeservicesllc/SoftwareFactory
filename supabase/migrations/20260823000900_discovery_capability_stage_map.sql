-- The capability→stage mapping learns the three new capabilities.
--
-- 20260823000700 derived a stage for every stage-less node from its
-- capability, and tests/unit/graph-stage-mapping-agreement.test.ts holds that
-- SQL to `stageForCapability()` so the two copies of the one rule cannot
-- drift. The application now defines `discovery`, `evaluation` and
-- `decision`, so the SQL side gains the same three branches — in this file
-- rather than by editing 20260823000700, which is applied and recorded on
-- hosted and must never change under its ledger row.
--
-- Zero rows qualify today: the three capabilities are new, and every node the
-- launch plan writes carries its stage explicitly. This exists for the same
-- reason the original did — if a stage-less row with one of these
-- capabilities ever appears, the derivation is on record and idempotent,
-- `where lifecycle_stage is null` making a replay a no-op.
--
-- Separate from 20260823000800 because the casts below would be refused in
-- the transaction that added the enum values. By this file, they are settled
-- vocabulary.

update public.graph_nodes
set lifecycle_stage = case capability
    when 'discovery' then 'DISCOVERY'::public.sdlc_stage
    when 'evaluation' then 'EVALUATION'::public.sdlc_stage
    when 'decision' then 'DECISION'::public.sdlc_stage
  end
where lifecycle_stage is null
  and capability in (
    'discovery', 'evaluation', 'decision'
  );

do $postflight$
begin
  -- The casts this file exists to make must actually work now.
  if 'DISCOVERY'::public.sdlc_stage is null
    or 'EVALUATION'::public.sdlc_stage is null
    or 'DECISION'::public.sdlc_stage is null then
    raise exception using errcode = '55000',
      message = '20260823000900 postflight: a new stage value failed to cast';
  end if;

  -- And no node with a known capability may still be stage-less — the same
  -- gate the applied backfill's scope enforced, now over twelve capabilities.
  if exists (
    select 1 from public.graph_nodes
     where lifecycle_stage is null
       and capability in (
         'qa', 'implementation', 'architecture', 'planning',
         'extraction', 'review', 'security_review', 'synthesis', 'reporting',
         'discovery', 'evaluation', 'decision'
       )
  ) then
    raise exception using errcode = '55000',
      message = '20260823000900 postflight: a node with a known capability has no lifecycle stage';
  end if;
end;
$postflight$;
