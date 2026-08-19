"use client";

import { cn } from "@/lib/cn";

/**
 * Renders one AI account's recorded usage evidence: the provider-reported
 * subscription windows (session and weekly percentages), or the truthful
 * absence of them. Every state names itself — "no usage recorded yet" is a
 * different fact from "the probe failed", which is different again from "this
 * provider has no measurable usage" — because collapsing them is how a page
 * ends up claiming more than the data supports.
 */

export type AccountUsageWindow = {
  key: string;
  label: string;
  usedPercent: number;
  resetsAt: string | null;
};

export type AccountUsageView = {
  accountId: string;
  observedAt: string;
  status: string;
  windows: AccountUsageWindow[];
  detail: string | null;
  /**
   * The last observation whose probe returned real numbers, when the latest
   * one did not. One rate-limited probe (HTTP 429, 2026-08-19) used to erase
   * the measurement from the page and leave an amber failure line beside a
   * green Connected badge — the account was fine and looked broken.
   */
  lastMeasured?: {
    observedAt: string;
    windows: AccountUsageWindow[];
  } | null;
};

function formatShortTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function barTone(usedPercent: number): string {
  if (usedPercent >= 90) return "bg-[var(--danger)]";
  if (usedPercent >= 75) return "bg-[var(--warning)]";
  return "bg-[var(--accent)]";
}

export function AccountUsage({ usage }: { usage: AccountUsageView | undefined }) {
  if (!usage) {
    return (
      <p className="mt-1.5 text-xs text-[var(--text-muted)]">
        No usage recorded yet — the automatic sweep collects it on its next pass.
      </p>
    );
  }

  const observed = `as of ${formatShortTime(usage.observedAt)}`;

  if (usage.status === "unsupported") {
    return (
      <p className="mt-1.5 text-xs text-[var(--text-muted)]">
        Usage is not measurable for this provider yet ({observed}).
      </p>
    );
  }

  if (usage.status !== "measured" || usage.windows.length === 0) {
    const lastMeasured = usage.lastMeasured;
    if (lastMeasured && lastMeasured.windows.length > 0) {
      // The numbers are real and carry their own timestamp; the failed newer
      // probe is named below them rather than allowed to erase them. The
      // account's health is the badge's statement, not this line's.
      return (
        <div className="mt-2 space-y-1.5">
          {lastMeasured.windows.map((window) => (
            <UsageWindowRow key={window.key} window={window} />
          ))}
          <p className="text-xs text-[var(--text-faint)]">
            Provider-reported usage, as of {formatShortTime(lastMeasured.observedAt)}.
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            The newer probe ({observed}) could not refresh this
            {usage.detail ? `: ${usage.detail}` : "."}
          </p>
        </div>
      );
    }
    // No measurement has ever succeeded. Still a statement about the probe,
    // not the account — a failed usage reading demotes nothing, so it renders
    // as information rather than as the alarm the amber tone implied.
    return (
      <p className="mt-1.5 text-xs text-[var(--text-muted)]">
        Usage not measured yet ({observed})
        {usage.detail ? ` — ${usage.detail}` : "."}
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      {usage.windows.map((window) => (
        <UsageWindowRow key={window.key} window={window} />
      ))}
      <p className="text-xs text-[var(--text-faint)]">Provider-reported usage, {observed}.</p>
    </div>
  );
}

function UsageWindowRow({ window }: { window: AccountUsageWindow }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <span className="w-36 shrink-0 text-xs text-[var(--text-muted)]">{window.label}</span>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={window.usedPercent}
        aria-label={`${window.label} usage`}
        className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-[var(--surface-inset)]"
      >
        <div
          className={cn("h-full rounded-full", barTone(window.usedPercent))}
          style={{ width: `${Math.min(100, Math.max(0, window.usedPercent))}%` }}
        />
      </div>
      <span className="text-xs font-medium tabular-nums text-[var(--text)]">
        {window.usedPercent}% used
      </span>
      {window.resetsAt ? (
        <span className="text-xs text-[var(--text-faint)]">
          resets {formatShortTime(window.resetsAt)}
        </span>
      ) : null}
    </div>
  );
}
