"use client";

import { Clock3, GitBranch, Loader2, Play, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  EmptyPanel,
  TenantStateGate,
  formatDateTime,
  formatDuration,
  riskTone,
  runStatusTone,
} from "@/components/tenant-states";
import { Panel, StatusBadge } from "@/components/ui";
import { useTenantResource } from "@/lib/client/use-tenant-resource";

type RunRow = {
  id: string;
  status: string;
  step: string | null;
  attempt: number;
  failureKind: string | null;
  provider: string | null;
  model: string | null;
  risk: string;
  commandId: string | null;
  task: { id: string; title: string };
  agent: { id: string; name: string; role: string };
  project: { id: string; name: string };
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  durationMs: number | null;
  branch: string | null;
  repository: string | null;
  pullRequest: { number: number; url: string; status: string } | null;
  resultSummary: string | null;
  filesChanged: number | null;
  testsOutcome: string | null;
};

const STATUS_OPTIONS = [
  "queued",
  "running",
  "validating",
  "awaiting_review",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export function RunsConsole({ initialCommandId }: { initialCommandId?: string }) {
  const [status, setStatus] = useState("");
  const [risk, setRisk] = useState("");
  const [projectId, setProjectId] = useState("");
  const [agentId, setAgentId] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "100" });
    if (status) params.set("status", status);
    if (risk) params.set("risk", risk);
    if (projectId) params.set("projectId", projectId);
    if (agentId) params.set("agentId", agentId);
    return `/api/runs?${params.toString()}`;
  }, [agentId, projectId, risk, status]);

  const runs = useTenantResource<{ runs: RunRow[] }>(query, { pollMs: 15_000 });
  const projects = useTenantResource<{ projects: Array<{ id: string; name: string }> }>("/api/projects");
  const agents = useTenantResource<{ agents: Array<{ id: string; name: string }> }>("/api/agents");

  const visibleRuns = useMemo(() => {
    const all = runs.data?.runs ?? [];
    return initialCommandId ? all.filter((run) => run.commandId === initialCommandId) : all;
  }, [initialCommandId, runs.data]);

  if (runs.state !== "ready") {
    return <TenantStateGate state={runs.state} message={runs.message} subject="runs" next="/runs" />;
  }

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[#212b37] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS.map((value) => ({ value, label: value.replace(/_/g, " ") }))} />
          <FilterSelect label="Risk" value={risk} onChange={setRisk} options={[{ value: "green", label: "GREEN" }, { value: "yellow", label: "YELLOW" }, { value: "red", label: "RED" }]} />
          <FilterSelect
            label="Project"
            value={projectId}
            onChange={setProjectId}
            options={(projects.data?.projects ?? []).map((project) => ({ value: project.id, label: project.name }))}
          />
          <FilterSelect
            label="Agent"
            value={agentId}
            onChange={setAgentId}
            options={(agents.data?.agents ?? []).map((agent) => ({ value: agent.id, label: agent.name }))}
          />
        </div>
        <button
          type="button"
          onClick={runs.reload}
          disabled={runs.refreshing}
          className="secondary-action shrink-0"
          aria-label="Refresh runs"
        >
          {runs.refreshing ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden="true" />
          )}
          Refresh
        </button>
      </div>

      {visibleRuns.length === 0 ? (
        <EmptyPanel
          title="No runs match this view"
          description="A run appears once a command is planned. Nothing here is simulated; an empty list means no run exists."
          icon={Play}
        />
      ) : (
        <ul className="divide-y divide-[#202a36]">
          {visibleRuns.map((run) => (
            <li key={run.id}>
              <Link href={`/runs/${run.id}`} className="block p-4 transition-colors hover:bg-[#111821] sm:p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-[#2d3947] bg-[#151d27] text-[#8fa132]">
                      <Play className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[9px] text-[#596675]">{run.id.slice(0, 8)}</span>
                        <StatusBadge tone={runStatusTone(run.status)}>{run.status.replace(/_/g, " ")}</StatusBadge>
                        <StatusBadge tone={riskTone(run.risk)} dot={false}>
                          {run.risk.toUpperCase()}
                        </StatusBadge>
                      </div>
                      <h2 className="mt-1.5 truncate text-xs font-semibold text-[#dce2e8]">{run.task.title}</h2>
                      <p className="mt-1 text-[10px] text-[#687586]">
                        {run.project.name} · {run.agent.name}
                        {run.provider ? ` · ${run.provider}/${run.model ?? "model"}` : ""}
                        {run.step ? ` · step: ${run.step.replace(/_/g, " ")}` : ""}
                      </p>
                      {run.failureKind ? (
                        <p className="mt-1 text-[10px] text-[#e59399]">
                          Failure: {run.failureKind.replace(/_/g, " ")}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-5 md:min-w-[360px]">
                    <div>
                      <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#4f5b69]">Started</p>
                      <p className="mt-1 text-[10px] text-[#9ca8b6]">{formatDateTime(run.startedAt ?? run.createdAt)}</p>
                    </div>
                    <div>
                      <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#4f5b69]">Duration</p>
                      <p className="mt-1 flex items-center gap-1 text-[10px] text-[#9ca8b6]">
                        <Clock3 className="size-3" aria-hidden="true" />
                        {formatDuration(run.durationMs)}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#4f5b69]">Result</p>
                      <p className="mt-1 truncate text-[10px] text-[#9ca8b6]">
                        {run.pullRequest ? `PR #${run.pullRequest.number}` : run.filesChanged !== null ? `${run.filesChanged} file(s)` : "—"}
                      </p>
                    </div>
                  </div>
                </div>
                {run.branch ? (
                  <p className="mt-3 flex items-center gap-1.5 font-mono text-[9px] text-[#5f6c7c]">
                    <GitBranch className="size-3" aria-hidden="true" />
                    {run.repository}:{run.branch}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-md border border-[#2b3644] bg-[#0a0f16] px-2 text-[10px] text-[#c4ccd5]"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
