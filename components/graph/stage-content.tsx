"use client";

import { Card, StatusBadge } from "@/components/ui";
import { type DetailedNode } from "@/lib/graph/node-detail";
import { parseNodeReport, type NodeReport } from "@/lib/graph/node-report";
import {
  decisionPackageSchema,
  discoveryPackageSchema,
  evaluationPackageSchema,
  weightedTotal,
} from "@/lib/graph/stage-packages";
import { type StageSummary } from "@/lib/graph/stage-summary";

/**
 * The shared readings of a run's recorded content.
 *
 * Extracted from the per-run stage console so the factory step pages render
 * a stage's substance — recorded packages, reports, scout summaries, real
 * clocks — through exactly the same code. Two renderers for the same payload
 * would eventually read it two ways.
 */

export type RunVerification = {
  subject_node_key: string;
  lens: string;
  verdict: string;
  evidence: unknown;
  verifier_provider: string | null;
  shared_worker_context: boolean;
};

export type RunView = {
  graphRunId: string;
  graphId: string;
  goal: string;
  state: string;
  startedAt: string | null;
  completedAt: string | null;
  nodes?: DetailedNode[] | null;
  verifications?: RunVerification[] | null;
  isLifecycle?: boolean;
  iteration?: number;
  maxIterations?: number;
};

export type ArtifactView = {
  artifactId: string;
  nodeRunId: string | null;
  nodeKey: string | null;
  kind: string;
  payload: unknown;
  createdAt: string;
};

/** The stage's one-word standing, from its counts — same derivation as the index. */
export function stageStanding(slice: StageSummary | undefined):
  { label: string; tone: "safe" | "danger" | "info" | "warning" | "neutral" } {
  if (!slice) return { label: "not in this run", tone: "neutral" };
  if (slice.failed > 0) return { label: "failed", tone: "danger" };
  if (slice.active > 0) return { label: "in flight", tone: "info" };
  if (slice.completed === slice.total) return { label: "complete", tone: "safe" };
  if (slice.skipped === slice.total) return { label: "skipped", tone: "warning" };
  // Nothing settled and nothing running: the stage is queued work, and
  // "pending" says so where "mixed" implied a half-finished muddle.
  if (slice.completed === 0 && slice.skipped === 0) return { label: "pending", tone: "neutral" };
  return { label: "mixed", tone: "neutral" };
}

export function clock(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString();
}

/**
 * A recorded payload, rendered as itself.
 *
 * The three typed stage packages get a structured reading — the fields are
 * contract-validated, so showing them as prose is safe. Anything else is the
 * exact JSON in a collapsed block: verbatim beats paraphrase.
 */
