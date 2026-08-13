import { RunsConsole } from "@/components/runs-console";
import { PageHeader, StatusBadge } from "@/components/ui";

export default function RunsPage() {
  return (
    <>
      <PageHeader
        title="Runs"
        description="Every job a provider ran: which model executed it, why that model was chosen, what it cost, and how it ended."
        action={<StatusBadge tone="neutral">Worker Not Connected</StatusBadge>}
      />

      <RunsConsole />

      <p className="mt-4 text-sm text-muted">
        A run records analysis only. It has no repository, merge, deployment, or approval authority
        &mdash; changing a file still goes through the branch, commit, and draft pull request you
        review. Run inputs and outputs stay on the server.
      </p>
    </>
  );
}
