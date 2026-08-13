import { BotManagerConsole } from "@/components/bot-manager-console";
import { PageHeader } from "@/components/ui";

export default function BotManagerPage() {
  return (
    <>
      <PageHeader
        eyebrow="Command / Bot Manager"
        title="Direct the factory"
        description="Describe an engineering objective. The orchestrator classifies intent and risk, plans the work, assigns agents, and records a durable command that survives a refresh or a restart."
      />
      <BotManagerConsole />
    </>
  );
}
