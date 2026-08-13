"use client";

import { Boxes } from "lucide-react";
import { Children } from "react";

import { ControlPlaneDetail, DetailFacts, useControlPlaneDetail } from "@/components/control-plane-detail";
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
  providerConnectionStatus?: string | null;
  currentAssignment?: string | null;
  lastRunAt: string | null;
  capabilities: string[];
  project?: { id: string; name: string } | null;
};

type AgentDetail = Agent & {
  responsibilities?: string[];
  currentRuns?: Array<{ id: string; title?: string; status: string; project?: { id?: string; name: string } | null }>;
  recentRuns?: Array<{ id: string; title?: string; status: string; startedAt?: string | null; completedAt?: string | null }>;
  runCounts?: { queued?: number; running?: number; succeeded?: number; failed?: number };
};

const requiredRoles = [
  ["orchestrator", "Orchestrator"],
  ["product", "Product"],
  ["architect", "Architect"],
  ["frontend", "Frontend"],
  ["backend", "Backend"],
  ["database", "Database"],
  ["qa", "QA"],
  ["security", "Security"],
  ["performance", "Performance"],
  ["release", "Release"],
  ["ceo_reporter", "CEO Reporter"],
] as const;

function statusTone(status: string) {
  return status === "busy" || status === "active"
    ? "safe"
    : status === "error" || status === "failed"
      ? "danger"
      : "neutral";
}

function runStatusTone(status: string) {
  if (status === "succeeded") return "safe";
  if (["failed", "cancelled", "blocked"].includes(status)) return "danger";
  if (status === "running") return "info";
  return "neutral";
}

function providerConnectionLabel(status?: string | null) {
  const normalized = status?.toLowerCase().replace(/\s+/g, "_");
  if (normalized === "connected") return "Connected";
  if (normalized === "stale") return "Stale";
  if (normalized === "not_connected") return "Not Connected";
  return "Status unavailable";
}

export function AgentsConsole() {
  const { state, reload } = useTenantList<Agent>(
    "/api/agents",
    (body) => (body.agents as Agent[]) ?? [],
    "Agents could not be loaded.",
  );
  const detail = useControlPlaneDetail<AgentDetail>("agents", "agent");

  return (
    <div className="space-y-4">
      <TenantListShell
        state={state}
        reload={reload}
        title="Logical agents"
        icon={Boxes}
        signedOutTitle="Sign in to see your agents"
        signedOutDescription="Agents belong to your workspace."
        returnPath="/solutions/agents"
        emptyTitle="No agents yet"
        emptyDescription="The standard provider-neutral roster is created when Phase 1C orchestration is initialized for your workspace."
      >
        {(agents) => {
          const roles = new Set(agents.map((agent) => agent.role));
          return (
            <div>
              <section className="border-b border-line p-4" aria-labelledby="roster-coverage-title">
                <h3 id="roster-coverage-title" className="text-sm font-semibold text-foreground">Standard roster coverage</h3>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {requiredRoles.map(([role, label]) => (
                    <li key={role}>
                      <StatusBadge tone={roles.has(role) ? "safe" : "warning"} dot={false}>
                        {label} · {roles.has(role) ? "Defined" : "Missing"}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              </section>

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

                    {agent.description ? <p className="mt-3 flex-1 text-sm text-muted">{agent.description}</p> : null}
                    {agent.currentAssignment ? <p className="mt-3 text-sm text-foreground">Current: {agent.currentAssignment}</p> : null}

                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <div className="min-w-0">
                        <dt className="text-faint">Provider</dt>
                        <dd className="truncate text-muted">{agent.provider ?? "None"}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-faint">Connection</dt>
                        <dd className="truncate text-muted">{providerConnectionLabel(agent.providerConnectionStatus)}</dd>
                      </div>
                      <div className="col-span-2 mt-1">
                        <dt className="inline text-faint">Last run </dt>
                        <dd className="inline text-muted">{agent.lastRunAt ? formatDateTime(agent.lastRunAt) : "Never"}</dd>
                      </div>
                    </dl>

                    {agent.capabilities.length ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {agent.capabilities.slice(0, 6).map((capability) => (
                          <span key={capability} className="rounded border border-line px-2 py-1 text-xs text-muted">{capability}</span>
                        ))}
                      </div>
                    ) : null}

                    <button type="button" className="btn btn-secondary btn-sm mt-4 self-start" onClick={() => void detail.open(agent.id)}>
                      View agent
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        }}
      </TenantListShell>

      <ControlPlaneDetail state={detail.state} title="Agent details" onClose={detail.close} onRetry={() => void detail.reload()}>
        {(agent) => (
          <div className="space-y-6 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-foreground">{agent.name}</h3>
                <p className="mt-1 text-sm text-muted">{agent.description ?? "No description has been recorded."}</p>
              </div>
              <StatusBadge tone={statusTone(agent.status)}>{agent.status}</StatusBadge>
            </div>

            <DetailFacts facts={[
              { label: "Logical role", value: agent.role.replace(/_/g, " ") },
              { label: "Provider", value: agent.provider ?? "None" },
              { label: "Model", value: agent.model ?? "None" },
              { label: "Provider state", value: providerConnectionLabel(agent.providerConnectionStatus) },
              { label: "Project", value: agent.project?.name ?? "Organization-wide" },
              { label: "Current assignment", value: agent.currentRuns?.[0]?.title ?? agent.currentAssignment ?? "None" },
              { label: "Last run", value: agent.lastRunAt ? formatDateTime(agent.lastRunAt) : "Never" },
              { label: "Active runs", value: String(agent.currentRuns?.length ?? agent.runCounts?.running ?? 0) },
            ]} />

            <div className="grid gap-4 lg:grid-cols-2">
              <AgentSection title="Responsibilities" empty="No responsibilities have been recorded.">
                {(agent.responsibilities ?? agent.capabilities ?? []).map((item) => <li key={item} className="py-2 text-sm text-muted">{item}</li>)}
              </AgentSection>
              <AgentSection title="Current work" empty="This logical agent has no active assignment.">
                {(agent.currentRuns ?? []).map((run) => (
                  <li key={run.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block text-foreground">{run.title ?? run.id}</span>
                      {run.project ? <span className="text-faint">{run.project.name}</span> : null}
                    </span>
                    <StatusBadge tone={runStatusTone(run.status)}>{run.status}</StatusBadge>
                  </li>
                ))}
              </AgentSection>
            </div>

            <AgentSection title="Recent runs" empty="This logical agent has not completed a run.">
              {(agent.recentRuns ?? []).map((run) => (
                <li key={run.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="block text-foreground">{run.title ?? run.id}</span>
                    <span className="text-faint">{formatDateTime(run.completedAt ?? run.startedAt ?? null)}</span>
                  </span>
                  <StatusBadge tone={runStatusTone(run.status)}>{run.status}</StatusBadge>
                </li>
              ))}
            </AgentSection>
          </div>
        )}
      </ControlPlaneDetail>
    </div>
  );
}

function AgentSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const entries = Children.toArray(children);
  return (
    <section className="rounded-lg border border-line p-4">
      <h3 className="font-semibold text-foreground">{title}</h3>
      {entries.length ? <ul className="mt-2 divide-y divide-[var(--border)]">{children}</ul> : <p className="mt-2 text-sm text-faint">{empty}</p>}
    </section>
  );
}
