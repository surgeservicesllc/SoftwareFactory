import { z } from "zod";

import { githubRouteErrorResponse } from "@/lib/github/errors";
import { listGitHubTree } from "@/lib/github/repository";
import { prepareGitHubRepositoryRequest } from "@/lib/github/route";
import { jsonNoStore } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const url = new URL(request.url);
    const ref = url.searchParams.get("ref");
    const path = url.searchParams.get("path") ?? "";
    if (!z.string().min(1).max(255).safeParse(ref).success || path.length > 1024) {
      return jsonNoStore(
        { error: { code: "invalid_tree_request", message: "The repository tree request is invalid." } },
        { status: 400 },
      );
    }
    const coordinates = await params;
    const prepared = await prepareGitHubRepositoryRequest(request, coordinates, { contents: "read" });
    return jsonNoStore({
      entries: await listGitHubTree(
        prepared.token,
        prepared.owner,
        prepared.repository,
        ref!,
        path,
      ),
      path,
      ref,
    });
  } catch (error) {
    return githubRouteErrorResponse(error);
  }
}
