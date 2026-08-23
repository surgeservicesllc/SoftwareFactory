"use client";

import { useState } from "react";

/**
 * Clear the Autonomy list, from the Autonomy page.
 *
 * The list has one row per project the loop can still act on, so emptying it
 * means archiving those projects. Deleting them is a designed impossibility —
 * `refuse_project_deletion` states that a project's append-only trail makes
 * it permanent and names archiving as the supported end of its life — and
 * archiving reaches the same visible outcome while deleting nothing.
 *
 * It keeps the three rules `ClearSurfaceButton` wrote down:
 *
 *  - Fire on one press? No. The first press asks.
 *  - Send without a reason? No. The database refuses under ten characters.
 *  - Report a sweep it did not perform? No. The result separates what it
 *    archived from what was already archived.
 *
 * And it says plainly that nothing was destroyed, so "cleared" is never read
 * as "gone".
 */

export type ClearProjectsOutcome = Readonly<{
  archivedCount: number;
  alreadyArchived: number;
}>;

type Phase = "idle" | "confirming" | "pending";

export function ClearProjectsButton({ onCleared }: { onCleared: () => void | Promise<void> }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const reasonIsUsable = reason.trim().length >= 10;

  async function clear() {
    setPhase("pending");
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch("/api/autonomy/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = (await response.json()) as {
        cleared?: ClearProjectsOutcome;
        error?: { message?: string };
      };
      if (!response.ok || !body.cleared) {
        setFailed(true);
        setMessage(body.error?.message ?? "The projects could not be cleared.");
        setPhase("confirming");
        return;
      }

      const { archivedCount, alreadyArchived } = body.cleared;
      setMessage(
        `${archivedCount} project${archivedCount === 1 ? "" : "s"} archived.`
        + (alreadyArchived > 0 ? ` ${alreadyArchived} already were.` : "")
        + " Nothing was deleted — every run, task and command is kept, and"
        + " projects can be unarchived from the Projects page.",
      );
      setPhase("idle");
      setReason("");
      await onCleared();
    } catch {
      setFailed(true);
      setMessage("The projects could not be cleared.");
      setPhase("confirming");
    }
  }

  if (phase === "idle") {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => {
            setPhase("confirming");
            setMessage("");
          }}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:border-[var(--danger,#f87171)] hover:text-[var(--danger,#f87171)]"
        >
          Clear
        </button>
        {message ? (
          <p role="status" className="text-xs text-[var(--text-muted)]">{message}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-sm font-medium text-[var(--text)]">Clear this list?</p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Every project here is archived, which is what empties this list: the loop
        can claim no work for an archived project. Nothing is deleted — every
        run, task, command and activity row is kept, and any project can be
        unarchived from the Projects page.
      </p>

      <label className="mt-3 block text-xs text-[var(--text-muted)]" htmlFor="clear-projects-reason">
        Reason (recorded in the activity log, 10 characters minimum)
      </label>
      <input
        id="clear-projects-reason"
        className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why is everything being cleared?"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!reasonIsUsable || phase === "pending"}
          onClick={() => void clear()}
          className="rounded-md bg-[var(--danger,#b91c1c)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {phase === "pending" ? "Clearing…" : "Yes, archive them all"}
        </button>
        <button
          type="button"
          disabled={phase === "pending"}
          onClick={() => {
            setPhase("idle");
            setReason("");
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
