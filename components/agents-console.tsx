"use client";

import { AlertTriangle, Boxes, Loader2, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { Children, useCallback, useEffect, useState } from "react";

import { ControlPlaneDetail, DetailFacts, useControlPlaneDetail } from "@/components/control-plane-detail";
import type {
  ProviderModelConfiguration,
  ProviderStatusPayload,
} from "@/components/provider-status-panel";
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

type ProviderCatalogState =
  | { kind: "idle" | "loading" }
  | { kind: "ready"; payload: ProviderStatusPayload }
  | { kind: "error"; message: string };

type AssignmentFeedback =
  | { kind: "success" | "error"; message: string }
  | null;

const AUTOMATIC_ASSIGNMENT = "__automatic__";
const ASSIGNMENT_SEPARATOR = "|";

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

function assignmentConfigurationLabel(status?: string | null) {
  const normalized = status?.toLowerCase().replace(/\s+/g, "_");
  if (normalized === "configured") return "Configured";
  if (normalized === "not_configured") return "Not configured";
  return "Not recorded";
}

function providerDisplayName(provider?: string | null) {
  if (provider === "anthropic") return "Anthropic / Claude";
  if (provider === "openai") return "OpenAI / Codex";
  return provider ?? "Automatic routing";
}

function assignmentValue(agent: Pick<Agent, "provider" | "model">) {
  if (!agent.provider) return AUTOMATIC_ASSIGNMENT;
  return `${agent.provider}${ASSIGNMENT_SEPARATOR}${agent.model ?? ""}`;
}

function parseAssignmentValue(value: string) {
  if (value === AUTOMATIC_ASSIGNMENT) {
    return { provider: null, model: null } as const;
  }

  const separatorIndex = value.indexOf(ASSIGNMENT_SEPARATOR);
  if (separatorIndex <= 0) return null;
  const provider = value.slice(0, separatorIndex);
  const model = value.slice(separatorIndex + ASSIGNMENT_SEPARATOR.length);
  if (provider !== "anthropic" && provider !== "openai") return null;
  return { provider, model: model || null } as const;
}

function useAgentProviderCatalog(enabled: boolean) {
  const [state, setState] = useState<ProviderCatalogState>({ kind: "idle" });

  const load = useCallback(async () => {
    if (!enabled) return;
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/providers", { cache: "no-store" });
      const body = (await response.json()) as ProviderStatusPayload & {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Provider assignment data is unavailable.");
      }
      setState({ kind: "ready", payload: body });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error
          ? error.message
          : "Provider assignment data is unavailable.",
      });
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [enabled, load]);

  return { state, reload: load } as const;
}

