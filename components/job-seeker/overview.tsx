"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  CalendarClock,
  CheckCircle2,
  DollarSign,
  Loader2,
  MapPin,
  Search,
  Target,
  Users,
} from "lucide-react";

import {
  ApplicationsOverTime,
  ScoreDistribution,
  StatusRing,
} from "@/components/job-seeker/charts";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  APPLICATION_STAGES,
  buildOverview,
  type JobSeekerJobView,
} from "@/lib/job-seeker/overview";

/**
 * The job search at a glance.
 *
 * Every figure here is derived from the same recorded jobs, matches and
 * applications the rest of the section reads — `buildOverview` is a pure
 * function over that one list, so a number on this page cannot disagree with
 * the page it links to. Nothing is illustrative: an empty search says it is
 * empty rather than showing a demonstration of what a full one would look
 * like.
 */

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; profile: ProfileSummary | null };

type ProfileSummary = {
  fullName: string | null;
  headline: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
};

type PreferenceSummary = {
  targetTitles: string[];
  workArrangements: string[];
  locations: string[];
  compensationMinimum: number | null;
};

export function JobSeekerOverview() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [preferences, setPreferences] = useState<PreferenceSummary | null>(null);
  /*
   * The window the timeline covers. Held here and re-derived rather than
   * refetched: the model is a pure function over jobs already in hand, so
   * changing the range is arithmetic, not a round trip.
   */
  const [windowDays, setWindowDays] = useState(30);
  const [jobs, setJobs] = useState<JobSeekerJobView[]>([]);

  const load = useCallback(async () => {
    try {
      const [jobsResponse, profileResponse, preferencesResponse] = await Promise.allSettled([
        fetch("/api/job-seeker/jobs", { cache: "no-store" }),
        fetch("/api/job-seeker/profile", { cache: "no-store" }),
        fetch("/api/job-seeker/preferences", { cache: "no-store" }),
      ]);

      if (jobsResponse.status !== "fulfilled" || !jobsResponse.value.ok) {
        setState({ kind: "error" });
        return;
      }
      const jobsBody = (await jobsResponse.value.json()) as { jobs?: JobSeekerJobView[] };
      setJobs(jobsBody.jobs ?? []);

      let profile: ProfileSummary | null = null;
      if (profileResponse.status === "fulfilled" && profileResponse.value.ok) {
        const body = (await profileResponse.value.json()) as { profile?: ProfileSummary | null };
        profile = body.profile ?? null;
      }
      if (preferencesResponse.status === "fulfilled" && preferencesResponse.value.ok) {
        const body = (await preferencesResponse.value.json()) as {
          preferences?: PreferenceSummary | null;
        };
        setPreferences(body.preferences ?? null);
      }

      setState({ kind: "ready", profile });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  /*
   * Derived in render, not stored.
   *
   * The model is a pure function of the jobs already in hand and the chosen
   * window, so changing the range is arithmetic rather than a round trip — and
   * a copy held in state would be a second source that can fall behind the
   * first.
   */
  const model = useMemo(() => buildOverview(jobs, { windowDays }), [jobs, windowDays]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (state.kind === "loading") {
    return (
      <Card className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading your job search" />
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground">Your job search could not be loaded</h2>
        <p className="mt-2 text-sm text-muted">
          The records behind this page did not answer. Nothing is shown rather than a figure that
          might be wrong.
        </p>
        <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm mt-4">
          Try again
        </button>
      </Card>
    );
  }

  const { profile } = state;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Job Seeker Overview"
        description="Your job search at a glance."
        action={
          <Link href="/job-seeker/discovery" className="btn btn-primary btn-sm">
            <Search className="size-4" aria-hidden="true" />
            New job search
          </Link>
        }
      />

      {model.jobsFound === 0 ? (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-foreground">Nothing recorded yet</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            This page counts jobs you have recorded, the scores they were matched at, and the
            applications you have sent. None of that exists yet, so there is nothing to summarize —
            start with your career profile so matching has something to score against.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/job-seeker/profile" className="btn btn-primary btn-sm">Career Profile</Link>
            <Link href="/job-seeker/discovery" className="btn btn-secondary btn-sm">Job Discovery</Link>
          </div>
        </Card>
      ) : null}

      <section aria-label="Search totals" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile icon={Search} label="Jobs Found" value={model.jobsFound} />
        <StatTile icon={CheckCircle2} label="Applications Submitted" value={model.applied} />
        <StatTile icon={Users} label="Interviews" value={model.interviews} />
        <StatTile icon={Briefcase} label="Offers" value={model.offers} />
        <StatTile
          icon={Target}
          label="Avg. Match Score"
          value={model.averageMatchScore ?? "—"}
          note={model.averageMatchScore === null ? "No scored match yet" : undefined}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">Application Status</h2>
            <Link href="/job-seeker/applications" className="text-sm font-medium text-accent">
              View all applications
            </Link>
          </div>
          {model.applicationsTotal === 0 ? (
            <p className="mt-3 text-sm text-muted">No application has been recorded yet.</p>
          ) : (
            <StatusRing
              className="mt-4"
              slices={model.statusRing}
              total={model.applicationsTotal}
            />
          )}
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">Match Score Distribution</h2>
            <Link href="/job-seeker/discovery" className="text-sm font-medium text-accent">
              View job search
            </Link>
          </div>
          {model.scored === 0 ? (
            <p className="mt-3 text-sm text-muted">No job has been scored yet.</p>
          ) : (
            <ScoreDistribution className="mt-4" bands={model.scoreBands} />
          )}
          <p className="mt-3 text-xs text-faint">
            {model.scored} of {model.jobsFound} recorded job{model.jobsFound === 1 ? "" : "s"} carry a
            score. An unscored job is not counted as a low one.
          </p>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">Applications Over Time</h2>
          <label className="flex items-center gap-2 text-sm text-muted">
            <span className="sr-only">Time range</span>
            <select
              aria-label="Time range"
              value={windowDays}
              onChange={(event) => setWindowDays(Number(event.target.value))}
              className="input h-9 py-0 text-sm"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
        </div>
        {model.applied === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Nothing has been submitted yet, so there is no line to draw.
          </p>
        ) : (
          <>
            <ApplicationsOverTime
              className="mt-4"
              points={model.timeline}
              peak={model.timelinePeak}
            />
            <p className="mt-2 text-xs text-faint">
              {model.timelinePeak} submitted in total, cumulative across the last{" "}
              {windowDays} days. A day with no submission holds the line flat rather than
              being left out.
            </p>
          </>
        )}
        <Link href="/job-seeker/analytics" className="text-sm font-medium text-accent">
          View analytics
        </Link>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">Recent Applications</h2>
            <Link href="/job-seeker/applications" className="btn btn-secondary btn-sm">View all</Link>
          </div>
          {model.recent.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Nothing applied to yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--border)]">
              {model.recent.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{entry.company}</p>
                    <p className="truncate text-sm text-faint">{entry.title}</p>
                  </div>
                  {entry.score === null ? null : (
                    <StatusBadge tone="safe" dot={false}>{entry.score}% match</StatusBadge>
                  )}
                  <StatusBadge tone="info" dot={false}>{entry.stageLabel}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">Top Roles</h2>
            <Link href="/job-seeker/analytics" className="btn btn-secondary btn-sm">Analytics</Link>
          </div>
          {model.topTitles.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No scored role to rank yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-faint">
                    <th className="py-1.5 pr-3 font-medium">Role</th>
                    <th className="py-1.5 pr-3 font-medium">Jobs</th>
                    <th className="py-1.5 pr-3 font-medium">Applied</th>
                    <th className="py-1.5 font-medium">Best match</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {model.topTitles.map((row) => (
                    <tr key={row.title}>
                      <td className="max-w-56 truncate py-2 pr-3 text-foreground" title={row.title}>
                        {row.title}
                      </td>
                      <td className="py-2 pr-3 text-muted">{row.jobs}</td>
                      <td className="py-2 pr-3 text-muted">{row.applied}</td>
                      <td className="py-2 text-foreground">{row.bestScore ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-base font-semibold text-foreground">What you are searching for</h2>
        <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Preference icon={Target} label="Target roles" value={preferences?.targetTitles ?? []} />
          <Preference
            icon={MapPin}
            label="Location preference"
            value={[...(preferences?.workArrangements ?? []), ...(preferences?.locations ?? [])]}
          />
          <Preference
            icon={DollarSign}
            label="Target salary"
            value={
              preferences?.compensationMinimum
                ? [`${preferences.compensationMinimum.toLocaleString()}+`]
                : []
            }
          />
          <Preference
            icon={CalendarClock}
            label="Profile"
            value={[profile?.headline, profile?.location].filter((entry): entry is string => Boolean(entry))}
          />
        </dl>
        <Link href="/job-seeker/preferences" className="btn btn-secondary btn-sm mt-4">
          Edit job preferences
        </Link>
      </Card>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof Search;
  label: string;
  value: number | string;
  note?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--accent-surface)]">
          <Icon className="size-4 text-[var(--accent-text)]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm text-muted">{label}</p>
          <p className="mt-0.5 text-2xl font-semibold text-foreground">{value}</p>
          {note ? <p className="mt-0.5 text-xs text-faint">{note}</p> : null}
        </div>
      </div>
    </Card>
  );
}

function Preference({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Target;
  label: string;
  value: readonly string[];
}) {
  return (
    <div>
      <dt className="flex items-center gap-2 text-sm text-faint">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      <dd className={cn("mt-1 text-sm", value.length > 0 ? "text-foreground" : "text-faint")}>
        {value.length > 0 ? value.join(", ") : "Not set"}
      </dd>
    </div>
  );
}

export { APPLICATION_STAGES };
