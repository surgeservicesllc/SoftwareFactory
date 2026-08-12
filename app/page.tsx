import {
  Activity,
  ArrowRight,
  Bot,
  Bug,
  CheckCircle2,
  CircleDotDashed,
  CloudCog,
  GitMerge,
  GitPullRequestArrow,
  ListTodo,
  PackageCheck,
  Projector,
  RotateCcw,
  ShieldAlert,
  TestTubeDiagonal,
} from "lucide-react";
import Link from "next/link";

import { LiveDashboardMetrics } from "@/components/live-dashboard-metrics";
import {
  DemoBadge,
  DemoNotice,
  MetricCard,
  PageHeader,
  Panel,
  SectionTitle,
  StatusBadge,
} from "@/components/ui";
import { dashboardMetrics, demoActivity, demoReport } from "@/lib/demo-data";

const metricIcons = [
  Projector,
  Bot,
  ListTodo,
  GitPullRequestArrow,
  GitMerge,
  CloudCog,
  TestTubeDiagonal,
  Bug,
  ShieldAlert,
  RotateCcw,
  CircleDotDashed,
] as const;

const illustrativeMetrics = dashboardMetrics.filter((metric) => metric.label !== "Connected projects");

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        eyebrow="Executive overview / Phase 1B"
        title="Factory command center"
        description="A truthful operating view of connected projects, GitHub pull requests, safety posture, and illustrative foundations that are still awaiting live providers."
        action={
          <div className="flex items-center gap-2">
            <StatusBadge tone="safe">Foundation healthy</StatusBadge>
            <DemoBadge />
          </div>
        }
      />

      <LiveDashboardMetrics />

      <DemoNotice>
        The sections below remain illustrative Demo Data. Agent execution, deployment, production telemetry, and autonomous operations are not represented as live.
      </DemoNotice>

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
                <span className="block text-[#5d6877]">Execution locked by design.</span>
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-6 text-[#8490a0]">
                Policy, audit, and approval foundations are being established before any autonomous worker receives production authority.
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
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#7c8998]">Worker status</p>
                <StatusBadge tone="neutral">Not Connected</StatusBadge>
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="p-5 sm:p-6">
          <SectionTitle
            title="Owner attention"
            description="Illustrative items that would block automation."
            action={<DemoBadge />}
          />
          <div className="mt-5 space-y-3">
            {[
              ["Approval needed", "Database index rollout", "YELLOW"],
              ["Security finding", "Dependency advisory review", "2 open"],
              ["Release decision", "Mobile performance milestone", "Pending"],
            ].map(([kind, title, badge], index) => (
              <div key={title} className="rounded-lg border border-[#232e3b] bg-[#0b1017] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[9px] uppercase tracking-[0.13em] text-[#7b8999]">{kind}</span>
                  <StatusBadge tone={index === 0 ? "warning" : index === 1 ? "danger" : "neutral"} dot={false}>
                    {badge}
                  </StatusBadge>
                </div>
                <p className="mt-2 text-xs font-medium text-[#cbd2da]">{title}</p>
              </div>
            ))}
          </div>
          <Link href="/activity" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#a9be59] hover:text-[#dffb7b]">
            Review attention queue
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </Panel>
      </div>

      <section className="mt-6" aria-labelledby="metrics-title">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="metrics-title" className="eyebrow">Operating metrics</h2>
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#536070]">Illustrative 30-day view</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {illustrativeMetrics.map((metric, index) => (
            <MetricCard
              key={metric.label}
              {...metric}
              icon={metricIcons[index] ?? Activity}
              className={undefined}
            />
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel className="p-5 sm:p-6">
          <SectionTitle
            title="Latest activity"
            description="Illustrative audit stream. Live events will originate from immutable activity records."
            action={<DemoBadge />}
          />
          <div className="mt-5 divide-y divide-[#202a36]">
            {demoActivity.map((event) => (
              <article key={event.id} className="flex gap-3 py-4 first:pt-0 last:pb-0">
                <span
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${
                    event.tone === "safe"
                      ? "bg-[#c6f135]"
                      : event.tone === "warning"
                        ? "bg-[#ffbe55]"
                        : event.tone === "danger"
                          ? "bg-[#ff6b72]"
                          : "bg-[#60d8ff]"
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-xs font-semibold text-[#dbe0e6]">{event.action}</h3>
                    <time className="font-mono text-[9px] text-[#566271]">{event.time}</time>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-[#748191]">{event.detail}</p>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[#4e5967]">{event.actor}</p>
                </div>
              </article>
            ))}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="border-b border-[#222c39] bg-[#111822] p-5 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Latest CEO report</p>
                <h2 className="mt-2 text-lg font-semibold tracking-[-0.025em] text-white">Daily operating brief</h2>
              </div>
              <DemoBadge />
            </div>
            <p className="mt-3 text-xs leading-5 text-[#8490a0]">{demoReport.summary}</p>
          </div>
          <div className="p-5 sm:p-6">
            <div className="grid grid-cols-4 gap-2">
              {[
                ["Done", demoReport.completed],
                ["PRs", demoReport.pullRequests],
                ["Deploys", demoReport.deployments],
                ["Blocks", demoReport.blockers],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-[#26313e] bg-[#0a0f16] p-2.5 text-center">
                  <p className="data-value text-lg font-semibold text-white">{value}</p>
                  <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#7a8797]">{label}</p>
                </div>
              ))}
            </div>
            <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8692a1]">Owner decisions</h3>
            <ol className="mt-3 space-y-2.5">
              {demoReport.decisions.map((decision, index) => (
                <li key={decision} className="flex gap-3 text-[11px] leading-5 text-[#7c8999]">
                  <span className="grid size-5 shrink-0 place-items-center rounded border border-[#303b49] font-mono text-[9px] text-[#9ca8b6]">{index + 1}</span>
                  {decision}
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

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#26313e] bg-[#0b1017] px-4 py-3 text-[10px] leading-5 text-[#7b8999]">
        <CheckCircle2 className="size-3.5 shrink-0 text-[#829d29]" aria-hidden="true" />
        Production actions remain disabled. This foundation records intent and policy state; it does not operate external systems.
        <PackageCheck className="ml-auto hidden size-4 text-[#44505f] sm:block" aria-hidden="true" />
      </div>
    </>
  );
}
