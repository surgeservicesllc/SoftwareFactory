-- The built-in compound-engineer workflow.
--
-- docs/AGENTOS_SPEC.md §10, seeded exactly as specified: nine steps, spec
-- approval gated, human PR review gated, and the four plan reviewers spawned
-- by the coordinator at step 3.
--
-- Prompts here are RECONSTRUCTED from the AgentOS talk — not anyone's verbatim
-- prompt files. The spec requires that label, and it is repeated on every
-- seeded prompt below.
--
-- Seeding is a function rather than an INSERT because templates are
-- tenant-scoped: each organization gets its own copy, created on request by a
-- member, rather than a global row that RLS would have to special-case.

create or replace function public.agentos_seed_compound_engineer_template(
  p_organization_id uuid
)
returns public.agentos_task_templates
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_id uuid := auth.uid();
  template_record public.agentos_task_templates;
  reconstructed text := 'Reconstructed from the AgentOS talk — not a verbatim prompt. ';
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  -- Idempotent: seeding twice returns the existing template rather than
  -- creating a second copy or failing a caller who cannot tell the difference.
  select * into template_record
    from public.agentos_task_templates
   where organization_id = p_organization_id and name = 'compound-engineer-workflow';
  if found then
    return template_record;
  end if;

  insert into public.agentos_task_templates
    (organization_id, name, display_name, description, variables, is_builtin, created_by)
  values (
    p_organization_id,
    'compound-engineer-workflow',
    'Compound engineer feature build',
    'Spec, plan, multi-agent plan review, revise, implement with end-to-end tests, code review, apply fixes, update the wiki, then a human reviews and merges. Two steps are approval-gated and cannot be completed by an agent.',
    array['branchName', 'featureTitle'],
    true,
    caller_id
  )
  returning * into template_record;

  insert into public.agentos_task_template_steps
    (organization_id, template_id, step_index, name, agent_name, prompt, approval_gate, human_step)
  values
    (p_organization_id, template_record.id, 1, 'Write a spec', 'spec',
     reconstructed || 'Produce a detailed specification for {{featureTitle}}. State the problem, the proposed behaviour, the surfaces affected, and what is explicitly out of scope. Ask through the inbox if a decision is genuinely ambiguous rather than guessing. Attach the spec and stop; a human approves it before any work begins.',
     true, false),

    (p_organization_id, template_record.id, 2, 'Plan', 'plan',
     reconstructed || 'Turn the approved specification for {{featureTitle}} into a concrete ordered implementation plan. One job: the plan. Write the reasoning into the task activity so a reviewer can follow it. Do not write code.',
     false, false),

    (p_organization_id, template_record.id, 3, 'Plan review', 'review-coordinator',
     reconstructed || 'Spawn the four plan reviewers — feasibility, scope-guardian, coherence and plan-risk — and give each the plan for {{featureTitle}}. Consolidate their reports into a single must-fix and should-fix list. Do not fix anything yourself.',
     false, false),

    (p_organization_id, template_record.id, 4, 'Revise the plan', 'plan',
     reconstructed || 'Take the plan for {{featureTitle}} and the consolidated review. Address every must-fix. For each should-fix, either apply it or record why not.',
     false, false),

    (p_organization_id, template_record.id, 5, 'Implementation', 'implementation-plan-executioner',
     reconstructed || 'Implement the revised plan for {{featureTitle}} on branch {{branchName}}. Run the repository''s existing end-to-end tests as part of this work; if the repository has none, say so plainly rather than reporting a pass.',
     false, false),

    (p_organization_id, template_record.id, 6, 'Code review', 'review-coordinator',
     reconstructed || 'Review the implementation on {{branchName}}. Produce a consolidated must-fix and should-fix list covering correctness, tests and anything the plan promised but the diff does not do.',
     false, false),

    (p_organization_id, template_record.id, 7, 'Apply review fixes', 'senior-dev',
     reconstructed || 'Apply the must-fix items from the code review on {{branchName}}. Re-run the end-to-end tests afterwards.',
     false, false),

    (p_organization_id, template_record.id, 8, 'Update the wiki', 'librarian',
     reconstructed || 'Update the internal wiki to match how the codebase actually works after {{featureTitle}}. Describe what is there, not what the plan intended.',
     false, false),

    (p_organization_id, template_record.id, 9, 'Human review of the pull request', 'human',
     'A human checks out {{branchName}}, reviews the pull request for {{featureTitle}}, and merges it. No agent can complete this step.',
     true, true);

  return template_record;
end;
$function$;

comment on function public.agentos_seed_compound_engineer_template(uuid) is
  'Seeds the built-in nine-step feature workflow for one organization. Idempotent. Prompts are reconstructed, not verbatim.';

revoke all on function public.agentos_seed_compound_engineer_template(uuid)
  from public, anon, service_role;
grant execute on function public.agentos_seed_compound_engineer_template(uuid) to authenticated;
