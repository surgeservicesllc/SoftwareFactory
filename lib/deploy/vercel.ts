import "server-only";

/**
 * Read-only Vercel deployment tracking.
 *
 * The loop needs to know what is deployed, to which commit, and whether it is
 * ready — for validation and for resolving Last Known Good. That is a *read*.
 * This module deliberately exposes no way to create, promote, or roll back a
 * deployment: adding one is a separate, owner-approved decision, and leaving
 * the capability absent is stronger than leaving it present and disabled.
 *
 * With no `VERCEL_TOKEN` configured the adapter reports **Not Connected** with
 * a reason rather than throwing or returning empty data that would read as
 * "nothing is deployed".
 */

export type DeploymentState =
  | "queued"
  | "building"
  | "ready"
  | "error"
  | "canceled"
  | "unknown";

export type DeploymentTarget = "production" | "preview";

export interface TrackedDeployment {
  readonly id: string;
  readonly state: DeploymentState;
  readonly target: DeploymentTarget;
  readonly url: string | null;
  readonly commitSha: string | null;
  readonly branch: string | null;
  readonly createdAt: string | null;
}

export type DeploymentReadStatus = "connected" | "not_connected" | "error";

export interface DeploymentReadResult {
  readonly status: DeploymentReadStatus;
  readonly deployments: readonly TrackedDeployment[];
  /** Why the read is not `connected`. Present for every non-connected status. */
  readonly reason?: string;
}

const VERCEL_API = "https://api.vercel.com";
const READ_TIMEOUT_MS = 10_000;
const MAX_DEPLOYMENTS = 20;

/** Vercel's `readyState` vocabulary, narrowed to ours. */
function toState(value: unknown): DeploymentState {
  switch (String(value).toUpperCase()) {
    case "QUEUED":
    case "INITIALIZING":
      return "queued";
    case "BUILDING":
      return "building";
    case "READY":
      return "ready";
    case "ERROR":
      return "error";
    case "CANCELED":
      return "canceled";
    default:
      return "unknown";
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toDeployment(row: Record<string, unknown>): TrackedDeployment {
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const url = text(row.url);

  return {
    id: text(row.uid) ?? text(row.id) ?? "unknown",
    state: toState(row.readyState ?? row.state),
    target: row.target === "production" ? "production" : "preview",
    // Vercel returns a bare host; make it a URL the interface can link.
    url: url ? `https://${url.replace(/^https?:\/\//, "")}` : null,
    commitSha: text(meta.githubCommitSha) ?? text(meta.gitCommitSha),
    branch: text(meta.githubCommitRef) ?? text(meta.gitCommitRef),
    createdAt:
      typeof row.createdAt === "number" ? new Date(row.createdAt).toISOString() : text(row.createdAt),
  };
}

/**
 * Whether a deployment provider is configured at all.
 *
 * Exported so a surface can render **Not Connected** without issuing a request
 * that is certain to fail.
 */
export function isDeploymentProviderConfigured(): boolean {
  return Boolean(process.env.VERCEL_TOKEN);
}

/**
 * Read recent deployments for a project.
 *
 * Never throws: an unconfigured token, a provider error, or a timeout all
 * resolve to a status the caller can render truthfully. A loop that treats a
 * failed read as "no deployments" would resolve Last Known Good to nothing and
 * report a healthy system as un-deployed.
 */
export async function listRecentDeployments(
  projectId: string,
  options: { readonly target?: DeploymentTarget; readonly limit?: number } = {},
): Promise<DeploymentReadResult> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    return {
      status: "not_connected",
      deployments: [],
      reason: "No VERCEL_TOKEN is configured, so deployment state cannot be read.",
    };
  }

  const limit = Math.min(Math.max(1, options.limit ?? 10), MAX_DEPLOYMENTS);
  const query = new URLSearchParams({ projectId, limit: String(limit) });
  if (options.target) query.set("target", options.target);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);

  try {
    const response = await fetch(`${VERCEL_API}/v6/deployments?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      // The status is deliberately the only detail surfaced: a provider error
      // body can echo request data, and this result reaches the interface.
      return {
        status: "error",
        deployments: [],
        reason: `The deployment provider returned HTTP ${response.status}.`,
      };
    }

    const body = (await response.json()) as { deployments?: Record<string, unknown>[] };
    return {
      status: "connected",
      deployments: Object.freeze((body.deployments ?? []).map(toDeployment)),
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      status: "error",
      deployments: [],
      reason: timedOut
        ? "The deployment provider did not respond in time."
        : "The deployment provider could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The most recent production deployment that reached `ready`.
 *
 * This is the *candidate* for Last Known Good, not Last Known Good itself:
 * Phase 1E only promotes a deployment whose own validation passed, and a
 * deployment being ready says nothing about whether it works.
 */
export function latestReadyProduction(
  result: DeploymentReadResult,
): TrackedDeployment | null {
  if (result.status !== "connected") return null;

  return (
    result.deployments.find(
      (deployment) => deployment.target === "production" && deployment.state === "ready",
    ) ?? null
  );
}
