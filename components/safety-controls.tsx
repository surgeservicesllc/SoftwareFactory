import { LockKeyhole } from "lucide-react";

import { StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";

const automationControls = [
  {
    label: "Autonomous mode",
    plain: "Work by itself",
    description: "Off. Nothing starts without you asking for it.",
  },
  {
    label: "Auto approve",
    plain: "Approve its own work",
    description: "Off. A policy check is never an approval.",
  },
  {
    label: "Auto merge",
    plain: "Merge pull requests",
    description: "Off. No merge endpoint, permission, or workflow exists.",
  },
  {
    label: "Auto deploy",
    plain: "Deploy to production",
    description: "Off. The deployment adapter is Not Connected.",
  },
  {
    label: "Auto rollback",
    plain: "Roll back a release",
    description: "Off. Rolling back stays something you do yourself.",
  },
] as const;

const riskTiers = [
  {
    key: "GREEN",
    title: "Allowed",
    description: "Small, reversible work that touches nothing sensitive.",
    enabled: true,
  },
  {
    key: "YELLOW",
    title: "Blocked",
    description: "Real behaviour changes. Outside what this phase may consider.",
    enabled: false,
  },
  {
    key: "RED",
    title: "Blocked",
    description: "Secrets, money, production data. Always needs your approval.",
    enabled: false,
  },
] as const;

export function SafetyControls({ compact = false }: { compact?: boolean }) {
  return (
    <div>
      <div className="flex items-start gap-3 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] px-4 py-3 text-sm text-[var(--danger)]">
        <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-semibold">Global kill switch ON.</span> Even if a task passed every
          check, nothing would run. There is no worker connected to run it.
        </p>
      </div>

      <section className="mt-6">
        <h3 className="label">Highest risk it may consider</h3>
        <div className={cn("mt-2 grid gap-2", compact ? "grid-cols-1" : "md:grid-cols-3")}>
          {riskTiers.map((tier) => (
            <div
              key={tier.key}
              className={cn(
                "rounded-lg border p-3",
                tier.enabled
                  ? "border-[var(--accent-border)] bg-[var(--accent-surface)]"
                  : "border-line",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{tier.key}</span>
                <StatusBadge tone={tier.enabled ? "safe" : "neutral"} dot={false}>
                  {tier.title}
                </StatusBadge>
              </div>
              <p className="mt-2 text-sm text-muted">{tier.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h3 className="label">What it may do without asking</h3>
        <ul className="mt-2 divide-y divide-[var(--border)] rounded-lg border border-line">
          {automationControls.map((control) => (
            <li key={control.label} className="flex items-start gap-4 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {control.plain}
                  <span className="ml-2 text-faint">{control.label}</span>
                </p>
                <p className="mt-1 text-sm text-muted">{control.description}</p>
              </div>
              <StatusBadge tone="neutral" dot={false}>
                OFF
              </StatusBadge>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-4 text-sm text-muted">
        A policy check can only ever answer WOULD_BE_ELIGIBLE or BLOCKED. It cannot approve, merge,
        deploy, roll back, or claim that any work actually ran.
      </p>
    </div>
  );
}
