/**
 * Turn per-project rows into one portfolio view.
 *
 * The objective's phrasing is "truthful health/status/active work/PRs/
 * deployments/incidents" and "no fake metrics", so the shape here is built
 * around a distinction the console must not blur: **zero is not unknown.**
 *
 * A project with no runs and a project whose runs cannot be read both produce
 * an empty list, and rendering both as "0 active" would state something the
 * factory does not know. Every count is therefore `number | null`, where null
 * means "not established" and renders as **Unknown** rather than as a number.
 *
 * This is a pure function on purpose. The counting rules are the part worth
 * testing, and they should not require a database to exercise.
 */

import type { RiskLevel } from "@/lib/risk";

export type ProjectHealth = "unknown" | "healthy" | "degraded" | "unhealthy";
export type ProjectStatus = "draft" | "active" | "paused" | "archived";

/**
 * Statuses that mean a unit of work is still in flight.
 *
 * Every name here exists in the corresponding Postgres enum, which was not
 * true when this file was written: it counted commands in `planning` and
 * `blocked`, tasks in `ready`, and incidents in `acknowledged` or `mitigating`,
 * none of which are values any of those enums can hold. A status that cannot
 * occur matches nothing, so the console reported a confident zero for work that
 * was plainly in flight — the worst kind of wrong number, because it looks
 * measured. Tasks in `queued` and commands in `submitted` were missed the same
 * way, by omission rather than invention.
 *
 * `tests/unit/portfolio-open-statuses.test.ts` reads the enums out of the
 * migrations and fails if a name here is not one of them.
 */
const OPEN_COMMAND_STATUSES = new Set([
  "submitted", "awaiting_approval", "queued", "running",
]);
const OPEN_RUN_STATUSES = new Set(["queued", "running"]);
const OPEN_TASK_STATUSES = new Set([
  "backlog", "awaiting_approval", "queued", "in_progress", "blocked",
]);
// Stated as everything short of resolution. An incident that has been
// investigated or mitigated but not resolved is still an incident.
const OPEN_INCIDENT_STATUSES = new Set(["open", "investigating", "mitigated"]);

export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly githubRepository: string | null;
  readonly healthStatus: ProjectHealth;
  readonly autonomousMode: boolean;
  readonly maximumAutonomousRisk: RiskLevel;
}

/** A `{project_id, status}` row from any of the counted tables. */
export interface StatusRow {
  readonly projectId: string;
  readonly status: string;
}

export interface ConnectionRow {
  readonly projectId: string;
  readonly status: string;
  readonly provider: string;
}

export interface PortfolioSources {
  readonly projects: readonly ProjectRow[];
  /** Null for any source that could not be read, which yields Unknown counts. */
  readonly commands: readonly StatusRow[] | null;
  readonly runs: readonly StatusRow[] | null;
  readonly tasks: readonly StatusRow[] | null;
  readonly incidents: readonly StatusRow[] | null;
  readonly connections: readonly ConnectionRow[] | null;
}

export interface PortfolioProject {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly repository: string | null;
  readonly health: ProjectHealth;
  readonly autonomousMode: boolean;
  readonly maximumAutonomousRisk: RiskLevel;
  /** null means not established, and must render as Unknown rather than 0. */
  readonly openCommands: number | null;
  readonly activeRuns: number | null;
  readonly openTasks: number | null;
  readonly openIncidents: number | null;
  /** The worst connection state bound to this project. */
  readonly connectionHealth: "connected" | "degraded" | "not_connected" | "unknown";
  /** True when something about this project needs a person. */
  readonly ownerAttention: boolean;
  readonly attentionReasons: readonly string[];
}

export interface PortfolioView {
  readonly projects: readonly PortfolioProject[];
  readonly totals: {
    readonly projects: number;
    readonly active: number;
    readonly paused: number;
    readonly needingAttention: number;
  };
  /** Sources that could not be read, so the console can say so once. */
  readonly unavailable: readonly string[];
}

function countFor(
  rows: readonly StatusRow[] | null,
  projectId: string,
  open: ReadonlySet<string>,
): number | null {
  if (rows === null) return null;
  return rows.filter((row) => row.projectId === projectId && open.has(row.status)).length;
}

