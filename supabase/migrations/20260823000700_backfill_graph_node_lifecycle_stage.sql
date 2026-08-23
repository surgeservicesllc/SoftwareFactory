-- Give the graphs already in the database the stage their nodes always had.
--
-- `graph_nodes.lifecycle_stage` arrived with the Agentic SDLC migration
-- (20260821000200) and is written from the launch plan at graph creation. Until
-- the templates learned to supply it, only `agentic_sdlc` graphs carried one,
-- so every audit graph — which is every graph the Run analysis button
-- produces, including the first real Step 9 run — stored null on every node.
-- The graph-runs panel has a Stage column reading exactly this field, and it
-- showed an em dash for all of them.
--
-- The stage is not new information. It is a property of the work the node
-- does, which the row already records as `capability`, so this derives it
-- rather than inventing it: the same mapping `stageForCapability()` applies in
-- the application, asserted against this file by
-- tests/unit/graph-stage-mapping-agreement.test.ts so the two cannot drift.
--
-- Scope and safety:
--   * only rows where `lifecycle_stage is null` are touched, so a replay is a
--     no-op and a stage some template declared explicitly is never overwritten;
--   * `capability` is free text (1-60 chars), not an enum, so a value outside
--     the nine the application defines is left null rather than guessed — an
--     honest em dash beats a confident wrong stage;
--   * no run, artifact, autonomy, worker, provider or approval state changes.

update public.graph_nodes
set lifecycle_stage = case capability
    when 'qa' then 'TEST'::public.sdlc_stage
    when 'implementation' then 'IMPLEMENTATION'::public.sdlc_stage
    when 'architecture' then 'ARCHITECTURE'::public.sdlc_stage
    when 'planning' then 'PRD'::public.sdlc_stage
    -- Read-only work: inspecting, reducing and reporting on something that
    -- already exists is REVIEW, whatever the audit happens to be about.
    when 'extraction' then 'REVIEW'::public.sdlc_stage
    when 'review' then 'REVIEW'::public.sdlc_stage
    when 'security_review' then 'REVIEW'::public.sdlc_stage
    when 'synthesis' then 'REVIEW'::public.sdlc_stage
    when 'reporting' then 'REVIEW'::public.sdlc_stage
  end
where lifecycle_stage is null
  and capability in (
    'qa', 'implementation', 'architecture', 'planning',
    'extraction', 'review', 'security_review', 'synthesis', 'reporting'
  );
