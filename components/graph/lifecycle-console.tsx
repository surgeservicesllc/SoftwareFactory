"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck, UserCheck } from "lucide-react";

import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { SDLC_LIFECYCLE, stageDefinition, type SdlcStage } from "@/lib/sdlc/lifecycle";
import { buildStagePortfolio, type SummarisableRun } from "@/lib/sdlc/portfolio";
import { summariseRunStages } from "@/lib/graph/stage-summary";
import { FACTORY_STAGES } from "@/lib/graph/factory-stages";

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

/**
 * `stages` is the board-stage case, and it is additive.
 *
 * The owner's boards number ten steps where the database holds eleven stages,
 * and exactly one of them — REQUIREMENT — is two: the request, and the
 * structured requirement it becomes. A page for that step has to read both, so
 * it passes `stages`; every other caller passes the single `stage` it always
 * did and renders exactly as before.
 */
export function LifecycleConsole(
  { stage, stages, heading }: {
    stage?: SdlcStage;
    stages?: readonly SdlcStage[];
    heading?: { title: string; description: string };
  } = {},
) {
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

  const detail = stages && stages.length > 0 ? stages : stage ? [stage] : [];

  /*
   * On the index, the ten steps are shown before the data loads and whether or
   * not it can be.
   *
   * They are the product's vocabulary, not tenant records: what the ten stages
   * are does not depend on having a session, and hiding the map behind one
   * meant a signed-out visitor met an error card where the explanation should
   * be. The figures underneath still need the read, and still say so.
   */
  const indexFrame = (inner: React.ReactNode) => (
    <div className="space-y-6">
      <PageHeader
        title="Lifecycle"
        description="Every stage a graph moves through, across every run in this workspace."
      />
      <FactorySteps />
      {inner}
    </div>
  );

  /*
   * A board step keeps its own name and purpose in every state.
   *
   * Same rule as the map above: "6. Build — implement the work" is what the
   * step *is*, and it does not become unknown because the run figures could
   * not be read. Without this a signed-out visitor met a bare error card and
   * could not tell which step they had opened.
   */
  const framed = (inner: React.ReactNode) => (
    heading
      ? (
          <div className="space-y-6">
            <PageHeader title={heading.title} description={heading.description} />
            {inner}
          </div>
        )
      : inner
  );

  if (state.kind === "loading") {
    const spinner = (
      <Card className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading the lifecycle" />
      </Card>
    );
    return detail.length === 0 ? indexFrame(spinner) : framed(spinner);
  }
  if (state.kind === "error") {
    const failure = (
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
    // The map still stands; only the figures are missing, and the card says so.
    return detail.length === 0 ? indexFrame(failure) : framed(failure);
  }

  const portfolio = buildStagePortfolio(state.runs);
  if (detail.length === 0) return <StageIndex portfolio={portfolio} />;

  /*
   * One heading, then each stored stage this step covers.
   *
   * Rendering `StageDetail` per stage rather than merging their rows keeps the
   * per-stage truth intact: a run that reached GOAL and never reached PRD says
   * so, which a combined count would hide behind one number.
   */
  return (
    <div className="space-y-6">
      {heading ? <PageHeader title={heading.title} description={heading.description} /> : null}
      {detail.map((entry) => (
        <StageDetail key={entry} stage={entry} runs={state.runs} portfolio={portfolio} />
      ))}
    </div>
  );
}

/**
 * The ten steps, as the owner's boards number them.
 *
 * The stored vocabulary has eleven stages and this has ten, which is not a
 * disagreement: REQUIREMENT is GOAL and PRD together — the request, and the
 * structured requirement it becomes — and the other nine are the same stages
 * under the names the boards use. `FACTORY_STAGES` holds that mapping, so the
 * list below cannot drift from the pages it links to.
 *
 * No counts here on purpose. This is the map; the per-stage figures are in the
 * portfolio underneath, read from real runs, and repeating them in two shapes
 * is how two answers to one question start disagreeing.
 */
function FactorySteps() {
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold text-foreground">The ten steps</h2>
      <p className="mt-1 text-sm text-muted">
        One request moves through these in order. Open a step to see where the work stands.
      </p>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {FACTORY_STAGES.map((step) => (
          <li key={step.slug}>
            <Link
              href={`/solutions/lifecycle/${step.slug}`}
              className="flex h-full flex-col gap-1 rounded-lg border border-line p-3 transition-colors hover:border-[var(--accent-border)] hover:bg-surface-raised"
            >
              <span className="flex items-center gap-2">
                <span className="grid size-5 shrink-0 place-items-center rounded-md bg-surface-raised text-[11px] font-bold tabular text-muted">
                  {step.number}
                </span>
                <span className="text-sm font-semibold text-foreground">{step.name}</span>
              </span>
              <span className="text-xs leading-5 text-muted">{step.purpose}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function StageIndex({ portfolio }: { portfolio: ReturnType<typeof buildStagePortfolio> }) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Lifecycle"
        description="Every stage a graph moves through, across every run in this workspace."
      />

      <FactorySteps />

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

  /*
   * Runs that reached this stage, with just this stage's slice of each.
   * `summariseRunStages` omits stages a run never contained, so an absent
   * slice *is* the filter — no separate emptiness check to fall out of step
   * with it.
   */
  const appearances = runs.flatMap((run) => {
    const slice = summariseRunStages(run.nodes ?? []).stages
      .find((candidate) => candidate.stage === stage);
    return slice ? [{ run, slice }] : [];
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
            {appearances.map(({ run, slice }) => (
              <li key={run.graphRunId} className="flex flex-wrap items-center gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{run.goal ?? run.graphRunId}</p>
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
