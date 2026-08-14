import { AuthReadinessNotice } from "@/components/auth-readiness-notice";
import { ConnectionsConsole } from "@/components/connections-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Connections",
};

export default function ConnectionsPage() {
  return (
    <>
      <PageHeader
        title="Connections"
        description="Give SoftwareFactory read access to the repositories you choose. You stay in control of which ones."
      />
      <AuthReadinessNotice />
      <ConnectionsConsole />
    </>
  );
}
