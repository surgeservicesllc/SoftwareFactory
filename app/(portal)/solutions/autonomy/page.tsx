import { AutonomyConsole } from "@/components/autonomy-console";
import { PageHeader, StatusBadge } from "@/components/ui";

export const metadata = {
  title: "Autonomy",
};

export default function AutonomyPage() {
  return (
    <>
      <PageHeader
        title="Autonomy"
        description="What the autonomous loop is permitted to do, and every decision it has reached. Enabling an automatic action is an owner-approved change, so nothing here offers a switch."
        action={<StatusBadge tone="safe">Kill switch ON</StatusBadge>}
      />
      <AutonomyConsole />
    </>
  );
}
