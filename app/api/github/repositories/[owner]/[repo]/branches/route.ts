import { githubRouteErrorResponse } from "@/lib/github/errors";
import { listGitHubBranches } from "@/lib/github/repository";
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
      { contents: "read" },
    );
    const branches = await listGitHubBranches(
        prepared.token,
        prepared.owner,
        prepared.repository,
      );
    return jsonNoStore({
      branches: branches.map((branch) => ({
        ...branch,
        default: branch.name === prepared.context.repository?.defaultBranch,
      })),
    });
  } catch (error) {
    return githubRouteErrorResponse(error);
  }
}
