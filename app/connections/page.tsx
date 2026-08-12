import { ConnectionsConsole } from "@/components/connections-console";
import { PageHeader, StatusBadge } from "@/components/ui";

export default function ConnectionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Providers / GitHub App"
        title="Connections"
        description="Authorize GitHub, choose an account or organization, select repositories, and synchronize live source-control metadata without exposing installation credentials."
        action={<StatusBadge tone="warning">Autonomous Mode OFF</StatusBadge>}
      />
      <ConnectionsConsole />
    </>
  );
}
