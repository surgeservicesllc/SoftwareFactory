"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/ui";

/**
 * Including logical agents in a project's AI Factory.
 *
 * The toggle writes to /api/project-agents and the AI Factory journey reads
 * the same records — which is what makes "Include in AI Factory" a fact that
 * survives closing an overlay, a refresh, and a move to another surface.
 * Selection is routing intent recorded by a person: nothing here dispatches
 * a bot or spends a token, and the panel says so.
 *
 * Used in two places: standalone on /solutions/agents (with its own project
 * picker) and inside the AI Factory's Select Agents step (the journey hands
 * in its project). Same component, same records, so the two surfaces cannot
 * disagree.
 */

export type ProjectAgentSelection = {
  id: string;
  projectId: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  selectedAt: string;
};

type RosterAgent = {
  id: string;
  name: string;
  role: string;
  description: string | null;
  project?: { id: string; name: string } | null;
};

type PanelState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
    kind: "ready";
    agents: RosterAgent[];
    selections: ProjectAgentSelection[];
    available: boolean;
    canManage: boolean;
  };

export function ProjectAgentSelector({
  projectContext,
  onSelectionChanged,
}: {
  /**
   * The project selections apply to. `undefined` = standalone: the panel
   * fetches the project list and offers a picker. `null` = the caller has a
   * project concept but no project yet (a factory being started); controls
   * stay disabled rather than falling back to some other project.
   */
  projectContext?: { id: string; name: string } | null;
  onSelectionChanged?: () => void;
}) {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [chosenProjectId, setChosenProjectId] = useState("");
  const [pendingAgentId, setPendingAgentId] = useState("");
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    try {
      const requests: Array<Promise<Response>> = [
        fetch("/api/agents", { cache: "no-store" }),
        fetch("/api/project-agents", { cache: "no-store" }),
      ];
      if (projectContext === undefined) {
        requests.push(fetch("/api/projects", { cache: "no-store" }));
      }
      const responses = await Promise.all(requests);
      if (responses.some((response) => !response.ok)) {
        setState({ kind: "error", message: "Agent selection could not be loaded." });
        return;
      }
      const agentsBody = (await responses[0]!.json()) as { agents?: RosterAgent[] };
      const selectionsBody = (await responses[1]!.json()) as {
        available?: boolean;
        canManage?: boolean;
        selections?: ProjectAgentSelection[];
      };
      if (projectContext === undefined) {
        const projectsBody = (await responses[2]!.json()) as {
          projects?: Array<{ id: string; name: string }>;
        };
        setProjects(projectsBody.projects ?? []);
      }
      setState({
        kind: "ready",
        agents: agentsBody.agents ?? [],
        selections: selectionsBody.selections ?? [],
        available: selectionsBody.available ?? false,
        canManage: selectionsBody.canManage ?? false,
      });
    } catch {
      setState({ kind: "error", message: "Agent selection could not be loaded." });
    }
  }, [projectContext]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  const activeProject = projectContext !== undefined
    ? projectContext
    : projects.find((project) => project.id === chosenProjectId) ?? projects[0] ?? null;

  async function toggle(agent: RosterAgent, selected: boolean) {
    if (!activeProject) return;
    setPendingAgentId(agent.id);
    setProblem("");
    try {
      const response = selected
        ? await fetch(
          `/api/project-agents?projectId=${encodeURIComponent(activeProject.id)}&agentId=${encodeURIComponent(agent.id)}`,
          { method: "DELETE" },
        )
        : await fetch("/api/project-agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: activeProject.id, agentId: agent.id }),
        });
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok) {
        setProblem(body.error?.message ?? "The selection could not be saved.");
        return;
      }
      await load();
      onSelectionChanged?.();
    } catch {
      setProblem("The selection could not be saved.");
    } finally {
      setPendingAgentId("");
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading agents and factory selections…
      </div>
    );
  }
  if (state.kind === "error") {
    return <p role="alert" className="p-4 text-sm text-[var(--danger)]">{state.message}</p>;
  }

  const { agents, selections, available, canManage } = state;
  const scoped = activeProject
    ? selections.filter((selection) => selection.projectId === activeProject.id)
    : [];
  const selectedIds = new Set(scoped.map((selection) => selection.agentId));
  // Org-wide roster agents plus any bound to this exact project — an agent
  // bound elsewhere is not offered, matching what the database would refuse.
  const offerable = agents.filter(
    (agent) => !agent.project || (activeProject !== null && agent.project.id === activeProject.id),
  );

  return (
    <div className="space-y-3">
      {!available ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <StatusBadge tone="danger">Not Connected</StatusBadge>
          Agent selection is not available on this database yet — the project_agents
          migration has not been applied. Nothing can be recorded until it is.
        </p>
      ) : null}

      {projectContext === undefined ? (
        projects.length > 0 ? (
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-faint">
              Project these selections apply to
            </span>
            <select
              value={activeProject?.id ?? ""}
              onChange={(event) => setChosenProjectId(event.target.value)}
              className="h-10 w-full max-w-sm rounded-lg border border-line bg-surface px-3 text-sm text-foreground"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm text-muted">
            Create a project first — agents are included per project, and this
            workspace has none yet.
          </p>
        )
      ) : projectContext === null ? (
        <p className="text-sm text-muted">
          This factory has no project yet. Create the project first; agents are
          included per project.
        </p>
      ) : null}

      {problem ? <p role="alert" className="text-sm text-[var(--danger)]">{problem}</p> : null}

      {activeProject && available && !canManage ? (
        <p className="text-sm text-muted">
          Read-only for this workspace role. An owner or administrator can change
          which agents the factory includes.
        </p>
      ) : null}

      <ul className="divide-y divide-[var(--border)] rounded-lg border border-line">
        {offerable.map((agent) => {
          const selected = selectedIds.has(agent.id);
          const pending = pendingAgentId === agent.id;
          return (
            <li key={agent.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{agent.name}</span>
                <span className="block text-xs text-faint">{agent.role.replace(/_/g, " ")}</span>
              </span>
              <span className="flex items-center gap-2">
                {selected ? <StatusBadge tone="safe" dot={false}>Included</StatusBadge> : null}
                <button
                  type="button"
                  className={selected ? "btn btn-secondary btn-sm" : "btn btn-primary btn-sm"}
                  aria-pressed={selected}
                  disabled={!available || !canManage || !activeProject || pending}
                  onClick={() => void toggle(agent, selected)}
                >
                  {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  {selected ? "Remove from AI Factory" : "Include in AI Factory"}
                </button>
              </span>
            </li>
          );
        })}
        {offerable.length === 0 ? (
          <li className="p-3 text-sm text-muted">
            No agents are defined yet. Initialize the standard roster above, then
            include the roles this factory should use.
          </li>
        ) : null}
      </ul>

      <p className="text-xs text-faint">
        Selection is routing intent recorded for the project — it dispatches
        nothing and implies no provider connection.
      </p>
    </div>
  );
}
