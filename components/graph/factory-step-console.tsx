"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Timer,
  UserCheck,
} from "lucide-react";

import { shortRunId } from "@/lib/graph/run-label";
import { FactoryShell, type FactoryViewer, type StepMark } from "@/components/graph/factory-shell";
import type { GateDecisionResult } from "@/components/graph/gate-decision";
import { GraphLaunchControl, type LaunchedGraph } from "@/components/graph-launch-control";
import { StageNodes } from "@/components/graph/lifecycle-console";
import {
  ActivityLog,
  ArtifactBody,
  clock,
  DiscoverySources,
  stageStanding,
  type ArtifactView,
  type RunView,
} from "@/components/graph/stage-content";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { parseNodeReport } from "@/lib/graph/node-report";
import { summariseRunStages } from "@/lib/graph/stage-summary";
import { FACTORY_STEPS, type FactoryStep } from "@/lib/sdlc/factory-steps";
import { stageDefinition } from "@/lib/sdlc/lifecycle";

/**
 * One of the owner's ten factory steps, over one exact lifecycle selection.
 *
 * The navigation's "02. AI Factory" pages. Each one answers, for its step of
 * the process: what the selected full-lifecycle run recorded there, what it
 * was asked to do, what decision (if any) it is waiting on, and where it
 * goes next. Everything is the same stored data every other console reads —
 * `/api/graphs/runs` plus the run's recorded artifacts — rendered through
 * the same shared readers, so a step page cannot disagree with the lifecycle
 * pages about the same run.
 *
 * The graph/run identity is carried in the URL between every step. A newly
 * recorded graph is selected before its first run exists, and an explicit run
 * remains selected across navigation. With multiple lifecycle runs and no
 * selection, the page asks instead of borrowing another project's newest run.
 */

export type FactoryRunSelection = {
  readonly graphId?: string;
  readonly graphRunId?: string;
  readonly projectId?: string;
};

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "none" }
  | { kind: "choose"; runs: readonly RunView[] }
  | { kind: "waiting"; runs: readonly RunView[]; graphId: string }
  | { kind: "missing"; runs: readonly RunView[] }
  | {
      kind: "ready";
      run: RunView;
      runs: readonly RunView[];
      artifacts: readonly ArtifactView[];
      artifactsError: string | null;
    };

type FollowedGraphAttempt = {
  readonly graphId: string;
  readonly displayedRunId: string | null;
  readonly knownRunIds: ReadonlySet<string>;
  readonly workerWoken: boolean;
  readonly note: string;
};

type WorkerDispatchNotice = GateDecisionResult & {
  readonly source: "gate" | "launch";
  readonly graphId: string;
  readonly runId: string | null;
  readonly approved?: boolean;
};

const FACTORY_SELECTION_KEYS = ["graphId", "graphRunId", "projectId"] as const;
const CURRENT_FULL_LIFECYCLE = Object.freeze({ key: "full_lifecycle", version: 2 });
const LIVE_REFRESH_INTERVAL_MS = 15_000;
const LIVE_REFRESH_MAX_TICKS = 40;
const LIVE_NODE_STATES = new Set(["PENDING", "READY", "RUNNING", "VERIFYING"]);

/** Whether a loaded attempt can still change while this page is open. */
export function factoryRunNeedsLiveRefresh(run: RunView): boolean {
  if (run.state === "PLANNED" || run.state === "RUNNING") return true;
  return (run.nodes ?? []).some((node) =>
    LIVE_NODE_STATES.has(node.state) || node.gate_state === "OPEN",
  );
}

function isCurrentFullLifecycle(run: RunView): boolean {
  return run.templateKey === CURRENT_FULL_LIFECYCLE.key
    && run.templateVersion === CURRENT_FULL_LIFECYCLE.version;
}

