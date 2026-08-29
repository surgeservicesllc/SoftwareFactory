"use client";

import {
  Bell, Bookmark, BookmarkCheck, Compass, ExternalLink, Loader2,
  Send, Sparkles, Target,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Card, EmptyState, MetricCard, StatusBadge } from "@/components/ui";
import {
  activeThreshold, applyFilters, creditMeter, discoveryHeadlines, EMPTY_FILTERS,
  filtersActive, PAGE_SIZE, pageWindow, paginate, SORT_OPTIONS, sortJobs,
  topMatchingSkills,
  type DiscoveryFilters, type DiscoveryJob, type SortKey,
} from "@/lib/job-seeker/discovery";
import { cn } from "@/lib/cn";

/**
 * Job Discovery, as the owner's design lays it out.
 *
 * Five figures, a filter bar, a scored list beside a detail panel, and a
 * pagination footer. Every number is a count over rows this workspace holds:
 * the headline figures and the list are derived from one fetch, so a headline
 * cannot claim 247 above a list holding 246.
 *
 * Where the design shows a figure this system does not measure, the figure is
 * omitted rather than filled. That applies to the credit meter, which appears
 * only when a workspace has an allowance recorded, and to every "+N this week"
 * delta, which is a real count inside a real window or absent.
 */

type Payload = {
  jobs?: DiscoveryJob[];
  appliedThisWeek?: number | null;
  activeAlerts?: number | null;
  searchesThisWeek?: number | null;
  weeklySearchAllowance?: number | null;
  windowDays?: number;
};

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; payload: Payload };

