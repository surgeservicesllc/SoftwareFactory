import { AgentsConsole } from "@/components/agents-console";
import { PageHeader } from "@/components/ui";

export default function AgentsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Workforce / Agent definitions"
        title="Agents"
        description="The operating roles this factory assigns work to, with their provider, model, current run, and real success metrics. An agent is a role — not a provider login."
      />
      <AgentsConsole />
    </>
  );
}
