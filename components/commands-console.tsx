"use client";

import { Bot } from "lucide-react";

import { TenantListShell, formatDateTime, riskTone, useTenantList } from "@/components/tenant-list";
import { StatusBadge } from "@/components/ui";

type Command = {
  id: string;
  prompt: string;
  risk: string;
  status: string;
  submittedAt: string;
  completedAt: string | null;
  project: { id: string; name: string } | null;
};

function statusTone(status: string) {
  if (status === "succeeded") return "safe";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "awaiting_approval") return "warning";
  return "neutral";
}

export function CommandsConsole({ refreshToken }: { refreshToken?: number }) {
  const { state, reload } = useTenantList<Command>(
    // The token is part of the path key so saving a new request re-reads the
    // list without the console needing to know how the composer works.
    `/api/commands${refreshToken ? `?limit=50&_=${refreshToken}` : ""}`,
    (body) => (body.commands as Command[]) ?? [],
    "Saved requests could not be loaded.",
  );

  return (
    <TenantListShell
      state={state}
      reload={reload}
      title="Your requests"
      icon={Bot}
      signedOutTitle="Sign in to see your requests"
      signedOutDescription="Saved requests belong to your workspace."
      returnPath="/solutions/bot-manager"
      emptyTitle="No requests yet"
      emptyDescription="Save your first request above and it will appear here with its risk level and status."
    >
      {(commands) => (
        <ul className="divide-y divide-[var(--border)]">
          {commands.map((command) => (
            <li key={command.id} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{command.prompt}</p>
                <p className="mt-0.5 text-sm text-faint">
                  {command.project?.name ?? "No project"} · saved {formatDateTime(command.submittedAt)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <StatusBadge tone={riskTone(command.risk)}>{command.risk.toUpperCase()}</StatusBadge>
                <StatusBadge tone={statusTone(command.status)} dot={false}>
                  {command.status.replace(/_/g, " ")}
                </StatusBadge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </TenantListShell>
  );
}
