"use client";

import { useState } from "react";

/**
 * Delete exactly the rows somebody ticked.
 *
 * `ClearSurfaceButton` is the same decision taken over a whole list; this is
 * that decision taken over a selection, and it keeps the three rules that
 * component wrote down, because a smaller blast radius is not a reason to
 * lower the bar:
 *
 *  - Fire on one press? No. Deleting is irreversible, so the first press asks.
 *  - Send without a reason? No. The database refuses under ten characters, and
 *    learning that after a confirmation dialog is worse than the field being
 *    required here.
 *  - Report a clean sweep it did not perform? No. The result names what was
 *    kept and why, including rows the organization no longer holds.
 */

export type SelectionDeleteOutcome = Readonly<{
  deletedCount: number;
  /** Live pipelines cancelled before removal — selecting one stops it. */
  stoppedCount: number;
  keptWithRuns: number;
  /** Cited by the improvement ledger, so never deleted. */
  keptWithEvidence: number;
  notFound: number;
  /** Analysis graphs detached; the graphs and their artifacts survive. */
  unlinkedAnalyses: number;
}>;

type Phase = "idle" | "confirming" | "pending";

export function SelectionDeleteButton({
  endpoint,
  selectedIds,
  noun,
  idFieldName,
  includeFlagName,
  includeFlagLabel,
  onDeleted,
}: {
  endpoint: string;
  /** The ids ticked right now. Empty means the control is inert. */
  selectedIds: readonly string[];
  /** What is being counted, singular. "pipeline". */
  noun: string;
  /** The request field carrying the selection. */
  idFieldName: string;
  /** The request field that opts into deleting rows carrying run history. */
  includeFlagName: string;
  includeFlagLabel: string;
  onDeleted: () => void | Promise<void>;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [reason, setReason] = useState("");
  const [includeWithRuns, setIncludeWithRuns] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const count = selectedIds.length;
  const reasonIsUsable = reason.trim().length >= 10;

  function reset() {
    setPhase("idle");
    setReason("");
    setIncludeWithRuns(false);
  }

  async function remove() {
    setPhase("pending");
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [idFieldName]: [...selectedIds],
          reason: reason.trim(),
          [includeFlagName]: includeWithRuns,
        }),
      });
      const body = (await response.json()) as {
        deleted?: SelectionDeleteOutcome;
        error?: { message?: string };
      };
      if (!response.ok || !body.deleted) {
        setFailed(true);
        setMessage(body.error?.message ?? `The selected ${noun}s could not be deleted.`);
        setPhase("confirming");
        return;
      }

      const {
        deletedCount, stoppedCount, keptWithRuns, keptWithEvidence, notFound, unlinkedAnalyses,
      } = body.deleted;
      const kept: string[] = [];
      if (keptWithRuns > 0) kept.push(`${keptWithRuns} with run history`);
      if (keptWithEvidence > 0) kept.push(`${keptWithEvidence} cited as evidence`);
      if (notFound > 0) kept.push(`${notFound} no longer here`);
      setMessage(
        `${deletedCount} ${noun}${deletedCount === 1 ? "" : "s"} deleted.`
        + (stoppedCount > 0 ? ` Stopped ${stoppedCount} that ${stoppedCount === 1 ? "was" : "were"} still running.` : "")
        // The graph outlives the request: saying so stops "deleted" reading
        // as though the bot's findings went with it.
        + (unlinkedAnalyses > 0
          ? ` ${unlinkedAnalyses} analysis run${unlinkedAnalyses === 1 ? "" : "s"} kept under Graph runs.`
          : "")
        + (kept.length > 0 ? ` Kept: ${kept.join(", ")}.` : ""),
      );
      reset();
      await onDeleted();
    } catch {
      setFailed(true);
      setMessage(`The selected ${noun}s could not be deleted.`);
      setPhase("confirming");
    }
  }

  if (phase === "idle") {
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          disabled={count === 0}
          onClick={() => {
            setPhase("confirming");
            setMessage("");
          }}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:border-[var(--danger,#f87171)] hover:text-[var(--danger,#f87171)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text)]"
        >
          {count === 0 ? `Delete selected` : `Delete selected (${count})`}
        </button>
        {message ? (
          <p role="status" className="text-xs text-[var(--text-muted)]">{message}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-sm font-medium text-[var(--text)]">
        Delete {count} selected {noun}{count === 1 ? "" : "s"}?
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        This cannot be undone. Anything still running is stopped first, then
        removed. Analysis runs and their artifacts are kept and stay readable
        under Graph runs. Anything whose deletion would take run history with
        it is left alone unless you say otherwise below.
      </p>

      <label className="mt-3 block text-xs text-[var(--text-muted)]" htmlFor="selection-delete-reason">
        Reason (recorded in the activity log, 10 characters minimum)
      </label>
      <input
        id="selection-delete-reason"
        className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why are these being deleted?"
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
          disabled={!reasonIsUsable || phase === "pending" || count === 0}
          onClick={() => void remove()}
          className="rounded-md bg-[var(--danger,#b91c1c)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {phase === "pending" ? "Deleting…" : `Yes, delete ${count === 1 ? `this ${noun}` : `these ${noun}s`}`}
        </button>
        <button
          type="button"
          disabled={phase === "pending"}
          onClick={() => {
            reset();
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
