"use client";

import { Archive, Loader2, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import type { Project } from "@/components/projects-console";

/**
 * Archiving several projects at once.
 *
 * Two things this deliberately does not do.
 *
 * It does not hard-delete, because nothing can: `refuse_project_deletion`
 * states the rule the schema has enforced since a project's first moment — an
 * append-only activity trail restricts the row, so `archive_project` is the
 * supported end of a project's life. The dialog says "delete" nowhere and
 * explains what archiving keeps, rather than offering a word the database will
 * not honour.
 *
 * It does not send one bulk request. Each project is archived through the same
 * owner-gated `archive_project` call a single archive makes, one at a time, and
 * the result of each is reported separately. A bulk endpoint would have to
 * decide what "partly succeeded" means; this way the answer is simply visible —
 * four archived, one refused, and the refusal says why.
 */

export type BulkOutcome = {
  readonly error: string | null;
  readonly name: string;
  readonly projectId: string;
};

export function BulkArchiveDialog({
  onClose,
  onFinished,
  projects,
}: {
  onClose: () => void;
  onFinished: () => Promise<void> | void;
  projects: readonly Project[];
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<readonly BulkOutcome[] | null>(null);

  async function archiveAll(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const outcomes: BulkOutcome[] = [];
    for (const project of projects) {
      try {
        const response = await fetch("/api/portfolio/controls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "archive",
            projectId: project.id,
            reason: reason.trim(),
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        outcomes.push({
          error: response.ok ? null : body.error?.message ?? "Refused.",
          name: project.name,
          projectId: project.id,
        });
      } catch (cause) {
        outcomes.push({
          error: cause instanceof Error ? cause.message : "The request failed.",
          name: project.name,
          projectId: project.id,
        });
      }
    }
    setDone(outcomes);
    setBusy(false);
    // Refreshed even on a partial failure: the ones that did archive have
    // moved, and a list still showing them would be wrong.
    await onFinished();
  }

  const failures = done?.filter((outcome) => outcome.error !== null) ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Archive ${projects.length} projects`}
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
    >
      <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-5 shadow-lg">
        {done === null ? (
          <>
            <h2 className="text-lg font-semibold text-foreground">
              {`Archive ${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
            </h2>
            <p className="mt-1 text-sm text-muted">
              Archiving stops new work on each of them. Every run, report and activity record is
              kept — projects cannot be deleted, and this is the supported end of a project&rsquo;s
              life — and any of them can be unarchived from the Archived view.
            </p>
            <ul className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-line p-3 text-sm">
              {projects.map((project) => (
                <li key={project.id} className="truncate text-muted">{project.name}</li>
              ))}
            </ul>
            <form onSubmit={(event) => void archiveAll(event)} className="mt-4 space-y-4">
              <div>
                <label htmlFor="bulk-archive-reason" className="field-label">
                  Why archive them?
                </label>
                <input
                  id="bulk-archive-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  minLength={1}
                  maxLength={500}
                  className="input"
                  placeholder="Consolidated into the new monorepo"
                />
                <span className="field-hint">
                  Recorded in the audit trail against every project, with its transition.
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy || !reason.trim()}
                  className="btn btn-danger btn-sm"
                >
                  {busy
                    ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    : <Archive className="size-4" aria-hidden="true" />}
                  {busy ? "Archiving…" : `Archive ${projects.length}`}
                </button>
                <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
                  Cancel
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-foreground">
              {failures.length === 0
                ? `Archived ${done.length}`
                : `Archived ${done.length - failures.length} of ${done.length}`}
            </h2>
            {failures.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm" aria-live="polite">
                {failures.map((outcome) => (
                  <li key={outcome.projectId}>
                    {/* The database's own words, per project. A single "some
                        failed" would hide which and why. */}
                    <span className="font-medium">{outcome.name}</span>
                    <span className="text-[var(--danger)]">{` — ${outcome.error}`}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">
                Each one is in the Archived view, with its history intact.
              </p>
            )}
            <button type="button" onClick={onClose} className="btn btn-secondary btn-sm mt-4">
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}


const PRIORITY_LABELS: Readonly<Record<number, string>> = {
  0: "P0 · critical incident or security",
  1: "P1 · critical product or reliability",
  2: "P2 · normal feature work",
  3: "P3 · optimization and maintenance",
};

/**
 * Setting engineering priority across a selection.
 *
 * This is the one edit that means anything in bulk. Name and description are a
 * project's identity — giving five projects the same name is not a feature —
 * so they stay per-project, and priority, which exists precisely to rank
 * projects against each other, is the field a selection can sensibly share.
 *
 * Same shape as the bulk archive for the same reason: one owner-gated
 * `set_project_engineering_priority` per project, and a per-project result when
 * they do not all agree.
 */
export function BulkPriorityDialog({
  onClose,
  onFinished,
  projects,
}: {
  onClose: () => void;
  onFinished: () => Promise<void> | void;
  projects: readonly Project[];
}) {
  const [priority, setPriority] = useState(2);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<readonly BulkOutcome[] | null>(null);

  async function applyAll(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const outcomes: BulkOutcome[] = [];
    for (const project of projects) {
      try {
        const response = await fetch("/api/portfolio/controls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "set_priority",
            priority,
            projectId: project.id,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        outcomes.push({
          error: response.ok ? null : body.error?.message ?? "Refused.",
          name: project.name,
          projectId: project.id,
        });
      } catch (cause) {
        outcomes.push({
          error: cause instanceof Error ? cause.message : "The request failed.",
          name: project.name,
          projectId: project.id,
        });
      }
    }
    setDone(outcomes);
    setBusy(false);
    await onFinished();
  }

  const failures = done?.filter((outcome) => outcome.error !== null) ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Set priority for ${projects.length} projects`}
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
    >
      <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-5 shadow-lg">
        {done === null ? (
          <>
            <h2 className="text-lg font-semibold text-foreground">
              {`Set priority for ${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
            </h2>
            <p className="mt-1 text-sm text-muted">
              Priority ranks these projects against every other one when work is scheduled. P0 is
              reserved for incidents and security; queued work is promoted a tier at a time while
              it waits, so nothing starves.
            </p>
            <form onSubmit={(event) => void applyAll(event)} className="mt-4 space-y-4">
              <div>
                <label htmlFor="bulk-priority" className="field-label">Priority</label>
                <select
                  id="bulk-priority"
                  className="input"
                  value={priority}
                  onChange={(event) => setPriority(Number(event.target.value))}
                >
                  {[0, 1, 2, 3].map((value) => (
                    <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="bulk-priority-reason" className="field-label">
                  Why? (optional)
                </label>
                <input
                  id="bulk-priority-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={500}
                  className="input"
                  placeholder="Shifting focus to the launch"
                />
                <span className="field-hint">Recorded against each project&rsquo;s activity trail.</span>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="btn btn-primary btn-sm">
                  {busy
                    ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    : <SlidersHorizontal className="size-4" aria-hidden="true" />}
                  {busy ? "Applying…" : `Set P${priority} on ${projects.length}`}
                </button>
                <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
                  Cancel
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-foreground">
              {failures.length === 0
                ? `Updated ${done.length}`
                : `Updated ${done.length - failures.length} of ${done.length}`}
            </h2>
            {failures.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm" aria-live="polite">
                {failures.map((outcome) => (
                  <li key={outcome.projectId}>
                    <span className="font-medium">{outcome.name}</span>
                    <span className="text-[var(--danger)]">{` — ${outcome.error}`}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <button type="button" onClick={onClose} className="btn btn-secondary btn-sm mt-4">
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
