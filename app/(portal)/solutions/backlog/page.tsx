import { BacklogConsole } from "@/components/backlog-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Backlog",
};

export default function BacklogPage() {
  return (
    <>
      <PageHeader
        title="Backlog"
        description="Real planned work with priority, risk, dependencies, assignment, runs, and pull-request evidence."
      />
      <BacklogConsole />
    </>
  );
}
