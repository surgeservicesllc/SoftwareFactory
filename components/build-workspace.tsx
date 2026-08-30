"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GateDecision } from "@/components/graph/gate-decision";
import { Card, Notice, SectionTitle } from "@/components/ui";
import { SDLC_STAGES } from "@/lib/sdlc/lifecycle";

/**
 * Build: the factory's conversational front door.
 *
 * A person types what they want built and everything on this page afterwards
 * is the machinery that already exists, watched live: the launch goes through
 * `POST /api/graphs` exactly as the Workflows page launches a lifecycle, and
 * the watching reads `GET /api/graphs/runs` exactly as Agent Trail does.
 * Nothing here simulates progress — the transcript's factory entries are
 * state transitions the database reported, the progress line counts real
 * node states, and when the worker was not woken the page says so in the
 * server's own words rather than showing a spinner over nothing.
 *
 * The deep surfaces (per-stage pages, Agent Trail, Runs) stay the places for
 * detail; this page links into them. Hiding complexity must never mean
 * hiding state.
 */

type Project = {
  id: string;
  name: string;
  connectionStatus?: string;
};

type LaunchResult = {
  graphId: string;
  topology: string;
  nodeCount: number;
  edgeCount: number;
  maxParallelism: number;
  requiresOwnerApproval: boolean;
  workerWoken: boolean;
  note: string;
};

type RunNode = {
  node_key: string;
  state: string | null;
  executor: string | null;
  capability: string | null;
  lifecycle_stage: string | null;
  latency_ms: number | null;
  error_message: string | null;
  gate_id?: string | null;
  gate_kind: string | null;
  gate_state: string | null;
  gate_evidence_artifact_id?: string | null;
  provider: string | null;
  model: string | null;
};

type GraphRun = {
  graphRunId: string;
  graphId: string;
  goal: string;
  state: string;
  projectId: string | null;
  closureNote?: string | null;
  startedAt: string | null;
  completedAt: string | null;
  nodes: RunNode[];
  isLifecycle?: boolean;
  iteration?: number;
  maxIterations?: number;
};

type TranscriptEntry = {
  id: string;
  at: string;
  from: "you" | "factory";
  text: string;
  link?: { href: string; label: string };
};

const POLL_MS = 5_000;

function nodeDone(node: RunNode): boolean {
  return node.state === "COMPLETED" || node.state === "SKIPPED";
}

/** Stages in lifecycle order, restricted to what this run actually has. */
function stagesOf(nodes: readonly RunNode[]): string[] {
  const present = new Set(
    nodes.map((node) => node.lifecycle_stage).filter((stage): stage is string => stage !== null),
  );
  const known: readonly string[] = SDLC_STAGES;
  const ordered = known.filter((stage) => present.has(stage));
  // Stages the ordering does not know still render, at the end — a node the
  // engine recorded must never disappear from the page.
  for (const stage of present) {
    if (!known.includes(stage)) ordered.push(stage);
  }
  return ordered;
}

