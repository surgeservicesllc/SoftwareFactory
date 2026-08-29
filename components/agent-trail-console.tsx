"use client";

import { Loader2, Radar } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BlockedState, Card, EmptyState, SectionTitle, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { layoutTrail } from "@/lib/graph/trail-layout";

/**
 * The Agent Trail: the factory's runs as a live map.
 *
 * Visual language adapted from agenttrail (github.com/sodiumsun/agenttrail,
 * MIT © 2026 Kelly Sun; see THIRD_PARTY_NOTICES.md): components as cards on
 * a dependency flow, arrows that mean something, states that never flatter.
 * The data is the factory's own truth — graph nodes, edges, gates, and the
 * run's recorded closure — so "working" here is a node the worker actually
 * holds, and "done" is a state the database recorded, not an animation.
 *
 * Declared vs observed, agenttrail's core idea, maps exactly: declared is
 * the job the template gave the node; observed is what the run recorded —
 * state, latency, gate outcome, error. When they disagree, the card says so.
 */

type RunNode = {
  node_key: string;
  state: string | null;
  executor: string | null;
  capability: string | null;
  lifecycle_stage: string | null;
  latency_ms: number | null;
  error_message: string | null;
  gate_kind: string | null;
  gate_state: string | null;
  provider: string | null;
  model: string | null;
};

type Run = {
  graphRunId: string;
  graphId: string;
  goal: string;
  state: string;
  closureNote?: string | null;
  startedAt: string | null;
  completedAt: string | null;
  tokensUsed?: number | null;
  isLifecycle?: boolean;
  nodes: RunNode[] | null;
};

type Edge = { from: string; to: string; reason: string; detail: string };

type State = "loading" | "signed-out" | "error" | "ready";

const NODE_W = 168;
const NODE_H = 64;
const GAP_X = 56;
const GAP_Y = 20;

function stateTone(node: RunNode): { fill: string; ring: string; label: string } {
  const state = node.state ?? "PENDING";
  if (state === "COMPLETED") return { fill: "fill-emerald-500/15", ring: "stroke-emerald-500", label: "done" };
  if (state === "RUNNING") return { fill: "fill-violet-500/20", ring: "stroke-violet-400", label: "working" };
  if (state === "FAILED") return { fill: "fill-red-500/15", ring: "stroke-red-500", label: "failed" };
  if (state === "VERIFYING") return { fill: "fill-amber-500/15", ring: "stroke-amber-400", label: "awaiting gate" };
  if (state === "SKIPPED") return { fill: "fill-slate-500/10", ring: "stroke-slate-500", label: "skipped" };
  return { fill: "fill-slate-500/5", ring: "stroke-slate-600", label: "pending" };
}

