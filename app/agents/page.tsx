import { Cpu, Layers3 } from "lucide-react";

import { AgentsConsole } from "@/components/agents-console";
import { PageHeader } from "@/components/ui";

export default function AgentsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Workforce / Agent definitions"
        title="Agents"
        description="Role and capability definitions with their provider assignments. An agent is an operating role—not an OpenAI, Anthropic, or other provider login."
      />

      <AgentsConsole />

      <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#26313e] bg-[#0b1017] px-4 py-3 text-[10px] leading-5 text-[#6d7a8a]">
        <Layers3 className="size-4 shrink-0 text-[#849528]" aria-hidden="true" />
        Provider credentials belong to server-side environment settings. They are never stored on an
        agent definition, and an assignment records only a provider and model identifier.
        <Cpu className="ml-auto hidden size-4 text-[#414c59] sm:block" aria-hidden="true" />
      </div>
    </>
  );
}