export function ArtifactBody({ payload }: { payload: unknown }) {
  const decision = decisionPackageSchema.safeParse(payload);
  if (decision.success) {
    const chosen = decision.data.paths.find((path) => path.path === decision.data.chosenPath);
    return (
      <div className="mt-3 space-y-2 text-sm">
        <p className="text-foreground">
          Chose <strong>{decision.data.chosenPath}</strong>
          {decision.data.subject ? <> for <strong>{decision.data.subject}</strong></> : null}
          {chosen ? ` (${chosen.score}/100)` : ""}.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          {decision.data.rationale.map((reason, position) => <li key={position}>{reason}</li>)}
        </ul>
        <div>
          <h4 className="label">Execution plan</h4>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
            {decision.data.executionPlan.map((step, position) => (
              <li key={position}>
                <span className="text-foreground">{step.step}</span> — {step.detail}
              </li>
            ))}
          </ol>
        </div>
        <RawPayload payload={payload} label="Full decision package" />
      </div>
    );
  }

  const evaluation = evaluationPackageSchema.safeParse(payload);
  if (evaluation.success) {
    const byName = new Map(evaluation.data.candidates.map((candidate) => [candidate.name, candidate]));
    return (
      <div className="mt-3 space-y-2 text-sm">
        <ol className="list-decimal space-y-1 pl-5">
          {evaluation.data.ranking.map((name) => {
            const candidate = byName.get(name);
            return (
              <li key={name} className="text-muted">
                <span className="text-foreground">{name}</span>
                {candidate ? ` — ${weightedTotal(candidate)}/100, ${candidate.recommendation}` : ""}
              </li>
            );
          })}
        </ol>
        <p className="text-muted">{evaluation.data.recommendationSummary}</p>
        <RawPayload payload={payload} label="Full evaluation package" />
      </div>
    );
  }

  const discovery = discoveryPackageSchema.safeParse(payload);
  if (discovery.success) {
    return (
      <div className="mt-3 space-y-2 text-sm">
        <p className="text-muted">
          {discovery.data.candidates.length} candidate{discovery.data.candidates.length === 1 ? "" : "s"}
          {discovery.data.searchAreas.length > 0
            ? ` across ${discovery.data.searchAreas.join(", ")}`
            : ""}.
        </p>
        {discovery.data.candidates.length > 0 ? (
          <ul className="space-y-1 text-muted">
            {discovery.data.candidates.map((candidate) => (
              <li key={candidate.name}>
                <span className="text-foreground">{candidate.name}</span>
                {` — ${candidate.source}, match ${candidate.matchScore}/100, ${candidate.verification === "VERIFIED_IN_REPO" ? "verified in repo" : "unverified"}`}
              </li>
            ))}
          </ul>
        ) : null}
        {discovery.data.keyFindings.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-muted">
            {discovery.data.keyFindings.map((finding, position) => <li key={position}>{finding}</li>)}
          </ul>
        ) : null}
        <RawPayload payload={payload} label="Full discovery package" />
      </div>
    );
  }

  const report = parseNodeReport(payload);
  if (report) return <NodeReportBody report={report} payload={payload} />;

  return <RawPayload payload={payload} label="Recorded payload" open />;
}

/**
 * The general model-node report, read as a report.
 *
 * Summary in the node's own words, the stated confidence, findings as
 * title/detail rows a reader can open one at a time, and the node's
 * recommendations to the next stage. Nothing is scored or ranked here that
 * the payload does not carry.
 */
