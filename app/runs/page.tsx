import { Suspense } from "react";

import { RunsConsole } from "@/components/runs-console";
import { PageHeader, Panel, StatusBadge } from "@/components/ui";

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ commandId?: string; status?: string }>;
}) {
  const { commandId } = await searchParams;

  return (
    <>
      <PageHeader
        eyebrow="Execution / Runs"
        title="Runs"
        description="Every worker run with its agent, provider, risk, branch, pull request, and real validation outcome. A run's state is durable; closing this page does not stop or lose it."
        action={<StatusBadge tone="neutral">Draft pull requests only</StatusBadge>}
      />
      <Suspense fallback={<Panel className="min-h-[320px] animate-pulse"><span className="sr-only">Loading runs</span></Panel>}>
        <RunsConsole initialCommandId={commandId} />
      </Suspense>
    </>
  );
}
