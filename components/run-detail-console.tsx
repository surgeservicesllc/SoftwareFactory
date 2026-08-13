"use client";

import {
  ArrowLeft,
  CircleSlash,
  ExternalLink,
  FileDiff,
  GitBranch,
  Loader2,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  TenantStateGate,
  formatDateTime,
  formatDuration,
  riskTone,
  runStatusTone,
} from "@/components/tenant-states";
import { Panel, SectionTitle, StatusBadge } from "@/components/ui";
import { postJson, useTenantResource } from "@/lib/client/use-tenant-resource";

type RunDetail = {
  run: {
    id: string;
    status: string;
    step: string | null;
    attempt: number;
    maxAttempts: number;
    repairAttempts: number;
    ciRepairAttempts: number;
    failureKind: string | null;
    errorMessage: string | null;
    provider: string | null;
    model: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    heartbeatAt: string | null;
    cancelRequestedAt: string | null;
    durationMs: number | null;
  };
  command: { id: string; prompt: string; status: string; requestedRisk: string } | null;
  task: {
    id: string;
    title: string;
    description: string | null;
    acceptanceCriteria: string | null;
    status: string;
    risk: string;
    source: string;
  } | null;
  agent: { id: string; name: string; role: string };
  project: { id: string; name: string; repository: string | null; defaultBranch: string | null };
  workspace: {
    repository: string;
    baseBranch: string;
    baseSha: string;
    workingBranch: string;
    provider: string;
    model: string;
  } | null;
  result: {
    summary: string;
    filesChanged: number;
    additions: number;
    deletions: number;
    commits: number;
    testsOutcome: string;
    lintOutcome: string;
    typecheckOutcome: string;
    buildOutcome: string;
    risk: string;
    changedFiles: Array<{ path: string; action: string; summary: string }>;
    warnings: string[];
    blockers: string[];
    securityFindings: string[];
    nextRecommendation: string | null;
  } | null;
  pullRequest: {
    number: number;
    url: string;
    title: string;
    status: string;
    headBranch: string;
    baseBranch: string;
    draft: boolean;
  } | null;
  events: Array<{ id: string; sequence: number; type: string; message: string; occurredAt: string }>;
  nextAction: string;
};

const ACTIVE_STATUSES = new Set(["queued", "running", "validating", "cancelling"]);

