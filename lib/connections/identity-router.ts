import "server-only";

/**
 * The Identity Router: project + capability + policy → one authorized connection.
 *
 * This is the seam Phase 2D exists to create. Before it, "which provider" and
 * "which account" were the same decision, because there was only ever one
 * account per provider — `lib/providers/routing.ts` picks `ANTHROPIC` or
 * `OPENAI` and every caller then reads one ambient credential. That is exactly
 * the collapse goal 1 names: Provider and Connection had become the same thing.
 *
 * Two rules shape everything below.
 *
 * **The router never guesses.** Every refusal names a reason. If a project has
 * not mapped a connection to the requested capability, the answer is
 * `NO_MAPPING`, never "the only GitHub connection, probably". If two eligible
 * connections tie on priority, the answer is `AMBIGUOUS_MAPPING`, never
 * whichever the database returned first — a silent tiebreak is a routing
 * decision nobody made, and it would be non-deterministic across replicas.
 *
 * **The router never returns secrets.** It returns a connection id. Acquiring
 * credentials for that id is a separate, server-only step, so a routing result
 * is safe to log, audit, and return to a surface.
 */

/** The closed capability vocabulary, mirroring `connection_capability_types`. */
export const CONNECTION_CAPABILITIES = [
  "repository.read",
  "repository.write",
  "deploy.preview",
  "deploy.production",
  "database.read",
  "database.migrate",
  "inference.advisory",
  "worker.execute",
] as const;

export type ConnectionCapability = (typeof CONNECTION_CAPABILITIES)[number];

export function isConnectionCapability(value: unknown): value is ConnectionCapability {
  return typeof value === "string"
    && (CONNECTION_CAPABILITIES as readonly string[]).includes(value);
}

/** Runtime health, distinct from the lifecycle `connection_status`. */
export const CONNECTION_HEALTH_STATES = [
  "connected",
  "degraded",
  "offline",
  "unauthorized",
  "error",
  "disabled",
] as const;

export type ConnectionHealth = (typeof CONNECTION_HEALTH_STATES)[number];

/**
 * Health states a connection may be selected in.
 *
 * `degraded` is eligible on purpose: a rate-limited connection is still the
 * correct identity, and refusing it would push work onto an account the owner
 * did not choose for this project. Capacity, not health, is what throttles it.
 * `unauthorized` is never eligible — it means a credential was rejected, so
 * retrying can only produce more rejections and possibly a lockout.
 */
const SELECTABLE_HEALTH: ReadonlySet<ConnectionHealth> = new Set<ConnectionHealth>([
  "connected",
  "degraded",
]);

export type RoutingRefusalCode =
  | "NO_MAPPING"
  | "CAPABILITY_NOT_DECLARED"
  | "CONNECTION_NOT_CONNECTED"
  | "CONNECTION_UNHEALTHY"
  | "CAPACITY_EXHAUSTED"
  | "AMBIGUOUS_MAPPING"
  | "OVERRIDE_NOT_ELIGIBLE"
  | "PROVIDER_NOT_PERMITTED";

export interface RoutableConnection {
  readonly connectionId: string;
  readonly provider: string;
  readonly accountLabel: string | null;
  /** The capability this project mapping authorizes. */
  readonly capability: ConnectionCapability;
  readonly priority: number;
  /** Lifecycle status from `connections.status`. */
  readonly status: string;
  readonly health: ConnectionHealth;
  /** Null means no recorded ceiling. */
  readonly maxConcurrency: number | null;
  readonly activeLeases: number;
  /** Capabilities the connection itself declares, independent of the mapping. */
  readonly declaredCapabilities: readonly string[];
}

export interface RoutingPolicy {
  /**
   * Providers this project may use. Empty means unrestricted. A mapping to a
   * provider outside this set is refused rather than ignored, because silently
   * skipping it would route work to an account the restriction was meant to
   * protect.
   */
  readonly permittedProviders?: readonly string[];
  /**
   * An explicit connection choice from an owner or project override. It must
   * still be independently eligible — an override selects among authorized
   * connections, it does not grant authorization.
   */
  readonly overrideConnectionId?: string | null;
  /** Whether this request may fall back past the preferred connection. */
  readonly allowFallback?: boolean;
}

export interface RoutingRequest {
  readonly projectId: string;
  readonly capability: ConnectionCapability;
  readonly candidates: readonly RoutableConnection[];
  readonly policy?: RoutingPolicy;
}

export interface RejectedCandidate {
  readonly connectionId: string;
  readonly reason: RoutingRefusalCode;
}

export interface RoutingSelection {
  readonly outcome: "SELECTED";
  readonly connectionId: string;
  readonly provider: string;
  readonly accountLabel: string | null;
  readonly capability: ConnectionCapability;
  /** True when the selected connection was not the highest-priority one. */
  readonly usedFallback: boolean;
  readonly reason: string;
  readonly consideredCount: number;
  readonly rejected: readonly RejectedCandidate[];
}

export interface RoutingRefusal {
  readonly outcome: "REFUSED";
  readonly code: RoutingRefusalCode;
  readonly reason: string;
  readonly consideredCount: number;
  readonly rejected: readonly RejectedCandidate[];
}

export type RoutingResult = RoutingSelection | RoutingRefusal;

