"use client";

import { ChevronRight, Loader2, Workflow } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { GateDecision } from "@/components/graph/gate-decision";
import { BlockedState, Card, EmptyState, PageHeader, SectionTitle, StatusBadge } from "@/components/ui";
import type { SdlcStage, StageStatus } from "@/lib/sdlc/lifecycle";
import { nextStage, stageDefinition } from "@/lib/sdlc/lifecycle";
import {
  stagePageView,
  type GraphRunSummary,
  type StageNodeView,
  type StageRunView,
} from "@/lib/sdlc/stage-view";

/**
 * One lifecycle stage, as the runs actually recorded it.
 *
 * Every one of the ten stage pages is this component with a different stage,
 * which is the point: ten hand-written pages would drift into ten different
 * answers to "what does Running mean here", and the consistency the reference
 * asks for is not a style rule — it is what lets someone learn the page once.
 *
 * Nothing is invented. Where the database recorded nothing, the section says so
 * in the words that fit that particular absence: a stage no run has reached is
 * Not Started, a stage with no provider recorded says the work has not been
 * dispatched, and an empty artifact list says the stage produced none rather
 * than showing a zero that looks like a measurement.
 *
 * The derivation lives in `lib/sdlc/stage-view.ts` and is tested there. This
 * file arranges what that returns.
 */

type State = "loading" | "signed-out" | "setup" | "error" | "ready";

function statusTone(status: StageStatus): "safe" | "info" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "Complete":
    case "Passed":
      return "safe";
    case "Running":
      return "info";
    case "Reviewing":
    case "Waiting":
    case "Repairing":
      return "warning";
    case "Failed":
      return "danger";
    default:
      return "neutral";
  }
}

function nodeTone(status: StageNodeView["status"]): "safe" | "info" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "passed":
    case "deployed":
      return "safe";
    case "running":
      return "info";
    case "review":
    case "blocked":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

