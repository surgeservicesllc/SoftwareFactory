-- The lifecycle grows the three stages it was waiting to earn.
--
-- ADR-136 held DISCOVERY, EVALUATION and DECISION out of `sdlc_stage` on one
-- condition: "the prerequisite is a capability that produces them, not an
-- enum value". That condition is now met — the application defines the
-- `discovery`, `evaluation` and `decision` node capabilities, their outputs
-- are the typed stage packages in lib/graph/stage-packages.ts, and the
-- `open_source_scout` template launches nodes in all three stages. An enum
-- value something can populate is vocabulary; before that it was scaffolding.
--
-- Placement matters: the three sit between PRD and ARCHITECTURE — look before
-- you build — so each is added BEFORE 'ARCHITECTURE', in order, and the enum
-- reads GOAL, PRD, DISCOVERY, EVALUATION, DECISION, ARCHITECTURE, ... exactly
-- as SDLC_STAGES does in the application.
--
-- This file only adds the values and deliberately never *uses* one:
-- PostgreSQL refuses a cast to an enum value inside the transaction that
-- added it, and the hosted apply runs each migration under `psql -1`. The
-- companion file 20260823000900 casts and maps in its own transaction — the
-- same two-file arrangement the clear-controls migrations used for the same
-- reason. The postflight below reads pg_catalog only, which is safe in-txn.
--
-- Replay-safe: `add value if not exists` three times over. No table, row,
-- policy, grant, run, autonomy or approval state changes.

alter type public.sdlc_stage add value if not exists 'DISCOVERY' before 'ARCHITECTURE';
alter type public.sdlc_stage add value if not exists 'EVALUATION' before 'ARCHITECTURE';
alter type public.sdlc_stage add value if not exists 'DECISION' before 'ARCHITECTURE';

do $postflight$
declare
  v_labels text[];
begin
  select array_agg(enumlabel order by enumsortorder) into v_labels
    from pg_enum
   where enumtypid = 'public.sdlc_stage'::regtype;

  if v_labels is distinct from array[
    'GOAL', 'PRD', 'DISCOVERY', 'EVALUATION', 'DECISION', 'ARCHITECTURE',
    'IMPLEMENTATION', 'REVIEW', 'TEST', 'DEPLOYMENT', 'MONITORING'
  ] then
    raise exception using errcode = '55000',
      message = format(
        '20260823000800 postflight: sdlc_stage reads %s, not the eleven stages in lifecycle order',
        array_to_string(v_labels, ',')
      );
  end if;
end;
$postflight$;
