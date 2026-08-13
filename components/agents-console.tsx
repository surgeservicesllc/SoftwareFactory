"use client";

import { Bot, BrainCircuit, Loader2, RadioTower, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  useProviderStatus,
  type ProviderModelConfiguration,
} from "@/components/provider-status-panel";
import { EmptyState, Panel, StatusBadge } from "@/components/ui";

type Agent = {
  id: string;
  name: string;
  role: string;
  description: string | null;
  status: string;
  provider: string | null;
  providerLabel: string | null;
  model: string | null;
  lastRunAt: string | null;
};

type LoadState = "loading" | "signed-out" | "ready" | "error";

const AUTOMATIC = "__automatic__";

/**
 * Logical agents and their provider assignments.
 *
 * An agent is a role. Assigning it a provider chooses which model executes its
 * work; it never binds the agent to a provider account, and clearing the
 * assignment returns the agent to automatic routing.
 */
export function AgentsConsole() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const { payload: providerPayload } = useProviderStatus();

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const response = await fetch("/api/agents", { cache: "no-store" });
      if (response.status === 401) {
        setLoadState("signed-out");
        return;
      }
      const body = (await response.json()) as { agents?: Agent[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Agents could not be loaded.");
      setAgents(body.agents ?? []);
      setLoadState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Agents could not be loaded.");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    // Deferred a tick so the initial load does not set state synchronously
    // inside the effect body, matching the other consoles in this app.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function seedRoster() {
    setSeeding(true);
    setMessage("");
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as { agents?: Agent[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The agent roster could not be created.");
      setAgents(body.agents ?? []);
      setMessage("The standard agent roster is in place.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The agent roster could not be created.");
    } finally {
      setSeeding(false);
    }
  }

  async function assign(agentId: string, value: string) {
    setPendingAgentId(agentId);
    setMessage("");
    const [provider, model] = value === AUTOMATIC ? [null, null] : value.split("::");

    try {
      const response = await fetch(`/api/agents/${agentId}/assignment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model: model ?? null }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The assignment could not be saved.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The assignment could not be saved.");
    } finally {
      setPendingAgentId(null);
    }
  }

  const assignableModels: ProviderModelConfiguration[] = (providerPayload?.providers ?? []).flatMap(
    (provider) => provider.configuredModels.filter((model) => model.enabled),
  );

  if (loadState === "loading") {
    return (
      <Panel className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-[#c6f135]" aria-label="Loading agents" />
      </Panel>
    );
  }

  if (loadState === "signed-out") {
    return (
      <EmptyState
        title="Authentication required"
        description="Sign in with the SoftwareFactory owner account to manage the agent roster."
      />
    );
  }

  if (loadState === "error") {
    return (
      <Panel className="p-5">
        <p className="text-xs text-[#e59399]">{message}</p>
        <button type="button" onClick={() => void load()} className="secondary-action mt-4">
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Retry
        </button>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#e4e9ed]">
            <Sparkles className="size-4 text-[#c6f135]" aria-hidden="true" />
            Agents are roles, not provider accounts
          </div>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-[#748191]">
            Each agent can be bound to a provider and model, or left on automatic routing so the
            Orchestrator scores the options at run time. Only models enabled in the provider
            catalogue are assignable.
          </p>
          {message ? (
            <p className="mt-3 text-[11px] text-[#d7b96d]" aria-live="polite">
              {message}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void seedRoster()}
          disabled={seeding}
          className="primary-action justify-center"
        >
          {seeding ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {agents.length ? "Re-check roster" : "Create standard roster"}
        </button>
      </Panel>

      {agents.length === 0 ? (
        <EmptyState
          title="No agents defined"
          description="Create the standard roster to define the Orchestrator, Product Manager, Architect, engineering, QA, Security, Performance, Release, and CEO Reporter roles."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {agents.map((agent) => (
            <Panel key={agent.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 place-items-center rounded-xl border border-[#2c3947] bg-[#151d27] text-[#a5b849]">
                  {agent.role === "orchestrator" ? (
                    <RadioTower className="size-[18px]" aria-hidden="true" />
                  ) : agent.role === "security" ? (
                    <ShieldCheck className="size-[18px]" aria-hidden="true" />
                  ) : agent.role === "ceo_reporter" ? (
                    <BrainCircuit className="size-[18px]" aria-hidden="true" />
                  ) : (
                    <Bot className="size-[18px]" aria-hidden="true" />
                  )}
                </span>
                <StatusBadge tone={agent.provider ? "safe" : "neutral"}>
                  {agent.provider ? "Assigned" : "Automatic"}
                </StatusBadge>
              </div>

              <div className="mt-4">
                <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-[#6b7888]">
                  {agent.role.replace(/_/g, " ")}
                </p>
                <h2 className="mt-1.5 text-base font-semibold tracking-[-0.025em] text-[#edf1f4]">
                  {agent.name}
                </h2>
                <p className="mt-2 min-h-12 text-[11px] leading-5 text-[#748191]">
                  {agent.description ?? "No description recorded."}
                </p>
              </div>

              <label className="mt-4 block">
                <span className="mb-2 block font-mono text-[8px] uppercase tracking-[0.12em] text-[#566270]">
                  Provider and model
                </span>
                <select
                  value={agent.provider && agent.model ? `${agent.provider}::${agent.model}` : AUTOMATIC}
                  onChange={(event) => void assign(agent.id, event.target.value)}
                  disabled={pendingAgentId === agent.id}
                  aria-label={`Provider assignment for ${agent.name}`}
                  className="h-9 w-full rounded-lg border border-[#2b3644] bg-[#0a0f16] px-3 text-[11px] text-[#d8dee5] disabled:cursor-not-allowed disabled:text-[#687586]"
                >
                  <option value={AUTOMATIC}>Automatic routing</option>
                  {assignableModels.map((model) => (
                    <option key={`${model.provider}::${model.model}`} value={`${model.provider}::${model.model}`}>
                      {model.displayName} ({model.provider})
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#26313d] bg-[#26313d]">
                <Meta label="Provider" value={agent.providerLabel ?? "Automatic"} />
                <Meta label="Model" value={agent.model ?? "Chosen at run time"} />
                <Meta label="Status" value={agent.status} />
                <Meta
                  label="Last run"
                  value={
                    agent.lastRunAt
                      ? new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(agent.lastRunAt))
                      : "Never"
                  }
                />
              </div>
            </Panel>
          ))}
        </div>
      )}

      {assignableModels.length === 0 ? (
        <p className="rounded-lg border border-[#423824] bg-[#221c11] px-4 py-3 text-[10px] leading-5 text-[#b6a77f]">
          No models are enabled in the provider catalogue yet, so every agent stays on automatic
          routing. Add a model in Settings before assigning one to an agent.
        </p>
      ) : null}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0a0f16] p-2.5">
      <p className="font-mono text-[7px] uppercase tracking-[0.11em] text-[#4e5967]">{label}</p>
      <p className="mt-1 truncate text-[9px] font-medium text-[#8c99a9]">{value}</p>
    </div>
  );
}
