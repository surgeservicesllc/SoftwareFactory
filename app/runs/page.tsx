import { ShieldCheck } from "lucide-react";

import { RunsConsole } from "@/components/runs-console";
import { PageHeader } from "@/components/ui";

export default function RunsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Execution / Runs"
        title="Runs"
        description="Recorded provider runs with the model that executed them, the routing decision behind that choice, token usage, and any fallback."
      />

      <RunsConsole />

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#30401e] bg-[#18210f] px-4 py-3 text-[10px] leading-5 text-[#9bad64]">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#c6f135]" aria-hidden="true" />
        A run records analysis only. Provider runs have no repository, merge, deployment, or
        approval authority; repository changes still require the owner-driven branch, commit, and
        draft pull-request flow.
      </div>
    </>
  );
}
