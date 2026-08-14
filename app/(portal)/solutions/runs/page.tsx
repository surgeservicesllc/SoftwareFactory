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
    </>
  );
}
