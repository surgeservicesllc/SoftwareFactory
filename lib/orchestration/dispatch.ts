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
  const { owner, repository } = repositoryCoordinates(target.repositoryFullName);
  const configuration = getGitHubAppConfigurationForAppId(target.appId);
  const installationToken = await createGitHubInstallationToken(
    configuration,
    target.externalInstallationId,
    {
      permissions: { contents: "write", metadata: "read" },
      repositoryIds: [target.externalRepositoryId],
    },
  );

  await githubApiRequest(
    `/repos/${owner}/${repository}/dispatches`,
    {
      body: {
        event_type: PHASE_1C_DISPATCH_EVENT,
        client_payload: { command_id: commandId },
      },
      method: "POST",
      token: installationToken.token,
    },
  );
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

  const { owner, repository } = repositoryCoordinates(target.repositoryFullName);
  const configuration = getGitHubAppConfigurationForAppId(target.appId);
  const installationToken = await createGitHubInstallationToken(
    configuration,
    target.externalInstallationId,
    {
      permissions: { contents: "write", metadata: "read" },
      repositoryIds: [target.externalRepositoryId],
    },
  );

  await githubApiRequest(
    `/repos/${owner}/${repository}/dispatches`,
    {
      body: {
        event_type: GRAPH_DISPATCH_EVENT,
        client_payload: { graph_id: graphId },
      },
      method: "POST",
      token: installationToken.token,
    },
  );
  return { dispatched: true, reason: "dispatched" };
}