function elapsedLabel(run: Run): string {
  if (!run.startedAt) return "not started";
  const end = run.completedAt ? new Date(run.completedAt) : new Date();
  const seconds = Math.max(0, Math.round((end.getTime() - new Date(run.startedAt).getTime()) / 1000));
  if (seconds < 90) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

export function AgentTrailConsole() {
  const [state, setState] = useState<State>("loading");
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [edgesByGraph, setEdgesByGraph] = useState<Record<string, Edge[]>>({});
  const [message, setMessage] = useState("");
  const [focusNode, setFocusNode] = useState<string | null>(null);
  const edgesRequested = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/graphs/runs", { credentials: "include" });
      if (response.status === 401) {
        setState("signed-out");
        return;
      }
      if (!response.ok) {
        setMessage("The runs could not be read.");
        setState("error");
        return;
      }
      const payload = (await response.json()) as { runs?: Run[] };
      setRuns(payload.runs ?? []);
      setState("ready");
    } catch {
      setMessage("The runs could not be read.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    // Live cadence: the map's whole point is watching work move.
    const interval = window.setInterval(() => void load(), 10_000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
    };
  }, [load]);

  const selected = useMemo(() => {
    if (runs.length === 0) return null;
    return runs.find((run) => run.graphRunId === selectedRunId) ?? runs[0];
  }, [runs, selectedRunId]);

  useEffect(() => {
    const graphId = selected?.graphId;
    if (!graphId || edgesRequested.current.has(graphId)) return;
    edgesRequested.current.add(graphId);
    void (async () => {
      try {
        const response = await fetch(`/api/graphs/edges?graphId=${graphId}`, { credentials: "include" });
        if (!response.ok) return;
        const payload = (await response.json()) as { edges?: Edge[] };
        setEdgesByGraph((current) => ({ ...current, [graphId]: payload.edges ?? [] }));
      } catch {
        // The map renders without arrows rather than failing the page.
      }
    })();
  }, [selected?.graphId]);

  const layout = useMemo(() => {
    if (!selected) return null;
    const nodes = selected.nodes ?? [];
    return layoutTrail(
      nodes.map((node) => node.node_key),
      edgesByGraph[selected.graphId] ?? [],
    );
  }, [selected, edgesByGraph]);

  if (state === "loading") {
    return (
      <Card className="flex items-center gap-3 p-6 text-slate-300">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading the trail…
      </Card>
    );
  }
  if (state === "signed-out") {
    return <BlockedState title="Sign in required" description="Sign in to watch your agents work." />;
  }
  if (state === "error") {
    return <BlockedState title="Trail unavailable" description={message || "The runs could not be read."} />;
  }
  if (runs.length === 0 || !selected) {
    return (
      <EmptyState
        icon={Radar}
        title="No runs yet"
        description="Launch a workflow and this page becomes a live map of the agents building it."
        actionHref="/solutions/workflows"
        actionLabel="Open Workflows"
      />
    );
  }

  const nodesByKey = new Map((selected.nodes ?? []).map((node) => [node.node_key, node]));
  const focused = focusNode ? nodesByKey.get(focusNode) : null;
  const width = layout ? layout.columns * (NODE_W + GAP_X) - GAP_X : 0;
  const height = layout ? layout.rows * (NODE_H + GAP_Y) - GAP_Y : 0;
  const position = new Map(
    (layout?.nodes ?? []).map((node) => [
      node.nodeKey,
      { x: node.column * (NODE_W + GAP_X), y: node.row * (NODE_H + GAP_Y) },
    ]),
  );

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          {runs.slice(0, 8).map((run) => (
            <button
              key={run.graphRunId}
              type="button"
              onClick={() => {
                setSelectedRunId(run.graphRunId);
                setFocusNode(null);
              }}
              className={cn(
                "max-w-56 truncate rounded-lg border px-3 py-1.5 text-left text-xs",
                run.graphRunId === selected.graphRunId
                  ? "border-violet-500 text-white"
                  : "border-slate-700 text-slate-400 hover:text-slate-200",
              )}
              title={run.goal}
            >
              <span className={cn(
                "mr-1.5 inline-block size-1.5 rounded-full align-middle",
                run.state === "RUNNING" ? "animate-pulse bg-violet-400"
                  : run.state === "COMPLETED" ? "bg-emerald-500"
                  : run.state === "FAILED" ? "bg-red-500" : "bg-slate-500",
              )} aria-hidden="true" />
              {run.goal}
            </button>
          ))}
        </div>
      </Card>

      <Card className="space-y-3 p-4 sm:p-6">
        <SectionTitle
          title="Live map"
          description="Arrows are recorded dependencies; colors are recorded states. Nothing here is an animation of hope."
          action={
            <StatusBadge tone={selected.state === "RUNNING" ? "info" : selected.state === "COMPLETED" ? "safe" : selected.state === "FAILED" ? "danger" : "neutral"}>
              {selected.state} · {elapsedLabel(selected)}
            </StatusBadge>
          }
        />
        {layout && layout.nodes.length > 0 ? (
          <div className="overflow-x-auto pb-2">
            <svg
              role="img"
              aria-label={`Dependency map of ${layout.nodes.length} nodes`}
              width={Math.max(width, 280)}
              height={Math.max(height, NODE_H)}
              viewBox={`0 0 ${Math.max(width, 280)} ${Math.max(height, NODE_H)}`}
              className="block"
            >
              {(edgesByGraph[selected.graphId] ?? []).map((edge) => {
                const from = position.get(edge.from);
                const to = position.get(edge.to);
                if (!from || !to) return null;
                const x1 = from.x + NODE_W;
                const y1 = from.y + NODE_H / 2;
                const x2 = to.x;
                const y2 = to.y + NODE_H / 2;
                const bend = Math.max(24, (x2 - x1) / 2);
                return (
                  <path
                    key={`${edge.from}->${edge.to}`}
                    d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
                    className="fill-none stroke-slate-600"
                    strokeWidth="1.5"
                    markerEnd="url(#trail-arrow)"
                  >
                    <title>{`${edge.reason}: ${edge.detail}`}</title>
                  </path>
                );
              })}
              <defs>
                <marker id="trail-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" className="fill-slate-500" />
                </marker>
              </defs>
              {layout.nodes.map((placed) => {
                const node = nodesByKey.get(placed.nodeKey);
                if (!node) return null;
                const tone = stateTone(node);
                const point = position.get(placed.nodeKey)!;
                return (
                  <g
                    key={placed.nodeKey}
                    transform={`translate(${point.x}, ${point.y})`}
                    className="cursor-pointer"
                    onClick={() => setFocusNode(placed.nodeKey)}
                  >
                    <rect
                      width={NODE_W}
                      height={NODE_H}
                      rx="10"
                      className={cn(tone.fill, tone.ring, node.state === "RUNNING" && "animate-pulse")}
                      strokeWidth="1.5"
                    />
                    <text x="12" y="24" className="fill-white text-[12px] font-semibold">
                      {placed.nodeKey.length > 18 ? `${placed.nodeKey.slice(0, 17)}…` : placed.nodeKey}
                    </text>
                    <text x="12" y="42" className="fill-slate-400 text-[10px]">
                      {tone.label}
                      {node.gate_state ? ` · gate ${node.gate_state.toLowerCase()}` : ""}
                    </text>
                    <title>{`${placed.nodeKey}: ${tone.label}${node.error_message ? ` — ${node.error_message}` : ""}`}</title>
                  </g>
                );
              })}
            </svg>
          </div>
        ) : (
          <p className="text-sm text-slate-400">This run recorded no nodes.</p>
        )}
        {selected.closureNote ? (
          <p className="rounded-lg border border-slate-700 p-3 text-sm text-slate-300">
            {selected.closureNote}
          </p>
        ) : null}
      </Card>

      {focused ? (
        <Card className="space-y-2 p-4 sm:p-6">
          <SectionTitle title={focusNode ?? ""} description="Declared vs observed" />
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-400">Declared</dt>
              <dd className="text-slate-200">
                {focused.capability ?? "—"}
                {focused.lifecycle_stage ? ` · ${focused.lifecycle_stage}` : ""}
                {focused.executor ? ` · runs on ${focused.executor}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Observed</dt>
              <dd className="text-slate-200">
                {stateTone(focused).label}
                {typeof focused.latency_ms === "number" && focused.latency_ms > 0
                  ? ` · ${Math.round(focused.latency_ms / 1000)}s`
                  : ""}
                {focused.model ? ` · ${focused.model}` : ""}
              </dd>
            </div>
            {focused.error_message ? (
              <div className="sm:col-span-2">
                <dt className="text-slate-400">Recorded error</dt>
                <dd className="break-words text-red-300">{focused.error_message}</dd>
              </div>
            ) : null}
          </dl>
        </Card>
      ) : null}

      <p className="text-xs text-slate-500">
        Map style adapted from{" "}
        <Link href="https://github.com/sodiumsun/agenttrail" className="underline-offset-2 hover:underline">
          agenttrail
        </Link>{" "}
        (MIT © 2026 Kelly Sun). Every state on this page is a database record.
      </p>
    </div>
  );
}
