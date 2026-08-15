"use client";

import { useEffect, useMemo, useState } from "react";

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
      <span className="text-xs text-neutral-500">{label}</span>
      <span className={value === null ? "text-sm text-neutral-500 italic" : "text-sm font-medium"}>
        {value === null ? "Unknown" : value}
      </span>
    </div>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <div className="flex flex-col">
        <span className="text-xs text-neutral-500">{label}</span>
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

export function PortfolioConsole() {
  const [view, setView] = useState<PortfolioView | null>(null);
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
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = useMemo(() => {
    if (!view) return [];
    return sortProjects(filterProjects(view.projects, query), sort);
  }, [view, query, sort]);

  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!view) return <p className="text-sm text-neutral-500">Loading the portfolio…</p>;

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
          <span className="text-xs text-neutral-500">Search projects</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or repository"
            className="rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Sort by</span>
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
                      <span className="font-medium">{project.name}</span>
                      <span className="text-xs text-neutral-500">
                        {project.repository ?? "No repository bound"}
                      </span>
                    </div>
                    <span className="text-xs uppercase tracking-wide text-neutral-500">
                      {project.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
                    <Count value={project.openCommands} label="Commands" />
                    <Count value={project.activeRuns} label="Active runs" />
                    <Count value={project.openTasks} label="Open tasks" />
                    <Count value={project.openIncidents} label="Incidents" />
                    <div className="flex flex-col">
                      <span className="text-xs text-neutral-500">Health</span>
                      <span className="text-sm">{project.health}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-neutral-500">Connection</span>
                      <ConnectionLabel health={project.connectionHealth} />
                    </div>
                  </div>

                  <div className="text-xs text-neutral-500">
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
