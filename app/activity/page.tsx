import { Fingerprint } from "lucide-react";

import { ActivityConsole } from "@/components/activity-console";
import { PageHeader } from "@/components/ui";

export default function ActivityPage() {
  return (
    <>
      <PageHeader
        eyebrow="Evidence / Activity"
        title="Activity & audit trail"
        description="A searchable, filterable record of material actions with their actor, project, target, and time. Events are append-only and never carry raw metadata into the browser."
      />
      <ActivityConsole />

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#26313e] bg-[#0b1017] px-4 py-3 text-[10px] leading-5 text-[#7b8999]">
        <Fingerprint className="size-3.5 shrink-0 text-[#829d29]" aria-hidden="true" />
        Per-run execution events are recorded separately and shown on each run detail page.
      </div>
    </>
  );
}