/** Why a single candidate cannot be selected, or null when it can. */
function disqualify(
  candidate: RoutableConnection,
  capability: ConnectionCapability,
  permittedProviders: readonly string[],
): RoutingRefusalCode | null {
  if (candidate.capability !== capability) return "NO_MAPPING";

  // The mapping says this connection serves the capability; the connection
  // itself must agree. They can disagree after a provider revokes a permission,
  // and trusting the mapping alone would route work to an identity that can no
  // longer perform it.
  if (!candidate.declaredCapabilities.includes(capability)) {
    return "CAPABILITY_NOT_DECLARED";
  }

  if (permittedProviders.length > 0 && !permittedProviders.includes(candidate.provider)) {
    return "PROVIDER_NOT_PERMITTED";
  }

  if (candidate.status !== "connected") return "CONNECTION_NOT_CONNECTED";
  if (!SELECTABLE_HEALTH.has(candidate.health)) return "CONNECTION_UNHEALTHY";

  if (candidate.maxConcurrency !== null && candidate.activeLeases >= candidate.maxConcurrency) {
    return "CAPACITY_EXHAUSTED";
  }

  return null;
}

function refuse(
  code: RoutingRefusalCode,
  reason: string,
  considered: number,
  rejected: readonly RejectedCandidate[],
): RoutingRefusal {
  return Object.freeze({
    outcome: "REFUSED",
    code,
    reason,
    consideredCount: considered,
    rejected: Object.freeze([...rejected]),
  });
}

/**
 * Resolve one authorized connection for a project and capability.
 *
 * Pure: callers load candidates through
 * `public.list_project_connection_identities`, which enforces membership in the
 * database and never exposes `secret_reference`. Keeping the decision pure is
 * what makes every branch here testable without a provider or a live account.
 */
export function routeConnectionIdentity(request: RoutingRequest): RoutingResult {
  const policy = request.policy ?? {};
  const permittedProviders = policy.permittedProviders ?? [];
  const candidates = request.candidates;

  const rejected: RejectedCandidate[] = [];
  const eligible: RoutableConnection[] = [];

  for (const candidate of candidates) {
    const refusal = disqualify(candidate, request.capability, permittedProviders);
    if (refusal) {
      rejected.push({ connectionId: candidate.connectionId, reason: refusal });
      continue;
    }
    eligible.push(candidate);
  }

  if (policy.overrideConnectionId) {
    const override = eligible.find(
      (candidate) => candidate.connectionId === policy.overrideConnectionId,
    );
    if (!override) {
      // An override naming an ineligible connection is refused rather than
      // ignored. Falling back silently would execute against a different
      // account than the one an owner explicitly asked for.
      return refuse(
        "OVERRIDE_NOT_ELIGIBLE",
        "The requested connection is not an eligible mapping for this project and capability.",
        candidates.length,
        rejected,
      );
    }
    return Object.freeze({
      outcome: "SELECTED",
      connectionId: override.connectionId,
      provider: override.provider,
      accountLabel: override.accountLabel,
      capability: request.capability,
      usedFallback: false,
      reason: "Selected by explicit owner or project override.",
      consideredCount: candidates.length,
      rejected: Object.freeze([...rejected]),
    });
  }

  if (eligible.length === 0) {
    // Distinguish "you mapped nothing" from "everything you mapped is
    // unusable". The first is configuration, the second is an incident.
    const mappedForCapability = rejected.some((entry) => entry.reason !== "NO_MAPPING");
    const code: RoutingRefusalCode = mappedForCapability
      ? (rejected.find((entry) => entry.reason !== "NO_MAPPING")!.reason)
      : "NO_MAPPING";
    return refuse(
      code,
      mappedForCapability
        ? "Every connection mapped to this capability is currently unusable."
        : "No connection is mapped to this capability for this project.",
      candidates.length,
      rejected,
    );
  }

  const ordered = [...eligible].sort((left, right) => left.priority - right.priority);
  const best = ordered[0]!;
  const tied = ordered.filter((candidate) => candidate.priority === best.priority);

  if (tied.length > 1) {
    // Two connections at the same priority is a configuration ambiguity. A
    // tiebreak here would be a routing decision nobody made, and it would not
    // be stable across replicas or row orderings.
    return refuse(
      "AMBIGUOUS_MAPPING",
      `${tied.length} connections share priority ${best.priority} for this capability; set distinct priorities.`,
      candidates.length,
      rejected,
    );
  }

  const preferredWasSkipped = candidates.some(
    (candidate) =>
      candidate.capability === request.capability
      && candidate.priority < best.priority
      && candidate.connectionId !== best.connectionId,
  );

  if (preferredWasSkipped && policy.allowFallback === false) {
    return refuse(
      "CONNECTION_UNHEALTHY",
      "The preferred connection is unusable and this request does not permit fallback.",
      candidates.length,
      rejected,
    );
  }

  return Object.freeze({
    outcome: "SELECTED",
    connectionId: best.connectionId,
    provider: best.provider,
    accountLabel: best.accountLabel,
    capability: request.capability,
    usedFallback: preferredWasSkipped,
    reason: preferredWasSkipped
      ? "Preferred connection was unusable; selected the next eligible mapping."
      : "Selected the highest-priority eligible mapping.",
    consideredCount: candidates.length,
    rejected: Object.freeze([...rejected]),
  });
}
