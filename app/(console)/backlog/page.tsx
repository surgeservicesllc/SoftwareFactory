import { Filter, ListTodo, Search } from "lucide-react";

import { DemoBadge, DemoNotice, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { demoBacklog } from "@/lib/demo-data";

export default function BacklogPage() {
  return (
    <>
      <PageHeader
        eyebrow="Planning / Backlog"
        title="Backlog"
        description="A prioritized view of work awaiting refinement, evidence, approval, or execution. This foundation uses illustrative items only."
        action={<DemoBadge />}
      />
      <DemoNotice>Backlog items on this page are illustrative and are not synchronized with GitHub Issues or a live planning system.</DemoNotice>

      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#212b37] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <ListTodo className="size-4 text-[#8b9d2e]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-[#e3e8ec]">Phase 1 delivery queue</h2>
          </div>
          <div className="flex gap-2">
            <button type="button" className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#293442] bg-[#10161e] px-2.5 text-[9px] text-[#798696]"><Search className="size-3" aria-hidden="true" />Search</button>
            <button type="button" className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[#293442] bg-[#10161e] px-2.5 text-[9px] text-[#798696]"><Filter className="size-3" aria-hidden="true" />Filter</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="border-b border-[#202a36] bg-[#0b1017] font-mono text-[8px] uppercase tracking-[0.12em] text-[#596675]">
              <tr><th className="px-4 py-3 font-medium">ID</th><th className="px-4 py-3 font-medium">Work item</th><th className="px-4 py-3 font-medium">Priority</th><th className="px-4 py-3 font-medium">Risk</th><th className="px-4 py-3 font-medium">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-[#202a36]">
              {demoBacklog.map((item) => (
                <tr key={item.id} className="transition-colors hover:bg-[#111821]">
                  <td className="px-4 py-4 font-mono text-[9px] text-[#647182]">{item.id}</td>
                  <td className="px-4 py-4 text-xs font-medium text-[#cfd6dd]">{item.title}</td>
                  <td className="px-4 py-4"><StatusBadge tone={item.priority === "P0" ? "danger" : item.priority === "P1" ? "warning" : "neutral"} dot={false}>{item.priority}</StatusBadge></td>
                  <td className="px-4 py-4"><StatusBadge tone={item.risk === "GREEN" ? "safe" : item.risk === "YELLOW" ? "warning" : "danger"}>{item.risk}</StatusBadge></td>
                  <td className="px-4 py-4 text-[10px] text-[#7d8998]">{item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
