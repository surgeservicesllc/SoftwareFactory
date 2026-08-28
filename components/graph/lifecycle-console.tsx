"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck, UserCheck } from "lucide-react";

import { GateDecision } from "@/components/graph/gate-decision";
import { GraphLaunchControl } from "@/components/graph-launch-control";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { SDLC_LIFECYCLE, stageDefinition, type SdlcStage } from "@/lib/sdlc/lifecycle";
import { describeNode, type DetailedNode } from "@/lib/graph/node-detail";
import { buildStagePortfolio, type SummarisableRun } from "@/lib/sdlc/portfolio";
import { summariseRunStages } from "@/lib/graph/stage-summary";

/**
 * The lifecycle, across every run.
 *
 * `/solutions/ai-factory` is the *setup journey* — connect a repository,
 * assign bots, issue a command. This is the different question: of the stages
 * a graph moves through, where does the work actually stand, and which stage
 * do runs keep dying at?
 *
 * The stage list comes from `SDLC_LIFECYCLE` rather than being written out
 * here, so it cannot fall behind the vocabulary. It held eight until DISCOVERY,
 * EVALUATION and DECISION became real capabilities with producers — the exact
 * condition ADR-136 named before the enum was allowed to grow — and these
 * pages picked all three up without a line changing.
 *
 * Every figure comes from `/api/graphs/runs`, the same read the runs panel
 * uses, so this page cannot disagree with the run it links to.
 */

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; runs: SummarisableRun[] };

export function LifecycleConsole({ stage }: { stage?: SdlcStage } = {}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/graphs/runs", { cache: "no-store" });
      if (!response.ok) {
        setState({ kind: "error" });
        return;
      }
      const body = (await response.json()) as { runs?: SummarisableRun[] };
      setState({ kind: "ready", runs: body.runs ?? [] });
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
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading the lifecycle" />
      </Card>
    );
  }
  if (state.kind === "error") {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground">The lifecycle could not be read</h2>
        <p className="mt-2 text-sm text-muted">
          The graph runs did not answer. Nothing is shown rather than a figure that might be wrong.
        </p>
        <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm mt-4">
          Try again
        </button>
      </Card>
    );
  }

  const portfolio = buildStagePortfolio(state.runs);
  return stage
    ? <StageDetail stage={stage} runs={state.runs} portfolio={portfolio} onReload={load} />
    : <StageIndex portfolio={portfolio} runs={state.runs} onReload={load} />;
}

/**
 * The open gate this stage is waiting on, from the newest run that has one.
 *
 * Runs arrive newest-first from the endpoint — the same ordering the
 * portfolio's latest-error pick relies on — so the first match is the gate a
 * person can act on now. Older open gates on retired runs are reachable
 * through the stage page's run list; offering every one of them on the index
 * card would present decisions whose runs already moved on.
 */
function openGateIn(stage: SdlcStage, runs: readonly SummarisableRun[]) {
  for (const run of runs) {
    const node = (run.nodes ?? []).find(
      (candidate) => candidate.lifecycle_stage === stage
        && candidate.gate_state === "OPEN"
        && typeof candidate.gate_id === "string",
    );
    if (node) return { run, node };
  }
  return null;
}

