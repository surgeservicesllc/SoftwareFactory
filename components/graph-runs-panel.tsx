"use client";

import { Loader2, Workflow } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { BlockedState, Card, SectionTitle, StatusBadge } from "@/components/ui";
import { StageRail } from "@/components/graph/stage-rail";
import { summariseRunByStage } from "@/lib/sdlc/run-summary";

/**
 * The graph runs the executor worker has recorded, straight from the
 * database's own rows.
 *
 * Every value here is a stored fact — run states, node states, providers,
 * latencies, error messages, artifact counts — read through
 * `list_graph_runs` and rendered without derivation. A run that lost an
 * input says PARTIAL because the database says PARTIAL, and a node's error
 * is the error the worker recorded, verbatim.
 */

type GraphRunNode = {
  node_key: string;
  executor: string;
  capability: string;
  state: string;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  error_message: string | null;
  /*
   * Optional throughout: this is JSON off the network, and a response from a
   * deployment that predates the lifecycle must render a run rather than
   * blanking the view on a missing key — the same reason `verifications` is
   * optional below.
   */
  lifecycle_stage?: string | null;
  gate_kind?: string | null;
  gate_id?: string | null;
  gate_state?: string | null;
  gate_anchor_count?: number | null;
  gate_reason?: string | null;
};

type GraphVerification = {
  subject_node_key: string;
  lens: string;
  verdict: string;
  evidence: unknown;
  verifier_provider: string | null;
  shared_worker_context: boolean;
};

type GraphRunView = {
  graphRunId: string;
  graphId: string;
  goal: string;
  topology: string;
  state: string;
  hadPartialInput: boolean;
  startedAt: string | null;
  completedAt: string | null;
  nodes: GraphRunNode[];
  artifactCounts: Record<string, number>;
  // Optional on purpose: this is JSON off the network, and a response from
  // a deployment that predates verifications must render a run rather than
  // blanking the whole view on a missing key.
  verifications?: GraphVerification[];
  isLifecycle?: boolean;
  iteration?: number;
  maxIterations?: number;
};

type State = "loading" | "signed-out" | "setup" | "error" | "ready";

function runTone(state: string): "safe" | "info" | "warning" | "danger" | "neutral" {
  switch (state) {
    case "COMPLETED":
      return "safe";
    case "RUNNING":
      return "info";
    case "PARTIAL":
    case "BUDGET_STOPPED":
      return "warning";
    case "FAILED":
      return "danger";
    default:
      return "neutral";
  }
}

function nodeTone(state: string): "safe" | "info" | "warning" | "danger" | "neutral" {
  switch (state) {
    case "COMPLETED":
      return "safe";
    case "RUNNING":
    case "VERIFYING":
      return "info";
    case "FAILED":
      return "danger";
    case "SKIPPED":
      return "warning";
    default:
      return "neutral";
  }
}

