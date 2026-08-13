import { ActivityConsole } from "@/components/activity-console";
import { PageHeader } from "@/components/ui";

export default function ActivityPage() {
  return (
    <>
      <PageHeader
        title="Activity"
        description="Everything that has happened in your organization, in order, with who did it."
      />
      <ActivityConsole />
      <p className="mt-4 text-sm text-muted">
        These records cannot be edited or deleted, and they never contain secrets or file contents.
      </p>
    </>
  );
}
