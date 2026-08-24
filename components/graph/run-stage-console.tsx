"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, ShieldCheck, UserCheck } from "lucide-react";

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
import { SDLC_LIFECYCLE, stageDefinition, type SdlcStage } from "@/lib/sdlc/lifecycle";

/**
 * One run, one stage — the owner's step page.
 *
 * The design boards show a per-run stage view: the request at the top, the
 * ten-step strip across it, what the stage produced, and the decision where
 * the stage holds one. Everything here is a stored fact read through the same
 * projections the rest of the console uses — `/api/graphs/runs` for the run
 * and its nodes, plus the run's recorded artifacts with their payloads. The
 * boards' invented figures (confidence percentages, estimated completion) are
 * deliberately absent: nothing computes them, so nothing shows them.
 *
 * The breakdown cards are the recorded stage packages themselves. A DECISION
 * stage renders the decision package the node actually recorded — five paths
 * weighed, the chosen one, the plan; an EVALUATE stage renders the scored
 * ranking. A payload no schema recognises is shown verbatim as JSON rather
 * than paraphrased, because a summary the browser invents is a summary
 * nobody audited.
 */

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "missing" }
  | { kind: "ready"; run: RunView; artifacts: readonly ArtifactView[] };

export function RunStageConsole({
  graphRunId,
  stage,
}: {
  graphRunId: string;
  stage: SdlcStage;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const [runsResponse, artifactsResponse] = await Promise.all([
        fetch("/api/graphs/runs?limit=100", { cache: "no-store" }),
        fetch(`/api/graphs/runs/${graphRunId}/artifacts`, { cache: "no-store" }),
      ]);
      if (!runsResponse.ok) {
        setState({ kind: "error" });
        return;
      }
      const runsBody = (await runsResponse.json()) as { runs?: RunView[] };
      const run = (runsBody.runs ?? []).find((candidate) => candidate.graphRunId === graphRunId);
      if (!run) {
        setState({ kind: "missing" });
        return;
      }
      // Artifacts failing must not blank the run: the page states the
      // shortfall where the artifacts would have been.
      const artifactsBody = artifactsResponse.ok
        ? ((await artifactsResponse.json()) as { artifacts?: ArtifactView[] })
        : { artifacts: undefined };
      setState({ kind: "ready", run, artifacts: artifactsBody.artifacts ?? [] });
    } catch {
      setState({ kind: "error" });
    }
  }, [graphRunId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (state.kind === "loading") {
    return (
      <Card className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading the run stage" />
      </Card>
    );
  }
  if (state.kind === "error") {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground">The run could not be read</h2>
        <p className="mt-2 text-sm text-muted">
          The graph runs did not answer. Nothing is shown rather than a figure that might be wrong.
        </p>
        <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm mt-4">
          Try again
        </button>
      </Card>
    );
  }
  if (state.kind === "missing") {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground">This run is not in the newest hundred</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          The runs read returns the organization&apos;s hundred most recent graph runs, and this id is
          not among them — an older run, or one recorded for a different workspace. The Pipelines
          page lists the runs this workspace can see.
        </p>
        <Link href="/solutions/pipelines" className="btn btn-secondary btn-sm mt-4">
          Open Pipelines
        </Link>
      </Card>
    );
  }

  return <StageView stage={stage} run={state.run} artifacts={state.artifacts} onReload={load} />;
}

