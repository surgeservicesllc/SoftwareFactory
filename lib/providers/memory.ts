import "server-only";

import { repositoryFileLoaders } from "@/lib/repository-memory";
import type { ProviderMemoryExcerpt } from "@/lib/providers/types";

/**
 * Repository memory handed to a provider run.
 *
 * Only the standing-instruction files are included, and each one is truncated
 * so a large document cannot silently inflate a prompt. This is the mechanism
 * that gives a worker the project's own rules without dumping the repository
 * into the request.
 */

/** Files whose content is standing instruction rather than reference material. */
const MEMORY_FILES = Object.freeze([
  "AGENTS.md",
  "AI/PROJECT_CONTEXT.md",
  "AI/ARCHITECTURE.md",
  "policies/RISK_CLASSIFICATION.md",
  "policies/PROTECTED_RESOURCES.md",
] as const);

export const MAX_EXCERPT_CHARACTERS = 6_000;

function truncate(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= MAX_EXCERPT_CHARACTERS) return trimmed;
  return `${trimmed.slice(0, MAX_EXCERPT_CHARACTERS)}\n\n[Excerpt truncated at ${MAX_EXCERPT_CHARACTERS} characters.]`;
}

/**
 * Read the standing-instruction excerpts. A file that cannot be read is
 * omitted rather than replaced with a placeholder, so a worker never treats
 * an absent policy as an empty one.
 */
export async function readRepositoryMemoryExcerpts(): Promise<readonly ProviderMemoryExcerpt[]> {
  const excerpts = await Promise.all(
    MEMORY_FILES.map(async (path): Promise<ProviderMemoryExcerpt | null> => {
      try {
        return Object.freeze({
          path: path as string,
          excerpt: truncate(await repositoryFileLoaders[path]()),
        });
      } catch {
        return null;
      }
    }),
  );

  return Object.freeze(
    excerpts.filter((excerpt): excerpt is ProviderMemoryExcerpt => excerpt !== null),
  );
}