export function AgentsConsole() {
  const { state, reload } = useTenantList<Agent>(
    "/api/agents",
    (body) => (body.agents as Agent[]) ?? [],
    "Agents could not be loaded.",
  );
  const detail = useControlPlaneDetail<AgentDetail>("agents", "agent");
  const providerCatalog = useAgentProviderCatalog(state.kind === "ready");
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const [rosterPending, setRosterPending] = useState(false);
  const [feedback, setFeedback] = useState<AssignmentFeedback>(null);

  const providerPayload = providerCatalog.state.kind === "ready"
    ? providerCatalog.state.payload
    : null;
  const organizationRole = providerPayload?.organization?.role ?? null;
  const canManageAssignments = organizationRole === "owner" || organizationRole === "admin";
  const assignableModels = (providerPayload?.providers ?? []).flatMap((provider) =>
    provider.configuredModels.filter((model) => model.enabled),
  );

  async function initializeRoster() {
    setRosterPending(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "The standard roster could not be initialized.");
      }
      setFeedback({ kind: "success", message: "The standard logical-agent roster is ready." });
      await reload();
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error
          ? error.message
          : "The standard roster could not be initialized.",
      });
    } finally {
      setRosterPending(false);
    }
  }

  async function assignProvider(agent: Agent, value: string) {
    const assignment = parseAssignmentValue(value);
    if (!assignment || !canManageAssignments) return;

    setPendingAgentId(agent.id);
    setFeedback(null);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/assignment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assignment),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "The provider assignment could not be saved.");
      }

      setFeedback({
        kind: "success",
        message: assignment.provider
          ? `${agent.name} now prefers ${providerDisplayName(assignment.provider)}${assignment.model ? ` / ${assignment.model}` : ""}.`
          : `${agent.name} now uses automatic per-run routing.`,
      });
      const detailRefresh = detail.state.kind !== "idle" && detail.state.id === agent.id
        ? detail.open(agent.id)
        : Promise.resolve();
      await Promise.all([Promise.resolve(reload()), detailRefresh]);
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error
          ? error.message
          : "The provider assignment could not be saved.",
      });
    } finally {
      setPendingAgentId(null);
    }
  }

  const rosterAction = state.kind === "ready" && state.items.length === 0 ? (
    <button
      type="button"
      className="btn btn-primary"
      disabled={rosterPending}
      onClick={() => void initializeRoster()}
    >
      {rosterPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      Initialize standard roster
    </button>
  ) : null;

  return (
    <div className="space-y-4">
      {state.kind === "ready" ? (
        <ProviderAssignmentBoundary
          catalog={providerCatalog.state}
          canManage={canManageAssignments}
          feedback={feedback}
          onRetry={() => void providerCatalog.reload()}
        />
      ) : null}

      <TenantListShell
        state={state}
        reload={reload}
        title="Logical agents"
        icon={Boxes}
        signedOutTitle="Sign in to see your agents"
        signedOutDescription="Agents belong to your workspace."
        returnPath="/solutions/agents"
        emptyTitle="No agents yet"
        emptyDescription="Initialize the provider-neutral roster to define the eleven standard logical roles for this workspace."
        action={rosterAction}
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

              <ul className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                {agents.map((agent) => (
                  <li key={agent.id} className="card-inset flex flex-col p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-foreground">{agent.name}</h3>
                        <p className="text-sm text-faint">{agent.role.replace(/_/g, " ")}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <StatusBadge tone={statusTone(agent.status)}>{agent.status}</StatusBadge>
                        <StatusBadge tone={agent.provider ? "info" : "neutral"} dot={false}>
                          {agent.provider ? "Assigned" : "Automatic"}
                        </StatusBadge>
                      </div>
                    </div>

                    {agent.description ? <p className="mt-3 flex-1 text-sm text-muted">{agent.description}</p> : null}
                    {agent.currentAssignment ? <p className="mt-3 text-sm text-foreground">Current: {agent.currentAssignment}</p> : null}

                    <AgentAssignmentControl
                      agent={agent}
                      catalog={providerCatalog.state}
                      models={assignableModels}
                      canManage={canManageAssignments}
                      pending={pendingAgentId === agent.id}
                      onChange={(value) => void assignProvider(agent, value)}
                    />

                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <div className="min-w-0">
                        <dt className="text-faint">Provider</dt>
                        <dd className="truncate text-muted">{providerDisplayName(agent.provider)}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-faint">Model</dt>
                        <dd className="truncate text-muted">{agent.model ?? "Chosen per run"}</dd>
                      </div>
                      <div className="col-span-2 mt-1 min-w-0">
                        <dt className="inline text-faint">Provider state </dt>
                        <dd className="inline text-muted">{liveProviderStateLabel(agent.provider, providerCatalog.state)}</dd>
                      </div>
                      <div className="col-span-2 min-w-0">
                        <dt className="inline text-faint">Assignment configuration </dt>
                        <dd className="inline text-muted">{assignmentConfigurationLabel(agent.providerConnectionStatus)}</dd>
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
        {(agent) => {
          const projectedAgent = state.kind === "ready"
            ? state.items.find((entry) => entry.id === agent.id) ?? agent
            : agent;
          return (
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
              { label: "Provider", value: providerDisplayName(projectedAgent.provider) },
              { label: "Model", value: projectedAgent.model ?? "Chosen per run" },
              { label: "Provider state", value: liveProviderStateLabel(projectedAgent.provider, providerCatalog.state) },
              { label: "Project", value: agent.project?.name ?? "Organization-wide" },
              { label: "Current assignment", value: agent.currentRuns?.[0]?.title ?? agent.currentAssignment ?? "None" },
              { label: "Last run", value: agent.lastRunAt ? formatDateTime(agent.lastRunAt) : "Never" },
              { label: "Active runs", value: String(agent.currentRuns?.length ?? agent.runCounts?.running ?? 0) },
            ]} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
          );
        }}
      </ControlPlaneDetail>
    </div>
  );
}

function ProviderAssignmentBoundary({
  catalog,
  canManage,
  feedback,
  onRetry,
}: {
  catalog: ProviderCatalogState;
  canManage: boolean;
  feedback: AssignmentFeedback;
  onRetry: () => void;
}) {
  const roleKnown = catalog.kind === "ready" && Boolean(catalog.payload.organization?.role);

  return (
    <section className="card-inset p-4 sm:p-5" aria-labelledby="provider-assignment-title">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" aria-hidden="true" />
            <h2 id="provider-assignment-title" className="font-semibold text-foreground">
              Logical-agent provider assignment
            </h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted">
            An assignment stores only a provider and model routing preference. The logical agent,
            project, provider account, and server-side credential remain separate records. A saved
            assignment does not prove a live provider connection or enable outbound execution.
          </p>
        </div>

        <Link href="/solutions/settings" className="btn btn-secondary btn-sm shrink-0 self-start">
          Provider settings
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Current provider states">
        {catalog.kind === "ready" ? (
          <>
            <StatusBadge tone={catalog.payload.executionEnabled ? "warning" : "neutral"}>
              {catalog.payload.executionEnabled ? "Execution enabled" : "Execution OFF"}
            </StatusBadge>
            {catalog.payload.providers.map((provider) => (
              <span key={provider.provider} className="inline-flex items-center gap-2">
                <span className="text-xs text-faint">{provider.label}</span>
                <StatusBadge tone={provider.state === "connected" ? "safe" : "danger"}>
                  {provider.state === "connected" ? "Connected" : "Not Connected"}
                </StatusBadge>
                {provider.state !== "connected" ? (
                  <span className="text-xs text-faint">{provider.stateLabel}</span>
                ) : null}
              </span>
            ))}
          </>
        ) : catalog.kind === "error" ? (
          <>
            <StatusBadge tone="danger">Not Connected</StatusBadge>
            <span className="text-sm text-muted">{catalog.message}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry provider status
            </button>
          </>
        ) : (
          <>
            <Loader2 className="size-4 animate-spin text-accent" aria-hidden="true" />
            <span className="text-sm text-muted">Checking the provider catalogue and live state...</span>
          </>
        )}
      </div>

      <p className="mt-3 flex items-start gap-2 text-sm text-muted">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" aria-hidden="true" />
        {canManage
          ? "You can assign enabled catalogue models or return any agent to automatic per-run routing."
          : roleKnown
            ? "Assignments are read-only for this workspace role. An owner or administrator can change them."
            : "Assignment controls stay unavailable until manager access and the bounded provider catalogue are verified."}
      </p>

      {feedback ? (
        <p
          className={`mt-3 rounded-lg border p-3 text-sm ${feedback.kind === "error" ? "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger)]" : "border-[var(--accent-border)] bg-[var(--accent-surface)] text-[var(--accent-text)]"}`}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}
    </section>
  );
}

function AgentAssignmentControl({
  agent,
  catalog,
  models,
  canManage,
  pending,
  onChange,
}: {
  agent: Agent;
  catalog: ProviderCatalogState;
  models: ProviderModelConfiguration[];
  canManage: boolean;
  pending: boolean;
  onChange: (value: string) => void;
}) {
  const value = assignmentValue(agent);
  const currentIsAvailable = value === AUTOMATIC_ASSIGNMENT || models.some(
    (model) => `${model.provider}${ASSIGNMENT_SEPARATOR}${model.model}` === value,
  );
  const controlsReady = catalog.kind === "ready" && canManage;
  const helpId = `agent-assignment-help-${agent.id}`;

  return (
    <label className="mt-4 block">
      <span className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-faint">
        Provider and model
        {pending ? <Loader2 className="size-4 animate-spin" aria-label="Saving assignment" /> : null}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={!controlsReady || pending}
        aria-label={`Provider assignment for ${agent.name}`}
        aria-describedby={helpId}
        className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
      >
        <option value={AUTOMATIC_ASSIGNMENT}>Automatic routing (chosen per run)</option>
        {!currentIsAvailable ? (
          <option value={value}>
            {providerDisplayName(agent.provider)} / {agent.model ?? "provider default"} (current, not enabled)
          </option>
        ) : null}
        {models.map((model) => (
          <option
            key={`${model.provider}${ASSIGNMENT_SEPARATOR}${model.model}`}
            value={`${model.provider}${ASSIGNMENT_SEPARATOR}${model.model}`}
          >
            {model.displayName} ({providerDisplayName(model.provider)})
          </option>
        ))}
      </select>
      <span id={helpId} className="mt-1.5 block text-xs leading-5 text-faint">
        {catalog.kind === "error"
          ? "Provider catalogue unavailable; the current assignment remains unchanged."
          : catalog.kind !== "ready"
            ? "Checking enabled provider models..."
            : !canManage
              ? "Read-only. Owner or administrator access is required to save an assignment."
              : models.length === 0
                ? "No enabled models are configured. Automatic routing remains selected."
                : "Only enabled catalogue models are shown; credentials never enter this control."}
      </span>
    </label>
  );
}

function liveProviderStateLabel(provider: string | null | undefined, catalog: ProviderCatalogState) {
  if (!provider) return "Resolved per run; no provider connection is implied";
  if (catalog.kind === "error") return "Not Connected - provider status unavailable";
  if (catalog.kind !== "ready") return "Checking current provider state";

  const status = catalog.payload.providers.find((entry) => entry.provider === provider);
  if (status?.state === "connected") return "Connected - verified by the current live probe";
  return `Not Connected${status?.stateLabel ? ` - ${status.stateLabel}` : ""}`;
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
