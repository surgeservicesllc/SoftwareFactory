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
 * invented reading. CI accepts only explicit produced-change lineage, while
 * the deploy-shaped anchor separately accepts only an explicit merge SHA on
 * the exact base branch reported successful by Vercel's GitHub deployment
 * status. The worker's own checkout cannot satisfy either boundary.
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
    backoffMs: 0,
    allowProviderFallback: false,
    reads: [],
    writes: [],
    toleratesPartialInputs: false,
  } as CompiledNode;
}

const connected = {
  templateKey: "full_lifecycle",
  templateVersion: 2,
  repositoryFullName: "owner/repository",
  baseBranch: "main",
  baseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  phase1cState: "DEPLOYMENT_RECORDED",
  producedChangeSha: "0123456789abcdef0123456789abcdef01234567",
  pullRequestNumber: 309,
  pullRequestUrl: "https://github.com/owner/repository/pull/309",
  validationEvidence: {
    agent_run_id: "20000000-0000-4000-8000-000000000309",
    head_sha: "0123456789abcdef0123456789abcdef01234567",
    validation_round: 1,
    validations: [
      { name: "diff-check", status: "passed" as const, duration_ms: 20 },
      { name: "test", status: "passed" as const, duration_ms: 200 },
    ],
  },
  mergeCommitSha: "89abcdef0123456789abcdef0123456789abcdef",
  deploymentId: "30000000-0000-4000-8000-000000000309",
  deploymentUrl: "https://softwarefactory-exact-owner.vercel.app",
  gitHubToken: "ghs_workflow-token",
  requiredCheckNames: ["CI"],
  ciMaxAttempts: 1,
  ciPollMs: 0,
  monitorMaxAttempts: 1,
  monitorPollMs: 0,
};

function checkRunsResponse(runs: ReadonlyArray<Record<string, unknown>>, status = 200) {
  return new Response(JSON.stringify({
    check_runs: runs.map((run, index) => ({ id: index + 1, ...run })),
  }), { status });
}

