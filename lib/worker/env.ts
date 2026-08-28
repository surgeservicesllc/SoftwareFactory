import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { resolveCodexAuth, type CodexAuthResolution } from "@/lib/worker/auth";

const positiveInteger = (fallback: number, minimum: number, maximum: number) => z.coerce
  .number()
  .int()
  .min(minimum)
  .max(maximum)
  .default(fallback);

const workerEnvironmentSchema = z.object({
  SOFTWAREFACTORY_WORKER_ENABLED: z.enum(["true", "false"]).default("false"),
  SOFTWAREFACTORY_WORKER_RUNTIME: z.literal("docker"),
  SOFTWAREFACTORY_WORKER_ID: z.string().trim().min(3).max(120),
  SOFTWAREFACTORY_CODEX_MODEL: z.string().trim().min(1).max(120),
  // Twenty 160-character names plus nineteen pipe delimiters. Individual
  // names are checked below; this bound prevents the transport from silently
  // narrowing the repository policy domain.
  SOFTWAREFACTORY_REQUIRED_CHECKS: z.string().trim().min(1).max(3_219),
  SOFTWAREFACTORY_WORK_ROOT: z.string().trim().min(1).default(
    path.join(tmpdir(), "softwarefactory-worker-runs"),
  ),
  SOFTWAREFACTORY_WORKER_POLL_MS: positiveInteger(5_000, 500, 60_000),
  SOFTWAREFACTORY_WORKER_HEARTBEAT_MS: positiveInteger(10_000, 1_000, 60_000),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().startsWith("https://"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  // Deliberately absent: OPENAI_API_KEY. Codex authentication is resolved by
  // `resolveCodexAuth`, which defaults to the owner's ChatGPT subscription and
  // treats per-token API billing as an explicit opt-in. Requiring a paid key
  // here is what made a funded API balance a precondition for every run.
  GITHUB_COMMIT_IDENTITY_NAME: z.string().trim().min(1).max(100),
  GITHUB_COMMIT_IDENTITY_EMAIL: z.string().email().max(254),
}).passthrough();

export type WorkerConfiguration = Readonly<{
  enabled: boolean;
  runtime: "docker";
  workerId: string;
  workRoot: string;
  pollMs: number;
  heartbeatMs: number;
  model: string;
  requiredChecks: readonly string[];
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  codexAuth: CodexAuthResolution;
  commitIdentity: { name: string; email: string };
}>;

export class WorkerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerConfigurationError";
  }
}

function assertSafeWorkRoot(value: string) {
  const resolved = path.resolve(value);
  const root = path.parse(resolved).root;
  const home = path.resolve(homedir());
  if (resolved === root || resolved === home || resolved === path.resolve(process.cwd())) {
    throw new WorkerConfigurationError(
      "SOFTWAREFACTORY_WORK_ROOT must be a dedicated child directory, not a filesystem, home, or repository root.",
    );
  }
  return resolved;
}

export function readWorkerConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): WorkerConfiguration {
  const parsed = workerEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).filter(Boolean);
    throw new WorkerConfigurationError(
      `Worker configuration is incomplete or invalid: ${[...new Set(fields)].join(", ")}.`,
    );
  }

  if (!parsed.data.SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_secret_")) {
    const segments = parsed.data.SUPABASE_SERVICE_ROLE_KEY.split(".");
    let role: unknown = null;
    if (segments.length === 3) {
      try {
        role = JSON.parse(Buffer.from(segments[1]!, "base64url").toString("utf8"))?.role;
      } catch {
        role = null;
      }
    }
    if (role !== "service_role") {
      throw new WorkerConfigurationError(
        "SUPABASE_SERVICE_ROLE_KEY must be a server-only service-role credential.",
      );
    }
  }

  const requiredChecks = [...new Set(parsed.data.SOFTWAREFACTORY_REQUIRED_CHECKS
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean))];
  if (requiredChecks.length === 0 || requiredChecks.length > 20
    || requiredChecks.some((value) => value.length > 160)) {
    throw new WorkerConfigurationError(
      "SOFTWAREFACTORY_REQUIRED_CHECKS must name 1-20 pipe-delimited GitHub check runs.",
    );
  }

  return Object.freeze({
    enabled: parsed.data.SOFTWAREFACTORY_WORKER_ENABLED === "true",
    runtime: parsed.data.SOFTWAREFACTORY_WORKER_RUNTIME,
    workerId: parsed.data.SOFTWAREFACTORY_WORKER_ID,
    workRoot: assertSafeWorkRoot(parsed.data.SOFTWAREFACTORY_WORK_ROOT),
    pollMs: parsed.data.SOFTWAREFACTORY_WORKER_POLL_MS,
    heartbeatMs: parsed.data.SOFTWAREFACTORY_WORKER_HEARTBEAT_MS,
    model: parsed.data.SOFTWAREFACTORY_CODEX_MODEL,
    requiredChecks: Object.freeze(requiredChecks),
    supabaseUrl: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    // Throws a named CodexAuthError rather than resolving to a billed default.
    codexAuth: resolveCodexAuth(environment),
    commitIdentity: Object.freeze({
      name: parsed.data.GITHUB_COMMIT_IDENTITY_NAME,
      email: parsed.data.GITHUB_COMMIT_IDENTITY_EMAIL,
    }),
  });
}

const allowedProcessEnvironment = [
  "PATH",
  "Path",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "LANG",
  "LC_ALL",
  "TERM",
  "CI",
] as const;

/**
 * Returns a deliberately narrow environment for Git, package managers, and
 * Codex. Application/provider credentials are excluded and added only to the
 * single child process that needs them.
 */
export function controlledProcessEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const controlled: Record<string, string> = {};
  for (const name of allowedProcessEnvironment) {
    const value = environment[name];
    if (value !== undefined) controlled[name] = value;
  }
  controlled.CI = "true";
  controlled.GIT_TERMINAL_PROMPT = "0";
  controlled.NEXT_TELEMETRY_DISABLED = "1";
  controlled.NO_COLOR = "1";
  return controlled;
}