function StageView({
  stage,
  run,
  artifacts,
  onReload,
}: {
  stage: SdlcStage;
  run: RunView;
  artifacts: readonly ArtifactView[];
  onReload: () => void;
}) {
  const definition = stageDefinition(stage);
  const index = SDLC_LIFECYCLE.findIndex((candidate) => candidate.stage === stage);
  const previous = index > 0 ? SDLC_LIFECYCLE[index - 1].stage : null;
  const next = index < SDLC_LIFECYCLE.length - 1 ? SDLC_LIFECYCLE[index + 1].stage : null;

  const nodes = run.nodes ?? [];
  const { stages } = summariseRunStages(nodes);
  const slice = stages.find((candidate) => candidate.stage === stage);
  const stageNodes = nodes.filter((node) => node.lifecycle_stage === stage);
  const stageNodeKeys = new Set(stageNodes.map((node) => node.node_key));
  const stageArtifacts = artifacts.filter(
    (artifact) => artifact.nodeKey !== null && stageNodeKeys.has(artifact.nodeKey),
  );
  const stageVerifications = (run.verifications ?? []).filter(
    (verification) => stageNodeKeys.has(verification.subject_node_key),
  );

  const startedTimes = stageNodes
    .map((node) => node.node_started_at)
    .filter((value): value is string => typeof value === "string")
    .sort();
  const completedTimes = stageNodes
    .map((node) => node.node_completed_at)
    .filter((value): value is string => typeof value === "string")
    .sort();
  const executors = [...new Set(stageNodes.map((node) => node.executor).filter(Boolean))];
  const providers = [...new Set(stageNodes.map((node) => (node as { provider?: string | null }).provider).filter(Boolean))];
  const standing = stageStanding(slice);

  const runHref = (target: SdlcStage) =>
    `/solutions/lifecycle/run/${run.graphRunId}/${target.toLowerCase()}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${index + 1}. ${stage}`}
        description={definition.produces}
        action={
          <Link href="/solutions/lifecycle" className="btn btn-secondary btn-sm">All stages</Link>
        }
      />

      {/* The strip from the boards: every stage of this run, in order, each a
          link — the reader walks the process without leaving it. */}
      <nav aria-label="This run's stages" className="overflow-x-auto">
        <ol className="flex min-w-max items-center gap-1.5 pb-1">
          {SDLC_LIFECYCLE.map((entry, position) => {
            const entrySlice = stages.find((candidate) => candidate.stage === entry.stage);
            const entryStanding = stageStanding(entrySlice);
            const current = entry.stage === stage;
            return (
              <li key={entry.stage} className="flex items-center gap-1.5">
                {position > 0 ? <span aria-hidden="true" className="text-faint">→</span> : null}
                <Link
                  href={runHref(entry.stage)}
                  aria-current={current ? "page" : undefined}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition ${
                    current
                      ? "border-[var(--accent-border)] bg-[var(--accent-surface)] text-[var(--accent-text)]"
                      : "border-[var(--border)] text-muted hover:text-foreground"
                  }`}
                >
                  <span className="font-medium">{position + 1}. {entry.stage}</span>
                  {entrySlice ? (
                    <span className="tabular">{entrySlice.completed}/{entrySlice.total}</span>
                  ) : null}
                  <StatusBadge tone={entryStanding.tone} dot={false}>{entryStanding.label}</StatusBadge>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* The request, verbatim — the boards' intake column. */}
      <Card className="p-5">
        <h2 className="label">The request</h2>
        <p className="mt-2 text-sm text-foreground">{run.goal}</p>
        <p className="mt-3 text-xs text-faint">
          Run {run.graphRunId} · {run.state}
          {typeof run.iteration === "number" && typeof run.maxIterations === "number"
            ? ` · chance ${run.iteration} of ${run.maxIterations}`
            : ""}
          {run.startedAt ? ` · started ${clock(run.startedAt)}` : ""}
          {run.completedAt ? ` · closed ${clock(run.completedAt)}` : ""}
        </p>
        {stageNodes.some((node) => node.job) ? (
          <div className="mt-4">
            <h3 className="label">What this stage was asked to do</h3>
            <ul className="mt-2 space-y-1.5">
              {stageNodes.filter((node) => node.job).map((node) => (
                <li key={node.node_key} className="text-sm text-muted">
                  <span className="font-medium text-foreground">{node.node_key}</span>
                  {" — "}{node.job}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {/* The stage's standing, from its own counts and clocks. */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={standing.tone} dot={false}>{standing.label}</StatusBadge>
          {slice ? (
            <span className="text-sm text-muted">
              {slice.completed} of {slice.total} node{slice.total === 1 ? "" : "s"} completed
              {slice.failed > 0 ? ` · ${slice.failed} failed` : ""}
              {slice.active > 0 ? ` · ${slice.active} in flight` : ""}
              {slice.skipped > 0 ? ` · ${slice.skipped} skipped` : ""}
            </span>
          ) : (
            <span className="text-sm text-muted">This run has no node in this stage.</span>
          )}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-faint">First node started</dt>
            <dd className="mt-0.5 text-foreground">{clock(startedTimes[0]) ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Last node finished</dt>
            <dd className="mt-0.5 text-foreground">
              {clock(completedTimes[completedTimes.length - 1]) ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Worked by</dt>
            <dd className="mt-0.5 text-foreground">
              {executors.length > 0 ? executors.join(", ") : "—"}
              {providers.length > 0 ? ` (${providers.join(", ")})` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Gate</dt>
            <dd className="mt-0.5 flex items-center gap-1 text-foreground">
              {definition.gate === "HUMAN" ? (
                <><UserCheck className="size-3.5" aria-hidden="true" /> Human</>
              ) : definition.gate === "AUTOMATIC" ? (
                "Automatic"
              ) : (
                "None"
              )}
              {definition.requiresAnchor ? (
                <ShieldCheck className="size-3.5 text-muted" aria-hidden="true" />
              ) : null}
            </dd>
          </div>
        </dl>
      </Card>

      {stage === "DISCOVERY" ? <DiscoverySources artifacts={stageArtifacts} /> : null}

      {/* What the stage recorded — the boards' artifacts and breakdown,
          rendered from the stored payloads themselves. */}
      <section aria-label={`What ${stage} recorded`}>
        <h2 className="label">What this stage recorded</h2>
        {stageArtifacts.length === 0 ? (
          <Card className="mt-2 p-5">
            <p className="text-sm text-muted">
              No artifact is recorded for this stage&apos;s nodes in this run. A stage that has not
              run yet has nothing to show; a completed stage with no artifact would be worth
              questioning on the Pipelines page.
            </p>
          </Card>
        ) : (
          <ul className="mt-2 space-y-3">
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
        )}
        {stageVerifications.length > 0 ? (
          <Card className="mt-3 p-4">
            <h3 className="label">Verifications on this stage&apos;s work</h3>
            <ul className="mt-2 space-y-1.5">
              {stageVerifications.map((verification, position) => (
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
      </section>

      {/* The nodes and, when one holds an open gate, the decision. */}
      <section aria-label={`${stage} nodes in this run`}>
        <h2 className="label">Nodes</h2>
        {stageNodes.length === 0 ? (
          <Card className="mt-2 p-5">
            <p className="text-sm text-muted">This run planned no node in this stage.</p>
          </Card>
        ) : (
          <StageNodes nodes={stageNodes} onDecided={onReload} />
        )}
      </section>

      {/* Real clocks only — the boards' activity column without invention. */}
      <ActivityLog nodes={stageNodes} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        {previous ? (
          <Link href={runHref(previous)} className="btn btn-secondary btn-sm inline-flex items-center gap-1.5">
            <ArrowLeft className="size-3.5" aria-hidden="true" /> {previous}
          </Link>
        ) : <span />}
        <Link href="/solutions/pipelines" className="btn btn-secondary btn-sm">
          Run on Pipelines
        </Link>
        {next ? (
          <Link href={runHref(next)} className="btn btn-secondary btn-sm inline-flex items-center gap-1.5">
            {next} <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : <span />}
      </div>
    </div>
  );
}

