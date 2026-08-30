with expected_projects(organization_id, project_id, project_name) as (values
  ('2614f3b2-ac24-4353-bda6-320a8c254d3b'::uuid,
   'b1f23696-437e-4d89-b55f-d7a949980e8f'::uuid, 'SoftwareFactory'),
  ('96be00cc-6bf9-42a3-9931-97f9595bda0b'::uuid,
   'bd90348c-41f4-487c-9681-6b4a4ca911e4'::uuid, 'SoftwareFactory'),
  ('96be00cc-6bf9-42a3-9931-97f9595bda0b'::uuid,
   'f8de941d-dc9e-4c66-9d3a-00cd61c2d794'::uuid, 'SoftwareFactory_08.17.2026'),
  ('96be00cc-6bf9-42a3-9931-97f9595bda0b'::uuid,
   '34afd05b-6550-41ae-a397-913b9f44966a'::uuid, 'SoftwareFactory_08.21.2026')
), target_projects as (
  select expected.project_name, expected.project_id, p.organization_id,
         p.id is not null as project_present,
         o.autonomous_mode as org_autonomous_mode,
         o.maximum_autonomous_risk::text as org_max_risk,
         (o.auto_plan or o.auto_code or o.auto_test or o.auto_repair
          or o.auto_review or o.auto_approve or o.auto_merge
          or o.auto_deploy or o.auto_rollback) as org_any_auto_action,
         o.autonomy_kill_switch_active as org_kill_switch_active,
         p.autonomous_mode as project_autonomous_mode,
         p.maximum_autonomous_risk::text as project_max_risk,
         (p.auto_plan or p.auto_code or p.auto_test or p.auto_repair
          or p.auto_review or p.auto_approve or p.auto_merge
          or p.auto_deploy or p.auto_rollback) as project_any_auto_action
  from expected_projects expected
  left join public.projects p
    on p.id = expected.project_id
   and p.organization_id = expected.organization_id
   and p.name = expected.project_name
  left join public.organizations o on o.id = p.organization_id
)
select project_name, project_id, project_present,
       org_kill_switch_active, org_autonomous_mode, org_max_risk,
       org_any_auto_action, project_autonomous_mode, project_max_risk,
       project_any_auto_action,
       (select controls.kill_switch_active
          from public.resolved_autonomy_controls(target_projects.project_id) controls
         ) as resolved_kill_switch_active,
       (select controls.executor_connected
          from public.resolved_autonomy_controls(target_projects.project_id) controls
         ) as resolved_executor_connected,
       (
         select event.metadata ->> 'active'
         from public.activity_events event
         where event.organization_id = target_projects.organization_id
           and event.event_type::text = 'autonomy.kill_switch_changed'
           and event.entity_type = 'organization'
           and event.entity_id = target_projects.organization_id
         order by event.created_at desc, event.id desc
         limit 1
       ) as newest_kill_switch_event_active,
       (
         select case
           when event.event_type::text = 'project.autonomous_mode_changed'
             then event.metadata ->> 'to'
           else event.metadata ->> 'autonomousMode'
         end
         from public.activity_events event
         where event.organization_id = target_projects.organization_id
           and (event.project_id = target_projects.project_id
                or event.entity_id = target_projects.project_id)
           and (
             event.event_type::text = 'project.autonomous_mode_changed'
             or event.event_type::text = 'autonomy.controls_changed'
           )
         order by event.created_at desc, event.id desc
         limit 1
       ) as newest_project_autonomy_event
  from target_projects
 order by project_name, project_id;