const DETAIL_TABS = ["Match Analysis", "Job Details", "Company Insights", "Key Requirements"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

export function JobDiscoveryConsole() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [filters, setFilters] = useState<DiscoveryFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("score");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("Match Analysis");
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/job-seeker/discovery", { cache: "no-store" });
      if (!response.ok) {
        setState({ kind: "error" });
        return;
      }
      setState({ kind: "ready", payload: (await response.json()) as Payload });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    // Deferred rather than called in the effect body: the first paint is the
    // loading card, and the fetch that replaces it starts a tick later.
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  const jobs = useMemo(
    () => (state.kind === "ready" ? state.payload.jobs ?? [] : []),
    [state],
  );

  const visible = useMemo(
    () => sortJobs(applyFilters(jobs, filters), sort),
    [jobs, filters, sort],
  );
  const pageOf = useMemo(() => paginate(visible, page, PAGE_SIZE), [visible, page]);

  // The selected job follows the filtered list: a selection filtered out of
  // view would leave the detail panel describing something the list no longer
  // shows.
  const selected = useMemo(
    () => visible.find((job) => job.id === selectedId) ?? pageOf.items[0] ?? null,
    [visible, selectedId, pageOf.items],
  );

  const headlines = useMemo(
    () => discoveryHeadlines(jobs, {
      appliedThisWeek: state.kind === "ready" ? state.payload.appliedThisWeek ?? 0 : 0,
      activeAlerts: state.kind === "ready" ? state.payload.activeAlerts ?? 0 : 0,
    }),
    [jobs, state],
  );

  const bar = activeThreshold(jobs);
  const meter = state.kind === "ready"
    ? creditMeter(state.payload.searchesThisWeek ?? 0, state.payload.weeklySearchAllowance)
    : null;

  const toggleSave = useCallback(async (job: DiscoveryJob) => {
    setSavingId(job.id);
    try {
      const response = await fetch(`/api/job-seeker/jobs/${job.id}/save`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saved: !job.savedAt }),
      });
      if (response.ok) await load();
    } finally {
      setSavingId(null);
    }
  }, [load]);

  const setFilter = useCallback(<K extends keyof DiscoveryFilters>(key: K, value: DiscoveryFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }, []);

  if (state.kind === "loading") {
    return (
      <Card className="flex items-center gap-2 p-6 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading discovered jobs…
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold text-foreground">Job discovery could not be loaded</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          The request for your recorded postings failed. Nothing was changed.
        </p>
        <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => void load()}>
          Try again
        </button>
      </Card>
    );
  }

  const locations = [...new Set(jobs.map((job) => job.location).filter((v): v is string => Boolean(v)))].sort();
  const models = [...new Set(jobs.map((job) => job.workModel).filter((v): v is string => Boolean(v)))].sort();

  return (
    <div className="space-y-5">
      {/* Headline figures — one derivation, shared with the list below. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {headlines.map((entry) => (
          <MetricCard
            key={entry.label}
            label={entry.label === "High Match" && bar !== null ? `High Match (${bar}%+)` : entry.label}
            value={String(entry.value)}
            detail={entry.delta === null ? "" : `+${entry.delta} this week`}
            icon={
              entry.label === "New Opportunities" ? Compass
                : entry.label === "High Match" ? Target
                  : entry.label === "Applied This Week" ? Send
                    : entry.label === "Saved Jobs" ? Bookmark
                      : Bell
            }
            tone={entry.label === "High Match" ? "info" : "neutral"}
          />
        ))}
      </div>

      {/* Filter bar */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Search jobs by title, company, or keyword</span>
            <input
              type="search"
              value={filters.text}
              onChange={(event) => setFilter("text", event.target.value)}
              placeholder="Search jobs by title, company, or keyword…"
              className="input w-full"
            />
          </label>
          <select
            className="input w-auto"
            value={filters.location ?? ""}
            onChange={(event) => setFilter("location", event.target.value || null)}
            aria-label="Location"
          >
            <option value="">All Locations</option>
            {locations.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select
            className="input w-auto"
            value={filters.workModel ?? ""}
            onChange={(event) => setFilter("workModel", event.target.value || null)}
            aria-label="Work model"
          >
            <option value="">All Arrangements</option>
            {models.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select
            className="input w-auto"
            value={filters.minimumScore === null ? "" : String(filters.minimumScore)}
            onChange={(event) => setFilter("minimumScore", event.target.value ? Number(event.target.value) : null)}
            aria-label="Minimum match score"
          >
            <option value="">Any match</option>
            <option value="90">90%+</option>
            <option value="80">80%+</option>
            <option value="60">60%+</option>
          </select>
          <button
            type="button"
            className={cn("btn btn-sm", filters.savedOnly ? "btn-secondary" : "btn-ghost")}
            aria-pressed={filters.savedOnly}
            onClick={() => setFilter("savedOnly", !filters.savedOnly)}
          >
            Saved only
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-faint">
            {filtersActive(filters) ? (
              <>
                Filters active ·{" "}
                <button
                  type="button"
                  className="text-accent underline underline-offset-2"
                  onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}
                >
                  Clear all
                </button>
              </>
            ) : "No filters applied"}
          </span>
          <label className="flex items-center gap-2 text-faint">
            Sort by
            <select
              className="input w-auto py-1 text-xs"
              value={sort}
              onChange={(event) => { setSort(event.target.value as SortKey); setPage(1); }}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {jobs.length === 0 ? (
        <EmptyState
          title="No postings recorded yet"
          description="Discovery reads the jobs this workspace has recorded. Import from a board or record one by hand and its match against your profile will appear here."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* The list */}
          <div>
            <ul className="space-y-2">
              {pageOf.items.map((job) => (
                <li key={job.id}>
                  <JobCard
                    job={job}
                    selected={selected?.id === job.id}
                    saving={savingId === job.id}
                    onSelect={() => setSelectedId(job.id)}
                    onToggleSave={() => void toggleSave(job)}
                  />
                </li>
              ))}
            </ul>

            <nav
              className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-faint"
              aria-label="Job list pages"
            >
              <span>
                Showing {pageOf.from} to {pageOf.to} of {pageOf.total} job{pageOf.total === 1 ? "" : "s"}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={pageOf.page <= 1}
                  onClick={() => setPage(pageOf.page - 1)}
                >
                  Previous
                </button>
                {pageWindow(pageOf.page, pageOf.pageCount).map((entry, index) => (
                  entry === "gap"
                    ? <span key={`gap-${index}`} aria-hidden className="px-1">…</span>
                    : (
                      <button
                        key={entry}
                        type="button"
                        aria-current={entry === pageOf.page ? "page" : undefined}
                        className={cn("btn btn-sm", entry === pageOf.page ? "btn-primary" : "btn-ghost")}
                        onClick={() => setPage(entry)}
                      >
                        {entry}
                      </button>
                    )
                ))}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={pageOf.page >= pageOf.pageCount}
                  onClick={() => setPage(pageOf.page + 1)}
                >
                  Next
                </button>
              </span>
            </nav>
          </div>

          {/* The detail panel */}
          {selected ? (
            <JobDetail
              job={selected}
              tab={detailTab}
              onTab={setDetailTab}
              saving={savingId === selected.id}
              onToggleSave={() => void toggleSave(selected)}
            />
          ) : (
            <Card className="p-5">
              <p className="text-sm text-muted">No job matches the current filters.</p>
            </Card>
          )}
        </div>
      )}

      {meter ? (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Search credits</h2>
            <span className="tabular text-xs text-faint">
              {meter.used.toLocaleString()} / {meter.allowance.toLocaleString()} used this week
            </span>
          </div>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded bg-[var(--border)]"
            role="progressbar"
            aria-valuenow={meter.used}
            aria-valuemin={0}
            aria-valuemax={meter.allowance}
            aria-label="Search credits used this week"
          >
            <div className="h-full bg-[var(--accent)]" style={{ width: `${meter.percent}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-faint">
            {meter.remaining.toLocaleString()} remaining. Counted from searches actually run in the
            last {state.payload.windowDays ?? 7} days.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

/** The score ring, drawn from the raw fraction so the arc cannot round away. */
function ScoreRing({ score, label }: { score: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg viewBox="0 0 36 36" className="h-11 w-11" role="img" aria-label={`${label}: ${score} percent`}>
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          cx="18" cy="18" r="15.5" fill="none"
          stroke={score >= 80 ? "var(--safe)" : score >= 60 ? "var(--warning)" : "var(--muted)"}
          strokeWidth="3" strokeLinecap="round" pathLength={100}
          strokeDasharray={`${score} ${100 - score}`} strokeDashoffset="25"
          transform="rotate(-90 18 18)"
        />
        <text x="18" y="21" textAnchor="middle" className="fill-foreground text-[9px] font-semibold">
          {score}%
        </text>
      </svg>
    </div>
  );
}

function JobCard({
  job, selected, saving, onSelect, onToggleSave,
}: {
  job: DiscoveryJob;
  selected: boolean;
  saving: boolean;
  onSelect: () => void;
  onToggleSave: () => void;
}) {
  return (
    <Card className={cn("p-3 transition-colors", selected && "border-[var(--accent)]")}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold text-foreground">{job.title}</p>
          <p className="truncate text-xs text-muted">{job.company}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-faint">
            {job.location ? <span>{job.location}</span> : null}
            {job.salaryText ? <span>{job.salaryText}</span> : null}
            {job.workModel ? <span>{job.workModel}</span> : null}
          </p>
        </button>
        <div className="flex items-center gap-2">
          {job.match
            ? <ScoreRing score={job.match.score} label={`${job.title} match score`} />
            : <span className="text-xs text-faint">Not scored</span>}
          <button
            type="button"
            onClick={onToggleSave}
            disabled={saving}
            aria-pressed={Boolean(job.savedAt)}
            aria-label={job.savedAt ? `Remove ${job.title} from saved jobs` : `Save ${job.title}`}
            className="btn btn-ghost btn-sm"
          >
            {saving
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              : job.savedAt
                ? <BookmarkCheck className="h-4 w-4 text-[var(--accent)]" aria-hidden />
                : <Bookmark className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </div>
    </Card>
  );
}

function JobDetail({
  job, tab, onTab, saving, onToggleSave,
}: {
  job: DiscoveryJob;
  tab: DetailTab;
  onTab: (tab: DetailTab) => void;
  saving: boolean;
  onToggleSave: () => void;
}) {
  const skills = topMatchingSkills(job.match?.breakdown);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{job.title}</h2>
          <p className="text-sm text-muted">{job.company}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-faint">
            {job.location ? <span>{job.location}</span> : null}
            {job.salaryText ? <span>{job.salaryText}</span> : null}
            {job.workModel ? <span>{job.workModel}</span> : null}
          </p>
        </div>
        {job.match ? (
          <div className="text-right">
            <ScoreRing score={job.match.score} label="Match score" />
            <p className="mt-0.5 text-xs text-faint">
              {job.match.qualified ? "Meets your bar" : `Below your ${job.match.threshold}% bar`}
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {job.url ? (
          <a href={job.url} target="_blank" rel="noreferrer noopener" className="btn btn-primary btn-sm">
            View job <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden />
          </a>
        ) : null}
        <button type="button" className="btn btn-secondary btn-sm" onClick={onToggleSave} disabled={saving}>
          {job.savedAt ? "Saved" : "Save job"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-1 border-b border-[var(--border)]" role="tablist">
        {DETAIL_TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            className={cn(
              "px-2.5 py-1.5 text-xs font-medium",
              tab === entry
                ? "border-b-2 border-[var(--accent)] text-foreground"
                : "text-muted hover:text-foreground",
            )}
            onClick={() => onTab(entry)}
          >
            {entry}
          </button>
        ))}
      </div>

      <div className="mt-3 text-sm" role="tabpanel">
        {tab === "Match Analysis" ? (
          job.match ? (
            <div className="space-y-4">
              {job.match.reasons.length > 0 ? (
                <section>
                  <h3 className="label">Why you&apos;re a strong match</h3>
                  <ul className="mt-1.5 space-y-1">
                    {job.match.reasons.map((reason) => (
                      <li key={reason} className="flex gap-2 text-xs text-muted">
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--safe)]" aria-hidden />
                        {reason}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {job.match.gaps.length > 0 ? (
                <section>
                  <h3 className="label">Potential gaps</h3>
                  <ul className="mt-1.5 space-y-1">
                    {job.match.gaps.map((gap) => (
                      <li key={gap} className="flex gap-2 text-xs text-muted">
                        <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]" aria-hidden />
                        {gap}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {skills.length > 0 ? (
                <section>
                  <h3 className="label">Top matching skills</h3>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {skills.map((skill) => (
                      <span key={skill} className="chip text-xs">{skill}</span>
                    ))}
                  </div>
                </section>
              ) : null}
              {job.match.reasons.length === 0 && job.match.gaps.length === 0 && skills.length === 0 ? (
                <p className="text-xs text-muted">
                  This posting was scored {job.match.score}%, but the scorer recorded no reasons,
                  gaps or per-criterion contributions to show.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted">
              This posting has not been scored, so there is no match analysis to show. Scoring
              needs a recorded profile and preferences.
            </p>
          )
        ) : tab === "Job Details" ? (
          job.description
            ? <p className="whitespace-pre-wrap text-xs text-muted">{job.description}</p>
            : <p className="text-xs text-muted">No description was recorded with this posting.</p>
        ) : tab === "Company Insights" ? (
          <div className="space-y-1 text-xs text-muted">
            <p><span className="text-faint">Company:</span> {job.company}</p>
            <p><span className="text-faint">Recorded from:</span> {job.source}</p>
            <p><span className="text-faint">Discovered:</span> {new Date(job.discoveredAt).toLocaleDateString()}</p>
            <p className="text-faint">
              Company research beyond what the posting carried is not connected; nothing here is
              inferred.
            </p>
          </div>
        ) : (
          job.match && job.match.gaps.length > 0
            ? (
              <ul className="space-y-1">
                {job.match.gaps.map((gap) => (
                  <li key={gap} className="text-xs text-muted">{gap}</li>
                ))}
              </ul>
            )
            : <p className="text-xs text-muted">No unmet requirements were recorded for this posting.</p>
        )}
      </div>

      {job.application ? (
        <p className="mt-4 text-xs text-faint">
          Application recorded — <StatusBadge tone="info" dot={false}>{job.application.stage}</StatusBadge>
        </p>
      ) : null}
    </Card>
  );
}
