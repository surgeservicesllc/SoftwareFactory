import { createPrivateKey, createSign } from "node:crypto";

import { z } from "zod";

import { githubWebUrlSchema } from "@/lib/github/schemas";
import { redactText } from "@/lib/worker/redact";
import type { GraphExecutionTarget } from "@/lib/worker/graph-target";
import type { CheckResult, InstallationTokenProvider, WorkerJob } from "@/lib/worker/types";

const githubOrigin = "https://api.github.com";
const githubApiVersion = "2026-03-10";
const maximumGitHubResponseBytes = 8 * 1024 * 1024;

const tokenSchema = z.object({
  token: z.string().min(20),
  expires_at: z.string().datetime({ offset: true }),
});

const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  html_url: githubWebUrlSchema,
  state: z.literal("open"),
  draft: z.literal(true),
  head: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/i) }).passthrough(),
  base: z.object({
    ref: z.string().min(1).max(255),
    sha: z.string().regex(/^[0-9a-f]{40}$/i),
  }).passthrough(),
}).passthrough();

const pullRequestDetailSchema = pullRequestSchema;

const checksSchema = z.object({
  total_count: z.number().int().min(0).max(100),
  check_runs: z.array(z.object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(300),
    status: z.string().min(1).max(40),
    conclusion: z.string().max(80).nullable(),
    html_url: githubWebUrlSchema.nullable().optional(),
  }).passthrough()).max(100),
}).passthrough();

export class GitHubWorkerError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "GitHubWorkerError";
    this.code = code;
    this.status = status;
  }
}

function requiredEnvironment(environment: Readonly<Record<string, string | undefined>>, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new GitHubWorkerError("github_not_configured", `${name} is not configured.`, 503);
  return value;
}

function appConfigurationForId(appId: number, environment: Readonly<Record<string, string | undefined>>) {
  const candidates = ["GITHUB_APP", "GITHUB_CANDIDATE_APP"] as const;
  for (const prefix of candidates) {
    const configuredId = Number(environment[`${prefix}_ID`]?.trim());
    if (configuredId !== appId) continue;
    const encoded = environment[`${prefix}_PRIVATE_KEY_BASE64`]?.trim();
    const raw = encoded
      ? Buffer.from(encoded, "base64").toString("utf8")
      : requiredEnvironment(environment, `${prefix}_PRIVATE_KEY`).replace(/\\n/g, "\n");
    try {
      createPrivateKey(raw);
    } catch {
      throw new GitHubWorkerError("github_not_configured", "The configured GitHub App private key is invalid.", 503);
    }
    return { appId, privateKey: raw };
  }
  throw new GitHubWorkerError("github_not_configured", "The claimed GitHub App is not configured.", 503);
}

function appJwt(configuration: { appId: number; privateKey: string }, now = Date.now()) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const seconds = Math.floor(now / 1_000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    exp: seconds + 9 * 60,
    iat: seconds - 30,
    iss: configuration.appId,
  })}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .end()
    .sign(configuration.privateKey, "base64url");
  return `${unsigned}.${signature}`;
}

async function readBoundedResponse(response: Response) {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumGitHubResponseBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new GitHubWorkerError("github_response_too_large", "GitHub returned an invalid or oversized response.");
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumGitHubResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new GitHubWorkerError("github_response_too_large", "GitHub returned an oversized response.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new GitHubWorkerError("github_response_invalid", "GitHub returned invalid UTF-8.");
  }
}

async function githubRequest(
  path: string,
  options: { token: string; method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal },
) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new GitHubWorkerError("invalid_github_path", "The GitHub API path is invalid.");
  }
  const url = new URL(path, githubOrigin);
  if (url.origin !== githubOrigin) {
    throw new GitHubWorkerError("invalid_github_path", "The GitHub API path is invalid.");
  }
  let response: Response;
  options.signal?.throwIfAborted();
  const timeoutSignal = AbortSignal.timeout(20_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
        "User-Agent": "SoftwareFactory-Codex-Worker",
        "X-GitHub-Api-Version": githubApiVersion,
      },
      cache: "no-store",
      redirect: "error",
      signal,
    });
  } catch {
    if (options.signal?.aborted) {
      throw new DOMException("The GitHub operation was cancelled.", "AbortError");
    }
    throw new GitHubWorkerError("github_unavailable", "GitHub could not be reached.");
  }
  const text = await readBoundedResponse(response);
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text) as unknown; } catch { body = null; }
  }
  if (!response.ok) {
    const rateLimited = response.status === 429
      || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
    throw new GitHubWorkerError(
      rateLimited ? "github_rate_limited" : `github_${response.status}`,
      rateLimited ? "GitHub rate limited the worker." : "GitHub rejected the worker operation.",
      rateLimited ? 429 : response.status,
    );
  }
  return body;
}

export class GitHubAppInstallationTokenProvider implements InstallationTokenProvider {
  constructor(
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env,
  ) {}

