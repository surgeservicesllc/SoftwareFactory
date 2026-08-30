"use client";

import { Loader2, LockKeyhole, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/ui";
import {
  AUTOMATIC_ACTIONS,
  type AutomaticAction,
  type AutomaticActionFlags,
} from "@/lib/autonomy/controls";
import { cn } from "@/lib/cn";

/**
 * The organization's safety controls, live and owner-operable (ADR-080).
 * Every switch reads and writes the real Supabase columns through the
 * owner-only, audit-evented RPCs — this page renders state, never decides
 * it. A flag ON still grants nothing the envelope refuses: the kill switch
 * forces everything off, and an action with no backing capability (merge,
 * deploy) records intent while the missing capability is named in place.
 */

const ACTION_COPY: Readonly<Record<AutomaticAction, { plain: string; description: string }>> = {
  plan: { plain: "Decide what to work on", description: "With this off, nothing enters the queue without you putting it there." },
  code: { plain: "Write the change", description: "Work still runs only when a connected worker claims it." },
  test: { plain: "Run its own checks", description: "Verification is reported to you, never self-certified." },
  repair: { plain: "Fix its own failures", description: "A failure opens bounded repair work." },
  review: { plain: "Review the change", description: "Review agents produce findings; a finding is not an approval." },
  approve: { plain: "Approve its own work", description: "A policy check is never an approval." },
  merge: { plain: "Merge pull requests", description: "No merge endpoint exists yet — this switch records your intent and nothing can act on it." },
  deploy: { plain: "Deploy to production", description: "The deployment adapter is Not Connected — this switch records your intent and nothing can act on it." },
  rollback: { plain: "Roll back a release", description: "Rolling back stays something you do yourself until a rollback path is proven." },
};

/** Actions whose backing capability does not exist yet; the flag is recorded intent only. */
const CAPABILITY_MISSING: ReadonlySet<AutomaticAction> = new Set(["merge", "deploy"]);

type ControlsView = {
  autonomousMode: boolean;
  maximumAutonomousRisk: string;
  actions: AutomaticActionFlags;
};

type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "error"; message: string }
  | { kind: "ready"; killSwitchActive: boolean; controls: ControlsView; canOperate: boolean };

