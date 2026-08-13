import { ArrowRight, BrainCircuit, ClipboardCheck, PlayCircle, Route, ShieldCheck } from "lucide-react";

import { CommandComposer } from "@/components/command-composer";
import { EmptyState, PageHeader, Panel, SectionTitle, StatusBadge } from "@/components/ui";

export default function BotManagerPage() {
  return (
    <>
      <PageHeader
        eyebrow="Command / Bot Manager"
        title="Direct the factory"
        description="Capture an engineering objective, see which provider the Orchestrator would route it to and why, and run it as an advisory task with a durable audit record."
        action={<StatusBadge tone="neutral">Advisory runs only</StatusBadge>}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <CommandComposer />
          <Panel className="mt-5 p-5 sm:p-6">
            <SectionTitle title="Recent commands" description="Authenticated organization commands appear here once Supabase is connected." />
            <div className="mt-5">
              <EmptyState
                title="No persisted commands available"
                description="Connect Supabase and sign in to submit the first command. Demo activity is intentionally excluded from this operational list."
              />
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel className="p-5">
            <SectionTitle title="Command lifecycle" description="Every step leaves evidence, and the boundary is explicit." />
            <ol className="mt-5 space-y-4">
              {[
                [BrainCircuit, "1", "Describe intent", "A person provides a bounded outcome and declares its risk."],
                [ShieldCheck, "2", "Validate policy", "Server-side checks enforce identity, ownership, and the risk ceiling."],
                [Route, "3", "Route to a provider", "The Orchestrator scores capability, availability, latency, and cost, and records why."],
                [ClipboardCheck, "4", "Run and record", "The provider returns a structured artifact stored with its routing evidence."],
                [PlayCircle, "5", "Stop before mutation", "A run never writes to a repository, merges, deploys, or approves."],
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
              A completed provider run is analysis, not delivery. Applying its recommendation is a
              separate owner action through the branch, commit, and draft pull-request flow, and
              RED work still requires explicit owner approval.
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
