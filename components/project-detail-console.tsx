"use client";

import { Loader2, Pencil, Save, Undo2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { PortfolioProject, PortfolioView } from "@/lib/portfolio/aggregate";
import { ProjectBots } from "@/components/project-bots";
import { Card, Notice, SectionTitle, StatusBadge } from "@/components/ui";

/**
 * One project, in the factory's terms — and the place it is operated from.
 *
 * Counts still come from the same RLS-scoped portfolio aggregate the portfolio
 * console reads, so the two surfaces cannot disagree about a number: same
 * source, same null-means-Unknown rule, same attention derivation.
 *
 * What changed is that this page now *does* things. Every control below lands
 * on an existing owner-gated RPC — `update_project_details`,
 * `set_project_engineering_priority`, `set_project_engineering_pause`,
 * `focus_portfolio_engineering`, `archive_project` — through routes that
 * already existed. Nothing here is a new mutation path; the page was simply
 * the one surface that could see a project and not act on it.
 *
 * Two words are used carefully, because they mean different things:
 *
 *   **Stop** pauses engineering. Nothing running is killed, no history moves,
 *   and resuming puts the project back exactly where it was.
 *
 *   **Cancel** archives the project. It is the delete that keeps every run,
 *   task, command and audit row — which is why it is reversible and why there
 *   is no hard delete offered anywhere.
 */

const SURFACES = [
  { href: "/solutions/files", label: "Files", note: "Repository files through the GitHub connection" },
  { href: "/solutions/backlog", label: "Backlog", note: "Tasks across the factory" },
  { href: "/solutions/runs", label: "Runs", note: "Durable worker runs" },
  { href: "/solutions/agents", label: "Agents", note: "Logical agent roster" },
  { href: "/solutions/reports", label: "Reports", note: "Operations reporting" },
  { href: "/solutions/activity", label: "Activity", note: "Immutable audit events" },
] as const;

const PRIORITY_LABELS: Readonly<Record<number, string>> = {
  0: "P0 · critical incident or security",
  1: "P1 · critical product or reliability",
  2: "P2 · normal feature work",
  3: "P3 · optimization and maintenance",
};

type ActionPhase = { phase: "idle" } | { phase: "working" } | { phase: "failed"; message: string };

function healthTone(health: PortfolioProject["health"]) {
  if (health === "healthy") return "safe" as const;
  if (health === "degraded") return "warning" as const;
  if (health === "unhealthy") return "danger" as const;
  return "neutral" as const;
}

function connectionTone(state: PortfolioProject["connectionHealth"]) {
  if (state === "connected") return "safe" as const;
  if (state === "degraded") return "warning" as const;
  if (state === "not_connected") return "danger" as const;
  return "neutral" as const;
}

/** Unknown is a word. A number is only shown when the factory established it. */
function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={value === null ? "mt-1 text-sm italic text-muted" : "mt-1 text-2xl font-semibold tabular-nums"}>
        {value === null ? "Unknown" : value}
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{value}</dd>
    </div>
  );
}

