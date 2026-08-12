import {
  ArrowUpRight,
  Bug,
  CheckCircle2,
  CloudCog,
  FileCheck2,
  GitMerge,
  GitPullRequestArrow,
  ListChecks,
  RotateCcw,
  ShieldAlert,
  TestTube2,
  TriangleAlert,
} from "lucide-react";

import { DemoBadge, DemoNotice, PageHeader, Panel, SectionTitle, StatusBadge } from "@/components/ui";

const reportMetrics = [
  ["Tasks completed", "8", ListChecks, "safe"],
  ["PRs created", "3", GitPullRequestArrow, "info"],
  ["PRs merged", "2", GitMerge, "safe"],
  ["Deployments", "2", CloudCog, "safe"],
  ["Rollbacks", "0", RotateCcw, "neutral"],
  ["Bugs fixed", "5", Bug, "safe"],
  ["Tests passed", "42", TestTube2, "safe"],
  ["Issues discovered", "6", TriangleAlert, "warning"],
  ["Security findings", "2", ShieldAlert, "danger"],
] as const;

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Intelligence / Daily CEO report"
        title="Daily operating report"
        description="An executive view of outcomes, risk, blockers, decisions, and recommended next moves—clearly separated from unverified operational telemetry."
        action={<div className="flex gap-2"><StatusBadge tone="neutral">Illustrative briefing</StatusBadge><DemoBadge /></div>}
      />
      <DemoNotice>This report is a product example generated from seeded data. It is not a production report and no connected agents or providers produced it.</DemoNotice>

      <Panel className="overflow-hidden">
        <div className="panel-grid border-b border-[#25303c] p-5 sm:p-7">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[#899a4b]">Illustrative daily briefing · 12 Aug 2026</p>
              <h2 className="mt-3 text-balance text-2xl font-semibold tracking-[-0.04em] text-white">Delivery stayed stable while security and release decisions moved to the owner queue.</h2>
              <p className="mt-3 text-xs leading-6 text-[#8290a0]">The example factory completed eight tasks, prepared three pull requests, and recorded no rollback. Two security findings remain open and one delivery decision blocks the next milestone.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-lg border border-[#31411d] bg-[#18210f] px-3 py-2 text-[10px] font-semibold text-[#bed36d]">
              <CheckCircle2 className="size-3.5 text-[#c6f135]" aria-hidden="true" />
              Example posture: stable
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px bg-[#26313d] sm:grid-cols-3 xl:grid-cols-9">
          {reportMetrics.map(([label, value, Icon, tone]) => (
            <div key={label} className="bg-[#0c1118] p-4">
              <Icon className={`size-4 ${tone === "safe" ? "text-[#a9c23e]" : tone === "info" ? "text-[#60d8ff]" : tone === "warning" ? "text-[#ffbe55]" : tone === "danger" ? "text-[#ff747b]" : "text-[#718091]"}`} aria-hidden="true" />
              <p className="data-value mt-4 text-2xl font-semibold text-[#f2f5f7]">{value}</p>
              <p className="mt-1 text-[9px] leading-4 text-[#6a7787]">{label}</p>
            </div>
          ))}
        </div>
      </Panel>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Panel className="p-5 sm:p-6">
          <SectionTitle title="Blockers & findings" description="Items that constrain the next safe move." />
          <div className="mt-5 space-y-3">
            {[
              ["Security", "Medium-severity dependency advisory", "Owner must choose remediation window", "danger"],
              ["Security", "Overbroad example OAuth scope", "Narrow scope before integration", "warning"],
              ["Blocker", "Database change awaiting approval", "No implementation until YELLOW review", "warning"],
            ].map(([type, title, detail, tone]) => (
              <article key={title} className="rounded-lg border border-[#283341] bg-[#0a0f16] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#5c6978]">{type}</span>
                  <StatusBadge tone={tone as "danger" | "warning"} dot={false}>{tone === "danger" ? "Open" : "Review"}</StatusBadge>
                </div>
                <h3 className="mt-2 text-xs font-semibold text-[#d5dbe2]">{title}</h3>
                <p className="mt-1 text-[10px] leading-4 text-[#6c7989]">{detail}</p>
              </article>
            ))}
          </div>
        </Panel>

        <Panel className="p-5 sm:p-6">
          <SectionTitle title="Owner decisions required" description="Explicit choices the factory cannot make on its own." />
          <ol className="mt-5 space-y-3">
            {[
              "Approve or reject the YELLOW database performance change.",
              "Set the remediation deadline for two medium security findings.",
              "Confirm whether mobile performance or reliability leads the next sprint.",
            ].map((decision, index) => (
              <li key={decision} className="flex gap-3 rounded-lg border border-[#2a3542] bg-[#0a0f16] p-3.5">
                <span className="grid size-6 shrink-0 place-items-center rounded border border-[#3a4654] font-mono text-[9px] text-[#b5c164]">{String(index + 1).padStart(2, "0")}</span>
                <p className="text-[11px] leading-5 text-[#8996a5]">{decision}</p>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <Panel className="mt-4 p-5 sm:p-6">
        <SectionTitle title="Top recommended next actions" description="Ranked suggestions require owner review; they are not autonomous instructions." />
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            ["01", "Resolve the security window", "Set ownership and a due date for both findings before delivery scope expands."],
            ["02", "Review database evidence", "Confirm impact, rollback, and observation plan for the queued YELLOW change."],
            ["03", "Lock the sprint outcome", "Choose one measurable outcome so product and engineering work stays bounded."],
          ].map(([rank, title, detail]) => (
            <article key={rank} className="relative overflow-hidden rounded-lg border border-[#2a3542] bg-[#0a0f16] p-4">
              <span className="font-mono text-[9px] font-bold text-[#859529]">{rank}</span>
              <h3 className="mt-3 text-xs font-semibold text-[#d9dfe5]">{title}</h3>
              <p className="mt-2 text-[10px] leading-5 text-[#6e7b8b]">{detail}</p>
              <ArrowUpRight className="absolute right-3 top-3 size-3.5 text-[#485360]" aria-hidden="true" />
            </article>
          ))}
        </div>
      </Panel>

      <div className="mt-4 flex items-center gap-2 text-[9px] leading-4 text-[#566270]">
        <FileCheck2 className="size-3.5 shrink-0" aria-hidden="true" />
        Future reports must derive counts from tenant-scoped auditable records and include source freshness—not model narrative alone.
      </div>
    </>
  );
}
