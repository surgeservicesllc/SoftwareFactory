"use client";

import {
  Activity,
  ArrowRight,
  Bot,
  Bug,
  CircleDotDashed,
  CloudCog,
  FolderGit2,
  GitMerge,
  GitPullRequestArrow,
  Inbox,
  ListTodo,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  TestTubeDiagonal,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";

import { EmptyPanel, TenantStateGate, formatDateTime } from "@/components/tenant-states";
import { MetricCard, Panel, SectionTitle, StatusBadge } from "@/components/ui";
import { useTenantResource } from "@/lib/client/use-tenant-resource";

type DashboardPayload = {
  windowDays: number;
  portfolio: { total: number; connected: number; healthy: number; degraded: number; disconnected: number };
  workforce: { available: number; active: number; queuedRuns: number; failedRuns: number };
  engineering: {
    tasksInProgress: number;
    tasksCompleted: number;
    pullRequestsCreated: number;
    pullRequestsMerged: number;
    pullRequestsWaiting: number;
    ciFailures: number;
    testsPassed: number;
    issuesDiscovered: number;
    securityFindings: number;
  };
  production: {
    availability: "live" | "unavailable";
    deployments: number;
    deploymentFailures: number;
    rollbacks: number;
    openIncidents: number;
  };
  ownerAttention: Array<{
    kind: string;
    title: string;
    detail: string;
    href: string;
    severity: "info" | "warning" | "danger";
  }>;
  executionEnabled: boolean;
};

type ActivityPayload = {
  events: Array<{
    id: string;
    description: string;
    eventType: string;
    occurredAt: string;
    project: { id: string; name: string } | null;
    actor: { id: string | null; displayName: string };
  }>;
};

type ReportPayload = {
  hasActivity: boolean;
  report: {
    title: string;
    summary: string;
    posture: "stable" | "attention" | "blocked";
    metrics: Record<string, number>;
    recommendations: string[];
  };
};

export function DashboardConsole() {
  const dashboard = useTenantResource<DashboardPayload>("/api/dashboard", { pollMs: 60_000 });
  const activity = useTenantResource<ActivityPayload>("/api/activity?limit=6");
  const report = useTenantResource<ReportPayload>("/api/reports?days=1");

  const data = dashboard.data;
  if (dashboard.state !== "ready" || !data) {
    return (
      <TenantStateGate
        state={dashboard.state}
        message={dashboard.message}
        subject="the dashboard"
        next="/"
      />
    );
  }

  const { portfolio, workforce, engineering, production, ownerAttention } = data;

  return (
    <>
      <section className="mb-6" aria-labelledby="portfolio-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="portfolio-title" className="eyebrow">
              Portfolio
            </h2>
            <p className="mt-1 text-[10px] text-[#657283]">
              Live tenant records. A project counts as connected only with an active installation and a
              selected repository.
            </p>
          </div>
          <button
            type="button"
            onClick={dashboard.reload}
            disabled={dashboard.refreshing}
            className="secondary-action"
            aria-label="Refresh dashboard metrics"
          >
            {dashboard.refreshing ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            )}
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard
            label="Connected projects"
            value={String(portfolio.connected)}
            detail={`${portfolio.total} project${portfolio.total === 1 ? "" : "s"} in the portfolio`}
            icon={FolderGit2}
            tone={portfolio.connected > 0 ? "safe" : "neutral"}
            demo={false}
          />
          <MetricCard
            label="Healthy"
            value={String(portfolio.healthy)}
            detail="Reported healthy by their own records"
            icon={Activity}
            tone={portfolio.healthy > 0 ? "safe" : "neutral"}
            demo={false}
          />
          <MetricCard
            label="Degraded"
            value={String(portfolio.degraded)}
            detail="Degraded or unhealthy"
            icon={TriangleAlert}
            tone={portfolio.degraded > 0 ? "warning" : "neutral"}
            demo={false}
          />
          <MetricCard
            label="Disconnected"
            value={String(portfolio.disconnected)}
            detail="Cannot run work without a live connection"
            icon={CircleDotDashed}
            tone={portfolio.disconnected > 0 ? "danger" : "neutral"}
            demo={false}
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.55fr]">
        <Panel className="panel-grid relative overflow-hidden p-5 sm:p-6">
          <div className="absolute -right-20 -top-20 size-72 rounded-full bg-[#c6f135]/[0.05] blur-3xl" />
          <div className="relative flex h-full min-h-[218px] flex-col justify-between gap-8 sm:flex-row sm:items-end">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#c6f135] opacity-20" />
                  <span className="relative inline-flex size-2 rounded-full bg-[#c6f135]" />
                </span>
                <span className="eyebrow !text-[#a9c34b]">Factory status</span>
              </div>
              <h2 className="mt-5 max-w-xl text-balance text-[28px] font-semibold leading-[1.12] tracking-[-0.045em] text-white sm:text-[38px]">
                Control plane online.
                <span className="block text-[#5d6877]">
                  {data.executionEnabled ? "Commanded execution enabled." : "Execution locked by design."}
                </span>
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-6 text-[#8490a0]">
                {data.executionEnabled
                  ? "Owner commands can reach a worker and end in a draft pull request. Automatic approval, merge, deployment, and rollback remain unavailable."
                  : "Commands are planned and persisted, but no worker run starts until an owner enables commanded execution."}
              </p>
            </div>
            <div className="grid min-w-[216px] grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#27313f] bg-[#27313f]">
              <div className="bg-[#0b1017] p-3.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#7c8998]">Max risk</p>
                <p className="mt-2 text-sm font-semibold text-[#c6f135]">GREEN</p>
              </div>
              <div className="bg-[#0b1017] p-3.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#7c8998]">Autonomy</p>
                <p className="mt-2 text-sm font-semibold text-[#ff7d84]">OFF</p>
              </div>
              <div className="col-span-2 flex items-center justify-between bg-[#0b1017] p-3.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#7c8998]">Active runs</p>
                <StatusBadge tone={workforce.active > 0 ? "info" : "neutral"}>
                  {workforce.active} running
                </StatusBadge>
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="p-5 sm:p-6">
          <SectionTitle
            title="Owner attention"
            description="Derived from live records, not a sample."
            action={
              <StatusBadge tone={ownerAttention.length > 0 ? "danger" : "safe"}>
                {ownerAttention.length}
              </StatusBadge>
            }
          />
          <div className="mt-5 space-y-3">
            {ownerAttention.length === 0 ? (
              <p className="rounded-lg border border-[#233120] bg-[#111a0e] p-3.5 text-[11px] leading-5 text-[#9db463]">
                Nothing needs an owner decision right now.
              </p>
            ) : (
              ownerAttention.slice(0, 5).map((item) => (
                <Link
                  key={`${item.kind}-${item.title}`}
                  href={item.href}
                  className="block rounded-lg border border-[#232e3b] bg-[#0b1017] p-3.5 transition-colors hover:border-[#3a4757]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[9px] uppercase tracking-[0.13em] text-[#7b8999]">
                      {item.kind.replace(/_/g, " ")}
                    </span>
                    <StatusBadge
                      tone={item.severity === "danger" ? "danger" : item.severity === "warning" ? "warning" : "neutral"}
                      dot={false}
                    >
                      {item.severity}
                    </StatusBadge>
                  </div>
                  <p className="mt-2 text-xs font-medium text-[#cbd2da]">{item.title}</p>
                  <p className="mt-1 text-[10px] leading-4 text-[#6c7989]">{item.detail}</p>
                </Link>
              ))
            )}
          </div>
        </Panel>
      </div>

      <section className="mt-6" aria-labelledby="workforce-title">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="workforce-title" className="eyebrow">
            AI workforce and engineering
          </h2>
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#536070]">
            Live · {data.windowDays}-day window
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard label="Available agents" value={String(workforce.available)} detail="Enabled roles" icon={Bot} tone="neutral" demo={false} />
          <MetricCard label="Queued runs" value={String(workforce.queuedRuns)} detail="Waiting for a worker tick" icon={CircleDotDashed} tone={workforce.queuedRuns > 0 ? "info" : "neutral"} demo={false} />
          <MetricCard label="Failed runs" value={String(workforce.failedRuns)} detail="Need review" icon={TriangleAlert} tone={workforce.failedRuns > 0 ? "danger" : "neutral"} demo={false} />
          <MetricCard label="Tasks in progress" value={String(engineering.tasksInProgress)} detail="Currently executing" icon={ListTodo} tone="neutral" demo={false} />
          <MetricCard label="Tasks completed" value={String(engineering.tasksCompleted)} detail="All time" icon={ListTodo} tone={engineering.tasksCompleted > 0 ? "safe" : "neutral"} demo={false} />
          <MetricCard label="PRs created" value={String(engineering.pullRequestsCreated)} detail="Draft pull requests" icon={GitPullRequestArrow} tone="info" demo={false} />
          <MetricCard label="PRs merged" value={String(engineering.pullRequestsMerged)} detail="Merged by a human" icon={GitMerge} tone={engineering.pullRequestsMerged > 0 ? "safe" : "neutral"} demo={false} />
          <MetricCard label="PRs waiting" value={String(engineering.pullRequestsWaiting)} detail="Awaiting review" icon={Inbox} tone={engineering.pullRequestsWaiting > 0 ? "warning" : "neutral"} demo={false} />
          <MetricCard label="CI failures" value={String(engineering.ciFailures)} detail="Real repository CI" icon={TriangleAlert} tone={engineering.ciFailures > 0 ? "danger" : "neutral"} demo={false} />
          <MetricCard label="Tests passed" value={String(engineering.testsPassed)} detail="Recorded by CI" icon={TestTubeDiagonal} tone={engineering.testsPassed > 0 ? "safe" : "neutral"} demo={false} />
          <MetricCard label="Issues discovered" value={String(engineering.issuesDiscovered)} detail="From audits and failures" icon={Bug} tone={engineering.issuesDiscovered > 0 ? "warning" : "neutral"} demo={false} />
          <MetricCard label="Security findings" value={String(engineering.securityFindings)} detail="Recorded by runs" icon={ShieldAlert} tone={engineering.securityFindings > 0 ? "danger" : "neutral"} demo={false} />
        </div>
      </section>

      <section className="mt-6" aria-labelledby="production-title">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="production-title" className="eyebrow">
            Production
          </h2>
          <StatusBadge tone={production.availability === "live" ? "safe" : "neutral"}>
            {production.availability === "live" ? "Live" : "Not Connected"}
          </StatusBadge>
        </div>
        {production.availability === "unavailable" ? (
          <Panel className="flex items-start gap-3 p-4">
            <CloudCog className="mt-0.5 size-4 shrink-0 text-[#5f6b7a]" aria-hidden="true" />
            <p className="text-[11px] leading-5 text-[#7e8a99]">
              No deployment provider is connected, so deployment, failure, and rollback counts are unavailable
              rather than zero. SoftwareFactory is hosted on Vercel, but hosting is not an in-product
              deployment adapter.
            </p>
          </Panel>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Deployments" value={String(production.deployments)} detail="Recorded" icon={CloudCog} tone="safe" demo={false} />
            <MetricCard label="Deployment failures" value={String(production.deploymentFailures)} detail="Recorded" icon={TriangleAlert} tone={production.deploymentFailures ? "danger" : "neutral"} demo={false} />
            <MetricCard label="Rollbacks" value={String(production.rollbacks)} detail="Recorded" icon={RotateCcw} tone={production.rollbacks ? "warning" : "neutral"} demo={false} />
            <MetricCard label="Open incidents" value={String(production.openIncidents)} detail="Unresolved" icon={ShieldAlert} tone={production.openIncidents ? "danger" : "neutral"} demo={false} />
          </div>
        )}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel className="p-5 sm:p-6">
          <SectionTitle
            title="Latest activity"
            description="Immutable tenant audit records."
            action={
              <Link href="/activity" className="text-xs font-semibold text-[#a9be59] hover:text-[#dffb7b]">
                View all
              </Link>
            }
          />
          <div className="mt-5">
            {activity.state !== "ready" ? (
              <p className="text-[11px] text-[#667485]">
                {activity.state === "loading" ? "Loading live activity…" : "Live activity is unavailable."}
              </p>
            ) : (activity.data?.events.length ?? 0) === 0 ? (
              <EmptyPanel
                title="No activity recorded yet"
                description="Material transitions append immutable, tenant-scoped evidence here."
                icon={Activity}
              />
            ) : (
              <div className="divide-y divide-[#202a36]">
                {activity.data?.events.map((event) => (
                  <article key={event.id} className="flex gap-3 py-4 first:pt-0 last:pb-0">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[#60d8ff]" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <h3 className="text-xs font-semibold text-[#dbe0e6]">{event.description}</h3>
                        <time dateTime={event.occurredAt} className="font-mono text-[9px] text-[#566271]">
                          {formatDateTime(event.occurredAt)}
                        </time>
                      </div>
                      <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[#4e5967]">
                        {event.actor.displayName} · {event.project?.name ?? "Organization"}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="border-b border-[#222c39] bg-[#111822] p-5 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Latest CEO report</p>
                <h2 className="mt-2 text-lg font-semibold tracking-[-0.025em] text-white">Daily operating brief</h2>
              </div>
              {report.data?.report ? (
                <StatusBadge
                  tone={
                    report.data.report.posture === "stable"
                      ? "safe"
                      : report.data.report.posture === "attention"
                        ? "warning"
                        : "danger"
                  }
                >
                  {report.data.report.posture}
                </StatusBadge>
              ) : null}
            </div>
            <p className="mt-3 text-xs leading-5 text-[#8490a0]">
              {report.state !== "ready"
                ? "Loading the live report…"
                : report.data?.hasActivity
                  ? report.data.report.summary
                  : "No factory activity was recorded in the last day, so there is nothing to report."}
            </p>
          </div>
          <div className="p-5 sm:p-6">
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  ["Done", report.data?.report.metrics.tasksCompleted],
                  ["PRs", report.data?.report.metrics.pullRequestsCreated],
                  ["Failed", report.data?.report.metrics.runsFailed],
                  ["Blocks", report.data?.report.metrics.blockers],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-[#26313e] bg-[#0a0f16] p-2.5 text-center">
                  <p className="data-value text-lg font-semibold text-white">
                    {report.state === "ready" ? (value ?? 0) : "—"}
                  </p>
                  <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#7a8797]">{label}</p>
                </div>
              ))}
            </div>
            <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8692a1]">
              Recommended next actions
            </h3>
            <ol className="mt-3 space-y-2.5">
              {(report.data?.report.recommendations ?? []).map((recommendation, index) => (
                <li key={recommendation} className="flex gap-3 text-[11px] leading-5 text-[#7c8999]">
                  <span className="grid size-5 shrink-0 place-items-center rounded border border-[#303b49] font-mono text-[9px] text-[#9ca8b6]">
                    {index + 1}
                  </span>
                  {recommendation}
                </li>
              ))}
            </ol>
            <Link href="/reports" style={{ color: "#0c1102" }} className="mt-5 inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#c6f135] px-3.5 text-xs font-bold transition-colors hover:bg-[#d8ff52]">
              Open full report
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}
