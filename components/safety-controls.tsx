import { AlertTriangle, LockKeyhole, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/cn";

const automationControls = [
  {
    label: "Autonomous mode",
    state: "OFF",
    description:
      "Project owners may later enable observation-only evaluation. No worker or external action is connected.",
  },
  {
    label: "Auto approve",
    state: "OFF",
    description: "Locked OFF. An observation result is never an approval.",
  },
  {
    label: "Auto merge",
    state: "OFF",
    description: "Locked OFF. No merge endpoint, permission, or workflow exists.",
  },
  {
    label: "Auto deploy",
    state: "OFF",
    description: "Locked OFF. The in-product deployment adapter is Not Connected.",
  },
  {
    label: "Auto rollback",
    state: "OFF",
    description: "Locked OFF. Rollback remains an owner-operated production mutation.",
  },
] as const;

const riskTiers = [
  {
    key: "GREEN",
    title: "Observation ceiling",
    description: "The only eligible classification; still requires fresh evidence and no protected-resource contact.",
    enabled: true,
  },
  {
    key: "YELLOW",
    title: "Blocked",
    description: "Meaningful changes remain outside Phase 1D observation eligibility.",
    enabled: false,
  },
  {
    key: "RED",
    title: "Blocked",
    description: "Sensitive actions require exact owner approval and can never inherit autonomous authority here.",
    enabled: false,
  },
] as const;

export function SafetyControls({ compact = false }: { compact?: boolean }) {
  return (
    <div>
      <div className="flex items-start gap-3 rounded-lg border border-[#4a2d32] bg-[#25161a] px-3.5 py-3 text-[11px] leading-5 text-[#d6a1a6]">
        <LockKeyhole className="mt-0.5 size-4 shrink-0 text-[#ff7d84]" aria-hidden="true" />
        <div>
          <span className="font-semibold text-[#ffc1c5]">Global kill switch ON.</span>{" "}
          Phase 1D is observation-only scaffolding. Execution remains blocked even when a GREEN candidate would satisfy every policy prerequisite.
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="eyebrow">Maximum autonomous risk</legend>
        <div className={cn("mt-3 grid gap-2", compact ? "grid-cols-1" : "md:grid-cols-3")}>
          {riskTiers.map((tier) => (
            <div
              key={tier.key}
              className={cn(
                "rounded-lg border p-3",
                tier.enabled
                  ? "border-[#3e541d] bg-[#1a250f] text-[#c6f135]"
                  : "border-[#283341] bg-[#0b1017] text-[#687586]",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] font-bold tracking-[0.12em]">{tier.key}</span>
                {tier.enabled ? <ShieldCheck className="size-3.5" aria-label="Selected ceiling" /> : <LockKeyhole className="size-3.5" aria-label="Locked" />}
              </span>
              <span className="mt-2 block text-xs font-semibold text-[#d7dde4]">{tier.title}</span>
              <span className="mt-1.5 block text-[10px] leading-4 text-[#697687]">{tier.description}</span>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="eyebrow">Automation controls</legend>
        <div className="mt-3 divide-y divide-[#202a36] rounded-lg border border-[#26313e] bg-[#0b1017] px-4">
          {automationControls.map((control) => (
            <div key={control.label} className="flex items-start gap-4 py-4">
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-[#dbe1e7]">{control.label}</span>
                <span className="mt-1 block text-[10px] leading-4 text-[#6e7b8b]">{control.description}</span>
              </span>
              <span className="rounded-full border border-[#3a4655] bg-[#171e28] px-2 py-1 font-mono text-[9px] font-semibold tracking-[0.12em] text-[#8b97a5]">
                {control.state}
              </span>
            </div>
          ))}
        </div>
      </fieldset>

      <p className="mt-4 flex items-start gap-2 text-[10px] leading-5 text-[#7d8997]">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#ffbe55]" aria-hidden="true" />
        A policy evaluation can only report WOULD_BE_ELIGIBLE or BLOCKED. It cannot approve, merge, deploy, rollback, or claim that work ran.
      </p>
    </div>
  );
}
