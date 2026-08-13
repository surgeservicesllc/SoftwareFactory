"use client";

import { ScrollText } from "lucide-react";

import { TenantListShell, formatDateTime, useTenantList } from "@/components/tenant-list";
import { StatusBadge } from "@/components/ui";

type Report = {
  id: string;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  publishedAt: string | null;
  createdAt: string;
  project: { id: string; name: string } | null;
};

export function ReportsConsole() {
  const { state, reload } = useTenantList<Report>(
    "/api/reports",
    (body) => (body.reports as Report[]) ?? [],
    "Reports could not be loaded.",
  );

  return (
    <TenantListShell
      state={state}
      reload={reload}
      title="Reports"
      icon={ScrollText}
      signedOutTitle="Sign in to see your reports"
      signedOutDescription="Reports belong to your workspace."
      returnPath="/solutions/reports"
      emptyTitle="No reports yet"
      emptyDescription="A daily summary of what got done, what is blocked, and what needs your decision will appear here once agents are connected and producing work."
    >
      {(reports) => (
        <ul className="divide-y divide-[var(--border)]">
          {reports.map((report) => (
            <li key={report.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium text-foreground">{report.title}</h3>
                  <p className="mt-0.5 text-sm text-faint">
                    {report.type.replace(/_/g, " ")}
                    {report.project ? ` · ${report.project.name}` : ""}
                    {" · "}
                    {report.publishedAt
                      ? `published ${formatDateTime(report.publishedAt)}`
                      : `created ${formatDateTime(report.createdAt)}`}
                  </p>
                </div>
                <StatusBadge tone={report.status === "published" ? "safe" : "neutral"}>
                  {report.status}
                </StatusBadge>
              </div>
              {report.summary ? <p className="mt-2 text-sm text-muted">{report.summary}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </TenantListShell>
  );
}
