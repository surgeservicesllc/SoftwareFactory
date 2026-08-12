import { Activity, Filter, Fingerprint, Search } from "lucide-react";

import { DemoBadge, DemoNotice, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { demoActivity } from "@/lib/demo-data";

export default function ActivityPage() {
  return (
    <>
      <PageHeader
        eyebrow="Evidence / Activity"
        title="Activity & audit trail"
        description="A chronological evidence surface for material actions, actors, targets, correlation identifiers, and redacted metadata."
        action={<DemoBadge />}
      />
      <DemoNotice>These entries are illustrative UI records. They were not emitted by a live provider, agent, deployment, or production audit system.</DemoNotice>

      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#212b37] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-[#95a83a]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-[#e1e6ea]">Event stream</h2>
          </div>
          <div className="flex gap-2">
            <button type="button" className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#293442] bg-[#10161e] px-2.5 text-[9px] text-[#798696]"><Search className="size-3" aria-hidden="true" />Search events</button>
            <button type="button" className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#293442] bg-[#10161e] px-2.5 text-[9px] text-[#798696]"><Filter className="size-3" aria-hidden="true" />Filter</button>
          </div>
        </div>

        <div className="divide-y divide-[#202a36]">
          {demoActivity.map((event, index) => (
            <article key={event.id} className="grid gap-3 p-4 sm:grid-cols-[28px_minmax(0,1fr)_150px] sm:p-5">
              <span className={`mt-0.5 grid size-7 place-items-center rounded-lg border ${event.tone === "safe" ? "border-[#33451e] bg-[#18220f] text-[#c6f135]" : event.tone === "warning" ? "border-[#4b3c23] bg-[#2c2112] text-[#ffbe55]" : event.tone === "danger" ? "border-[#4a292e] bg-[#2b171b] text-[#ff7d84]" : "border-[#233f4a] bg-[#10232b] text-[#60d8ff]"}`}>
                <Fingerprint className="size-3.5" aria-hidden="true" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xs font-semibold text-[#d8dee5]">{event.action}</h3>
                  <DemoBadge />
                </div>
                <p className="mt-1 text-[10px] leading-5 text-[#718090]">{event.detail}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#4f5b69]">
                  <span>Actor · {event.actor}</span>
                  <span>Target · demo-project</span>
                  <span>Correlation · DEMO-{String(index + 1).padStart(4, "0")}</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end sm:justify-start">
                <time className="font-mono text-[9px] text-[#596675]">{event.time}</time>
                <StatusBadge tone="neutral" dot={false}>Redacted metadata</StatusBadge>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </>
  );
}
