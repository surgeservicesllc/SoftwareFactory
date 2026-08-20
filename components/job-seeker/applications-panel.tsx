"use client";

import { useCallback, useEffect, useState } from "react";

import { Card, EmptyState, SectionTitle, StatusBadge } from "@/components/ui";
import type { JobView } from "@/components/job-seeker/jobs-panel";

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

export function JobSeekerApplicationsPanel() {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [problem, setProblem] = useState("");
  const [busyId, setBusyId] = useState("");

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
                      </p>
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
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busyId === application.id}
                        onClick={() => void transition(application.id, { action: "close" })}
                      >
                        Close
                      </button>
                    ) : null}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
