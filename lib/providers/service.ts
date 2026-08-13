import "server-only";

import { resolveProviderConfiguration } from "@/lib/providers/config";
import {
  buildProviderAvailability,
  snapshotProviderHealth,
  type ProviderObservedMetrics,
} from "@/lib/providers/registry";
import type { ProjectRoutingPolicy, ProviderAvailability } from "@/lib/providers/routing";
import { formatEstimatedCost } from "@/lib/providers/usage";
import {
  PROVIDER_CONNECTION_STATE_LABELS,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  isProviderId,
  type ProviderConnectionState,
  type ProviderHealth,
  type ProviderId,
} from "@/lib/providers/types";
import type { RiskLevel } from "@/lib/risk";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Database-backed views over the provider layer.
 *
 * Everything returned here is browser-safe: connection state, model metadata,
 * routing evidence and usage totals. No credential, prompt body, or provider
 * response text crosses this boundary.
 */

export interface ProviderModelConfigurationView {
  readonly id: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly displayName: string;
  readonly capabilities: readonly string[];
  readonly enabled: boolean;
  readonly isDefault: boolean;
  readonly inputCostPerMillionMicros: number | null;
  readonly outputCostPerMillionMicros: number | null;
}

export interface ProviderStatusView {
  readonly provider: ProviderId;
  readonly label: string;
  readonly state: ProviderConnectionState;
  readonly stateLabel: string;
  readonly detail: string;
  readonly checkedAt: string;
  readonly latencyMs: number | null;
  readonly defaultModel: string | null;
  readonly configuredModels: readonly ProviderModelConfigurationView[];
  /** Names only. Values never leave the server. */
  readonly environmentVariableNames: readonly string[];
}

interface ModelConfigurationRow {
  id: string;
  provider: string;
  model: string;
  display_name: string;
  capabilities: unknown;
  enabled: boolean;
  is_default: boolean;
  input_cost_per_million_micros: string | number | null;
  output_cost_per_million_micros: string | number | null;
}

function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCapabilityList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.filter((entry): entry is string => typeof entry === "string").slice(0, 32),
  );
}

export async function listModelConfigurations(
  client: ServerClient,
  organizationId: string,
): Promise<readonly ProviderModelConfigurationView[]> {
  const { data, error } = await client
    .from("provider_model_configurations")
    .select(
      "id,provider,model,display_name,capabilities,enabled,is_default,input_cost_per_million_micros,output_cost_per_million_micros",
    )
    .eq("organization_id", organizationId)
    .order("provider", { ascending: true })
    .order("model", { ascending: true })
    .limit(200);

  if (error) throw error;

  return Object.freeze(
    ((data ?? []) as ModelConfigurationRow[])
      .filter((row) => isProviderId(row.provider))
      .map((row) =>
        Object.freeze({
          id: row.id,
          provider: row.provider as ProviderId,
          model: row.model,
          displayName: row.display_name,
          capabilities: toCapabilityList(row.capabilities),
          enabled: row.enabled,
          isDefault: row.is_default,
          inputCostPerMillionMicros: toNumber(row.input_cost_per_million_micros),
          outputCostPerMillionMicros: toNumber(row.output_cost_per_million_micros),
        }),
      ),
  );
}

/** Live health plus the organization's configured catalogue, per provider. */
export async function loadProviderStatus(
  client: ServerClient,
  organizationId: string,
  health?: readonly ProviderHealth[],
): Promise<readonly ProviderStatusView[]> {
  const [resolvedHealth, configurations] = await Promise.all([
    health ? Promise.resolve(health) : snapshotProviderHealth(),
    listModelConfigurations(client, organizationId),
  ]);
  const healthByProvider = new Map(resolvedHealth.map((entry) => [entry.provider, entry]));

  return Object.freeze(
    PROVIDER_IDS.map((provider) => {
      const entry = healthByProvider.get(provider);
      const state: ProviderConnectionState = entry?.state ?? "not_configured";
      const configuration = resolveProviderConfiguration(provider);

      return Object.freeze({
        provider,
        label: PROVIDER_LABELS[provider],
        state,
        stateLabel: PROVIDER_CONNECTION_STATE_LABELS[state],
        detail: entry?.detail ?? "The provider has not been probed.",
        checkedAt: entry?.checkedAt ?? new Date().toISOString(),
        latencyMs: entry?.latencyMs ?? null,
        defaultModel: entry?.defaultModel ?? configuration.defaultModel,
        configuredModels: Object.freeze(
          configurations.filter((item) => item.provider === provider),
        ),
        environmentVariableNames: providerEnvironmentNames(provider),
      });
    }),
  );
}

