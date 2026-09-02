"use client";

import { useCallback, useEffect, useState } from "react";

import { Card, EmptyState, SectionTitle, StatusBadge } from "@/components/ui";
import { InterviewPrepSheet } from "@/components/job-seeker/interview-prep";
import type { JobView } from "@/components/job-seeker/jobs-panel";
import { CLOSED_REASON_LABELS, CLOSED_REASONS, type ClosedReason } from "@/lib/job-seeker/silence";

/**
 * The application pipeline. Eleven stages, and one rule above all of them:
 * nothing reaches APPLIED without your explicit approval — the database
 * enforces it, and this panel's Approve/Reject buttons are how a decision is
 * recorded, with who and when.
 */

const STAGES = [
  "FOUND", "QUALIFIED", "RESUME_CREATED", "READY_FOR_REVIEW", "APPLIED",
  "FOLLOW_UP", "RECRUITER_RESPONSE", "INTERVIEW", "FINAL_INTERVIEW", "OFFER", "CLOSED",
] as const;

function stageLabel(stage: string): string {
  return stage.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The next honest stages an application can move to from where it stands. */
function nextStages(stage: string, approved: boolean): string[] {
  const index = STAGES.indexOf(stage as (typeof STAGES)[number]);
  if (index < 0 || stage === "CLOSED") return [];
  const forward = STAGES.slice(index + 1).filter((candidate) => {
    if (candidate === "CLOSED") return false; // Close is its own action.
    // The gate: post-review stages need the recorded approval.
    const gated = !["QUALIFIED", "RESUME_CREATED", "READY_FOR_REVIEW"].includes(candidate);
    return gated ? approved : true;
  });
  return forward.slice(0, 2);
}

type DocumentView = {
  id: string;
  kind: string;
  version: number;
  content: string;
  createdAt: string;
};

/** The posting's own requirement lines, each with a verdict naming the fact (ADR-244). */
type RequirementsView = {
  checks: Array<{ line: string; verdict: "met" | "unmet" | "unknown"; reason: string }>;
  counts: { met: number; unmet: number; unknown: number };
  basis: string;
};

const DETAIL_FIELD_CLASS =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]";

/**
 * Notes, the submitted-application URL, and the follow-up date — the CRM
 * half of an application. One PATCH carries all three (`follow_up` applies
 * notes and URL alongside the date), and the saved answer comes from the
 * server, not from local memory.
 */
