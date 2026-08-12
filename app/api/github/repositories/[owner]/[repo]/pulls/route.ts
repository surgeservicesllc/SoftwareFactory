import { githubRouteErrorResponse } from "@/lib/github/errors";
import { listGitHubPullRequests } from "@/lib/github/repository";
import { prepareGitHubRepositoryRequest } from "@/lib/github/route";
import { jsonNoStore } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const coordinates = await params;
    const prepared = await prepareGitHubRepositoryRequest(
      request,
      coordinates,
      { pull_requests: "read" },
    );
    return jsonNoStore({
      pullRequests: await listGitHubPullRequests(
        prepared.token,
        prepared.owner,
        prepared.repository,
      ),
    });
  } catch (error) {
    return githubRouteErrorResponse(error);
  }
}
