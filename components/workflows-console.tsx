"use client";

import { GitBranch, ShieldCheck, Timer, Workflow } from "lucide-react";
import { useMemo, useState } from "react";

import { GraphLaunchControl } from "@/components/graph-launch-control";
import { Card, EmptyState, MetricCard, SectionTitle, StatusBadge } from "@/components/ui";
import type { GraphPreview, PreviewNode } from "@/lib/graph/preview";

/**
 * The Workflows console.
 *
 * Everything visible here is *compiled*, not run. Compilation is pure and needs
 * no credential, so the topology, the layering, the removed dependencies and the
 * lock waves are exact rather than illustrative — this is genuinely what would
 * happen, produced by the same code that would schedule it.
 *
 * What is missing is equally load-bearing: no graph has ever executed, so every
 * run-time panel is empty, and it says which kind of empty it is. "No runs
 * recorded" is not "all runs succeeded".
 */

export type TemplateSummary = {
  readonly key: string;
  readonly name: string;
  readonly category: string;
  readonly summary: string;
  readonly version: number;
  readonly preview: GraphPreview | null;
  readonly compileErrors: readonly string[];
};

const EXECUTOR_LABEL: Record<string, string> = {
  MODEL: "Model call",
  DETERMINISTIC: "Deterministic",
  ANCHOR: "Observation",
};

function tierTone(tier: string): "neutral" | "safe" | "info" {
  if (tier === "NONE") return "neutral";
  if (tier === "ECONOMY") return "safe";
  return "info";
}

