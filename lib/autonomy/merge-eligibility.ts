/**
 * The `AUTO_MERGE_POLICY.md` conditions that nothing implemented.
 *
 * `merge-readiness.ts` answers "is this still the commit that was approved, and
 * can it merge right now". It does not answer the policy's other half: whether
 * this repository and branch were ever allowlisted for automatic merging, and
 * whether the change is small and legible enough that an automatic decision is
 * defensible. The policy listed those conditions and then said, in its own
 * words, that repository/branch allowlisting, size and scope limits,
 * generated/binary content detection and unresolved-review-thread detection
 * were "still unimplemented". This is that list.
 *
 * The bias throughout is that absence blocks. An unconfigured allowlist does not
 * mean "everything is allowed"; it means no merge target has been authorized, so
 * nothing is eligible. That is the only reading under which forgetting to
 * configure something fails safe.
 */

export type EligibilityBlocker =
  | "REPOSITORY_NOT_ALLOWLISTED"
  | "BASE_BRANCH_NOT_ALLOWLISTED"
  | "HEAD_BRANCH_NOT_PERMITTED"
  | "CHANGE_TOO_LARGE"
  | "TOO_MANY_FILES"
  | "PATH_OUT_OF_SCOPE"
  | "GENERATED_CONTENT"
  | "BINARY_CONTENT"
  | "UNRESOLVED_REVIEW_THREAD"
  | "ALLOWLIST_NOT_CONFIGURED";

/**
 * The owner-authorized merge target. `AUTO_MERGE_POLICY.md` step 5 requires
 * explicit owner approval for "the precise allowlist and limits", so this is
 * deliberately not defaultable — a caller must supply one.
 */
export interface MergeAllowlist {
  /** `owner/repo`, matched exactly and case-insensitively. */
  readonly repositories: readonly string[];
  /** Base branches a merge may target, e.g. `main`. */
  readonly baseBranches: readonly string[];
  /**
   * Head branches must start with one of these. The factory produces
   * `factory/*`, and restricting to it stops an approved decision being
   * redirected at an arbitrary branch someone else pushed.
   */
  readonly headBranchPrefixes: readonly string[];
  /** Paths the change must stay within. Empty means no path is in scope. */
  readonly allowedPathPrefixes: readonly string[];
  readonly maxChangedFiles: number;
  readonly maxChangedLines: number;
}

export interface ChangedFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  /** GitHub reports no patch for binary files; that absence is the signal. */
  readonly binary?: boolean;
}

export interface EligibilityRequest {
  readonly repositoryFullName: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly files: readonly ChangedFile[];
  /** Review threads left unresolved on the pull request. */
  readonly unresolvedReviewThreads?: number;
  readonly allowlist: MergeAllowlist | null;
}

export interface EligibilityResult {
  readonly eligible: boolean;
  readonly blockers: readonly EligibilityBlocker[];
  readonly reason: string;
  /** Recorded on the decision: the policy required these in the audit trail. */
  readonly repositoryFullName: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly changedFiles: number;
  readonly changedLines: number;
}

const REASONS: Readonly<Record<EligibilityBlocker, string>> = Object.freeze({
  REPOSITORY_NOT_ALLOWLISTED: "This repository is not on the auto-merge allowlist.",
  BASE_BRANCH_NOT_ALLOWLISTED: "This base branch is not on the auto-merge allowlist.",
  HEAD_BRANCH_NOT_PERMITTED: "The head branch is not one the factory is permitted to merge.",
  CHANGE_TOO_LARGE: "The change exceeds the approved line limit.",
  TOO_MANY_FILES: "The change exceeds the approved file limit.",
  PATH_OUT_OF_SCOPE: "The change touches a path outside the approved scope.",
  GENERATED_CONTENT: "The change contains generated content, which cannot be meaningfully reviewed.",
  BINARY_CONTENT: "The change contains binary content, which cannot be meaningfully reviewed.",
  UNRESOLVED_REVIEW_THREAD: "An unresolved review thread is open on this pull request.",
  ALLOWLIST_NOT_CONFIGURED: "No auto-merge allowlist is configured, so no merge target is authorized.",
});

/**
 * Extensions and directories whose contents are produced by a tool.
 *
 * The point is not that generated files are dangerous in themselves. It is that
 * an automatic approval claims a change was reviewed, and nobody reviews a
 * bundle or a lockfile diff — so a change containing one has not actually met
 * the bar the approval asserts.
 */
const GENERATED_DIRECTORIES = new Set([
  "dist", "build", "out", "coverage", ".next", "node_modules", "vendor", "__generated__",
]);

const GENERATED_FILENAMES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock",
  "bun.lock", "bun.lockb", "composer.lock", "gemfile.lock", "cargo.lock", "poetry.lock",
]);

const GENERATED_SUFFIXES = [
  ".min.js", ".min.css", ".map", ".bundle.js", ".generated.ts", ".generated.js",
  ".pb.go", "_pb2.py", ".d.ts.map",
];

/** Extensions that are binary regardless of what a patch claims. */
const BINARY_SUFFIXES = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp", ".tiff",
  ".pdf", ".zip", ".gz", ".tar", ".bz2", ".xz", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp3", ".mp4", ".mov", ".avi", ".webm", ".wav",
  ".so", ".dylib", ".dll", ".exe", ".bin", ".wasm", ".class", ".jar",
  ".sqlite", ".db", ".pyc",
];

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