/** Variable names only, so an owner knows where to look. Never values. */
function providerEnvironmentNames(provider: ProviderId): readonly string[] {
  return provider === "anthropic"
    ? Object.freeze(["ANTHROPIC_API_KEY", "ANTHROPIC_DEFAULT_MODEL"])
    : Object.freeze(["OPENAI_API_KEY", "OPENAI_DEFAULT_MODEL"]);
}

/**
 * Observed reliability and latency from persisted runs. Used as a routing
 * signal only; an empty history yields nulls, which score as neutral.
 */
export async function loadObservedMetrics(
  client: ServerClient,
  organizationId: string,
  sampleSize = 50,
): Promise<Partial<Record<ProviderId, ProviderObservedMetrics>>> {
  const { data, error } = await client
    .from("agent_runs")
    .select("provider,status,latency_ms")
    .eq("organization_id", organizationId)
    .not("provider", "is", null)
    .order("created_at", { ascending: false })
    .limit(sampleSize);

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    provider: string | null;
    status: string;
    latency_ms: number | null;
  }>;

  const metrics: Partial<Record<ProviderId, ProviderObservedMetrics>> = {};
  for (const provider of PROVIDER_IDS) {
    const providerRows = rows.filter((row) => row.provider === provider);
    if (providerRows.length === 0) continue;

    const succeeded = providerRows.filter((row) => row.status === "succeeded").length;
    const latencies = providerRows
      .map((row) => row.latency_ms)
      .filter((value): value is number => typeof value === "number" && value >= 0)
      .sort((left, right) => left - right);

    metrics[provider] = Object.freeze({
      recentSuccessRate: succeeded / providerRows.length,
      medianLatencyMs: latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : null,
    });
  }

  return metrics;
}

export interface ProjectRoutingContext {
  readonly projectId: string;
  readonly projectName: string;
  readonly repositoryFullName: string | null;
  readonly defaultBranch: string | null;
  readonly policy: ProjectRoutingPolicy;
  readonly availability: readonly ProviderAvailability[];
  readonly executionEnabled: boolean;
}

interface ProjectRow {
  id: string;
  name: string;
  github_repository: string | null;
  default_branch: string | null;
  maximum_autonomous_risk: string;
}

/**
 * Assemble everything the router needs for one project: the policy, the live
 * availability of each provider, and whether the owner has switched outbound
 * execution on at all.
 */
export async function loadProjectRoutingContext(
  client: ServerClient,
  organizationId: string,
  projectId: string,
): Promise<ProjectRoutingContext | null> {
  const [projectResult, organizationResult, configurations, metrics] = await Promise.all([
    client
      .from("projects")
      .select("id,name,github_repository,default_branch,maximum_autonomous_risk")
      .eq("organization_id", organizationId)
      .eq("id", projectId)
      .maybeSingle(),
    client
      .from("organizations")
      .select("ai_provider_execution_enabled")
      .eq("id", organizationId)
      .maybeSingle(),
    listModelConfigurations(client, organizationId),
    loadObservedMetrics(client, organizationId),
  ]);

  if (projectResult.error) throw projectResult.error;
  if (organizationResult.error) throw organizationResult.error;

  const project = projectResult.data as ProjectRow | null;
  if (!project) return null;

  const enabledModelsByProvider: Partial<Record<ProviderId, readonly string[]>> = {};
  for (const provider of PROVIDER_IDS) {
    enabledModelsByProvider[provider] = Object.freeze(
      configurations
        .filter((item) => item.provider === provider && item.enabled)
        .map((item) => item.model),
    );
  }

  const availability = await buildProviderAvailability({
    enabledModelsByProvider,
    metricsByProvider: metrics,
  });

  const maximumRisk = (project.maximum_autonomous_risk ?? "green").toUpperCase() as RiskLevel;

  return Object.freeze({
    projectId: project.id,
    projectName: project.name,
    repositoryFullName: project.github_repository,
    defaultBranch: project.default_branch,
    policy: Object.freeze({
      // Phase 2A keeps provider selection automatic unless an agent or the
      // caller says otherwise; there is no project-level provider column yet.
      defaultProvider: "AUTO" as const,
      allowedProviders: Object.freeze([...PROVIDER_IDS]),
      // Fallback is a project policy decision. It stays off until an owner
      // opts in, matching the safe-by-default rule for outbound behavior.
      allowFallback: false,
      maximumRisk,
    }),
    availability,
    executionEnabled: Boolean(
      (organizationResult.data as { ai_provider_execution_enabled?: boolean } | null)
        ?.ai_provider_execution_enabled,
    ),
  });
}

