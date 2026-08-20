"use client";

import { useCallback, useEffect, useState } from "react";

import { Card, EmptyState, SectionTitle } from "@/components/ui";

/**
 * Search analytics: counts and averages over the person's own recorded
 * pipeline. A rate with no denominator renders as "—", because "no
 * applications yet" is a different fact from "0% response rate".
 */

type AnalyticsView = {
  jobsFound: number;
  qualified: number;
  applications: number;
  responseRate: number | null;
  interviews: number;
  offers: number;
  averageMatchScore: number | null;
  byTitle: Array<{ title: string; jobs: number; averageScore: number }>;
  bySource: Array<{ source: string; count: number }>;
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text)]">{value}</p>
    </Card>
  );
}

export function JobSeekerAnalyticsPanel() {
  const [analytics, setAnalytics] = useState<AnalyticsView | null>(null);
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/job-seeker/analytics", { cache: "no-store" });
      if (!response.ok) {
        setProblem("Analytics could not be computed.");
        return;
      }
      const body = (await response.json()) as { analytics?: AnalyticsView };
      setAnalytics(body.analytics ?? null);
    } catch {
      setProblem("Analytics could not be computed.");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  if (problem) {
    return (
      <Card>
        <p role="alert" className="text-sm text-[var(--danger)]">{problem}</p>
      </Card>
    );
  }
  if (!analytics) {
    return (
      <Card className="min-h-48 animate-pulse">
        <span className="sr-only">Loading analytics</span>
      </Card>
    );
  }
  if (analytics.jobsFound === 0) {
    return (
      <EmptyState
        title="No analytics yet"
        description="Analytics are computed from your recorded pipeline — record a first job and the numbers appear here, counted, never estimated."
        actionLabel="Open Job Discovery"
        actionHref="/job-seeker?section=discovery"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Jobs found" value={String(analytics.jobsFound)} />
        <Stat label="Qualified" value={String(analytics.qualified)} />
        <Stat label="Applications" value={String(analytics.applications)} />
        <Stat
          label="Response rate"
          value={analytics.responseRate === null ? "—" : `${analytics.responseRate}%`}
        />
        <Stat label="Interviews" value={String(analytics.interviews)} />
        <Stat label="Offers" value={String(analytics.offers)} />
        <Stat
          label="Average match score"
          value={analytics.averageMatchScore === null ? "—" : `${analytics.averageMatchScore}/100`}
        />
      </div>

      {analytics.byTitle.length > 0 ? (
        <Card>
          <SectionTitle title="Match strength by title" />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-96 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-[var(--text-faint)]">
                  <th className="pb-2 pr-4 font-medium">Title</th>
                  <th className="pb-2 pr-4 font-medium">Jobs</th>
                  <th className="pb-2 font-medium">Average score</th>
                </tr>
              </thead>
              <tbody>
                {analytics.byTitle.map((row) => (
                  <tr key={row.title} className="border-t border-[var(--border)]">
                    <td className="py-2 pr-4 text-[var(--text)]">{row.title}</td>
                    <td className="py-2 pr-4 tabular-nums text-[var(--text-muted)]">{row.jobs}</td>
                    <td className="py-2 tabular-nums text-[var(--text)]">{row.averageScore}/100</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {analytics.bySource.length > 0 ? (
        <Card>
          <SectionTitle title="Jobs by source" />
          <ul className="mt-3 space-y-1 text-sm">
            {analytics.bySource.map((row) => (
              <li key={row.source} className="flex justify-between gap-4">
                <span className="text-[var(--text-muted)]">{row.source}</span>
                <span className="tabular-nums text-[var(--text)]">{row.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="text-xs text-[var(--text-faint)]">
        Every number on this page is a count or an average over your recorded rows — never an
        estimate.
      </p>
    </div>
  );
}
