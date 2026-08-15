"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { SchedulingView } from "@/lib/portfolio/scheduling";
import {
  filterProjects,
  sortProjects,
  type PortfolioProject,
  type PortfolioView,
  type SortKey,
} from "@/lib/portfolio/aggregate";
import { Card, EmptyState, Notice, SectionTitle } from "@/components/ui";

/**
 * The portfolio console.
 *
 * The rule this component exists to keep is that **a number is only shown when
 * the factory established it.** `null` from the aggregation means the source
 * could not be read, and it renders as "Unknown" — never as 0, and never as a
 * dash that a reader would take for zero.
 */

const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  attention: "Needs attention",
  health: "Health",
  activity: "Active runs",
  name: "Name",
};

/** Unknown is a word, not a number and not a blank. */
function Count({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted">{label}</span>
      <span className={value === null ? "text-sm text-muted italic" : "text-sm font-medium"}>
        {value === null ? "Unknown" : value}
      </span>
    </div>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <div className="flex flex-col">
        <span className="text-xs text-muted">{label}</span>
        <span className="text-2xl font-semibold">{value}</span>
      </div>
    </Card>
  );
}

function ConnectionLabel({ health }: { health: PortfolioProject["connectionHealth"] }) {
  const text = {
    connected: "Connected",
    degraded: "Degraded",
    not_connected: "Not Connected",
    unknown: "Unknown",
  }[health];
  return <span className="text-sm">{text}</span>;
}

function priorityLabel(priority: number) {
  return `P${priority}`;
}

