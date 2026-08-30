"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GateDecision } from "@/components/graph/gate-decision";
import { Card, Notice, SectionTitle } from "@/components/ui";
import {
  AUTONOMY_MODES,
  deriveAutonomyMode,
  type AutonomyControls,
} from "@/lib/factory/autonomy-mode";
import { composeLaunchProposal, composePlan, type LaunchProposal } from "@/lib/factory/chief-of-staff";
import { deriveReleaseEvidence } from "@/lib/factory/release-evidence";
import { specialistForNode } from "@/lib/factory/specialists";
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

type GraphVerification = {
  subject_node_key: string;
  lens: string;
  verdict: string;
  verifier_provider: string | null;
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
  verifications?: GraphVerification[];
  tokensUsed?: number | null;
  costMicros?: number | null;
  isLifecycle?: boolean;
  iteration?: number;
  maxIterations?: number;
};

type RunArtifact = {
  artifactId: string;
  nodeKey: string;
  kind: string;
  createdAt: string;
  /** The recorded observation itself — what the release panel derives from. */
  payload?: unknown;
};

type RunEvent = {
  eventId: string;
  eventType: string;
  detail: string | null;
  nodeKey: string | null;
  createdAt: string;
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
  const [proposal, setProposal] = useState<{ goal: string; composed: LaunchProposal } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [launched, setLaunched] = useState<(LaunchResult & { projectId: string }) | null>(null);

  const [watchedRun, setWatchedRun] = useState<GraphRun | null>(null);
  const [lifecycleRuns, setLifecycleRuns] = useState<GraphRun[]>([]);
  const [watchError, setWatchError] = useState<string | null>(null);
  /** Fetched when the person opens the Artifacts disclosure — not before. */
  const [artifacts, setArtifacts] = useState<RunArtifact[] | null>(null);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [events, setEvents] = useState<{ rows: RunEvent[]; truncated: boolean } | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [controls, setControls] = useState<(AutonomyControls & { updatedAt: string }) | null>(null);
  const [controlsError, setControlsError] = useState<string | null>(null);
  const [modeNotice, setModeNotice] = useState<string | null>(null);
  /** The watched graph's stored dependency edges, one fetch per graph. */
  const [planEdges, setPlanEdges] = useState<{ graphId: string; edges: { from: string; to: string }[] } | null>(null);

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
      setLifecycleRuns(runs.filter((run) => run.isLifecycle === true));
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

  const watchedGraphId = watchedRun?.graphId ?? null;
  useEffect(() => {
    if (watchedGraphId === null) return;
    let active = true;
    const kickoff = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/graphs/edges?graphId=${watchedGraphId}`, {
            headers: { accept: "application/json" },
          });
          if (!active || !response.ok) return;
          const payload = (await response.json()) as { edges?: { from: string; to: string }[] };
          if (active) setPlanEdges({ graphId: watchedGraphId, edges: payload.edges ?? [] });
        } catch {
          // The plan panel renders without layers; everything else stands.
        }
      })();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(kickoff);
    };
  }, [watchedGraphId]);

  /**
   * Submitting drafts the plan; nothing launches until it is approved. The
   * proposal is composed from the same template the launch route compiles,
   * so the approval covers the plan the factory will actually run.
   */
  const propose = useCallback(() => {
    const goal = prompt.trim();
    if (goal.length === 0) return;
    if (projectId === "") {
      say("factory", "Pick a project first — a build needs a repository to land in.");
      return;
    }
    const composed = composeLaunchProposal(goal);
    if (composed === null) {
      say("factory", "The full_lifecycle plan is unavailable in this build.");
      return;
    }
    say("you", goal);
    say(
      "factory",
      `Here is the plan for your approval: ${composed.plan.tasks.length} steps, up to `
        + `${composed.plan.maxParallelism} in parallel, ${composed.plan.gatedTasks.length} human `
        + "gates inside the run. Nothing launches until you approve it.",
    );
    setProposal({ goal, composed });
  }, [prompt, projectId, say]);

  const launch = useCallback(async () => {
    if (proposal === null) return;
    const goal = proposal.goal;
    setLaunching(true);
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
      setProposal(null);
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
  }, [proposal, projectId, say]);

  const progress = useMemo(() => {
    if (watchedRun === null) return null;
    const total = watchedRun.nodes.length;
    const done = watchedRun.nodes.filter(nodeDone).length;
    const running = watchedRun.nodes.filter((node) => node.state === "RUNNING").length;
    const failed = watchedRun.nodes.filter((node) => node.state === "FAILED").length;
    return { total, done, running, failed };
  }, [watchedRun]);

  const plan = useMemo(() => {
    if (watchedRun === null) return null;
    return composePlan({
      goal: watchedRun.goal,
      nodes: watchedRun.nodes,
      edges: planEdges?.graphId === watchedRun.graphId ? planEdges.edges : [],
    });
  }, [watchedRun, planEdges]);

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

  const activeRuns = lifecycleRuns.filter(
    (run) => run.state !== "COMPLETED" && run.state !== "FAILED",
  );
  const finishedRuns = lifecycleRuns.filter(
    (run) => run.state === "COMPLETED" || run.state === "FAILED",
  );

  const loadArtifacts = useCallback(async (graphRunId: string) => {
    setArtifactsError(null);
    try {
      const response = await fetch(`/api/graphs/runs/${graphRunId}/artifacts`, {
        headers: { accept: "application/json" },
      });
      const payload = (await response.json()) as {
        artifacts?: RunArtifact[];
        error?: { message?: string };
      };
      if (!response.ok) {
        setArtifactsError(payload.error?.message ?? "The run's artifacts could not be loaded.");
        return;
      }
      setArtifacts(payload.artifacts ?? []);
    } catch {
      setArtifactsError("The run's artifacts could not be loaded.");
    }
  }, []);

  const loadEvents = useCallback(async (graphRunId: string) => {
    setEventsError(null);
    try {
      const response = await fetch(`/api/graphs/runs/${graphRunId}/events`, {
        headers: { accept: "application/json" },
      });
      const payload = (await response.json()) as {
        events?: RunEvent[];
        truncated?: boolean;
        error?: { message?: string };
      };
      if (!response.ok) {
        setEventsError(payload.error?.message ?? "The run's activity log could not be loaded.");
        return;
      }
      setEvents({ rows: payload.events ?? [], truncated: payload.truncated === true });
    } catch {
      setEventsError("The run's activity log could not be loaded.");
    }
  }, []);

  // The selected project's real autonomy controls — the mode panel derives
  // from these records and never invents a state the database does not hold.
  useEffect(() => {
    let active = true;
    const kickoff = window.setTimeout(() => {
      if (projectId === "") {
        setControls(null);
        setModeNotice(null);
        return;
      }
      void (async () => {
        setControlsError(null);
        try {
          const response = await fetch(`/api/projects/${projectId}/controls`, {
            headers: { accept: "application/json" },
          });
          const payload = (await response.json()) as {
            controls?: AutonomyControls & { updatedAt: string };
            error?: { message?: string };
          };
          if (!active) return;
          if (!response.ok || !payload.controls) {
            setControlsError(payload.error?.message ?? "The project's autonomy controls could not be loaded.");
            return;
          }
          setControls(payload.controls);
        } catch {
          if (active) setControlsError("The project's autonomy controls could not be loaded.");
        }
      })();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(kickoff);
    };
  }, [projectId]);

  /**
   * A mode selection is a real request to the real controls route. In this
   * phase the route and the database fence refuse anything but Ask Me — and
   * that refusal, shown verbatim, is the honest answer: enabling wider
   * autonomy is a RED policy change an owner authorizes elsewhere, never a
   * toggle this panel can flip.
   */
  const requestMode = useCallback(async (modeKey: string) => {
    const definition = AUTONOMY_MODES.find((mode) => mode.key === modeKey);
    if (!definition || controls === null || projectId === "") return;
    setModeNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/controls`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          autonomousMode: definition.patch.autonomousMode,
          maximumAutonomousRisk: definition.patch.maximumAutonomousRisk,
          expectedUpdatedAt: controls.updatedAt,
        }),
      });
      const payload = (await response.json()) as {
        controls?: AutonomyControls & { updatedAt: string };
        error?: { message?: string };
      };
      if (!response.ok || !payload.controls) {
        setModeNotice(payload.error?.message ?? "The controls route refused the change.");
        return;
      }
      setControls(payload.controls);
      setModeNotice(`Autonomy is now ${definition.name}.`);
    } catch {
      setModeNotice("The mode request did not reach the server.");
    }
  }, [controls, projectId]);

  /**
   * Stop = withdrawal: the database marks the graph so no future claim
   * selects it. What comes back — the withdrawal note or the RUNNING
   * refusal — is shown in the server's words, never paraphrased into a
   * success the system did not deliver.
   */
  const withdraw = useCallback(async (graphId: string) => {
    setStopping(graphId);
    try {
      const response = await fetch(`/api/graphs/${graphId}/withdraw`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as {
        note?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        say("factory", payload.error?.message ?? "The graph could not be withdrawn.");
        return;
      }
      say("factory", payload.note ?? "The graph is withdrawn.");
      if (launched?.graphId === graphId) setLaunched(null);
      void refreshRuns();
    } catch {
      say("factory", "The stop request did not reach the server.");
    } finally {
      setStopping(null);
    }
  }, [launched, refreshRuns, say]);

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle
          title="Build something"
          description="Describe what you want. The Chief of Staff drafts the plan for your approval, then the factory runs its stages with the bots you connected and shows every step here — nothing runs invisibly, nothing launches unapproved."
        />
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => { event.preventDefault(); propose(); }}
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
          <div className="flex flex-wrap items-end gap-3">
            {/* min-w-0 + a shrinkable select: a long project name must
                truncate inside a phone's width, never widen the page. */}
            <label className="min-w-0 grow basis-48 text-sm sm:max-w-xs">
              <span className="mb-1 block text-xs text-[var(--muted)]">Project</span>
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
                  className="w-full max-w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
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
            {projectId !== "" ? (
              <details className="min-w-0 basis-full text-xs text-[var(--muted)]" data-testid="build-autonomy">
                <summary className="cursor-pointer">
                  Autonomy — {controls !== null
                    ? AUTONOMY_MODES.find((mode) => mode.key === deriveAutonomyMode(controls))?.name
                    : "loading"}
                </summary>
                {controlsError !== null ? (
                  <p className="mt-1 text-[var(--danger)]">{controlsError}</p>
                ) : controls !== null ? (
                  <div className="mt-1 max-w-xl space-y-1">
                    {AUTONOMY_MODES.map((mode) => {
                      const active = deriveAutonomyMode(controls) === mode.key;
                      return (
                        <p key={mode.key} className="break-words">
                          <button
                            type="button"
                            onClick={() => void requestMode(mode.key)}
                            disabled={active}
                            className="rounded border border-[var(--border)] px-1.5 py-0.5 disabled:opacity-100 disabled:font-medium"
                          >
                            {mode.name}{active ? " — active" : ""}
                          </button>
                          {" "}{mode.promise} {mode.invariant}
                        </p>
                      );
                    })}
                    {modeNotice !== null ? <p className="break-words">{modeNotice}</p> : null}
                    <p>
                      Whatever the mode: in-run human gates, merges and deployments stay
                      owner-approved, and the database fence has the last word — a selection here
                      is a real request, and its refusal is shown in the server&apos;s own words.
                    </p>
                  </div>
                ) : (
                  <p className="mt-1">Loading the project&apos;s real controls…</p>
                )}
              </details>
            ) : null}
            <details className="min-w-0 basis-full text-xs text-[var(--muted)]">
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

      {proposal !== null && launched === null ? (
        <Card>
          <div data-testid="build-proposal">
            <SectionTitle
              title="Plan — for your approval"
              description={`Composed by the Chief of Staff from the ${proposal.composed.templateName} template — the identical nodes, gates and dependencies the factory compiles at launch. Nothing has launched yet.`}
            />
            <p className="mt-3 text-sm">
              <span className="text-xs text-[var(--muted)]">Your request, verbatim: </span>
              <span className="break-words">{proposal.composed.plan.requirements}</span>
            </p>
            <ol className="mt-2 space-y-1 text-sm">
              {proposal.composed.plan.layers.map((layer, index) => (
                <li key={`proposal-layer-${index}`} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs text-[var(--muted)]">
                    {index + 1}.{layer.length > 1 ? ` (${layer.length} in parallel)` : ""}
                  </span>
                  <span className="min-w-0 break-words">
                    {layer.map((key) => {
                      const task = proposal.composed.plan.tasks.find((entry) => entry.key === key);
                      return `${key}${task?.specialist ? ` — ${task.specialist.name}` : ""}${task?.gated ? " ⛩ gate" : ""}`;
                    }).join(" · ")}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Up to {proposal.composed.plan.maxParallelism} steps run in parallel. The first two
              steps write checkable acceptance criteria and requirements as recorded artifacts,
              and {proposal.composed.plan.gatedTasks.length} steps
              ({proposal.composed.plan.gatedTasks.join(", ")}) wait for your decision inside the
              run — approving the launch never approves those.
            </p>
            <details className="mt-2 text-xs text-[var(--muted)]">
              <summary className="cursor-pointer">What each step does</summary>
              <ul className="mt-1 space-y-1">
                {proposal.composed.plan.tasks.map((task) => (
                  <li key={`proposal-job-${task.key}`} className="break-words">
                    <span className="font-medium text-[var(--foreground)]">{task.key}</span>
                    {" — "}{proposal.composed.jobs.get(task.key) ?? ""}
                  </li>
                ))}
              </ul>
            </details>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void launch()}
                disabled={launching}
                className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-60"
              >
                {launching ? "Launching…" : "Approve & launch"}
              </button>
              <button
                type="button"
                onClick={() => setProposal(null)}
                disabled={launching}
                className="rounded-md border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-60"
              >
                Edit the request
              </button>
            </div>
          </div>
        </Card>
      ) : null}

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
                  <span className="min-w-0 break-words">
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
          <button
            type="button"
            onClick={() => void withdraw(launched.graphId)}
            disabled={stopping !== null}
            className="mt-2 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60"
          >
            {stopping === launched.graphId ? "Stopping…" : "Stop"}
          </button>
        </Card>
      ) : null}

      {watchedRun !== null && progress !== null ? (
        <Card>
          <div data-testid="build-live-run">
            <SectionTitle
              title={`Your build — ${watchedRun.state.toLowerCase()}`}
              description={
                (plan?.progressPercent !== null && plan?.progressPercent !== undefined
                  ? `${plan.progressPercent}% — `
                  : "") +
                `${progress.done} of ${progress.total} steps complete` +
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

            {plan !== null ? (
              <details className="mt-4" data-testid="build-plan">
                <summary className="cursor-pointer text-sm font-medium">
                  Plan — composed by the Chief of Staff
                </summary>
                {/* Every field is a record the engine made: the goal
                    verbatim, the compiled tasks, the stored dependency
                    edges layered, the declared gates. Nothing is invented. */}
                <p className="mt-2 text-sm">
                  <span className="text-xs text-[var(--muted)]">Requirements (your words): </span>
                  <span className="break-words">{plan.requirements}</span>
                </p>
                {plan.layers.length > 0 ? (
                  <ol className="mt-2 space-y-1 text-sm">
                    {plan.layers.map((layer, index) => (
                      <li key={`layer-${index}`} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-xs text-[var(--muted)]">
                          {index + 1}.{layer.length > 1 ? ` (${layer.length} in parallel)` : ""}
                        </span>
                        <span className="min-w-0 break-words">
                          {layer.map((key) => {
                            const task = plan.tasks.find((entry) => entry.key === key);
                            return `${key}${task?.specialist ? ` — ${task.specialist.name}` : ""}${task?.gated ? " ⛩ gate" : ""}`;
                          }).join(" · ")}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    The dependency edges have not loaded, so the order is not shown — the
                    steps themselves are under Agents below.
                  </p>
                )}
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Up to {plan.maxParallelism} steps run in parallel
                  {plan.gatedTasks.length > 0
                    ? `; ${plan.gatedTasks.length} ${plan.gatedTasks.length === 1 ? "step waits" : "steps wait"} at a QA gate`
                    : ""}.
                  {" "}The Chief of Staff is the engine&apos;s compiler, scheduler and router —
                  this panel is its plan, read back from the records it made.
                </p>
              </details>
            ) : null}

            <details className="mt-4" data-testid="build-agents">
              <summary className="cursor-pointer text-sm font-medium">
                Agents ({watchedRun.nodes.length} steps)
              </summary>
              {/* The specialist is the factory's role for the step; the
                  executor, provider and model beside it are what actually
                  ran. One never replaces the other. */}
              <ul className="mt-2 space-y-1 text-sm">
                {watchedRun.nodes.map((node) => {
                  const specialist = specialistForNode(node);
                  return (
                    <li key={node.node_key} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{specialist?.name ?? node.executor ?? "—"}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {node.node_key} · {(node.state ?? "planned").toLowerCase()}
                        {node.provider !== null ? ` · ${node.provider}${node.model !== null ? ` ${node.model}` : ""}` : ""}
                        {node.latency_ms !== null ? ` · ${(node.latency_ms / 1000).toFixed(1)}s` : ""}
                      </span>
                      {node.error_message !== null ? (
                        <span className="basis-full text-xs text-[var(--danger)]">{node.error_message}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </details>

            {(watchedRun.verifications ?? []).length > 0 ? (
              <details className="mt-3" data-testid="build-verifications">
                <summary className="cursor-pointer text-sm font-medium">
                  Independent QA ({(watchedRun.verifications ?? []).length} verdicts)
                </summary>
                <ul className="mt-2 space-y-1 text-sm">
                  {(watchedRun.verifications ?? []).map((verification, index) => (
                    <li key={`${verification.subject_node_key}-${verification.lens}-${index}`} className="flex flex-wrap items-baseline gap-x-2">
                      <span className={`font-medium ${verification.verdict === "PASS" ? "" : "text-[var(--danger)]"}`}>
                        {verification.verdict}
                      </span>
                      <span className="text-xs text-[var(--muted)]">
                        {verification.subject_node_key} · {verification.lens} lens
                        {verification.verifier_provider !== null ? ` · verified by ${verification.verifier_provider}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Verification is independent of the agent that did the work — done is only done
                  when a verifier says so with evidence.
                </p>
              </details>
            ) : null}

            <details
              className="mt-3"
              data-testid="build-release"
              onToggle={(event) => {
                if ((event.target as HTMLDetailsElement).open && artifacts === null) {
                  void loadArtifacts(watchedRun.graphRunId);
                }
              }}
            >
              <summary className="cursor-pointer text-sm font-medium">Changes &amp; release</summary>
              {/* Everything here is an ANCHOR node's recorded observation:
                  the pull request that carries the files changed and diffs,
                  the produced commit, the exact-head CI verdict, the
                  provider deployment, and the production health probe. */}
              {artifactsError !== null ? (
                <p className="mt-2 text-sm text-[var(--danger)]">{artifactsError}</p>
              ) : artifacts === null ? (
                <p className="mt-2 text-sm text-[var(--muted)]">Loading…</p>
              ) : (() => {
                const release = deriveReleaseEvidence(artifacts);
                if (release.pullRequest === null && release.checks === null
                  && release.deployment === null && release.health === null) {
                  return (
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      No release evidence yet — this fills in as the run&apos;s implementation,
                      test, deployment and monitoring steps record their observations.
                    </p>
                  );
                }
                return (
                  <ul className="mt-2 space-y-1 text-sm">
                    {release.pullRequest !== null ? (
                      <li className="break-words">
                        <span className="font-medium">Files changed &amp; diffs: </span>
                        <a
                          href={`${release.pullRequest.url}/files`}
                          className="underline underline-offset-2"
                          target="_blank"
                          rel="noreferrer"
                        >
                          pull request #{release.pullRequest.number}
                        </a>
                        <span className="text-xs text-[var(--muted)]">
                          {" "}on {release.pullRequest.repository}
                          {release.producedCommit !== null ? ` · commit ${release.producedCommit.slice(0, 8)}` : ""}
                          {release.baseBranch !== null ? ` → ${release.baseBranch}` : ""}
                        </span>
                      </li>
                    ) : null}
                    {release.checks !== null ? (
                      <li className="break-words">
                        <span className="font-medium">Test results: </span>
                        {release.checks.length === 0 ? (
                          <span className="text-xs text-[var(--muted)]">no required checks recorded</span>
                        ) : release.checks.map((check, index) => (
                          <span key={`${check.name}-${index}`} className="text-xs">
                            {index > 0 ? " · " : ""}
                            {check.url !== null ? (
                              <a href={check.url} className="underline underline-offset-2" target="_blank" rel="noreferrer">
                                {check.name}
                              </a>
                            ) : check.name}
                            {" "}
                            <span className={check.conclusion === "success" ? "text-[var(--muted)]" : "text-[var(--danger)]"}>
                              {check.conclusion}
                            </span>
                          </span>
                        ))}
                      </li>
                    ) : null}
                    {release.deployment !== null ? (
                      <li className="break-words">
                        <span className="font-medium">Deployment: </span>
                        <span className="text-xs">
                          {release.deployment.state}
                          {release.deployment.environment !== null ? ` to ${release.deployment.environment}` : ""}
                          {release.deployment.url !== null ? (
                            <>
                              {" · "}
                              <a href={release.deployment.url} className="underline underline-offset-2" target="_blank" rel="noreferrer">
                                open
                              </a>
                            </>
                          ) : null}
                        </span>
                      </li>
                    ) : null}
                    {release.health !== null ? (
                      <li className="break-words">
                        <span className="font-medium">Production health: </span>
                        <span className={`text-xs ${release.health.healthy ? "" : "text-[var(--danger)]"}`}>
                          {release.health.healthy ? "healthy" : "unhealthy"}
                          {release.health.postDeployValidation !== null
                            ? ` · post-deploy validation ${release.health.postDeployValidation}`
                            : ""}
                        </span>
                      </li>
                    ) : null}
                  </ul>
                );
              })()}
            </details>

            <details
              className="mt-3"
              data-testid="build-artifacts"
              onToggle={(event) => {
                if ((event.target as HTMLDetailsElement).open && artifacts === null) {
                  void loadArtifacts(watchedRun.graphRunId);
                }
              }}
            >
              <summary className="cursor-pointer text-sm font-medium">Artifacts</summary>
              {artifactsError !== null ? (
                <p className="mt-2 text-sm text-[var(--danger)]">{artifactsError}</p>
              ) : artifacts === null ? (
                <p className="mt-2 text-sm text-[var(--muted)]">Loading…</p>
              ) : artifacts.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--muted)]">
                  No artifacts recorded yet — they appear as stages complete.
                </p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {artifacts.map((artifact) => (
                    <li key={artifact.artifactId} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{artifact.kind}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {artifact.nodeKey} · {artifact.createdAt.slice(0, 19).replace("T", " ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </details>

            <details
              className="mt-3"
              data-testid="build-events"
              onToggle={(event) => {
                if ((event.target as HTMLDetailsElement).open && events === null) {
                  void loadEvents(watchedRun.graphRunId);
                }
              }}
            >
              <summary className="cursor-pointer text-sm font-medium">Activity log</summary>
              {/* graph_events verbatim — the engine's own append-only record
                  of what happened, never console output the browser invents. */}
              {eventsError !== null ? (
                <p className="mt-2 text-sm text-[var(--danger)]">{eventsError}</p>
              ) : events === null ? (
                <p className="mt-2 text-sm text-[var(--muted)]">Loading…</p>
              ) : events.rows.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--muted)]">
                  No events recorded yet — they appear as the run makes durable progress.
                </p>
              ) : (
                <>
                  <ol className="mt-2 max-h-64 space-y-0.5 overflow-y-auto font-mono text-xs">
                    {events.rows.map((entry) => (
                      <li key={entry.eventId} className="break-words">
                        <span className="text-[var(--muted)]">{entry.createdAt.slice(11, 19)}</span>
                        {" "}{entry.eventType}
                        {entry.nodeKey !== null ? ` · ${entry.nodeKey}` : ""}
                        {entry.detail !== null ? ` — ${entry.detail}` : ""}
                      </li>
                    ))}
                  </ol>
                  {events.truncated ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Showing the newest 500 events; the full record stays in the database.
                    </p>
                  ) : null}
                </>
              )}
            </details>

            {typeof watchedRun.tokensUsed === "number" || typeof watchedRun.costMicros === "number" ? (
              <p className="mt-3 text-xs text-[var(--muted)]">
                Spend so far:
                {typeof watchedRun.tokensUsed === "number" ? ` ${watchedRun.tokensUsed.toLocaleString("en-US")} tokens` : ""}
                {typeof watchedRun.costMicros === "number" ? ` · $${(watchedRun.costMicros / 1_000_000).toFixed(4)}` : ""}
              </p>
            ) : null}

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
                        {/* A RUNNING claim belongs to its worker — its own budget
                            and failure paths stop it, so no button pretends to. */}
                        {run.state !== "RUNNING" ? (
                          <button
                            type="button"
                            onClick={() => void withdraw(run.graphId)}
                            disabled={stopping !== null}
                            className="rounded-md border border-[var(--border)] px-2 py-1 disabled:opacity-60"
                          >
                            {stopping === run.graphId ? "Stopping…" : "Stop"}
                          </button>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        </Card>
      ) : null}

      {finishedRuns.length > 0 ? (
        <Card>
          <div data-testid="build-history">
            <SectionTitle
              title="Build history"
              description="Every finished lifecycle run in this workspace, with the engine's own account of how it ended."
            />
            <ul className="mt-3 space-y-2">
              {finishedRuns.slice(0, 10).map((run) => (
                <li key={run.graphRunId} className="text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words">{run.goal}</span>
                    <span className="flex shrink-0 items-center gap-3 text-xs text-[var(--muted)]">
                      <span className={run.state === "FAILED" ? "text-[var(--danger)]" : ""}>
                        {run.state.toLowerCase()}
                      </span>
                      {run.completedAt !== null ? run.completedAt.slice(0, 10) : ""}
                      <Link
                        href={`/solutions/lifecycle/run/${run.graphRunId}`}
                        className="underline underline-offset-2"
                      >
                        Evidence
                      </Link>
                    </span>
                  </div>
                  {run.closureNote ? (
                    <p className="mt-0.5 text-xs text-[var(--muted)]">{run.closureNote}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