export function BuildWorkspace() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");

  const [prompt, setPrompt] = useState("");
  const [launching, setLaunching] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [launched, setLaunched] = useState<(LaunchResult & { projectId: string }) | null>(null);

  const [watchedRun, setWatchedRun] = useState<GraphRun | null>(null);
  const [activeRuns, setActiveRuns] = useState<GraphRun[]>([]);
  const [watchError, setWatchError] = useState<string | null>(null);

  const entrySeq = useRef(0);
  const lastReportedState = useRef<string | null>(null);

  const say = useCallback((from: TranscriptEntry["from"], text: string, link?: TranscriptEntry["link"]) => {
    entrySeq.current += 1;
    setTranscript((current) => [
      ...current,
      { id: `e${entrySeq.current}`, at: new Date().toISOString(), from, text, link },
    ]);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/projects", { headers: { accept: "application/json" } });
        const payload = (await response.json()) as {
          projects?: Project[];
          error?: { message?: string };
        };
        if (!active) return;
        if (!response.ok) {
          setProjectsError(payload.error?.message ?? "Projects could not be loaded.");
          return;
        }
        const list = payload.projects ?? [];
        setProjects(list);
        if (list.length === 1) setProjectId(list[0]!.id);
      } catch {
        if (active) setProjectsError("Projects could not be loaded.");
      }
    })();
    return () => { active = false; };
  }, []);

  /**
   * One poll serves both needs: the run this session launched, and the
   * workspace's running lifecycles (so returning to this page resumes
   * watching work started earlier — persistence is the database's, not this
   * tab's).
   */
  const refreshRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/graphs/runs", { headers: { accept: "application/json" } });
      if (!response.ok) {
        setWatchError("The live run feed could not be read.");
        return;
      }
      const payload = (await response.json()) as { runs?: GraphRun[] };
      const runs = payload.runs ?? [];
      setWatchError(null);
      setActiveRuns(
        runs.filter(
          (run) => run.isLifecycle === true && run.state !== "COMPLETED" && run.state !== "FAILED",
        ),
      );
      if (launched !== null) {
        const mine = runs.find((run) => run.graphId === launched.graphId) ?? null;
        setWatchedRun(mine);
        if (mine !== null && mine.state !== lastReportedState.current) {
          lastReportedState.current = mine.state;
          if (mine.state === "RUNNING") {
            say("factory", "Workers picked up the run — stages are executing now.");
          } else if (mine.state === "COMPLETED") {
            say(
              "factory",
              mine.closureNote
                ? `The run finished. ${mine.closureNote}`
                : "The run finished. Its evidence is on the run page.",
              { href: `/solutions/lifecycle/run/${mine.graphRunId}`, label: "Open the run" },
            );
          } else if (mine.state === "FAILED") {
            say(
              "factory",
              mine.closureNote
                ? `The run stopped before finishing. ${mine.closureNote}`
                : "The run stopped before finishing. The failed stage says why.",
              { href: `/solutions/lifecycle/run/${mine.graphRunId}`, label: "See what failed" },
            );
          }
        }
      }
    } catch {
      setWatchError("The live run feed could not be read.");
    }
  }, [launched, say]);

  useEffect(() => {
    // Same shape as the Agent Trail's poll: the first read on a zero timeout
    // so the effect body itself sets no state, then the live cadence.
    const kickoff = window.setTimeout(() => void refreshRuns(), 0);
    const timer = window.setInterval(() => void refreshRuns(), POLL_MS);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [refreshRuns]);

  const submit = useCallback(async () => {
    const goal = prompt.trim();
    if (goal.length === 0) return;
    if (projectId === "") {
      say("factory", "Pick a project first — a build needs a repository to land in.");
      return;
    }
    setLaunching(true);
    say("you", goal);
    try {
      const response = await fetch("/api/graphs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, templateKey: "full_lifecycle", goal }),
      });
      const body = (await response.json()) as
        | LaunchResult
        | { error?: { message?: string; details?: string[] } };
      if (!response.ok) {
        const failure = (body as { error?: { message?: string; details?: string[] } }).error;
        say(
          "factory",
          [failure?.message, ...(failure?.details ?? [])].filter(Boolean).join(" — ")
            || "The build could not be recorded.",
        );
        return;
      }
      const result = body as LaunchResult;
      setLaunched({ ...result, projectId });
      lastReportedState.current = null;
      setPrompt("");
      say(
        "factory",
        `Plan recorded: ${result.nodeCount} steps across the full lifecycle`
          + ` (up to ${result.maxParallelism} in parallel).`
          + (result.requiresOwnerApproval
            ? " This run waits for owner approval before workers execute."
            : ""),
      );
      // The server's own account of the worker wake — shown verbatim, so a
      // planned-but-unclaimed run is never dressed up as a running one.
      if (result.note) say("factory", result.note);
    } catch {
      say("factory", "The request did not reach the server. Check the connection and try again.");
    } finally {
      setLaunching(false);
    }
  }, [prompt, projectId, say]);

  const progress = useMemo(() => {
    if (watchedRun === null) return null;
    const total = watchedRun.nodes.length;
    const done = watchedRun.nodes.filter(nodeDone).length;
    const running = watchedRun.nodes.filter((node) => node.state === "RUNNING").length;
    const failed = watchedRun.nodes.filter((node) => node.state === "FAILED").length;
    return { total, done, running, failed };
  }, [watchedRun]);

  // OPEN is the state a gate holds while it waits for a decision — the same
  // reading every other gate surface uses.
  const waitingGates = useMemo(
    () =>
      watchedRun === null
        ? []
        : watchedRun.nodes.filter(
            (node) => node.gate_kind !== null && node.gate_state === "OPEN",
          ),
    [watchedRun],
  );

  const connectedProjects = (projects ?? []).filter(
    (project) => project.connectionStatus === undefined || project.connectionStatus === "connected",
  );

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle
          title="Build something"
          description="Describe what you want. The factory plans it, runs its stages with the bots you connected, and shows every step here — nothing runs invisibly."
        />
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
        >
          <label className="block">
            <span className="sr-only">What to build</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Build me…"
              maxLength={4000}
              rows={3}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">
              <span className="mr-2 text-xs text-[var(--muted)]">Project</span>
              {projectsError !== null ? (
                <span className="text-xs text-[var(--danger)]">{projectsError}</span>
              ) : projects === null ? (
                <span className="text-xs text-[var(--muted)]">Loading projects…</span>
              ) : connectedProjects.length === 0 ? (
                <Link href="/solutions/projects" className="text-xs underline underline-offset-2">
                  Create a project first — a build needs a repository to land in.
                </Link>
              ) : (
                <select
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                >
                  <option value="">Choose…</option>
                  {connectedProjects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              )}
            </label>
            <button
              type="submit"
              disabled={launching || prompt.trim().length === 0}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-60"
            >
              {launching ? "Starting…" : "Build it"}
            </button>
            <details className="text-xs text-[var(--muted)]">
              <summary className="cursor-pointer">Advanced</summary>
              <p className="mt-1 max-w-md">
                Runs the <code>full_lifecycle</code> workflow: requirement → discovery →
                evaluation → decision → architecture → implementation → review → test →
                deployment gate → monitoring. Other workflows live on{" "}
                <Link href="/solutions/workflows" className="underline underline-offset-2">Workflows</Link>.
              </p>
            </details>
          </div>
        </form>
      </Card>

      {transcript.length > 0 ? (
        <Card>
          <div data-testid="build-transcript">
            <SectionTitle title="Conversation" description="You and the factory. Factory entries are recorded state, not commentary." />
            <ul className="mt-3 space-y-2">
              {transcript.map((entry) => (
                <li key={entry.id} className="flex gap-2 text-sm">
                  <span className="shrink-0 font-medium text-[var(--muted)]">
                    {entry.from === "you" ? "You" : "Factory"}
                  </span>
                  <span className="min-w-0">
                    {entry.text}
                    {entry.link ? (
                      <>
                        {" "}
                        <Link href={entry.link.href} className="underline underline-offset-2">
                          {entry.link.label}
                        </Link>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}

      {watchError !== null && (launched !== null || activeRuns.length > 0) ? (
        <Notice tone="warning">{watchError}</Notice>
      ) : null}

      {launched !== null && watchedRun === null ? (
        <Card>
          <p className="text-sm text-[var(--muted)]" data-testid="build-awaiting-run">
            The plan is recorded ({launched.nodeCount} steps). Waiting for its run to appear in
            the live feed{launched.requiresOwnerApproval ? " — it needs owner approval first" : ""}.
          </p>
        </Card>
      ) : null}

      {watchedRun !== null && progress !== null ? (
        <Card>
          <div data-testid="build-live-run">
            <SectionTitle
              title={`Your build — ${watchedRun.state.toLowerCase()}`}
              description={`${progress.done} of ${progress.total} steps complete` +
                (progress.running > 0 ? `, ${progress.running} running now` : "") +
                (progress.failed > 0 ? `, ${progress.failed} failed` : "") +
                ((watchedRun.maxIterations ?? 1) > 1
                  ? ` · iteration ${watchedRun.iteration ?? 1} of ${watchedRun.maxIterations}`
                  : "")}
            />
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-label="Steps complete"
              className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
            >
              <div
                className="h-full rounded-full bg-[var(--accent)]"
                style={{ width: progress.total === 0 ? "0%" : `${(progress.done / progress.total) * 100}%` }}
              />
            </div>

            {waitingGates.length > 0 ? (
              <div className="mt-3 space-y-2" data-testid="build-gates">
                <Notice tone="warning">
                  {waitingGates.length === 1
                    ? "One step is waiting for your approval."
                    : `${waitingGates.length} steps are waiting for your approval.`}{" "}
                  <Link
                    href={`/solutions/lifecycle/run/${watchedRun.graphRunId}`}
                    className="underline underline-offset-2"
                  >
                    See the full evidence
                  </Link>
                </Notice>
                {/* The decision offered where the gate is — the same shared
                    control, wording, and route every other gate surface uses;
                    a decision re-reads the live feed rather than assuming. */}
                {waitingGates.map((node) => (
                  <div key={node.node_key} className="rounded-md border border-[var(--border)] p-2 text-sm">
                    <span className="font-medium">
                      {(node.lifecycle_stage ?? node.node_key).toLowerCase()}
                    </span>
                    <GateDecision node={node} onDecided={() => void refreshRuns()} />
                  </div>
                ))}
              </div>
            ) : null}

            <ul className="mt-4 space-y-1.5">
              {stagesOf(watchedRun.nodes).map((stage) => {
                const stageNodes = watchedRun.nodes.filter((node) => node.lifecycle_stage === stage);
                const done = stageNodes.filter(nodeDone).length;
                const running = stageNodes.some((node) => node.state === "RUNNING");
                const failed = stageNodes.find((node) => node.error_message !== null) ?? null;
                return (
                  <li key={stage} className="flex flex-wrap items-center gap-2 text-sm">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        failed !== null
                          ? "bg-[var(--danger)]"
                          : done === stageNodes.length
                            ? "bg-[var(--accent)]"
                            : running
                              ? "animate-pulse bg-[var(--accent)]"
                              : "bg-[var(--border)]"
                      }`}
                      aria-hidden
                    />
                    <span className="font-medium">{stage.toLowerCase()}</span>
                    <span className="text-xs text-[var(--muted)]">
                      {done}/{stageNodes.length}
                      {running ? " · running" : ""}
                    </span>
                    {failed !== null ? (
                      <span className="text-xs text-[var(--danger)]">{failed.error_message}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <p className="mt-4 flex flex-wrap gap-3 text-sm">
              <Link href={`/solutions/lifecycle/run/${watchedRun.graphRunId}`} className="underline underline-offset-2">
                Full run detail
              </Link>
              <Link href="/solutions/trail" className="underline underline-offset-2">
                Agent Trail
              </Link>
              <Link href="/solutions/factory/requirement" className="underline underline-offset-2">
                Step-by-step view
              </Link>
            </p>
          </div>
        </Card>
      ) : null}

      {activeRuns.filter((run) => run.graphId !== launched?.graphId).length > 0 ? (
        <Card>
          <div data-testid="build-active-runs">
            <SectionTitle
              title="Already building"
              description="Lifecycle runs in this workspace that have not finished. Watching resumes from here after you leave."
            />
            <ul className="mt-3 space-y-2">
              {activeRuns
                .filter((run) => run.graphId !== launched?.graphId)
                .slice(0, 8)
                .map((run) => {
                  const done = run.nodes.filter(nodeDone).length;
                  return (
                    <li key={run.graphRunId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 break-words">{run.goal}</span>
                      <span className="flex shrink-0 items-center gap-3 text-xs text-[var(--muted)]">
                        {run.state.toLowerCase()} · {done}/{run.nodes.length} steps
                        <Link
                          href={`/solutions/lifecycle/run/${run.graphRunId}`}
                          className="underline underline-offset-2"
                        >
                          Watch
                        </Link>
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
