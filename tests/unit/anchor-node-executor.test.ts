import { describe, expect, it, vi } from "vitest";

import type { CompiledNode } from "@/lib/graph/compiler";
import { buildAnchorNodeExecutor } from "@/lib/worker/anchor-node-executor";

/**
 * Observations by instruments that cannot be persuaded.
 *
 * An ANCHOR node exists to record evidence, so every property here is about
 * honesty under each state of the instrument: a green CI verdict becomes a
 * success carrying the observation, a red one becomes a failure naming the
 * failing checks, a missing instrument is Not Connected rather than an
 * invented reading, and the deploy-shaped anchor is refused by policy — the
 * refusal text names the rule so the run's record shows policy holding, not
 * a fault. None of these outcomes is retryable: re-asking an instrument the
 * same question milliseconds later is not a different observation.
 */

function anchorNode(capability: CompiledNode["capability"], nodeKey = "verify"): CompiledNode {
  return {
    nodeKey,
    job: "Record what the instrument says",
    executor: "ANCHOR",
    capability,
    modelTier: "STANDARD",
    risk: "GREEN",
    timeoutMs: 60_000,
    maxAttempts: 1,
    allowProviderFallback: false,
    reads: [],
    writes: [],
    toleratesPartialInputs: false,
  } as CompiledNode;
}

const connected = {
  repositoryFullName: "owner/repository",
  headSha: "0123456789abcdef0123456789abcdef01234567",
  gitHubToken: "ghs_workflow-token",
  productionUrl: "https://product.example",
};

function checkRunsResponse(runs: ReadonlyArray<Record<string, unknown>>, status = 200) {
  return new Response(JSON.stringify({ check_runs: runs }), { status });
}

describe("the TEST anchor (qa): the CI verdict for this commit", () => {
  it("records a green verdict as evidence, not prose", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(checkRunsResponse([
      { name: "CI", status: "completed", conclusion: "success", html_url: "https://ci/1" },
      { name: "Lint", status: "completed", conclusion: "success", html_url: "https://ci/2" },
    ]));
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("qa"));

    expect(result.status).toBe("SUCCEEDED");
    if (result.status !== "SUCCEEDED") return;
    expect(result.output).toMatchObject({
      observation: "ci_check_runs",
      sha: connected.headSha,
      repository: connected.repositoryFullName,
      total: 2,
      failing: [],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.github.com/repos/owner/repository/commits/${connected.headSha}/check-runs?per_page=100`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer ghs_workflow-token" }),
      }),
    );
  });

  it("fails on a red verdict and names the failing check in the evidence", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(checkRunsResponse([
      { name: "CI", status: "completed", conclusion: "failure", html_url: "https://ci/1" },
      { name: "Lint", status: "completed", conclusion: "success", html_url: "https://ci/2" },
    ]));
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("qa"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("CI");
    expect(result.error).toContain("ci_check_runs");
  });

  it("does not count skipped or still-running checks as verdicts either way", async () => {
    // One completed success among a skipped check and one still in progress:
    // the verdict is green, and the skipped/in-progress rows are neither
    // evidence for nor against the commit.
    const fetchImpl = vi.fn().mockResolvedValue(checkRunsResponse([
      { name: "CI", status: "completed", conclusion: "success", html_url: "https://ci/1" },
      { name: "Migrations", status: "completed", conclusion: "skipped", html_url: "https://ci/2" },
      { name: "Browser", status: "in_progress", conclusion: null, html_url: "https://ci/3" },
    ]));
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("qa"));

    expect(result.status).toBe("SUCCEEDED");
    if (result.status !== "SUCCEEDED") return;
    expect(result.output).toMatchObject({ total: 1, failing: [] });
  });

  it("refuses to invent a verdict when no completed check runs exist yet", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(checkRunsResponse([]));
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("qa"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("no verdict to record yet");
  });

  it("reports an observation the API refused instead of substituting one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(checkRunsResponse([], 403));
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("qa"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("HTTP 403");
    expect(result.error).toContain("no verdict was invented");
  });

  it("is Not Connected without a GitHub token, and never calls out", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({ ...connected, gitHubToken: null, fetchImpl });

    const result = await execute(anchorNode("qa"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("Not Connected");
    expect(result.error).toContain("GitHub token");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is Not Connected without a commit to observe", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({ ...connected, headSha: null, fetchImpl });

    const result = await execute(anchorNode("qa"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("no commit to observe");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the MONITOR anchor (synthesis): the production probe", () => {
  it("records a healthy probe with its status and latency", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("synthesis", "monitor"));

    expect(result.status).toBe("SUCCEEDED");
    if (result.status !== "SUCCEEDED") return;
    expect(result.output).toMatchObject({
      observation: "production_http_probe",
      url: connected.productionUrl,
      status: 200,
      healthy: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      connected.productionUrl,
      expect.objectContaining({ method: "GET", redirect: "follow" }),
    );
  });

  it("records an unhealthy answer as the failure it is", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("down", { status: 503 }));
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("synthesis", "monitor"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("HTTP 503");
    expect(result.error).toContain("production_http_probe");
  });

  it("records an unreachable product as the observation, not an error to hide", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("synthesis", "monitor"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("getaddrinfo ENOTFOUND");
    expect(result.error).toContain("That is the observation");
  });

  it("is Not Connected without a production URL", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({ ...connected, productionUrl: null, fetchImpl });

    const result = await execute(anchorNode("synthesis", "monitor"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("Not Connected");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the DEPLOY anchor: refused by policy, on the record", () => {
  it("refuses the deploy-shaped anchor and names the policy, not a fault", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("implementation", "deploy"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("owner-approved in Phase 1");
    expect(result.error).toContain("policy holding, not a fault");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
