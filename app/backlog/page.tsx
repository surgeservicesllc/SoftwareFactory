import { BacklogConsole } from "@/components/backlog-console";
import { PageHeader } from "@/components/ui";

export default function BacklogPage() {
  return (
    <>
      <PageHeader
        title="Backlog"
        description="Work waiting on refinement, evidence, approval, or execution."
      />
      <BacklogConsole />
    </>
  );
}
