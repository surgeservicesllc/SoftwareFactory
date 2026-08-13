import { RunDetailConsole } from "@/components/run-detail-console";
import { PageHeader } from "@/components/ui";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  return (
    <>
      <PageHeader
        eyebrow="Execution / Run detail"
        title="Run evidence"
        description="The owner command, plan, isolated workspace, append-only event timeline, structured result, and real CI outcome for one run."
      />
      <RunDetailConsole runId={runId} />
    </>
  );
}
