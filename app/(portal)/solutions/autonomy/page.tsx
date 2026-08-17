import { AutonomyConsole } from "@/components/autonomy-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Autonomy",
};

export default function AutonomyPage() {
  return (
    <>
      <PageHeader
        title="Autonomy"
        description="What the autonomous loop is permitted to do, and every decision it has reached. The switches live on Settings and are owner-only; this page shows the resolved result."
      />
      <AutonomyConsole />
    </>
  );
}
