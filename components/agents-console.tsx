"use client";

import { Bot, BrainCircuit, Layers3, Loader2, RadioTower, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyPanel, TenantStateGate, formatDateTime } from "@/components/tenant-states";
import { Panel, StatusBadge } from "@/components/ui";
import { postJson, useTenantResource } from "@/lib/client/use-tenant-resource";

type Agent = {
  id: string;
  name: string;
  role: string;
  description: string | null;
  status: string;
  enabled: boolean;
  capabilities: string[];
  provider: string | null;
  providerLabel: string | null;
  providerConnected: boolean;
  model: string | null;
  assignment: { id: string; name: string } | null;
  currentRun: { id: string; status: string; step: string | null } | null;
  metrics: { totalRuns: number; succeededRuns: number; failedRuns: number; successRate: number | null };
  lastRunAt: string | null;
};

type AgentsPayload = {
  canManage: boolean;
  agents: Agent[];
  providers: {
    implemented: Array<{ key: string; label: string; defaultModel: string; models: string[] }>;
    planned: Array<{ key: string; label: string; phase: string; status: { detail: string } }>;
  };
};

function roleIcon(role: string) {
  if (role === "orchestrator") return RadioTower;
  if (role === "security") return ShieldCheck;
  if (role === "ceo_reporter") return BrainCircuit;
  return Bot;
}

