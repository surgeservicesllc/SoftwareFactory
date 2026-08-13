import "server-only";

import { containsLikelySecret } from "@/lib/server/sensitive-data";

/**
 * Diff-level secret scanning.
 *
 * `containsLikelySecret` covers well-known credential shapes in control-plane
 * payloads. Proposed source files need more: an assignment to a secret-named
 * variable with a long literal value is a leak even when the value matches no
 * known vendor prefix. A run that trips any of these never reaches a commit.
 */

export type SecretFinding = {
  readonly path: string;
  readonly line: number;
  readonly reason:
    | "known_credential_pattern"
    | "secret_assignment"
    | "private_key_block"
    | "env_assignment";
  readonly detail: string;
};

const SECRET_NAME = /(secret|password|passwd|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|service[_-]?role|webhook[_-]?secret|signing[_-]?secret|credential)/i;

/** `NAME = "value"` in code, `NAME=value` in env-style files. */
const CODE_ASSIGNMENT = /([A-Za-z_$][A-Za-z0-9_$.-]*)\s*[:=]\s*(['"`])([^'"`\n]{12,})\2/;
const ENV_ASSIGNMENT = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=\s*(.+)\s*$/;
const PRIVATE_KEY_BLOCK = /-----BEGIN\s+[A-Z ]*PRIVATE KEY-----/;

/** Placeholders keep templates and docs from being reported as leaks. */
const PLACEHOLDER = /^(|x{3,}|\*{3,}|\.{3,}|<[^>]*>|\$\{[^}]*\}|process\.env\..*|your[-_ ].*|replace[-_ ].*|example.*|placeholder.*|changeme.*|todo.*|dummy.*|test[-_]?(value|key|token|secret)?|fake.*|redacted.*|null|undefined|true|false)$/i;

function isPlaceholder(value: string) {
  const trimmed = value.trim().replace(/^['"`]|['"`]$/g, "");
  return trimmed.length === 0 || PLACEHOLDER.test(trimmed);
}

function isEnvStylePath(path: string) {
  const fileName = path.split("/").at(-1) ?? "";
  return fileName.startsWith(".env") || fileName.endsWith(".envrc");
}

/**
 * Longest slice of a single line handed to a regex, with an overlap wide enough
 * that a credential straddling a boundary is still matched. Minified bundles
 * and single-line JSON produce lines long enough that unbounded backtracking
 * would stall the worker, so the input is bounded rather than the patterns
 * loosened.
 */
const MAX_SCAN_CHUNK = 4_096;
const CHUNK_OVERLAP = 512;

function* scanSegments(line: string): Generator<string> {
  if (line.length <= MAX_SCAN_CHUNK) {
    yield line;
    return;
  }
  for (let start = 0; start < line.length; start += MAX_SCAN_CHUNK - CHUNK_OVERLAP) {
    yield line.slice(start, start + MAX_SCAN_CHUNK);
  }
}

/** True when any segment of a long line matches, without unbounded backtracking. */
function matchesLine(line: string, test: (segment: string) => boolean): boolean {
  for (const segment of scanSegments(line)) {
    if (test(segment)) return true;
  }
  return false;
}

function execLine(line: string, pattern: RegExp): RegExpExecArray | null {
  for (const segment of scanSegments(line)) {
    const match = pattern.exec(segment);
    if (match) return match;
  }
  return null;
}

export function scanContentForSecrets(path: string, content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (matchesLine(line, (segment) => PRIVATE_KEY_BLOCK.test(segment))) {
      findings.push({
        path,
        line: lineNumber,
        reason: "private_key_block",
        detail: "A private key block was found in the proposed content.",
      });
      continue;
    }

    if (matchesLine(line, containsLikelySecret)) {
      findings.push({
        path,
        line: lineNumber,
        reason: "known_credential_pattern",
        detail: "The line matches a known credential format.",
      });
      continue;
    }

    if (isEnvStylePath(path)) {
      const envMatch = execLine(line, ENV_ASSIGNMENT);
      if (envMatch && SECRET_NAME.test(envMatch[1]) && !isPlaceholder(envMatch[2])) {
        findings.push({
          path,
          line: lineNumber,
          reason: "env_assignment",
          detail: `${envMatch[1]} is assigned a concrete value in an environment file.`,
        });
      }
      continue;
    }

    const codeMatch = execLine(line, CODE_ASSIGNMENT);
    if (codeMatch && SECRET_NAME.test(codeMatch[1]) && !isPlaceholder(codeMatch[3])) {
      findings.push({
        path,
        line: lineNumber,
        reason: "secret_assignment",
        detail: `${codeMatch[1]} is assigned a literal value that looks like a credential.`,
      });
    }
  }

  return findings;
}

export function scanProposedFiles(
  files: ReadonlyArray<{ path: string; content: string }>,
): SecretFinding[] {
  return files.flatMap((file) => scanContentForSecrets(file.path, file.content));
}
