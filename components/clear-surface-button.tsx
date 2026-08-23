"use client";

import { useState } from "react";

/**
 * The confirm-reason-clear control, shared by the Backlog and All Pipelines
 * pages.
 *
 * One component because the two clears are the same decision applied to
 * different rows, and the moment they are two components they start to
 * disagree — one grows a confirmation step the other lacks, one reports counts
 * the other swallows. The Runs page's Clear Finished control established this
 * shape; this is that shape, made reusable.
 *
 * Three things it will not do:
 *
 *  - Fire on one press. Clearing is irreversible, so the first press asks.
 *  - Send without a reason. The database refuses under ten characters, and
 *    finding that out after a confirmation dialog is a worse experience than
 *    the field simply being required here too.
 *  - Report a clean sweep it did not perform. The result names what was kept
 *    and why, because "cleared" over a list that still has rows in it is the
 *    kind of small lie that costs someone their trust in the whole surface.
 */

export type ClearOutcome = Readonly<{
  deletedCount: number;
  keptRunning: number;
  keptWithRuns: number;
}>;

type Phase = "idle" | "confirming" | "pending";

export function ClearSurfaceButton({
  endpoint,
  label,
  noun,
  includeFlagName,
  includeFlagLabel,
  onCleared,
}: {
  endpoint: string;
  /** The button's text — "Clear backlog", "Clear all pipelines". */
  label: string;
  /** What is being counted, singular. "work item", "pipeline". */
  noun: string;
  /** The request field that opts into deleting rows carrying run history. */
  includeFlagName: string;
  includeFlagLabel: string;
  onCleared: () => void | Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [reason, setReason] = useState("");
  const [includeWithRuns, setIncludeWithRuns] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const reasonIsUsable = reason.trim().length >= 10;

  async function clear() {
    setPhase("pending");
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), [includeFlagName]: includeWithRuns }),
      });
      const body = (await response.json()) as {
        cleared?: ClearOutcome;
        error?: { message?: string };
      };
      if (!response.ok || !body.cleared) {
        setFailed(true);
        setMessage(body.error?.message ?? `The ${noun}s could not be cleared.`);
        setPhase("confirming");
        return;
      }

      const { deletedCount, keptRunning, keptWithRuns } = body.cleared;
      // Say what was kept. A count of zero deleted is still a real answer and
      // reads very differently from silence.
      const kept: string[] = [];
      if (keptRunning > 0) kept.push(`${keptRunning} still running`);
      if (keptWithRuns > 0) kept.push(`${keptWithRuns} with run history`);
      setMessage(
        `${deletedCount} ${noun}${deletedCount === 1 ? "" : "s"} cleared.`
        + (kept.length > 0 ? ` Kept: ${kept.join(", ")}.` : ""),
      );
      setPhase("idle");
      setReason("");
      setIncludeWithRuns(false);
      await onCleared();
    } catch {
      setFailed(true);
      setMessage(`The ${noun}s could not be cleared.`);
      setPhase("confirming");
    }
  }

  if (phase === "idle") {
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={() => {
            setPhase("confirming");
            setMessage("");
          }}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:border-[var(--danger,#f87171)] hover:text-[var(--danger,#f87171)]"
        >
          {label}
        </button>
        {message ? (
          <p role="status" className="text-xs text-[var(--text-muted)]">{message}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-sm font-medium text-[var(--text)]">{label}?</p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        This cannot be undone. Anything currently running is left alone, and so is
        anything whose deletion would take run history with it — unless you say
        otherwise below.
      </p>

      <label className="mt-3 block text-xs text-[var(--text-muted)]" htmlFor="clear-reason">
        Reason (recorded in the activity log, 10 characters minimum)
      </label>
      <input
        id="clear-reason"
        className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why is this being cleared?"
      />

      <label className="mt-3 flex items-start gap-2 text-xs text-[var(--text-muted)]">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={includeWithRuns}
          onChange={(event) => setIncludeWithRuns(event.target.checked)}
        />
        <span>{includeFlagLabel}</span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!reasonIsUsable || phase === "pending"}
          onClick={() => void clear()}
          className="rounded-md bg-[var(--danger,#b91c1c)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {phase === "pending" ? "Clearing…" : `Yes, ${label.toLowerCase()}`}
        </button>
        <button
          type="button"
          disabled={phase === "pending"}
          onClick={() => {
            setPhase("idle");
            setReason("");
            setIncludeWithRuns(false);
            setMessage("");
          }}
          className="text-xs text-[var(--accent)] underline"
        >
          Cancel
        </button>
      </div>

      {message ? (
        <p
          role={failed ? "alert" : "status"}
          className={`mt-2 text-xs ${failed ? "text-[var(--danger,#f87171)]" : "text-[var(--text-muted)]"}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
