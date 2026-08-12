"use client";

import { GitBranch } from "lucide-react";

import { TenantListShell, formatDateTime, formatDuration, useTenantList } from "@/components/tenant-list";
import { StatusBadge } from "@/components/ui";

type Run = {
  id: string;
  status: string;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  durationMs: number | null;
  task: { id: string; title: string } | null;
  agent: { id: string; name: string } | null;
};

function statusTone(status: string) {
  if (status === "succeeded") return "safe";
  if (status === "failed") return "danger";
  if (status === "running") return "info";
  return "neutral";
}

export function RunsConsole() {
  const { state, reload } = useTenantList<Run>(
    "/api/runs",
    (body) => (body.runs as Run[]) ?? [],
    "Runs could not be loaded.",
  );

  return (
    <TenantListShell
      state={state}
      reload={reload}
      title="Runs"
      icon={GitBranch}
      signedOutTitle="Sign in to see your runs"
      signedOutDescription="Run history belongs to your workspace."
      returnPath="/runs"
      emptyTitle="Nothing has run yet"
      emptyDescription="Every job an agent performs is recorded here so you can check the work afterwards. No AI worker is connected, so nothing has run."
    >
      {(runs) => (
        <ul className="divide-y divide-[var(--border)]">
          {runs.map((run) => (
            <li key={run.id} className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{run.task?.title ?? "Untitled work"}</p>
                <p className="mt-0.5 text-sm text-muted">
                  {run.agent?.name ?? "Unassigned"} · started {formatDateTime(run.startedAt ?? run.createdAt)}
                </p>
                {run.errorMessage ? (
                  <p className="mt-1 text-sm text-[var(--danger)]">{run.errorMessage}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 md:shrink-0">
                <div>
                  <p className="label">Status</p>
                  <div className="mt-1">
                    <StatusBadge tone={statusTone(run.status)}>{run.status}</StatusBadge>
                  </div>
                </div>
                <div>
                  <p className="label">Took</p>
                  <p className="mt-1 text-sm text-muted">{formatDuration(run.durationMs)}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </TenantListShell>
  );
}
