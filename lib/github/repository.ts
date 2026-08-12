import "server-only";

import { z } from "zod";

import { GitHubApiError, githubApiRequest } from "@/lib/github/client";

const repositoryCoordinatePattern = /^[A-Za-z0-9_.-]+$/;
const shaPattern = /^[0-9a-f]{40,64}$/;
const MAX_FILE_BYTES = 1024 * 1024;

const branchSchema = z.object({
  name: z.string(),
  protected: z.boolean().default(false),
  commit: z.object({ sha: z.string().regex(shaPattern) }),
});

const pullRequestSchema = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  draft: z.boolean().nullable().default(false),
  html_url: z.string().url(),
  updated_at: z.string().datetime({ offset: true }),
  created_at: z.string().datetime({ offset: true }),
  mergeable: z.boolean().nullable().optional(),
  mergeable_state: z.string().nullable().optional(),
  user: z.object({
    avatar_url: z.string().url().nullable().optional(),
    login: z.string(),
  }).nullable(),
  head: z.object({ ref: z.string(), sha: z.string().regex(shaPattern) }),
  base: z.object({ ref: z.string() }),
});

const commitSchema = z.object({
  sha: z.string().regex(shaPattern),
  html_url: z.string().url(),
  commit: z.object({
    message: z.string(),
    author: z.object({
      name: z.string(),
      email: z.string().nullable().optional(),
      date: z.string().datetime({ offset: true }),
    }).nullable(),
  }),
  author: z.object({ login: z.string() }).nullable(),
});

const checkRunSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  status: z.enum(["queued", "in_progress", "completed", "pending", "requested", "waiting"]),
  conclusion: z.string().nullable(),
  html_url: z.string().url().nullable(),
  started_at: z.string().datetime({ offset: true }).nullable(),
  completed_at: z.string().datetime({ offset: true }).nullable(),
});

const contentsEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["file", "dir", "symlink", "submodule"]),
  sha: z.string().regex(shaPattern),
  size: z.number().int().nonnegative(),
  html_url: z.string().url().nullable(),
});

const fileSchema = contentsEntrySchema.extend({
  type: z.literal("file"),
  content: z.string(),
  encoding: z.literal("base64"),
});

const referenceSchema = z.object({
  ref: z.string(),
  object: z.object({ sha: z.string().regex(shaPattern) }),
});

const recursiveTreeSchema = z.object({
  sha: z.string().regex(shaPattern),
  truncated: z.boolean().default(false),
  tree: z.array(
    z.object({
      path: z.string(),
      type: z.enum(["blob", "tree", "commit"]),
      sha: z.string().regex(shaPattern).optional(),
      size: z.number().int().nonnegative().optional(),
    }),
  ),
});

const contentMutationSchema = z.object({
  content: z.object({ html_url: z.string().url().nullable() }).nullable(),
  commit: z.object({ sha: z.string().regex(shaPattern), html_url: z.string().url() }),
});

const createdPullRequestSchema = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  draft: z.boolean(),
  html_url: z.string().url(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, message: string) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new GitHubApiError(502, "github_invalid_response", message);
  }
  return parsed.data;
}

export function validateRepositoryCoordinate(value: string, label: string) {
  if (!repositoryCoordinatePattern.test(value)) {
    throw new GitHubApiError(400, "invalid_repository", `${label} is invalid.`);
  }
  return value;
}

export function validateGitHubRef(value: string) {
  if (
    !value
    || value.length > 255
    || value.startsWith("/")
    || value.endsWith("/")
    || value.includes("..")
    || value.includes("@{")
    || /[~^:?*[\\\x00-\x20\x7f]/.test(value)
  ) {
    throw new GitHubApiError(400, "invalid_ref", "The Git reference is invalid.");
  }
  return value;
}

export function normalizeRepositoryPath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !normalized
    || normalized.length > 1024
    || normalized.startsWith("/")
    || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
    || /[\x00-\x1f\x7f]/.test(normalized)
  ) {
    throw new GitHubApiError(400, "invalid_path", "The repository path is invalid.");
  }
  return normalized;
}

