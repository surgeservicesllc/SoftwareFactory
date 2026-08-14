import { ReportsConsole } from "@/components/reports-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Reports",
};

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="What got done, what is blocked, and what needs a decision from you."
      />
      <ReportsConsole />
      <p className="mt-4 text-sm text-muted">
        Reports use bounded persisted command, run, validation, pull-request, CI, and audit evidence. Missing evidence stays visibly missing.
      </p>
    </>
  );
}