function StageIndex({
  portfolio,
  runs,
  onReload,
}: {
  portfolio: ReturnType<typeof buildStagePortfolio>;
  runs: readonly SummarisableRun[];
  onReload: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Lifecycle"
        description="Every stage a graph moves through, across every run in this workspace. Launch the full lifecycle here, and decide its gates on the stage they hold."
      />

      <GraphLaunchControl templateKey="full_lifecycle" templateName="Full Lifecycle" />

      {portfolio.runsConsidered === 0 ? (
        <Card className="p-6">
          <h2 className="text-base font-semibold text-foreground">No run has been recorded yet</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            These figures come from recorded graph runs. Launch the full lifecycle above — or plan a
            graph from any pipeline template — and its stages will appear here as the work moves.
          </p>
          <Link href="/solutions/pipelines?view=templates" className="btn btn-secondary btn-sm mt-3">
            Open Pipelines
          </Link>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted">
            {portfolio.runsConsidered} run{portfolio.runsConsidered === 1 ? "" : "s"} read.
            {portfolio.weakestStage
              ? ` ${portfolio.weakestStage} has failed in more runs than any other stage.`
              : " No stage has failed in any run."}
            {portfolio.runsUnstaged > 0 ? (
              <span className="text-faint">
                {" "}{portfolio.runsUnstaged} run{portfolio.runsUnstaged === 1 ? "" : "s"} predate the
                stage rule and carry no stage, so they are counted in none of the rates below.
              </span>
            ) : null}
          </p>

          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {portfolio.entries.map((entry, index) => {
              const definition = stageDefinition(entry.stage);
              const held = openGateIn(entry.stage, runs);
              return (
                <li key={entry.stage}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-faint">Stage {index + 1}</p>
                        <Link
                          href={`/solutions/lifecycle/${entry.stage.toLowerCase()}`}
                          className="text-base font-semibold text-foreground hover:text-accent"
                        >
                          {entry.stage}
                        </Link>
                      </div>
                      {entry.runsTouched === 0 ? (
                        <StatusBadge tone="neutral" dot={false}>Never reached</StatusBadge>
                      ) : entry.runsFailed > 0 ? (
                        <StatusBadge tone="danger" dot={false}>
                          {entry.failureRatePercent}% of runs failed here
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="safe" dot={false}>No failures</StatusBadge>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-muted">{definition.produces}</p>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                      <Figure label="Runs" value={entry.runsTouched} />
                      <Figure label="Nodes" value={entry.nodesTotal} />
                      <Figure label="Failed" value={entry.nodesFailed} />
                    </dl>
                    <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-faint">
                      {definition.gate === "HUMAN" ? (
                        <span className="inline-flex items-center gap-1">
                          <UserCheck className="size-3.5" aria-hidden="true" /> Human gate
                        </span>
                      ) : definition.gate === "AUTOMATIC" ? (
                        <span>Automatic gate</span>
                      ) : (
                        <span>No gate</span>
                      )}
                      {definition.requiresAnchor ? (
                        <span className="inline-flex items-center gap-1">
                          <ShieldCheck className="size-3.5" aria-hidden="true" /> Anchor required
                        </span>
                      ) : null}
                    </p>
                    {entry.latestError ? (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--danger)]">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 break-words">{entry.latestError}</span>
                      </p>
                    ) : null}
                    {held ? (
                      /*
                       * The decision, on the card that holds it. Before this,
                       * an open gate was a fact the index reported and the
                       * runs panel acted on — two pages for one question.
                       */
                      <div className="mt-3 rounded-lg border border-[var(--border)] p-2.5 text-xs">
                        <p className="text-muted">
                          Awaiting a decision
                          {held.run.goal
                            ? <> on <span className="min-w-0 break-words text-foreground">{held.run.goal}</span></>
                            : null}
                        </p>
                        <GateDecision node={held.node} onDecided={onReload} />
                      </div>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * The nodes this run has in this stage.
 *
 * The figures above say a stage has four nodes and one failed. This says which
 * four and which one, which is the difference between a dashboard and something
 * a person can act on. Every value is derived by `describeNode` — the same call
 * the graph-runs panel uses — so a node cannot read one way here and another
 * there.
 *
 * Rendered from the run's own `nodes` array, already fetched for the counts.
 * No second request, and nothing to fall out of step with the figures it sits
 * under.
 */
export function StageNodes({
  evidenceArtifactIds,
  nodes,
  onDecided,
}: {
  evidenceArtifactIds?: Readonly<Record<string, string>>;
  nodes: readonly DetailedNode[];
  onDecided: () => void;
}) {
  if (nodes.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2">
      {nodes.map((node) => {
        const detail = describeNode(node);
        return (
          <li key={detail.nodeKey} className="rounded border border-[var(--border)] p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-foreground">{detail.nodeKey}</span>
              <StatusBadge tone={nodeTone(detail.state)} dot={false}>{detail.state}</StatusBadge>
              {node.gate_state === "OPEN" ? (
                // VERIFYING is a state; this is what it means for a person.
                <span className="text-xs text-muted">awaiting a decision</span>
              ) : null}
              {detail.elapsed ? (
                <span className="tabular text-xs text-faint">{detail.elapsed}</span>
              ) : null}
              {detail.artifactTotal > 0 ? (
                <span className="text-xs text-faint">
                  {detail.artifactTotal} artifact{detail.artifactTotal === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            {detail.job ? <p className="mt-1 text-xs text-muted">{detail.job}</p> : null}
            {detail.dependsOn.length > 0 ? (
              <p className="mt-1 text-xs text-faint">Waited for {detail.dependsOn.join(", ")}</p>
            ) : null}
            {detail.stoppedReason ? (
              <p className="mt-1 text-xs text-[var(--danger)]">{detail.stoppedReason}</p>
            ) : null}
            <div className="text-xs">
              <GateDecision
                evidenceArtifactId={evidenceArtifactIds?.[node.node_key]}
                node={node}
                onDecided={onDecided}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A node's execution state as a badge tone. */
function nodeTone(state: string): "safe" | "danger" | "info" | "neutral" {
  if (state === "COMPLETED") return "safe";
  if (state === "FAILED" || state === "CANCELLED") return "danger";
  if (state === "RUNNING" || state === "VERIFYING") return "info";
  return "neutral";
}

function StageDetail({
  stage,
  runs,
  portfolio,
  onReload,
}: {
  stage: SdlcStage;
  runs: readonly SummarisableRun[];
  portfolio: ReturnType<typeof buildStagePortfolio>;
  onReload: () => void;
}) {
  const definition = stageDefinition(stage);
  const entry = portfolio.entries.find((candidate) => candidate.stage === stage)!;
  const index = SDLC_LIFECYCLE.findIndex((candidate) => candidate.stage === stage);
  const previous = index > 0 ? SDLC_LIFECYCLE[index - 1].stage : null;
  const next = index < SDLC_LIFECYCLE.length - 1 ? SDLC_LIFECYCLE[index + 1].stage : null;

  /*
   * Runs that reached this stage, with just this stage's slice of each.
   * `summariseRunStages` omits stages a run never contained, so an absent
   * slice *is* the filter — no separate emptiness check to fall out of step
   * with it.
   */
  const appearances = runs.flatMap((run) => {
    const slice = summariseRunStages(run.nodes ?? []).stages
      .find((candidate) => candidate.stage === stage);
    if (!slice) return [];
    // The same nodes the slice counted, kept so the list below cannot disagree
    // with the figures above it.
    const stageNodes = (run.nodes ?? []).filter((node) => node.lifecycle_stage === stage);
    return [{ run, slice, stageNodes }];
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${index + 1}. ${stage}`}
        description={definition.produces}
        action={
          <Link href="/solutions/lifecycle" className="btn btn-secondary btn-sm">All stages</Link>
        }
      />

      <Card className="p-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure label="Runs reached" value={entry.runsTouched} />
          <Figure label="Nodes" value={entry.nodesTotal} />
          <Figure label="Failed nodes" value={entry.nodesFailed} />
          <Figure
            label="Failure rate"
            value={entry.failureRatePercent === null ? "—" : `${entry.failureRatePercent}%`}
          />
        </dl>
        <p className="mt-4 text-sm text-muted">
          Needs the <strong className="text-foreground">{definition.capability}</strong> capability.
          {definition.gate === "HUMAN"
            ? " Leaving this stage requires a person's decision."
            : definition.gate === "AUTOMATIC"
              ? " Leaving this stage is gated automatically."
              : " This stage advances on its dependencies alone."}
          {definition.requiresAnchor
            ? " Its claim must be backed by an anchor — an observation that cannot be persuaded."
            : ""}
        </p>
        <p className="mt-3 text-xs text-faint">
          {previous ? `Comes after ${previous}.` : "First stage."}{" "}
          {next ? `Hands off to ${next}.` : "Last stage; its output closes the loop."}
        </p>
      </Card>

      <section aria-label={`Runs that reached ${stage}`}>
        <h2 className="label">Runs that reached this stage</h2>
        {appearances.length === 0 ? (
          <Card className="mt-2 p-5">
            <p className="max-w-2xl text-sm text-muted">
              No recorded run has a node in this stage. That is a fact about the runs, not a gap in
              this page — the stage exists and will fill as graphs reach it.
            </p>
          </Card>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {appearances.map(({ run, slice, stageNodes }) => (
              <li key={run.graphRunId} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/solutions/lifecycle/run/${run.graphRunId}/${stage.toLowerCase()}`}
                    className="block truncate text-sm text-foreground hover:text-accent"
                  >
                    {run.goal ?? run.graphRunId}
                  </Link>
                  <p className="text-xs text-faint">
                    {slice.completed} of {slice.total} node{slice.total === 1 ? "" : "s"} completed
                    {slice.failed > 0 ? ` · ${slice.failed} failed` : ""}
                    {slice.active > 0 ? ` · ${slice.active} in flight` : ""}
                  </p>
                </div>
                <StatusBadge
                  tone={
                    slice.failed > 0 ? "danger"
                      : slice.active > 0 ? "info"
                        : slice.completed === slice.total ? "safe"
                          : "neutral"
                  }
                  dot={false}
                >
                  {slice.failed > 0 ? "failed"
                    : slice.active > 0 ? "in flight"
                      : slice.completed === slice.total ? "complete" : "mixed"}
                </StatusBadge>
                </div>
                <StageNodes nodes={stageNodes} onDecided={onReload} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-foreground">{value}</dd>
    </div>
  );
}
