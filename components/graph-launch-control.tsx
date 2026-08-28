"use client";

import { Rocket } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Card, EmptyState, SectionTitle, StatusBadge } from "@/components/ui";

/**
 * Record a graph against a project.
 *
 * This is the control that was missing. Everything else in the Workflows console
 * is compiled and pure — genuinely what would happen, but never written down.
 * Until this existed, `create_graph_from_plan` had no caller anywhere in the
 * application and no graph could reach the database at all.
 *
 * ## It records a plan and wakes the worker; the server's sentence is the truth
 *
 * `POST /api/graphs` creates the graph, its nodes and its edges, then wakes the
 * graph executor worker best-effort through the project's GitHub binding. The
 * wake can fail without failing the launch, so this control never states on its
 * own authority that anything is running: the badge says **Recorded** — which is
 * always true — and the server's `note` sentence says whether the worker was
 * woken or the graph stays planned behind the global worker gate. Run evidence
 * itself lives on the Pipelines page's runs panel, not here.
 */

type Project = { readonly id: string; readonly name: string };

const MAX_GOAL_LENGTH = 4_000;

type LaunchResult = {
  readonly graphId: string;
  readonly topology: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly maxParallelism: number;
  readonly requiresOwnerApproval: boolean;
  readonly workerWoken: boolean;
  readonly note: string;
};

export type LaunchedGraph = LaunchResult & {
  /** The exact project selected for this launch, retained client-side. */
  readonly projectId: string;
};

export function GraphLaunchControl({
  templateKey,
  templateName,
  onLaunched,
}: {
  readonly templateKey: string;
  readonly templateName: string;
  /** Called only after the graph has been durably recorded. */
  readonly onLaunched?: (graph: LaunchedGraph) => void;
}) {
  const goalId = useId();
  const goalHelpId = `${goalId}-help`;
  const [projects, setProjects] = useState<readonly Project[] | null>(null);
  // The server's own sentence when the project read fails. Discarding it left
  // "Projects could not be read" undiagnosable from the page itself.
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  // Tagged with the template they describe, so switching template hides them
  // by derivation rather than by an effect that resets state on every change --
  // which cascades a render and, worse, briefly shows the previous template's
  // result as if it belonged to the new one.
  const [result, setResult] = useState<{ key: string; value: LaunchResult } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  const shownResult = result?.key === templateKey ? result.value : null;
  const shownError = error?.key === templateKey ? error.message : null;
  const normalizedGoal = goal.trim();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as {
          projects?: Project[];
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            body.error?.message ?? `The project list answered HTTP ${response.status}.`,
          );
        }
        if (!cancelled) {
          setProjects(body.projects ?? []);
          setProjectsError(null);
        }
      } catch (readError) {
        // An empty list and an unreadable one are different states, and a
        // selector that silently shows nothing conflates them.
        if (!cancelled) {
          setProjects(null);
          setProjectsError(
            readError instanceof Error && readError.message
              ? readError.message
              : "The project list could not be reached.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function launch() {
    let launchedGraph: LaunchedGraph | null = null;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/graphs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, templateKey, goal: normalizedGoal }),
      });
      const body = (await response.json()) as
        | LaunchResult
        | { error?: { message?: string; details?: string[] } };

      if (!response.ok) {
        const failure = (body as { error?: { message?: string; details?: string[] } }).error;
        // The server's own reason, not a generic one. A refusal that says
        // "something went wrong" wastes the work the boundary did to explain.
        setError({
          key: templateKey,
          message: [failure?.message, ...(failure?.details ?? [])].filter(Boolean).join(" — ")
            || "The graph could not be recorded.",
        });
        return;
      }
      const received = body as LaunchResult;
      const launched: LaunchResult = {
        ...received,
        // The server must positively attest to a wake. An absent or malformed
        // field remains fail-closed even if an older response shape reaches us.
        workerWoken: received.workerWoken === true,
        note: received.note
          ?? "The graph is recorded. No worker wake was confirmed.",
      };
      setResult({ key: templateKey, value: launched });
      launchedGraph = { ...launched, projectId };
    } catch {
      setError({ key: templateKey, message: "The request did not reach the server." });
    } finally {
      setBusy(false);
    }
    // A local navigation callback must not be inside the request catch: the
    // graph is already durable, and a consumer exception cannot truthfully
    // turn that success into "the request did not reach the server."
    if (launchedGraph) onLaunched?.(launchedGraph);
  }

  return (
    <Card>
      <SectionTitle
        title="Launch this graph"
        description="Writes the compiled plan — its nodes, its edges and its budget — against a project, then wakes the executor worker to claim it. The result below states whether the wake happened; the run itself appears on the Pipelines page."
      />

      {projects === null ? (
        <div className="mt-4">
          <EmptyState
            title="Projects could not be read"
            description={
              "The project list is unavailable, so a graph cannot be attached to one. "
              + "This is a failed read, not an empty account. "
              + `The server said: ${projectsError ?? "nothing — the request never completed."}`
            }
          />
        </div>
      ) : projects.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No projects yet"
            description="A graph is recorded against a project. Create one first, then return here."
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          <div className="flex min-w-0 flex-col gap-1 text-sm">
            <label htmlFor={goalId} className="text-muted">Goal</label>
            <textarea
              id={goalId}
              aria-describedby={goalHelpId}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              maxLength={MAX_GOAL_LENGTH}
              rows={4}
              className="input min-h-28 resize-y"
              placeholder={`Describe what ${templateName} should accomplish.`}
            />
            <span id={goalHelpId} className="text-xs text-faint">
              This exact goal is recorded on the graph and supplied to its nodes. {goal.length}/{MAX_GOAL_LENGTH}
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Project</span>
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                // The `.input` token rather than a hand-rolled copy of it. The
                // copy missed the token's `min-width: 0`, so a project named
                // longer than a phone is wide sized this control to its widest
                // option and carried the whole panel off the screen.
                className="input"
              >
                <option value="">Select a project…</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => void launch()}
              disabled={busy || projectId === "" || normalizedGoal === ""}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-surface)] px-3 py-2 text-sm text-[var(--accent-text)] transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Rocket className="h-4 w-4" aria-hidden />
              {busy ? "Launching…" : `Launch ${templateName}`}
            </button>
          </div>
        </div>
      )}

      {shownError ? (
        <p role="alert" className="mt-4 text-sm text-[var(--danger-text)]">
          {shownError}
        </p>
      ) : null}

      {shownResult ? (
        <div className="mt-4 space-y-2 rounded-lg border border-line-strong bg-surface-raised p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="safe">Recorded</StatusBadge>
            <span className="text-muted">
              {shownResult.topology} · {shownResult.nodeCount} nodes · {shownResult.edgeCount} edges · up to{" "}
              {shownResult.maxParallelism} in parallel
            </span>
          </div>
          <p className="text-faint">Graph {shownResult.graphId}</p>
          {shownResult.requiresOwnerApproval ? (
            <p className="text-muted">This plan is classified as requiring owner approval before it may run.</p>
          ) : null}
          {/* The server's sentence, not a paraphrase: it is the one that
              explains why nothing is executing. */}
          <p className="text-muted">{shownResult.note}</p>
        </div>
      ) : null}
    </Card>
  );
}
