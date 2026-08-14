/**
 * Filesystem authorization for the AgentOS filesystem MCP.
 *
 * `docs/AGENTOS_SPEC.md` §7 requires that every call be authorized server-side
 * against the calling agent's folder grants, with read, write and delete
 * checked as separate verbs. This module is the decision; the MCP handler is
 * only the plumbing around it.
 *
 * Kept pure and dependency-free so the decision can be exhaustively tested.
 * The subtle failures here are not "forgot to check" — they are prefix
 * matching that treats `/agents/support-evil` as inside `/agents/support`, and
 * normalization that lets `..` or a URL escape climb out of a grant.
 */

export type FilesystemVerb = "list" | "read" | "write" | "mkdir" | "delete";

export type FilesystemGrant = {
  readonly folderPath: string;
  readonly canRead: boolean;
  readonly canWrite: boolean;
  readonly canDelete: boolean;
};

export type FilesystemDecision =
  | { readonly allowed: true; readonly grant: FilesystemGrant; readonly path: string }
  | { readonly allowed: false; readonly reason: FilesystemDenialReason; readonly message: string };

export type FilesystemDenialReason =
  | "invalid_path"
  | "path_escapes_grant"
  | "no_grant_for_path"
  | "verb_not_granted";

/** Which grant flag each verb requires. Listing is a read. */
const VERB_REQUIREMENT: Record<FilesystemVerb, keyof Pick<FilesystemGrant, "canRead" | "canWrite" | "canDelete">> = {
  list: "canRead",
  read: "canRead",
  write: "canWrite",
  mkdir: "canWrite",
  delete: "canDelete",
};

/**
 * Reduces a path to a canonical absolute form, or rejects it.
 *
 * Rejects rather than sanitizes. Silently rewriting a hostile path is how a
 * caller ends up believing it operated on what the agent asked for.
 */
export function normalizeFilesystemPath(input: string): string | null {
  if (typeof input !== "string" || input.length === 0 || input.length > 1024) return null;
  // A NUL byte truncates the path for anything that later hands it to C.
  if (input.includes("\0")) return null;
  // Percent-encoding is not decoded here, so an encoded traversal cannot
  // survive normalization and reappear later. Refuse it outright.
  if (/%2e/i.test(input) || /%2f/i.test(input) || /%5c/i.test(input)) return null;
  // Backslashes are separators on some hosts; treating them as ordinary
  // characters is what lets `..\..` through a POSIX-only check.
  if (input.includes("\\")) return null;
  if (!input.startsWith("/")) return null;

  const segments: string[] = [];
  for (const segment of input.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // Refuse rather than pop. A grant check runs against the normalized
      // path, and popping would let `/a/b/../../etc` resolve somewhere the
      // caller never described.
      return null;
    }
    segments.push(segment);
  }

  return `/${segments.join("/")}`;
}

/**
 * True when `path` is the grant folder itself or lies beneath it.
 *
 * The boundary matters: `/agents/support` must not cover
 * `/agents/support-evil`, which a naive `startsWith` allows.
 */
export function isWithinFolder(path: string, folderPath: string): boolean {
  const normalizedFolder = folderPath.endsWith("/") && folderPath !== "/"
    ? folderPath.slice(0, -1)
    : folderPath;

  if (normalizedFolder === "/") return true;
  if (path === normalizedFolder) return true;
  return path.startsWith(`${normalizedFolder}/`);
}

/**
 * Picks the grant that governs a path.
 *
 * The most specific match wins, so a narrow read-only grant nested inside a
 * broad writable one is not widened by the parent.
 */
export function selectGoverningGrant(
  path: string,
  grants: readonly FilesystemGrant[],
): FilesystemGrant | null {
  let best: FilesystemGrant | null = null;
  for (const grant of grants) {
    const folder = normalizeFilesystemPath(grant.folderPath);
    if (folder === null || !isWithinFolder(path, folder)) continue;
    if (best === null || folder.length > (normalizeFilesystemPath(best.folderPath)?.length ?? -1)) {
      best = grant;
    }
  }
  return best;
}

/**
 * The whole decision: normalize, locate the governing grant, check the verb.
 *
 * Default deny at every step — an unparseable path, an ungranted prefix and a
 * missing verb all refuse.
 */
export function authorizeFilesystemOperation(
  verb: FilesystemVerb,
  requestedPath: string,
  grants: readonly FilesystemGrant[],
): FilesystemDecision {
  const path = normalizeFilesystemPath(requestedPath);
  if (path === null) {
    return {
      allowed: false,
      reason: "invalid_path",
      message: "The path is not a valid absolute path.",
    };
  }

  const grant = selectGoverningGrant(path, grants);
  if (grant === null) {
    return {
      allowed: false,
      reason: grants.length === 0 ? "no_grant_for_path" : "path_escapes_grant",
      message: "The agent has no filesystem grant covering that path.",
    };
  }

  if (!grant[VERB_REQUIREMENT[verb]]) {
    return {
      allowed: false,
      reason: "verb_not_granted",
      message: `The agent may not ${verb} within ${grant.folderPath}.`,
    };
  }

  return { allowed: true, grant, path };
}
