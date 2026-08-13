"use client";

import { Boxes } from "lucide-react";

import { TenantListShell, formatDateTime, useTenantList } from "@/components/tenant-list";
import { StatusBadge } from "@/components/ui";

type Agent = {
  id: string;
  name: string;
  role: string;
  description: string | null;
  status: string;
  provider: string | null;
  model: string | null;
  lastRunAt: string | null;
  capabilities: string[];
};

function statusTone(status: string) {
  return status === "busy" || status === "idle" ? "safe" : status === "error" ? "danger" : "neutral";
}

export function AgentsConsole() {
  const { state, reload } = useTenantList<Agent>(
    "/api/agents",
    (body) => (body.agents as Agent[]) ?? [],
    "Agents could not be loaded.",
  );

  return (
    <TenantListShell
      state={state}
      reload={reload}
      title="Agents"
      icon={Boxes}
      signedOutTitle="Sign in to see your agents"
      signedOutDescription="Agents belong to your workspace."
      returnPath="/agents"
      emptyTitle="No agents yet"
      emptyDescription="Agents appear here once they are defined for your workspace. None can run until an AI provider is connected."
    >
      {(agents) => (
        <ul className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <li key={agent.id} className="card-inset flex flex-col p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-foreground">{agent.name}</h3>
                  <p className="text-sm text-faint">{agent.role.replace(/_/g, " ")}</p>
                </div>
                <StatusBadge tone={statusTone(agent.status)}>{agent.status}</StatusBadge>
              </div>

              {agent.description ? (
                <p className="mt-3 flex-1 text-sm text-muted">{agent.description}</p>
              ) : null}

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="flex gap-1.5">
                  <dt className="text-faint">Provider</dt>
                  <dd className="truncate text-muted">{agent.provider ?? "None"}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-faint">Model</dt>
                  <dd className="truncate text-muted">{agent.model ?? "None"}</dd>
                </div>
                <div className="col-span-2 flex gap-1.5">
                  <dt className="text-faint">Last run</dt>
                  <dd className="text-muted">{agent.lastRunAt ? formatDateTime(agent.lastRunAt) : "Never"}</dd>
                </div>
              </dl>

              {agent.capabilities.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {agent.capabilities.map((capability) => (
                    <span key={capability} className="rounded border border-line px-2 py-1 text-xs text-muted">
                      {capability}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </TenantListShell>
  );
}
