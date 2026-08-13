import { BacklogConsole } from "@/components/backlog-console";
import { PageHeader } from "@/components/ui";

export default function BacklogPage() {
  return (
    <>
      <PageHeader
        eyebrow="Planning / Backlog"
        title="Backlog"
        description="Tenant-scoped work items with acceptance criteria, priority, risk, source, dependencies, and their linked command, run, and pull request."
      />
      <BacklogConsole />
    </>
  );
}
