import { ReportsConsole } from "@/components/reports-console";
import { PageHeader } from "@/components/ui";

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Intelligence / Daily CEO report"
        title="Daily operating report"
        description="Outcomes, quality, blockers, and owner decisions computed from tenant records at read time. Routine successful work is compressed; exceptions are named."
      />
      <ReportsConsole />
    </>
  );
}
