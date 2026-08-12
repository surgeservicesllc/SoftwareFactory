import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createGitHubInstallationToken } from "@/lib/github/client";
import { getGitHubAppConfiguration } from "@/lib/github/config";
import {
  getGitHubBranchReference,
  getGitHubFile,
  listGitHubRecursiveTree,
} from "@/lib/github/repository";
import type { RepositoryContextFile } from "@/lib/providers/types";

/**
 * Repository resolution and memory retrieval for the durable worker.
 *
 * The worker never guesses a repository. A run resolves
 * project -> primary GitHub connection -> active installation -> selected
 * repository -> synchronized default branch -> base SHA, and fails closed if
 * any link is missing, suspended, archived, or belongs to another organization.
 */

export class WorkerRepositoryError extends Error {
  readonly code:
    | "project_not_found"
    | "connection_missing"
    | "installation_unavailable"
    | "repository_unavailable";

  constructor(code: WorkerRepositoryError["code"], message: string) {
    super(message);
    this.name = "WorkerRepositoryError";
    this.code = code;
  }
}

export type ResolvedRepository = {
  readonly connectionId: string;
  readonly externalInstallationId: number;
  readonly externalRepositoryId: number;
  readonly owner: string;
  readonly repository: string;
  readonly fullName: string;
  readonly defaultBranch: string;
};

export async function resolveRunRepository(
  client: SupabaseClient,
  organizationId: string,
  projectId: string,
): Promise<ResolvedRepository> {
  const { data: project, error: projectError } = await client
    .from("projects")
    .select("id,organization_id,github_repository,default_branch,status")
    .eq("id", projectId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (projectError) throw projectError;
  if (!project || !project.github_repository) {
    throw new WorkerRepositoryError(
      "project_not_found",
      "The project is not linked to a GitHub repository.",
    );
  }

  const { data: projectConnection, error: projectConnectionError } = await client
    .from("project_connections")
    .select("connection_id,is_primary,connections!inner(id,provider,status,organization_id)")
    .eq("project_id", projectId)
    .eq("organization_id", organizationId)
    .eq("is_primary", true)
    .maybeSingle();
  if (projectConnectionError) throw projectConnectionError;

  const connection = Array.isArray(projectConnection?.connections)
    ? projectConnection?.connections[0]
    : projectConnection?.connections;
  if (
    !projectConnection
    || !connection
    || connection.provider !== "github"
    || connection.status !== "connected"
    || connection.organization_id !== organizationId
  ) {
    throw new WorkerRepositoryError(
      "connection_missing",
      "The project has no live GitHub connection.",
    );
  }

  const { data: installation, error: installationError } = await client
    .from("github_installations")
    .select("id,external_installation_id,status,suspended_at,organization_id")
    .eq("connection_id", projectConnection.connection_id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (installationError) throw installationError;
  if (!installation || installation.status !== "active" || installation.suspended_at) {
    throw new WorkerRepositoryError(
      "installation_unavailable",
      "The GitHub App installation is suspended or inactive.",
    );
  }

  const normalizedFullName = project.github_repository.toLowerCase();
  const { data: repositories, error: repositoryError } = await client
    .from("github_repositories")
    .select("external_repository_id,full_name,default_branch,selected,archived,disabled,organization_id")
    .eq("installation_id", installation.id)
    .eq("organization_id", organizationId);
  if (repositoryError) throw repositoryError;

  const matches = (repositories ?? []).filter(
    (candidate) => candidate.full_name.toLowerCase() === normalizedFullName,
  );
  const repository = matches.length === 1 ? matches[0] : undefined;
  if (!repository || !repository.selected || repository.archived || repository.disabled) {
    throw new WorkerRepositoryError(
      "repository_unavailable",
      "The repository is not selected for this installation, or is archived or disabled.",
    );
  }

  const [owner, name] = repository.full_name.split("/");
  return {
    connectionId: projectConnection.connection_id,
    externalInstallationId: installation.external_installation_id,
    externalRepositoryId: repository.external_repository_id,
    owner,
    repository: name,
    fullName: repository.full_name,
    // The synchronized provider default branch is authoritative, not the
    // project's stored hint.
    defaultBranch: repository.default_branch,
  };
}

export async function createRunInstallationToken(
  resolved: ResolvedRepository,
  permissions: Record<string, "read" | "write">,
) {
  const token = await createGitHubInstallationToken(
    getGitHubAppConfiguration(),
    resolved.externalInstallationId,
    { permissions, repositoryIds: [resolved.externalRepositoryId] },
  );
  return token.token;
}

export async function readBaseSha(token: string, resolved: ResolvedRepository) {
  const reference = await getGitHubBranchReference(
    token,
    resolved.owner,
    resolved.repository,
    resolved.defaultBranch,
  );
  return reference.object.sha;
}

/**
 * Repository memory paths, most valuable first. Only files that exist are
 * retrieved; the whole repository is never sent to a provider.
 */
export const MEMORY_PATHS = [
  "AGENTS.md",
  "CLAUDE.md",
  "AI/PROJECT_CONTEXT.md",
  "AI/CURRENT_STATE.md",
  "AI/ARCHITECTURE.md",
  "AI/BACKLOG.md",
  "policies/RISK_CLASSIFICATION.md",
  "policies/PROTECTED_RESOURCES.md",
  "README.md",
] as const;

const MAX_MEMORY_FILES = 6;
const MAX_TASK_FILES = 12;

async function readFileSafely(
  token: string,
  resolved: ResolvedRepository,
  ref: string,
  path: string,
): Promise<RepositoryContextFile | null> {
  try {
    const file = await getGitHubFile(token, resolved.owner, resolved.repository, ref, path);
    return {
      path,
      content: file.content,
      sha: file.sha,
      truncated: false,
    };
  } catch {
    // A missing or binary file is not an error; it simply carries no context.
    return null;
  }
}

export async function loadRepositoryMemory(
  token: string,
  resolved: ResolvedRepository,
  ref: string,
): Promise<RepositoryContextFile[]> {
  const files: RepositoryContextFile[] = [];
  for (const path of MEMORY_PATHS) {
    if (files.length >= MAX_MEMORY_FILES) break;
    const file = await readFileSafely(token, resolved, ref, path);
    if (file) files.push(file);
  }
  return files;
}

/** Terms worth searching a repository tree for, derived from the task text. */
export function deriveSearchTerms(text: string): string[] {
  const stopWords = new Set([
    "the", "and", "for", "with", "that", "this", "from", "into", "your", "have",
    "was", "are", "but", "not", "all", "any", "can", "has", "its", "our", "out",
    "fix", "add", "make", "use", "run", "get", "set", "new", "old", "one", "two",
  ]);

  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 4 && !stopWords.has(word)),
    ),
  ].slice(0, 8);
}