  async createToken(job: WorkerJob, signal?: AbortSignal) {
    const configuration = appConfigurationForId(job.repository.appId, this.environment);
    const raw = await githubRequest(
      `/app/installations/${job.repository.installationId}/access_tokens`,
      {
        method: "POST",
        token: appJwt(configuration),
        body: {
          repository_ids: [job.repository.repositoryId],
          permissions: {
            actions: "read",
            checks: "read",
            contents: "write",
            metadata: "read",
            pull_requests: "write",
            statuses: "read",
          },
        },
        signal,
      },
    );
    const parsed = tokenSchema.safeParse(raw);
    if (!parsed.success) {
      throw new GitHubWorkerError("github_token_invalid", "GitHub returned an invalid installation token response.");
    }
    return { token: parsed.data.token, expiresAt: parsed.data.expires_at };
  }
}

/**
 * Graph workers never publish. Their token is scoped to the exact repository
 * id resolved from the graph and carries only read permissions needed to
 * fetch the pinned tree and observe its existing PR/check/deployment evidence.
 */
export class GitHubGraphReadTokenProvider {
  constructor(
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env,
  ) {}

  async createToken(
    target: Pick<GraphExecutionTarget,
      "app_id" | "external_installation_id" | "external_repository_id">,
    signal?: AbortSignal,
  ) {
    const configuration = appConfigurationForId(target.app_id, this.environment);
    const raw = await githubRequest(
      `/app/installations/${target.external_installation_id}/access_tokens`,
      {
        method: "POST",
        token: appJwt(configuration),
        body: {
          repository_ids: [target.external_repository_id],
          permissions: {
            checks: "read",
            contents: "read",
            deployments: "read",
            metadata: "read",
            pull_requests: "read",
            statuses: "read",
          },
        },
        signal,
      },
    );
    const parsed = tokenSchema.safeParse(raw);
    if (!parsed.success) {
      throw new GitHubWorkerError(
        "github_token_invalid",
        "GitHub returned an invalid read-only graph installation token response.",
      );
    }
    return { token: parsed.data.token, expiresAt: parsed.data.expires_at };
  }
}

export type PublishedPullRequest = Readonly<{
  number: number;
  url: string;
  headSha: string;
}>;

export type CiObservation = Readonly<{
  status: "passed" | "failed" | "timed_out";
  checks: readonly CheckResult[];
}>;

