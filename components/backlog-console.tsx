"use client";

import { ClipboardList } from "lucide-react";
import { Children } from "react";

import {
  ControlPlaneDetail,
  DetailFacts,
  ExternalEvidenceLink,
  useControlPlaneDetail,
} from "@/components/control-plane-detail";
import { TenantListShell, formatDateTime, riskTone, useTenantList } from "@/components/tenant-list";
import { StatusBadge } from "@/components/ui";
import { ClearSurfaceButton } from "@/components/clear-surface-button";

type Task = {
  id: string;
  title: string;
  status: string;
  risk: string;
  requiresOwnerApproval: boolean;
  priority: number;
  createdAt: string;
  dependencyCount?: number;
  project: { id: string; name: string } | null;
  agent: { id: string; name: string } | null;
  command?: { id: string; prompt?: string | null } | null;
  latestRun?: { id: string; status: string } | null;
  pullRequest?: { number: number; title?: string; url?: string | null; status?: string; draft?: boolean } | null;
};

type TaskDetail = Task & {
  description?: string | null;
  acceptanceCriteria?: string[];
  dependencies?: Array<{ id: string; title: string; status: string }>;
  dependents?: Array<{ id: string; title: string; status: string }>;
  runs?: Array<{
    id: string;
    status: string;
    createdAt?: string;
    branch?: string | null;
    agent?: { id?: string; name: string } | null;
    pullRequest?: { number: number; url?: string | null; status?: string; draft?: boolean } | null;
  }>;
  pullRequests?: Array<{ number: number; title?: string; url?: string | null; status?: string; draft?: boolean }>;
  blocker?: string | null;
  resultSummary?: string | null;
};

function priorityLabel(priority: number) {
  if (priority >= 80) return "High";
  if (priority >= 40) return "Medium";
  return "Low";
}

function priorityTone(priority: number) {
  return priority >= 80 ? "danger" : priority >= 40 ? "warning" : "neutral";
}

function statusTone(status: string) {
  if (["completed", "succeeded", "passed"].includes(status)) return "safe";
  if (["failed", "cancelled", "blocked"].includes(status)) return "danger";
  if (["in_progress", "running"].includes(status)) return "info";
  if (status === "awaiting_approval") return "warning";
  return "neutral";
}

