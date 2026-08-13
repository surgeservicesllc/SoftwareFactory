import { Clock3, Play, ShieldCheck } from "lucide-react";

import { DemoBadge, DemoNotice, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { demoRuns } from "@/lib/demo-data";

export default function RunsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Execution / Runs"
        title="Runs"
        description="Immutable execution evidence will live here once authenticated workers exist. The examples below demonstrate the future evidence model."
        action={<StatusBadge tone="neutral">Worker Not Connected</StatusBadge>}
      />
      <DemoNotice>No AI worker produced these examples. They demonstrate how future agent runs will present risk, assignment, state, and duration.</DemoNotice>

      <div className="grid gap-3">
        {demoRuns.map((run) => (
          <Panel key={run.id} className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-[#2d3947] bg-[#151d27] text-[#8fa132]">
                  <Play className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[9px] text-[#596675]">{run.id}</span>
                    <DemoBadge />
                  </div>
                  <h2 className="mt-1.5 truncate text-xs font-semibold text-[#dce2e8]">{run.command}</h2>
                  <p className="mt-1 text-[10px] text-[#687586]">Assigned definition: {run.agent} Agent</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-5 md:min-w-[360px]">
                <div><p className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#4f5b69]">State</p><p className="mt-1 text-[10px] font-medium text-[#9ca8b6]">{run.state}</p></div>
                <div><p className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#4f5b69]">Risk</p><div className="mt-1"><StatusBadge tone={run.risk === "GREEN" ? "safe" : "warning"}>{run.risk}</StatusBadge></div></div>
                <div><p className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#4f5b69]">Duration</p><p className="mt-1 flex items-center gap-1 text-[10px] text-[#9ca8b6]"><Clock3 className="size-3" aria-hidden="true" />{run.duration}</p></div>
              </div>
            </div>
          </Panel>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#30401e] bg-[#18210f] px-4 py-3 text-[10px] leading-5 text-[#9bad64]">
        <ShieldCheck className="size-4 shrink-0 text-[#c6f135]" aria-hidden="true" />
        Future runs must record the exact actor, model/provider, policy version, inputs, outputs, validation, approvals, and correlated activity events.
      </div>
    </>
  );
}
