import { ExternalLink, LockKeyhole, Settings2, Shield, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { SafetyControls } from "@/components/safety-controls";
import { PageHeader, Panel, SectionTitle, StatusBadge } from "@/components/ui";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Governance / Settings"
        title="Autonomy & safety"
        description="Review the observation-only Phase 1D safety boundary. It evaluates prerequisites without granting execution authority."
        action={<StatusBadge tone="danger">Kill switch ON</StatusBadge>}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel className="p-5 sm:p-6">
          <SectionTitle title="Autonomous controls" description="GREEN-only observation is scaffolded; every externally mutating capability is locked OFF." />
          <div className="mt-5">
            <SafetyControls />
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-5">
            <SectionTitle title="Risk model" description="The highest matching risk criterion wins." />
            <div className="mt-4 space-y-2">
              {[
                ["GREEN", "Low risk", "Reversible, narrow, no protected resources", "safe"],
                ["YELLOW", "Meaningful", "Testable with enhanced validation", "warning"],
                ["RED", "High impact", "Owner approval mandatory in Phase 1", "danger"],
              ].map(([tier, title, detail, tone]) => (
                <div key={tier} className="rounded-lg border border-[#293442] bg-[#0a0f16] p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-[#d5dbe2]">{title}</p>
                    <StatusBadge tone={tone as "safe" | "warning" | "danger"}>{tier}</StatusBadge>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-4 text-[#6a7787]">{detail}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="border-[#3f292d] bg-[#171013] p-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#e4b1b5]">
              <LockKeyhole className="size-4 text-[#ff7d84]" aria-hidden="true" />
              Protected resources
            </div>
            <p className="mt-2 text-[10px] leading-5 text-[#9a7479]">Money, production data, secrets, authentication, RLS, security controls, DNS, domains, and release permissions always receive elevated review.</p>
            <Link href="/files" className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#cf9297]">Open policies <ExternalLink className="size-3" aria-hidden="true" /></Link>
          </Panel>

          <Panel className="p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-[#30401e] bg-[#18210f] text-[#c6f135]"><Shield className="size-4" aria-hidden="true" /></span>
              <div>
                <p className="text-xs font-semibold text-[#d5dbe2]">Global safety boundary</p>
                <p className="mt-1 text-[10px] leading-5 text-[#6a7787]">No client control can override organization policy, owner approval, a protected-resource rule, the global kill switch, or the disconnected executor boundary.</p>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#423824] bg-[#221c11] px-4 py-3 text-[10px] leading-5 text-[#b6a77f]">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[#ffbe55]" aria-hidden="true" />
        This page shows the enforced Phase 1D ceiling. Project control writes are owner-scoped and audited in Supabase, while observation mode remains locked OFF and execution remains unavailable.
        <Settings2 className="ml-auto hidden size-4 text-[#665c41] sm:block" aria-hidden="true" />
      </div>
    </>
  );
}
