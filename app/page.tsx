import { CheckCircle2, PackageCheck } from "lucide-react";

import { DashboardConsole } from "@/components/dashboard-console";
import { PageHeader, StatusBadge } from "@/components/ui";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        eyebrow="Executive overview / Phase 1C"
        title="Factory command center"
        description="A truthful operating view of the project portfolio, AI workforce, engineering delivery, and what needs an owner decision. Every figure is derived from tenant records."
        action={<StatusBadge tone="safe">Live control plane</StatusBadge>}
      />

      <DashboardConsole />

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#26313e] bg-[#0b1017] px-4 py-3 text-[10px] leading-5 text-[#7b8999]">
        <CheckCircle2 className="size-3.5 shrink-0 text-[#829d29]" aria-hidden="true" />
        Automatic approval, merge, deployment, and rollback remain unavailable. Worker runs end at a draft
        pull request that a human must review.
        <PackageCheck className="ml-auto hidden size-4 text-[#44505f] sm:block" aria-hidden="true" />
      </div>
    </>
  );
}