export function isProtectedGitHubWritePath(path: string) {
  const normalized = normalizeRepositoryPath(path).toLowerCase();
  const segments = normalized.split("/");
  const fileName = segments.at(-1) ?? "";
  const protectedSubject = /(^|[._-])(auth|authorization|access|permission|role|rls|session|cookie|crypto|encrypt|secret|credential|private[-_]?key|webhook|deploy|deployment|release|rollback|dns|billing)([._-]|$)/;
  return fileName === "agents.md"
    || fileName === "claude.md"
    || fileName === "codeowners"
    || fileName === ".npmrc"
    || fileName === ".yarnrc"
    || fileName === ".yarnrc.yml"
    || fileName === ".pnpmfile.cjs"
    || fileName.startsWith(".env")
    || fileName.startsWith("dockerfile")
    || fileName.startsWith("docker-compose")
    || /^(next|nuxt|webpack|vite)\.config\.[a-z0-9]+$/.test(fileName)
    || normalized === ".github/codeowners"
    || normalized === "docs/codeowners"
    || normalized.startsWith(".github/")
    || normalized.startsWith("ai/")
    || normalized.startsWith("policies/")
    || normalized.startsWith("supabase/")
    || normalized.startsWith("app/api/")
    || normalized.startsWith("lib/github/")
    || normalized.startsWith("lib/server/")
    || normalized.startsWith("lib/supabase/")
    || normalized.startsWith(".vercel/")
    || normalized.startsWith("infra/")
    || normalized.startsWith("infrastructure/")
    || normalized.startsWith("terraform/")
    || normalized.startsWith("app/api/auth/")
    || normalized.startsWith("app/auth/")
    || normalized === "proxy.ts"
    || normalized === "middleware.ts"
    || normalized === "vercel.json"
    || normalized === "netlify.toml"
    || normalized === "fly.toml"
    || normalized === "wrangler.toml"
    || segments.includes("config")
    || segments.some((segment) => protectedSubject.test(segment));
}

function encodedPath(path: string) {
  return normalizeRepositoryPath(path).split("/").map(encodeURIComponent).join("/");
}

function repositoryPath(owner: string, repository: string) {
  return `/repos/${encodeURIComponent(validateRepositoryCoordinate(owner, "Repository owner"))}/${encodeURIComponent(validateRepositoryCoordinate(repository, "Repository name"))}`;
}

export async function listGitHubBranches(token: string, owner: string, repository: string) {
  const raw = await githubApiRequest(`${repositoryPath(owner, repository)}/branches?per_page=100`, { token });
  const branches = parseOrThrow(z.array(branchSchema), raw, "GitHub returned invalid branch metadata.");
  return branches.map((branch) => ({
    name: branch.name,
    protected: branch.protected,
    sha: branch.commit.sha,
  }));
}

export async function listGitHubPullRequests(token: string, owner: string, repository: string) {
  const raw = await githubApiRequest(`${repositoryPath(owner, repository)}/pulls?state=all&per_page=100`, { token });
  const pullRequests = parseOrThrow(z.array(pullRequestSchema), raw, "GitHub returned invalid pull request metadata.");
  return pullRequests.map((pullRequest) => ({
    baseBranch: pullRequest.base.ref,
    author: pullRequest.user
      ? { avatarUrl: pullRequest.user.avatar_url ?? null, login: pullRequest.user.login }
      : null,
    checks: null,
    createdAt: pullRequest.created_at,
    draft: pullRequest.draft ?? false,
    headBranch: pullRequest.head.ref,
    headSha: pullRequest.head.sha,
    id: pullRequest.id,
    mergeability: pullRequest.mergeable === null || pullRequest.mergeable === undefined
      ? "unknown"
      : pullRequest.mergeable
        ? "mergeable"
        : "conflicting",
    mergeableState: pullRequest.mergeable_state ?? null,
    number: pullRequest.number,
    state: pullRequest.state,
    title: pullRequest.title,
    updatedAt: pullRequest.updated_at,
    url: pullRequest.html_url,
  }));
}

