select assignment.id, project.name as project, bot.name as bot,
       assignment.model as assignment_model, assignment.repository_access,
       assignment.can_open_pull_request, assignment.pipeline_access,
       assignment.requires_human_approval, assignment.max_concurrent_tasks,
       assignment.work_effort
  from public.bot_assignments assignment
  join public.bots bot on bot.id = assignment.bot_id
  join public.projects project on project.id = assignment.project_id
 order by project.name, bot.name;
