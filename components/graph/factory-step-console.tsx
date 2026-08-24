"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, ShieldCheck, UserCheck } from "lucide-react";

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

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${step.number}. ${step.title}`}
        description={step.summary}
        action={
          <Link href="/solutions/lifecycle" className="btn btn-secondary btn-sm">Lifecycle</Link>
        }
      />

      {/* The ten steps, each a link, the current one marked — the walk. */}
      <nav aria-label="The ten factory steps" className="overflow-x-auto">
        <ol className="flex min-w-max items-center gap-1.5 pb-1">
          {FACTORY_STEPS.map((entry, position) => {
            const entryStanding = stepStanding(entry);
            const current = entry.slug === step.slug;
            return (
              <li key={entry.slug} className="flex items-center gap-1.5">
                {position > 0 ? <span aria-hidden="true" className="text-faint">→</span> : null}
                <Link
                  href={`/solutions/factory/${entry.slug}`}
                  aria-current={current ? "page" : undefined}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition ${
                    current
                      ? "border-[var(--accent-border)] bg-[var(--accent-surface)] text-[var(--accent-text)]"
                      : "border-[var(--border)] text-muted hover:text-foreground"
                  }`}
                >
                  <span className="font-medium">{entry.number}. {entry.title}</span>
                  <StatusBadge tone={entryStanding.tone} dot={false}>{entryStanding.label}</StatusBadge>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* The request this factory is working on, verbatim. */}
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
        const standing = stageStanding(slice);
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
                <StatusBadge tone={standing.tone} dot={false}>{standing.label}</StatusBadge>
                {slice ? (
                  <span className="text-sm text-muted">
                    {slice.completed} of {slice.total} node{slice.total === 1 ? "" : "s"} completed
                    {slice.failed > 0 ? ` · ${slice.failed} failed` : ""}
                    {slice.active > 0 ? ` · ${slice.active} in flight` : ""}
                  </span>
                ) : null}
                <span className="ml-auto flex items-center gap-2 text-xs text-faint">
                  {definition.gate === "HUMAN" ? (
                    <span className="inline-flex items-center gap-1">
                      <UserCheck className="size-3.5" aria-hidden="true" /> Human gate
                    </span>
                  ) : definition.gate === "AUTOMATIC" ? (
                    <span>Automatic gate</span>
                  ) : null}
                  {definition.requiresAnchor ? (
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck className="size-3.5" aria-hidden="true" /> Anchor
                    </span>
                  ) : null}
                  <Link
                    href={`/solutions/lifecycle/run/${run.graphRunId}/${stage.toLowerCase()}`}
                    className="text-muted underline decoration-dotted underline-offset-2 hover:text-foreground"
                  >
                    Stage page
                  </Link>
                </span>
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

            <ActivityLog nodes={stageNodes} />
          </section>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {previous ? (
          <Link
            href={`/solutions/factory/${previous.slug}`}
            className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" /> {previous.number}. {previous.title}
          </Link>
        ) : <span />}
        <Link href="/solutions/pipelines" className="btn btn-secondary btn-sm">
          Run on Pipelines
        </Link>
        {next ? (
          <Link
            href={`/solutions/factory/${next.slug}`}
            className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            {next.number}. {next.title} <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : <span />}
      </div>
    </div>
  );
}
