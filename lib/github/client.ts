import "server-only";

import { createSign } from "node:crypto";

import { z } from "zod";

import type { GitHubAppConfiguration } from "@/lib/github/config";
import type {
  GitHubInstallationSnapshot,
  GitHubInstallationToken,
  GitHubRepositorySnapshot,
} from "@/lib/github/types";

const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const MAX_GITHUB_RESPONSE_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

const installationSchema = z.object({
  id: z.number().int().positive(),
  app_id: z.number().int().positive(),
  app_slug: z.string().min(1).max(100),
  account: z.object({
    avatar_url: z.string().url().nullable().optional(),
    id: z.number().int().positive(),
    login: z.string().min(1).max(100),
    type: z.enum(["Organization", "User"]),
  }),
  repository_selection: z.enum(["all", "selected"]),
  permissions: z.record(z.string(), z.string()),
  events: z.array(z.string()),
  created_at: z.string().datetime({ offset: true }),
  target_type: z.enum(["Organization", "User"]),
  suspended_at: z.string().datetime({ offset: true }).nullable(),
});

const repositorySchema = z.object({
  id: z.number().int().positive(),
  node_id: z.string().nullable().optional(),
  name: z.string().min(1).max(100),
  full_name: z.string().min(3).max(201),
  owner: z.object({ login: z.string().min(1).max(100) }),
  private: z.boolean(),
  html_url: z.string().url(),
  visibility: z.enum(["public", "private", "internal"]),
  updated_at: z.string().datetime({ offset: true }),
  pushed_at: z.string().datetime({ offset: true }).nullable(),
  default_branch: z.string().min(1).max(255),
  archived: z.boolean().default(false),
  disabled: z.boolean().default(false),
  permissions: z.record(z.string(), z.boolean()).optional().default({}),
});

const repositoriesSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(repositorySchema),
});

const accessTokenSchema = z.object({
  token: z.string().min(20),
  expires_at: z.string().datetime({ offset: true }),
});

const userTokenSchema = z.object({
  access_token: z.string().min(20),
  token_type: z.string(),
});

export class GitHubApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.code = code;
  }
}

type GitHubRequestOptions = {
  body?: unknown;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  token: string;
};

function safeGitHubUrl(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new GitHubApiError(500, "invalid_github_path", "The GitHub API path is invalid.");
  }
  const url = new URL(path, GITHUB_API_ORIGIN);
  if (url.origin !== GITHUB_API_ORIGIN) {
    throw new GitHubApiError(500, "invalid_github_path", "The GitHub API path is invalid.");
  }
  return url;
}

async function readBoundedResponse(response: Response) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_GITHUB_RESPONSE_BYTES) {
    throw new GitHubApiError(502, "github_response_too_large", "GitHub returned an oversized response.");
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_GITHUB_RESPONSE_BYTES) {
    throw new GitHubApiError(502, "github_response_too_large", "GitHub returned an oversized response.");
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new GitHubApiError(502, "github_invalid_response", "GitHub returned an invalid response.");
  }
}

