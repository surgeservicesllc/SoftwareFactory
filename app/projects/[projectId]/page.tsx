import { ProjectDetailConsole } from "@/components/project-detail-console";
import { PageHeader } from "@/components/ui";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <>
      <PageHeader
        eyebrow="Portfolio / Project"
        title="Project detail"
        description="Health, repository binding, backlog, runs, pull requests, deployments, activity, and settings for one project."
      />
      <ProjectDetailConsole projectId={projectId} />
    </>
  );
}
