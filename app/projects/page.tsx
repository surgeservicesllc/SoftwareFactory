import { ProjectsConsole } from "@/components/projects-console";
import { PageHeader } from "@/components/ui";

export default function ProjectsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Portfolio / Live projects"
        title="Projects"
        description="Connect an authorized GitHub repository and branch to a tenant-scoped Supabase project. Repository files, pull requests, and checks stay tied to this boundary."
      />
      <ProjectsConsole />
    </>
  );
}
