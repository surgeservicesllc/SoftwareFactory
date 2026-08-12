import { z } from "zod";

import { githubRouteErrorResponse } from "@/lib/github/errors";
import { listGitHubCheckRuns } from "@/lib/github/repository";
import { prepareGitHubRepositoryRequest } from "@/lib/github/route";
import { jsonNoStore } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const ref = new URL(request.url).searchParams.get("ref");
    if (!z.string().min(1).max(255).safeParse(ref).success) {
      return jsonNoStore(
        { error: { code: "invalid_ref", message: "A Git reference is required." } },
        { status: 400 },
      );
    }
    const coordinates = await params;
    const prepared = await prepareGitHubRepositoryRequest(request, coordinates, { checks: "read" });
    return jsonNoStore({
      checkRuns: await listGitHubCheckRuns(
        prepared.token,
        prepared.owner,
        prepared.repository,
        ref!,
      ),
    });
  } catch (error) {
    return githubRouteErrorResponse(error);
  }
}
