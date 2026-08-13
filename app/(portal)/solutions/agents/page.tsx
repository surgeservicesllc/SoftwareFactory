import { AgentsConsole } from "@/components/agents-console";
import { PageHeader } from "@/components/ui";

export const metadata = {
  title: "Agents",
};

export default function AgentsPage() {
  return (
    <>
      <PageHeader
        title="Agents"
        description="The logical roles work is split into, with provider and model selected per run. An agent is a job description, not a login."
      />

      <AgentsConsole />

      <p className="mt-4 text-sm text-muted">
        Provider credentials live in server-side environment settings. They are never stored on an
        agent, and assignments retain only non-secret provider and model identifiers.
      </p>
    </>
  );
}
