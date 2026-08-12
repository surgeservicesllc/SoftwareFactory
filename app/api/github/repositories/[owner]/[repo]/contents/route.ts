import { z } from "zod";

import { githubRouteErrorResponse } from "@/lib/github/errors";
import { getGitHubFile } from "@/lib/github/repository";
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
    const path = url.searchParams.get("path");
    if (
      !z.string().min(1).max(255).safeParse(ref).success
      || !z.string().min(1).max(1024).safeParse(path).success
    ) {
      return jsonNoStore(
        { error: { code: "invalid_file_request", message: "A valid path and Git reference are required." } },
        { status: 400 },
      );
    }
    const coordinates = await params;
    const prepared = await prepareGitHubRepositoryRequest(request, coordinates, { contents: "read" });
    return jsonNoStore({
      file: await getGitHubFile(
        prepared.token,
        prepared.owner,
        prepared.repository,
        ref!,
        path!,
      ),
    });
  } catch (error) {
    return githubRouteErrorResponse(error);
  }
}
