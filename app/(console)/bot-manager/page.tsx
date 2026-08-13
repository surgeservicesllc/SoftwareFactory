import { ArrowRight, BrainCircuit, ClipboardCheck, PlayCircle, ShieldCheck } from "lucide-react";

import { BotFabricConsole } from "@/components/bot-fabric-console";
import { CommandComposer } from "@/components/command-composer";
import { PageHeader, Panel, SectionTitle, StatusBadge } from "@/components/ui";

export const metadata = {
  title: "Bot Manager | SoftwareFactory",
};

export default function BotManagerPage() {
  return (
    <>
      <PageHeader
        eyebrow="Command / Bot Manager"
        title="Run your bot fleet"
        description="Register any provider's bot, give it a role you wrote, and move it between projects in a click. The control plane records intent and evidence; it never invents an execution result."
        action={<StatusBadge tone="neutral">Worker Not Connected</StatusBadge>}
      />

      <BotFabricConsole />

      <div className="mt-8 grid gap-5 border-t border-[#1b2430] pt-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <SectionTitle
            title="Direct the factory"
            description="Capture an engineering objective, its declared risk boundary, and a durable audit record."
          />
          <div className="mt-5">
            <CommandComposer />
          </div>
        </div>

        <div className="space-y-4">
          <Panel className="p-5">
            <SectionTitle
              title="Command lifecycle"
              description="The current boundary is intentionally narrow."
            />
            <ol className="mt-5 space-y-4">
              {[
                [BrainCircuit, "1", "Describe intent", "A human provides a bounded outcome and declares risk."],
                [ShieldCheck, "2", "Validate policy", "Server-side checks enforce identity, ownership, and risk."],
                [ClipboardCheck, "3", "Persist and audit", "Command, queued task, and activity evidence are stored together."],
                [PlayCircle, "4", "Stop before execution", "Workers remain Not Connected."],
              ].map(([Icon, number, title, description]) => (
                <li key={title as string} className="flex gap-3">
                  <span className="relative grid size-8 shrink-0 place-items-center rounded-lg border border-[#2b3745] bg-[#131a24] text-[#829328]">
                    <Icon className="size-4" aria-hidden="true" />
                    <span className="absolute -left-1 -top-1 grid size-3.5 place-items-center rounded-full bg-[#202a36] font-mono text-[7px] text-[#99a5b3]">{number as string}</span>
                  </span>
                  <span>
                    <span className="block text-xs font-semibold text-[#d5dbe2]">{title as string}</span>
                    <span className="mt-1 block text-[10px] leading-4 text-[#6c7989]">{description as string}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel className="border-[#3d3422] bg-[#17130d] p-5">
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-[#b7995e]">Trust rule</p>
            <p className="mt-3 text-xs leading-5 text-[#a99979]">
              A registered bot, a role, and an assignment are all statements of intent. Work becomes
              real only when a future worker records evidence, validation, and required approval.
            </p>
            <a href="/files" className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#d1b575]">
              Read risk model
              <ArrowRight className="size-3" aria-hidden="true" />
            </a>
          </Panel>
        </div>
      </div>
    </>
  );
}
