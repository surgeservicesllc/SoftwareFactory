import { AgentOsConsole } from "@/components/agentos-console";
import { PageHeader, StatusBadge } from "@/components/ui";

export const metadata = {
  title: "AgentOS",
};

export default function AgentOsPage() {
  return (
    <>
      <PageHeader
        title="AgentOS"
        description="What each agent may reach, what needs your decision, and where goals and chains have stopped. Nothing here runs work: no runner is connected."
        action={<StatusBadge tone="neutral">Runner Not Connected</StatusBadge>}
      />
      <AgentOsConsole />
    </>
  );
}
