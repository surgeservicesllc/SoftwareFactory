import { AgentsConsole } from "@/components/agents-console";
import { PageHeader, StatusBadge } from "@/components/ui";

export default function AgentsPage() {
  return (
    <>
      <PageHeader
        title="Agents"
        description="The roles work is split into. An agent is a job description, not a login — credentials always live in server-side connection records."
        action={<StatusBadge tone="neutral">Worker Not Connected</StatusBadge>}
      />
      <AgentsConsole />
    </>
  );
}
