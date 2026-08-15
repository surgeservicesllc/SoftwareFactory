import "server-only";

import type { RollbackAdapter } from "@/lib/operations/rollback-executor";

/**
 * The Vercel rollback adapter.
 *
 * `lib/deploy/vercel.ts` is deliberately read-only and says so: adding a
 * mutating capability was left as a separate, owner-approved decision. This is
 * that capability, kept in its own module so the boundary stays visible — a
 * reader of the read adapter cannot accidentally acquire the ability to promote
 * a deployment by importing it.
 *
 * It implements exactly one mutation, `promote`, because rollback in Vercel's
 * model is not "undo the last deploy" but "make a previously built deployment
 * current again". That distinction matters:
 *
 * - **Promotion reuses the existing build.** A rebuild from the same commit can
 *   produce a different artifact — dependencies drift, build inputs change —
 *   and the entire point of a rollback is restoring the thing that was known to
 *   work, not rebuilding something that resembles it.
 * - **Nothing here creates a deployment.** There is no create, no redeploy, no
 *   delete. The narrowest possible surface for a capability this sharp.
 *
 * Every failure resolves to `{ ok: false, detail }` rather than throwing. The
 * executor treats a failed promotion as a failed rollback and escalates to
 * SEV1 with the freeze retained, which is the correct handling — but only if it
 * gets an answer rather than an exception through the middle of its sequence.
 */

const VERCEL_API = "https://api.vercel.com";
const PROMOTE_TIMEOUT_MS = 30_000;
const STATE_TIMEOUT_MS = 10_000;

function teamQuery(): string {
  const teamId = process.env.VERCEL_TEAM_ID;
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

async function request(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: unknown; detail: string }> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    return {
      ok: false,
      status: 0,
      body: null,
      detail: "No VERCEL_TOKEN is configured, so no deployment can be promoted.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${VERCEL_API}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // A body that will not parse is not itself a failure; the status decides.
    }

    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ??
      `HTTP ${response.status}`;

    return {
      ok: response.ok,
      status: response.status,
      body,
      // Never include the token or the raw body: a provider error can echo
      // request headers back, and this string is written to an audit trail.
      detail: response.ok ? `Vercel accepted the promotion (HTTP ${response.status}).` : message,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: 0,
      body: null,
      detail: aborted
        ? `Vercel did not respond within ${timeoutMs}ms.`
        : "Vercel could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build an adapter for one project.
 *
 * Returns `null` when no token is configured, so the executor receives an
 * absent adapter and reports OWNER_ACTION_REQUIRED with the freeze retained —
 * rather than an adapter that exists and fails on every call, which would read
 * as a provider outage instead of a missing configuration.
 */
export function vercelRollbackAdapter(projectId: string): RollbackAdapter | null {
  if (!process.env.VERCEL_TOKEN) return null;

  return {
    async promote(deploymentId: string) {
      const result = await request(
        `/v9/projects/${encodeURIComponent(projectId)}/promote/${encodeURIComponent(deploymentId)}${teamQuery()}`,
        { method: "POST" },
        PROMOTE_TIMEOUT_MS,
      );
      return { ok: result.ok, detail: result.detail };
    },

    async state(deploymentId: string) {
      const result = await request(
        `/v13/deployments/${encodeURIComponent(deploymentId)}${teamQuery()}`,
        { method: "GET" },
        STATE_TIMEOUT_MS,
      );

      if (!result.ok) return "UNKNOWN";

      const raw = (result.body as { readyState?: unknown; status?: unknown } | null) ?? {};
      switch (String(raw.readyState ?? raw.status).toUpperCase()) {
        case "READY":
          return "READY";
        case "ERROR":
        case "CANCELED":
          return "ERROR";
        case "QUEUED":
        case "INITIALIZING":
        case "BUILDING":
          return "BUILDING";
        default:
          // An unrecognised state is not success. The executor treats anything
          // other than READY as a failed rollback, which is the safe reading.
          return "UNKNOWN";
      }
    },
  };
}

/** Why rollback execution is unavailable, for a surface to render honestly. */
export function rollbackExecutorStatus(): {
  readonly connected: boolean;
  readonly reason: string;
} {
  if (!process.env.VERCEL_TOKEN) {
    return {
      connected: false,
      reason:
        "Not Connected — no VERCEL_TOKEN is configured. A rollback will resolve its target and " +
        "keep the release freeze, but cannot promote the deployment.",
    };
  }

  return {
    connected: true,
    reason: "Connected — a validated Last Known Good deployment can be promoted.",
  };
}
