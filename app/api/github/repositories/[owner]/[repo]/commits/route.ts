import { z } from "zod";

import { githubRouteErrorResponse } from "@/lib/github/errors";
import { listGitHubCommits } from "@/lib/github/repository";
import { prepareGitHubRepositoryRequest } from "@/lib/github/route";
import { jsonNoStore } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const url = new URL(request.url);
    const sha = url.searchParams.get("sha");
    const perPageValue = url.searchParams.get("perPage") ?? "30";
    const path = url.searchParams.get("path") ?? undefined;
    const perPage = Number(perPageValue);
    if (
      !z.string().min(1).max(255).safeParse(sha).success
      || !Number.isSafeInteger(perPage)
      || perPage < 1
      || perPage > 100
      || (path !== undefined && (path.length < 1 || path.length > 1024))
    ) {
      return jsonNoStore(
        { error: { code: "invalid_commits_request", message: "A valid branch/SHA and page size are required." } },
        { status: 400 },
      );
    }
    const prepared = await prepareGitHubRepositoryRequest(
      request,
      await params,
      { contents: "read" },
    );
    return jsonNoStore({
      commits: await listGitHubCommits(
        prepared.token,
        prepared.owner,
        prepared.repository,
        sha!,
        perPage,
        path,
      ),
    });
  } catch (error) {
    return githubRouteErrorResponse(error);
  }
}