function timestamp(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function duration(node: StageNodeView): string {
  if (typeof node.latencyMs === "number") return `${(node.latencyMs / 1000).toFixed(1)}s`;
  if (!node.startedAt || !node.completedAt) return "—";
  const elapsed = new Date(node.completedAt).getTime() - new Date(node.startedAt).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 ? `${(elapsed / 1000).toFixed(1)}s` : "—";
}

/** A node, expandable to everything the run recorded about it. */
function NodeRow({ node, onDecided }: { node: StageNodeView; onDecided: () => void }) {
  return (
    <details className="rounded-lg border border-line-strong bg-surface-raised">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <ChevronRight className="size-4 shrink-0 text-faint transition-transform" aria-hidden="true" />
        <span className="font-medium text-foreground">{node.nodeKey}</span>
        <StatusBadge tone={nodeTone(node.status)}>{node.status}</StatusBadge>
        {node.executor ? <span className="text-xs text-muted">{node.executor}</span> : null}
        {node.attempts > 1 ? (
          <span className="text-xs text-muted">
            attempt {node.attempt + 1} of {node.attempts} recorded
          </span>
        ) : null}
      </summary>
      <div className="border-t border-line-strong px-3 py-3 text-sm">
        {node.job ? <p className="text-muted">{node.job}</p> : null}
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="label">Owner</dt>
            <dd className="text-foreground">
              {node.provider
                ? `${node.provider}${node.model ? ` · ${node.model}` : ""}`
                : "Not dispatched — no provider recorded for this node."}
            </dd>
          </div>
          <div>
            <dt className="label">Capability</dt>
            <dd className="text-foreground">{node.capability ?? "—"}</dd>
          </div>
          <div>
            <dt className="label">Depends on</dt>
            <dd className="text-foreground">
              {node.dependsOn.length > 0 ? node.dependsOn.join(", ") : "Nothing in this stage."}
            </dd>
          </div>
          <div>
            <dt className="label">Attempts</dt>
            <dd className="text-foreground">
              {node.attempts} recorded{node.maxAttempts ? ` of ${node.maxAttempts} allowed` : ""}
            </dd>
          </div>
          <div>
            <dt className="label">Started</dt>
            <dd className="text-foreground">{timestamp(node.startedAt)}</dd>
          </div>
          <div>
            <dt className="label">Finished</dt>
            <dd className="text-foreground">{timestamp(node.completedAt)}</dd>
          </div>
          <div>
            <dt className="label">Took</dt>
            <dd className="text-foreground">{duration(node)}</dd>
          </div>
          <div>
            <dt className="label">Artifacts</dt>
            <dd className="text-foreground">
              {node.artifactCount} recorded
              {node.anchorCount > 0
                ? `, ${node.anchorCount} of them anchored`
                : ", none anchored"}
            </dd>
          </div>
        </dl>
        {node.error ? (
          <p className="mt-3 text-[var(--danger)]">
            {/* The worker's own sentence. Rewording it here would replace the
                only text that says what happened. */}
            {node.error}
          </p>
        ) : null}
        {node.blockedReason ? <p className="mt-3 text-muted">{node.blockedReason}</p> : null}
        {node.gate ? (
          <div className="mt-3">
            <p className="text-muted">
              {node.gate.kind === "HUMAN" ? "Human gate" : "Automatic gate"} · {node.gate.state}
              {node.gate.reason ? ` · ${node.gate.reason}` : ""}
            </p>
            <GateDecision
              gateId={node.gate.id}
              gateKind={node.gate.kind}
              gateState={node.gate.state}
              anchorCount={node.gate.anchorCount}
              onDecided={onDecided}
            />
          </div>
        ) : null}
      </div>
    </details>
  );
}

/** The stage's own graph, drawn as the bands that can run at the same time. */
function ExecutionGraph({ run }: { run: StageRunView }) {
  const bands = new Map<number, StageNodeView[]>();
  for (const node of run.nodes) {
    bands.set(node.depth, [...(bands.get(node.depth) ?? []), node]);
  }
  const ordered = [...bands.entries()].sort((left, right) => left[0] - right[0]);

  return (
    <ol aria-label="Execution graph" className="space-y-2">
      {ordered.map(([depth, nodes]) => (
        <li key={depth} className="flex flex-wrap items-center gap-2">
          <span className="label w-20 shrink-0">
            {nodes.length > 1 ? `${nodes.length} in parallel` : "then"}
          </span>
          {nodes.map((node) => (
            <span
              key={node.nodeKey}
              className="rounded-md border border-line-strong bg-surface-raised px-2 py-1 text-xs"
            >
              {node.nodeKey}
              <span className="ml-1.5 text-faint">{node.status}</span>
            </span>
          ))}
        </li>
      ))}
    </ol>
  );
}

export function StageConsole({ stage }: { readonly stage: SdlcStage }) {
  const definition = stageDefinition(stage);
  const [state, setState] = useState<State>("loading");
  const [runs, setRuns] = useState<GraphRunSummary[]>([]);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/graphs/runs?limit=50", { cache: "no-store" });
      if (response.status === 401) {
        setState("signed-out");
        return;
      }
      if (response.status === 409) {
        setState("setup");
        return;
      }
      const body = (await response.json()) as {
        runs?: GraphRunSummary[];
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Runs could not be loaded.");
      setRuns(body.runs ?? []);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Runs could not be loaded.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    // Deferred by a timeout rather than called in the effect body: a synchronous
    // setState there cascades a render, and the linter is right to refuse it.
    const kickoff = window.setTimeout(() => void load(), 0);
    // A stage advances while someone is looking at it, so the page keeps up rather than
    // showing whatever was true when it opened.
    const interval = window.setInterval(() => void load(), 15_000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [load]);

  const heading = `${definition.number} ${definition.title}`;
  const following = nextStage(stage);

  if (state === "loading") {
    return (
      <>
        <PageHeader title={heading} description={definition.purpose} />
        <Card className="grid min-h-40 place-items-center p-8">
          <Loader2 className="size-5 animate-spin text-faint" aria-hidden="true" />
          <span className="sr-only">Loading this stage.</span>
        </Card>
      </>
    );
  }

  if (state === "signed-out") {
    return (
      <>
        <PageHeader title={heading} description={definition.purpose} />
        <BlockedState
          title="Sign in to see this stage"
          description="Lifecycle runs belong to an organization, so this page reads nothing until there is a session."
          href="/auth/sign-in"
          label="Sign in"
          icon={Workflow}
        />
      </>
    );
  }

  if (state === "setup") {
    return (
      <>
        <PageHeader title={heading} description={definition.purpose} />
        <BlockedState
          title="Finish setting up your organization"
          description="This page reads runs scoped to an organization, and yours is not ready yet."
          href="/auth/onboarding"
          label="Continue setup"
          icon={Workflow}
        />
      </>
    );
  }

  if (state === "error") {
    return (
      <>
        <PageHeader title={heading} description={definition.purpose} />
        <BlockedState title="This stage could not be read" description={message} icon={Workflow} />
      </>
    );
  }

  const view = stagePageView(stage, runs);
  const run = view.current;

  return (
    <>
      <PageHeader
        title={heading}
        description={definition.purpose}
        action={<StatusBadge tone={statusTone(view.status)}>{view.status}</StatusBadge>}
      />

      <div className="space-y-4">
        <Card className="p-5">
          <SectionTitle
            title="What this stage produces"
            description={definition.produces}
          />
          <p className="mt-3 text-sm text-muted">
            It hands the next stage a <strong className="text-foreground">{definition.artifact}</strong>
            {following
              ? <> , which is what <Link className="link" href={`/solutions/factory/${stageDefinition(following).slug}`}>{stageDefinition(following).number} {stageDefinition(following).title}</Link> reads.</>
              : <> . It is the last stage of a pass; what it finds becomes the next request.</>}
          </p>
          <p className="mt-2 text-sm text-muted">
            {definition.gate === null
              ? "No gate guards this stage; it advances on its dependencies alone."
              : definition.gate === "HUMAN"
                ? "A person decides before this stage may be left."
                : "An automatic gate decides against the evidence recorded, and refuses with none."}
            {definition.requiresAnchor
              ? " Its claim must be backed by an observation, not by a model's assurance."
              : ""}
          </p>
        </Card>

        {run === null ? (
          <Card className="p-5">
            <EmptyState
              icon={Workflow}
              title="No run has reached this stage"
              description={
                runs.length === 0
                  ? "Nothing has been launched yet. Start a run and it will appear here as it moves."
                  : "Runs have been recorded, but none of them planned this stage. A template that does not stage its nodes never enters the lifecycle."
              }
              actionHref="/solutions/ai-factory"
              actionLabel="Start a run"
            />
          </Card>
        ) : (
          <>
            <Card className="p-5">
              <SectionTitle
                title="Current run"
                description={run.goal}
                action={
                  <Link className="btn btn-secondary btn-sm" href="/solutions/runs">
                    All runs
                  </Link>
                }
              />
              <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="label">Run state</dt>
                  <dd className="text-foreground">{run.runState}</dd>
                </div>
                <div>
                  <dt className="label">Progress in this stage</dt>
                  <dd className="text-foreground">
                    {run.progress.done} of {run.progress.total} nodes finished
                  </dd>
                </div>
                <div>
                  <dt className="label">Running at once</dt>
                  <dd className="text-foreground">
                    {run.parallelism === 1 ? "One at a time" : `Up to ${run.parallelism} in parallel`}
                  </dd>
                </div>
                <div>
                  <dt className="label">Iteration</dt>
                  <dd className="text-foreground">
                    {run.iteration} of {run.maxIterations}
                  </dd>
                </div>
                <div>
                  <dt className="label">Started</dt>
                  <dd className="text-foreground">{timestamp(run.startedAt)}</dd>
                </div>
                <div>
                  <dt className="label">Finished</dt>
                  <dd className="text-foreground">{timestamp(run.completedAt)}</dd>
                </div>
                <div>
                  <dt className="label">Assigned agents</dt>
                  <dd className="text-foreground">
                    {run.agents.length === 0
                      ? "None — no node in this stage has been dispatched to a provider."
                      : run.agents
                        .map((agent) => `${agent.provider}${agent.model ? ` · ${agent.model}` : ""}`)
                        .join(", ")}
                  </dd>
                </div>
                <div>
                  <dt className="label">Evidence</dt>
                  <dd className="text-foreground">
                    {run.anchorCount === 0
                      ? "No anchored observation recorded"
                      : `${run.anchorCount} anchored observation${run.anchorCount === 1 ? "" : "s"}`}
                  </dd>
                </div>
              </dl>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <SectionTitle
                  title="Input from the previous stage"
                  description={
                    run.input
                      ? `A ${run.input.artifact} from ${run.input.number} ${run.input.title}`
                      : "This is the first stage; its input is the request itself."
                  }
                />
                {run.input ? (
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {run.input.nodes.length === 0 ? (
                      <li className="text-muted">
                        {run.input.title} has no node in this run, so nothing was handed forward.
                      </li>
                    ) : (
                      run.input.nodes.map((node) => (
                        <li key={node.nodeKey} className="flex items-center gap-2">
                          <StatusBadge tone={nodeTone(node.status)} dot={false}>
                            {node.status}
                          </StatusBadge>
                          <span className="text-foreground">{node.nodeKey}</span>
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
                {run.input ? (
                  <Link className="link mt-3 inline-block text-sm" href={`/solutions/factory/${run.input.slug}`}>
                    Open {run.input.title}
                  </Link>
                ) : null}
              </Card>

              <Card className="p-5">
                <SectionTitle
                  title="Output and handoff"
                  description={
                    run.output
                      ? `This stage's ${definition.artifact} is what ${run.output.title} works from.`
                      : `This stage's ${definition.artifact} closes the pass.`
                  }
                />
                <p className="mt-3 text-sm text-muted">
                  {run.artifactCount === 0
                    ? "No artifact has been recorded for this stage yet."
                    : `${run.artifactCount} artifact${run.artifactCount === 1 ? "" : "s"} recorded, `
                      + `${run.anchorCount} anchored.`}
                </p>
                {run.output ? (
                  <Link className="link mt-3 inline-block text-sm" href={`/solutions/factory/${run.output.slug}`}>
                    Open {run.output.title}
                  </Link>
                ) : null}
              </Card>
            </div>

            <Card className="p-5">
              <SectionTitle
                title="Execution graph"
                description="Each row runs after the one above it; everything in a row can run at the same time."
              />
              <div className="mt-4 overflow-x-auto">
                <ExecutionGraph run={run} />
              </div>
            </Card>

            <Card className="p-5">
              <SectionTitle
                title="Tasks"
                description="Open one for its owner, dependencies, attempts, timing and artifacts."
              />
              <ul aria-label="Tasks" className="mt-4 space-y-2">
                {run.nodes.map((node) => (
                  <li key={node.nodeKey}>
                    <NodeRow node={node} onDecided={() => void load()} />
                  </li>
                ))}
              </ul>
            </Card>

            {run.issues.length > 0 ? (
              <Card className="p-5">
                <SectionTitle
                  title="Issues"
                  description="What the run recorded, in its own words."
                />
                <ul aria-label="Issues" className="mt-3 space-y-2 text-sm">
                  {run.issues.map((issue, index) => (
                    <li key={`${issue.nodeKey}-${index}`}>
                      <span className="font-medium text-foreground">{issue.nodeKey}</span>
                      <span className="text-muted"> — {issue.detail}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <Card className="p-5">
              <SectionTitle
                title="Dependencies"
                description="Every edge into or out of this stage, with the reason it exists."
              />
              {run.dependencies.length === 0 ? (
                <p className="mt-3 text-sm text-muted">
                  This run recorded no edges touching this stage.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="label">
                        <th className="py-1.5 pr-4">From</th>
                        <th className="py-1.5 pr-4">To</th>
                        <th className="py-1.5 pr-4">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.dependencies.map((edge) => (
                        <tr
                          key={`${edge.from_node_key}->${edge.to_node_key}`}
                          className="border-t border-line"
                        >
                          <td className="py-1.5 pr-4 text-foreground">{edge.from_node_key}</td>
                          <td className="py-1.5 pr-4 text-foreground">
                            {edge.to_node_key}
                            {edge.is_feedback ? (
                              <span className="ml-2 text-xs text-muted">feedback</span>
                            ) : null}
                          </td>
                          <td className="py-1.5 pr-4 text-muted">{edge.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {view.earlier.length > 0 ? (
              <Card className="p-5">
                <SectionTitle
                  title="Earlier runs through this stage"
                  description={`${view.earlier.length} other run${view.earlier.length === 1 ? "" : "s"} recorded here.`}
                />
                <ul className="mt-3 space-y-2 text-sm">
                  {view.earlier.map((earlier) => (
                    <li key={earlier.graphRunId} className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={statusTone(earlier.status)} dot={false}>
                        {earlier.status}
                      </StatusBadge>
                      <span className="text-foreground">{earlier.goal}</span>
                      <span className="text-muted">{timestamp(earlier.startedAt)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
