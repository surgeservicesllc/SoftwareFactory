// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { GitHubApiError, githubApiRequest } = await import("@/lib/github/client");

/**
 * How an ambiguous GitHub 403 is classified.
 *
 * This is the one place where getting it wrong disconnects a working
 * integration. GitHub returns **403** for two unrelated conditions: a genuine
 * permission failure, and a secondary rate limit. `markDiscoveredConnectionLoss`
 * acts on `github_permission_denied` by marking the connection lost — so a 403
 * misread as permission denial during a traffic spike would tear down a healthy
 * installation and require a human to reconnect it.
 *
 * The consumer side is already covered: a pre-classified 429 does not reach the
 * loss path. What was untested is the step before it, where the 403 is actually
 * decided, and that is where the ordering bug would live.
 */

function githubResponse(
  status: number,
  headers: Record<string, string>,
  body: unknown = { message: "Forbidden" },
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function classify(response: Response): Promise<{ status: number; code: string }> {
  vi.stubGlobal("fetch", vi.fn(async () => response));
  try {
    await githubApiRequest("/repos/o/r", { token: "t" });
    throw new Error("expected the request to throw");
  } catch (error) {
    if (!(error instanceof GitHubApiError)) throw error;
    return { status: error.status, code: error.code };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub 403 classification", () => {
  it("reads an exhausted rate-limit remaining header as rate limiting, not permission denial", async () => {
    // The header says the budget is gone. Treating this as a permission failure
    // would mark a healthy connection lost.
    const result = await classify(
      githubResponse(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000000" }),
    );
    expect(result.code).toBe("github_rate_limited");
    expect(result.status).toBe(429);
  });

  it("reads a retry-after header as rate limiting", async () => {
    const result = await classify(githubResponse(403, { "retry-after": "60" }));
    expect(result.code).toBe("github_rate_limited");
  });

  it("reads GitHub's secondary rate limit and abuse-detection wording as rate limiting", async () => {
    for (const message of [
      "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
      "API rate limit exceeded for installation.",
      "You have triggered an abuse detection mechanism.",
    ]) {
      const result = await classify(githubResponse(403, {}, { message }));
      expect(result.code, message).toBe("github_rate_limited");
    }
  });

  it("still classifies a genuine permission failure as permission denied", async () => {
    // The inverse must hold, or the guard above would be achieved by never
    // reporting a permission problem at all — which is its own defect, because
    // a revoked installation would then look like a transient rate limit and
    // never be recorded as lost.
    const result = await classify(
      githubResponse(403, {}, { message: "Resource not accessible by integration" }),
    );
    expect(result.code).toBe("github_permission_denied");
  });

  it("keeps a plain 429 classified as rate limiting", async () => {
    const result = await classify(githubResponse(429, {}, { message: "Too Many Requests" }));
    expect(result.code).toBe("github_rate_limited");
  });

  it("never yields a code that the connection-loss path acts on, for any rate-limited shape", async () => {
    // The property that actually matters, asserted against the exact allowlist
    // in `markDiscoveredConnectionLoss` rather than against a restatement of it.
    const lossCodes = ["github_installation_revoked", "github_permission_denied"];
    const rateLimitedShapes: Array<[number, Record<string, string>, unknown]> = [
      [403, { "x-ratelimit-remaining": "0" }, { message: "Forbidden" }],
      [403, { "retry-after": "30" }, { message: "Forbidden" }],
      [403, {}, { message: "You have exceeded a secondary rate limit." }],
      [429, {}, { message: "Too Many Requests" }],
    ];

    for (const [status, headers, body] of rateLimitedShapes) {
      const result = await classify(githubResponse(status, headers, body));
      expect(lossCodes, `${status} ${JSON.stringify(headers)}`).not.toContain(result.code);
    }
  });
});
