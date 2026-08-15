"use client";

import { Rocket } from "lucide-react";
import { useEffect, useState } from "react";

import { Card, EmptyState, SectionTitle, StatusBadge } from "@/components/ui";

/**
 * Record a graph against a project.
 *
 * This is the control that was missing. Everything else in the Workflows console
 * is compiled and pure — genuinely what would happen, but never written down.
 * Until this existed, `create_graph_from_plan` had no caller anywhere in the
 * application and no graph could reach the database at all.
 *
 * ## It records a plan; it does not start work
 *
 * The wording throughout is deliberate. `POST /api/graphs` creates the graph,
 * its nodes and its edges, and stops. No node is dispatched, because no executor
 * is wired to the graph runner — so a button labelled "Run" would be a lie, and
 * a resulting state of "started" would read as work in progress to anyone who
 * did not know better. It says **Recorded**, and it says why nothing is running.
 */

type Project = { readonly id: string; readonly name: string };

type LaunchResult = {
  readonly graphId: string;
  readonly topology: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly maxParallelism: number;
  readonly requiresOwnerApproval: boolean;
  readonly note: string;
};

export function GraphLaunchControl({
  templateKey,
  templateName,
}: {
  readonly templateKey: string;
  readonly templateName: string;
}) {
  const [projects, setProjects] = useState<readonly Project[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  // Tagged with the template they describe, so switching template hides them
  // by derivation rather than by an effect that resets state on every change --
  // which cascades a render and, worse, briefly shows the previous template's
  // result as if it belonged to the new one.
  const [result, setResult] = useState<{ key: string; value: LaunchResult } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  const shownResult = result?.key === templateKey ? result.value : null;
  const shownError = error?.key === templateKey ? error.message : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        if (!response.ok) throw new Error("projects_unavailable");
        const body = (await response.json()) as { projects?: Project[] };
        if (!cancelled) setProjects(body.projects ?? []);
      } catch {
        // An empty list and an unreadable one are different states, and a
        // selector that silently shows nothing conflates them.
        if (!cancelled) setProjects(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function launch() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/graphs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, templateKey }),
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
      setResult({ key: templateKey, value: body as LaunchResult });
    } catch {
      setError({ key: templateKey, message: "The request did not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionTitle
        title="Record this graph"
        description="Writes the compiled plan — its nodes, its edges and its budget — against a project. Nothing is dispatched: no executor is connected to the graph runner yet."
      />

      {projects === null ? (
        <div className="mt-4">
          <EmptyState
            title="Projects could not be read"
            description="The project list is unavailable, so a graph cannot be attached to one. This is a failed read, not an empty account."
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
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Project</span>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="rounded-lg border border-line-strong bg-surface-raised px-3 py-2 text-sm"
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
            disabled={busy || projectId === ""}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-surface)] px-3 py-2 text-sm text-[var(--accent-text)] transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Rocket className="h-4 w-4" aria-hidden />
            {busy ? "Recording…" : `Record ${templateName}`}
          </button>
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