function connectionHealthFor(
  rows: readonly ConnectionRow[] | null,
  projectId: string,
): PortfolioProject["connectionHealth"] {
  if (rows === null) return "unknown";
  const mine = rows.filter((row) => row.projectId === projectId);
  if (mine.length === 0) return "not_connected";
  // Worst wins: one broken connection makes the project degraded, because a
  // project is only as reachable as the link it actually needs.
  if (mine.some((row) => row.status === "error")) return "degraded";
  if (mine.some((row) => row.status === "not_connected" || row.status === "disabled")) {
    return "degraded";
  }
  if (mine.every((row) => row.status === "connected")) return "connected";
  return "unknown";
}

/**
 * Build the portfolio view.
 *
 * Attention is derived rather than stored, so it cannot go stale against the
 * facts it summarises. A project needs a person when it has an open incident,
 * when its connections are degraded, or when its own health says so.
 */
export function buildPortfolio(sources: PortfolioSources): PortfolioView {
  const unavailable: string[] = [];
  if (sources.commands === null) unavailable.push("commands");
  if (sources.runs === null) unavailable.push("runs");
  if (sources.tasks === null) unavailable.push("tasks");
  if (sources.incidents === null) unavailable.push("incidents");
  if (sources.connections === null) unavailable.push("connections");

  const projects = sources.projects.map((project): PortfolioProject => {
    const openIncidents = countFor(sources.incidents, project.id, OPEN_INCIDENT_STATUSES);
    const connectionHealth = connectionHealthFor(sources.connections, project.id);

    const attentionReasons: string[] = [];
    if (openIncidents !== null && openIncidents > 0) {
      attentionReasons.push(`${openIncidents} open incident${openIncidents === 1 ? "" : "s"}`);
    }
    if (connectionHealth === "degraded") attentionReasons.push("A connection is not healthy");
    if (project.healthStatus === "unhealthy") attentionReasons.push("Project health is unhealthy");
    if (project.healthStatus === "degraded") attentionReasons.push("Project health is degraded");

    return Object.freeze({
      id: project.id,
      name: project.name,
      status: project.status,
      repository: project.githubRepository,
      health: project.healthStatus,
      autonomousMode: project.autonomousMode,
      maximumAutonomousRisk: project.maximumAutonomousRisk,
      openCommands: countFor(sources.commands, project.id, OPEN_COMMAND_STATUSES),
      activeRuns: countFor(sources.runs, project.id, OPEN_RUN_STATUSES),
      openTasks: countFor(sources.tasks, project.id, OPEN_TASK_STATUSES),
      openIncidents,
      connectionHealth,
      ownerAttention: attentionReasons.length > 0,
      attentionReasons: Object.freeze(attentionReasons),
    });
  });

  return Object.freeze({
    projects: Object.freeze(projects),
    totals: Object.freeze({
      projects: projects.length,
      active: projects.filter((p) => p.status === "active").length,
      paused: projects.filter((p) => p.status === "paused").length,
      needingAttention: projects.filter((p) => p.ownerAttention).length,
    }),
    unavailable: Object.freeze(unavailable),
  });
}

export type SortKey = "name" | "attention" | "health" | "activity";

const HEALTH_ORDER: Readonly<Record<ProjectHealth, number>> = Object.freeze({
  unhealthy: 0,
  degraded: 1,
  unknown: 2,
  healthy: 3,
});

/**
 * Order projects for display.
 *
 * `attention` and `health` sort worst-first, because a portfolio is read to
 * find what is wrong. Unknown sorts *between* degraded and healthy rather than
 * last: not knowing is worse than being fine and better than being broken.
 */
export function sortProjects(
  projects: readonly PortfolioProject[],
  key: SortKey,
): readonly PortfolioProject[] {
  const byName = (a: PortfolioProject, b: PortfolioProject) => a.name.localeCompare(b.name);
  const sorted = [...projects];

  switch (key) {
    case "attention":
      return sorted.sort((a, b) =>
        Number(b.ownerAttention) - Number(a.ownerAttention) || byName(a, b));
    case "health":
      return sorted.sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || byName(a, b));
    case "activity":
      // Unknown activity sorts last here: it is not evidence of being busy.
      return sorted.sort((a, b) => (b.activeRuns ?? -1) - (a.activeRuns ?? -1) || byName(a, b));
    case "name":
    default:
      return sorted.sort(byName);
  }
}

/** Case-insensitive match on name or repository. Blank query matches all. */
export function filterProjects(
  projects: readonly PortfolioProject[],
  query: string,
): readonly PortfolioProject[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return projects;
  return projects.filter((project) =>
    project.name.toLowerCase().includes(needle)
    || (project.repository?.toLowerCase().includes(needle) ?? false));
}
