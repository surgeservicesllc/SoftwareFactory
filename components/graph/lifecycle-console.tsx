"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck, UserCheck } from "lucide-react";

import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { SDLC_LIFECYCLE, stageDefinition, type SdlcStage } from "@/lib/sdlc/lifecycle";
import { buildStagePortfolio, type SummarisableRun } from "@/lib/sdlc/portfolio";
import { summariseRunByStage } from "@/lib/sdlc/run-summary";

/**
 * The lifecycle, across every run.
 *
 * `/solutions/ai-factory` is the *setup journey* — connect a repository,
 * assign bots, issue a command. This is the different question: of the eight
 * stages a graph moves through, where does the work actually stand, and which
 * stage do runs keep dying at?
 *
 * Eight stages, not the ten in the goal document. Three of those ten —
 * DISCOVER, EVALUATE, DECIDE — have nothing that produces them: no capability
 * resolves to one, so a page for each would read live and be permanently
 * empty (ADR-136). Presenting eight that hold work beats ten where three are
 * scaffolding.
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
    ? <StageDetail stage={stage} runs={state.runs} portfolio={portfolio} />
    : <StageIndex portfolio={portfolio} />;
}

function StageIndex({ portfolio }: { portfolio: ReturnType<typeof buildStagePortfolio> }) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Lifecycle"
        description="The eight stages a graph moves through, across every run in this workspace."
      />

      {portfolio.runsConsidered === 0 ? (
        <Card className="p-6">
          <h2 className="text-base font-semibold text-foreground">No run has been recorded yet</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            These figures come from recorded graph runs. Plan one from a pipeline template and its
            stages will appear here as the work moves.
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

function StageDetail({
  stage,
  runs,
  portfolio,
}: {
  stage: SdlcStage;
  runs: readonly SummarisableRun[];
  portfolio: ReturnType<typeof buildStagePortfolio>;
}) {
  const definition = stageDefinition(stage);
  const entry = portfolio.entries.find((candidate) => candidate.stage === stage)!;
  const index = SDLC_LIFECYCLE.findIndex((candidate) => candidate.stage === stage);
  const previous = index > 0 ? SDLC_LIFECYCLE[index - 1].stage : null;
  const next = index < SDLC_LIFECYCLE.length - 1 ? SDLC_LIFECYCLE[index + 1].stage : null;

  // Runs that reached this stage, with just this stage's slice of each.
  const appearances = runs
    .map((run) => ({
      run,
      slice: summariseRunByStage(run.nodes ?? []).stages.find((s) => s.stage === stage)!,
    }))
    .filter((appearance) => appearance.slice.total > 0);

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
            {appearances.map(({ run, slice }) => (
              <li key={run.graphRunId} className="flex flex-wrap items-center gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{run.goal ?? run.graphRunId}</p>
                  {slice.firstError ? (
                    <p className="truncate text-xs text-[var(--danger)]">{slice.firstError}</p>
                  ) : (
                    <p className="text-xs text-faint">
                      {slice.succeeded} of {slice.total} node{slice.total === 1 ? "" : "s"} succeeded
                    </p>
                  )}
                </div>
                <StatusBadge
                  tone={
                    slice.status === "FAILED" ? "danger"
                      : slice.status === "COMPLETE" ? "safe"
                        : "info"
                  }
                  dot={false}
                >
                  {slice.status.replace(/_/g, " ").toLowerCase()}
                </StatusBadge>
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
