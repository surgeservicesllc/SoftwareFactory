import { ProjectsConsole } from "@/components/projects-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Projects",
};

export default function ProjectsPage() {
  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project is one GitHub repository. Open one to see its branches, commits, and pull requests."
      />
      <ProjectsConsole />
    </>
  );
}
