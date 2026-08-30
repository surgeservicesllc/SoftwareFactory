            select project.id, project.organization_id, project.name,
                   project.status, project.created_at
              from public.projects project
             where project.name in (
               'SoftwareFactory', 'SoftwareFactory_08.17.2026',
               'SoftwareFactory_08.21.2026'
             )
             order by project.created_at;
