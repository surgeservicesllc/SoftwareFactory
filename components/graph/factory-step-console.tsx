"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";

import { GraphLaunchControl } from "@/components/graph-launch-control";
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
 * One of the owner's ten factory steps, over the newest lifecycle.
 *
 * The navigation's "02. AI Factory" pages. Each one answers, for its step of
 * the process: what the newest full-lifecycle run recorded there, what it
 * was asked to do, what decision (if any) it is waiting on, and where it
 * goes next. Everything is the same stored data every other console reads —
 * `/api/graphs/runs` plus the run's recorded artifacts — rendered through
 * the same shared readers, so a step page cannot disagree with the lifecycle
 * pages about the same run.
 *
 * "Newest lifecycle" is the deliberate scope: these pages walk *the*
 * process, and the newest full-lifecycle run is where the process stands.
 * Older runs and analysis graphs keep their own surfaces (Pipelines, the
 * Lifecycle pages), and each step links straight into them.
 */

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "none" }
  | { kind: "ready"; run: RunView; artifacts: readonly ArtifactView[] };

export function FactoryStepConsole({ step }: { step: FactoryStep }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const runsResponse = await fetch("/api/graphs/runs?limit=100", { cache: "no-store" });
      if (!runsResponse.ok) {
        setState({ kind: "error" });
        return;
      }
      const runsBody = (await runsResponse.json()) as { runs?: RunView[] };
      // Newest first from the endpoint; the first lifecycle run is the
      // process's current standing.
      const run = (runsBody.runs ?? []).find((candidate) =>
        (candidate as { isLifecycle?: boolean }).isLifecycle === true,
      );
      if (!run) {
        setState({ kind: "none" });
        return;
      }
      const artifactsResponse = await fetch(`/api/graphs/runs/${run.graphRunId}/artifacts`, {
        cache: "no-store",
      });
      // Artifacts failing must not blank the step: the page states the
      // shortfall where the artifacts would have been.
      const artifactsBody = artifactsResponse.ok
        ? ((await artifactsResponse.json()) as { artifacts?: ArtifactView[] })
        : { artifacts: undefined };
      setState({ kind: "ready", run, artifacts: artifactsBody.artifacts ?? [] });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (state.kind === "loading") {
    return (
      <Card className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading the factory step" />
      </Card>
    );
  }
  if (state.kind === "error") {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground">The factory could not be read</h2>
        <p className="mt-2 text-sm text-muted">
          The graph runs did not answer. Nothing is shown rather than a figure that might be wrong.
        </p>
        <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm mt-4">
          Try again
        </button>
      </Card>
    );
  }
  if (state.kind === "none") {
    return (
      <div className="space-y-6">
        <PageHeader title={`${step.number}. ${step.title}`} description={step.summary} />
        <Card className="p-6">
          <h2 className="text-base font-semibold text-foreground">No lifecycle has run yet</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            These pages walk the newest full-lifecycle run through the ten steps, and none is
            recorded yet. Launch one below and every step fills in as the work moves.
          </p>
        </Card>
        <GraphLaunchControl templateKey="full_lifecycle" templateName="Full Lifecycle" />
      </div>
    );
  }

  return <StepView step={step} run={state.run} artifacts={state.artifacts} onReload={load} />;
}