export async function listGitHubCommits(
  token: string,
  owner: string,
  repository: string,
  sha: string,
  perPage = 30,
  path?: string,
) {
  const boundedPerPage = Math.min(Math.max(Math.trunc(perPage), 1), 100);
  const pathQuery = path ? `&path=${encodeURIComponent(normalizeRepositoryPath(path))}` : "";
  const raw = await githubApiRequest(
    `${repositoryPath(owner, repository)}/commits?sha=${encodeURIComponent(validateGitHubRef(sha))}&per_page=${boundedPerPage}${pathQuery}`,
    { token },
  );
  const commits = parseOrThrow(z.array(commitSchema), raw, "GitHub returned invalid commit metadata.");
  return commits.map((commit) => ({
    author: {
      githubLogin: commit.author?.login ?? null,
      name: commit.commit.author?.name ?? "Unknown author",
    },
    date: commit.commit.author?.date ?? null,
    message: commit.commit.message,
    sha: commit.sha,
    url: commit.html_url,
  }));
}

export async function listGitHubCheckRuns(
  token: string,
  owner: string,
  repository: string,
  ref: string,
) {
  const raw = await githubApiRequest(
    `${repositoryPath(owner, repository)}/commits/${encodeURIComponent(validateGitHubRef(ref))}/check-runs?per_page=100`,
    { token },
  );
  const parsed = parseOrThrow(
    z.object({ check_runs: z.array(checkRunSchema) }),
    raw,
    "GitHub returned invalid check run metadata.",
  );
  return parsed.check_runs.map((checkRun) => ({
    completedAt: checkRun.completed_at,
    conclusion: checkRun.conclusion,
    id: checkRun.id,
    name: checkRun.name,
    startedAt: checkRun.started_at,
    status: checkRun.status,
    url: checkRun.html_url,
  }));
}

export async function listGitHubTree(
  token: string,
  owner: string,
  repository: string,
  ref: string,
  path = "",
) {
  const suffix = path ? `/${encodedPath(path)}` : "";
  const raw = await githubApiRequest(
    `${repositoryPath(owner, repository)}/contents${suffix}?ref=${encodeURIComponent(validateGitHubRef(ref))}`,
    { token },
  );
  const entries = parseOrThrow(z.array(contentsEntrySchema), raw, "GitHub returned invalid repository tree metadata.");
  return entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    sha: entry.sha,
    size: entry.size,
    type: entry.type === "dir" ? "directory" : entry.type,
    url: entry.html_url,
  }));
}

const MAX_TREE_ENTRIES = 20_000;

/**
 * Reads the full repository tree at one commit so the worker can select the few
 * files relevant to a task. Entries are bounded, and a provider-truncated tree
 * is reported rather than silently treated as complete.
 */
export async function listGitHubRecursiveTree(
  token: string,
  owner: string,
  repository: string,
  commitSha: string,
) {
  if (!shaPattern.test(commitSha)) {
    throw new GitHubApiError(400, "invalid_sha", "The tree commit SHA is invalid.");
  }
  const raw = await githubApiRequest(
    `${repositoryPath(owner, repository)}/git/trees/${commitSha}?recursive=1`,
    { token },
  );
  const parsed = parseOrThrow(recursiveTreeSchema, raw, "GitHub returned invalid tree metadata.");

  return {
    truncated: parsed.truncated,
    entries: parsed.tree
      .filter((entry) => entry.type === "blob")
      .slice(0, MAX_TREE_ENTRIES)
      .map((entry) => ({ path: entry.path, sha: entry.sha ?? null, size: entry.size ?? 0 })),
  };
}

