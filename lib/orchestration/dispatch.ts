import "server-only";

import {
  createGitHubInstallationToken,
  githubApiRequest,
} from "@/lib/github/client";
import { getGitHubAppConfigurationForAppId } from "@/lib/github/config";
import { validateRepositoryCoordinate } from "@/lib/github/repository";

export const PHASE_1C_DISPATCH_EVENT = "softwarefactory_phase1c_command";

export type Phase1CDispatchTarget = Readonly<{
  appId: number;
  externalInstallationId: number;
  externalRepositoryId: number;
  repositoryFullName: string;
}>;

export type Phase1CDispatchResult = Readonly<{
  dispatched: boolean;
  reason: "dispatched" | "worker_disabled";
}>;

type WorkerDispatchHost = Readonly<{
  appId: number;
  externalInstallationId: number;
  externalRepositoryId: number;
  repositoryFullName: string;
}>;

function repositoryCoordinates(fullName: string) {
  const parts = fullName.split("/");
  if (parts.length !== 2) {
    throw new Error("The queued repository coordinate is invalid.");
  }
  return {
    owner: validateRepositoryCoordinate(parts[0]!, "Repository owner"),
    repository: validateRepositoryCoordinate(parts[1]!, "Repository name"),
  };
}

function positiveEnvironmentInteger(name: string) {
  const raw = process.env[name]?.trim() ?? "";
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe positive integer.`);
  }
  return value;
}

/**
 * Repository-dispatch runs the workflow stored by the repository receiving
 * the event. A project repository is therefore never a worker host merely
 * because the Factory can clone it. The reviewed SoftwareFactory runtime has
 * its own explicit, fail-closed installation/repository identity.
 */
function workerDispatchHost(): WorkerDispatchHost {
  const repositoryFullName = process.env.SOFTWAREFACTORY_WORKER_HOST_REPOSITORY?.trim() ?? "";
  repositoryCoordinates(repositoryFullName);
  return Object.freeze({
    appId: positiveEnvironmentInteger("SOFTWAREFACTORY_WORKER_HOST_APP_ID"),
    externalInstallationId: positiveEnvironmentInteger(
      "SOFTWAREFACTORY_WORKER_HOST_INSTALLATION_ID",
    ),
    externalRepositoryId: positiveEnvironmentInteger(
      "SOFTWAREFACTORY_WORKER_HOST_REPOSITORY_ID",
    ),
    repositoryFullName,
  });
}

function assertProjectTarget(target: Phase1CDispatchTarget) {
  repositoryCoordinates(target.repositoryFullName);
  if (
    !Number.isSafeInteger(target.appId)
    || target.appId <= 0
    || !Number.isSafeInteger(target.externalInstallationId)
    || target.externalInstallationId <= 0
    || !Number.isSafeInteger(target.externalRepositoryId)
    || target.externalRepositoryId <= 0
  ) {
    throw new Error("The queued project repository identity is invalid.");
  }
}

async function sendWorkerDispatch(eventType: string, clientPayload: Record<string, string>) {
  const host = workerDispatchHost();
  const { owner, repository } = repositoryCoordinates(host.repositoryFullName);
  const configuration = getGitHubAppConfigurationForAppId(host.appId);
  const installationToken = await createGitHubInstallationToken(
    configuration,
    host.externalInstallationId,
    {
      permissions: { contents: "write", metadata: "read" },
      repositoryIds: [host.externalRepositoryId],
    },
  );
  await githubApiRequest(`/repos/${owner}/${repository}/dispatches`, {
    body: { event_type: eventType, client_payload: clientPayload },
    method: "POST",
    token: installationToken.token,
  });
}

/**
 * Wakes the durable GitHub Actions worker after the database transaction has
 * committed. The event contains only an opaque command UUID. The worker still
 * has to claim and re-authorize the job from Supabase; event data is never an
 * execution authority.
 */
export async function dispatchPhase1CWorker(
  target: Phase1CDispatchTarget,
  commandId: string,
): Promise<Phase1CDispatchResult> {
  // Mirror the workflow gate in the application. Recording stays available
  // under containment, but accepting a GitHub event is never misreported as
  // a verified worker wake while execution is disabled.
  if (process.env.SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED !== "true") {
    return { dispatched: false, reason: "worker_disabled" };
  }
  assertProjectTarget(target);
  await sendWorkerDispatch(PHASE_1C_DISPATCH_EVENT, { command_id: commandId });
  return { dispatched: true, reason: "dispatched" };
}

export const GRAPH_DISPATCH_EVENT = "softwarefactory_graph_planned";

export type GraphDispatchResult = Readonly<{
  dispatched: boolean;
  reason: "dispatched" | "worker_disabled";
}>;

/**
 * Wakes the analysis graph worker after a graph has been planned for a
 * recorded command. Same contract as the Phase 1C dispatch: the payload is
 * an opaque graph UUID, the worker still claims and re-authorizes from
 * Supabase, and event data is never an execution authority.
 */
export async function dispatchGraphWorker(
  target: Phase1CDispatchTarget,
  graphId: string,
): Promise<GraphDispatchResult> {
  // Dispatch is itself an automatic action. Keep the application and the
  // workflow behind the same exact, fail-closed switch so a recorded graph is
  // never presented as running while production containment is engaged.
  if (process.env.SOFTWAREFACTORY_GRAPH_WORKER_ENABLED !== "true") {
    return { dispatched: false, reason: "worker_disabled" };
  }
  assertProjectTarget(target);
  await sendWorkerDispatch(GRAPH_DISPATCH_EVENT, { graph_id: graphId });
  return { dispatched: true, reason: "dispatched" };
}
