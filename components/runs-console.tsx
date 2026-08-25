"use client";

import { AlertTriangle, Archive, Ban, CheckCircle2, CircleDotDashed, GitBranch, Loader2, RotateCcw, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { Children, useState } from "react";

import {
  ControlPlaneDetail,
  DetailFacts,
  ExternalEvidenceLink,
  useControlPlaneDetail,
} from "@/components/control-plane-detail";
import { TenantListShell, formatDateTime, formatDuration, riskTone, useTenantList } from "@/components/tenant-list";
import { StatusBadge } from "@/components/ui";
import { shortRunId } from "@/lib/graph/run-label";
import { budgetActionIsNotable, budgetActionLabel, formatCost, formatTokens } from "@/lib/graph/run-spend";

type Run = {
  id: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  durationMs: number | null;
  risk?: string | null;
  provider?: string | null;
  model?: string | null;
  branch?: string | null;
  project?: { id: string; name: string } | null;
  task: { id: string; title: string } | null;
  agent: { id: string; name: string } | null;
  reviewStatus?: ReviewStatus;
  archivedAt?: string | null;
  /** Present on read-only analysis graph runs, which have no agent-run
   * detail, lease, cancel, or delete — their evidence lives on Pipelines. */
  analysis?: {
    graphId: string;
    graphRunId?: string | null;
    commandId: string | null;
    artifactCount: number;
    costMicros?: number | null;
    tokensUsed?: number | null;
    budgetAction?: string | null;
  } | null;
};

type RunEvent = { id?: string; stage?: string; status?: string; message?: string | null; occurredAt?: string; createdAt?: string };
type RunFile = string | { path: string; status?: string; additions?: number; deletions?: number };
type RunCommit = { sha: string; message?: string; url?: string | null };
type RunValidation = { id?: string; name?: string; kind?: string; status: string; summary?: string | null; durationMs?: number | null };
type RunCheck = { id?: string | number; name: string; status: string; conclusion?: string | null; url?: string | null };
type RunRouting = {
  source: string | null;
  policyVersion: string;
  reasons: { code: string; provider: "openai" | "anthropic" | null; detail: string }[];
  candidates: {
    provider: "openai" | "anthropic";
    model: string | null;
    eligible: boolean;
    score: number | null;
    ineligibleReasons: string[];
  }[];
};

type RunDetail = Run & {
  command?: { id: string; prompt?: string } | null;
  providerRunReference?: string | null;
  routing?: RunRouting | null;
  agent?: ({ id: string; name: string; role?: string | null } | null);
  baseBranch?: string | null;
  baseSha?: string | null;
  headBranch?: string | null;
  headSha?: string | null;
  attempt?: number | null;
  maxAttempts?: number | null;
  cancellationRequestedAt?: string | null;
  cancellable?: boolean;
  retryable?: boolean;
  reviewStatus?: ReviewStatus;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  deletable?: boolean;
  summary?: string | null;
  blocker?: string | null;
  errorMessage?: string | null;
  events?: RunEvent[];
  timeline?: RunEvent[];
  files?: RunFile[];
  changedFiles?: RunFile[];
  commits?: RunCommit[];
  validations?: RunValidation[];
  pullRequest?: { number: number; title?: string; state?: string; draft?: boolean; url?: string | null } | null;
  checks?: RunCheck[];
  ci?: { status?: string; conclusion?: string | null; checks?: RunCheck[] } | null;
};

/**
 * The one part of a run a person may change.
 *
 * Everything else on this page is evidence of something that happened —
 * provider, model, timings, usage, artifacts — and is deliberately read-only.
 * The panel below says so out loud rather than showing greyed-out fields and
 * leaving the reader to guess whether editing is broken or forbidden.
 */
const REVIEW_STATUSES = [
  "unreviewed", "acknowledged", "investigating", "resolved", "ignored",
] as const;
type ReviewStatus = (typeof REVIEW_STATUSES)[number];

const REVIEW_LABELS: Readonly<Record<ReviewStatus, string>> = {
  acknowledged: "Acknowledged",
  ignored: "Ignored",
  investigating: "Investigating",
  resolved: "Resolved",
  unreviewed: "Unreviewed",
};

function statusTone(status: string) {
  if (["succeeded", "passed", "completed", "success"].includes(status)) return "safe";
  if (["failed", "cancelled", "blocked", "failure"].includes(status)) return "danger";
  if (["running", "in_progress"].includes(status)) return "info";
  // Terminal, but not clean: the run stopped having done part of the work.
  if (["partial", "budget_stopped"].includes(status)) return "warning";
  return "neutral";
}

/**
 * Plain-language names for the five states a run actually records
 * (`public.run_status`: queued, running, succeeded, failed, cancelled).
 *
 * The mapping is one-to-one with what is stored — it never invents a phase
 * ("planning", "reviewing") the run does not carry, and an unrecognized status
 * falls back to the raw word rather than a guess. The recorded technical
 * status stays visible in the run detail for anyone who wants the enum.
 */
export function runStatusLabel(status: string) {
  switch (status) {
    case "queued":
      return "Waiting for a worker";
    case "running":
      return "A worker is on it";
    case "succeeded":
      return "Finished";
    case "failed":
      return "Failed — needs a look";
    case "cancelled":
      return "Stopped";
    /*
     * Two states only a graph run reaches. Both are finished, so neither may
     * borrow "A worker is on it" -- which is what they used to render before
     * the run list read graph runs by their own state.
     */
    case "partial":
      return "Finished, with gaps";
    case "budget_stopped":
      return "Stopped on budget";
    default:
      return status.replace(/_/g, " ");
  }
}

type ProjectGroup = { id: string; name: string; runs: Run[] };

// The portfolio view of the same list: runs grouped under the project that
// owns them, in the order of each project's most recent run. A run whose
// bounded projection carries no project is grouped under an honest label
// rather than attributed to anything.
function groupRunsByProject(runs: Run[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const run of runs) {
    const id = run.project?.id ?? (run.analysis ? "analysis" : "unattributed");
    const group = groups.get(id) ?? {
      id,
      name: run.project?.name ?? (run.analysis ? "Analysis runs" : "Project unavailable"),
      runs: [],
    };
    group.runs.push(run);
    groups.set(id, group);
  }
  return [...groups.values()];
}

export function RunsConsole() {
  const { state, reload } = useTenantList<Run>(
    "/api/runs",
    // Provider execution runs and read-only analysis runs are one list —
    // both are work a bot carried out — ordered newest first so a command
    // issued a moment ago is the first row a reload shows.
    (body) => [
      ...((body.runs as Run[]) ?? []),
      ...((body.analysisRuns as Run[]) ?? []),
    ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    "Runs could not be loaded.",
  );
  const detail = useControlPlaneDetail<RunDetail>("runs", "run");
  const [cancelState, setCancelState] = useState<"idle" | "pending" | "error">("idle");
  const [cancelMessage, setCancelMessage] = useState("");
  const [retryState, setRetryState] = useState<"idle" | "pending" | "error">("idle");
  const [retryMessage, setRetryMessage] = useState("");
  const [reviewState, setReviewState] = useState<"idle" | "pending" | "error">("idle");
  const [reviewMessage, setReviewMessage] = useState("");
  // Null means "not editing this run yet", so the form shows the persisted
  // values rather than a draft left over from the previously opened run.
  const [reviewDraft, setReviewDraft] = useState<{ note: string; status: ReviewStatus } | null>(null);
  const [deleteState, setDeleteState] = useState<"idle" | "confirming" | "pending" | "error">("idle");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  // Clearing all finished runs is its own flow with its own consequence copy,
  // kept separate from the single-run delete so neither interferes.
  const [clearState, setClearState] = useState<"idle" | "confirming" | "pending">("idle");
  const [clearReason, setClearReason] = useState("");
  const [clearDetach, setClearDetach] = useState(false);
  const [clearMessage, setClearMessage] = useState("");
  const [clearFailed, setClearFailed] = useState(false);
  // Row-level archive and delete. Acting on a run should not require opening
  // it: the list is where a person decides a run is dealt with.
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState("");
  const [rowFailed, setRowFailed] = useState(false);
  const [deletingRow, setDeletingRow] = useState<Run | null>(null);
  const [rowDeleteReason, setRowDeleteReason] = useState("");
  const [rowDetach, setRowDetach] = useState(false);
  const [detachEvidence, setDetachEvidence] = useState(false);

  function openRun(runId: string) {
    setCancelState("idle");
    setCancelMessage("");
    setRetryState("idle");
    setRetryMessage("");
    setReviewState("idle");
    setReviewMessage("");
    setReviewDraft(null);
    setDeleteState("idle");
    setDeleteMessage("");
    setDeleteReason("");
    // Destructive options never carry over from the last run that was open.
    setDetachEvidence(false);
    void detail.open(runId);
  }

  async function requestCancellation(runId: string) {
    setCancelState("pending");
    setCancelMessage("");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Owner requested cancellation from the SoftwareFactory Runs page." }),
      });
      const body = (await response.json()) as { error?: { message?: string }; message?: string };
      if (!response.ok) throw new Error(body.error?.message ?? "Cancellation could not be requested.");
      setCancelState("idle");
      setCancelMessage(body.message ?? "Cancellation requested. The worker will stop at the next safe boundary.");
      await Promise.all([detail.open(runId), Promise.resolve(reload())]);
    } catch (error) {
      setCancelState("error");
      setCancelMessage(error instanceof Error ? error.message : "Cancellation could not be requested.");
    }
  }

  async function requestRetry(runId: string) {
    setRetryState("pending");
    setRetryMessage("");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Owner requested a bounded retry from the SoftwareFactory Runs page." }),
      });
      const body = await response.json() as {
        error?: { message?: string };
        message?: string;
        run?: { id?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "The run could not be retried.");
      setRetryState("idle");
      setRetryMessage(body.message ?? "Retry queued within the run's bounded attempt limit.");
      await Promise.all([detail.open(body.run?.id ?? runId), Promise.resolve(reload())]);
    } catch (error) {
      setRetryState("error");
      setRetryMessage(error instanceof Error ? error.message : "The run could not be retried.");
    }
  }

  async function saveReview(runId: string, status: ReviewStatus, note: string) {
    setReviewState("pending");
    setReviewMessage("");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewStatus: status,
          ...(note.trim() ? { reviewNote: note.trim() } : {}),
        }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The review could not be saved.");
      setReviewState("idle");
      setReviewMessage("Review saved.");
      setReviewDraft(null);
      await Promise.all([detail.open(runId), Promise.resolve(reload())]);
    } catch (error) {
      setReviewState("error");
      setReviewMessage(error instanceof Error ? error.message : "The review could not be saved.");
    }
  }

  async function archiveRun(run: Run, archived: boolean) {
    setRowBusy(run.id);
    setRowMessage("");
    setRowFailed(false);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archived,
          reason: archived ? "Archived from the Runs page." : undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The run could not be archived.");
      setRowMessage(archived ? "Run archived." : "Run restored to the list.");
      reload();
    } catch (error) {
      setRowFailed(true);
      setRowMessage(error instanceof Error ? error.message : "The run could not be archived.");
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteRunFromList(run: Run) {
    setRowBusy(run.id);
    setRowMessage("");
    setRowFailed(false);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(run.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detachEvidence: rowDetach, reason: rowDeleteReason.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        detached?: { deployments: number; pullRequests: number; testRuns: number };
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "The run could not be deleted.");
      const unlinked = body.detached
        ? body.detached.pullRequests + body.detached.deployments + body.detached.testRuns
        : 0;
      // Says what else moved: a bare "deleted" would hide that a pull request
      // or deployment was unlinked in the same operation.
      setRowMessage(unlinked > 0
        ? `Run deleted. ${unlinked} linked record${unlinked === 1 ? " was" : "s were"} kept and unlinked.`
        : "Run deleted.");
      setDeletingRow(null);
      setRowDeleteReason("");
      setRowDetach(false);
      reload();
    } catch (error) {
      setRowFailed(true);
      setRowMessage(error instanceof Error ? error.message : "The run could not be deleted.");
    } finally {
      setRowBusy(null);
    }
  }

  async function clearFinishedRuns() {
    setClearState("pending");
    setClearMessage("");
    setClearFailed(false);
    try {
      const response = await fetch("/api/runs/clear-finished", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: clearReason.trim(), detachEvidence: clearDetach }),
      });
      const body = (await response.json()) as {
        deletedCount?: number;
        keptForEvidence?: number;
        keptForActivity?: number;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Finished runs could not be cleared.");
      const deleted = body.deletedCount ?? 0;
      const keptEvidence = body.keptForEvidence ?? 0;
      const parts = [
        `${deleted} run${deleted === 1 ? "" : "s"} cleared.`,
        keptEvidence > 0
          ? `${keptEvidence} kept because their work produced pull requests, deployments, or test runs — clear them individually with keep-and-unlink if you mean it.`
          : null,
      ].filter(Boolean);
      setClearState("idle");
      setClearReason("");
      setClearDetach(false);
      setClearMessage(parts.join(" "));
      reload();
    } catch (error) {
      setClearState("idle");
      setClearFailed(true);
      setClearMessage(error instanceof Error ? error.message : "Finished runs could not be cleared.");
    }
  }

  async function deleteRun(runId: string) {
    setDeleteState("pending");
    setDeleteMessage("");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detachEvidence, reason: deleteReason.trim() }),
      });
      const body = (await response.json()) as {
        deleted?: { artifacts: number; events: number; validations: number };
        detached?: { deployments: number; pullRequests: number; testRuns: number };
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "The run could not be deleted.");
      // Say what else moved. A bare "deleted" would hide that pull requests or
      // deployments were unlinked in the same operation.
      const detached = body.detached;
      const unlinked = detached
        ? detached.pullRequests + detached.deployments + detached.testRuns
        : 0;
      detail.close();
      setDeleteState("idle");
      setDeleteReason("");
      setDetachEvidence(false);
      setDeleteMessage(
        unlinked > 0
          ? `Run deleted. ${unlinked} linked record${unlinked === 1 ? " was" : "s were"} kept and unlinked.`
          : "Run deleted.",
      );
      reload();
    } catch (error) {
      setDeleteState("error");
      setDeleteMessage(error instanceof Error ? error.message : "The run could not be deleted.");
    }
  }

  return (
    <div className="space-y-4">
      {deleteMessage && deleteState !== "confirming" ? (
        <p
          className={`rounded-lg border p-3 text-sm ${deleteState === "error" ? "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]" : "border-[var(--info-border)] bg-[var(--info-surface)] text-[var(--info)]"}`}
          aria-live="polite"
        >
          {deleteMessage}
        </p>
      ) : null}
      {rowMessage ? (
        <p
          className={`rounded-lg border p-3 text-sm ${rowFailed ? "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]" : "border-[var(--info-border)] bg-[var(--info-surface)] text-[var(--info)]"}`}
          aria-live="polite"
        >
          {rowMessage}
        </p>
      ) : null}

      {deletingRow ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Delete run ${deletingRow.id}`}
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
        >
          <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-5 shadow-lg">
            <h2 className="text-lg font-semibold text-foreground">Delete this run</h2>
            <p className="mt-1 text-sm text-muted">
              {deletingRow.task?.title ?? "Untitled work"}
            </p>
            <p className="mt-2 text-xs text-muted">
              Removes the run and its own events, artifacts and validations. The deletion is
              recorded in the activity trail first, so the account of it survives. Nothing outside
              this database is touched. To keep a run and simply take it out of the list, archive
              it instead.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Reason (required, at least ten characters)</span>
                <input
                  type="text"
                  className="w-full min-w-0 rounded border border-line bg-surface px-3 py-2 text-sm"
                  maxLength={400}
                  value={rowDeleteReason}
                  onChange={(event) => setRowDeleteReason(event.target.value)}
                  placeholder="Why this run is being removed"
                />
              </label>
              <label className="flex items-start gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={rowDetach}
                  onChange={(event) => setRowDetach(event.target.checked)}
                />
                <span>
                  Keep and unlink any pull request, deployment or test run this run produced.
                  Without this, a run that produced one of those is refused rather than silently
                  orphaning it.
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={rowBusy !== null || rowDeleteReason.trim().length < 10}
                  onClick={() => void deleteRunFromList(deletingRow)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete permanently
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setDeletingRow(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {clearMessage && clearState === "idle" ? (
        <p
          className={`rounded-lg border p-3 text-sm ${clearFailed ? "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]" : "border-[var(--info-border)] bg-[var(--info-surface)] text-[var(--info)]"}`}
          aria-live="polite"
        >
          {clearMessage}
        </p>
      ) : null}
      {state.kind === "ready" && state.items.length > 0 && clearState === "idle" ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setClearMessage("");
              setClearState("confirming");
            }}
            className="btn btn-secondary btn-sm"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Clear finished runs
          </button>
        </div>
      ) : null}
      {clearState !== "idle" ? (
        <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] p-4">
          <p className="text-sm font-semibold text-foreground">Clear every finished run?</p>
          <p className="mt-1 text-sm text-muted">
            Every succeeded, failed, and cancelled run is deleted through the same owner-only,
            per-run rules — queued and running work is untouched, each deletion is recorded in the
            audit trail before it happens, and runs whose work produced pull requests, deployments,
            or test runs are kept unless you choose to keep-and-unlink those records instead.
          </p>
          <div className="mt-3">
            <label htmlFor="clear-runs-reason" className="field-label">Why clear them?</label>
            <input
              id="clear-runs-reason"
              value={clearReason}
              onChange={(event) => setClearReason(event.target.value)}
              minLength={10}
              maxLength={400}
              className="input"
              placeholder="Clearing the history before the next audit round"
            />
            <span className="field-hint">At least 10 characters; recorded with every deletion.</span>
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={clearDetach}
              onChange={(event) => setClearDetach(event.target.checked)}
              className="mt-0.5"
            />
            Also clear runs with linked pull requests, deployments, or test runs — those records are
            kept and unlinked. Nothing on GitHub or Vercel is touched either way.
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void clearFinishedRuns()}
              disabled={clearState === "pending" || clearReason.trim().length < 10}
              className="btn btn-primary btn-sm"
            >
              {clearState === "pending" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              Clear finished runs
            </button>
            <button
              type="button"
              onClick={() => setClearState("idle")}
              disabled={clearState === "pending"}
              className="btn btn-secondary btn-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <TenantListShell
        state={state}
        reload={reload}
        title="Runs"
        icon={GitBranch}
        signedOutTitle="Sign in to see your runs"
        signedOutDescription="Run history belongs to your workspace."
        returnPath="/solutions/runs"
        emptyTitle="Nothing has run yet"
        /* The old copy explained the architecture ("the orchestrator resolves
           a command to one exact repository") to a reader who wanted to know
           where their work went. This says what a run is and where one comes
           from, and the button is the answer to "so what do I do?". */
        emptyDescription="A run is one piece of work a bot carried out, with its evidence. Ask a bot for something in Bot Manager and its run appears here."
        emptyActionHref="/solutions/bot-manager"
        emptyActionLabel="Give a bot something to do"
      >
        {(runs) => (
          <div className="divide-y divide-[var(--border)]">
            {groupRunsByProject(runs).map((group) => (
              <section key={group.id} aria-label={`Runs for ${group.name}`}>
                <div className="flex items-baseline justify-between gap-3 bg-[var(--surface-inset)] px-5 py-2">
                  <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">{group.name}</h3>
                  <span className="shrink-0 text-xs text-faint">
                    {group.runs.length === 1 ? "1 run" : `${group.runs.length} runs`}
                  </span>
                </div>
                <ul className="divide-y divide-[var(--border)]">
                  {group.runs.map((run) => (
                    <li key={run.id} className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        {/* Task titles derive from owner-typed prompts; an
                            unbroken token must wrap, not scroll the phone. */}
                        <p className="break-words font-medium text-foreground">{run.task?.title ?? "Untitled work"}</p>
                        <p className="mt-0.5 text-sm text-muted">
                          {run.agent?.name ?? "Unassigned"} · {formatDateTime(run.startedAt ?? run.createdAt)}
                        </p>
                        <p className="mt-1 break-words text-xs text-muted">
                          {run.analysis
                            ? [
                                "Read-only analysis on your Claude subscription",
                                `${run.analysis.artifactCount} artifact${run.analysis.artifactCount === 1 ? "" : "s"} recorded`,
                                // Spend joins the line only once recorded. A
                                // run that measured nothing says nothing here.
                                formatCost(run.analysis.costMicros),
                                formatTokens(run.analysis.tokensUsed)
                                  ? `${formatTokens(run.analysis.tokensUsed)} tokens`
                                  : null,
                                budgetActionIsNotable(run.analysis.budgetAction)
                                  ? budgetActionLabel(run.analysis.budgetAction)
                                  : null,
                                "no branch or pull request by design",
                              ].filter(Boolean).join(" · ")
                            : run.provider
                              ? <>Recorded target: {providerDisplayName(run.provider)}{run.model ? ` / ${run.model}` : " / model chosen at execution"}</>
                              : "No provider/model routing target is recorded for this run."}
                        </p>
                        {/* An analysis run is named here exactly as the AI
                            Factory names it — same eight characters, same
                            monospace — so a row in this list and the run's
                            own page are recognizably one run. The full id
                            stays available on hover for anyone quoting it. */}
                        {run.analysis ? (
                          <p className="mt-1 truncate text-xs text-faint">
                            Run{" "}
                            <span className="font-mono text-muted" title={run.analysis.graphRunId ?? run.id}>
                              {shortRunId(run.analysis.graphRunId ?? run.id)}
                            </span>
                          </p>
                        ) : (
                          <p className="mt-1 truncate font-mono text-xs text-faint">{run.branch ?? run.id}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 md:shrink-0">
                        {run.risk ? <StatusBadge tone={riskTone(run.risk)}>{run.risk.toUpperCase()}</StatusBadge> : null}
                        <StatusBadge tone={statusTone(run.status)}>{runStatusLabel(run.status)}</StatusBadge>
                        {/* Shown only once someone has triaged it. A badge
                            reading "Unreviewed" on every row would be noise on
                            the common case and bury the reviewed ones. */}
                        {run.reviewStatus && run.reviewStatus !== "unreviewed" ? (
                          <StatusBadge tone="neutral">{REVIEW_LABELS[run.reviewStatus]}</StatusBadge>
                        ) : null}
                        <span className="text-sm text-muted">{formatDuration(run.durationMs)}</span>
                        {run.analysis ? (
                          /* An analysis run's evidence — nodes, artifacts,
                             verifications — lives on the graph surfaces, and
                             it has no lease to cancel or agent-run row to
                             archive or delete. One honest action, and it goes
                             to *this* run's own page where the run id is
                             known, rather than to the list it came from. */
                          <Link
                            href={run.analysis.graphRunId
                              ? `/solutions/lifecycle/run/${run.analysis.graphRunId}`
                              : "/solutions/pipelines"}
                            className="btn btn-secondary btn-sm"
                          >
                            View analysis
                          </Link>
                        ) : (
                          <>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openRun(run.id)}>
                              View run
                            </button>
                            {/* Archiving is offered only once a run has finished:
                                hiding work still in flight would hide the thing
                                most worth watching, and the database refuses it. */}
                            {["succeeded", "failed", "cancelled"].includes(run.status) ? (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={rowBusy === run.id}
                                aria-label={run.archivedAt ? `Restore run ${run.id}` : `Archive run ${run.id}`}
                                onClick={() => void archiveRun(run, !run.archivedAt)}
                              >
                                {rowBusy === run.id
                                  ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                                  : <Archive className="size-4" aria-hidden="true" />}
                                {run.archivedAt ? "Restore" : "Archive"}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              disabled={rowBusy === run.id}
                              aria-label={`Delete run ${run.id}`}
                              onClick={() => {
                                setDeletingRow(run);
                                setRowDeleteReason("");
                                setRowDetach(false);
                                setRowMessage("");
                              }}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </TenantListShell>

      <ControlPlaneDetail
        state={detail.state}
        title="Run evidence"
        onClose={detail.close}
        onRetry={() => void detail.reload()}
      >
        {(run) => {
          const events = run.timeline ?? run.events ?? [];
          const changedFiles = run.changedFiles?.length ? run.changedFiles : run.files ?? [];
          const files = changedFiles.map((file) =>
            typeof file === "string" ? { path: file } : file,
          );
          const checks = run.ci?.checks ?? run.checks ?? [];
          const canCancel = run.cancellable === true && ["queued", "running"].includes(run.status);
          const canRetry = run.retryable === true && run.status === "failed";
          return (
            <div className="space-y-6 p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-foreground">{run.task?.title ?? "Run"}</p>
                  <p className="mt-1 text-sm text-muted">{run.command?.prompt ?? run.summary ?? "No bounded summary has been recorded yet."}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <StatusBadge tone={statusTone(run.status)}>{runStatusLabel(run.status)}</StatusBadge>
                  {run.pullRequest?.url ? (
                    // The deliverable, not buried in an evidence list: a
                    // finished run's next step is reviewing the pull request.
                    <a
                      href={run.pullRequest.url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-primary btn-sm"
                    >
                      Review {run.pullRequest.draft ? "draft " : ""}PR #{run.pullRequest.number}
                    </a>
                  ) : null}
                  {canCancel ? (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={cancelState === "pending"}
                      onClick={() => void requestCancellation(run.id)}
                    >
                      {cancelState === "pending" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Ban className="size-4" aria-hidden="true" />}
                      Request stop
                    </button>
                  ) : null}
                  {canRetry ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={retryState === "pending"}
                      onClick={() => void requestRetry(run.id)}
                    >
                      {retryState === "pending" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
                      Retry run
                    </button>
                  ) : null}
                </div>
              </div>

              {cancelMessage ? (
                <p className={`rounded-lg border p-3 text-sm ${cancelState === "error" ? "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]" : "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning)]"}`} aria-live="polite">
                  {cancelMessage}
                </p>
              ) : null}

              {retryMessage ? (
                <p className={`rounded-lg border p-3 text-sm ${retryState === "error" ? "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]" : "border-[var(--info-border)] bg-[var(--info-surface)] text-[var(--info)]"}`} aria-live="polite">
                  {retryMessage}
                </p>
              ) : null}

              <section className="rounded-lg border border-line p-4" aria-labelledby={`review-${run.id}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 id={`review-${run.id}`} className="text-sm font-semibold text-foreground">
                    Review
                  </h3>
                  <p className="text-xs text-muted">
                    {run.reviewedAt
                      ? `Last reviewed ${formatDateTime(run.reviewedAt)}`
                      : "Not reviewed yet"}
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted">
                  The status and note below are the editable part of a run. Everything
                  else on this page records what actually happened — provider, model,
                  timings, files, checks — and is read-only so the console cannot state
                  something the factory did not do.
                </p>

                <div className="mt-3 flex flex-col gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted">Status</span>
                    <select
                      className="w-full min-w-0 rounded border border-line bg-surface px-3 py-2 text-sm"
                      value={reviewDraft?.status ?? run.reviewStatus ?? "unreviewed"}
                      onChange={(event) => setReviewDraft({
                        note: reviewDraft?.note ?? run.reviewNote ?? "",
                        status: event.target.value as ReviewStatus,
                      })}
                    >
                      {REVIEW_STATUSES.map((status) => (
                        <option key={status} value={status}>{REVIEW_LABELS[status]}</option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted">Note</span>
                    <textarea
                      className="min-h-20 rounded border border-line bg-surface px-3 py-2 text-sm"
                      maxLength={2000}
                      placeholder="What was decided about this run, and why."
                      value={reviewDraft?.note ?? run.reviewNote ?? ""}
                      onChange={(event) => setReviewDraft({
                        note: event.target.value,
                        status: reviewDraft?.status ?? run.reviewStatus ?? "unreviewed",
                      })}
                    />
                  </label>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={reviewState === "pending" || reviewDraft === null}
                      onClick={() => void saveReview(
                        run.id,
                        reviewDraft?.status ?? run.reviewStatus ?? "unreviewed",
                        reviewDraft?.note ?? "",
                      )}
                    >
                      {reviewState === "pending"
                        ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        : <Save className="size-4" aria-hidden="true" />}
                      Save review
                    </button>
                    {reviewDraft !== null ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setReviewDraft(null)}
                      >
                        Discard changes
                      </button>
                    ) : null}
                  </div>

                  {reviewMessage ? (
                    <p
                      className={`text-sm ${reviewState === "error" ? "text-[var(--danger)]" : "text-muted"}`}
                      aria-live="polite"
                    >
                      {reviewMessage}
                    </p>
                  ) : null}
                </div>
              </section>

              {run.deletable ? (
                <section className="rounded-lg border border-[var(--danger-border)] p-4" aria-labelledby={`delete-${run.id}`}>
                  <h3 id={`delete-${run.id}`} className="text-sm font-semibold text-[var(--danger)]">
                    Delete this run
                  </h3>
                  <p className="mt-1 text-xs text-muted">
                    Removes the run and its own events, artifacts and validations. The
                    deletion itself is recorded in the activity trail first, so the
                    account of it survives. Nothing outside this database is touched: a
                    pull request on GitHub stays exactly as it is.
                  </p>

                  {deleteState === "confirming" ? (
                    <div className="mt-3 flex flex-col gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-muted">Reason (required, at least ten characters)</span>
                        <input
                          type="text"
                          className="w-full min-w-0 rounded border border-line bg-surface px-3 py-2 text-sm"
                          maxLength={400}
                          value={deleteReason}
                          onChange={(event) => setDeleteReason(event.target.value)}
                          placeholder="Why this run is being removed"
                        />
                      </label>
                      <label className="flex items-start gap-2 text-xs text-muted">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={detachEvidence}
                          onChange={(event) => setDetachEvidence(event.target.checked)}
                        />
                        <span>
                          Keep and unlink any pull request, deployment or test run this
                          run produced. Without this, a run that produced one of those is
                          refused rather than silently orphaning it.
                        </span>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={deleteState !== "confirming" || deleteReason.trim().length < 10}
                          onClick={() => void deleteRun(run.id)}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                          Delete permanently
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => { setDeleteState("idle"); setDeleteMessage(""); }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm mt-3"
                      disabled={deleteState === "pending"}
                      onClick={() => { setDeleteState("confirming"); setDeleteMessage(""); }}
                    >
                      {deleteState === "pending"
                        ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        : <Trash2 className="size-4" aria-hidden="true" />}
                      Delete run
                    </button>
                  )}

                  {deleteMessage && deleteState === "error" ? (
                    <p className="mt-2 text-sm text-[var(--danger)]" aria-live="polite">{deleteMessage}</p>
                  ) : null}
                </section>
              ) : null}

              <DetailFacts facts={[
                { label: "Project", value: run.project?.name ?? "—" },
                { label: "Agent", value: run.agent ? `${run.agent.name}${run.agent.role ? ` · ${run.agent.role}` : ""}` : "—" },
                { label: "Provider / model", value: [run.provider ? providerDisplayName(run.provider) : null, run.model].filter(Boolean).join(" / ") || "—" },
                { label: "Risk", value: run.risk?.toUpperCase() ?? "—" },
                { label: "Base", value: [run.baseBranch, shortSha(run.baseSha)].filter(Boolean).join(" @ ") || "—" },
                { label: "Branch", value: run.headBranch ?? run.branch ?? "—" },
                { label: "Attempt", value: run.attempt !== null && run.attempt !== undefined ? `${run.attempt}${run.maxAttempts ? ` of ${run.maxAttempts}` : ""}` : "—" },
                { label: "Duration", value: formatDuration(run.durationMs) },
                // The plain-language badge above is a translation; the enum the
                // database actually recorded stays one glance away.
                { label: "Recorded status", value: run.status },
              ]} />

              <RunRoutingEvidence run={run} />

              {(run.blocker || run.errorMessage) ? (
                <div className="flex items-start gap-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger)]">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <p>{run.blocker ?? run.errorMessage}</p>
                </div>
              ) : null}

              <EvidenceSection title="Timeline" empty="No run events have been recorded yet.">
                {events.map((event, index) => (
                  <li key={event.id ?? `${event.stage}-${index}`} className="flex gap-3 py-2">
                    <CircleDotDashed className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{event.stage ?? "Run event"} {event.status ? `· ${event.status}` : ""}</p>
                      {event.message ? <p className="mt-0.5 text-sm text-muted">{event.message}</p> : null}
                    </div>
                    <time className="shrink-0 text-xs text-faint" dateTime={event.occurredAt ?? event.createdAt}>{formatDateTime(event.occurredAt ?? event.createdAt ?? null)}</time>
                  </li>
                ))}
              </EvidenceSection>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <EvidenceSection title="Validation" empty="No validation evidence has been recorded.">
                  {(run.validations ?? []).map((validation, index) => (
                    <li key={validation.id ?? `${validation.name}-${index}`} className="flex items-start justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">{validation.name ?? validation.kind ?? "Validation"}</span>
                        {validation.summary ? <span className="mt-0.5 block text-muted">{validation.summary}</span> : null}
                      </span>
                      <StatusBadge tone={statusTone(validation.status)}>{validation.status}</StatusBadge>
                    </li>
                  ))}
                </EvidenceSection>
                <EvidenceSection title="Changed files" empty="No changed-file evidence has been recorded.">
                  {files.map((file) => (
                    <li key={file.path} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 break-all font-mono text-foreground">{file.path}</span>
                      <span className="shrink-0 text-faint">{file.status ?? `${file.additions ?? 0}+ / ${file.deletions ?? 0}-`}</span>
                    </li>
                  ))}
                </EvidenceSection>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <EvidenceSection title="Commits" empty="No commit evidence has been recorded.">
                  {(run.commits ?? []).map((commit) => (
                    <li key={commit.sha} className="py-2 text-sm">
                      <ExternalEvidenceLink href={commit.url}>{shortSha(commit.sha) ?? commit.sha}</ExternalEvidenceLink>
                      {commit.message ? <span className="ml-2 text-muted">{commit.message}</span> : null}
                    </li>
                  ))}
                </EvidenceSection>
                <EvidenceSection title="Pull request and CI" empty="No pull request or CI evidence has been recorded.">
                  {run.pullRequest ? (
                    <li className="py-2 text-sm">
                      <ExternalEvidenceLink href={run.pullRequest.url}>PR #{run.pullRequest.number}</ExternalEvidenceLink>
                      <span className="ml-2 text-muted">{run.pullRequest.draft ? "Draft" : run.pullRequest.state ?? "Open"}</span>
                    </li>
                  ) : null}
                  {checks.map((check) => (
                    <li key={String(check.id ?? check.name)} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <ExternalEvidenceLink href={check.url}>{check.name}</ExternalEvidenceLink>
                      <span className="flex shrink-0 items-center gap-1 text-muted">
                        {check.conclusion === "success" ? <CheckCircle2 className="size-4 text-accent" aria-hidden="true" /> : null}
                        {check.status} / {check.conclusion ?? "—"}
                      </span>
                    </li>
                  ))}
                </EvidenceSection>
              </div>
            </div>
          );
        }}
      </ControlPlaneDetail>
    </div>
  );
}