function verdictTone(verdict: string): "safe" | "info" | "warning" | "danger" | "neutral" {
  switch (verdict) {
    case "PASS":
      return "safe";
    case "WARN":
      return "warning";
    case "REJECT":
    case "BLOCK":
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

/**
 * The decision, offered where the gate is.
 *
 * Deliberately inline in the node row rather than gathered into a separate
 * "approvals" panel: a gate is a fact about one stage, and separating the
 * question from the work it guards is how someone approves a thing they have
 * not looked at.
 *
 * The button says what the click does rather than what the state is, and the
 * outcome is whatever the route reports — including its refusals, which carry
 * the database's own sentence about why.
 */
function GateDecision({
  node,
  onDecided,
}: {
  readonly node: GraphRunNode;
  readonly onDecided: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const decide = useCallback(
    async (approved: boolean) => {
      if (!node.gate_id) return;
      setBusy(true);
      setNotice("");
      try {
        const response = await fetch(`/api/graph-gates/${node.gate_id}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approved }),
        });
        const body = (await response.json()) as {
          error?: { message?: string };
          note?: string;
        };
        if (!response.ok) {
          // The route passes the database's sentence through; showing a
          // friendlier one here would discard the only text that says why.
          setNotice(body.error?.message ?? "The decision could not be recorded.");
          return;
        }
        setNotice(body.note ?? "Recorded.");
        onDecided();
      } catch {
        setNotice("The request did not reach the server.");
      } finally {
        setBusy(false);
      }
    },
    [node.gate_id, onDecided],
  );

  if (!node.gate_id || node.gate_state !== "OPEN") return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void decide(true)}
        className="btn btn-secondary btn-sm"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void decide(false)}
        className="btn btn-secondary btn-sm"
      >
        Reject
      </button>
      <span className="text-muted">
        {node.gate_kind === "HUMAN" ? "Human gate" : "Automatic gate"}
        {typeof node.gate_anchor_count === "number"
          ? ` · ${node.gate_anchor_count} anchor${node.gate_anchor_count === 1 ? "" : "s"}`
          : ""}
      </span>
      {notice ? (
        <span role="status" className="basis-full text-muted">
          {notice}
        </span>
      ) : null}
    </div>
  );
}

export function GraphRunsPanel() {
  const [state, setState] = useState<State>("loading");
  const [runs, setRuns] = useState<GraphRunView[]>([]);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/graphs/runs", { cache: "no-store" });
      if (response.status === 401) {
        setState("signed-out");
        return;
      }
      if (response.status === 409) {
        setState("setup");
        return;
      }
      const body = (await response.json()) as { runs?: GraphRunView[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Graph runs could not be loaded.");
      setRuns(body.runs ?? []);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Graph runs could not be loaded.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    // The worker advances runs on its own cadence; this view keeps up.
    const interval = window.setInterval(() => void load(), 15_000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [load]);

  if (state === "loading") {
    return (
      <Card className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-accent" aria-label="Loading graph runs" />
      </Card>
    );
  }
  if (state === "signed-out") {
    return <BlockedState icon={Workflow} title="Sign in to see graph runs" description="Graph runs belong to your organization." href="/auth/sign-in?next=/solutions/pipelines?view=graphs" label="Sign in" />;
  }
  if (state === "setup") {
    return <BlockedState icon={Workflow} title="Finish setting up" description="Create or choose a workspace first." href="/solutions/connections" label="Open connections" />;
  }
  if (state === "error") {
    return <BlockedState icon={Workflow} title="Graph runs are unavailable" description={message || "Graph runs could not be loaded."} href="/solutions/pipelines" label="Back to pipelines" />;
  }

  if (!runs.length) {
    return (
      <Card className="p-5 sm:p-6">
        <SectionTitle
          title="No graph runs yet"
          description="Use a template to record a graph. The executor worker claims recorded graphs on its next dispatch and every node transition lands here."
        />
        <Link href="/solutions/pipelines?view=templates" className="btn btn-primary btn-sm mt-4">
          <Workflow className="size-4" aria-hidden="true" />
          Open templates
        </Link>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-[var(--border)]">
        {runs.map((run) => {
          const byState = new Map<string, number>();
          for (const node of run.nodes ?? []) {
            byState.set(node.state, (byState.get(node.state) ?? 0) + 1);
          }
          const artifactTotal = Object.values(run.artifactCounts ?? {}).reduce((sum, count) => sum + count, 0);
          const verifications = run.verifications ?? [];
          return (
            <li key={run.graphRunId} className="p-4 sm:p-5">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                  <StatusBadge tone={runTone(run.state)}>{run.state}</StatusBadge>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{run.goal}</span>
                  <span className="text-xs text-faint">{run.topology}</span>
                  <span className="text-xs text-muted">
                    {[...byState.entries()].map(([nodeState, count]) => `${count} ${nodeState.toLowerCase()}`).join(", ")}
                  </span>
                </summary>
                <div className="mt-3 space-y-3">
                  <p className="text-xs text-faint">
                    Started {timestamp(run.startedAt)} · Finished {timestamp(run.completedAt)}
                    {run.hadPartialInput ? " · Inputs were incomplete — this is a partial view." : ""}
                    {artifactTotal > 0
                      ? ` · ${artifactTotal} artifact${artifactTotal === 1 ? "" : "s"} (${Object.entries(run.artifactCounts).map(([kind, count]) => `${count} ${kind}`).join(", ")})`
                      : " · No artifacts recorded."}
                  </p>
                  {verifications.length > 0 ? (
                    <div className="rounded-lg border border-line p-3">
                      <p className="text-xs font-medium text-foreground">Verifications</p>
                      <ul className="mt-2 space-y-1.5">
                        {verifications.map((verification, index) => (
                          <li key={`${verification.subject_node_key}-${index}`} className="flex flex-wrap items-center gap-2 text-xs">
                            <StatusBadge tone={verdictTone(verification.verdict)} dot={false}>
                              {verification.verdict}
                            </StatusBadge>
                            <span className="text-foreground">{verification.subject_node_key}</span>
                            <span className="text-faint">{verification.lens}</span>
                            {Array.isArray(verification.evidence) && verification.evidence.length > 0 ? (
                              <span className="text-muted">{verification.evidence.map(String).join("; ")}</span>
                            ) : null}
                            {verification.shared_worker_context ? (
                              <span className="text-[var(--warning)]">verifier shared the subject&apos;s context</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {/*
                    The run rolled up by lifecycle stage, above the nodes it is
                    derived from. Same array, so the rail and the table cannot
                    disagree about where the run is.
                  */}
                  <div className="mb-3">
                    <StageRail summary={summariseRunByStage(run.nodes ?? [])} />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[36rem] text-left text-xs">
                      <thead>
                        <tr className="text-faint">
                          <th className="py-1 pr-3 font-medium">Node</th>
                          <th className="py-1 pr-3 font-medium">Stage</th>
                          <th className="py-1 pr-3 font-medium">State</th>
                          <th className="py-1 pr-3 font-medium">Executor</th>
                          <th className="py-1 pr-3 font-medium">Provider / model</th>
                          <th className="py-1 pr-3 font-medium">Latency</th>
                          <th className="py-1 font-medium">Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {(run.nodes ?? []).map((node) => (
                          <tr key={node.node_key}>
                            <td className="py-1.5 pr-3 font-medium text-foreground">
                              {node.node_key}
                              <GateDecision node={node} onDecided={() => void load()} />
                            </td>
                            <td className="py-1.5 pr-3 text-muted">{node.lifecycle_stage ?? "—"}</td>
                            <td className="py-1.5 pr-3">
                              <StatusBadge tone={nodeTone(node.state)} dot={false}>{node.state}</StatusBadge>
                              {node.gate_state === "OPEN" ? (
                                // VERIFYING alone does not say a person is owed
                                // something. This does.
                                <span className="ml-1.5 text-muted">awaiting a decision</span>
                              ) : null}
                            </td>
                            <td className="py-1.5 pr-3 text-muted">{node.executor}</td>
                            <td className="py-1.5 pr-3 text-muted">
                              {node.provider ? `${node.provider}${node.model ? ` / ${node.model}` : ""}` : "—"}
                            </td>
                            <td className="py-1.5 pr-3 tabular text-muted">
                              {typeof node.latency_ms === "number" ? `${(node.latency_ms / 1000).toFixed(1)}s` : "—"}
                            </td>
                            <td className="py-1.5 text-muted">
                              {node.error_message ? <span className="text-[var(--danger)]">{node.error_message}</span> : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