export class GitHubDraftPublisher {
  constructor(
    private readonly request: typeof githubRequest = githubRequest,
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) => (
      new Promise((resolve) => setTimeout(resolve, milliseconds))
    ),
    private readonly clock: () => number = Date.now,
    private readonly requiredChecks: readonly string[] = [],
  ) {}

  private repositoryPath(job: WorkerJob) {
    return `/repos/${encodeURIComponent(job.repository.owner)}/${encodeURIComponent(job.repository.name)}`;
  }

  async verifyExistingDraft(
    job: WorkerJob,
    pullRequestNumber: number,
    expectedUrl: string,
    commitSha: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<PublishedPullRequest> {
    const parsed = pullRequestDetailSchema.safeParse(await this.request(
      `${this.repositoryPath(job)}/pulls/${pullRequestNumber}`,
      { token, signal },
    ));
    if (!parsed.success
      || parsed.data.number !== pullRequestNumber
      || parsed.data.html_url !== expectedUrl
      || parsed.data.head.sha.toLowerCase() !== commitSha.toLowerCase()
      || parsed.data.base.ref !== job.repository.baseBranch
      || parsed.data.base.sha.toLowerCase() !== job.repository.baseSha.toLowerCase()) {
      throw new GitHubWorkerError(
        "github_pr_changed",
        "The recovered draft pull request no longer matches its immutable run evidence.",
        409,
      );
    }
    return Object.freeze({
      number: parsed.data.number,
      url: parsed.data.html_url,
      headSha: parsed.data.head.sha,
    });
  }

  async createOrRecoverDraft(
    job: WorkerJob,
    branch: string,
    commitSha: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<PublishedPullRequest> {
    const body = [
      `SoftwareFactory run \`${job.runId}\`.`,
      "",
      `Logical agent: \`${job.agentRole}\` via \`${job.provider}/${job.model}\`.`,
      `Risk: \`${job.risk.toUpperCase()}\`.`,
      "",
      "This pull request is intentionally a draft. SoftwareFactory did not merge or deploy it.",
    ].join("\n");
    signal?.throwIfAborted();
    try {
      const raw = await this.request(`${this.repositoryPath(job)}/pulls`, {
        method: "POST",
        token,
        body: {
          base: job.repository.baseBranch,
          head: branch,
          title: `Factory: ${job.prompt.slice(0, 180)}`,
          body,
          draft: true,
          maintainer_can_modify: false,
        },
        signal,
      });
      const parsed = pullRequestSchema.safeParse(raw);
      if (!parsed.success
        || parsed.data.head.sha.toLowerCase() !== commitSha.toLowerCase()
        || parsed.data.base.ref !== job.repository.baseBranch
        || parsed.data.base.sha.toLowerCase() !== job.repository.baseSha.toLowerCase()) {
        throw new GitHubWorkerError("github_pr_invalid", "GitHub returned invalid draft pull request evidence.");
      }
      return Object.freeze({
        number: parsed.data.number,
        url: parsed.data.html_url,
        headSha: parsed.data.head.sha,
      });
    } catch (error) {
      const head = encodeURIComponent(`${job.repository.owner}:${branch}`);
      let recovered: z.infer<typeof pullRequestSchema> | null = null;
      try {
        const raw = await this.request(
          `${this.repositoryPath(job)}/pulls?state=open&head=${head}&base=${encodeURIComponent(job.repository.baseBranch)}&per_page=10`,
          { token, signal },
        );
        const parsed = z.array(pullRequestSchema).safeParse(raw);
        recovered = parsed.success
          ? parsed.data.find((pullRequest) => (
              pullRequest.head.sha.toLowerCase() === commitSha.toLowerCase()
              && pullRequest.base.ref === job.repository.baseBranch
              && pullRequest.base.sha.toLowerCase() === job.repository.baseSha.toLowerCase()
            )) ?? null
          : null;
      } catch {
        // Preserve the original ambiguous mutation failure below.
      }
      if (!recovered) {
        throw error;
      }
      return Object.freeze({ number: recovered.number, url: recovered.html_url, headSha: recovered.head.sha });
    }
  }

  async waitForChecks(
    job: WorkerJob,
    pullRequestNumber: number,
    commitSha: string,
    token: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<CiObservation> {
    const deadline = this.clock() + timeoutMs;
    let lastChecks: CheckResult[] = [];
    let stablePassingFingerprint: string | null = null;
    while (this.clock() < deadline) {
      if (signal?.aborted) throw new DOMException("The CI observation was cancelled.", "AbortError");
      const raw = await this.request(
        `${this.repositoryPath(job)}/commits/${encodeURIComponent(commitSha)}/check-runs?per_page=100`,
        { token, signal },
      );
      const parsed = checksSchema.safeParse(raw);
      if (!parsed.success) {
        throw new GitHubWorkerError("github_checks_invalid", "GitHub returned invalid check-run evidence.");
      }
      if (parsed.data.total_count !== parsed.data.check_runs.length) {
        throw new GitHubWorkerError(
          "github_checks_incomplete",
          "GitHub returned an incomplete check-run set.",
        );
      }
      lastChecks = parsed.data.check_runs.map((check) => Object.freeze({
        id: check.id,
        name: redactText(check.name, { maximumLength: 300 }),
        status: check.status,
        conclusion: check.conclusion,
        url: check.html_url ?? null,
      }));
      if (lastChecks.length > 0 && lastChecks.every((check) => check.status === "completed")) {
        const passing = new Set(["success", "neutral", "skipped"]);
        const observedByName = new Map(lastChecks.map((check) => [check.name, check]));
        const required = this.requiredChecks.length > 0
          ? this.requiredChecks.map((name) => observedByName.get(name)).filter((check) => check !== undefined)
          : lastChecks;
        if ((this.requiredChecks.length > 0 && required.length !== this.requiredChecks.length)
          || !lastChecks.every((check) => check.conclusion !== null && passing.has(check.conclusion))
          || !required.every((check) => check.conclusion === "success")
          || !required.some((check) => check.conclusion === "success")) {
          if (lastChecks.some((check) => check.conclusion !== null && !passing.has(check.conclusion))) {
            return Object.freeze({ status: "failed", checks: Object.freeze(lastChecks) });
          }
          stablePassingFingerprint = null;
          await this.sleep(Math.min(10_000, Math.max(1_000, deadline - this.clock())));
          continue;
        }
        if (!lastChecks.every((check) => check.conclusion !== null && passing.has(check.conclusion))) {
          return Object.freeze({ status: "failed", checks: Object.freeze(lastChecks) });
        }
        const fingerprint = JSON.stringify([...lastChecks]
          .sort((left, right) => left.id - right.id)
          .map((check) => [check.id, check.name, check.status, check.conclusion]));
        if (stablePassingFingerprint === fingerprint) {
          const pullRequestPath = `${this.repositoryPath(job)}/pulls/${pullRequestNumber}`;
          const pullRequest = pullRequestDetailSchema.safeParse(await this.request(pullRequestPath, { token, signal }));
          if (!pullRequest.success || pullRequest.data.number !== pullRequestNumber
            || pullRequest.data.head.sha.toLowerCase() !== commitSha.toLowerCase()
            || pullRequest.data.base.ref !== job.repository.baseBranch
            || pullRequest.data.base.sha.toLowerCase() !== job.repository.baseSha.toLowerCase()) {
            throw new GitHubWorkerError("github_pr_changed", "The draft pull request changed before CI evidence stabilized.", 409);
          }
          return Object.freeze({ status: "passed", checks: Object.freeze(lastChecks) });
        }
        stablePassingFingerprint = fingerprint;
      } else {
        stablePassingFingerprint = null;
      }
      await this.sleep(Math.min(10_000, Math.max(1_000, deadline - this.clock())));
    }
    return Object.freeze({ status: "timed_out", checks: Object.freeze(lastChecks) });
  }
}
