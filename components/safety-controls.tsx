"use client";

import { AlertTriangle, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";

type AutomationKey = "autonomousMode" | "autoApprove" | "autoMerge" | "autoDeploy" | "autoRollback";

const automationControls: Array<{
  key: AutomationKey;
  label: string;
  description: string;
}> = [
  {
    key: "autonomousMode",
    label: "Autonomous mode",
    description: "Allows eligible work to proceed within project policy. Phase 1A has no execution worker.",
  },
  {
    key: "autoApprove",
    label: "Auto approve",
    description: "Would approve eligible actions automatically. Kept OFF; never applies to RED actions.",
  },
  {
    key: "autoMerge",
    label: "Auto merge",
    description: "Would merge eligible pull requests only after future branch and validation gates exist.",
  },
  {
    key: "autoDeploy",
    label: "Auto deploy",
    description: "Would promote validated releases. Production deployment execution is not connected.",
  },
  {
    key: "autoRollback",
    label: "Auto rollback",
    description: "Would revert a narrowly eligible deployment. Disabled until rollback drills prove safety.",
  },
];

const riskTiers = [
  {
    key: "GREEN",
    title: "Low risk",
    description: "Narrow, easily reversible changes with no protected-resource contact.",
    color: "border-[#3e541d] bg-[#1a250f] text-[#c6f135]",
  },
  {
    key: "YELLOW",
    title: "Enhanced validation",
    description: "Meaningful but testable changes that need additional evidence and review.",
    color: "border-[#594623] bg-[#2e2311] text-[#ffbe55]",
  },
  {
    key: "RED",
    title: "Owner approval",
    description: "Sensitive or high-impact actions. Explicit owner approval is always required in Phase 1.",
    color: "border-[#562d32] bg-[#30191d] text-[#ff7d84]",
  },
] as const;

export function SafetyControls({ compact = false }: { compact?: boolean }) {
  const [risk, setRisk] = useState<(typeof riskTiers)[number]["key"]>("GREEN");
  const [controls, setControls] = useState<Record<AutomationKey, boolean>>({
    autonomousMode: false,
    autoApprove: false,
    autoMerge: false,
    autoDeploy: false,
    autoRollback: false,
  });
  const [dirty, setDirty] = useState(false);

  function toggleControl(key: AutomationKey) {
    setControls((current) => ({ ...current, [key]: !current[key] }));
    setDirty(true);
  }

  return (
    <div>
      <div className="flex items-start gap-3 rounded-lg border border-[#423824] bg-[#221c11] px-3.5 py-3 text-[11px] leading-5 text-[#b5a478]">
        <LockKeyhole className="mt-0.5 size-4 shrink-0 text-[#ffbe55]" aria-hidden="true" />
        <div>
          <span className="font-semibold text-[#e2cd91]">Policy preview only.</span> Changes below are local draft state and are not saved or executed without an authenticated Supabase project workflow.
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="eyebrow">Maximum autonomous risk</legend>
        <div className={cn("mt-3 grid gap-2", compact ? "grid-cols-1" : "md:grid-cols-3")}>
          {riskTiers.map((tier) => {
            const selected = risk === tier.key;
            return (
              <button
                key={tier.key}
                type="button"
                onClick={() => {
                  setRisk(tier.key);
                  setDirty(true);
                }}
                aria-pressed={selected}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  selected ? tier.color : "border-[#283341] bg-[#0b1017] text-[#8592a2] hover:border-[#374454]",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] font-bold tracking-[0.12em]">{tier.key}</span>
                  {selected ? <ShieldCheck className="size-3.5" aria-hidden="true" /> : null}
                </span>
                <span className="mt-2 block text-xs font-semibold text-[#d7dde4]">{tier.title}</span>
                <span className="mt-1.5 block text-[10px] leading-4 text-[#697687]">{tier.description}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="eyebrow">Automation controls</legend>
        <div className="mt-3 divide-y divide-[#202a36] rounded-lg border border-[#26313e] bg-[#0b1017] px-4">
          {automationControls.map((control) => (
            <label key={control.key} className="flex cursor-pointer items-start gap-4 py-4">
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-[#dbe1e7]">{control.label}</span>
                <span className="mt-1 block text-[10px] leading-4 text-[#6e7b8b]">{control.description}</span>
              </span>
              <input
                type="checkbox"
                className="peer sr-only"
                checked={controls[control.key]}
                onChange={() => toggleControl(control.key)}
                aria-label={control.label}
              />
              <span className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full border border-[#3a4655] bg-[#171e28] transition-colors after:absolute after:left-[3px] after:top-[3px] after:size-3 after:rounded-full after:bg-[#6f7b89] after:transition-transform peer-checked:border-[#506924] peer-checked:bg-[#24310f] peer-checked:after:translate-x-4 peer-checked:after:bg-[#c6f135] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#c6f135]" aria-hidden="true" />
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-[10px] text-[#687586]">
          <AlertTriangle className="size-3.5 text-[#ffbe55]" aria-hidden="true" />
          RED remains owner-gated regardless of the selected maximum.
        </p>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => setDirty(false)}
          className="min-h-9 rounded-lg border border-[#34411c] bg-[#c6f135]/[0.07] px-3 text-xs font-semibold text-[#dffb7b] disabled:cursor-not-allowed disabled:border-[#28313c] disabled:bg-[#11161e] disabled:text-[#56616e]"
        >
          {dirty ? "Reset unsaved preview" : "No unsaved preview changes"}
        </button>
      </div>
    </div>
  );
}