function NodeReportBody({ report, payload }: { report: NodeReport; payload: unknown }) {
  return (
    <div className="mt-3 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {report.blocked ? (
          <StatusBadge tone="danger" dot={false}>blocked</StatusBadge>
        ) : null}
        {report.confidence ? (
          <span className="text-xs text-faint">confidence: {report.confidence}</span>
        ) : null}
        <span className="text-xs text-faint">
          {report.findings.length} finding{report.findings.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="text-muted">{report.summary}</p>
      {report.blocked && report.blocked_reason ? (
        <p className="text-[var(--danger)]">{report.blocked_reason}</p>
      ) : null}
      {report.findings.length > 0 ? (
        <ul className="space-y-1.5">
          {report.findings.map((finding, position) => (
            <li key={position} className="rounded border border-[var(--border)] p-2.5">
              {finding.detail ? (
                <details>
                  <summary className="cursor-pointer font-medium text-foreground hover:text-accent">
                    {finding.title}
                  </summary>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-muted">{finding.detail}</p>
                </details>
              ) : (
                <p className="font-medium text-foreground">{finding.title}</p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {report.recommendations.length > 0 ? (
        <div>
          <h4 className="label">Recommendations to the next stage</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
            {report.recommendations.map((recommendation, position) => (
              <li key={position}>{recommendation}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <RawPayload payload={payload} label="Full recorded report" />
    </div>
  );
}

/**
 * The Discover step's own summary, from the scouts' recorded reports.
 *
 * The owner's board shows a source strip and a dedup figure. The honest
 * versions of both are here: one tile per scout node with the findings it
 * actually recorded and the confidence it actually stated, and — when the
 * consolidating fan-in has run — the arithmetic between what the scans
 * returned and what the merged shortlist kept. No stars, no relevance bars,
 * no search timings: nothing records those, so nothing shows them.
 */
const DISCOVERY_SOURCE_LABELS: Readonly<Record<string, string>> = {
  scan_internal: "This repository",
  scan_dependencies: "Dependency manifests",
  recall_ecosystem: "Ecosystem recall (model knowledge)",
  consolidate: "Consolidated shortlist",
};

export function DiscoverySources({ artifacts }: { artifacts: readonly ArtifactView[] }) {
  const reports = artifacts.flatMap((artifact) => {
    if (!artifact.nodeKey) return [];
    const report = parseNodeReport(artifact.payload);
    return report ? [{ nodeKey: artifact.nodeKey, report }] : [];
  });
  if (reports.length === 0) return null;

  const scans = reports.filter((entry) => entry.nodeKey !== "consolidate");
  const consolidated = reports.find((entry) => entry.nodeKey === "consolidate");
  const scanFindings = scans.reduce((sum, entry) => sum + entry.report.findings.length, 0);

  return (
    <Card className="p-5">
      <h2 className="label">What the scouts searched</h2>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {reports.map(({ nodeKey, report }) => (
          <li key={nodeKey} className="rounded-lg border border-[var(--border)] p-3">
            <p className="text-xs text-faint">{DISCOVERY_SOURCE_LABELS[nodeKey] ?? nodeKey}</p>
            <p className="mt-1 text-lg font-semibold text-foreground">
              {report.findings.length}
              <span className="ml-1 text-xs font-normal text-muted">
                finding{report.findings.length === 1 ? "" : "s"}
              </span>
            </p>
            {report.confidence ? (
              <p className="text-xs text-faint">confidence: {report.confidence}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {consolidated && scans.length > 0 ? (
        <p className="mt-3 text-sm text-muted">
          The {scans.length} scan{scans.length === 1 ? "" : "s"} recorded {scanFindings} finding
          {scanFindings === 1 ? "" : "s"}; the consolidated shortlist carries{" "}
          {consolidated.report.findings.length}.
        </p>
      ) : null}
    </Card>
  );
}

function RawPayload({
  payload,
  label,
  open,
}: {
  payload: unknown;
  label: string;
  open?: boolean;
}) {
  let text: string;
  try {
    text = JSON.stringify(payload, null, 2) ?? "null";
  } catch {
    text = String(payload);
  }
  return (
    <details className="mt-2" open={open}>
      <summary className="cursor-pointer text-xs text-muted hover:text-foreground">{label}</summary>
      <pre className="mt-2 max-h-96 overflow-auto rounded border border-[var(--border)] p-3 text-xs text-muted">
        {text}
      </pre>
    </details>
  );
}

/** Every stored clock for the stage's nodes, in order — nothing estimated. */
export function ActivityLog({ nodes }: { nodes: readonly DetailedNode[] }) {
  const entries = nodes.flatMap((node) => {
    const events: { at: string; text: string }[] = [];
    if (node.queued_at) events.push({ at: node.queued_at, text: `${node.node_key} queued` });
    if (node.node_started_at) events.push({ at: node.node_started_at, text: `${node.node_key} started` });
    if (node.node_completed_at) {
      events.push({
        at: node.node_completed_at,
        text: `${node.node_key} ${node.state === "FAILED" ? "failed" : node.state.toLowerCase()}`,
      });
    }
    return events;
  }).sort((a, b) => a.at.localeCompare(b.at));

  if (entries.length === 0) return null;
  return (
    <Card className="p-5">
      <h2 className="label">Activity</h2>
      <ul className="mt-2 space-y-1">
        {entries.map((entry, position) => (
          <li key={position} className="flex flex-wrap gap-2 text-sm">
            <span className="tabular text-xs text-faint">{clock(entry.at)}</span>
            <span className="text-muted">{entry.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