function ApplicationDetailsEditor({
  application,
  busy,
  onSave,
}: {
  application: { id: string; applicationUrl: string | null; notes: string | null; followUpAt: string | null };
  busy: boolean;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [notes, setNotes] = useState(application.notes ?? "");
  const [applicationUrl, setApplicationUrl] = useState(application.applicationUrl ?? "");
  const [followUpAt, setFollowUpAt] = useState(
    application.followUpAt ? application.followUpAt.slice(0, 16) : "",
  );

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm text-[var(--text-muted)]">
        Notes &amp; follow-up
      </summary>
      <div className="mt-2 grid gap-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-[var(--text-muted)]">Notes</span>
          <textarea
            className={DETAIL_FIELD_CLASS}
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-[var(--text-muted)]">Application URL</span>
          <input
            className={DETAIL_FIELD_CLASS}
            type="url"
            placeholder="https://…"
            value={applicationUrl}
            onChange={(event) => setApplicationUrl(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-[var(--text-muted)]">Follow-up date</span>
          <input
            className={DETAIL_FIELD_CLASS}
            type="datetime-local"
            value={followUpAt}
            onChange={(event) => setFollowUpAt(event.target.value)}
          />
        </label>
        <div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() =>
              void onSave({
                action: "follow_up",
                followUpAt: followUpAt ? new Date(followUpAt).toISOString() : null,
                notes,
                applicationUrl: applicationUrl.trim() || null,
              })
            }
          >
            Save details
          </button>
        </div>
      </div>
    </details>
  );
}

export function JobSeekerApplicationsPanel() {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [problem, setProblem] = useState("");
  const [busyId, setBusyId] = useState("");
  const [documentsByApplication, setDocumentsByApplication] = useState<Record<string, DocumentView[]>>({});
  /** The reason chosen beside each Close button; "" is "not said" (ADR-243). */
  const [closeReasons, setCloseReasons] = useState<Record<string, "" | ClosedReason>>({});
  const [requirementsByJob, setRequirementsByJob] = useState<Record<string, RequirementsView | "failed">>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/job-seeker/jobs", { cache: "no-store" });
      if (!response.ok) {
        setProblem("Applications could not be listed.");
        return;
      }
      const body = (await response.json()) as { jobs?: JobView[] };
      setJobs((body.jobs ?? []).filter((job) => job.application));
    } catch {
      setProblem("Applications could not be listed.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  async function loadDocuments(applicationId: string) {
    try {
      const response = await fetch(`/api/job-seeker/applications/${applicationId}/documents`, { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { documents?: DocumentView[] };
      setDocumentsByApplication((current) => ({ ...current, [applicationId]: body.documents ?? [] }));
    } catch {
      /* The viewer simply stays closed; the next click retries. */
    }
  }

  async function loadRequirements(jobId: string) {
    try {
      const response = await fetch(`/api/job-seeker/jobs/${jobId}/requirements`, { cache: "no-store" });
      if (!response.ok) {
        setRequirementsByJob((current) => ({ ...current, [jobId]: "failed" }));
        return;
      }
      const body = (await response.json()) as RequirementsView;
      setRequirementsByJob((current) => ({ ...current, [jobId]: body }));
    } catch {
      setRequirementsByJob((current) => ({ ...current, [jobId]: "failed" }));
    }
  }

  async function prepare(applicationId: string) {
    setBusyId(applicationId);
    setProblem("");
    try {
      const response = await fetch(`/api/job-seeker/applications/${applicationId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as { documents?: DocumentView[]; error?: { message?: string } };
      if (!response.ok) {
        setProblem(body.error?.message ?? "Documents could not be generated.");
        return;
      }
      setDocumentsByApplication((current) => ({ ...current, [applicationId]: body.documents ?? [] }));
      await load();
    } catch {
      setProblem("Documents could not be generated.");
    } finally {
      setBusyId("");
    }
  }

  async function transition(applicationId: string, body: Record<string, unknown>) {
    setBusyId(applicationId);
    setProblem("");
    try {
      const response = await fetch(`/api/job-seeker/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errorBody = (await response.json()) as { error?: { message?: string } };
        setProblem(errorBody.error?.message ?? "The application could not be updated.");
        return;
      }
      await load();
    } catch {
      setProblem("The application could not be updated.");
    } finally {
      setBusyId("");
    }
  }

  if (jobs === null && !problem) {
    return (
      <Card className="min-h-48 animate-pulse">
        <span className="sr-only">Loading applications</span>
      </Card>
    );
  }

  const grouped = STAGES.map((stage) => ({
    stage,
    entries: (jobs ?? []).filter((job) => job.application?.stage === stage),
  })).filter((group) => group.entries.length > 0);

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          title="Applications"
          description="Every recorded job enters this pipeline at its honest stage. Nothing reaches Applied without your explicit approval — the database enforces the gate."
        />
        {problem ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{problem}</p> : null}
      </Card>

      {grouped.length === 0 ? (
        <EmptyState
          title="No applications yet"
          description="Record a job on the Discovery tab; it lands here as Found or Qualified based on its score against your threshold."
          actionLabel="Open Job Discovery"
          actionHref="/job-seeker?section=discovery"
        />
      ) : null}

      {grouped.map((group) => (
        <section key={group.stage} aria-label={stageLabel(group.stage)}>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--text-faint)]">
            {stageLabel(group.stage)} · {group.entries.length}
          </h3>
          <div className="space-y-3">
            {group.entries.map((job) => {
              const application = job.application!;
              const approved = application.approvalStatus === "approved";
              return (
                <Card key={application.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-[var(--text)]">{job.title}</h4>
                      <p className="text-sm text-[var(--text-muted)]">
                        {job.company}
                        {job.match ? ` · score ${job.match.score}/100` : ""}
                        {application.stage === "CLOSED" && application.closedReason ? (
                          ` · closed: ${CLOSED_REASON_LABELS[application.closedReason as ClosedReason] ?? application.closedReason}`
                        ) : ""}
                      </p>
                      {application.silence ? (
                        <p className="mt-1 text-xs text-[var(--text-muted)]" data-testid="silence">
                          {application.silence.sentence}
                        </p>
                      ) : null}
                      {application.silence?.suggestionSentence ? (
                        <p className="mt-1 text-xs text-[var(--text-muted)]" data-testid="silence-suggestion">
                          {application.silence.suggestionSentence}{" "}
                          {application.followUpAt?.slice(0, 10) === application.silence.suggestedFollowUpOn ? (
                            <span>Set as your follow-up.</span>
                          ) : (
                            <button
                              type="button"
                              className="underline underline-offset-2"
                              disabled={busyId === application.id}
                              onClick={() =>
                                void transition(application.id, {
                                  action: "follow_up",
                                  followUpAt: `${application.silence!.suggestedFollowUpOn}T09:00:00.000Z`,
                                })}
                            >
                              Use this date
                            </button>
                          )}
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge
                      tone={
                        application.approvalStatus === "approved"
                          ? "safe"
                          : application.approvalStatus === "rejected"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {application.approvalStatus === "pending_review"
                        ? "Awaiting your review"
                        : application.approvalStatus}
                    </StatusBadge>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {["FOUND", "QUALIFIED", "RESUME_CREATED"].includes(application.stage) ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busyId === application.id}
                        onClick={() => void prepare(application.id)}
                      >
                        {busyId === application.id ? "Generating…" : "Prepare application"}
                      </button>
                    ) : null}
                    {application.stage === "READY_FOR_REVIEW" && application.approvalStatus === "pending_review" ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busyId === application.id}
                          onClick={() => void transition(application.id, { action: "approve" })}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busyId === application.id}
                          onClick={() => void transition(application.id, { action: "reject" })}
                        >
                          Reject
                        </button>
                      </>
                    ) : null}
                    {nextStages(application.stage, approved).map((stage) => (
                      <button
                        key={stage}
                        type="button"
                        className="btn btn-sm"
                        disabled={busyId === application.id}
                        onClick={() => void transition(application.id, { action: "advance", stage })}
                      >
                        Move to {stageLabel(stage)}
                      </button>
                    ))}
                    {application.stage !== "CLOSED" ? (
                      <span className="inline-flex items-center gap-1.5">
                        <label className="sr-only" htmlFor={`close-reason-${application.id}`}>
                          Why is it closing?
                        </label>
                        <select
                          id={`close-reason-${application.id}`}
                          value={closeReasons[application.id] ?? ""}
                          onChange={(event) =>
                            setCloseReasons((current) => ({
                              ...current,
                              [application.id]: event.target.value as "" | ClosedReason,
                            }))}
                          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
                        >
                          <option value="">Why? (optional)</option>
                          {CLOSED_REASONS.map((reason) => (
                            <option key={reason} value={reason}>{CLOSED_REASON_LABELS[reason]}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busyId === application.id}
                          onClick={() =>
                            void transition(application.id, {
                              action: "close",
                              closedReason: closeReasons[application.id] || null,
                            })}
                        >
                          Close
                        </button>
                      </span>
                    ) : null}
                  </div>

                  <details
                    className="mt-3"
                    data-testid="requirements-check"
                    onToggle={(event) => {
                      if ((event.target as HTMLDetailsElement).open && !requirementsByJob[job.id]) {
                        void loadRequirements(job.id);
                      }
                    }}
                  >
                    <summary className="cursor-pointer text-sm text-[var(--text-muted)]">
                      Requirements check
                    </summary>
                    <div className="mt-2 space-y-2 text-sm">
                      {requirementsByJob[job.id] === undefined ? (
                        <p className="text-[var(--text-faint)]">Checking the posting&rsquo;s requirement lines…</p>
                      ) : requirementsByJob[job.id] === "failed" ? (
                        <p className="text-[var(--danger)]">The requirements could not be checked.</p>
                      ) : (
                        (() => {
                          const view = requirementsByJob[job.id] as RequirementsView;
                          return (
                            <>
                              <p className="text-xs text-[var(--text-muted)]">
                                {view.counts.met} met · {view.counts.unmet} not met · {view.counts.unknown} unknown. {view.basis}
                              </p>
                              {view.checks.length === 0 ? null : (
                                <ul className="space-y-1.5">
                                  {view.checks.map((check) => (
                                    <li key={check.line} className="rounded-md border border-[var(--border)] p-2">
                                      <span
                                        className={`mr-2 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${check.verdict === "met" ? "border-[var(--accent)] text-[var(--accent)]" : check.verdict === "unmet" ? "border-[var(--warning)] text-[var(--warning)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}
                                      >
                                        {check.verdict === "met" ? "Met" : check.verdict === "unmet" ? "Not met" : "Unknown"}
                                      </span>
                                      <span className="text-[var(--text)]">{check.line}</span>
                                      <p className="mt-1 text-xs text-[var(--text-muted)]">{check.reason}</p>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </>
                          );
                        })()
                      )}
                    </div>
                  </details>

                  <InterviewPrepSheet jobId={job.id} />

                  <ApplicationDetailsEditor
                    // Re-seeded from the server's answer after every save.
                    key={`${application.id}:${application.notes ?? ""}:${application.applicationUrl ?? ""}:${application.followUpAt ?? ""}`}
                    application={application}
                    busy={busyId === application.id}
                    onSave={(body) => transition(application.id, body)}
                  />

                  {!["FOUND", "QUALIFIED"].includes(application.stage) ? (
                    <details
                      className="mt-3"
                      onToggle={(event) => {
                        if ((event.target as HTMLDetailsElement).open && !documentsByApplication[application.id]) {
                          void loadDocuments(application.id);
                        }
                      }}
                    >
                      <summary className="cursor-pointer text-sm text-[var(--text-muted)]">
                        Generated documents
                      </summary>
                      <div className="mt-2 space-y-3">
                        {(documentsByApplication[application.id] ?? []).length === 0 ? (
                          <p className="text-sm text-[var(--text-faint)]">
                            No documents stored yet. Prepare the application to generate the
                            resume and cover letter from your recorded profile.
                          </p>
                        ) : (
                          (documentsByApplication[application.id] ?? []).map((document) => (
                            <div key={document.id} className="rounded-md border border-[var(--border)] p-3">
                              <p className="text-xs font-semibold uppercase text-[var(--text-faint)]">
                                {document.kind.replaceAll("_", " ")} · v{document.version}
                              </p>
                              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-[var(--text)]">
                                {document.content}
                              </pre>
                            </div>
                          ))
                        )}
                        <p className="text-xs text-[var(--text-faint)]">
                          Generated from your recorded career profile only — a term you have
                          not recorded never appears, whatever the posting asks for. Every
                          version is stored immutably.
                        </p>
                      </div>
                    </details>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