export function BacklogConsole() {
  const { state, reload } = useTenantList<Task>(
    "/api/tasks",
    (body) => (body.tasks as Task[]) ?? [],
    "The backlog could not be loaded.",
  );
  const detail = useControlPlaneDetail<TaskDetail>("tasks", "task");

  return (
    <div className="space-y-4">
      {/*
        * Owner instruction, 2026-08-22. Above the list rather than inside it,
        * so it is reachable when the list is long — and so it does not look
        * like a per-row control.
        */}
      <div className="flex justify-end">
        <ClearSurfaceButton
          endpoint="/api/tasks/clear"
          label="Clear backlog"
          noun="work item"
          includeFlagName="includeTasksWithRuns"
          includeFlagLabel="Also clear work items that already have run history. Deleting these removes those runs too."
          onCleared={reload}
        />
      </div>

      <TenantListShell
        state={state}
        reload={reload}
        title="Backlog"
        icon={ClipboardList}
        signedOutTitle="Sign in to see your backlog"
        signedOutDescription="Work items belong to your workspace."
        returnPath="/solutions/backlog"
        emptyTitle="Nothing in the backlog"
        emptyDescription="The backlog holds work that has been accepted and planned but has not run yet. Ask a bot for something and it lands here first."
        emptyActionHref="/solutions/bot-manager"
        emptyActionLabel="Give a bot something to do"
      >
        {(tasks) => (
          <>
            <div className="hidden items-center gap-4 border-b border-line px-5 py-3 md:grid md:grid-cols-[minmax(0,1fr)_96px_96px_140px_88px]">
              <p className="label">Work item</p>
              <p className="label">Priority</p>
              <p className="label">Risk</p>
              <p className="label">Status</p>
              <span className="sr-only">Action</span>
            </div>
            <ul className="divide-y divide-[var(--border)]">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_96px_96px_140px_88px] md:items-center md:gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{task.title}</p>
                    <p className="mt-0.5 text-sm text-faint">
                      {task.project?.name ?? "No project"}
                      {task.agent ? ` · ${task.agent.name}` : " · Unassigned"}
                      {task.dependencyCount ? ` · ${task.dependencyCount} dependenc${task.dependencyCount === 1 ? "y" : "ies"}` : ""}
                      {task.requiresOwnerApproval ? " · needs your approval" : ""}
                    </p>
                  </div>
                  <div><StatusBadge tone={priorityTone(task.priority)} dot={false}>{priorityLabel(task.priority)}</StatusBadge></div>
                  <div><StatusBadge tone={riskTone(task.risk)}>{task.risk.toUpperCase()}</StatusBadge></div>
                  <span className="text-sm text-muted">{task.status.replace(/_/g, " ")}</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void detail.open(task.id)}>
                    Details
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </TenantListShell>

      <ControlPlaneDetail state={detail.state} title="Backlog item" onClose={detail.close} onRetry={() => void detail.reload()}>
        {(task) => (
          <div className="space-y-6 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-foreground">{task.title}</h3>
                <p className="mt-1 text-sm text-muted">{task.description ?? task.command?.prompt ?? "No detailed description has been recorded."}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <StatusBadge tone={riskTone(task.risk)}>{task.risk.toUpperCase()}</StatusBadge>
                <StatusBadge tone={statusTone(task.status)}>{task.status.replace(/_/g, " ")}</StatusBadge>
              </div>
            </div>

            <DetailFacts facts={[
              { label: "Project", value: task.project?.name ?? "—" },
              { label: "Assigned agent", value: task.agent?.name ?? "Unassigned" },
              { label: "Priority", value: `${priorityLabel(task.priority)} · ${task.priority}` },
              { label: "Created", value: formatDateTime(task.createdAt) },
              { label: "Command", value: task.command?.id ?? "—" },
              { label: "Owner approval", value: task.requiresOwnerApproval ? "Required" : "Not required" },
              { label: "Latest run", value: task.latestRun?.id ?? task.runs?.[0]?.id ?? "—" },
              { label: "Result", value: task.resultSummary ?? "—" },
            ]} />

            {task.blocker ? (
              <p className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger)]">
                Blocked: {task.blocker}
              </p>
            ) : null}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <TaskSection title="Acceptance criteria" empty="No acceptance criteria have been recorded.">
                {(task.acceptanceCriteria ?? []).map((criterion, index) => <li key={`${index}-${criterion}`} className="py-2 text-sm text-muted">{criterion}</li>)}
              </TaskSection>
              <TaskSection title="Dependencies" empty="This item has no recorded dependencies.">
                {(task.dependencies ?? []).map((dependency) => (
                  <li key={dependency.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-foreground">{dependency.title}</span>
                    <StatusBadge tone={statusTone(dependency.status)}>{dependency.status.replace(/_/g, " ")}</StatusBadge>
                  </li>
                ))}
              </TaskSection>
            </div>

            <TaskSection title="Runs" empty="No run has been created for this item.">
              {(task.runs ?? []).map((run) => (
                <li key={run.id} className="flex flex-col gap-2 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="block font-mono text-xs text-faint">{run.id}</span>
                    <span className="text-muted">{run.agent?.name ?? "Unassigned"}{run.branch ? ` · ${run.branch}` : ""}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {run.pullRequest ? <ExternalEvidenceLink href={run.pullRequest.url}>PR #{run.pullRequest.number}</ExternalEvidenceLink> : null}
                    <StatusBadge tone={statusTone(run.status)}>{run.status.replace(/_/g, " ")}</StatusBadge>
                  </span>
                </li>
              ))}
            </TaskSection>

            <TaskSection title="Pull requests" empty="No pull request is linked to this backlog item.">
              {(task.pullRequests ?? (task.pullRequest ? [task.pullRequest] : [])).map((pullRequest) => (
                <li key={pullRequest.number} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <ExternalEvidenceLink href={pullRequest.url}>PR #{pullRequest.number}{pullRequest.title ? ` · ${pullRequest.title}` : ""}</ExternalEvidenceLink>
                  <StatusBadge tone="neutral">{pullRequest.draft ? "draft" : pullRequest.status ?? "open"}</StatusBadge>
                </li>
              ))}
            </TaskSection>
          </div>
        )}
      </ControlPlaneDetail>
    </div>
  );
}

function TaskSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const entries = Children.toArray(children);
  return (
    <section className="rounded-lg border border-line p-4">
      <h3 className="font-semibold text-foreground">{title}</h3>
      {entries.length ? <ul className="mt-2 divide-y divide-[var(--border)]">{children}</ul> : <p className="mt-2 text-sm text-faint">{empty}</p>}
    </section>
  );
}
