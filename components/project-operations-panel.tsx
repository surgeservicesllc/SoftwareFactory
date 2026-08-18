"use client";

import { HeartPulse, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/ui";
import { healthTone } from "@/lib/operations/health";
import { HEALTH_STATE_LABELS, isProjectHealthState } from "@/lib/operations/types";

type ProjectOperations = {
  project: {
    healthState: string;
    healthReason: string | null;
    healthComputedAt: string | null;
    releasesFrozen: boolean;
    operationsStopped: boolean;
    ownerAttentionRequired: boolean;
  };
  releaseAuthority: { allowed: boolean; blockers: string[] };
  incidents: { id: string; status: string; severity: string | null }[];
  monitors: { id: string; connectionState: string }[];
  rollbacks: { id: string; state: string }[];
  repairs: { id: string; state: string }[];
};

/**
 * Production/operations facts for one project, shown inside its project card.
 *
 * It states health with its reason, whether releases are frozen, and the exact
 * blockers standing between this project and any autonomous release.
 */
export function ProjectOperationsPanel({ projectId }: { projectId: string }) {
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [operations, setOperations] = useState<ProjectOperations | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/operations/projects/${projectId}`, { cache: "no-store" });
      if (!response.ok) {
        setState("unavailable");
        return;
      }
      setOperations((await response.json()) as ProjectOperations);
      setState("ready");
    } catch {
      setState("unavailable");
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (state === "loading") {
    return (
      <p className="mt-5 flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading production status…
      </p>
    );
  }

  // Every field this panel reads is checked, not just the envelope. A response
  // that parsed as JSON but arrived without `project`, `incidents` or
  // `monitors` — an older deploy, a partially degraded read — used to reach
  // `operations.project.healthState` and throw, and because this panel renders
  // inside the project rows on My Projects, that one undefined took the whole
  // page down to a blank screen. Unavailable is the honest rendering of a
  // payload this cannot read, and it costs one panel instead of the page.
  if (
    state === "unavailable"
    || !operations
    || !operations.project
    || !operations.releaseAuthority
    || !Array.isArray(operations.releaseAuthority.blockers)
    || !Array.isArray(operations.incidents)
    || !Array.isArray(operations.monitors)
    || !Array.isArray(operations.repairs)
    || !Array.isArray(operations.rollbacks)
  ) {
    return (
      <p className="mt-5 rounded-lg border border-line px-3 py-2.5 text-sm text-muted">
        Production status is unavailable for this project.
      </p>
    );
  }

  const health = isProjectHealthState(operations.project.healthState)
    ? operations.project.healthState
    : "unknown";
  const openIncidents = operations.incidents.filter(
    (incident) => incident.status !== "resolved" && incident.status !== "closed",
  ).length;
  const connectedMonitors = operations.monitors.filter(
    (monitor) => monitor.connectionState === "connected",
  ).length;

  return (
    <section className="mt-5 rounded-lg border border-line p-4" aria-label="Production operations">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <HeartPulse className="size-4 text-accent" aria-hidden="true" />
          Production
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={healthTone(health)}>{HEALTH_STATE_LABELS[health]}</StatusBadge>
          {operations.project.releasesFrozen ? <StatusBadge tone="warning">Releases frozen</StatusBadge> : null}
          {operations.project.ownerAttentionRequired ? (
            <StatusBadge tone="danger">Owner attention</StatusBadge>
          ) : null}
        </div>
      </div>

      <p className="mt-2 text-sm text-muted">
        {operations.project.healthReason ?? "No health evidence has been recorded yet."}
      </p>

      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-4">
        <div className="flex justify-between gap-2 rounded border border-line px-3 py-2">
          <dt className="text-muted">Monitors</dt>
          <dd className="tabular text-foreground">{connectedMonitors}</dd>
        </div>
        <div className="flex justify-between gap-2 rounded border border-line px-3 py-2">
          <dt className="text-muted">Open incidents</dt>
          <dd className="tabular text-foreground">{openIncidents}</dd>
        </div>
        <div className="flex justify-between gap-2 rounded border border-line px-3 py-2">
          <dt className="text-muted">Rollback records</dt>
          <dd className="tabular text-foreground">{operations.rollbacks.length}</dd>
        </div>
        <div className="flex justify-between gap-2 rounded border border-line px-3 py-2">
          <dt className="text-muted">Repair attempts</dt>
          <dd className="tabular text-foreground">{operations.repairs.length}</dd>
        </div>
      </dl>

      <p className="mt-3 text-sm text-faint">
        Autonomous release: <strong>blocked</strong> — {operations.releaseAuthority.blockers.join(", ")}.
      </p>
    </section>
  );
}
