import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

import { redactText } from "@/lib/worker/redact";

export type ProcessResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}>;

export class ProcessExecutionError extends Error {
  readonly code: "aborted" | "spawn_failed" | "timed_out";

  constructor(code: ProcessExecutionError["code"], message: string) {
    super(message);
    this.name = "ProcessExecutionError";
    this.code = code;
  }
}

export async function runProcess(input: {
  command: string;
  args?: readonly string[];
  cwd: string;
  env: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs: number;
  maximumOutputBytes?: number;
  redactedSecrets?: readonly string[];
}): Promise<ProcessResult> {
  if (input.signal?.aborted) {
    throw new ProcessExecutionError("aborted", "Process execution was cancelled.");
  }
  const startedAt = Date.now();
  const outputLimit = input.maximumOutputBytes ?? 128 * 1024;

  return await new Promise<ProcessResult>((resolve, reject) => {
    let stdout: Uint8Array = new Uint8Array();
    let stderr: Uint8Array = new Uint8Array();
    let settled = false;
    let timedOut = false;
    let forceTimer: ReturnType<typeof setTimeout> | null = null;
    let terminationTimer: ReturnType<typeof setTimeout> | null = null;

    const child = spawn(input.command, [...(input.args ?? [])], {
      cwd: input.cwd,
      env: input.env as NodeJS.ProcessEnv,
      shell: false,
      windowsHide: true,
      // Production workers run on Linux. A dedicated process group lets a
      // timeout stop descendants as well as the immediate npm/docker client.
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    }) as ChildProcessByStdio<null, Readable, Readable>;

    const append = (existing: Uint8Array, chunk: Uint8Array) => {
      if (existing.byteLength >= outputLimit) return existing;
      const remaining = outputLimit - existing.byteLength;
      const bounded = chunk.subarray(0, remaining);
      const combined = new Uint8Array(existing.byteLength + bounded.byteLength);
      combined.set(existing);
      combined.set(bounded, existing.byteLength);
      return combined;
    };

    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });

    const signalProcessTree = (signal: NodeJS.Signals) => {
      if (child.exitCode !== null) return;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // The process may have exited between the state check and the signal.
      }
    };
    const stop = () => {
      signalProcessTree("SIGTERM");
      forceTimer ??= setTimeout(() => {
        signalProcessTree("SIGKILL");
        terminationTimer ??= setTimeout(() => finish(() => reject(
          new ProcessExecutionError(
            input.signal?.aborted ? "aborted" : "timed_out",
            input.signal?.aborted
              ? "Process execution was cancelled."
              : "Process execution exceeded its time limit.",
          ),
        )), 2_000);
      }, 2_000);
    };
    const onAbort = () => stop();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, input.timeoutMs);

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (terminationTimer) clearTimeout(terminationTimer);
      input.signal?.removeEventListener("abort", onAbort);
      callback();
    };

    child.once("error", (error: Error) => finish(() => reject(
      new ProcessExecutionError("spawn_failed", redactText(error.message)),
    )));
    child.once("close", (exitCode: number | null) => finish(() => {
      if (input.signal?.aborted) {
        reject(new ProcessExecutionError("aborted", "Process execution was cancelled."));
        return;
      }
      if (timedOut) {
        reject(new ProcessExecutionError("timed_out", "Process execution exceeded its time limit."));
        return;
      }
      resolve(Object.freeze({
        exitCode: exitCode ?? 1,
        stdout: redactText(Buffer.from(stdout).toString("utf8"), {
          maximumLength: outputLimit,
          secrets: input.redactedSecrets,
        }),
        stderr: redactText(Buffer.from(stderr).toString("utf8"), {
          maximumLength: outputLimit,
          secrets: input.redactedSecrets,
        }),
        durationMs: Date.now() - startedAt,
      }));
    }));
  });
}
