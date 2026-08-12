import { RunsConsole } from "@/components/runs-console";
import { PageHeader, StatusBadge } from "@/components/ui";

export default function RunsPage() {
  return (
    <>
      <PageHeader
        title="Runs"
        description="A record of every job an agent performed, kept so you can check the work afterwards."
        action={<StatusBadge tone="neutral">Worker Not Connected</StatusBadge>}
      />
      <RunsConsole />
      <p className="mt-4 text-sm text-muted">
        A run records who asked for it, which agent ran it, how long it took, and how it ended. Run
        inputs and outputs stay on the server.
      </p>
    </>
  );
}
