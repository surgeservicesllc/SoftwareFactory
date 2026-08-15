"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { PortfolioProject, PortfolioView } from "@/lib/portfolio/aggregate";
import { Card, Notice } from "@/components/ui";

/**
 * One project, in the factory's terms.
 *
 * This reads the same RLS-scoped portfolio aggregate as the portfolio console
 * and shows the single requested project, so the two surfaces can never
 * disagree about a count: same source, same null-means-Unknown rule, same
 * attention derivation.
 *
 * The linked surfaces below are the real Files/Backlog/Runs/Agents/Reports/
 * Activity consoles. They are factory-wide views today, and the links say so
 * rather than implying a per-project filter that does not exist yet.
 */

const SURFACES = [
  { href: "/solutions/files", label: "Files", note: "Repository files through the GitHub connection" },
  { href: "/solutions/backlog", label: "Backlog", note: "Tasks across the factory" },
  { href: "/solutions/runs", label: "Runs", note: "Durable worker runs" },
  { href: "/solutions/agents", label: "Agents", note: "Logical agent roster" },
  { href: "/solutions/reports", label: "Reports", note: "Operations reporting" },
  { href: "/solutions/activity", label: "Activity", note: "Immutable audit events" },
] as const;

function Count({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-sm">{value === null ? "Unknown" : value}</span>
    </div>
  );
}

export function ProjectDetailConsole({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<PortfolioProject | null>(null);
  const [unavailable, setUnavailable] = useState<readonly string[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/portfolio", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("The portfolio could not be loaded.");
        return response.json() as Promise<{ portfolio: PortfolioView }>;
      })
      .then((body) => {
        if (cancelled) return;
        const found = body.portfolio.projects.find((entry) => entry.id === projectId) ?? null;
        setProject(found);
        setUnavailable(body.portfolio.unavailable);
        // A project the RLS-scoped read did not return is indistinguishable
        // from one that does not exist, and saying "missing" for both is the
        // honest rendering: this surface must not reveal which.
        setState(found ? "ready" : "missing");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (state === "loading") {
    return <p className="text-sm text-muted">Loading project…</p>;
  }
  if (state === "error") {
    return <Notice tone="danger">The portfolio could not be loaded.</Notice>;
  }
  if (state === "missing" || !project) {
    return (
      <Notice tone="warning">
        This project is not visible to your organization, or it does not exist.
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex flex-col">
              <span className="font-medium">{project.name}</span>
              <span className="text-xs text-muted">
                {project.repository ?? "No repository bound"}
              </span>
            </div>
            <span className="text-xs uppercase tracking-wide text-muted">{project.status}</span>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            <Count value={project.openCommands} label="Commands" />
            <Count value={project.activeRuns} label="Active runs" />
            <Count value={project.openTasks} label="Open tasks" />
            <Count value={project.openIncidents} label="Incidents" />
            <Count value={project.draftPullRequests} label="Draft PRs" />
            <Count value={project.activeDeployments} label="Deploys active" />
            <div className="flex flex-col">
              <span className="text-xs text-muted">Health</span>
              <span className="text-sm">{project.health}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted">Connection</span>
              <span className="text-sm">{project.connectionHealth.replace("_", " ")}</span>
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

          {unavailable.length > 0 && (
            <p className="text-xs text-muted">
              {`Unknown counts above reflect sources that could not be read: ${unavailable.join(", ")}.`}
            </p>
          )}
        </div>
      </Card>

      <section aria-label="Factory surfaces">
        <h2 className="mb-3 text-sm font-medium">Work in the factory</h2>
        <p className="mb-3 text-xs text-muted">
          These consoles are factory-wide views; a per-project filter is not built yet, and these
          links do not pretend otherwise.
        </p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SURFACES.map((surface) => (
            <li key={surface.href}>
              <Link href={surface.href} className="block">
                <Card>
                  <span className="font-medium">{surface.label}</span>
                  <p className="text-xs text-muted">{surface.note}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