export interface AgentView {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly description: string | null;
  readonly status: string;
  readonly provider: ProviderId | null;
  readonly providerLabel: string | null;
  readonly model: string | null;
  readonly lastRunAt: string | null;
}

export async function listAgents(
  client: ServerClient,
  organizationId: string,
): Promise<readonly AgentView[]> {
  const { data, error } = await client
    .from("agents")
    .select("id,name,role,description,status,provider,model,last_run_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw error;

  return Object.freeze(
    ((data ?? []) as Array<{
      id: string;
      name: string;
      role: string;
      description: string | null;
      status: string;
      provider: string | null;
      model: string | null;
      last_run_at: string | null;
    }>).map((row) =>
      Object.freeze({
        id: row.id,
        name: row.name,
        role: row.role,
        description: row.description,
        status: row.status,
        provider: isProviderId(row.provider) ? row.provider : null,
        providerLabel: isProviderId(row.provider) ? PROVIDER_LABELS[row.provider] : null,
        model: row.model,
        lastRunAt: row.last_run_at,
      }),
    ),
  );
}

export interface ProviderRunView {
  readonly id: string;
  readonly projectId: string;
  readonly taskKind: string | null;
  readonly status: string;
  readonly provider: ProviderId | null;
  readonly providerLabel: string | null;
  readonly model: string | null;
  readonly latencyMs: number | null;
  readonly fallbackFromProvider: ProviderId | null;
  readonly estimatedCostLabel: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly errorMessage: string | null;
  readonly summary: string | null;
  readonly createdAt: string;
  readonly routing: {
    readonly decision: string;
    readonly source: string | null;
    readonly requestedProvider: string;
    readonly policyVersion: string;
    readonly reasons: readonly { code: string; detail: string }[];
  } | null;
}

interface RunRow {
  id: string;
  project_id: string;
  task_kind: string | null;
  status: string;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  fallback_from_provider: string | null;
  usage: unknown;
  output: unknown;
  error_message: string | null;
  created_at: string;
  provider_routing_decisions: {
    decision: string;
    source: string | null;
    requested_provider: string;
    policy_version: string;
    reasons: unknown;
  } | null;
}

function readNumber(source: unknown, key: string): number | null {
  if (typeof source !== "object" || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readReasons(value: unknown): readonly { code: string; detail: string }[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .slice(0, 20)
      .map((entry) =>
        Object.freeze({
          code: typeof entry.code === "string" ? entry.code : "UNKNOWN",
          detail: typeof entry.detail === "string" ? entry.detail.slice(0, 400) : "",
        }),
      ),
  );
}

export async function listProviderRuns(
  client: ServerClient,
  organizationId: string,
  limit = 25,
): Promise<readonly ProviderRunView[]> {
  const { data, error } = await client
    .from("agent_runs")
    .select(
      "id,project_id,task_kind,status,provider,model,latency_ms,fallback_from_provider,usage,output,error_message,created_at,provider_routing_decisions(decision,source,requested_provider,policy_version,reasons)",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));

  if (error) throw error;

  return Object.freeze(
    ((data ?? []) as unknown as RunRow[]).map((row) => {
      const routingRow = Array.isArray(row.provider_routing_decisions)
        ? row.provider_routing_decisions[0]
        : row.provider_routing_decisions;
      const summary =
        typeof row.output === "object" && row.output !== null
          ? (row.output as Record<string, unknown>).summary
          : null;

      return Object.freeze({
        id: row.id,
        projectId: row.project_id,
        taskKind: row.task_kind,
        status: row.status,
        provider: isProviderId(row.provider) ? row.provider : null,
        providerLabel: isProviderId(row.provider) ? PROVIDER_LABELS[row.provider] : null,
        model: row.model,
        latencyMs: row.latency_ms,
        fallbackFromProvider: isProviderId(row.fallback_from_provider)
          ? row.fallback_from_provider
          : null,
        estimatedCostLabel: formatEstimatedCost(readNumber(row.usage, "estimated_cost_micros")),
        inputTokens: readNumber(row.usage, "input_tokens"),
        outputTokens: readNumber(row.usage, "output_tokens"),
        errorMessage: row.error_message,
        summary: typeof summary === "string" ? summary.slice(0, 2000) : null,
        createdAt: row.created_at,
        routing: routingRow
          ? Object.freeze({
              decision: routingRow.decision,
              source: routingRow.source,
              requestedProvider: routingRow.requested_provider,
              policyVersion: routingRow.policy_version,
              reasons: readReasons(routingRow.reasons),
            })
          : null,
      });
    }),
  );
}
