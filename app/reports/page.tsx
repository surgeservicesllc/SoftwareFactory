import { ReportsConsole } from "@/components/reports-console";
import { PageHeader } from "@/components/ui";

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="What got done, what is blocked, and what needs a decision from you."
      />
      <ReportsConsole />
      <p className="mt-4 text-sm text-muted">
        Reports count only what your own audit records prove. Nothing here is written by a model
        narrating results it did not verify.
      </p>
    </>
  );
}
