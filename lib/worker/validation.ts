import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { controlledProcessEnvironment } from "@/lib/worker/env";
import { runProcess, type ProcessResult } from "@/lib/worker/process";
import { redactText } from "@/lib/worker/redact";
import type { ValidationResult } from "@/lib/worker/types";
import type { PreparedWorkspace } from "@/lib/worker/workspace";

export const PINNED_VALIDATION_IMAGE = "node:22.22.0-bookworm@sha256:20a424ecd1d2064a44e12fe287bf3dae443aab31dc5e0c0cb6c74bef9c78911c";

const validationScripts = ["lint", "typecheck", "test", "build"] as const;
type PackageManifest = { scripts?: Record<string, string> };
type Runner = typeof runProcess;

async function readManifest(directory: string): Promise<PackageManifest> {
  try {
    return JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")) as PackageManifest;
  } catch {
    return {};
  }
}

function renderedCommand(command: string, args: readonly string[]) {
  return [command, ...args].join(" ");
}

function hostUserArguments() {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") return [];
  return ["--user", `${process.getuid()}:${process.getgid()}`];
}

export function dockerContainerArguments(input: {
  workspace: PreparedWorkspace;
  network: "bridge" | "none";
  command: string;
  args: readonly string[];
  image?: string;
}) {
  return [
    "run",
    "--rm",
    "--pull=never",
    "--init",
    "--network",
    input.network,
    "--pids-limit",
    "512",
    "--memory",
    "4g",
    "--cpus",
    "2",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=512m",
    ...hostUserArguments(),
    "--mount",
    `type=bind,source=${path.resolve(input.workspace.directory)},target=/workspace`,
    "--workdir",
    "/workspace",
    "--env",
    "CI=true",
    "--env",
    "HOME=/tmp",
    "--env",
    "npm_config_cache=/tmp/npm-cache",
    "--env",
    "NEXT_TELEMETRY_DISABLED=1",
    input.image ?? PINNED_VALIDATION_IMAGE,
    input.command,
    ...input.args,
  ];
}

export class DeterministicValidator {
  constructor(
    private readonly runner: Runner = runProcess,
    private readonly image = PINNED_VALIDATION_IMAGE,
  ) {}

  async assertAvailable(workRoot: string) {
    await mkdir(workRoot, { recursive: true });
    const result = await this.runner({
      command: "docker",
      args: ["image", "inspect", "--format={{.Id}}", this.image],
      cwd: workRoot,
      env: controlledProcessEnvironment(),
      timeoutMs: 30_000,
      maximumOutputBytes: 8 * 1024,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        "The pinned Docker validation image is unavailable. Preload the exact configured digest before enabling the worker.",
      );
    }
  }

  private async containerProcess(input: {
    workspace: PreparedWorkspace;
    network: "bridge" | "none";
    command: string;
    args: readonly string[];
    signal?: AbortSignal;
    timeoutMs: number;
  }): Promise<ProcessResult> {
    return await this.runner({
      command: "docker",
      args: dockerContainerArguments({ ...input, image: this.image }),
      cwd: input.workspace.runDirectory,
      env: controlledProcessEnvironment(),
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      maximumOutputBytes: 128 * 1024,
    });
  }

  async bootstrap(workspace: PreparedWorkspace, signal?: AbortSignal): Promise<ValidationResult> {
    try {
      await readFile(path.join(workspace.directory, "package-lock.json"), "utf8");
    } catch {
      return Object.freeze({
        name: "dependency-install",
        command: "not-run",
        status: "skipped",
        durationMs: 0,
        output: "No package-lock.json was found; dependency installation was not inferred.",
      });
    }

    const args = ["ci", "--ignore-scripts", "--no-audit", "--no-fund"];
    const result = await this.containerProcess({
      workspace,
      network: "bridge",
      command: "npm",
      args,
      signal,
      timeoutMs: 10 * 60_000,
    });
    return Object.freeze({
      name: "dependency-install",
      command: renderedCommand("npm", args),
      status: result.exitCode === 0 ? "passed" : "failed",
      durationMs: result.durationMs,
      output: redactText(result.exitCode === 0 ? result.stdout : `${result.stdout}\n${result.stderr}`),
    });
  }

  async run(workspace: PreparedWorkspace, signal?: AbortSignal): Promise<readonly ValidationResult[]> {
    const manifest = await readManifest(workspace.directory);
    const trustedDiff = await this.runner({
      command: "git",
      args: [
        `--git-dir=${workspace.gitDirectory}`,
        `--work-tree=${workspace.directory}`,
        "-c",
        `core.hooksPath=${workspace.hooksDirectory}`,
        "-c",
        "core.fsmonitor=false",
        "diff",
        "--check",
      ],
      cwd: workspace.directory,
      env: {
        ...controlledProcessEnvironment(),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: path.join(workspace.runDirectory, "empty-gitconfig"),
      },
      signal,
      timeoutMs: 60_000,
      maximumOutputBytes: 128 * 1024,
    });
    const results: ValidationResult[] = [Object.freeze({
      name: "diff-check",
      command: "git diff --check",
      status: trustedDiff.exitCode === 0 ? "passed" : "failed",
      durationMs: trustedDiff.durationMs,
      output: redactText(trustedDiff.exitCode === 0
        ? trustedDiff.stdout
        : `${trustedDiff.stdout}\n${trustedDiff.stderr}`),
    })];
    if (trustedDiff.exitCode !== 0) return Object.freeze(results);
    const commands: Array<{ name: string; command: string; args: readonly string[]; timeoutMs: number }> = [
      ...validationScripts.filter((script) => manifest.scripts?.[script]).map((script) => ({
        name: script,
        command: "npm",
        args: ["run", script] as const,
        timeoutMs: script === "build" ? 15 * 60_000 : 10 * 60_000,
      })),
    ];

    for (const command of commands) {
      const result = await this.containerProcess({
        workspace,
        network: "none",
        command: command.command,
        args: command.args,
        signal,
        timeoutMs: command.timeoutMs,
      });
      results.push(Object.freeze({
        name: command.name,
        command: renderedCommand(command.command, command.args),
        status: result.exitCode === 0 ? "passed" : "failed",
        durationMs: result.durationMs,
        output: redactText(result.exitCode === 0 ? result.stdout : `${result.stdout}\n${result.stderr}`),
      }));
      if (result.exitCode !== 0) return Object.freeze(results);
    }

    for (const script of validationScripts) {
      if (!manifest.scripts?.[script]) {
        results.push(Object.freeze({
          name: script,
          command: `npm run ${script}`,
          status: "skipped",
          durationMs: 0,
          output: `package.json does not define ${script}.`,
        }));
      }
    }
    return Object.freeze(results);
  }
}

export function validationPassed(results: readonly ValidationResult[]) {
  const required = new Set(validationScripts);
  return results.every((result) => result.status !== "failed")
    && results.some((result) => result.name === "diff-check" && result.status === "passed")
    && results.filter((result) => required.has(result.name as typeof validationScripts[number]))
      .every((result) => result.status === "passed" || result.status === "skipped");
}

export function validationFailureSummary(results: readonly ValidationResult[]) {
  return results.filter((result) => result.status === "failed")
    .map((result) => `${result.name}: ${redactText(result.output, { maximumLength: 2_000 })}`)
    .join("\n\n");
}
