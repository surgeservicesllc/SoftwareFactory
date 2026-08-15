import { ProjectDetailConsole } from "@/components/project-detail-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Project detail",
};

/**
 * Per-project detail under the portfolio.
 *
 * The id is passed to a client console that reads the RLS-scoped portfolio
 * aggregate, so this page grants no visibility the caller lacks and cannot
 * disagree with the portfolio list about a single number.
 */
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <>
      <PageHeader
        title="Project detail"
        description="One project's work and health, from the same truthful aggregate as the portfolio. Counts read Unknown when their source could not be read."
      />
      <ProjectDetailConsole projectId={projectId} />
    </>
  );
}