describe("the IMPLEMENT anchor: durable Phase 1C change lineage", () => {
  it("records the exact graph-scoped base, head, and pull request without a model or network call", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("implementation", "implement"));

    expect(result.status).toBe("SUCCEEDED");
    if (result.status !== "SUCCEEDED") return;
    expect(result.output).toMatchObject({
      observation: "phase1c_change_lineage",
      repository: connected.repositoryFullName,
      baseBranch: connected.baseBranch,
      baseSha: connected.baseSha,
      headSha: connected.producedChangeSha,
      pullRequestNumber: connected.pullRequestNumber,
      pullRequestUrl: connected.pullRequestUrl,
      bridgeState: connected.phase1cState,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed as Not Connected before the bridge records a pull request", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({
      ...connected,
      phase1cState: "PHASE1C_BOUND",
      fetchImpl,
    });

    const result = await execute(anchorNode("implementation", "implement"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("PULL_REQUEST_RECORDED");
    expect(result.error).toContain("Not Connected");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a pull-request URL that does not belong to the recorded repository and number", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({
      ...connected,
      pullRequestUrl: "https://github.com/attacker/other/pull/309",
      fetchImpl,
    });

    const result = await execute(anchorNode("implementation", "implement"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("does not match its repository and number");
    expect(result.error).toContain("Not Connected");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the REVIEW anchor: exact PR plus bounded Phase 1C validation", () => {
  function pullRequest(overrides: Record<string, unknown> = {}) {
    return new Response(JSON.stringify({
      number: connected.pullRequestNumber,
      html_url: connected.pullRequestUrl,
      state: "open",
      draft: true,
      merged_at: null,
      head: { sha: connected.producedChangeSha, repo: { full_name: connected.repositoryFullName } },
      base: { ref: connected.baseBranch, repo: { full_name: connected.repositoryFullName } },
      ...overrides,
    }), { status: 200 });
  }

  it("records an exact open PR only after the latest validation round passes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pullRequest());
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("review", "review"));

    expect(result.status).toBe("SUCCEEDED");
    if (result.status !== "SUCCEEDED") return;
    expect(result.output).toMatchObject({
      observation: "phase1c_pull_request_review",
      agentRunId: connected.validationEvidence.agent_run_id,
      headSha: connected.producedChangeSha,
      pullRequestNumber: connected.pullRequestNumber,
      state: "open",
      draft: true,
      validationRound: 1,
      validations: expect.arrayContaining([
        expect.objectContaining({ name: "diff-check", status: "passed" }),
      ]),
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.github.com/repos/${connected.repositoryFullName}/pulls/${connected.pullRequestNumber}`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer ghs_workflow-token" }),
      }),
    );
  });

  it("fails closed before GitHub when validation names a different head", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({
      ...connected,
      validationEvidence: {
        ...connected.validationEvidence,
        head_sha: "ffffffffffffffffffffffffffffffffffffffff",
      },
      fetchImpl,
    });

    const result = await execute(anchorNode("review", "review"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("not tied to this run and head SHA");
    expect(result.error).toContain("Not Connected");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses failed deterministic validation before reading the pull request", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({
      ...connected,
      validationEvidence: {
        ...connected.validationEvidence,
        validations: [{ name: "diff-check", status: "failed", duration_ms: 20 }],
      },
      fetchImpl,
    });

    const result = await execute(anchorNode("review", "review"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("incomplete or failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a GitHub PR whose head differs from the durable bridge", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pullRequest({
      head: { sha: "ffffffffffffffffffffffffffffffffffffffff", repo: { full_name: connected.repositoryFullName } },
    }));
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("review", "review"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("does not match the durable Phase 1C");
  });
});

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
      sha: connected.producedChangeSha,
      repository: connected.repositoryFullName,
      total: 1,
      checks: [{ name: "CI", conclusion: "success", url: "https://ci/1" }],
      failing: [],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.github.com/repos/owner/repository/commits/${connected.producedChangeSha}/check-runs?per_page=100`,
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

  it("reads only the required checks when the repository has named its verdict", async () => {
    // Supabase Preview has been red for weeks on every commit. The repository
    // itself does not require it, so it must not veto a commit the four
    // required checks verified.
    const fetchImpl = vi.fn().mockResolvedValue(checkRunsResponse([
      { id: 1, name: "Lint, typecheck, test, and build", status: "completed", conclusion: "success", html_url: "https://ci/1" },
      { id: 2, name: "Browser and accessibility tests 1/1", status: "completed", conclusion: "success", html_url: "https://ci/2" },
      { id: 3, name: "Supabase Preview", status: "completed", conclusion: "failure", html_url: "https://ci/3" },
    ]));
    const execute = buildAnchorNodeExecutor({
      ...connected,
      requiredCheckNames: ["Lint, typecheck, test, and build", "Browser and accessibility tests 1/1"],
      fetchImpl,
    });

    const result = await execute(anchorNode("qa"));

    expect(result.status).toBe("SUCCEEDED");
    if (result.status !== "SUCCEEDED") return;
    expect(result.output).toMatchObject({ total: 2, failing: [] });
  });

  it("fails on a red required check, and reads a re-run at its latest attempt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(checkRunsResponse([
      { id: 4, name: "Lint, typecheck, test, and build", status: "completed", conclusion: "failure", html_url: "https://ci/4" },
      // The re-run: same name, higher id, and it is the one that counts.
      { id: 9, name: "Lint, typecheck, test, and build", status: "completed", conclusion: "failure", html_url: "https://ci/9" },
    ]));
    const execute = buildAnchorNodeExecutor({
      ...connected,
      requiredCheckNames: ["Lint, typecheck, test, and build"],
      fetchImpl,
    });

    const result = await execute(anchorNode("qa"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("Lint, typecheck, test, and build");
    expect(result.error).toContain("https://ci/9");
  });

  it("records no verdict while a required check is missing or still running", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(checkRunsResponse([
      { id: 5, name: "Lint, typecheck, test, and build", status: "in_progress", conclusion: null, html_url: "https://ci/5" },
    ]));
    const execute = buildAnchorNodeExecutor({
      ...connected,
      requiredCheckNames: ["Lint, typecheck, test, and build", "Browser and accessibility tests 1/1"],
      fetchImpl,
    });

    const result = await execute(anchorNode("qa"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("not yet reported");
    expect(result.error).toContain("no verdict to record yet");
  });

  it("polls boundedly until every exact-head required check is green", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(checkRunsResponse([
        { id: 5, name: "CI", status: "in_progress", conclusion: null, html_url: "https://ci/5" },
      ]))
      .mockResolvedValueOnce(checkRunsResponse([
        { id: 6, name: "CI", status: "completed", conclusion: "success", html_url: "https://ci/6" },
      ]));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const execute = buildAnchorNodeExecutor({
      ...connected,
      ciMaxAttempts: 2,
      ciPollMs: 10,
      fetchImpl,
      sleep,
    });

    const result = await execute(anchorNode("qa", "test"));

    expect(result.status).toBe("SUCCEEDED");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
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
    const execute = buildAnchorNodeExecutor({ ...connected, producedChangeSha: null, fetchImpl });

    const result = await execute(anchorNode("qa"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("no valid produced-change SHA is recorded");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is Not Connected without the repository's exact required-check policy", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({
      ...connected,
      requiredCheckNames: [],
      fetchImpl,
    });

    const result = await execute(anchorNode("qa", "test"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("required-check policy is absent");
    expect(result.error).toContain("Not Connected");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a CI verdict whose check names do not match the claimed repository policy", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(checkRunsResponse([
      { id: 1, name: "CI", status: "completed", conclusion: "success", html_url: "https://ci/1" },
    ]));
    const execute = buildAnchorNodeExecutor({
      ...connected,
      requiredCheckNames: ["Repository-owned exact check"],
      fetchImpl,
    });

    const result = await execute(anchorNode("qa", "test"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("Repository-owned exact check");
    expect(result.error).toContain("not yet reported");
    expect(result.error).toContain("no verdict to record yet");
  });

  it("refuses malformed produced-change lineage before calling GitHub", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({
      ...connected,
      producedChangeSha: "not-a-commit",
      fetchImpl,
    });

    const result = await execute(anchorNode("qa"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("no valid produced-change SHA is recorded");
    expect(result.error).toContain("Not Connected");
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
      deploymentId: connected.deploymentId,
      url: connected.deploymentUrl,
      status: 200,
      healthy: true,
      postDeployValidation: "inconclusive",
      observationWindowComplete: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      connected.deploymentUrl,
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
  });

  it("records an unhealthy answer as the failure it is", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("down", { status: 503 }));
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("synthesis", "monitor"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("received 503");
    expect(result.error).toContain("production_http_probe");
  });

  it("polls boundedly while the exact deployment is warming up", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("warming", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const execute = buildAnchorNodeExecutor({
      ...connected,
      monitorMaxAttempts: 2,
      monitorPollMs: 10,
      fetchImpl,
      sleep,
    });

    const result = await execute(anchorNode("synthesis", "monitor"));

    expect(result.status).toBe("SUCCEEDED");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it("records an unreachable product as the observation, not an error to hide", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("synthesis", "monitor"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("could not be reached");
    expect(result.error).not.toContain("getaddrinfo ENOTFOUND");
  });

  it("refuses a private deployment target without issuing a request", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({
      ...connected,
      deploymentUrl: "https://169.254.169.254/latest/meta-data",
      fetchImpl,
    });

    const result = await execute(anchorNode("synthesis", "monitor"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toMatch(/private|loopback/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records a redirect as a failed probe and never follows it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "https://127.0.0.1/admin" },
    }));
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("synthesis", "monitor"));

    expect(result.status).toBe("FAILED");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      connected.deploymentUrl,
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("is Not Connected without a production URL", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({ ...connected, deploymentUrl: null, fetchImpl });

    const result = await execute(anchorNode("synthesis", "monitor"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("Not Connected");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the DEPLOY anchor: the exact Vercel Production deployment", () => {
  const deployment = {
    id: 6130925898,
    sha: connected.mergeCommitSha,
    ref: connected.baseBranch,
    environment: "Production",
    task: "deploy",
    creator: { login: "vercel[bot]" },
  };
  const deploymentStatusUrl =
    "https://api.github.com/repos/owner/repository/deployments/6130925898/statuses?per_page=1";

  it("records the exact successful Vercel-bot deployment as anchored evidence", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([deployment]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        state: "success",
        creator: { login: "vercel[bot]" },
        environment_url: "https://softwarefactory-exact-owner.vercel.app",
      }]), { status: 200 }));
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("implementation", "deploy"));

    expect(result.status).toBe("SUCCEEDED");
    if (result.status !== "SUCCEEDED") return;
    expect(result.output).toMatchObject({
      observation: "github_production_deployment",
      repository: connected.repositoryFullName,
      sha: connected.mergeCommitSha,
      ref: connected.baseBranch,
      deploymentId: deployment.id,
      environment: "Production",
      state: "success",
      environmentUrl: "https://softwarefactory-exact-owner.vercel.app",
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/owner/repository/deployments?environment=Production&per_page=100",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer ghs_workflow-token" }) }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      deploymentStatusUrl,
      expect.any(Object),
    );
  });

  it("waits boundedly while the exact deployment is still pending", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([deployment]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        state: "pending",
        creator: { login: "vercel[bot]" },
        environment_url: "https://softwarefactory-exact-owner.vercel.app",
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([deployment]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        state: "success",
        creator: { login: "vercel[bot]" },
        environment_url: "https://softwarefactory-exact-owner.vercel.app",
      }]), { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const execute = buildAnchorNodeExecutor({
      ...connected,
      deploymentMaxAttempts: 2,
      deploymentPollMs: 10,
      fetchImpl,
      sleep,
    });

    const result = await execute(anchorNode("implementation", "deploy"));

    expect(result.status).toBe("SUCCEEDED");
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it("refuses a healthy deployment for a different commit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      ...deployment,
      sha: "ffffffffffffffffffffffffffffffffffffffff",
    }]), { status: 200 }));
    const execute = buildAnchorNodeExecutor({
      ...connected,
      deploymentMaxAttempts: 1,
      fetchImpl,
    });

    const result = await execute(anchorNode("implementation", "deploy"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("matches exact SHA");
    expect(result.error).toContain(connected.mergeCommitSha.slice(0, 8));
  });

  it("refuses an exact SHA deployed from a different branch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      ...deployment,
      ref: "release-candidate",
    }]), { status: 200 }));
    const execute = buildAnchorNodeExecutor({
      ...connected,
      deploymentMaxAttempts: 1,
      fetchImpl,
    });

    const result = await execute(anchorNode("implementation", "deploy"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("on main");
  });

  it("records a terminal Vercel failure instead of waiting it away", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([deployment]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        state: "failure",
        creator: { login: "vercel[bot]" },
        environment_url: "https://softwarefactory-exact-owner.vercel.app",
      }]), { status: 200 }));
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("implementation", "deploy"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("ended failure");
    expect(result.error).toContain("github_production_deployment");
  });

  it("refuses a successful deployment whose URL differs from the bridge", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([deployment]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        state: "success",
        creator: { login: "vercel[bot]" },
        environment_url: "https://different-release.vercel.app",
      }]), { status: 200 }));
    const execute = buildAnchorNodeExecutor({ ...connected, fetchImpl });

    const result = await execute(anchorNode("implementation", "deploy"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("does not match the durable bridge deployment URL");
  });

  it("is Not Connected without the read-scoped GitHub token", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({ ...connected, gitHubToken: null, fetchImpl });

    const result = await execute(anchorNode("implementation", "deploy"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("Not Connected");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is Not Connected when the bridge has not recorded the deployment yet", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({
      ...connected,
      phase1cState: "MERGE_RECORDED",
      deploymentId: null,
      deploymentUrl: null,
      fetchImpl,
    });

    const result = await execute(anchorNode("synthesis", "monitor"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("DEPLOYMENT_RECORDED");
    expect(result.error).toContain("Not Connected");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is Not Connected without a separately recorded merge commit", async () => {
    const fetchImpl = vi.fn();
    const execute = buildAnchorNodeExecutor({ ...connected, mergeCommitSha: null, fetchImpl });

    const result = await execute(anchorNode("implementation", "deploy"));

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.error).toContain("no valid merge-commit SHA is recorded");
    expect(result.error).toContain("Not Connected");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
