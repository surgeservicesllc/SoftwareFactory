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
) {
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
}

export const GRAPH_DISPATCH_EVENT = "softwarefactory_graph_planned";

/**
 * Wakes the analysis graph worker after a graph has been planned for a
 * recorded command. Same contract as the Phase 1C dispatch: the payload is
 * an opaque graph UUID, the worker still claims and re-authorizes from
 * Supabase, and event data is never an execution authority.
 */
export async function dispatchGraphWorker(
  target: Phase1CDispatchTarget,
  graphId: string,
) {
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
}