export async function getGitHubFile(
  token: string,
  owner: string,
  repository: string,
  ref: string,
  path: string,
) {
  const normalizedPath = normalizeRepositoryPath(path);
  const raw = await githubApiRequest(
    `${repositoryPath(owner, repository)}/contents/${encodedPath(normalizedPath)}?ref=${encodeURIComponent(validateGitHubRef(ref))}`,
    { token },
  );
  const file = parseOrThrow(fileSchema, raw, "GitHub returned invalid file metadata.");
  if (file.size > MAX_FILE_BYTES || Buffer.byteLength(file.content, "utf8") > 2 * MAX_FILE_BYTES) {
    throw new GitHubApiError(413, "github_file_too_large", "Files larger than 1 MiB are not editable in SoftwareFactory.");
  }
  const content = Buffer.from(file.content.replace(/\s/g, ""), "base64");
  if (content.byteLength !== file.size || content.byteLength > MAX_FILE_BYTES) {
    throw new GitHubApiError(502, "github_file_invalid", "GitHub returned inconsistent file content.");
  }
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(content);
  if (decoded.includes("\u0000")) {
    throw new GitHubApiError(415, "github_file_binary", "Binary files are not editable in SoftwareFactory.");
  }
  return {
    content: decoded,
    encoding: "utf-8" as const,
    path: file.path,
    ref,
    sha: file.sha,
    size: file.size,
    url: file.html_url,
  };
}

export async function getGitHubBranchReference(
  token: string,
  owner: string,
  repository: string,
  branch: string,
) {
  const raw = await githubApiRequest(
    `${repositoryPath(owner, repository)}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`,
    { token },
  );
  return parseOrThrow(referenceSchema, raw, "GitHub returned invalid branch metadata.");
}

export async function createGitHubBranch(
  token: string,
  owner: string,
  repository: string,
  branch: string,
  baseSha: string,
) {
  validateGitHubRef(branch);
  if (!shaPattern.test(baseSha)) throw new GitHubApiError(400, "invalid_sha", "The base commit SHA is invalid.");
  const raw = await githubApiRequest(`${repositoryPath(owner, repository)}/git/refs`, {
    body: { ref: `refs/heads/${branch}`, sha: baseSha },
    method: "POST",
    token,
  });
  return parseOrThrow(referenceSchema, raw, "GitHub returned invalid created branch metadata.");
}

export async function updateGitHubFileOnBranch(
  token: string,
  input: {
    branch: string;
    content: string;
    /** Required to replace an existing blob; null creates a new file. */
    expectedBlobSha: string | null;
    message: string;
    owner: string;
    path: string;
    repository: string;
  },
) {
  if (input.expectedBlobSha !== null && !shaPattern.test(input.expectedBlobSha)) {
    throw new GitHubApiError(400, "invalid_sha", "The expected file SHA is invalid.");
  }
  if (Buffer.byteLength(input.content, "utf8") > MAX_FILE_BYTES) {
    throw new GitHubApiError(413, "github_file_too_large", "Files larger than 1 MiB are not editable in SoftwareFactory.");
  }
  const raw = await githubApiRequest(
    `${repositoryPath(input.owner, input.repository)}/contents/${encodedPath(input.path)}`,
    {
      body: {
        branch: input.branch,
        content: Buffer.from(input.content, "utf8").toString("base64"),
        message: input.message,
        // Omitting `sha` tells GitHub to create the file; sending one requires
        // it to match, which is what keeps an update from silently overwriting.
        ...(input.expectedBlobSha === null ? {} : { sha: input.expectedBlobSha }),
      },
      method: "PUT",
      token,
    },
  );
  return parseOrThrow(contentMutationSchema, raw, "GitHub returned invalid commit metadata.");
}

export async function createGitHubDraftPullRequest(
  token: string,
  input: {
    baseBranch: string;
    body: string;
    headBranch: string;
    owner: string;
    repository: string;
    title: string;
  },
) {
  const raw = await githubApiRequest(`${repositoryPath(input.owner, input.repository)}/pulls`, {
    body: {
      base: validateGitHubRef(input.baseBranch),
      body: input.body,
      draft: true,
      head: validateGitHubRef(input.headBranch),
      maintainer_can_modify: false,
      title: input.title,
    },
    method: "POST",
    token,
  });
  const pullRequest = parseOrThrow(createdPullRequestSchema, raw, "GitHub returned invalid pull request metadata.");
  if (!pullRequest.draft || pullRequest.state !== "open") {
    throw new GitHubApiError(502, "github_pr_not_draft", "GitHub did not create the required draft pull request.");
  }
  return pullRequest;
}
