import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { isProtectedGitHubWritePath } from "@/lib/github/write-policy";
import { hasLikelySecret } from "@/lib/worker/redact";
import type { WorkerJob } from "@/lib/worker/types";
import type { PreparedWorkspace } from "@/lib/worker/workspace";

const forbiddenPathPatterns = [
  /(^|\/)\.git(?:\/|$)/i,
  /(^|\/)(?:id_rsa|id_ed25519|credentials)(?:\.|$)/i,
  /\.(?:pem|p12|pfx|key)$/i,
] as const;

export type PolicyScan = Readonly<{
  changedFiles: readonly string[];
  protectedFiles: readonly string[];
}>;

export class PolicyScanError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PolicyScanError";
    this.code = code;
  }
}

function normalizedRepositoryPath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new PolicyScanError("invalid_changed_path", "A changed path escapes the repository boundary.");
  }
  return normalized;
}

export async function scanChangedFiles(
  job: WorkerJob,
  workspace: PreparedWorkspace,
  changedFiles: readonly string[],
  now = new Date(),
): Promise<PolicyScan> {
  const normalized = [...new Set(changedFiles.map(normalizedRepositoryPath))].sort();
  if (normalized.length === 0) {
    throw new PolicyScanError("no_changes", "Codex did not produce a repository change.");
  }
  if (normalized.length > 200) {
    throw new PolicyScanError("change_too_large", "The run changed more than 200 files.");
  }

  const forbidden = normalized.find((file) => forbiddenPathPatterns.some((pattern) => pattern.test(file)));
  if (forbidden) {
    throw new PolicyScanError("forbidden_path", `The run touched forbidden path ${forbidden}.`);
  }

  const protectedFiles = normalized.filter(isProtectedGitHubWritePath);
  const approvalValid = job.ownerApproval !== null
    && Date.parse(job.ownerApproval.expiresAt) > now.getTime();
  if ((job.risk === "red" || protectedFiles.length > 0) && !approvalValid) {
    throw new PolicyScanError(
      "owner_approval_required",
      "RED or protected-resource changes require a current exact owner approval.",
    );
  }
  const approvedPaths = new Set(job.ownerApproval?.approvedPaths.map(normalizedRepositoryPath) ?? []);
  const unapprovedProtectedFile = protectedFiles.find((file) => !approvedPaths.has(file));
  if (unapprovedProtectedFile) {
    throw new PolicyScanError(
      "protected_path_not_approved",
      `Protected path ${unapprovedProtectedFile} is not named in the current owner approval.`,
    );
  }

  let totalBytes = 0;
  for (const file of normalized) {
    const absolutePath = path.resolve(workspace.directory, file);
    const relative = path.relative(workspace.directory, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new PolicyScanError("invalid_changed_path", "A changed path escapes the repository boundary.");
    }
    let metadata;
    try {
      metadata = await lstat(absolutePath);
    } catch {
      continue; // deleted paths contain no new secret material
    }
    if (metadata.isSymbolicLink()) {
      throw new PolicyScanError("symbolic_link_blocked", `Changed symbolic link ${file} is not publishable.`);
    }
    if (!metadata.isFile()) continue;
    totalBytes += metadata.size;
    if (metadata.size > 2 * 1024 * 1024 || totalBytes > 10 * 1024 * 1024) {
      throw new PolicyScanError("change_too_large", "Changed files exceed the worker review size limit.");
    }
    const content = await readFile(absolutePath);
    let text: string;
    try {
      if (content.includes(0)) throw new TypeError("NUL byte");
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw new PolicyScanError(
        "binary_file_blocked",
        `Binary changed file ${file} cannot pass automated review.`,
      );
    }
    if (hasLikelySecret(text)) {
      throw new PolicyScanError("likely_secret_detected", `Likely secret material was detected in ${file}.`);
    }
  }

  return Object.freeze({
    changedFiles: Object.freeze(normalized),
    protectedFiles: Object.freeze(protectedFiles),
  });
}
