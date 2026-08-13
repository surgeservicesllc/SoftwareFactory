"use client";

import { CheckCircle2, FileCheck2, Loader2, RefreshCw, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyPanel, TenantStateGate } from "@/components/tenant-states";
import { Panel, SectionTitle, StatusBadge } from "@/components/ui";
import { useTenantResource } from "@/lib/client/use-tenant-resource";

type ReportPayload = {
  window: { start: string; end: string; days: number };
  hasActivity: boolean;
  report: {
    title: string;
    summary: string;
    posture: "stable" | "attention" | "blocked";
    metrics: Record<string, number>;
    sections: Array<{ heading: string; lines: string[] }>;
    recommendations: string[];
  };
  agents: Array<{
    id: string;
    name: string;
    role: string;
    totalRuns: number;
    succeededRuns: number;
    failedRuns: number;
    successRate: number;
    lastRunAt: string | null;
  }>;
};

const METRIC_LABELS: Array<[string, string]> = [
  ["tasksCompleted", "Tasks completed"],
  ["tasksActive", "Active work"],
  ["pullRequestsCreated", "PRs created"],
  ["pullRequestsMerged", "PRs merged"],
  ["pullRequestsWaiting", "PRs waiting"],
  ["runsFailed", "Failed runs"],
  ["testsPassed", "Tests passed"],
  ["bugsFixed", "Bugs fixed"],
  ["issuesDiscovered", "Issues found"],
  ["securityFindings", "Security findings"],
  ["rollbacks", "Rollbacks"],
  ["blockers", "Blockers"],
];

export function ReportsConsole() {
  const [days, setDays] = useState(1);
  const [projectId, setProjectId] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({ days: String(days) });
    if (projectId) params.set("projectId", projectId);
    return `/api/reports?${params.toString()}`;
  }, [days, projectId]);

  const reports = useTenantResource<ReportPayload>(query);
  const projects = useTenantResource<{ projects: Array<{ id: string; name: string }> }>("/api/projects");

  if (reports.state !== "ready" || !reports.data) {
    return <TenantStateGate state={reports.state} message={reports.message} subject="reports" next="/reports" />;
  }

  const { report, agents, hasActivity } = reports.data;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5">
            <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">Window</span>
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="h-8 rounded-md border border-[#2b3644] bg-[#0a0f16] px-2 text-[10px] text-[#c4ccd5]"
            >
              <option value={1}>Last day</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">Project</span>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="h-8 rounded-md border border-[#2b3644] bg-[#0a0f16] px-2 text-[10px] text-[#c4ccd5]"
            >
              <option value="">All projects</option>
              {(projects.data?.projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" onClick={reports.reload} disabled={reports.refreshing} className="secondary-action">
          {reports.refreshing ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden="true" />
          )}
          Refresh
        </button>
      </div>

      {!hasActivity ? (
        <Panel>
          <EmptyPanel
            title="No factory activity in this window"
            description="The CEO Reporter summarizes structured records. With no records in range there is nothing to report, and nothing is invented to fill the space."
            icon={ScrollText}
          />
        </Panel>
      ) : (
        <>
          <Panel className="overflow-hidden">
            <div className="panel-grid border-b border-[#25303c] p-5 sm:p-7">
              <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
                <div className="max-w-3xl">
                  <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[#899a4b]">
                    {report.title}
                  </p>
                  <h2 className="mt-3 text-balance text-2xl font-semibold tracking-[-0.04em] text-white">
                    {report.summary}
                  </h2>
                </div>
                <div
                  className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-[10px] font-semibold ${
                    report.posture === "stable"
                      ? "border-[#31411d] bg-[#18210f] text-[#bed36d]"
                      : report.posture === "attention"
                        ? "border-[#4b3c23] bg-[#221c11] text-[#e0c88a]"
                        : "border-[#4a292e] bg-[#1e1113] text-[#e0868d]"
                  }`}
                >
                  <CheckCircle2 className="size-3.5" aria-hidden="true" />
                  Posture: {report.posture}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-px bg-[#26313d] sm:grid-cols-3 xl:grid-cols-6">
              {METRIC_LABELS.map(([key, label]) => (
                <div key={key} className="bg-[#0c1118] p-4">
                  <p className="data-value text-2xl font-semibold text-[#f2f5f7]">{report.metrics[key] ?? 0}</p>
                  <p className="mt-1 text-[9px] leading-4 text-[#6a7787]">{label}</p>
                </div>
              ))}
            </div>
          </Panel>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {report.sections.map((section) => (
              <Panel key={section.heading} className="p-5 sm:p-6">
                <SectionTitle title={section.heading} />
                <ul className="mt-4 space-y-2">
                  {section.lines.map((line) => (
                    <li key={line} className="rounded-lg border border-[#283341] bg-[#0a0f16] p-3 text-[11px] leading-5 text-[#8f9caa]">
                      {line}
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>

          <Panel className="mt-4 p-5 sm:p-6">
            <SectionTitle
              title="Top recommended next actions"
              description="Ranked suggestions for an owner. They are not autonomous instructions."
            />
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {report.recommendations.map((recommendation, index) => (
                <article key={recommendation} className="relative overflow-hidden rounded-lg border border-[#2a3542] bg-[#0a0f16] p-4">
                  <span className="font-mono text-[9px] font-bold text-[#859529]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="mt-3 text-[11px] leading-5 text-[#a3aebd]">{recommendation}</p>
                </article>
              ))}
            </div>
          </Panel>

          {agents.length > 0 ? (
            <Panel className="mt-4 overflow-hidden">
              <div className="border-b border-[#212b37] p-4">
                <SectionTitle title="Agent report" description="Runs, outcomes, and success rate per operating role." />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left">
                  <thead className="border-b border-[#202a36] bg-[#0b1017] font-mono text-[8px] uppercase tracking-[0.12em] text-[#596675]">
                    <tr>
                      <th className="px-4 py-3 font-medium">Agent</th>
                      <th className="px-4 py-3 font-medium">Runs</th>
                      <th className="px-4 py-3 font-medium">Succeeded</th>
                      <th className="px-4 py-3 font-medium">Failed</th>
                      <th className="px-4 py-3 font-medium">Success rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202a36]">
                    {agents.map((agent) => (
                      <tr key={agent.id}>
                        <td className="px-4 py-3 text-xs text-[#cfd6dd]">{agent.name}</td>
                        <td className="px-4 py-3 font-mono text-[10px] text-[#8c99a9]">{agent.totalRuns}</td>
                        <td className="px-4 py-3 font-mono text-[10px] text-[#8c99a9]">{agent.succeededRuns}</td>
                        <td className="px-4 py-3 font-mono text-[10px] text-[#8c99a9]">{agent.failedRuns}</td>
                        <td className="px-4 py-3">
                          <StatusBadge tone={agent.successRate >= 80 ? "safe" : agent.successRate >= 50 ? "warning" : "danger"} dot={false}>
                            {agent.successRate}%
                          </StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}
        </>
      )}

      <div className="mt-4 flex items-center gap-2 text-[9px] leading-4 text-[#566270]">
        <FileCheck2 className="size-3.5 shrink-0" aria-hidden="true" />
        Every figure is computed from tenant-scoped records at read time. Routine successful GREEN activity is
        compressed; exceptions are listed individually.
      </div>
    </>
  );
}
