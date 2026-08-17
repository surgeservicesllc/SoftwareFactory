import { RunsConsole } from "@/components/runs-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Runs",
};

export default function RunsPage() {
  return (
    <>
      <PageHeader
        title="Runs"
        description="Durable agent and provider execution records with routing, repository, validation, pull request, CI, cost, and outcome evidence."
      />

      <RunsConsole />

      <p className="mt-4 text-sm text-muted">
        Run details expose bounded evidence only. Prompts, raw provider traces, secrets, and unrestricted outputs stay behind the server boundary. No run can merge or deploy.
      </p>

      <p className="mt-2 text-sm text-muted">
        Open a run to record a review, or to delete it. A review — a triage status and
        a note — is the editable part of a run; what the run actually did is evidence
        and stays read-only. Deleting is owner-only, needs a reason, is refused while a
        worker still holds the lease, and is recorded in the activity trail before it
        happens. A run that produced a pull request, a deployment or a test run is
        refused unless you choose to keep those records and unlink them.
      </p>
    </>
  );
}
