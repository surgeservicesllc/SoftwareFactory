"use client";

import { ClipboardList } from "lucide-react";

import { TenantListShell, riskTone, useTenantList } from "@/components/tenant-list";
import { StatusBadge } from "@/components/ui";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  risk: string;
  requiresOwnerApproval: boolean;
  priority: number;
  createdAt: string;
  project: { id: string; name: string } | null;
  agent: { id: string; name: string } | null;
};

/** 0-100 in the database; people read three bands more easily than a number. */
function priorityLabel(priority: number) {
  if (priority >= 80) return "High";
  if (priority >= 40) return "Medium";
  return "Low";
}

function priorityTone(priority: number) {
  return priority >= 80 ? "danger" : priority >= 40 ? "warning" : "neutral";
}

export function BacklogConsole() {
  const { state, reload } = useTenantList<Task>(
    "/api/tasks",
    (body) => (body.tasks as Task[]) ?? [],
    "The backlog could not be loaded.",
  );

  return (
    <TenantListShell
      state={state}
      reload={reload}
      title="Backlog"
      icon={ClipboardList}
      signedOutTitle="Sign in to see your backlog"
      signedOutDescription="Work items belong to your workspace."
      returnPath="/backlog"
      emptyTitle="Nothing in the backlog"
      emptyDescription="Work items appear here when a request is saved or an agent plans work."
    >
      {(tasks) => (
        <>
          <div className="hidden items-center gap-4 border-b border-line px-5 py-3 md:grid md:grid-cols-[minmax(0,1fr)_96px_96px_140px]">
            <p className="label">Work item</p>
            <p className="label">Priority</p>
            <p className="label">Risk</p>
            <p className="label">Status</p>
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="grid gap-2 px-5 py-4 md:grid-cols-[minmax(0,1fr)_96px_96px_140px] md:items-center md:gap-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{task.title}</p>
                  <p className="mt-0.5 text-sm text-faint">
                    {task.project?.name ?? "No project"}
                    {task.agent ? ` · ${task.agent.name}` : ""}
                    {task.requiresOwnerApproval ? " · needs your approval" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:contents">
                  <div>
                    <StatusBadge tone={priorityTone(task.priority)} dot={false}>
                      {priorityLabel(task.priority)}
                    </StatusBadge>
                  </div>
                  <div>
                    <StatusBadge tone={riskTone(task.risk)}>{task.risk.toUpperCase()}</StatusBadge>
                  </div>
                  <span className="text-sm text-muted">{task.status.replace(/_/g, " ")}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </TenantListShell>
  );
}