function StepView({
  step,
  run,
  artifacts,
  onReload,
}: {
  step: FactoryStep;
  run: RunView;
  artifacts: readonly ArtifactView[];
  onReload: () => void;
}) {
  const nodes = run.nodes ?? [];
  const { stages } = summariseRunStages(nodes);
  const previous = FACTORY_STEPS.find((candidate) => candidate.number === step.number - 1) ?? null;
  const next = FACTORY_STEPS.find((candidate) => candidate.number === step.number + 1) ?? null;

  /** A step's standing is its worst stage's standing, in lifecycle order. */
  const stepStanding = (candidate: FactoryStep) => {
    const slices = candidate.stages.map((stage) =>
      stages.find((slice) => slice.stage === stage),
    );
    const present = slices.filter((slice) => slice !== undefined);
    if (present.length === 0) return stageStanding(undefined);
    if (present.some((slice) => slice!.failed > 0)) return stageStanding(present.find((slice) => slice!.failed > 0));
    if (present.some((slice) => slice!.active > 0)) return stageStanding(present.find((slice) => slice!.active > 0));
    if (present.every((slice) => slice!.completed === slice!.total)) return stageStanding(present[0]);
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
  const activityTimes = stepNodes
    .flatMap((node) => [node.queued_at, node.node_started_at, node.node_completed_at])
    .filter((value): value is string => typeof value === "string")
    .sort();
  const workedBy = [...new Set(stepNodes.flatMap((node) => {
    const provider = (node as { provider?: string | null }).provider;
    return [node.executor, provider].filter((value): value is string => Boolean(value));
  }))];
  const completedInStep = stepNodes.filter((node) => node.state === "COMPLETED").length;
  const gates = [...new Set(step.stages
    .map((stage) => stageDefinition(stage).gate)
    .filter((gate): gate is "HUMAN" | "AUTOMATIC" => gate !== null))];

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

  return (
    <div className="space-y-5">
      {/* Breadcrumb, as the boards read: product › surface › run › step. */}
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li><Link href="/solutions/factory/requirement" className="hover:text-foreground">AI Factory</Link></li>
          <li aria-hidden="true" className="text-faint">›</li>
          <li><Link href="/solutions/pipelines" className="hover:text-foreground">Runs</Link></li>
          <li aria-hidden="true" className="text-faint">›</li>
          <li>
            <Link
              href={`/solutions/lifecycle/run/${run.graphRunId}/${step.stages[0].toLowerCase()}`}
              className="hover:text-foreground"
            >
              {run.graphRunId.slice(0, 8)}
            </Link>
          </li>
          <li aria-hidden="true" className="text-faint">›</li>
          <li aria-current="page" className="text-foreground">{step.number}. {step.title}</li>
        </ol>
      </nav>

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
          <Link href="/solutions/pipelines" className="btn btn-secondary btn-sm">
            View Run Overview
          </Link>
          {next ? (
            <Link
              href={`/solutions/factory/${next.slug}`}
              className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
            >
              Next Stage <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </div>

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
                  href={`/solutions/factory/${entry.slug}`}
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

      {/* The segmented status bar: only figures something records. */}
      <Card className="p-0">
        <dl className="grid grid-cols-2 divide-[var(--border)] sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
          <StatusCell label="Stage Status">
            <StatusBadge tone={standing.tone} dot={false}>{standingWord(standing)}</StatusBadge>
          </StatusCell>
          <StatusCell label="Nodes Completed">
            <span className="tabular text-sm font-semibold text-foreground">
              {completedInStep} / {stepNodes.length}
            </span>
          </StatusCell>
          <StatusCell label="Started">
            <span className="text-sm text-foreground">{clock(startedTimes[0]) ?? "—"}</span>
          </StatusCell>
          <StatusCell label="Last Activity">
            <span className="text-sm text-foreground">
              {clock(activityTimes[activityTimes.length - 1]) ?? "—"}
            </span>
          </StatusCell>
          <StatusCell label="Worked By">
            <span className="truncate text-sm text-foreground">
              {workedBy.length > 0 ? workedBy.join(", ") : "—"}
            </span>
          </StatusCell>
          <StatusCell label="Gate">
            <span className="flex items-center gap-1 text-sm text-foreground">
              {gates.length === 0 ? "None" : gates.map((gate) =>
                gate === "HUMAN" ? "Human" : "Automatic").join(", ")}
              {openGateNode ? (
                <StatusBadge tone="warning" dot={false}>open</StatusBadge>
              ) : null}
            </span>
          </StatusCell>
        </dl>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {/* The request, verbatim — the boards' intake panel. */}
          <Card className="p-5">
            <h2 className="label">The request</h2>
            <p className="mt-2 text-sm text-foreground">{run.goal}</p>
            <p className="mt-3 text-xs text-faint">
              Newest lifecycle run {run.graphRunId} · {run.state}
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
                    <StageNodes nodes={stageNodes} onDecided={onReload} />
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
                    href={`/solutions/factory/${next.slug}`}
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
              href={`/solutions/factory/${previous.slug}`}
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
              href={`/solutions/factory/${next.slug}`}
              className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
            >
              Next Stage: {next.title}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : <span />}
        </div>
      </Card>
    </div>
  );
}

function StatusCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-1 flex min-h-6 items-center">{children}</dd>
    </div>
  );
}
