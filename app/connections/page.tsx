import { ConnectionsConsole } from "@/components/connections-console";
import { ProviderConnections } from "@/components/provider-connections";
import { PageHeader, StatusBadge } from "@/components/ui";

export default function ConnectionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Providers / Connections"
        title="Connections"
        description="Every provider this factory can reach, what each one is authorized to do, and the exact owner action required where it is not connected. Credentials stay server-side."
        action={<StatusBadge tone="warning">Autonomous Mode OFF</StatusBadge>}
      />

      <ProviderConnections />

      <div className="mt-6">
        <ConnectionsConsole />
      </div>
    </>
  );
}
