"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, Loader2 } from "lucide-react";

import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { InterviewPrepSheet } from "@/components/job-seeker/interview-prep";
import { stageLabel, type JobSeekerJobView } from "@/lib/job-seeker/overview";

/**
 * The applications that reached a conversation.
 *
 * Derived from the same recorded jobs every other page reads rather than from
 * a separate interview table: an interview *is* an application at a stage, and
 * storing it twice is how two screens start disagreeing about how many you
 * have. Offers are shown alongside, because the question "where did the
 * interviews go?" is the one this page exists to answer.
 */

const INTERVIEW_STAGES = new Set(["INTERVIEW", "FINAL_INTERVIEW"]);
const CONCLUDED_STAGES = new Set(["OFFER", "CLOSED"]);

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; jobs: JobSeekerJobView[] };

export function JobSeekerInterviewsPanel() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/job-seeker/jobs", { cache: "no-store" });
      if (!response.ok) {
        setState({ kind: "error" });
        return;
      }
      const body = (await response.json()) as { jobs?: JobSeekerJobView[] };
      setState({ kind: "ready", jobs: body.jobs ?? [] });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const interviewing = state.kind === "ready"
    ? state.jobs.filter((job) => INTERVIEW_STAGES.has(job.application?.stage ?? ""))
    : [];
  const concluded = state.kind === "ready"
    ? state.jobs.filter((job) => CONCLUDED_STAGES.has(job.application?.stage ?? ""))
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interview Tracker"
        description="Every application that reached a conversation, and where each one ended. Each one carries a prep sheet composed from your own facts."
      />

      {state.kind === "loading" ? (
        <Card className="grid min-h-40 place-items-center">
          <Loader2 className="size-5 animate-spin text-accent" aria-label="Loading interviews" />
        </Card>
      ) : state.kind === "error" ? (
        <Card className="p-6">
          <h2 className="text-base font-semibold text-foreground">Interviews could not be loaded</h2>
          <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm mt-4">
            Try again
          </button>
        </Card>
      ) : (
        <>
          <section aria-label="In progress">
            <h2 className="label">In progress</h2>
            {interviewing.length === 0 ? (
              <Card className="mt-2 p-5">
                <p className="max-w-2xl text-sm text-muted">
                  No application is at an interview stage. This list is derived from the applications
                  themselves — move one to Interview on the Applications page and it appears here.
                </p>
                <Link href="/job-seeker/applications" className="btn btn-secondary btn-sm mt-3">
                  Open Applications
                </Link>
              </Card>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--border)]">
                {interviewing.map((job) => (
                  <li key={job.id} className="flex flex-wrap items-center gap-2 py-3">
                    <CalendarCheck className="size-4 shrink-0 text-faint" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{job.company}</p>
                      <p className="truncate text-sm text-faint">{job.title}</p>
                    </div>
                    {typeof job.match?.score === "number" ? (
                      <StatusBadge tone="safe" dot={false}>{job.match.score}% match</StatusBadge>
                    ) : null}
                    <StatusBadge tone="info" dot={false}>
                      {stageLabel(job.application?.stage ?? "")}
                    </StatusBadge>
                    <div className="basis-full">
                      <InterviewPrepSheet jobId={job.id} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Concluded">
            <h2 className="label">Concluded</h2>
            {concluded.length === 0 ? (
              <Card className="mt-2 p-5">
                <p className="text-sm text-muted">Nothing has reached an offer or been closed yet.</p>
              </Card>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--border)]">
                {concluded.map((job) => (
                  <li key={job.id} className="flex flex-wrap items-center gap-2 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{job.company}</p>
                      <p className="truncate text-sm text-faint">{job.title}</p>
                    </div>
                    <StatusBadge
                      tone={job.application?.stage === "OFFER" ? "safe" : "neutral"}
                      dot={false}
                    >
                      {stageLabel(job.application?.stage ?? "")}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