function RunRoutingEvidence({ run }: { run: RunDetail }) {
  return (
    <section className="rounded-lg border border-line p-4" aria-labelledby={`run-routing-${run.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`run-routing-${run.id}`} className="font-semibold text-foreground">
          Why this provider?
        </h3>
        <StatusBadge tone={run.provider ? "info" : "neutral"}>
          {run.provider ? "Recorded" : "Not recorded"}
        </StatusBadge>
      </div>
      {run.provider ? (
        <>
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="card-inset min-w-0 p-3">
              <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-faint">Selected provider</dt>
              <dd className="mt-1 break-words text-sm text-foreground">{providerDisplayName(run.provider)}</dd>
            </div>
            <div className="card-inset min-w-0 p-3">
              <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-faint">Selected model</dt>
              <dd className="mt-1 break-all text-sm text-foreground">{run.model ?? "Chosen by the provider at execution"}</dd>
            </div>
          </dl>
          {run.routing ? (
            <div className="mt-4 space-y-4">
              <p className="min-w-0 break-words text-sm text-muted">
                Source <span className="break-all font-mono text-foreground">{routingLabel(run.routing.source)}</span>
                {" · "}policy <span className="break-all font-mono text-foreground">{run.routing.policyVersion}</span>
              </p>
              <ul className="space-y-2" aria-label="Provider selection reasons">
                {run.routing.reasons.map((reason, index) => (
                  <li key={`${reason.code}-${index}`} className="card-inset min-w-0 p-3 text-sm">
                    <p className="break-words font-medium text-foreground">{reason.detail}</p>
                    <p className="mt-1 break-all font-mono text-xs text-faint">
                      {reason.code}{reason.provider ? ` · ${providerDisplayName(reason.provider)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
              {run.routing.candidates.length ? (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Provider routing candidates">
                  {run.routing.candidates.map((candidate) => (
                    <li key={`${candidate.provider}-${candidate.model ?? "default"}`} className="card-inset min-w-0 p-3 text-sm">
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                        <span className="min-w-0 break-all font-medium text-foreground">
                          {providerDisplayName(candidate.provider)}{candidate.model ? ` / ${candidate.model}` : ""}
                        </span>
                        <StatusBadge tone={candidate.eligible ? "safe" : "neutral"}>
                          {candidate.eligible ? "Eligible" : "Ineligible"}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 break-words text-xs text-faint">
                        {candidate.score === null ? "No score recorded" : `Score ${candidate.score.toFixed(3)}`}
                        {candidate.ineligibleReasons.length ? ` · ${candidate.ineligibleReasons.join(", ")}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-sm leading-6 text-muted">
                This is bounded durable routing evidence, not current provider-health status.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-muted">
              This legacy run records the selected target but has no bounded routing-decision evidence.
              SoftwareFactory does not infer a source, reason, or candidate score.
            </p>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm leading-6 text-muted">
          No provider/model routing target is present in this run&apos;s bounded projection. SoftwareFactory
          does not substitute a configured provider, an agent preference, or demo data for missing run evidence.
        </p>
      )}
    </section>
  );
}

function routingLabel(source: string | null) {
  if (!source) return "not recorded";
  return source.toLowerCase().replace(/_/g, " ");
}

function EvidenceSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const entries = Children.toArray(children);
  return (
    <section className="rounded-lg border border-line p-4">
      <h3 className="font-semibold text-foreground">{title}</h3>
      {entries.length ? <ul className="mt-2 divide-y divide-[var(--border)]">{children}</ul> : <p className="mt-2 text-sm text-faint">{empty}</p>}
    </section>
  );
}

function shortSha(value?: string | null) {
  return value ? value.slice(0, 7) : null;
}

function providerDisplayName(provider: string) {
  if (provider === "anthropic") return "Anthropic / Claude";
  if (provider === "openai") return "OpenAI / Codex";
  return provider;
}
