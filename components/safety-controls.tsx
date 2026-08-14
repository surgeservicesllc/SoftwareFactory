import { LockKeyhole } from "lucide-react";

import { StatusBadge } from "@/components/ui";
import {
  AUTOMATIC_ACTIONS,
  DEFAULT_AUTONOMY_CONTROLS,
  resolveEffectiveControls,
  type AutomaticAction,
  type AutonomyRestriction,
} from "@/lib/autonomy/controls";
import { cn } from "@/lib/cn";

/**
 * One row per automatic action, in the order the loop would run them.
 *
 * Keyed off `AUTOMATIC_ACTIONS` rather than a hand-written list, so a control
 * added to the model cannot quietly go missing from the page a reader uses to
 * check what this thing is allowed to do.
 */
const ACTION_COPY: Readonly<Record<AutomaticAction, { plain: string; description: string }>> = {
  plan: { plain: "Decide what to work on", description: "Nothing enters the queue without you putting it there." },
  code: { plain: "Write the change", description: "No execution worker is connected." },
  test: { plain: "Run its own checks", description: "Verification is reported to you, never self-certified." },
  repair: { plain: "Fix its own failures", description: "A failure opens bounded repair work for a human." },
  review: { plain: "Review the change", description: "Review agents run when you ask, and only produce findings." },
  approve: { plain: "Approve its own work", description: "A policy check is never an approval." },
  merge: { plain: "Merge pull requests", description: "No merge endpoint, permission, or workflow exists." },
  deploy: { plain: "Deploy to production", description: "The deployment adapter is Not Connected." },
  rollback: { plain: "Roll back a release", description: "Rolling back stays something you do yourself." },
};

/** The reasons every action is held off, whatever a project has configured. */
const RESTRICTION_COPY: Readonly<Record<AutonomyRestriction, string>> = {
  GLOBAL_KILL_SWITCH_ACTIVE: "The global kill switch is on.",
  EMERGENCY_STOP_ACTIVE: "An emergency stop is in effect.",
  RELEASE_FROZEN: "Releases are frozen for this project.",
  EXECUTOR_NOT_CONNECTED: "No execution worker is connected.",
  AUTONOMOUS_MODE_OFF_ORGANIZATION: "Autonomous mode is off for the organization.",
  AUTONOMOUS_MODE_OFF_PROJECT: "Autonomous mode is off for this project.",
};

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
    description: "Blocked for autonomous work. A manual request may still run within policy.",
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
  /**
   * Resolved through the same function the server and any future worker use,
   * against the interlocks this phase actually ships: kill switch on, no
   * executor. Rendering the resolution rather than a hard-coded "OFF" means
   * this page cannot drift from what the system would really decide.
   */
  const effective = resolveEffectiveControls(
    DEFAULT_AUTONOMY_CONTROLS,
    DEFAULT_AUTONOMY_CONTROLS,
    {
      killSwitchActive: true,
      emergencyStopActive: false,
      releaseFrozen: false,
      executorConnected: false,
    },
  );

  return (
    <div>
      <div className="flex items-start gap-3 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] px-4 py-3 text-sm text-[var(--danger)]">
        <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-semibold">Autonomous mode OFF.</span> SoftwareFactory cannot start
          work by itself. A manual GREEN or YELLOW request may run through a connected Phase 1C
          worker; RED work still requires explicit owner approval.
        </p>
      </div>

      <section className="mt-6">
        <h3 className="label">Highest risk autonomous mode may consider</h3>
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
          {AUTOMATIC_ACTIONS.map((action) => (
            <li key={action} className="flex items-start gap-4 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {ACTION_COPY[action].plain}
                  <span className="ml-2 text-faint">Auto {action}</span>
                </p>
                <p className="mt-1 text-sm text-muted">{ACTION_COPY[action].description}</p>
              </div>
              <StatusBadge tone={effective.actions[action] ? "warning" : "neutral"} dot={false}>
                {effective.actions[action] ? "ON" : "OFF"}
              </StatusBadge>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h3 className="label">Why every one of them is off</h3>
        <ul className="mt-2 space-y-1.5">
          {effective.restrictions.map((restriction) => (
            <li key={restriction} className="text-sm text-muted">
              {RESTRICTION_COPY[restriction]}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          These hold regardless of what any single project is set to. The strictest setting between
          your organization and a project is the one that applies.
        </p>
      </section>

      <p className="mt-4 text-sm text-muted">
        A policy check can only ever answer WOULD_BE_ELIGIBLE or BLOCKED. It cannot approve, merge,
        deploy, roll back, or claim that any work actually ran.
      </p>
    </div>
  );
}