export function RunDetailConsole({ runId }: { runId: string }) {
  const [cancelState, setCancelState] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [cancelMessage, setCancelMessage] = useState("");
  const detail = useTenantResource<RunDetail>(`/api/runs/${runId}`, { pollMs: 10_000 });

  if (detail.state !== "ready" || !detail.data) {
    return <TenantStateGate state={detail.state} message={detail.message} subject="this run" next={`/runs/${runId}`} />;
  }

  const { run, command, task, agent, project, workspace, result, pullRequest, events, nextAction } = detail.data;
  const cancellable = ACTIVE_STATUSES.has(run.status) && !run.cancelRequestedAt;

  async function cancelRun() {
    setCancelState("pending");
    const { ok, body } = await postJson<{ message?: string }>(`/api/runs/${runId}/cancel`, {
      reason: "Cancelled from the run detail view",
    });
    if (ok) {
      setCancelState("done");
      setCancelMessage(body.message ?? "Cancellation was recorded.");
      detail.reload();
    } else {
      setCancelState("error");
      setCancelMessage(body.error?.message ?? "The run could not be cancelled.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/runs" className="secondary-action">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          All runs
        </Link>
        <div className="flex items-center gap-2">
          <button type="button" onClick={detail.reload} disabled={detail.refreshing} className="secondary-action">
            {detail.refreshing ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            )}
            Refresh
          </button>
          {cancellable ? (
            <button
              type="button"
              onClick={() => void cancelRun()}
              disabled={cancelState === "pending"}
              className="secondary-action !border-[#4a292e] !text-[#e59399]"
            >
              {cancelState === "pending" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <CircleSlash className="size-3.5" aria-hidden="true" />
              )}
              Cancel run
            </button>
          ) : null}
        </div>
      </div>

      {cancelMessage ? (
        <p
          className={`rounded-lg border p-3 text-[10px] leading-5 ${
            cancelState === "error"
              ? "border-[#502c31] bg-[#2b181c] text-[#e59399]"
              : "border-[#36491d] bg-[#18220f] text-[#c5dd77]"
          }`}
          role="status"
        >
          {cancelMessage}
        </p>
      ) : null}

      <Panel className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] text-[#5f6c7c]">{run.id}</span>
              <StatusBadge tone={runStatusTone(run.status)}>{run.status.replace(/_/g, " ")}</StatusBadge>
              {task ? (
                <StatusBadge tone={riskTone(task.risk)} dot={false}>
                  {task.risk.toUpperCase()}
                </StatusBadge>
              ) : null}
            </div>
            <h2 className="mt-3 text-lg font-semibold tracking-[-0.025em] text-white">{task?.title ?? "Run"}</h2>
            {command ? (
              <p className="mt-2 max-w-2xl text-xs leading-5 text-[#8490a0]">
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#647182]">Owner command · </span>
                {command.prompt}
              </p>
            ) : null}
          </div>
          <div className="grid min-w-[240px] grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#27313f] bg-[#27313f]">
            <Meta label="Agent" value={agent.name} />
            <Meta label="Provider" value={run.provider ? `${run.provider}` : "—"} />
            <Meta label="Model" value={run.model ?? "—"} />
            <Meta label="Attempt" value={`${run.attempt}/${run.maxAttempts}`} />
            <Meta label="Duration" value={formatDuration(run.durationMs)} />
            <Meta label="Step" value={run.step?.replace(/_/g, " ") ?? "—"} />
          </div>
        </div>

        <p className="mt-5 rounded-lg border border-[#2a3542] bg-[#0a0f16] p-3.5 text-[11px] leading-5 text-[#9aa7b7]">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#647182]">Next action · </span>
          {nextAction}
        </p>

        {run.errorMessage ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-[#502c31] bg-[#2b181c] p-3.5 text-[10px] leading-5 text-[#e59399]">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {run.failureKind ? `${run.failureKind.replace(/_/g, " ")}: ` : ""}
            {run.errorMessage}
          </p>
        ) : null}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel className="p-5 sm:p-6">
          <SectionTitle
            title="Execution timeline"
            description="Append-only evidence. Provider reasoning is never stored or shown."
          />
          <ol className="mt-5 space-y-0">
            {events.length === 0 ? (
              <p className="text-[11px] text-[#667485]">No execution events have been recorded yet.</p>
            ) : (
              events.map((event) => (
                <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-[#60d8ff]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#7c8998]">
                        {event.sequence}. {event.type}
                      </span>
                      <time dateTime={event.occurredAt} className="font-mono text-[9px] text-[#566271]">
                        {formatDateTime(event.occurredAt)}
                      </time>
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-[#a3aebd]">{event.message}</p>
                  </div>
                </li>
              ))
            )}
          </ol>
        </Panel>

        <div className="space-y-4">
          {workspace ? (
            <Panel className="p-5">
              <SectionTitle title="Isolated workspace" description="One working branch per run." />
              <dl className="mt-4 space-y-2 font-mono text-[10px]">
                <Row label="Repository" value={workspace.repository} />
                <Row label="Base" value={`${workspace.baseBranch} @ ${workspace.baseSha.slice(0, 12)}`} />
                <Row label="Branch" value={workspace.workingBranch} />
              </dl>
            </Panel>
          ) : null}

          {pullRequest ? (
            <Panel className="p-5">
              <SectionTitle title="Pull request" description="Draft only. Never merged by SoftwareFactory." />
              <a
                href={pullRequest.url}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-[#293442] bg-[#0a0f16] p-3.5 transition-colors hover:border-[#3a4859]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-[#d5dbe2]">
                    #{pullRequest.number} {pullRequest.title}
                  </span>
                  <span className="mt-1 flex items-center gap-1.5 font-mono text-[9px] text-[#5f6c7c]">
                    <GitBranch className="size-3" aria-hidden="true" />
                    {pullRequest.headBranch} → {pullRequest.baseBranch}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <StatusBadge tone={pullRequest.draft ? "warning" : "info"} dot={false}>
                    {pullRequest.draft ? "Draft" : pullRequest.status}
                  </StatusBadge>
                  <ExternalLink className="size-3.5 text-[#5f6c7c]" aria-hidden="true" />
                </span>
              </a>
            </Panel>
          ) : null}

          {result ? (
            <Panel className="p-5">
              <SectionTitle title="Structured result" description="Normalized, not model prose." />
              <p className="mt-3 text-[11px] leading-5 text-[#9aa7b7]">{result.summary}</p>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {(
                  [
                    ["Files", result.filesChanged],
                    ["Commits", result.commits],
                    ["+", result.additions],
                    ["−", result.deletions],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-[#26313e] bg-[#0a0f16] p-2 text-center">
                    <p className="data-value text-sm font-semibold text-white">{value}</p>
                    <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#7a8797]">{label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {(
                  [
                    ["Tests", result.testsOutcome],
                    ["Lint", result.lintOutcome],
                    ["Typecheck", result.typecheckOutcome],
                    ["Build", result.buildOutcome],
                  ] as const
                ).map(([label, outcome]) => (
                  <div key={label} className="flex items-center justify-between rounded border border-[#26313e] bg-[#0a0f16] px-2.5 py-1.5">
                    <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#7a8797]">{label}</span>
                    <StatusBadge
                      tone={outcome === "passed" ? "safe" : outcome === "failed" ? "danger" : "neutral"}
                      dot={false}
                    >
                      {outcome.replace(/_/g, " ")}
                    </StatusBadge>
                  </div>
                ))}
              </div>

              {result.changedFiles.length > 0 ? (
                <div className="mt-4">
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#566270]">Changed files</p>
                  <ul className="mt-2 space-y-1">
                    {result.changedFiles.map((file) => (
                      <li key={file.path} className="flex items-start gap-2 font-mono text-[9px] text-[#8290a0]">
                        <FileDiff className="mt-0.5 size-3 shrink-0 text-[#5f6c7c]" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="break-all">{file.path}</span>
                          <span className="ml-1 text-[#5f6c7c]">({file.action})</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.securityFindings.length > 0 ? (
                <div className="mt-4 rounded-lg border border-[#4a292e] bg-[#1e1113] p-3">
                  <p className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-[#e0868d]">
                    <ShieldAlert className="size-3" aria-hidden="true" />
                    Security findings
                  </p>
                  <ul className="mt-2 space-y-1 text-[10px] leading-4 text-[#c99097]">
                    {result.securityFindings.map((finding) => (
                      <li key={finding}>{finding}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.blockers.length > 0 ? (
                <div className="mt-3 rounded-lg border border-[#4b3c23] bg-[#221c11] p-3">
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#c6ab73]">Blockers</p>
                  <ul className="mt-2 space-y-1 text-[10px] leading-4 text-[#b6a77f]">
                    {result.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.nextRecommendation ? (
                <p className="mt-3 text-[10px] leading-5 text-[#7f8b9a]">
                  <span className="font-mono uppercase tracking-[0.1em] text-[#5f6c7c]">Recommended next · </span>
                  {result.nextRecommendation}
                </p>
              ) : null}
            </Panel>
          ) : null}

          {task?.acceptanceCriteria ? (
            <Panel className="p-5">
              <SectionTitle title="Acceptance criteria" />
              <p className="mt-3 text-[11px] leading-5 text-[#8f9caa]">{task.acceptanceCriteria}</p>
            </Panel>
          ) : null}

          <Panel className="p-5">
            <SectionTitle title="Context" />
            <dl className="mt-4 space-y-2 text-[10px]">
              <Row label="Project" value={project.name} />
              <Row label="Repository" value={project.repository ?? "Not linked"} />
              <Row label="Created" value={formatDateTime(run.createdAt)} />
              <Row label="Completed" value={formatDateTime(run.completedAt)} />
              <Row label="Repair attempts" value={`${run.repairAttempts} worker · ${run.ciRepairAttempts} CI`} />
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0b1017] p-3">
      <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#7c8998]">{label}</p>
      <p className="mt-1 truncate text-[11px] font-medium text-[#c4ccd5]">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-[#5f6c7c]">{label}</dt>
      <dd className="min-w-0 break-all text-right text-[#a3aebd]">{value}</dd>
    </div>
  );
}