function NodeButton({
  node,
  selected,
  onSelect,
}: {
  node: PreviewNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-lg border px-3 py-2 text-left transition ${
        selected
          ? "border-[var(--accent-border)] bg-[var(--accent-surface)]"
          : "border-line-strong bg-surface-raised hover:border-line-strong"
      }`}
    >
      <span className="block truncate text-sm font-medium text-foreground">{node.nodeKey}</span>
      {/*
        `text-faint` does not clear AA against the accent surface (4.31:1), so
        the selected state carries the accent's own text colour and keeps its
        hierarchy through size alone.
      */}
      <span className={`mt-1 block text-xs ${selected ? "text-[var(--accent-text)]" : "text-faint"}`}>
        {node.modelTier === "NONE" ? "No model" : node.modelTier} ·{" "}
        {EXECUTOR_LABEL[node.executor] ?? node.executor}
      </span>
    </button>
  );
}

function GraphMap({
  preview,
  selected,
  onSelect,
}: {
  preview: GraphPreview;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const byKey = useMemo(
    () => new Map(preview.nodes.map((node) => [node.nodeKey, node])),
    [preview.nodes],
  );

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-fit items-stretch gap-3">
        {preview.layers.map((layer, index) => (
          <div key={index} className="flex min-w-[190px] flex-1 flex-col gap-2">
            <p className="text-xs uppercase tracking-wide text-faint">
              {index === 0 ? "Starts immediately" : `After layer ${index}`}
              {layer.length > 1 ? ` · ${layer.length} in parallel` : ""}
            </p>
            {layer.map((key) => {
              const node = byKey.get(key);
              if (!node) return null;
              return (
                <NodeButton
                  key={key}
                  node={node}
                  selected={selected === key}
                  onSelect={() => onSelect(key)}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function NodeDetail({ node, preview }: { node: PreviewNode; preview: GraphPreview }) {
  const incoming = preview.edges.filter((edge) => edge.to === node.nodeKey);
  const outgoing = preview.edges.filter((edge) => edge.from === node.nodeKey);

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-foreground">{node.job}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <StatusBadge tone={tierTone(node.modelTier)} dot={false}>
            {node.modelTier === "NONE" ? "No model call" : `${node.modelTier} tier`}
          </StatusBadge>
          <StatusBadge tone="neutral" dot={false}>
            {EXECUTOR_LABEL[node.executor] ?? node.executor}
          </StatusBadge>
          <StatusBadge tone="neutral" dot={false}>{node.capability}</StatusBadge>
          <StatusBadge tone="neutral" dot={false}>
            up to {node.maxAttempts} attempt{node.maxAttempts === 1 ? "" : "s"}
          </StatusBadge>
        </div>
      </div>

      {node.writes.length > 0 ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-faint">Writes</p>
          <ul className="tabular mt-1 space-y-0.5 text-xs text-muted">
            {node.writes.map((write) => (
              <li key={write}>{write}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="text-xs uppercase tracking-wide text-faint">Waits for</p>
        {incoming.length === 0 ? (
          <p className="mt-1 text-xs text-muted">
            Nothing. This node starts as soon as the graph does.
          </p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {incoming.map((edge) => (
              <li key={`${edge.from}-${edge.to}`}>
                <span className="text-foreground">{edge.from}</span> — {edge.detail}
              </li>
            ))}
          </ul>
        )}
      </div>

      {outgoing.length > 0 ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-faint">Feeds</p>
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {outgoing.map((edge) => (
              <li key={`${edge.from}-${edge.to}`}>
                <span className="text-foreground">{edge.to}</span> — {edge.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function WorkflowsConsole({ templates }: { templates: readonly TemplateSummary[] }) {
  const [activeKey, setActiveKey] = useState(templates[0]?.key ?? "");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const active = templates.find((template) => template.key === activeKey) ?? templates[0] ?? null;
  const preview = active?.preview ?? null;
  const node = preview?.nodes.find((candidate) => candidate.nodeKey === selectedNode) ?? null;

  if (!active) {
    return <EmptyState title="No templates" description="No graph templates are declared." />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle
          title="Templates"
          description="A starting plan for recurring work. The compiler still removes imaginary dependencies and still chooses the topology on evidence, so a template naming twelve nodes can legitimately compile down to a single agent."
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {templates.map((template) => (
            <button
              key={template.key}
              type="button"
              onClick={() => {
                setActiveKey(template.key);
                setSelectedNode(null);
              }}
              aria-pressed={template.key === active.key}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                template.key === active.key
                  ? "border-[var(--accent-border)] bg-[var(--accent-surface)] text-[var(--accent-text)]"
                  : "border-line-strong bg-surface-raised text-muted"
              }`}
            >
              {template.name}
              <span
                className={`ml-2 text-xs ${
                  template.key === active.key ? "text-[var(--accent-text)]" : "text-faint"
                }`}
              >
                v{template.version}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted">{active.summary}</p>
      </Card>

      {/* First after choosing a template, not buried under the preview: the
          owner-reported failure mode of this page was "can't reach the Launch
          card" — it sat below the metrics, the rationale, the whole graph map
          and two more panels. The compiled evidence follows for anyone who
          reads before launching. */}
      {preview ? <GraphLaunchControl templateKey={active.key} templateName={active.name} /> : null}

      {!preview ? (
        <Card>
          <SectionTitle
            title="This template does not compile"
            description="A template that cannot compile is worse than no template, because it fails at the moment someone tries to use it."
          />
          <ul className="mt-3 space-y-1 text-sm text-[var(--danger)]">
            {active.compileErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Topology"
              value={preview.topology}
              detail="Chosen from the node set, not from the goal."
              icon={Workflow}
            />
            <MetricCard
              label="Parallel width"
              value={String(preview.maxParallelism)}
              detail="Nodes that can run at once."
              icon={GitBranch}
            />
            <MetricCard
              label="Sequential depth"
              value={String(preview.sequentialDepth)}
              detail="Longest dependent chain."
              icon={Timer}
            />
            <MetricCard
              label="Model calls"
              value={`${preview.modelNodeCount} of ${preview.nodes.length}`}
              detail={`${preview.deterministicNodeCount} deterministic, ${preview.anchorNodeCount} observation.`}
              icon={ShieldCheck}
            />
          </div>

          <Card>
            <SectionTitle title="Why this shape" />
            <ul className="mt-3 space-y-1 text-sm text-muted">
              {preview.topologyReasons.map((reason) => (
                <li key={reason.code}>{reason.detail}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted">{preview.costNote}</p>
            {preview.requiresOwnerApproval ? (
              <p className="mt-3 text-sm text-[var(--warning)]">
                Owner approval is required before this graph may run.
              </p>
            ) : null}
          </Card>

          <Card>
            <SectionTitle
              title="The graph"
              description="Select a node to see its contract, what it waits for, and what it feeds."
            />
            <div className="mt-4">
              <GraphMap preview={preview} selected={selectedNode} onSelect={setSelectedNode} />
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle title="Node detail" />
              <div className="mt-4">
                {node ? (
                  <NodeDetail node={node} preview={preview} />
                ) : (
                  <p className="text-sm text-muted">No node selected.</p>
                )}
              </div>
            </Card>

            <Card>
              <SectionTitle title="Dependencies removed" />
              <div className="mt-4">
                {preview.removedEdges.length === 0 ? (
                  <p className="text-sm text-muted">
                    This template proposed no dependency that turned out to be imaginary.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted">
                      {preview.removedEdges.length} proposed dependenc
                      {preview.removedEdges.length === 1 ? "y was" : "ies were"} removed, which is
                      what allows the parallel width above.
                    </p>
                    <ul className="mt-3 space-y-1 text-xs text-muted">
                      {preview.removedEdges.map((edge) => (
                        <li key={`${edge.from}-${edge.to}`}>
                          <span className="text-foreground">
                            {edge.from} → {edge.to}
                          </span>
                          : {edge.why}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </Card>
          </div>

          <Card>
            <SectionTitle
              title="Lock waves and isolation"
              description="Nodes whose writes do not overlap can hold their locks at the same time. More than one wave means contention is resolved by scheduling rather than by collision and retry."
            />
            <p className="mt-3 text-sm text-muted">
              {preview.isolatedWorkspaces === 0
                ? "No node writes to the repository, so none needs its own checkout."
                : `${preview.isolatedWorkspaces} node(s) write, so each gets an isolated checkout. Two agents editing one checkout lose each other's work in a way that still builds and still passes.`}
            </p>
            <div className="mt-4 space-y-2">
              {preview.lockWaves.map((wave, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-faint">
                    Wave {index + 1}
                  </span>
                  {wave.map((key) => (
                    <StatusBadge key={key} tone="neutral" dot={false}>
                      {key}
                    </StatusBadge>
                  ))}
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle
              title="Runs, verification, artifacts and anchors"
              description="This page shows what a graph would do. What one actually did — every claim, node transition, artifact, verification and gate — is recorded evidence, and it lives with the runs."
            />
            <p className="mt-3 text-sm text-muted">
              Watch launched graphs on the{" "}
              <a href="/solutions/pipelines" className="text-[var(--accent-text)] underline">
                Pipelines page
              </a>
              , where each run reports its nodes and stages exactly as the database holds them.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
