select project.name, project.github_repository, project.default_branch,
       connection.status as connection_status, installation.status as installation_status,
       repository.selected, repository.default_branch as repo_default_branch
  from public.projects project
  left join public.project_connections link on link.project_id = project.id and link.is_primary
  left join public.connections connection on connection.id = link.connection_id
  left join public.github_installations installation on installation.connection_id = connection.id
  left join public.github_repositories repository on repository.id = link.github_repository_id
 order by project.name;