export function SafetyControls({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/autonomy/controls", { cache: "no-store" });
      if (response.status === 401) {
        setState({ kind: "signed-out" });
        return;
      }
      const body = (await response.json()) as {
        killSwitchActive?: boolean;
        controls?: ControlsView;
        canOperate?: boolean;
        error?: { message?: string };
      };
      if (!response.ok || !body.controls) {
        throw new Error(body.error?.message ?? "Safety controls could not be loaded.");
      }
      setState({
        kind: "ready",
        killSwitchActive: Boolean(body.killSwitchActive),
        controls: body.controls,
        canOperate: Boolean(body.canOperate),
      });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Safety controls could not be loaded." });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const change = useCallback(async (key: string, payload: Record<string, unknown>) => {
    setBusyKey(key);
    setNotice("");
    try {
      const response = await fetch("/api/autonomy/controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The control could not be changed.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The control could not be changed.");
    } finally {
      setBusyKey("");
    }
  }, [load]);

  if (state.kind === "loading") {
    return (
      <div className="grid min-h-48 place-items-center">
        <Loader2 className="size-5 animate-spin text-accent" aria-label="Loading safety controls" />
      </div>
    );
  }
  if (state.kind === "signed-out") {
    return (
      <p className="flex items-start gap-3 rounded-lg border border-line px-4 py-3 text-sm text-muted">
        <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Sign in to see and operate your organization&apos;s safety controls. Signed out, every
        automatic action is off — that is the fail-closed default, not a display choice.
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p className="flex items-start gap-3 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] px-4 py-3 text-sm text-[var(--danger)]">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {state.message}
      </p>
    );
  }

  const { killSwitchActive, controls, canOperate } = state;
  const held = killSwitchActive || !controls.autonomousMode;

  return (
    <div>
      {notice ? (
        <p className="mb-4 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] px-4 py-3 text-sm text-[var(--danger)]" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <KillSwitchRow
        active={killSwitchActive}
        canOperate={canOperate}
        busy={busyKey === "kill_switch"}
        onChange={(active, reason) => void change("kill_switch", { control: "kill_switch", active, reason })}
      />

      <div
        className={cn(
          "mt-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
          controls.autonomousMode && !killSwitchActive
            ? "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning)]"
            : "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]",
        )}
      >
        <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p>
            <span className="font-semibold">
              Autonomous mode {controls.autonomousMode ? "ON" : "OFF"}.
            </span>{" "}
            {controls.autonomousMode
              ? killSwitchActive
                ? "Requested — but the kill switch holds everything off until you release it."
                : "Enabled actions below may proceed within the risk ceiling. RED work still requires your explicit approval."
              : "SoftwareFactory cannot start work by itself. A manual GREEN or YELLOW request may run through a connected worker; RED work still requires explicit owner approval."}
          </p>
        </div>
        {canOperate ? (
          <ToggleButton
            on={controls.autonomousMode}
            busy={busyKey === "autonomousMode"}
            label="Autonomous mode"
            onToggle={(next) => void change("autonomousMode", { control: "autonomy", autonomousMode: next })}
          />
        ) : null}
      </div>

      <section className="mt-6">
        <h3 className="label">Highest risk autonomous mode may consider</h3>
        <div className={cn("mt-2 grid gap-2", compact ? "grid-cols-1" : "md:grid-cols-3")}>
          {(["GREEN", "YELLOW", "RED"] as const).map((tier) => {
            const selected = controls.maximumAutonomousRisk === tier;
            const selectable = canOperate && tier !== "RED";
            return (
              <button
                key={tier}
                type="button"
                disabled={!selectable || busyKey === "risk"}
                aria-pressed={selected}
                onClick={() => {
                  if (!selected) void change("risk", { control: "autonomy", maximumAutonomousRisk: tier.toLowerCase() });
                }}
                className={cn(
                  "rounded-lg border p-3 text-left",
                  selected ? "border-[var(--accent-border)] bg-[var(--accent-surface)]" : "border-line",
                  selectable ? "transition-colors hover:border-line-strong" : "cursor-default",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{tier}</span>
                  <StatusBadge tone={selected ? "safe" : "neutral"} dot={false}>
                    {tier === "RED" ? "Never automatic" : selected ? "Ceiling" : "Available"}
                  </StatusBadge>
                </div>
                <p className="mt-2 text-sm text-muted">
                  {tier === "GREEN" && "Small, reversible work that touches nothing sensitive."}
                  {tier === "YELLOW" && "Reversible work with moderate blast radius, within policy."}
                  {tier === "RED" && "Secrets, money, production data. Always needs your approval — the database refuses a RED ceiling."}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-6">
        <h3 className="label">What it may do without asking</h3>
        <ul className="mt-2 divide-y divide-[var(--border)] rounded-lg border border-line">
          {AUTOMATIC_ACTIONS.map((action) => {
            const requested = controls.actions[action];
            const effective = requested && !held && !CAPABILITY_MISSING.has(action);
            return (
              <li key={action} className="flex items-start gap-4 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {ACTION_COPY[action].plain}
                    <span className="ml-2 text-faint">Auto {action}</span>
                  </p>
                  <p className="mt-1 text-sm text-muted">{ACTION_COPY[action].description}</p>
                  {requested && !effective ? (
                    <p className="mt-1 text-xs text-[var(--warning)]">
                      Switched on, held off:{" "}
                      {killSwitchActive
                        ? "the global kill switch is on."
                        : !controls.autonomousMode
                          ? "autonomous mode is off."
                          : "the backing capability does not exist yet."}
                    </p>
                  ) : null}
                </div>
                {canOperate ? (
                  <ToggleButton
                    on={requested}
                    busy={busyKey === action}
                    label={ACTION_COPY[action].plain}
                    onToggle={(next) => void change(action, {
                      control: "autonomy",
                      [`auto${action.charAt(0).toUpperCase()}${action.slice(1)}`]: next,
                    })}
                  />
                ) : (
                  <StatusBadge tone={requested ? "warning" : "neutral"} dot={false}>
                    {requested ? "ON" : "OFF"}
                  </StatusBadge>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <p className="mt-4 text-sm text-muted">
        Every change here is owner-only, recorded in the audit trail, and enforced in the database —
        a switch this page shows is the switch the server checks. A policy check can only ever answer
        WOULD_BE_ELIGIBLE or BLOCKED; it cannot approve, merge, deploy, or claim that work ran.
      </p>
    </div>
  );
}

function ToggleButton({
  on,
  busy,
  label,
  onToggle,
}: {
  on: boolean;
  busy: boolean;
  label: string;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={() => onToggle(!on)}
      className={cn(
        "btn btn-sm shrink-0 font-semibold",
        on ? "btn-primary" : "btn-secondary",
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {on ? "ON" : "OFF"}
    </button>
  );
}

/**
 * The kill switch itself. Engaging it is one click; releasing it asks for a
 * reason in place, because release is the consequential direction and the
 * database refuses it without one.
 */
function KillSwitchRow({
  active,
  canOperate,
  busy,
  onChange,
}: {
  active: boolean;
  canOperate: boolean;
  busy: boolean;
  onChange: (active: boolean, reason?: string) => void;
}) {
  const [releasing, setReleasing] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        active
          ? "border-[var(--danger-border)] bg-[var(--danger-surface)]"
          : "border-[var(--accent-border)] bg-[var(--accent-surface)]",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className={cn("font-semibold", active ? "text-[var(--danger)]" : "text-[var(--accent-text)]")}>
            Kill switch {active ? "ON" : "OFF"}.
          </span>{" "}
          <span className="text-muted">
            {active
              ? "Every automatic action resolves to off while this holds, whatever else is set."
              : "Automatic actions follow the switches below. Engage it to stop everything at once."}
          </span>
        </p>
        {canOperate ? (
          active ? (
            <button
              type="button"
              onClick={() => setReleasing((current) => !current)}
              disabled={busy}
              className="btn btn-secondary btn-sm"
            >
              Release…
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onChange(true)}
              disabled={busy}
              className="btn btn-primary btn-sm"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Engage kill switch
            </button>
          )
        ) : null}
      </div>
      {canOperate && active && releasing ? (
        <div className="mt-3 border-t border-[var(--danger-border)] pt-3">
          <label htmlFor="kill-switch-reason" className="field-label">
            Why release it?
          </label>
          <input
            id="kill-switch-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={400}
            className="input"
            placeholder="Enabling supervised GREEN work for the pilot project"
          />
          <span className="field-hint">Recorded in the audit trail with the release.</span>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                onChange(false, reason.trim());
                setReleasing(false);
                setReason("");
              }}
              disabled={busy || !reason.trim()}
              className="btn btn-primary btn-sm"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Release kill switch
            </button>
            <button type="button" onClick={() => setReleasing(false)} className="btn btn-secondary btn-sm">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
