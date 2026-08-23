"use client";

import { Loader2, Package } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { BlockedState, Card, EmptyState, SectionTitle, StatusBadge } from "@/components/ui";
import { isSdlcStage, stageDefinition, type SdlcStage } from "@/lib/sdlc/lifecycle";
import type { GraphRunSummary } from "@/lib/sdlc/stage-view";

/**
 * Every artifact a run recorded, counted where it was produced.
 *
 * What this page deliberately does not do is show payloads. `graph_artifacts`
 * revokes SELECT from `authenticated` entirely — a run's outputs can contain
 * repository contents and provider responses, and the browser is not the
 * boundary that decides who may read those. So this reports what exists, of
 * which kind, produced by which node of which stage, and says plainly that the
 * contents stay server-side rather than rendering an empty payload column that
 * looks like an artifact with nothing in it.
 *
 * The four kinds are not decoration. RAW is what a node produced, REDUCED is a
 * lossy summary of several, SYNTHESIS is a written conclusion, and ANCHOR is an
 * observation by something that cannot be persuaded — the only kind that
 * satisfies an anchored stage's evidence rule.
 */

type State = "loading" | "signed-out" | "setup" | "error" | "ready";

const KIND_MEANING: Readonly<Record<string, string>> = {
  RAW: "What a node produced, unreduced.",
  REDUCED: "A lossy reduction of several inputs.",
  SYNTHESIS: "A written conclusion drawn from the rest.",
  ANCHOR: "An observation, not a claim — the only kind that satisfies an evidence rule.",
};

function timestamp(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

type Producer = {
  readonly nodeKey: string;
  readonly stage: SdlcStage | null;
  readonly total: number;
  readonly anchors: number;
};

function producersOf(run: GraphRunSummary): readonly Producer[] {
  return run.nodes
    .map((node) => ({
      nodeKey: node.node_key,
      stage: isSdlcStage(node.lifecycle_stage) ? node.lifecycle_stage : null,
      total: node.artifact_count ?? 0,
      anchors: node.anchor_count ?? 0,
    }))
    .filter((producer) => producer.total > 0)
    .sort((left, right) => right.total - left.total);
}

export function ArtifactsConsole() {
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
      if (!response.ok) throw new Error(body.error?.message ?? "Artifacts could not be loaded.");
      setRuns(body.runs ?? []);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Artifacts could not be loaded.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    // Deferred by a timeout rather than called in the effect body: a synchronous
    // setState there cascades a render, and the linter is right to refuse it.
    const kickoff = window.setTimeout(() => void load(), 0);
    // Artifacts appear as nodes finish, so the list refreshes rather than freezing at
    // whatever had been produced when the page opened.
    const interval = window.setInterval(() => void load(), 15_000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [load]);

  if (state === "loading") {
    return (
      <Card className="grid min-h-40 place-items-center p-8">
        <Loader2 className="size-5 animate-spin text-faint" aria-hidden="true" />
        <span className="sr-only">Loading artifacts.</span>
      </Card>
    );
  }

  if (state === "signed-out") {
    return (
      <BlockedState
        title="Sign in to see artifacts"
        description="Artifacts belong to an organization's runs, so this page reads nothing until there is a session."
        href="/auth/sign-in"
        label="Sign in"
        icon={Package}
      />
    );
  }

  if (state === "setup") {
    return (
      <BlockedState
        title="Finish setting up your organization"
        description="This page reads artifacts scoped to an organization, and yours is not ready yet."
        href="/auth/onboarding"
        label="Continue setup"
        icon={Package}
      />
    );
  }

  if (state === "error") {
    return <BlockedState title="Artifacts could not be read" description={message} icon={Package} />;
  }

  const withArtifacts = runs.filter(
    (run) => Object.values(run.artifactCounts ?? {}).some((count) => count > 0),
  );

  if (withArtifacts.length === 0) {
    return (
      <Card className="p-5">
        <EmptyState
          icon={Package}
          title="No artifact has been recorded"
          description={
            runs.length === 0
              ? "Nothing has been launched yet. A run records an artifact each time one of its nodes produces something."
              : `${runs.length} run${runs.length === 1 ? " has" : "s have"} been recorded and none of them produced an artifact, which is what an undispatched run looks like.`
          }
          actionHref="/solutions/ai-factory"
          actionLabel="Start a run"
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {withArtifacts.map((run) => {
        const counts = Object.entries(run.artifactCounts ?? {}).filter(([, total]) => total > 0);
        const producers = producersOf(run);
        return (
          <Card key={run.graphRunId} className="p-5">
            <SectionTitle
              title={run.goal}
              description={`${run.state} · started ${timestamp(run.startedAt)}`}
              action={
                <Link className="btn btn-secondary btn-sm" href="/solutions/runs">
                  Open runs
                </Link>
              }
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {counts.map(([kind, total]) => (
                <StatusBadge key={kind} tone={kind === "ANCHOR" ? "safe" : "neutral"} dot={false}>
                  {total} {kind}
                </StatusBadge>
              ))}
            </div>
            <dl className="mt-3 space-y-1 text-sm">
              {counts.map(([kind]) => (
                <div key={kind} className="flex flex-wrap gap-x-2">
                  <dt className="label">{kind}</dt>
                  <dd className="text-muted">{KIND_MEANING[kind] ?? "An artifact kind this build does not describe."}</dd>
                </div>
              ))}
            </dl>

            {producers.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="label">
                      <th className="py-1.5 pr-4">Produced by</th>
                      <th className="py-1.5 pr-4">Stage</th>
                      <th className="py-1.5 pr-4">Artifacts</th>
                      <th className="py-1.5 pr-4">Anchored</th>
                    </tr>
                  </thead>
                  <tbody>
                    {producers.map((producer) => (
                      <tr key={producer.nodeKey} className="border-t border-line">
                        <td className="py-1.5 pr-4 text-foreground">{producer.nodeKey}</td>
                        <td className="py-1.5 pr-4 text-muted">
                          {producer.stage ? (
                            <Link
                              className="link"
                              href={`/solutions/factory/${stageDefinition(producer.stage).slug}`}
                            >
                              {stageDefinition(producer.stage).number} {stageDefinition(producer.stage).title}
                            </Link>
                          ) : (
                            "Not staged"
                          )}
                        </td>
                        <td className="py-1.5 pr-4 text-foreground">{producer.total}</td>
                        <td className="py-1.5 pr-4 text-foreground">{producer.anchors}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted">
                This run recorded artifacts, but none of them is attributed to a node — which
                happens when an artifact was written without a node run to attach it to.
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