export function AgentsConsole() {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const agents = useTenantResource<AgentsPayload>("/api/agents");

  if (agents.state !== "ready" || !agents.data) {
    return <TenantStateGate state={agents.state} message={agents.message} subject="agents" next="/agents" />;
  }

  const data = agents.data;
  const activeCount = data.agents.filter((agent) => agent.currentRun).length;

  async function seedRoster() {
    setBusyId("seed");
    const { ok, body } = await postJson<{ created: number }>("/api/agents", {});
    setMessage(ok ? `Created ${body.created ?? 0} agent role(s).` : (body.error?.message ?? "The roster could not be created."));
    setBusyId(null);
    agents.reload();
  }

  async function updateAgent(agent: Agent, patch: Record<string, unknown>) {
    setBusyId(agent.id);
    const { ok, body } = await postJson("/api/agents", { agentId: agent.id, ...patch }, "PATCH");
    if (!ok) setMessage(body.error?.message ?? "The agent could not be updated.");
    else setMessage("");
    setBusyId(null);
    agents.reload();
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge tone={activeCount > 0 ? "info" : "neutral"}>{activeCount} active</StatusBadge>
          <StatusBadge tone="neutral">{data.agents.length} defined</StatusBadge>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={agents.reload} disabled={agents.refreshing} className="secondary-action">
            {agents.refreshing ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            )}
            Refresh
          </button>
          {data.canManage ? (
            <button type="button" onClick={() => void seedRoster()} disabled={busyId !== null} className="primary-action">
              {busyId === "seed" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="size-3.5" aria-hidden="true" />
              )}
              Create missing roles
            </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <p role="status" className="mb-4 rounded-lg border border-[#2a3542] bg-[#0b1017] p-3 text-[10px] leading-5 text-[#9aa7b7]">
          {message}
        </p>
      ) : null}

      {data.agents.length === 0 ? (
        <Panel>
          <EmptyPanel
            title="No agents defined yet"
            description="Create the built-in roster to define the operating roles this factory can assign work to."
            icon={Bot}
          />
        </Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {data.agents.map((agent) => {
            const Icon = roleIcon(agent.role);
            return (
              <Panel key={agent.id} className="group overflow-hidden p-5 transition-colors hover:border-[#33404f]">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-10 place-items-center rounded-xl border border-[#2c3947] bg-[#151d27] text-[#a5b849]">
                    <Icon className="size-[18px]" aria-hidden="true" />
                  </span>
                  <div className="flex flex-col items-end gap-2">
                    <StatusBadge tone={agent.currentRun ? "info" : agent.enabled ? "safe" : "neutral"}>
                      {agent.currentRun ? "Busy" : agent.enabled ? "Idle" : "Disabled"}
                    </StatusBadge>
                    {data.canManage ? (
                      <button
                        type="button"
                        onClick={() => void updateAgent(agent, { enabled: !agent.enabled })}
                        disabled={busyId === agent.id}
                        className="text-[9px] font-semibold text-[#8391a2] underline-offset-2 hover:text-[#c4ccd5] hover:underline disabled:opacity-50"
                      >
                        {agent.enabled ? "Disable" : "Enable"}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4">
                  <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-[#6b7888]">
                    {agent.role.replace(/_/g, " ")}
                  </p>
                  <h2 className="mt-1.5 text-base font-semibold tracking-[-0.025em] text-[#edf1f4]">{agent.name}</h2>
                  <p className="mt-2 min-h-12 text-[11px] leading-5 text-[#748191]">{agent.description}</p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#26313d] bg-[#26313d]">
                  <Meta
                    label="Provider"
                    value={agent.providerLabel ?? "Organization default"}
                    tone={agent.provider && !agent.providerConnected ? "warning" : "neutral"}
                  />
                  <Meta label="Model" value={agent.model ?? "Organization default"} />
                  <Meta label="Assignment" value={agent.assignment?.name ?? "All projects"} />
                  <Meta label="Last run" value={agent.lastRunAt ? formatDateTime(agent.lastRunAt) : "Never"} />
                </div>

                {agent.metrics.totalRuns > 0 ? (
                  <div className="mt-3 flex items-center gap-3 rounded-lg border border-[#26313d] bg-[#0a0f16] px-3 py-2">
                    <span className="font-mono text-[8px] uppercase tracking-[0.11em] text-[#5c6978]">Success</span>
                    <span className="text-[11px] font-semibold text-[#c4ccd5]">{agent.metrics.successRate}%</span>
                    <span className="ml-auto font-mono text-[9px] text-[#5f6c7c]">
                      {agent.metrics.succeededRuns}/{agent.metrics.totalRuns} runs
                    </span>
                  </div>
                ) : null}

                {agent.currentRun ? (
                  <Link
                    href={`/runs/${agent.currentRun.id}`}
                    className="mt-3 inline-flex text-[10px] font-semibold text-[#a9be59] hover:text-[#dffb7b]"
                  >
                    View current run ({agent.currentRun.step?.replace(/_/g, " ") ?? agent.currentRun.status})
                  </Link>
                ) : null}

                <div className="mt-4">
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#566270]">Capabilities</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {agent.capabilities.map((capability) => (
                      <span
                        key={capability}
                        className="rounded border border-[#2a3542] bg-[#111821] px-2 py-1 text-[9px] text-[#8290a0]"
                      >
                        {capability}
                      </span>
                    ))}
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#26313e] bg-[#0b1017] px-4 py-3 text-[10px] leading-5 text-[#6d7a8a]">
        <Layers3 className="size-4 shrink-0 text-[#849528]" aria-hidden="true" />
        An agent is an operating role, not a provider account. Provider credentials live only in server-side
        settings and are never stored on an agent definition.
      </div>

      {data.providers.planned.length > 0 ? (
        <Panel className="mt-4 p-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#7c8998]">Planned providers</p>
          <ul className="mt-3 space-y-2">
            {data.providers.planned.map((provider) => (
              <li key={provider.key} className="flex items-start justify-between gap-3">
                <span>
                  <span className="text-xs font-semibold text-[#c4ccd5]">{provider.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-[#6a7787]">{provider.status.detail}</span>
                </span>
                <StatusBadge tone="neutral">{provider.phase}</StatusBadge>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}

function Meta({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "warning" }) {
  return (
    <div className="bg-[#0a0f16] p-2.5">
      <p className="font-mono text-[7px] uppercase tracking-[0.11em] text-[#4e5967]">{label}</p>
      <p className={`mt-1 truncate text-[9px] font-medium ${tone === "warning" ? "text-[#e0b978]" : "text-[#8c99a9]"}`}>
        {value}
      </p>
    </div>
  );
}