export async function githubApiRequest(
  path: string,
  options: GitHubRequestOptions,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(safeGitHubUrl(path), {
      method: options.method ?? "GET",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
        "User-Agent": "SoftwareFactory-Control-Plane",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GitHubApiError(502, "github_unavailable", "GitHub could not be reached.");
  }

  const body = await readBoundedResponse(response);
  if (!response.ok) {
    const upstreamStatus = response.status;
    const remaining = response.headers.get("x-ratelimit-remaining");
    const resetValue = response.headers.get("x-ratelimit-reset");
    const resetSeconds = resetValue ? Number(resetValue) : Number.NaN;
    const retryAfter = response.headers.get("retry-after");
    if (upstreamStatus === 429 || remaining === "0") {
      const resetAt = Number.isSafeInteger(resetSeconds) && resetSeconds > 0
        ? new Date(resetSeconds * 1000).toISOString()
        : null;
      throw new GitHubApiError(
        429,
        "github_rate_limited",
        resetAt
          ? `GitHub rate limit reached. Try again after ${resetAt}.`
          : retryAfter
            ? `GitHub rate limit reached. Try again in approximately ${retryAfter} seconds.`
            : "GitHub rate limit reached. Try again later.",
      );
    }
    if (upstreamStatus === 401) {
      throw new GitHubApiError(
        503,
        "github_installation_revoked",
        "GitHub Connection Lost. Reconnect the GitHub App installation.",
      );
    }
    if (upstreamStatus === 403) {
      throw new GitHubApiError(
        403,
        "github_permission_denied",
        "The GitHub App installation does not have permission for this operation.",
      );
    }
    const status = upstreamStatus === 401 || upstreamStatus === 403
      ? 502
      : upstreamStatus === 404
        ? 404
        : upstreamStatus === 409 || upstreamStatus === 422
          ? 409
          : 502;
    throw new GitHubApiError(
      status,
      upstreamStatus === 404 ? "github_resource_not_found" : "github_request_failed",
      upstreamStatus === 404
        ? "The requested GitHub resource was not found or is not installed."
        : "GitHub rejected or could not complete the request.",
    );
  }
  return body;
}

function encodeJwtSegment(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function createGitHubAppJwt(
  configuration: Pick<GitHubAppConfiguration, "appId" | "privateKey">,
  now = Date.now(),
) {
  const nowSeconds = Math.floor(now / 1000);
  const header = encodeJwtSegment({ alg: "RS256", typ: "JWT" });
  const payload = encodeJwtSegment({
    exp: nowSeconds + 9 * 60,
    iat: nowSeconds - 30,
    iss: configuration.appId,
  });
  const unsigned = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .end()
    .sign(configuration.privateKey, "base64url");
  return `${unsigned}.${signature}`;
}

export async function exchangeGitHubUserCode(
  configuration: Pick<GitHubAppConfiguration, "callbackUrl" | "clientId" | "clientSecret">,
  code: string,
) {
  let response: Response;
  try {
    response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      body: JSON.stringify({
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        code,
        redirect_uri: configuration.callbackUrl,
      }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "SoftwareFactory-Control-Plane",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GitHubApiError(502, "github_oauth_unavailable", "GitHub authorization could not be completed.");
  }
  const raw = await readBoundedResponse(response);
  if (!response.ok) {
    throw new GitHubApiError(502, "github_oauth_failed", "GitHub authorization could not be completed.");
  }
  const parsed = userTokenSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GitHubApiError(502, "github_oauth_failed", "GitHub authorization could not be verified.");
  }
  return parsed.data.access_token;
}

export async function verifyUserCanAccessInstallation(userToken: string, installationId: number) {
  const raw = await githubApiRequest(`/user/installations/${installationId}`, { token: userToken });
  const parsed = installationSchema.safeParse(raw);
  if (!parsed.success || parsed.data.id !== installationId) {
    throw new GitHubApiError(403, "github_installation_not_authorized", "The GitHub installation is not authorized for this user.");
  }
  return parsed.data;
}

export async function revokeGitHubUserToken(
  configuration: Pick<GitHubAppConfiguration, "clientId" | "clientSecret">,
  userToken: string,
) {
  const basic = Buffer.from(`${configuration.clientId}:${configuration.clientSecret}`, "utf8").toString("base64");
  try {
    await fetch(`https://api.github.com/applications/${encodeURIComponent(configuration.clientId)}/token`, {
      method: "DELETE",
      body: JSON.stringify({ access_token: userToken }),
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
        "User-Agent": "SoftwareFactory-Control-Plane",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // The ephemeral user token is never stored. Revocation is best-effort because
    // a provider outage must not cause the secret to be logged or persisted.
  }
}

export async function getGitHubInstallation(
  configuration: Pick<GitHubAppConfiguration, "appId" | "privateKey">,
  installationId: number,
) {
  let raw: unknown;
  try {
    raw = await githubApiRequest(`/app/installations/${installationId}`, {
      token: createGitHubAppJwt(configuration),
    });
  } catch (error) {
    if (error instanceof GitHubApiError && error.code === "github_resource_not_found") {
      throw new GitHubApiError(
        503,
        "github_installation_revoked",
        "GitHub Connection Lost. Reconnect the GitHub App installation.",
      );
    }
    throw error;
  }
  const parsed = installationSchema.safeParse(raw);
  if (!parsed.success || parsed.data.id !== installationId || parsed.data.app_id !== configuration.appId) {
    throw new GitHubApiError(502, "github_installation_invalid", "GitHub returned invalid installation metadata.");
  }
  return parsed.data;
}

export async function createGitHubInstallationToken(
  configuration: Pick<GitHubAppConfiguration, "appId" | "privateKey">,
  installationId: number,
  scope?: { permissions?: Record<string, "read" | "write">; repositoryIds?: number[] },
): Promise<GitHubInstallationToken> {
  const body: Record<string, unknown> = {};
  if (scope?.repositoryIds?.length) body.repository_ids = scope.repositoryIds;
  if (scope?.permissions && Object.keys(scope.permissions).length) body.permissions = scope.permissions;

  let raw: unknown;
  try {
    raw = await githubApiRequest(`/app/installations/${installationId}/access_tokens`, {
      body,
      method: "POST",
      token: createGitHubAppJwt(configuration),
    });
  } catch (error) {
    if (error instanceof GitHubApiError && error.code === "github_resource_not_found") {
      throw new GitHubApiError(
        503,
        "github_installation_revoked",
        "GitHub Connection Lost. Reconnect the GitHub App installation.",
      );
    }
    throw error;
  }
  const parsed = accessTokenSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GitHubApiError(502, "github_token_exchange_failed", "GitHub did not issue a valid installation token.");
  }
  return { expiresAt: parsed.data.expires_at, token: parsed.data.token };
}

function mapRepository(repository: z.infer<typeof repositorySchema>): GitHubRepositorySnapshot {
  return {
    archived: repository.archived,
    defaultBranch: repository.default_branch,
    disabled: repository.disabled,
    fullName: repository.full_name,
    htmlUrl: repository.html_url,
    githubUpdatedAt: repository.updated_at,
    id: repository.id,
    name: repository.name,
    nodeId: repository.node_id ?? null,
    ownerLogin: repository.owner.login,
    permissions: repository.permissions,
    private: repository.private,
    pushedAt: repository.pushed_at,
    visibility: repository.visibility,
  };
}

export async function listGitHubInstallationRepositories(token: string) {
  const repositories: GitHubRepositorySnapshot[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const raw = await githubApiRequest(`/installation/repositories?per_page=100&page=${page}`, { token });
    const parsed = repositoriesSchema.safeParse(raw);
    if (!parsed.success) {
      throw new GitHubApiError(502, "github_repositories_invalid", "GitHub returned invalid repository metadata.");
    }
    repositories.push(...parsed.data.repositories.map(mapRepository));
    if (repositories.length >= parsed.data.total_count || parsed.data.repositories.length < 100) break;
  }
  if (repositories.length >= 500) {
    throw new GitHubApiError(
      409,
      "github_repository_limit_exceeded",
      "This installation exposes 500 or more repositories. Select a smaller repository set in GitHub.",
    );
  }
  return repositories;
}

export async function fetchGitHubInstallationSnapshot(
  configuration: Pick<GitHubAppConfiguration, "appId" | "privateKey">,
  installationId: number,
): Promise<GitHubInstallationSnapshot> {
  const installation = await getGitHubInstallation(configuration, installationId);
  const installationToken = await createGitHubInstallationToken(configuration, installationId);
  const repositories = await listGitHubInstallationRepositories(installationToken.token);
  return {
    account: {
      avatarUrl: installation.account.avatar_url ?? null,
      id: installation.account.id,
      login: installation.account.login,
      type: installation.account.type,
    },
    appId: installation.app_id,
    appSlug: installation.app_slug,
    events: installation.events,
    id: installation.id,
    installedAt: installation.created_at,
    permissions: installation.permissions,
    repositories,
    repositorySelection: installation.repository_selection,
    suspendedAt: installation.suspended_at,
    targetType: installation.target_type,
  };
}