/** A stable query string that keeps one graph/run bound across all ten pages. */
function selectionQuery(selection: FactoryRunSelection): string {
  const params = new URLSearchParams();
  for (const key of FACTORY_SELECTION_KEYS) {
    const value = selection[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function replaceBrowserSelection(selection: FactoryRunSelection) {
  const url = new URL(window.location.href);
  for (const key of FACTORY_SELECTION_KEYS) url.searchParams.delete(key);
  for (const key of FACTORY_SELECTION_KEYS) {
    const value = selection[key];
    if (value) url.searchParams.set(key, value);
  }
  window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/** The breadcrumb the boards put in the topbar, into the run when one exists. */
function FactoryBreadcrumb({
  step,
  runId,
  stepQuery = "",
}: {
  step: FactoryStep;
  runId?: string | null;
  stepQuery?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li><Link href={`/solutions/factory/requirement${stepQuery}`} className="hover:text-foreground">AI Factory</Link></li>
        <li aria-hidden="true" className="text-faint">›</li>
        {/* Runs is /solutions/runs. This crumb pointed at Pipelines, which
            was defensible only while Runs could not show a lifecycle run at
            all: a crumb named Runs sent you somewhere else, and the run you
            came from was on neither page. Runs lists them now. */}
        <li><Link href="/solutions/runs" className="hover:text-foreground">Runs</Link></li>
        {runId ? (
          <>
            <li aria-hidden="true" className="text-faint">›</li>
            <li>
              <Link
                href={`/solutions/lifecycle/run/${runId}/${step.stages[0].toLowerCase()}`}
                className="font-mono hover:text-foreground"
              >
                {shortRunId(runId)}
              </Link>
            </li>
          </>
        ) : null}
        <li aria-hidden="true" className="text-faint">›</li>
        <li aria-current="page" className="text-foreground">{step.number}. {step.title}</li>
      </ol>
    </nav>
  );
}

export function FactoryStepConsole({
  step,
  viewer,
  initialSelection = {},
}: {
  step: FactoryStep;
  viewer?: FactoryViewer;
  initialSelection?: FactoryRunSelection;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selection, setSelection] = useState<FactoryRunSelection>(initialSelection);
  const [continuationRunId, setContinuationRunId] = useState<string | null>(null);
  const [dispatchNotice, setDispatchNotice] = useState<WorkerDispatchNotice | null>(null);
  const [pollExpiredFor, setPollExpiredFor] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const initialSelectionIdentity = useRef(selectionQuery(initialSelection));
  const followedGraphAttempt = useRef<FollowedGraphAttempt | null>(null);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const update = (next: State) => {
      if (loadGeneration.current === generation) setState(next);
    };
    try {
      const runsResponse = await fetch("/api/graphs/runs?limit=100", { cache: "no-store" });
      if (!runsResponse.ok) {
        update({ kind: "error" });
        return;
      }
      const runsBody = (await runsResponse.json()) as { runs?: RunView[] };
      const lifecycleRuns = (runsBody.runs ?? []).filter((candidate) =>
        candidate.isLifecycle === true,
      );

      let run: RunView | undefined;
      if (selection.graphRunId) {
        const exact = lifecycleRuns.find((candidate) =>
          candidate.graphRunId === selection.graphRunId,
        );
        // Every supplied identity must agree. A valid run id paired with a
        // different graph/project is an identity mismatch, never permission to
        // fall back to whatever happens to be newest.
        if (
          !exact
          || (selection.graphId && exact.graphId !== selection.graphId)
          || (selection.projectId && exact.projectId !== selection.projectId)
        ) {
          update({ kind: "missing", runs: lifecycleRuns });
          return;
        }
        run = exact;
      } else if (selection.graphId) {
        const graphRuns = lifecycleRuns.filter((candidate) =>
          candidate.graphId === selection.graphId
          && (!selection.projectId || candidate.projectId === selection.projectId),
        );
        if (graphRuns.length === 0) {
          update({ kind: "waiting", runs: lifecycleRuns, graphId: selection.graphId });
          return;
        }
        const followed = followedGraphAttempt.current?.graphId === selection.graphId
          ? followedGraphAttempt.current
          : null;
        const continuation = followed
          ? graphRuns.find((candidate) => !followed.knownRunIds.has(candidate.graphRunId))
          : undefined;
        if (continuation) {
          // Gate-held lifecycles resume in a new immutable run. Follow only a
          // run id that did not exist when the owner made the decision, and
          // only inside this exact graph/project. Once found, pin it exactly.
          run = continuation;
          followedGraphAttempt.current = null;
          setContinuationRunId(null);
          setDispatchNotice(null);
          const next: FactoryRunSelection = {
            graphId: continuation.graphId,
            graphRunId: continuation.graphRunId,
            ...(continuation.projectId ? { projectId: continuation.projectId } : {}),
          };
          setSelection(next);
          replaceBrowserSelection(next);
        } else if (followed?.displayedRunId) {
          // The worker has not recorded the continuation attempt yet. Keep
          // showing the exact held attempt while polling this exact graph.
          run = graphRuns.find((candidate) =>
            candidate.graphRunId === followed.displayedRunId,
          );
          if (!run) {
            update({ kind: "missing", runs: graphRuns });
            return;
          }
        } else if (graphRuns.length > 1) {
          update({ kind: "choose", runs: graphRuns });
          return;
        } else if (followed) {
          // A newly launched graph had no run at binding time. Its first run
          // is unambiguous and is pinned as soon as it becomes visible.
          run = graphRuns[0];
          followedGraphAttempt.current = null;
          setDispatchNotice(null);
          const next: FactoryRunSelection = {
            graphId: run.graphId,
            graphRunId: run.graphRunId,
            ...(run.projectId ? { projectId: run.projectId } : {}),
          };
          setSelection(next);
          replaceBrowserSelection(next);
        } else {
          run = graphRuns[0];
        }
      } else if (selection.projectId) {
        const projectRuns = lifecycleRuns.filter((candidate) =>
          candidate.projectId === selection.projectId,
        );
        if (projectRuns.length === 1) run = projectRuns[0];
        else {
          update({ kind: "choose", runs: projectRuns });
          return;
        }
      } else if (lifecycleRuns.length === 1) {
        // A sole lifecycle is unambiguous. Once rendered, all step links pin
        // its exact identities so a concurrent launch cannot switch the page.
        run = lifecycleRuns[0];
      } else if (lifecycleRuns.length > 1) {
        update({ kind: "choose", runs: lifecycleRuns });
        return;
      }

      if (!run) {
        update({ kind: "none" });
        return;
      }
      const artifactsResponse = await fetch(`/api/graphs/runs/${run.graphRunId}/artifacts`, {
        cache: "no-store",
      });
      // Artifacts failing must not blank the step, but an unreadable evidence
      // boundary is not the same thing as a run with zero artifacts. Keep the
      // run visible and carry the read failure into the page beside it.
      const artifactsBody = (await artifactsResponse.json().catch(() => ({}))) as {
        artifacts?: ArtifactView[];
        error?: { message?: string };
      };
      update({
        kind: "ready",
        run,
        runs: lifecycleRuns,
        artifacts: artifactsResponse.ok ? (artifactsBody.artifacts ?? []) : [],
        artifactsError: artifactsResponse.ok
          ? null
          : artifactsBody.error?.message
            ?? `The artifact read answered HTTP ${artifactsResponse.status}.`,
      });
    } catch {
      update({ kind: "error" });
    }
  }, [selection.graphId, selection.graphRunId, selection.projectId]);

  const chooseRun = useCallback((run: RunView) => {
    const next: FactoryRunSelection = {
      graphId: run.graphId,
      graphRunId: run.graphRunId,
      ...(run.projectId ? { projectId: run.projectId } : {}),
    };
    followedGraphAttempt.current = null;
    setContinuationRunId(null);
    setDispatchNotice(null);
    setPollExpiredFor(null);
    loadGeneration.current += 1;
    setSelection(next);
    replaceBrowserSelection(next);
    setState({ kind: "loading" });
  }, []);

  const bindLaunchedGraph = useCallback((graph: LaunchedGraph) => {
    // A launch has no graph_run_id until a worker claims it. Bind the graph and
    // project immediately so an older run can never remain on screen as if it
    // were the newly recorded request.
    const next: FactoryRunSelection = { graphId: graph.graphId, projectId: graph.projectId };
    followedGraphAttempt.current = {
      graphId: graph.graphId,
      displayedRunId: null,
      knownRunIds: new Set(),
      workerWoken: graph.workerWoken,
      note: graph.note,
    };
    setContinuationRunId(null);
    setDispatchNotice({
      source: "launch",
      graphId: graph.graphId,
      runId: null,
      workerWoken: graph.workerWoken,
      note: graph.note,
    });
    setPollExpiredFor(null);
    loadGeneration.current += 1;
    setSelection(next);
    replaceBrowserSelection(next);
    setState({ kind: "loading" });
  }, []);

  const afterGateDecision = useCallback((
    approved: boolean,
    result: GateDecisionResult,
    run: RunView,
    runs: readonly RunView[],
  ) => {
    setDispatchNotice({
      source: "gate",
      graphId: run.graphId,
      runId: run.graphRunId,
      approved,
      workerWoken: result.workerWoken,
      note: result.note,
    });
    setPollExpiredFor(null);
    if (!approved || !result.workerWoken) {
      followedGraphAttempt.current = null;
      setContinuationRunId(null);
      void load();
      return;
    }
    const next: FactoryRunSelection = {
      graphId: run.graphId,
      ...(run.projectId ? { projectId: run.projectId } : {}),
    };
    followedGraphAttempt.current = {
      graphId: run.graphId,
      displayedRunId: run.graphRunId,
      knownRunIds: new Set(
        runs
          .filter((candidate) => candidate.graphId === run.graphId)
          .map((candidate) => candidate.graphRunId),
      ),
      workerWoken: result.workerWoken,
      note: result.note,
    };
    setContinuationRunId(run.graphRunId);
    loadGeneration.current += 1;
    setSelection(next);
    replaceBrowserSelection(next);
    setState({ kind: "loading" });
  }, [load]);

  useEffect(() => {
    const incoming: FactoryRunSelection = {
      ...(initialSelection.graphId ? { graphId: initialSelection.graphId } : {}),
      ...(initialSelection.graphRunId ? { graphRunId: initialSelection.graphRunId } : {}),
      ...(initialSelection.projectId ? { projectId: initialSelection.projectId } : {}),
    };
    const identity = selectionQuery(incoming);
    if (identity === initialSelectionIdentity.current) return;

    // App Router may retain this Client Component while a URL with a different
    // server-read selection streams in (including browser Back/Forward).
    initialSelectionIdentity.current = identity;
    loadGeneration.current += 1;
    followedGraphAttempt.current = null;
    setContinuationRunId(null);
    setDispatchNotice(null);
    setPollExpiredFor(null);
    setSelection(incoming);
    setState({ kind: "loading" });
  }, [initialSelection.graphId, initialSelection.graphRunId, initialSelection.projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      loadGeneration.current += 1;
    };
  }, [load]);

  const pollWanted = continuationRunId !== null
    || state.kind === "waiting"
    || (state.kind === "ready" && factoryRunNeedsLiveRefresh(state.run));
  const pollIdentity = continuationRunId !== null
    ? `continuation:${continuationRunId}`
    : state.kind === "waiting"
      ? `graph:${state.graphId}`
      : state.kind === "ready"
        ? `run:${state.run.graphRunId}`
        : "";
  const currentGraphId = state.kind === "waiting"
    ? state.graphId
    : state.kind === "ready"
      ? state.run.graphId
      : selection.graphId ?? null;
  const visibleDispatchNotice = dispatchNotice?.graphId === currentGraphId
    ? dispatchNotice
    : null;
  const dispatchPollingDisabled = visibleDispatchNotice?.workerWoken === false;
  const pollEligible = pollWanted && !dispatchPollingDisabled && pollIdentity !== "";
  const pollingExpired = pollEligible && pollExpiredFor === pollIdentity;
  const shouldPoll = pollEligible && !pollingExpired;

  useEffect(() => {
    if (!shouldPoll) return;
    let ticks = 0;
    const interval = window.setInterval(() => {
      ticks += 1;
      void load();
      if (ticks >= LIVE_REFRESH_MAX_TICKS) {
        window.clearInterval(interval);
        setPollExpiredFor(pollIdentity);
      }
    }, LIVE_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [load, pollIdentity, shouldPoll]);

  if (state.kind !== "ready") {
    const stepQuery = selectionQuery(selection);
    return (
      <FactoryShell
        step={step}
        marks={[]}
        run={null}
        stepQuery={stepQuery}
        viewer={viewer}
        breadcrumb={<FactoryBreadcrumb step={step} stepQuery={stepQuery} />}
      >
        {state.kind === "loading" ? (
          <Card className="grid min-h-64 place-items-center">
            <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading the factory step" />
          </Card>
        ) : state.kind === "error" ? (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-foreground">The factory could not be read</h2>
            <p className="mt-2 text-sm text-muted">
              The graph runs did not answer. Nothing is shown rather than a figure that might be wrong.
            </p>
            <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm mt-4">
              Try again
            </button>
          </Card>
        ) : state.kind === "choose" ? (
          <div className="space-y-6">
            <PageHeader title={`${step.number}. ${step.title}`} description={step.summary} />
            <Card className="p-6">
              <h2 className="text-base font-semibold text-foreground">Choose the lifecycle run to inspect</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted">
                More than one lifecycle is recorded. Select the exact run; this page will not
                borrow the newest run from another project or graph.
              </p>
              <RunPicker runs={state.runs} value="" onSelect={chooseRun} />
            </Card>
            <GraphLaunchControl
              templateKey="full_lifecycle"
              templateName="Full Lifecycle"
              onLaunched={bindLaunchedGraph}
            />
          </div>
        ) : state.kind === "waiting" ? (
          <div className="space-y-6">
            <PageHeader title={`${step.number}. ${step.title}`} description={step.summary} />
            <Card className="p-6">
              <h2 className="text-base font-semibold text-foreground">
                {visibleDispatchNotice?.source === "launch" && !visibleDispatchNotice.workerWoken
                  ? visibleDispatchNotice.note.includes("Not Connected")
                    ? "Graph recorded — executor Not Connected"
                    : "Graph recorded — worker not woken"
                  : "Selected graph has no visible run yet"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-muted">
                Graph <span className="font-mono text-foreground">{state.graphId}</span> is selected.
                {dispatchPollingDisabled
                  ? " No run for this exact graph is in the newest 100 lifecycle runs; no older run is substituted."
                  : " No run for this exact graph is in the newest 100 lifecycle runs. It may still be waiting for a worker claim; no older run is substituted."}
              </p>
              {visibleDispatchNotice ? (
                <p className="mt-2 max-w-2xl text-sm text-foreground">
                  {visibleDispatchNotice.note}
                </p>
              ) : null}
              {dispatchPollingDisabled ? (
                <p className="mt-2 max-w-2xl text-sm text-muted">
                  Automatic polling is off because this request did not wake a worker. Use Refresh selected
                  graph after a separately authorized dispatch or worker connection.
                </p>
              ) : pollingExpired ? (
                <p role="status" className="mt-2 max-w-2xl text-sm text-muted">
                  Automatic checks paused after the bounded wait. Use Refresh selected graph for an
                  immediate, exact read.
                </p>
              ) : (
                <p className="mt-2 max-w-2xl text-sm text-muted">
                  This page is checking this exact graph automatically for a bounded period.
                </p>
              )}
              <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm mt-4">
                Refresh selected graph
              </button>
              {state.runs.length > 0 ? (
                <RunPicker runs={state.runs} value="" onSelect={chooseRun} />
              ) : null}
            </Card>
          </div>
        ) : state.kind === "missing" ? (
          <div className="space-y-6">
            <PageHeader title={`${step.number}. ${step.title}`} description={step.summary} />
            <Card className="p-6">
              <h2 className="text-base font-semibold text-foreground">Selected lifecycle run is unavailable</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted">
                The selected run is not an exact lifecycle match in this organization&apos;s newest
                100 runs. No other project or graph is shown in its place.
              </p>
              {state.runs.length > 0 ? (
                <RunPicker runs={state.runs} value="" onSelect={chooseRun} />
              ) : null}
            </Card>
          </div>
        ) : (
          <div className="space-y-6">
            <PageHeader title={`${step.number}. ${step.title}`} description={step.summary} />
            <Card className="p-6">
              <h2 className="text-base font-semibold text-foreground">No lifecycle has run yet</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted">
                These pages walk one selected full-lifecycle run through the ten steps, and none is
                recorded yet. Launch one below and every step fills in as the work moves.
              </p>
            </Card>
            <GraphLaunchControl
              templateKey="full_lifecycle"
              templateName="Full Lifecycle"
              onLaunched={bindLaunchedGraph}
            />
          </div>
        )}
      </FactoryShell>
    );
  }

  return (
    <StepView
      step={step}
      run={state.run}
      runs={state.runs}
      artifacts={state.artifacts}
      artifactsError={state.artifactsError}
      dispatchNotice={visibleDispatchNotice}
      followingContinuation={continuationRunId === state.run.graphRunId}
      pollingExpired={pollingExpired}
      onReload={load}
      onGateDecided={(approved, result) =>
        afterGateDecision(approved, result, state.run, state.runs)}
      onSelectRun={chooseRun}
      onLaunched={bindLaunchedGraph}
      viewer={viewer}
    />
  );
}

function StepView({
  step,
  run,
  runs,
  artifacts,
  artifactsError,
  dispatchNotice,
  followingContinuation,
  pollingExpired,
  onGateDecided,
  onReload,
  onSelectRun,
  onLaunched,
  viewer,
}: {
  step: FactoryStep;
  run: RunView;
  runs: readonly RunView[];
  artifacts: readonly ArtifactView[];
  artifactsError: string | null;
  dispatchNotice: WorkerDispatchNotice | null;
  followingContinuation: boolean;
  pollingExpired: boolean;
  onGateDecided: (approved: boolean, result: GateDecisionResult) => void;
  onReload: () => void;
  onSelectRun: (run: RunView) => void;
  onLaunched: (graph: LaunchedGraph) => void;
  viewer?: FactoryViewer;
}) {
  /*
   * Whether the launcher is open.
   *
   * The empty state has always offered one; once a run existed these pages
   * had no way to start another, so the only route to a second request was
   * to know that Workflows carries the same control.
   */
  const [startingNew, setStartingNew] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const nodes = run.nodes ?? [];
  const { stages } = summariseRunStages(nodes);
  const previous = FACTORY_STEPS.find((candidate) => candidate.number === step.number - 1) ?? null;
  const next = FACTORY_STEPS.find((candidate) => candidate.number === step.number + 1) ?? null;
  // Once a concrete run has been resolved, every link pins all of its known
  // identities. A graph-only or project-only URL is merely a lookup input;
  // propagating that partial selector would become ambiguous as soon as a
  // retry or a second run appeared.
  const exactSelection: FactoryRunSelection = {
    graphId: run.graphId,
    graphRunId: run.graphRunId,
    ...(run.projectId ? { projectId: run.projectId } : {}),
  };
  const stepQuery = selectionQuery(exactSelection);
  const stepHref = (slug: string) => `/solutions/factory/${slug}${stepQuery}`;
  const currentFullLifecycle = isCurrentFullLifecycle(run);
  const failedNodes = nodes.filter((node) => node.state === "FAILED" || node.state === "CANCELLED");

  const openCurrentRequest = () => {
    setStartingNew(true);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const launcher = document.getElementById("factory-new-request");
        if (typeof launcher?.scrollIntoView === "function") {
          launcher.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onReload();
    } finally {
      setRefreshing(false);
    }
  };

  /** A step's standing is its worst stage's standing, in lifecycle order. */
  const stepStanding = (candidate: FactoryStep) => {
    const slices = candidate.stages.map((stage) =>
      stages.find((slice) => slice.stage === stage),
    );
    const present = slices.filter((slice) => slice !== undefined);
    if (present.length === 0) return stageStanding(undefined);
    if (present.some((slice) => slice!.failed > 0)) return stageStanding(present.find((slice) => slice!.failed > 0));
    if (present.some((slice) => slice!.active > 0)) return stageStanding(present.find((slice) => slice!.active > 0));
    if (present.length !== candidate.stages.length) return stageStanding(undefined);
    // A grouped step is complete only when every stage it owns is present.
    // REQUIREMENT owns GOAL and PRD; a lone completed GOAL must not turn the
    // whole requirement step green while its PRD is absent.
    if (
      present.every((slice) => slice!.completed === slice!.total)
    ) return stageStanding(present[0]);
    return stageStanding(present.find((slice) => slice!.completed !== slice!.total) ?? present[0]);
  };

  const standing = stepStanding(step);
  const stepNodes = nodes.filter(
    (node) => node.lifecycle_stage && (step.stages as readonly string[]).includes(node.lifecycle_stage),
  );
  const stepNodeKeys = new Set(stepNodes.map((node) => node.node_key));
  const stepArtifacts = artifacts.filter(
    (artifact) => artifact.nodeKey !== null && stepNodeKeys.has(artifact.nodeKey),
  );
  const stepVerifications = (run.verifications ?? []).filter(
    (verification) => stepNodeKeys.has(verification.subject_node_key),
  );
  const openGateNode = stepNodes.find(
    (node) => node.gate_state === "OPEN" && typeof node.gate_id === "string",
  );

  const startedTimes = stepNodes
    .map((node) => node.node_started_at)
    .filter((value): value is string => typeof value === "string")
    .sort();
  const workedBy = [...new Set(stepNodes.flatMap((node) => {
    const provider = (node as { provider?: string | null }).provider;
    return [node.executor, provider].filter((value): value is string => Boolean(value));
  }))];
  const completedInStep = stepNodes.filter((node) => node.state === "COMPLETED").length;
  // The run's stored nodes are the authority for gates. Lifecycle definitions
  // describe the general stage vocabulary, but a concrete template may not
  // place every default gate on a node; showing one anyway invents a decision
  // the run can never open.
  const gates = [...new Set(stepNodes
    .map((node) => node.gate_kind)
    .filter((gate): gate is "HUMAN" | "AUTOMATIC" =>
      gate === "HUMAN" || gate === "AUTOMATIC"))];

  /**
   * The step's recommendations to its successor, from the recorded reports.
   * The boards call this column "insights"; here it is exactly what the
   * nodes wrote, deduplicated and bounded, never paraphrased.
   */
  const insights = [...new Set(stepArtifacts.flatMap((artifact) => {
    const report = parseNodeReport(artifact.payload);
    return report ? report.recommendations : [];
  }))].slice(0, 6);

  const standingWord = (value: { label: string }) =>
    value.label === "complete" ? "Complete"
      : value.label === "in flight" ? "In progress"
        : value.label === "failed" ? "Failed"
          : value.label === "pending" ? "Pending"
            : value.label === "skipped" ? "Skipped"
              : value.label === "not in this run" ? "Not planned"
                : "Mixed";

  /* The sidebar's ten circles and the run card, from the same standings. */
  const marks: StepMark[] = FACTORY_STEPS.map((entry) => {
    const entryStanding = stepStanding(entry);
    return {
      slug: entry.slug,
      state: entryStanding.label === "complete" ? "complete"
        : entryStanding.label === "in flight" || entryStanding.label === "failed" ? "active"
          : "pending",
    };
  });
  const stepsComplete = marks.filter((mark) => mark.state === "complete").length;

  /* The step's node states, counted for the donut and the tiles. */
  const inFlightInStep = stepNodes.filter(
    (node) => node.state === "RUNNING" || node.state === "VERIFYING",
  ).length;
  const failedInStep = stepNodes.filter((node) => node.state === "FAILED").length;
  const settledOtherwise = stepNodes.length - completedInStep - inFlightInStep - failedInStep;

  return (
    <FactoryShell
      step={step}
      marks={marks}
      run={{
        graphRunId: run.graphRunId,
        state: run.state,
        startedAt: run.startedAt,
        stepsComplete,
        costMicros: run.costMicros,
        budgetAction: run.budgetAction,
      }}
      stepQuery={stepQuery}
      viewer={viewer}
      breadcrumb={<FactoryBreadcrumb step={step} runId={run.graphRunId} stepQuery={stepQuery} />}
    >
    <div className="space-y-5">
      {/* The title row: big numbered step, its live standing, the actions. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold uppercase tracking-tight text-foreground">
              {step.number}. {step.title}
            </h1>
            <StatusBadge tone={standing.tone} dot={false}>{standingWord(standing)}</StatusBadge>
          </div>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">{step.summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} aria-hidden="true" />
            {refreshing ? "Refreshing…" : "Refresh run"}
          </button>
          <button
            type="button"
            onClick={() => setStartingNew((open) => !open)}
            aria-expanded={startingNew}
            aria-controls="factory-new-request"
            className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            New Request
          </button>
          <Link href="/solutions/pipelines" className="btn btn-secondary btn-sm">
            View Run Overview
          </Link>
          {next ? (
            <Link
              href={stepHref(next.slug)}
              className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
            >
              Next Stage <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </div>

      {/*
        The launcher, in place, when asked for.
        This is the same control the no-run state offers, not a second way to
        start work: one request is one Full Lifecycle graph recorded against a
        project. The goal is the template's, so this deliberately offers no
        free-text box it could not honour — and the control's own result
        states whether the worker was woken or the graph waits for a dispatch.
      */}
      {startingNew ? (
        <div id="factory-new-request" className="space-y-2">
          <p className="text-sm text-muted">
            A request runs the whole ten-step lifecycle once against the project you choose. The
            exact graph is selected as soon as it is recorded, before its first run exists.
          </p>
          <GraphLaunchControl
            templateKey="full_lifecycle"
            templateName="Full Lifecycle"
            onLaunched={onLaunched}
          />
        </div>
      ) : null}

      <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="label">Selected lifecycle run</h2>
            <p className="mt-1 text-xs text-faint">
              Graph {run.graphId}{run.projectId ? ` · project ${run.projectId}` : ""}
            </p>
          </div>
          <RunPicker runs={runs} value={run.graphRunId} onSelect={onSelectRun} compact />
        </div>
      </Card>

      {followingContinuation ? (
        <div role="status">
          <Card className="border-[var(--accent-border)] p-5">
            <h2 className="text-base font-semibold text-foreground">
              {pollingExpired
                ? "Gate approved — continuation not recorded"
                : "Gate approved — waiting for continuation"}
            </h2>
            {dispatchNotice ? (
              <p className="mt-2 text-sm text-foreground">{dispatchNotice.note}</p>
            ) : null}
            <p className="mt-2 text-sm text-muted">
              {pollingExpired
                ? "Automatic checks paused after the bounded wait without finding a new immutable attempt. Use Refresh run for an immediate, exact read."
                : "The decision is recorded. A worker continuation is a new immutable attempt of this exact graph, so this page is checking for that new run automatically for a bounded period. Use Refresh run for an immediate check."}
            </p>
          </Card>
        </div>
      ) : null}

      {!followingContinuation && dispatchNotice?.source === "gate" ? (
        <div role="status">
          <Card className="border-[var(--accent-border)] p-5">
            <h2 className="text-base font-semibold text-foreground">
              {!dispatchNotice.approved
                ? "Gate decision recorded"
                : !dispatchNotice.workerWoken && dispatchNotice.note.includes("Not Connected")
                  ? "Gate approved — executor Not Connected"
                  : !dispatchNotice.workerWoken
                    ? "Gate approved — worker not woken"
                    : "Gate decision recorded"}
            </h2>
            <p className="mt-2 text-sm text-foreground">{dispatchNotice.note}</p>
            {!dispatchNotice.approved ? (
              <p className="mt-2 text-sm text-muted">
                No continuation is expected from a rejected gate. Use Refresh run only to read the
                exact recorded state again.
              </p>
            ) : !dispatchNotice.workerWoken ? (
              <p className="mt-2 text-sm text-muted">
                Automatic continuation polling is off because this decision did not wake a worker.
                Use Refresh run after a separately authorized dispatch or worker connection.
              </p>
            ) : null}
          </Card>
        </div>
      ) : null}

      {!followingContinuation && !dispatchNotice && pollingExpired ? (
        <div role="status">
          <Card className="border-[var(--accent-border)] p-5">
            <h2 className="text-base font-semibold text-foreground">Automatic refresh paused</h2>
            <p className="mt-2 text-sm text-muted">
              The bounded live-refresh period ended. Use Refresh run for an immediate, exact read;
              this page is no longer checking automatically.
            </p>
          </Card>
        </div>
      ) : null}

      {!currentFullLifecycle ? (
        <Card className="border-[var(--warning-border,var(--border))] p-5">
          <h2 className="text-base font-semibold text-foreground">Historical lifecycle definition</h2>
          <p className="mt-2 text-sm text-muted">
            {run.templateKey && typeof run.templateVersion === "number"
              ? `This run used ${run.templateKey} v${run.templateVersion}; the current production lifecycle is ${CURRENT_FULL_LIFECYCLE.key} v${CURRENT_FULL_LIFECYCLE.version}.`
              : `This run does not expose a verifiable template identity. The current production lifecycle is ${CURRENT_FULL_LIFECYCLE.key} v${CURRENT_FULL_LIFECYCLE.version}.`}
            {" "}Its recorded result is immutable and must not be used to judge the current Deploy or Monitor wiring.
          </p>
          <button type="button" onClick={openCurrentRequest} className="btn btn-primary btn-sm mt-4">
            Start the current Full Lifecycle
          </button>
        </Card>
      ) : failedNodes.length > 0 ? (
        <Card className="border-[var(--danger-border,var(--border))] p-5">
          <h2 className="text-base font-semibold text-foreground">This attempt ended with failed work</h2>
          <p className="mt-2 text-sm text-muted">
            {failedNodes.map((node) => node.node_key).join(", ")} stopped this immutable attempt.
            Review the recorded reason below, then start a fresh current lifecycle after the cause is corrected.
          </p>
          <button type="button" onClick={openCurrentRequest} className="btn btn-primary btn-sm mt-4">
            Start a fresh Full Lifecycle
          </button>
        </Card>
      ) : null}

      {artifactsError ? (
        <div role="alert">
          <Card className="border-[var(--danger-border,var(--border))] p-5">
            <h2 className="text-base font-semibold text-foreground">Run artifacts could not be read</h2>
            <p className="mt-2 text-sm text-muted">
              {artifactsError} The run standings remain visible, but artifact counts and contents are unavailable.
            </p>
            <button type="button" onClick={onReload} className="btn btn-secondary btn-sm mt-4">
              Try again
            </button>
          </Card>
        </div>
      ) : null}

      <ReleaseStepGuidance step={step} artifacts={artifacts} />

      {/* The ten steps as the boards draw them: a circle per step — a check
          once complete, the number otherwise — the name, and the standing
          word beneath it, the current step boxed. */}
      <Card className="overflow-x-auto p-3">
        <ol aria-label="The ten factory steps" className="flex min-w-max items-stretch">
          {FACTORY_STEPS.map((entry, position) => {
            const entryStanding = stepStanding(entry);
            const current = entry.slug === step.slug;
            const complete = entryStanding.label === "complete";
            return (
              <li key={entry.slug} className="flex flex-1 items-center">
                {position > 0 ? (
                  <span aria-hidden="true" className="mx-0.5 h-px w-2 shrink-0 bg-[var(--border)]" />
                ) : null}
                <Link
                  href={stepHref(entry.slug)}
                  aria-current={current ? "page" : undefined}
                  aria-label={`${entry.number}. ${entry.title} — ${standingWord(entryStanding)}`}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-lg border px-2 py-1.5 transition",
                    current
                      ? "border-[var(--accent-border)] bg-[var(--accent-surface)]"
                      : "border-transparent hover:bg-surface-raised",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold",
                      complete
                        ? "border-[var(--safe-border,var(--border))] text-[var(--safe,inherit)]"
                        : current
                          ? "border-[var(--accent-border)] text-[var(--accent-text)]"
                          : "border-[var(--border)] text-muted",
                    )}
                  >
                    {complete ? <Check className="size-3.5" aria-hidden="true" /> : entry.number}
                  </span>
                  <span className="min-w-0">
                    <span className={cn(
                      "block text-xs font-semibold",
                      current ? "text-[var(--accent-text)]" : "text-foreground",
                    )}>
                      {entry.title}
                    </span>
                    <span className="block text-[11px] text-faint">{standingWord(entryStanding)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </Card>

      {/* The boards' tile row: only figures something records. */}
      {/* Two-up only once a half-width tile can hold its widest chip beside
          the icon circle; below that the row stacks. */}
      <dl className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile icon={Activity} label="Stage Status">
          <StatusBadge tone={standing.tone} dot={false}>{standingWord(standing)}</StatusBadge>
        </StatTile>
        <StatTile icon={CircleCheck} label="Nodes Completed" sub={`of ${stepNodes.length} planned`}>
          <span className="tabular text-xl font-bold text-foreground">
            {completedInStep} / {stepNodes.length}
          </span>
        </StatTile>
        <StatTile icon={Layers} label="Artifacts" sub="recorded by this step">
          <span className="tabular text-xl font-bold text-foreground">{stepArtifacts.length}</span>
        </StatTile>
        <StatTile icon={ShieldCheck} label="Verifications" sub="on this step's work">
          <span className="tabular text-xl font-bold text-foreground">{stepVerifications.length}</span>
        </StatTile>
        <StatTile icon={Timer} label="Started">
          <span className="text-sm font-semibold text-foreground">
            {clock(startedTimes[0]) ?? "—"}
          </span>
        </StatTile>
        <StatTile icon={UserCheck} label="Gate">
          <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
            {gates.length === 0 ? "None" : gates.map((gate) =>
              gate === "HUMAN" ? "Human" : "Automatic").join(", ")}
            {openGateNode ? (
              <StatusBadge tone="warning" dot={false}>open</StatusBadge>
            ) : null}
          </span>
        </StatTile>
      </dl>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {/* The request, verbatim — the boards' intake panel. */}
          <Card className="p-5">
            <h2 className="label">The request</h2>
            <p className="mt-2 text-sm text-foreground">{run.goal}</p>
            <p className="mt-3 text-xs text-faint">
              Selected lifecycle run {run.graphRunId} · {run.state}
              {run.startedAt ? ` · started ${clock(run.startedAt)}` : ""}
              {run.completedAt ? ` · closed ${clock(run.completedAt)}` : ""}
            </p>
          </Card>

          {step.stages.map((stage) => {
            const definition = stageDefinition(stage);
            const slice = stages.find((candidate) => candidate.stage === stage);
            const stageStandingValue = stageStanding(slice);
            const stageNodes = nodes.filter((node) => node.lifecycle_stage === stage);
            const stageNodeKeys = new Set(stageNodes.map((node) => node.node_key));
            const stageArtifacts = artifacts.filter(
              (artifact) => artifact.nodeKey !== null && stageNodeKeys.has(artifact.nodeKey),
            );
            const evidenceArtifactIds = Object.fromEntries(stageNodes.flatMap((node) => {
              const latest = stageArtifacts
                .filter((artifact) => artifact.nodeKey === node.node_key)
                .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
              return latest ? [[node.node_key, latest.artifactId]] : [];
            }));
            return (
              <section key={stage} aria-label={`${stage} in this run`} className="space-y-3">
                <Card className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-foreground">{stage}</h2>
                    <StatusBadge tone={stageStandingValue.tone} dot={false}>
                      {stageStandingValue.label}
                    </StatusBadge>
                    {slice ? (
                      <span className="text-sm text-muted">
                        {slice.completed} of {slice.total} node{slice.total === 1 ? "" : "s"} completed
                        {slice.failed > 0 ? ` · ${slice.failed} failed` : ""}
                        {slice.active > 0 ? ` · ${slice.active} in flight` : ""}
                      </span>
                    ) : null}
                    <Link
                      href={`/solutions/lifecycle/run/${run.graphRunId}/${stage.toLowerCase()}`}
                      className="ml-auto text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-foreground"
                    >
                      Stage page
                    </Link>
                  </div>
                  <p className="mt-2 text-sm text-muted">{definition.produces}</p>
                  {stageNodes.length === 0 ? (
                    <p className="mt-3 text-sm text-muted">
                      This run planned no node in this stage.
                    </p>
                  ) : (
                    <StageNodes
                      approvalRequiresEvidence={["ARCHITECTURE", "TEST", "DEPLOYMENT"].includes(stage)
                        && stageNodes.some((node) => node.gate_kind === "HUMAN")}
                      approvalUnavailableMessage={artifactsError
                        ? "Approval is unavailable because the exact run artifacts could not be read. Retry the artifact read first."
                        : "Approval is unavailable until this stage records its exact evidence artifact. Refresh the run after the node finishes."}
                      evidenceArtifactIds={evidenceArtifactIds}
                      nodes={stageNodes}
                      onDecided={onGateDecided}
                    />
                  )}
                </Card>

                {stage === "DISCOVERY" ? <DiscoverySources artifacts={stageArtifacts} /> : null}

                {stageArtifacts.length > 0 ? (
                  <ul className="space-y-3">
                    {stageArtifacts.map((artifact) => (
                      <li key={artifact.artifactId}>
                        <Card className="p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone="neutral" dot={false}>{artifact.kind}</StatusBadge>
                            {artifact.nodeKey ? (
                              <span className="text-xs font-medium text-foreground">{artifact.nodeKey}</span>
                            ) : null}
                            <span className="text-xs text-faint">{clock(artifact.createdAt) ?? ""}</span>
                          </div>
                          <ArtifactBody payload={artifact.payload} />
                        </Card>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}

          <ActivityLog nodes={stepNodes} />
        </div>

        {/* The rail: the boards' insight and action column, from recorded
            content and real destinations alone. */}
        <aside className="min-w-0 space-y-5">
          {stepNodes.length > 0 ? (
            <Card className="p-5">
              <h2 className="label">{step.title} progress</h2>
              <NodeDonut
                completed={completedInStep}
                inFlight={inFlightInStep}
                failed={failedInStep}
                remaining={settledOtherwise}
                total={stepNodes.length}
              />
            </Card>
          ) : null}

          {insights.length > 0 ? (
            <Card className="p-5">
              <h2 className="label">{step.title} insights</h2>
              <ul className="mt-2 space-y-2">
                {insights.map((insight, position) => (
                  <li key={position} className="flex gap-2 text-sm text-muted">
                    <span aria-hidden="true" className="mt-0.5 text-[var(--accent-text)]">•</span>
                    <span className="min-w-0">{insight}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-faint">
                Recorded by this step&apos;s nodes as recommendations to the next stage.
              </p>
            </Card>
          ) : null}

          {stepVerifications.length > 0 ? (
            <Card className="p-5">
              <h2 className="label">Verifications</h2>
              <ul className="mt-2 space-y-1.5">
                {stepVerifications.map((verification, position) => (
                  <li key={position} className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusBadge
                      tone={verification.verdict === "PASS" ? "safe"
                        : verification.verdict === "WARN" ? "warning" : "danger"}
                      dot={false}
                    >
                      {verification.verdict}
                    </StatusBadge>
                    <span className="text-foreground">{verification.subject_node_key}</span>
                    <span className="text-xs text-faint">{verification.lens}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {workedBy.length > 0 ? (
            <Card className="p-5">
              <h2 className="label">Worked by</h2>
              <ul className="mt-2 space-y-1.5 text-sm">
                {workedBy.map((worker) => (
                  <li key={worker} className="flex items-center gap-2 text-muted">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--accent)]" />
                    {worker}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-faint">Executors and providers this step recorded.</p>
            </Card>
          ) : null}

          <Card className="p-5">
            <h2 className="label">Next actions</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {openGateNode ? (
                <li className="text-foreground">
                  Decide the open {openGateNode.lifecycle_stage} gate — the Approve and Reject
                  controls are on the node to the left.
                </li>
              ) : null}
              {step.stages.map((stage) => (
                <li key={stage}>
                  <Link
                    href={`/solutions/lifecycle/run/${run.graphRunId}/${stage.toLowerCase()}`}
                    className="text-muted underline decoration-dotted underline-offset-2 hover:text-foreground"
                  >
                    Open the {stage} stage page
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/solutions/pipelines"
                  className="text-muted underline decoration-dotted underline-offset-2 hover:text-foreground"
                >
                  See this run on Pipelines
                </Link>
              </li>
              {next ? (
                <li>
                  <Link
                    href={stepHref(next.slug)}
                    className="text-muted underline decoration-dotted underline-offset-2 hover:text-foreground"
                  >
                    Continue to {next.number}. {next.title}
                  </Link>
                </li>
              ) : null}
            </ul>
          </Card>
        </aside>
      </div>

      {/* The boards' footer: previous step, the run's stage history, next. */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {previous ? (
            <Link
              href={stepHref(previous.slug)}
              className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Previous Stage: {previous.title}
            </Link>
          ) : <span />}
          <Link
            href={`/solutions/lifecycle/${step.stages[0].toLowerCase()}`}
            className="text-sm text-muted underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            View {step.stages[0]} across every run
          </Link>
          {next ? (
            <Link
              href={stepHref(next.slug)}
              className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
            >
              Next Stage: {next.title}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : <span />}
        </div>
      </Card>
    </div>
    </FactoryShell>
  );
}

function runOptionLabel(run: RunView): string {
  const goal = run.goal.replace(/\s+/g, " ").trim();
  const boundedGoal = goal.length > 72 ? `${goal.slice(0, 69)}…` : goal;
  const project = run.projectId ? run.projectId.slice(0, 8) : "unknown";
  return `${shortRunId(run.graphRunId)} · project ${project} · ${boundedGoal}`;
}

/**
 * Selects one exact run identity. The option value is never a graph id or a
 * project id, so two requests with the same goal cannot alias each other.
 */
function RunPicker({
  runs,
  value,
  onSelect,
  compact = false,
}: {
  runs: readonly RunView[];
  value: string;
  onSelect: (run: RunView) => void;
  compact?: boolean;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-sm", compact ? "w-full sm:w-auto" : "mt-4")}>
      <span className="text-muted">Lifecycle run</span>
      <select
        aria-label="Lifecycle run"
        value={value}
        onChange={(event) => {
          const selected = runs.find((run) => run.graphRunId === event.target.value);
          if (selected) onSelect(selected);
        }}
        className="input min-w-0 sm:max-w-xl"
      >
        {value === "" ? <option value="">Select an exact run…</option> : null}
        {runs.map((run) => (
          <option key={run.graphRunId} value={run.graphRunId}>
            {runOptionLabel(run)}
          </option>
        ))}
      </select>
    </label>
  );
}

type ReleaseHandoffEvidence = {
  pullRequestUrl: string | null;
  headSha: string | null;
  deploymentSha: string | null;
  deploymentId: string | null;
  deploymentUrl: string | null;
  deploymentState: string | null;
};

function recordPayload(payload: unknown): Record<string, unknown> | null {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function releaseHandoffEvidence(artifacts: readonly ArtifactView[]): ReleaseHandoffEvidence {
  let pullRequestUrl: string | null = null;
  let headSha: string | null = null;
  let deploymentSha: string | null = null;
  let deploymentId: string | null = null;
  let deploymentUrl: string | null = null;
  let deploymentState: string | null = null;

  for (const artifact of artifacts) {
    const payload = recordPayload(artifact.payload);
    if (!payload) continue;
    const observation = typeof payload.observation === "string" ? payload.observation : "";
    const isPullRequestEvidence = observation === "phase1c_change_lineage"
      || observation === "phase1c_pull_request_review"
      || observation === "ci_check_runs";
    const possiblePullRequestUrl = safeHttpsUrl(payload.pullRequestUrl ?? payload.pull_request_url);
    if (isPullRequestEvidence && possiblePullRequestUrl && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\/?$/i.test(possiblePullRequestUrl)) {
      pullRequestUrl ??= possiblePullRequestUrl;
    }
    const possibleSha = payload.headSha ?? payload.head_sha ?? payload.sha;
    if (isPullRequestEvidence && typeof possibleSha === "string" && /^[0-9a-f]{40}$/i.test(possibleSha)) {
      headSha = possibleSha.toLowerCase();
    }
    if (observation === "github_production_deployment") {
      if (typeof payload.sha === "string" && /^[0-9a-f]{40}$/i.test(payload.sha)) {
        deploymentSha = payload.sha.toLowerCase();
      }
      const rawId = payload.deploymentId ?? payload.deployment_id;
      if ((typeof rawId === "number" && Number.isSafeInteger(rawId)) || typeof rawId === "string") {
        deploymentId = String(rawId);
      }
      deploymentUrl = safeHttpsUrl(payload.environmentUrl ?? payload.environment_url);
      deploymentState = typeof payload.state === "string" ? payload.state : null;
    }
  }

  return { pullRequestUrl, headSha, deploymentSha, deploymentId, deploymentUrl, deploymentState };
}

function ReleaseStepGuidance({
  step,
  artifacts,
}: {
  step: FactoryStep;
  artifacts: readonly ArtifactView[];
}) {
  if (step.slug !== "test" && step.slug !== "deploy") return null;
  const evidence = releaseHandoffEvidence(artifacts);

  if (step.slug === "test") {
    return (
      <Card className="border-[var(--accent-border)] p-5">
        <h2 className="text-base font-semibold text-foreground">TEST handoff: review and merge in GitHub</h2>
        <p className="mt-2 text-sm text-muted">
          Required CI must be green for the exact head. Review and merge that pull request in GitHub,
          then use <strong className="text-foreground">Accept merged pull request</strong> on the TEST node.
          The acceptance control verifies an existing merge and records its exact commit; it never merges.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {evidence.pullRequestUrl ? (
            <a
              href={evidence.pullRequestUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary btn-sm"
            >
              Open exact pull request
            </a>
          ) : (
            <span className="text-[var(--warning)]">The exact pull-request link is not recorded yet.</span>
          )}
          {evidence.headSha ? (
            <span className="text-muted">head <code className="font-mono text-foreground">{evidence.headSha.slice(0, 8)}</code></span>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-[var(--accent-border)] p-5">
      <h2 className="text-base font-semibold text-foreground">DEPLOY handoff: accept observed Production</h2>
      <p className="mt-2 text-sm text-muted">
        Vercel&apos;s Git integration performs the deployment outside this control plane. After the exact
        merge commit reports a successful Production deployment, use
        <strong className="text-foreground"> Accept production deployment</strong> on the DEPLOY node.
        The control verifies and records provider evidence; it never deploys.
      </p>
      {evidence.deploymentId || evidence.deploymentUrl || evidence.deploymentState ? (
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-faint">Provider state</dt>
            <dd className="text-foreground">{evidence.deploymentState ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Deployment ID</dt>
            <dd className="break-all font-mono text-foreground">{evidence.deploymentId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Exact commit</dt>
            <dd className="font-mono text-foreground">{evidence.deploymentSha?.slice(0, 8) ?? "—"}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-[var(--warning)]">No exact Production deployment evidence is recorded yet.</p>
      )}
      {evidence.deploymentUrl ? (
        <a
          href={evidence.deploymentUrl}
          target="_blank"
          rel="noreferrer"
          className="btn btn-secondary btn-sm mt-3"
        >
          Open observed deployment
        </a>
      ) : null}
    </Card>
  );
}

function StatTile({
  icon: Icon,
  label,
  sub,
  children,
}: {
  icon: typeof Activity;
  label: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-surface)]">
          <Icon className="size-4 text-[var(--accent-text)]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <dt className="text-xs text-faint">{label}</dt>
          <dd className="mt-1 flex min-h-7 items-center">{children}</dd>
          {sub ? <p className="mt-0.5 text-[11px] text-faint">{sub}</p> : null}
        </div>
      </div>
    </Card>
  );
}

/**
 * The step's nodes as a donut — real fractions of real states, the legend
 * carrying the counts so the ring never has to be trusted alone.
 */
function NodeDonut({
  completed,
  inFlight,
  failed,
  remaining,
  total,
}: {
  completed: number;
  inFlight: number;
  failed: number;
  remaining: number;
  total: number;
}) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const segments = [
    { value: completed, color: "#34d399", label: "Completed" },
    { value: inFlight, color: "#60a5fa", label: "In flight" },
    { value: failed, color: "#f87171", label: "Failed" },
    { value: remaining, color: "#3f3f5a", label: "Pending" },
  ].filter((segment) => segment.value > 0);
  let offset = 0;

  return (
    <div className="mt-3 flex items-center gap-4">
      <svg viewBox="0 0 84 84" className="size-24 shrink-0" role="img"
        aria-label={`${completed} of ${total} nodes completed`}>
        <circle cx="42" cy="42" r={radius} fill="none" stroke="var(--surface-raised)" strokeWidth="9" />
        {segments.map((segment) => {
          const length = (segment.value / total) * circumference;
          const dash = `${length} ${circumference - length}`;
          const element = (
            <circle
              key={segment.label}
              cx="42" cy="42" r={radius} fill="none"
              stroke={segment.color} strokeWidth="9"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              transform="rotate(-90 42 42)"
            />
          );
          offset += length;
          return element;
        })}
        <text x="42" y="46" textAnchor="middle" className="fill-[var(--text)] text-[13px] font-bold">
          {completed}/{total}
        </text>
      </svg>
      <ul className="space-y-1 text-xs">
        {[
          { value: completed, color: "#34d399", label: "Completed" },
          { value: inFlight, color: "#60a5fa", label: "In flight" },
          { value: failed, color: "#f87171", label: "Failed" },
          { value: remaining, color: "#3f3f5a", label: "Pending" },
        ].map((entry) => (
          <li key={entry.label} className="flex items-center gap-2 text-muted">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ background: entry.color }} />
            {entry.label}
            <span className="tabular text-foreground">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