export function isGeneratedPath(path: string): boolean {
  const normalized = normalizePath(path);
  const segments = normalized.split("/");
  const fileName = segments.at(-1) ?? "";

  return GENERATED_FILENAMES.has(fileName)
    || segments.some((segment) => GENERATED_DIRECTORIES.has(segment))
    || GENERATED_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

export function isBinaryPath(path: string): boolean {
  const fileName = normalizePath(path).split("/").at(-1) ?? "";
  return BINARY_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

/**
 * True when `path` sits inside `prefix`.
 *
 * The separator matters: a plain `startsWith` makes `docs-internal/secrets.md`
 * look like it is inside `docs`, which is the same prefix bug that shows up in
 * every path-scoping check.
 */
export function isWithinPrefix(path: string, prefix: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedPrefix = normalizePath(prefix).replace(/\/+$/, "");
  if (!normalizedPrefix) return false;
  return normalizedPath === normalizedPrefix
    || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

/**
 * Evaluates the policy conditions `merge-readiness.ts` does not cover.
 *
 * Every branch here fails closed. A missing allowlist, an empty path scope, or
 * a file whose path cannot be placed inside any approved prefix all block,
 * because the alternative in each case is an automatic merge that nobody
 * authorized against a surface nobody bounded.
 */
export function evaluateMergeEligibility(request: EligibilityRequest): EligibilityResult {
  const {
    repositoryFullName, baseBranch, headBranch, files,
    unresolvedReviewThreads = 0, allowlist,
  } = request;

  const changedFiles = files.length;
  const changedLines = files.reduce((total, file) => total + file.additions + file.deletions, 0);

  const base: Omit<EligibilityResult, "eligible" | "blockers" | "reason"> = {
    repositoryFullName, baseBranch, headBranch, changedFiles, changedLines,
  };

  if (!allowlist) {
    // Not "allow everything". Nothing has been authorized.
    return Object.freeze({
      ...base,
      eligible: false,
      blockers: Object.freeze<EligibilityBlocker[]>(["ALLOWLIST_NOT_CONFIGURED"]),
      reason: REASONS.ALLOWLIST_NOT_CONFIGURED,
    });
  }

  const blockers: EligibilityBlocker[] = [];
  const lower = (value: string) => value.trim().toLowerCase();

  if (!allowlist.repositories.some((entry) => lower(entry) === lower(repositoryFullName))) {
    blockers.push("REPOSITORY_NOT_ALLOWLISTED");
  }
  if (!allowlist.baseBranches.some((entry) => entry === baseBranch)) {
    blockers.push("BASE_BRANCH_NOT_ALLOWLISTED");
  }
  if (!allowlist.headBranchPrefixes.some((prefix) => headBranch.startsWith(prefix))) {
    blockers.push("HEAD_BRANCH_NOT_PERMITTED");
  }

  if (changedFiles > allowlist.maxChangedFiles) blockers.push("TOO_MANY_FILES");
  if (changedLines > allowlist.maxChangedLines) blockers.push("CHANGE_TOO_LARGE");

  for (const file of files) {
    if (!allowlist.allowedPathPrefixes.some((prefix) => isWithinPrefix(file.path, prefix))) {
      blockers.push("PATH_OUT_OF_SCOPE");
    }
    // `binary: true` is GitHub telling us it produced no patch. The extension
    // check catches the case where that flag is absent but the content still
    // is not reviewable.
    if (file.binary || isBinaryPath(file.path)) blockers.push("BINARY_CONTENT");
    if (isGeneratedPath(file.path)) blockers.push("GENERATED_CONTENT");
  }

  if (unresolvedReviewThreads > 0) blockers.push("UNRESOLVED_REVIEW_THREAD");

  const unique = [...new Set(blockers)];

  return Object.freeze({
    ...base,
    eligible: unique.length === 0,
    blockers: Object.freeze(unique),
    reason: unique.length
      ? unique.map((blocker) => REASONS[blocker]).join(" ")
      : "The change is within the owner-approved allowlist, scope and size limits.",
  });
}

/**
 * Reads the allowlist from configuration.
 *
 * Returns `null` when nothing is configured, which every caller must treat as
 * "no target is authorized". Parsing is strict: a malformed entry produces
 * `null` rather than a partially-applied allowlist, because a half-read
 * allowlist is indistinguishable from a wider one.
 */
export function parseMergeAllowlist(raw: string | undefined | null): MergeAllowlist | null {
  const text = raw?.trim();
  if (!text) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;

  const stringArray = (value: unknown): string[] | null => {
    if (!Array.isArray(value)) return null;
    if (!value.every((entry) => typeof entry === "string" && entry.trim().length > 0)) return null;
    return value.map((entry) => (entry as string).trim());
  };

  const positiveInteger = (value: unknown): number | null => (
    typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null
  );

  const repositories = stringArray(candidate.repositories);
  const baseBranches = stringArray(candidate.baseBranches);
  const headBranchPrefixes = stringArray(candidate.headBranchPrefixes);
  const allowedPathPrefixes = stringArray(candidate.allowedPathPrefixes);
  const maxChangedFiles = positiveInteger(candidate.maxChangedFiles);
  const maxChangedLines = positiveInteger(candidate.maxChangedLines);

  if (
    !repositories?.length || !baseBranches?.length || !headBranchPrefixes?.length
    || !allowedPathPrefixes?.length || !maxChangedFiles || !maxChangedLines
  ) {
    return null;
  }

  return Object.freeze({
    repositories: Object.freeze(repositories),
    baseBranches: Object.freeze(baseBranches),
    headBranchPrefixes: Object.freeze(headBranchPrefixes),
    allowedPathPrefixes: Object.freeze(allowedPathPrefixes),
    maxChangedFiles,
    maxChangedLines,
  });
}
