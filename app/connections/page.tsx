import { ConnectionsConsole } from "@/components/connections-console";
import { PageHeader } from "@/components/ui";

export default function ConnectionsPage() {
  return (
    <>
      <PageHeader
        title="Connections"
        description="Give SoftwareFactory read access to the repositories you choose. You stay in control of which ones."
      />
      <ConnectionsConsole />
    </>
  );
}
