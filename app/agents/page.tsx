import { AgentsConsole } from "@/components/agents-console";
import { PageHeader, StatusBadge } from "@/components/ui";

export default function AgentsPage() {
  return (
    <>
      <PageHeader
        title="Agents"
        description="The roles work is split into, and which provider and model each one is assigned. An agent is a job description, not a login."
        action={<StatusBadge tone="neutral">Worker Not Connected</StatusBadge>}
      />

      <AgentsConsole />

      <p className="mt-4 text-sm text-muted">
        Provider credentials live in server-side environment settings. They are never stored on an
        agent, and an assignment records only a provider and model identifier.
      </p>
    </>
  );
}
