import {
  isWorkCapability,
  type AgentCapabilityProfile,
  type ModelCapabilityProfile,
  type WorkCapability,
} from "@/lib/resources/capabilities";

/**
 * Build the Resource Manager's candidates out of real tenant rows.
 *
 * Until now the capability profiles the manager scored were code constants, so
 * routing was only ever a demonstration against fixtures. These map the rows an
 * organization actually has — `agents` and `provider_model_configurations` —
 * into the profiles `assignWorker` consumes.
 *
 * The rule throughout: **an undeclared property is never a permissive default.**
 * A model whose strength the owner has not declared cannot take work that
 * requires a strong model, and a model whose context limit is unstated cannot
 * be shown to fit anything. Both resolve in the direction that refuses work,
 * because the opposite direction claims a capability nobody stated.
 */

/**
 * Phase 2A declared capabilities on providers with its own smaller vocabulary.
 * Only the unambiguous correspondences are mapped.
 *
 * Two are deliberately absent. `structured_output` is an output *format*, not a
 * kind of work, so it has no Phase 2C equivalent. `reporting` is close to
 * `synthesis` but not the same claim — summarising findings is not combining
 * them — and `synthesis` gates work onto strong models, so a wrong mapping here
 * would hand judgement work to a model nobody said could do it.
 *
 * Five Phase 2C capabilities have no Phase 2A source at all: `frontend`,
 * `backend`, `database`, `research`, and `production_investigation`. A model
 * declared only under the old vocabulary therefore cannot claim them, and work
 * requiring them has no eligible model until an owner declares one. That is the
 * intended outcome, not a gap to paper over.
 */
export const WORK_CAPABILITY_FROM_PROVIDER_CAPABILITY: Readonly<Record<string, WorkCapability>> =
  Object.freeze({
    planning: "planning",
    architecture_analysis: "architecture",
    code_authoring: "coding",
    code_review: "review",
    security_review: "security",
    qa_analysis: "qa",
  });

/** An agent role implies the work it exists to do. */
const ROLE_CAPABILITIES: Readonly<Record<string, readonly WorkCapability[]>> = Object.freeze({
  orchestrator: Object.freeze(["planning", "synthesis"] as const),
  product: Object.freeze(["planning", "research"] as const),
  frontend: Object.freeze(["coding", "frontend"] as const),
  backend: Object.freeze(["coding", "backend"] as const),
  database: Object.freeze(["coding", "database"] as const),
  qa: Object.freeze(["qa", "review"] as const),
  security: Object.freeze(["security", "review"] as const),
  release: Object.freeze(["review", "production_investigation"] as const),
  ceo_reporter: Object.freeze(["synthesis"] as const),
  // A custom agent gets nothing from its role. Whatever it can do has to be
  // declared explicitly, because "custom" states no capability at all.
  custom: Object.freeze([] as const),
});

/** Only `idle` is available. Busy, paused, inactive and error are all not. */
const AVAILABLE_AGENT_STATUS = "idle";

export interface AgentRow {
  readonly id: string;
  readonly role: string;
  readonly status: string;
  readonly project_id: string | null;
  readonly capabilities: unknown;
}

export interface ModelRow {
  readonly provider: string;
  readonly model: string;
  readonly capabilities: unknown;
  readonly enabled: boolean;
  readonly strength_tier: string | null;
  readonly context_limit_tokens: number | null;
}

/**
 * Read a `capabilities` jsonb column.
 *
 * Accepts Phase 2C names directly and Phase 2A names through the mapping above.
 * Anything unrecognised is dropped rather than guessed at — a capability nobody
 * can name is not a capability the router may rely on.
 */
export function readDeclaredCapabilities(value: unknown): WorkCapability[] {
  if (!Array.isArray(value)) return [];
  const declared = new Set<WorkCapability>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    if (isWorkCapability(entry)) {
      declared.add(entry);
      continue;
    }
    const mapped = WORK_CAPABILITY_FROM_PROVIDER_CAPABILITY[entry];
    if (mapped) declared.add(mapped);
  }
  return [...declared];
}

export function toAgentProfile(row: AgentRow): AgentCapabilityProfile {
  const declared = readDeclaredCapabilities(row.capabilities);
  const fromRole = ROLE_CAPABILITIES[row.role] ?? [];

  return Object.freeze({
    agentId: row.id,
    role: row.role,
    capabilities: Object.freeze([...new Set([...fromRole, ...declared])]),
    available: row.status === AVAILABLE_AGENT_STATUS,
    // A project-scoped agent is allowed on exactly that project. An agent with
    // no project is organization-wide, which the empty list means — and an
    // empty list is unrestricted rather than a denylist, so a new project
    // cannot silently inherit a scoped agent.
    allowedProjectIds: Object.freeze(row.project_id === null ? [] : [row.project_id]),
  });
}

/**
 * The strongest tier a model may be treated as.
 *
 * Undeclared resolves to `economical`, which is the weakest. That is the whole
 * point: `requiresStrongModel` is an eligibility gate, so an undeclared model
 * is refused RED, judgement, security, architecture and synthesis work instead
 * of quietly qualifying for it.
 */
export function readStrengthTier(value: string | null): ModelCapabilityProfile["tier"] {
  if (value === "strong" || value === "balanced" || value === "economical") return value;
  return "economical";
}

/**
 * Undeclared context limit resolves to zero, so `CONTEXT_TOO_SMALL` fires for
 * any work at all. Null does not mean unlimited; it means nobody has said.
 */
export function readContextLimit(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function toModelProfile(row: ModelRow): ModelCapabilityProfile {
  return Object.freeze({
    provider: row.provider,
    model: row.model,
    capabilities: Object.freeze(readDeclaredCapabilities(row.capabilities)),
    contextLimitTokens: readContextLimit(row.context_limit_tokens),
    tier: readStrengthTier(row.strength_tier),
    available: row.enabled === true,
  });
}

/** Breaker targets are `provider` and `provider/model`, checked most specific first. */
export function breakerTargetsFor(provider: string, model: string): readonly string[] {
  return Object.freeze([`${provider}/${model}`, provider]);
}

export interface UndeclaredModel {
  readonly provider: string;
  readonly model: string;
  readonly missing: readonly ("strength_tier" | "context_limit_tokens")[];
}

/**
 * Which configured models an owner has not finished characterising.
 *
 * Surfaced rather than silently absorbed, because "no eligible worker" and "no
 * eligible worker because nobody declared the models" are different problems
 * with different fixes, and only one of them is the router's.
 */
export function undeclaredModels(rows: readonly ModelRow[]): UndeclaredModel[] {
  const undeclared: UndeclaredModel[] = [];
  for (const row of rows) {
    const missing: ("strength_tier" | "context_limit_tokens")[] = [];
    if (row.strength_tier === null) missing.push("strength_tier");
    if (row.context_limit_tokens === null) missing.push("context_limit_tokens");
    if (missing.length > 0) {
      undeclared.push(Object.freeze({ provider: row.provider, model: row.model, missing: Object.freeze(missing) }));
    }
  }
  return undeclared;
}
