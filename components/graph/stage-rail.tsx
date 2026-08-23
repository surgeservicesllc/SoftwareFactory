"use client";

import { AlertTriangle, Check, CircleDashed, Loader2, UserCheck } from "lucide-react";

import { cn } from "@/lib/cn";
import type { RunSummary, StageStatus, StageSummary } from "@/lib/sdlc/run-summary";

/**
 * A run's eight stages, at a glance.
 *
 * The stage column existed on every node and was read nowhere else, so
 * answering "where is this run?" meant holding a dozen rows in your head. This
 * is that answer, derived from the same nodes the table below it renders — one
 * read, so the rail and the table cannot disagree.
 *
 * Status is never carried by colour alone: every stage shows an icon and a
 * word, and the one needing attention is named in a sentence above the rail.
 */

const STATUS_LABEL: Record<StageStatus, string> = {
  NOT_STARTED: "Not started",
  RUNNING: "Running",
  AWAITING_DECISION: "Awaiting a decision",
  FAILED: "Failed",
  COMPLETE: "Complete",
};

function StageIcon({ status }: { status: StageStatus }) {
  if (status === "COMPLETE") return <Check className="size-3.5" aria-hidden="true" />;
  if (status === "FAILED") return <AlertTriangle className="size-3.5" aria-hidden="true" />;
  if (status === "AWAITING_DECISION") return <UserCheck className="size-3.5" aria-hidden="true" />;
  if (status === "RUNNING") return <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />;
  return <CircleDashed className="size-3.5" aria-hidden="true" />;
}

function toneFor(status: StageStatus, isCurrent: boolean): string {
  if (status === "FAILED") {
    return "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]";
  }
  if (status === "AWAITING_DECISION") {
    return "border-[var(--border-strong)] bg-[var(--surface-raised)] text-foreground";
  }
  if (status === "COMPLETE") {
    return "border-[var(--accent-border)] bg-[var(--accent-surface)] text-[var(--accent-text)]";
  }
  if (status === "RUNNING" || isCurrent) return "border-[var(--accent-border)] bg-surface text-foreground";
  return "border-line bg-surface text-faint";
}

export function StageRail({ summary }: { summary: RunSummary }) {
  const current = summary.currentStage
    ? summary.stages.find((entry) => entry.stage === summary.currentStage)
    : null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        {current
          ? `${current.stage}: ${STATUS_LABEL[current.status].toLowerCase()}${current.firstError ? ` — ${current.firstError}` : ""}`
          : summary.stagesWithWork === 0
            ? "No node in this run carries a lifecycle stage."
            : `${summary.completedStages} of ${summary.stagesWithWork} stage${summary.stagesWithWork === 1 ? "" : "s"} complete; nothing in flight.`}
        {summary.unstagedCount > 0 ? (
          <span className="text-faint">
            {" "}· {summary.unstagedCount} node{summary.unstagedCount === 1 ? "" : "s"} carry no stage
          </span>
        ) : null}
      </p>

      {/*
        Scrolls inside itself rather than widening the card. Eight stages do
        not fit a phone at a readable size, and the alternative — shrinking
        them until they do — makes the rail unreadable at every width.
      */}
      <ol className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Lifecycle stages">
        {summary.stages.map((entry) => (
          <li key={entry.stage} className="shrink-0">
            <StageChip entry={entry} isCurrent={entry.stage === summary.currentStage} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function StageChip({ entry, isCurrent }: { entry: StageSummary; isCurrent: boolean }) {
  const detail = entry.total === 0 ? "no nodes" : `${entry.succeeded}/${entry.total} done`;
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs",
        toneFor(entry.status, isCurrent),
        isCurrent && "ring-1 ring-[var(--accent-border)]",
      )}
      title={`${entry.stage} — ${STATUS_LABEL[entry.status]} (${detail}). Produces ${entry.produces}.`}
    >
      <StageIcon status={entry.status} />
      <span className="font-medium">{entry.stage}</span>
      <span className="text-faint">{detail}</span>
      <span className="sr-only">{STATUS_LABEL[entry.status]}</span>
    </span>
  );
}