function waitedLabel(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/**
 * Capacity, the queue, and the bottleneck.
 *
 * Same rule as the counts above: nothing here is computed in the browser. Every
 * number and every reason comes from the functions the scheduler itself calls,
 * so the console cannot show a queue order the scheduler would not follow.
 */
function SchedulingPanel({ scheduling }: { scheduling: SchedulingView }) {
  const { capacity, projects, queue, unavailable } = scheduling;
  const running = queue.filter((item) => item.runStatus === "running");
  const waiting = queue.filter((item) => item.runStatus === "queued");
  const blocked = waiting.filter((item) => item.blockedReason !== null);

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle title="Portfolio capacity" />

      {unavailable.length > 0 && (
        <Notice tone="warning">
          {`These scheduling sources could not be read, so they are not shown: ${unavailable.join(", ")}.`}
        </Notice>
      )}

      {capacity === null ? (
        <EmptyState
          title="Capacity is unknown"
          description="The portfolio capacity projection could not be read, so no figures are shown here rather than showing zeros."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Total label="Running now" value={capacity.activeRuns} />
            <Total label="Queued" value={capacity.queuedRuns} />
            <Total label="Ordinary ceiling" value={capacity.ordinaryCeiling} />
            <Total label="Reserved for P0" value={capacity.emergencyReserved} />
          </div>
          <p className="text-xs text-muted">
            {`Portfolio ceiling ${capacity.organizationLimit}, of which ${capacity.emergencyReserved} `}
            {"are reserved for emergency work — routine work stops at "}
            {`${capacity.ordinaryCeiling} so an incident never has to interrupt a running job. `}
            {`Queued work gains one priority tier every ${Math.round(capacity.fairnessPromotionSeconds / 60)} minutes it waits.`}
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {/* Workers are not organization-scoped in Phase 1C, so these are
                factory-wide totals. Labelled rather than quietly implied. */}
            <Count value={capacity.workerCount} label="Workers (factory-wide)" />
            <Count value={capacity.workerCapacity} label="Worker slots (factory-wide)" />
            <Count value={capacity.openBreakers} label="Open circuit breakers" />
            <Count value={capacity.pausedProjects} label="Paused projects" />
          </div>
          {capacity.emergencyQueued > 0 && (
            <Notice tone="warning">
              {`${capacity.emergencyQueued} emergency ${capacity.emergencyQueued === 1 ? "item is" : "items are"} queued.`}
            </Notice>
          )}
        </>
      )}

      <SectionTitle title={`Queue (${waiting.length} waiting, ${running.length} running)`} />

      {queue.length === 0 ? (
        <EmptyState
          title="Nothing queued or running"
          description="No work is waiting for capacity in this portfolio."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {queue.map((item) => (
            <li key={item.runId}>
              <Card>
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {item.queuePosition === null ? "Running" : `#${item.queuePosition}`}
                      {" · "}
                      {item.projectName}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-muted">
                      {`${priorityLabel(item.effectivePriority)} effective`}
                      {item.effectivePriority !== item.projectPriority
                        && ` (project ${priorityLabel(item.projectPriority)})`}
                      {item.emergency && " · emergency"}
                      {item.strategicFocus && " · focused"}
                    </span>
                  </div>
                  <span className="text-sm">{item.taskTitle}</span>
                  <span className="text-xs text-muted">
                    {item.runStatus === "running"
                      ? `Running for ${waitedLabel(item.waitingSeconds)}`
                      : `Waiting ${waitedLabel(item.waitingSeconds)}`}
                    {item.blockedReason !== null && ` — ${item.blockedReason}`}
                  </span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {blocked.length > 0 && (
        <Notice tone="warning">
          {`${blocked.length} queued ${blocked.length === 1 ? "item is" : "items are"} held by a ceiling or an unhealthy provider. The reason is on each row.`}
        </Notice>
      )}

      {projects.length > 0 && (
        <>
          <SectionTitle title="Project scheduling" />
          <ul className="flex flex-col gap-2">
            {projects.map((project) => (
              <li key={project.projectId}>
                <Card>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{project.projectName}</span>
                      <span className="text-xs uppercase tracking-wide text-muted">
                        {priorityLabel(project.engineeringPriority)}
                        {project.strategicFocus && " · strategic focus"}
                        {project.engineeringPaused && " · paused"}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <Count value={project.activeRuns} label="Running" />
                      <Count value={project.queuedRuns} label="Queued" />
                      <Count value={project.maximumConcurrentRuns} label="Ceiling" />
                    </div>
                    {project.engineeringPaused && (
                      <Notice tone="warning">
                        {`Engineering paused: ${project.engineeringPauseReason ?? "no reason recorded"}.`}
                      </Notice>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function PortfolioConsole() {
  const [view, setView] = useState<PortfolioView | null>(null);
  const [scheduling, setScheduling] = useState<SchedulingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("attention");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/portfolio", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("The portfolio could not be loaded.");
        return response.json() as Promise<{ portfolio: PortfolioView }>;
      })
      .then((body) => {
        if (!cancelled) setView(body.portfolio);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unexpected error.");
      });
    // Scheduling is fetched separately and its failure is not fatal: the
    // portfolio is still worth showing without it, and the panel says so.
    fetch("/api/portfolio/scheduling", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return response.json() as Promise<{ scheduling: SchedulingView }>;
      })
      .then((body) => {
        if (!cancelled) setScheduling(body.scheduling);
      })
      .catch(() => {
        if (!cancelled) {
          setScheduling({
            capacity: null,
            projects: [],
            queue: [],
            unavailable: ["capacity", "queue", "projects"],
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const shown = useMemo(() => {
    if (!view) return [];
    return sortProjects(filterProjects(view.projects, query), sort);
  }, [view, query, sort]);

  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!view) {
    // Labelled the way every other console labels its spinner, so an
    // accessibility sweep can wait for the settled state rather than auditing
    // the loading one — and so a screen reader is told what is loading.
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading the portfolio" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Total label="Projects" value={view.totals.projects} />
        <Total label="Active" value={view.totals.active} />
        <Total label="Paused" value={view.totals.paused} />
        <Total label="Need attention" value={view.totals.needingAttention} />
      </div>

      {view.unavailable.length > 0 && (
        // Said once, rather than repeated as "Unknown" on every row without
        // explanation. The reader needs to know these counts are missing
        // because a source failed, not because the work is not there.
        <Notice tone="warning">
          {`These sources could not be read, so their counts show as Unknown: ${view.unavailable.join(", ")}.`}
        </Notice>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Search projects</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or repository"
            className="rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Sort by</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>{SORT_LABELS[key]}</option>
            ))}
          </select>
        </label>
      </div>

      {scheduling !== null && <SchedulingPanel scheduling={scheduling} />}

      <SectionTitle title={`Projects (${shown.length})`} />

      {shown.length === 0 ? (
        <EmptyState
          title={view.projects.length === 0 ? "No projects yet" : "No projects match that search"}
          description={
            view.projects.length === 0
              ? "Connect a repository to create the first project."
              : "Clear the search to see the whole portfolio."
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((project) => (
            <li key={project.id}>
              <Card>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-col">
                      <Link
                        href={`/solutions/portfolio/${project.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {project.name}
                      </Link>
                      <span className="text-xs text-muted">
                        {project.repository ?? "No repository bound"}
                      </span>
                    </div>
                    <span className="text-xs uppercase tracking-wide text-muted">
                      {project.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                    <Count value={project.openCommands} label="Commands" />
                    <Count value={project.activeRuns} label="Active runs" />
                    <Count value={project.openTasks} label="Open tasks" />
                    <Count value={project.openIncidents} label="Incidents" />
                    <div className="flex flex-col">
                      <span className="text-xs text-muted">Health</span>
                      <span className="text-sm">{project.health}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-muted">Connection</span>
                      <ConnectionLabel health={project.connectionHealth} />
                    </div>
                  </div>

                  <div className="text-xs text-muted">
                    {project.autonomousMode
                      ? `Autonomous mode on, ceiling ${project.maximumAutonomousRisk}`
                      : "Autonomous mode off"}
                  </div>

                  {project.ownerAttention && (
                    <Notice tone="warning">
                      {`Needs attention: ${project.attentionReasons.join("; ")}.`}
                    </Notice>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