/**
 * Selects the files most likely to matter for a task by matching derived search
 * terms against repository tree paths. This keeps prompts bounded and relevant.
 */
export async function loadTaskFiles(
  token: string,
  resolved: ResolvedRepository,
  commitSha: string,
  searchTerms: readonly string[],
): Promise<RepositoryContextFile[]> {
  if (searchTerms.length === 0) return [];

  let tree: Awaited<ReturnType<typeof listGitHubRecursiveTree>>;
  try {
    tree = await listGitHubRecursiveTree(token, resolved.owner, resolved.repository, commitSha);
  } catch {
    return [];
  }

  const sourceExtensions = /\.(tsx?|jsx?|mjs|cjs|css|scss|sql|json|ya?ml|md)$/i;
  const scored = tree.entries
    .filter((entry) => sourceExtensions.test(entry.path))
    .map((entry) => {
      const lowerPath = entry.path.toLowerCase();
      const score = searchTerms.reduce(
        (total, term) => (lowerPath.includes(term) ? total + 1 : total),
        0,
      );
      return { path: entry.path, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, MAX_TASK_FILES);

  const files: RepositoryContextFile[] = [];
  for (const candidate of scored) {
    const file = await readFileSafely(token, resolved, commitSha, candidate.path);
    if (file) files.push(file);
  }
  return files;
}
