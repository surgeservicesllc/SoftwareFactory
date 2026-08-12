import { Bot, BrainCircuit, Cpu, Layers3, RadioTower, ShieldCheck } from "lucide-react";

import { DemoNotice, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { agents } from "@/lib/demo-data";

export default function AgentsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Workforce / Agent definitions"
        title="Agents"
        description="Role and capability definitions for future coordinated work. An agent is an operating role—not an OpenAI, Anthropic, or other provider login."
        action={<StatusBadge tone="neutral">0 active</StatusBadge>}
      />
      <DemoNotice>
        These are built-in role definitions only. Providers, models, assignments, and execution workers are not connected.
      </DemoNotice>

      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {agents.map((agent, index) => (
          <Panel key={agent.name} className="group overflow-hidden p-5 transition-colors hover:border-[#33404f]">
            <div className="flex items-start justify-between gap-3">
              <span className="grid size-10 place-items-center rounded-xl border border-[#2c3947] bg-[#151d27] text-[#a5b849]">
                {index === 0 ? <RadioTower className="size-[18px]" aria-hidden="true" /> : index === 6 ? <ShieldCheck className="size-[18px]" aria-hidden="true" /> : index === 8 ? <BrainCircuit className="size-[18px]" aria-hidden="true" /> : <Bot className="size-[18px]" aria-hidden="true" />}
              </span>
              <StatusBadge tone="neutral">Inactive</StatusBadge>
            </div>
            <div className="mt-4">
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-[#6b7888]">{agent.role}</p>
              <h2 className="mt-1.5 text-base font-semibold tracking-[-0.025em] text-[#edf1f4]">{agent.name}</h2>
              <p className="mt-2 min-h-12 text-[11px] leading-5 text-[#748191]">{agent.description}</p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#26313d] bg-[#26313d]">
              <Meta label="Provider" value="Not configured" />
              <Meta label="Model" value="Not selected" />
              <Meta label="Assignment" value="Unassigned" />
              <Meta label="Last run" value="Never" />
            </div>
            <div className="mt-4">
              <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#566270]">Capabilities</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {agent.capabilities.map((capability) => (
                  <span key={capability} className="rounded border border-[#2a3542] bg-[#111821] px-2 py-1 text-[9px] text-[#8290a0]">{capability}</span>
                ))}
              </div>
            </div>
          </Panel>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#26313e] bg-[#0b1017] px-4 py-3 text-[10px] leading-5 text-[#6d7a8a]">
        <Layers3 className="size-4 shrink-0 text-[#849528]" aria-hidden="true" />
        Provider credentials belong to server-side Connection records. They are never stored on an agent definition.
        <Cpu className="ml-auto hidden size-4 text-[#414c59] sm:block" aria-hidden="true" />
      </div>
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0a0f16] p-2.5">
      <p className="font-mono text-[7px] uppercase tracking-[0.11em] text-[#4e5967]">{label}</p>
      <p className="mt-1 truncate text-[9px] font-medium text-[#8c99a9]">{value}</p>
    </div>
  );
}