export function ProjectDetailConsole({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<PortfolioProject | null>(null);
  const [unavailable, setUnavailable] = useState<readonly string[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [identityState, setIdentityState] = useState<ActionPhase>({ phase: "idle" });

  const [controlState, setControlState] = useState<ActionPhase>({ phase: "idle" });
  const [notice, setNotice] = useState("");

  const [stopReason, setStopReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/portfolio", { cache: "no-store" });
    if (!response.ok) throw new Error("The portfolio could not be loaded.");
    const body = (await response.json()) as { portfolio: PortfolioView };
    const found = body.portfolio.projects.find((entry) => entry.id === projectId) ?? null;
    setProject(found);
    setUnavailable(body.portfolio.unavailable);
    // A project the RLS-scoped read did not return is indistinguishable from
    // one that does not exist, and saying "missing" for both is the honest
    // rendering: this surface must not reveal which.
    setState(found ? "ready" : "missing");
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    // Wrapped rather than called bare: the lint rule is right that a promise
    // rejecting in the same tick would set state synchronously inside the
    // effect and cascade a render.
    void (async () => {
      try {
        await load();
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function saveIdentity() {
    setIdentityState({ phase: "working" });
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draftName.trim(),
          ...(draftDescription.trim() ? { description: draftDescription.trim() } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? "The change was refused.");
      setIdentityState({ phase: "idle" });
      setEditing(false);
      setNotice("Project details saved.");
      await load();
    } catch (cause) {
      setIdentityState({
        message: cause instanceof Error ? cause.message : "The change was refused.",
        phase: "failed",
      });
    }
  }

  async function control(body: unknown, done: string) {
    setControlState({ phase: "working" });
    setNotice("");
    try {
      const response = await fetch("/api/portfolio/controls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } } | null;
      // A non-owner sees the database's refusal verbatim rather than a hidden
      // control implying the capability does not exist.
      if (!response.ok) throw new Error(payload?.error?.message ?? "The action was refused.");
      setControlState({ phase: "idle" });
      setNotice(done);
      setConfirmingCancel(false);
      setStopReason("");
      setCancelReason("");
      await load();
    } catch (cause) {
      setControlState({
        message: cause instanceof Error ? cause.message : "The action was refused.",
        phase: "failed",
      });
    }
  }

  if (state === "loading") {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading the project" />
      </div>
    );
  }
  if (state === "error") return <Notice tone="danger">The portfolio could not be loaded.</Notice>;
  if (state === "missing" || !project) {
    return (
      <Notice tone="warning">
        This project is not visible to your organization, or it does not exist.
      </Notice>
    );
  }

  const busy = controlState.phase === "working";
  const archived = project.status === "archived";

  return (
    <div className="flex flex-col gap-6">
      {notice ? <Notice tone="info">{notice}</Notice> : null}
      {controlState.phase === "failed" ? (
        <Notice tone="danger">{controlState.message}</Notice>
      ) : null}

      {/* Identity ---------------------------------------------------------- */}
      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="break-words text-xl font-semibold">{project.name}</h2>
              <p className="mt-1 break-words font-mono text-xs text-muted">
                {project.repository ?? "No repository bound"}
                {project.defaultBranch ? ` · ${project.defaultBranch}` : ""}
              </p>
              {project.description ? (
                <p className="mt-2 max-w-2xl break-words text-sm text-muted">{project.description}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <StatusBadge tone={archived ? "neutral" : "info"}>{project.status}</StatusBadge>
              <StatusBadge tone={healthTone(project.health)}>{`health ${project.health}`}</StatusBadge>
              <StatusBadge tone={connectionTone(project.connectionHealth)}>
                {project.connectionHealth.replace("_", " ")}
              </StatusBadge>
              {project.engineeringPaused ? (
                <StatusBadge tone="warning">engineering stopped</StatusBadge>
              ) : null}
              {project.strategicFocus ? <StatusBadge tone="info">focused</StatusBadge> : null}
            </div>
          </div>

          {project.ownerAttention ? (
            <Notice tone="warning">{`Needs attention: ${project.attentionReasons.join("; ")}.`}</Notice>
          ) : null}

          {project.engineeringPaused ? (
            <Notice tone="warning">
              {`Engineering is stopped: ${project.engineeringPauseReason ?? "no reason recorded"}. `}
              {"Work already running was not interrupted; nothing new will be scheduled until it resumes."}
            </Notice>
          ) : null}

          {archived ? (
            <Notice tone="warning">
              This project is cancelled. Its runs, tasks, commands and audit events are all still
              here — archiving is the delete that keeps them — and restoring it puts it back.
            </Notice>
          ) : null}

          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fact
              label="Priority"
              value={project.engineeringPriority === null
                ? "Unknown"
                : PRIORITY_LABELS[project.engineeringPriority] ?? `P${project.engineeringPriority}`}
            />
            <Fact
              label="Autonomy"
              value={project.autonomousMode
                ? `On, ceiling ${project.maximumAutonomousRisk}`
                : "Off"}
            />
            <Fact label="Production" value={project.productionUrl ?? "Not recorded"} />
            <Fact label="Strategic focus" value={project.strategicFocus ? "Yes" : "No"} />
          </dl>
        </div>
      </Card>

      {/* Work -------------------------------------------------------------- */}
      <section aria-labelledby="project-work">
        <SectionTitle title="Work in flight" />
        <div id="project-work" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Commands" value={project.openCommands} />
          <Metric label="Active runs" value={project.activeRuns} />
          <Metric label="Open tasks" value={project.openTasks} />
          <Metric label="Incidents" value={project.openIncidents} />
          <Metric label="Draft PRs" value={project.draftPullRequests} />
          <Metric label="Deploys active" value={project.activeDeployments} />
        </div>
        {unavailable.length > 0 ? (
          <p className="mt-2 text-xs text-muted">
            {`Counts reading Unknown could not be read from: ${unavailable.join(", ")}.`}
          </p>
        ) : null}
      </section>

      {/* Bots ---------------------------------------------------------------
          The project's own page is where someone goes to staff it, so the
          assign flow lives here as well as in the inspector — the same panel
          reading the same roster, not a second implementation. */}
      <section aria-labelledby="project-bots">
        <SectionTitle
          title="Bots"
          description="The bots assigned to this project, and what each one may do."
        />
        <Card>
          <div id="project-bots">
            <ProjectBots projectId={project.id} projectName={project.name} divided={false} />
          </div>
        </Card>
      </section>

      {/* Editable details --------------------------------------------------- */}
      <section aria-labelledby="project-details">
        <SectionTitle title="Details" />
        <Card>
          {editing ? (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Name</span>
                <input
                  type="text"
                  className="w-full min-w-0 rounded border border-line bg-surface px-3 py-2 text-sm"
                  maxLength={160}
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Description</span>
                <textarea
                  className="min-h-20 rounded border border-line bg-surface px-3 py-2 text-sm"
                  maxLength={2000}
                  placeholder="What this project is for."
                  value={draftDescription}
                  onChange={(event) => setDraftDescription(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={identityState.phase === "working" || draftName.trim().length === 0}
                  onClick={() => void saveIdentity()}
                >
                  {identityState.phase === "working"
                    ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    : <Save className="size-4" aria-hidden="true" />}
                  Save details
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setEditing(false); setIdentityState({ phase: "idle" }); }}
                >
                  Discard
                </button>
              </div>
              {identityState.phase === "failed" ? (
                <p className="text-sm text-[var(--danger)]" aria-live="polite">
                  {identityState.message}
                </p>
              ) : null}
              <p className="text-xs text-muted">
                The repository, branch and production URL are not edited here. They are the
                connection this project is bound to, and re-pointing a project at different ground
                is a connection operation rather than a rename.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Fact label="Name" value={project.name} />
                <Fact label="Description" value={project.description ?? "Not set"} />
              </dl>
              <div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setDraftName(project.name);
                    setDraftDescription(project.description ?? "");
                    setIdentityState({ phase: "idle" });
                    setEditing(true);
                  }}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  Edit details
                </button>
              </div>
            </div>
          )}
        </Card>
      </section>

      {/* Scheduling --------------------------------------------------------- */}
      <section aria-labelledby="project-scheduling">
        <SectionTitle title="Scheduling" />
        <Card>
          <div className="flex flex-col gap-4">
            <label className="flex max-w-md flex-col gap-1">
              <span className="text-xs text-muted">Engineering priority</span>
              <select
                className="w-full min-w-0 rounded border border-line bg-surface px-3 py-2 text-sm"
                disabled={busy}
                value={project.engineeringPriority ?? 2}
                onChange={(event) => void control(
                  {
                    action: "set_priority",
                    priority: Number(event.target.value),
                    projectId,
                    reason: "Changed from the project detail page.",
                  },
                  `Priority set to P${event.target.value}.`,
                )}
              >
                {[0, 1, 2, 3].map((value) => (
                  <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>
                ))}
              </select>
              <span className="text-xs text-muted">
                Priority orders this project against every other one. P0 is reserved for incidents
                and security; queued work is promoted a tier at a time while it waits, so nothing
                starves.
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => void control(
                  {
                    action: "focus",
                    projectIds: project.strategicFocus ? [] : [projectId],
                    reason: "Changed from the project detail page.",
                  },
                  project.strategicFocus ? "Focus cleared." : "Engineering focused on this project.",
                )}
              >
                {project.strategicFocus ? "Clear strategic focus" : "Focus engineering here"}
              </button>
              <span className="text-xs text-muted">
                Focus is worth one priority tier and wins ties. It cannot reach P0.
              </span>
            </div>
          </div>
        </Card>
      </section>

      {/* Stop / cancel ------------------------------------------------------- */}
      <section aria-labelledby="project-lifecycle">
        <SectionTitle title="Stop or cancel" />
        <Card>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">
                {project.engineeringPaused ? "Resume engineering" : "Stop engineering"}
              </h3>
              <p className="text-xs text-muted">
                Stopping holds back new work only. Anything already running finishes, the project
                stays connected and visible, and resuming puts it back exactly where it was.
              </p>
              {project.engineeringPaused ? (
                <div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={() => void control(
                      { action: "set_pause", paused: false, projectId },
                      "Engineering resumed.",
                    )}
                  >
                    <Undo2 className="size-4" aria-hidden="true" />
                    Resume engineering
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="flex flex-1 flex-col gap-1">
                    <span className="text-xs text-muted">Reason (required)</span>
                    <input
                      type="text"
                      className="w-full min-w-0 rounded border border-line bg-surface px-3 py-2 text-sm"
                      maxLength={500}
                      value={stopReason}
                      onChange={(event) => setStopReason(event.target.value)}
                      placeholder="Why work is being held back"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy || stopReason.trim().length === 0}
                    onClick={() => void control(
                      { action: "set_pause", paused: true, projectId, reason: stopReason.trim() },
                      "Engineering stopped.",
                    )}
                  >
                    Stop engineering
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-[var(--danger)]">
                {archived ? "Restore this project" : "Cancel this project"}
              </h3>
              <p className="text-xs text-muted">
                Cancelling archives the project: it leaves the active portfolio and stops being
                scheduled. Every run, task, command and audit event is kept — this is the delete
                that keeps them — and restoring brings it back.
              </p>
              {archived ? (
                <div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => void control(
                      { action: "unarchive", projectId },
                      "Project restored.",
                    )}
                  >
                    <Undo2 className="size-4" aria-hidden="true" />
                    Restore project
                  </button>
                </div>
              ) : confirmingCancel ? (
                <div className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted">Reason (required)</span>
                    <input
                      type="text"
                      className="w-full min-w-0 rounded border border-line bg-surface px-3 py-2 text-sm"
                      maxLength={500}
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                      placeholder="Why this project is being cancelled"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={busy || cancelReason.trim().length === 0}
                      onClick={() => void control(
                        { action: "archive", projectId, reason: cancelReason.trim() },
                        "Project cancelled. Its history is intact.",
                      )}
                    >
                      Cancel project
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setConfirmingCancel(false)}
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={busy}
                    onClick={() => setConfirmingCancel(true)}
                  >
                    Cancel project
                  </button>
                </div>
              )}
            </div>
          </div>
        </Card>
      </section>

      {/* Surfaces ------------------------------------------------------------ */}
      <section aria-labelledby="project-surfaces">
        <SectionTitle title="Work in the factory" />
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
