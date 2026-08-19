import {
  CodexBudgetError,
  CodexSdkAdapter,
  type CodexSession,
  type CodexTurnResult,
} from "@/lib/worker/codex";
import { GitHubDraftPublisher, GitHubWorkerError } from "@/lib/worker/github";
import { PolicyScanError, scanChangedFiles } from "@/lib/worker/policy-scan";
import { ProcessExecutionError } from "@/lib/worker/process";
import { safeErrorMessage } from "@/lib/worker/redact";
import type {
  InstallationTokenProvider,
  WorkerEvent,
  WorkerJob,
  WorkerResult,
  WorkerStore,
} from "@/lib/worker/types";
import {
  DeterministicValidator,
  validationFailureSummary,
  validationPassed,
} from "@/lib/worker/validation";
import { GitWorkspaceManager, WorkspaceError, type PreparedWorkspace } from "@/lib/worker/workspace";

export class WorkerCancellationError extends Error {
  constructor(message = "The run was cancelled before completion.") {
    super(message);
    this.name = "WorkerCancellationError";
  }
}

class WorkerDeadlineError extends Error {
  readonly code = "timed_out";

  constructor() {
    super("The run reached its configured maximum execution duration.");
    this.name = "WorkerDeadlineError";
  }
}

export type WorkerDependencies = Readonly<{
  store: WorkerStore;
  tokenProvider: InstallationTokenProvider;
  workspace: Pick<GitWorkspaceManager,
    "prepare" | "currentHead" | "changedFiles" | "commit" | "assertImmutableCommit"
    | "assertRemoteBaseSha" | "push">;
  codex: Pick<CodexSdkAdapter, "createSession" | "initialPrompt" | "prepare">;
  validator: Pick<DeterministicValidator, "bootstrap" | "run">;
  publisher: Pick<GitHubDraftPublisher, "createOrRecoverDraft" | "verifyExistingDraft" | "waitForChecks">;
}>;

type EventWriter = (event: WorkerEvent) => Promise<void>;

async function recordCodexEvidence(result: CodexTurnResult, event: EventWriter) {
  for (const test of result.tests) {
    await event({
      kind: "agent_event",
      message: "Codex reported a focused test observation.",
      details: { category: "test_observation", text: test },
    });
  }
  for (const risk of result.risks) {
    await event({
      kind: "agent_event",
      message: "Codex reported a residual risk finding.",
      details: { category: "security_finding", text: risk },
    });
  }
}

function failureCode(error: unknown) {
  if (error instanceof GitHubWorkerError) return error.code;
  if (error instanceof CodexBudgetError) return error.code;
  if (error instanceof WorkspaceError || error instanceof PolicyScanError) return error.code;
  if (error instanceof ProcessExecutionError) return error.code;
  if (error instanceof WorkerDeadlineError) return error.code;
  if (error instanceof WorkerCancellationError) return "cancelled";
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  return "worker_failed";
}

function retryable(error: unknown) {
  const code = failureCode(error);
  return [
    "github_rate_limited",
    "github_unavailable",
    "github_500",
    "github_502",
    "github_503",
    "github_504",
    "git_push_failed",
    "timed_out",
    "worker_failed",
  ].includes(code);
}

function commitMessage(job: WorkerJob) {
  const title = job.prompt.split(/\r?\n/, 1)[0]?.trim() || "Implement requested change";
  return `Factory: ${title.slice(0, 60)}`;
}

function repairPrompt(failures: string, attempt: number) {
  return [
    `Deterministic validation failed after your change (bounded repair ${attempt}).`,
    "Fix only failures caused by this run. Do not weaken or skip tests, suppress errors, alter safety policy, or expand scope.",
    "Re-run focused checks and review the diff. Finish with a concise structured summary.",
    "Validation evidence:",
    failures,
  ].join("\n\n");
}

function ciRepairPrompt(checks: WorkerResult["checks"], attempt: number) {
  const failed = checks.filter((check) => check.conclusion && !["success", "neutral", "skipped"].includes(check.conclusion));
  return [
    `GitHub CI failed for the exact pushed head (bounded repair ${attempt}).`,
    "Inspect the repository and fix only failures plausibly caused by this run. Do not edit workflows, weaken checks, merge, or deploy.",
    "Failed check evidence:",
    ...failed.map((check) => `- ${check.name}: ${check.conclusion}`),
  ].join("\n");
}

export class SoftwareFactoryWorker {
  constructor(
    private readonly workerId: string,
    private readonly heartbeatMs: number,
    private readonly dependencies: WorkerDependencies,
  ) {}

  async runOnce(): Promise<"idle" | "processed"> {
    const job = await this.dependencies.store.claim(this.workerId);
    if (!job) return "idle";
    await this.executeClaimed(job);
    return "processed";
  }

  private async executeClaimed(job: WorkerJob) {
    const controller = new AbortController();
    let deadlineExceeded = false;
    let ownerCancellation = job.cancellationRequested;
    let heartbeatInFlight: Promise<void> | null = null;
    let heartbeatFailure: unknown = null;
    const durationTimer = setTimeout(() => {
      deadlineExceeded = true;
      controller.abort();
    }, job.budget.maximumDurationMs);
    const heartbeat = () => {
      if (heartbeatInFlight) return heartbeatInFlight;
      const pending = this.dependencies.store.heartbeat(job, this.workerId)
        .then(({ cancelRequested }) => {
          if (cancelRequested) {
            ownerCancellation = true;
            controller.abort();
          }
        })
        .catch((error) => {
          heartbeatFailure = error;
          controller.abort();
          throw error;
        })
        .finally(() => {
          if (heartbeatInFlight === pending) heartbeatInFlight = null;
        });
      heartbeatInFlight = pending;
      return pending;
    };
    const assertExecutionActive = async () => {
      controller.signal.throwIfAborted();
      await heartbeat();
      controller.signal.throwIfAborted();
    };
    const heartbeatTimer = setInterval(() => {
      if (heartbeatInFlight || controller.signal.aborted) return;
      void heartbeat().catch(() => undefined);
    }, this.heartbeatMs);

    const event: EventWriter = async (entry) => {
      await this.dependencies.store.event(job, this.workerId, entry);
    };
    let observedChecks: WorkerResult["checks"] = [];
    let observedChangedFiles: readonly string[] = [];
    let observedProviderRunReference: string | null = job.recovery?.providerRunReference ?? null;
    let observedUsage = job.priorUsage;
    let preparedWorkspace: PreparedWorkspace | null = null;
    let activeCodexSession: CodexSession | null = null;
    let validationRound = 0;

    try {
      if (job.cancellationRequested) throw new WorkerCancellationError();
      if (job.risk === "red") {
        throw new PolicyScanError(
          "red_not_executable",
          "Phase 1C workers cannot execute RED work. Owner approval does not widen this phase ceiling.",
        );
      }
      await event({ kind: "claimed", message: "A durable worker claimed this exact run." });
      await event({ kind: "workspace_preparing", message: "Preparing an isolated Git workspace." });
      await assertExecutionActive();
      let installationToken = await this.dependencies.tokenProvider.createToken(job, controller.signal);
      let workspace: PreparedWorkspace;
      try {
        workspace = await this.dependencies.workspace.prepare(job, installationToken.token, controller.signal);
      } catch (prepareError) {
        // On a continuously merging repository the planned base is often
        // already historical by the first claim (three live owner commands
        // died stale_base_sha on 2026-08-16 without executing). While nothing
        // was ever built on the old base — no recovery evidence here, no
        // commit recorded in the database, no remote factory branch (the
        // workspace refuses those separately) — moving the plan to the
        // observed head is the honest reading of "run this against the
        // repository". The database guard re-checks the lease and the
        // no-commit condition before the plan moves.
        const observedSha = prepareError instanceof WorkspaceError
          && prepareError.code === "stale_base_sha"
          && !job.recovery
          && typeof prepareError.observedBaseSha === "string"
          && /^[0-9a-f]{40}$/.test(prepareError.observedBaseSha)
          ? prepareError.observedBaseSha
          : null;
        if (!observedSha) throw prepareError;
        const replanned = await this.dependencies.store.replan(job, this.workerId, observedSha);
        if (!replanned) throw prepareError;
        await event({
          kind: "replanned_base",
          message: "The base branch moved before execution started; the run was re-planned to the current head.",
          details: { fromSha: job.repository.baseSha, toSha: observedSha },
        });
        job = {
          ...job,
          repository: { ...job.repository, baseSha: observedSha },
        };
        workspace = await this.dependencies.workspace.prepare(job, installationToken.token, controller.signal);
      }
      preparedWorkspace = workspace;
      await this.dependencies.store.artifact(job, this.workerId, {
        type: "branch",
        reference: workspace.branch,
        metadata: { localPrepared: true },
      });
      await event({
        kind: "workspace_ready",
        message: "The isolated workspace is ready at the planned base SHA.",
        details: { branch: workspace.branch, baseSha: job.repository.baseSha },
      });

      const preparedHead = await this.dependencies.workspace.currentHead(workspace, controller.signal);
      const resumeProviderEvidence = job.recovery
        && preparedHead === job.recovery.commitSha.toLowerCase();
      if (job.recovery && workspace.branch !== job.recovery.branch) {
        throw new WorkspaceError(
          "workspace_recovery_mismatch",
          "The recovered workspace does not match the immutable branch evidence.",
        );
      }
      if (job.recovery && !resumeProviderEvidence
        && preparedHead !== job.repository.baseSha.toLowerCase()) {
        throw new WorkspaceError(
          "workspace_recovery_mismatch",
          "The recovered workspace matches neither the remote provider commit nor the planned base SHA.",
        );
      }

      if (job.recovery && resumeProviderEvidence) {
        if (workspace.branch !== job.recovery.branch) {
          throw new WorkspaceError(
            "workspace_recovery_mismatch",
            "The recovered workspace does not match the immutable branch and commit evidence.",
          );
        }
        observedChangedFiles = await this.dependencies.workspace.changedFiles(
          workspace,
          job.repository.baseSha,
          controller.signal,
        );
        const recoveryScan = await scanChangedFiles(job, workspace, observedChangedFiles);
        await this.dependencies.workspace.assertImmutableCommit(
          workspace,
          job.recovery.commitSha,
          controller.signal,
        );
        await assertExecutionActive();
        await this.dependencies.workspace.assertRemoteBaseSha(
          workspace,
          job.repository,
          installationToken.token,
          controller.signal,
        );
        const pullRequest = job.recovery.pullRequestNumber !== null
          && job.recovery.pullRequestUrl !== null
          ? await this.dependencies.publisher.verifyExistingDraft(
              job,
              job.recovery.pullRequestNumber,
              job.recovery.pullRequestUrl,
              job.recovery.commitSha,
              installationToken.token,
              controller.signal,
            )
          : await this.dependencies.publisher.createOrRecoverDraft(
              job,
              job.recovery.branch,
              job.recovery.commitSha,
              installationToken.token,
              controller.signal,
            );
        await this.dependencies.store.artifact(job, this.workerId, {
          type: "commit",
          reference: job.recovery.commitSha,
          metadata: { recovered: true },
        });
        await this.dependencies.store.artifact(job, this.workerId, {
          type: "pull_request",
          reference: pullRequest.url,
          externalNumber: pullRequest.number,
          metadata: { commitSha: job.recovery.commitSha, recovered: true },
        });
        await event({
          kind: "pull_request_updated",
          message: "Recovered the exact existing draft pull request without rerunning Codex.",
          details: { pullRequestNumber: pullRequest.number, commitSha: job.recovery.commitSha },
        });
        await event({ kind: "ci_started", message: "Resumed CI observation for the exact recovered draft head." });
        const ci = await this.dependencies.publisher.waitForChecks(
          job,
          pullRequest.number,
          job.recovery.commitSha,
          installationToken.token,
          job.budget.ciTimeoutMs,
          controller.signal,
        );
        observedChecks = ci.checks;
        await event({
          kind: "ci_completed",
          message: `Recovered GitHub check observation completed with ${ci.status}.`,
          details: { status: ci.status, checkCount: ci.checks.length, commitSha: job.recovery.commitSha },
        });
        if (ci.status !== "passed") {
          throw new GitHubWorkerError(
            ci.status === "timed_out" ? "timed_out" : "github_ci_failed",
            ci.status === "timed_out"
              ? "GitHub CI observation timed out during exact draft recovery."
              : "The recovered exact draft pull request has failing CI.",
            ci.status === "timed_out" ? 504 : 409,
          );
        }
        await assertExecutionActive();
        await this.dependencies.workspace.assertRemoteBaseSha(
          workspace,
          job.repository,
          installationToken.token,
          controller.signal,
        );
        await this.dependencies.publisher.verifyExistingDraft(
          job,
          pullRequest.number,
          pullRequest.url,
          job.recovery.commitSha,
          installationToken.token,
          controller.signal,
        );
        await this.dependencies.store.complete(job, this.workerId, Object.freeze({
          branch: job.recovery.branch,
          commitSha: job.recovery.commitSha,
          pullRequestNumber: pullRequest.number,
          pullRequestUrl: pullRequest.url,
          threadId: job.recovery.providerRunReference,
          summary: "Recovered the exact validated draft pull request and observed stable passing CI.",
          usage: job.priorUsage,
          checks: ci.checks,
          changedFiles: recoveryScan.changedFiles,
          validation: [],
        }));
        return;
      }

      const bootstrap = await this.dependencies.validator.bootstrap(workspace, controller.signal);
      await this.dependencies.store.validation(job, this.workerId, validationRound, bootstrap);
      if (bootstrap.status === "failed") {
        throw new Error(`Dependency bootstrap failed: ${bootstrap.output}`);
      }

      // Seeds the per-run CODEX_HOME with subscription credentials. Must happen
      // before the first turn, and after the workspace exists — the credential
      // lives inside the run directory so it is removed with it.
      await this.dependencies.codex.prepare(workspace);

      const session = this.dependencies.codex.createSession(job, workspace);
      activeCodexSession = session;
      await event({ kind: "agent_started", message: "Codex engineering execution started." });
      let codexResult = await session.run(
        this.dependencies.codex.initialPrompt(job),
        controller.signal,
        event,
      );
      await recordCodexEvidence(codexResult, event);
      observedProviderRunReference = codexResult.threadId;
      observedUsage = codexResult.usage;
      await event({ kind: "agent_completed", message: "Codex returned control to deterministic validation." });

      let localRepairAttempt = 0;
      validationRound += 1;
      let validation = await this.validateWithEvents(job, workspace, controller.signal, event, validationRound);
      while (!validationPassed(validation) && localRepairAttempt < job.budget.maximumRepairAttempts) {
        localRepairAttempt += 1;
        await event({
          kind: "repair_started",
          message: "Codex started a bounded repair from deterministic validation evidence.",
          details: { attempt: localRepairAttempt, source: "local_validation" },
        });
        codexResult = await session.run(
          repairPrompt(validationFailureSummary(validation), localRepairAttempt),
          controller.signal,
          event,
        );
        await recordCodexEvidence(codexResult, event);
        observedProviderRunReference = codexResult.threadId;
        observedUsage = codexResult.usage;
        validationRound += 1;
        validation = await this.validateWithEvents(job, workspace, controller.signal, event, validationRound);
      }
      if (!validationPassed(validation)) {
        throw new Error(`Deterministic validation failed. ${validationFailureSummary(validation)}`);
      }

      await event({ kind: "policy_scan_started", message: "Reviewing changed paths and content before publication." });
      let changedFiles = await this.dependencies.workspace.changedFiles(
        workspace,
        job.repository.baseSha,
        controller.signal,
      );
      observedChangedFiles = changedFiles;
      let scan = await scanChangedFiles(job, workspace, changedFiles);
      await event({
        kind: "policy_scan_completed",
        message: "The changed-file policy and secret scan passed.",
        details: { fileCount: scan.changedFiles.length, protectedFileCount: scan.protectedFiles.length },
      });

      let commitSha = await this.dependencies.workspace.commit(workspace, commitMessage(job), controller.signal);
      changedFiles = await this.dependencies.workspace.changedFiles(
        workspace,
        job.repository.baseSha,
        controller.signal,
      );
      observedChangedFiles = changedFiles;
      scan = await scanChangedFiles(job, workspace, changedFiles);
      await this.dependencies.workspace.assertImmutableCommit(workspace, commitSha, controller.signal);
      await this.dependencies.store.artifact(job, this.workerId, {
        type: "commit",
        reference: commitSha,
      });
      await event({ kind: "commit_created", message: "Created a commit on the isolated factory branch.", details: { commitSha } });
      installationToken = await this.dependencies.tokenProvider.createToken(job, controller.signal);
      await assertExecutionActive();
      await this.dependencies.workspace.assertRemoteBaseSha(
        workspace,
        job.repository,
        installationToken.token,
        controller.signal,
      );
      await this.dependencies.workspace.push(workspace, installationToken.token, commitSha, controller.signal);
      await event({ kind: "branch_pushed", message: "Pushed the isolated factory branch." });
      await assertExecutionActive();
      await this.dependencies.workspace.assertRemoteBaseSha(
        workspace,
        job.repository,
        installationToken.token,
        controller.signal,
      );
      let pullRequest = await this.dependencies.publisher.createOrRecoverDraft(
        job,
        workspace.branch,
        commitSha,
        installationToken.token,
        controller.signal,
      );
      await this.dependencies.store.artifact(job, this.workerId, {
        type: "pull_request",
        reference: pullRequest.url,
        externalNumber: pullRequest.number,
        metadata: { commitSha },
      });
      await event({
        kind: "pull_request_created",
        message: "Created or recovered an open draft pull request.",
        details: { pullRequestNumber: pullRequest.number, pullRequestUrl: pullRequest.url },
      });

      let ciRepairAttempt = localRepairAttempt;
      let ci;
      while (true) {
        await event({ kind: "ci_started", message: "Observing GitHub checks for the exact pull request head." });
        ci = await this.dependencies.publisher.waitForChecks(
          job,
          pullRequest.number,
          commitSha,
          installationToken.token,
          job.budget.ciTimeoutMs,
          controller.signal,
        );
        observedChecks = ci.checks;
        await event({
          kind: "ci_completed",
          message: `GitHub check observation completed with ${ci.status}.`,
          details: { status: ci.status, checkCount: ci.checks.length, commitSha },
        });
        if (ci.status === "passed") break;
        if (ci.status === "timed_out") throw new Error("GitHub CI observation timed out without conclusive success.");
        if (ciRepairAttempt >= job.budget.maximumRepairAttempts) {
          throw new Error("GitHub CI failed and the bounded repair budget is exhausted.");
        }
        ciRepairAttempt += 1;
        await event({
          kind: "repair_started",
          message: "Codex started a bounded repair from GitHub CI evidence.",
          details: { attempt: ciRepairAttempt, source: "github_ci" },
        });
        codexResult = await session.run(
          ciRepairPrompt(ci.checks, ciRepairAttempt),
          controller.signal,
          event,
        );
        await recordCodexEvidence(codexResult, event);
        observedProviderRunReference = codexResult.threadId;
        observedUsage = codexResult.usage;
        validationRound += 1;
        validation = await this.validateWithEvents(job, workspace, controller.signal, event, validationRound);
        if (!validationPassed(validation)) {
          throw new Error(`CI repair failed deterministic validation. ${validationFailureSummary(validation)}`);
        }
        changedFiles = await this.dependencies.workspace.changedFiles(
          workspace,
          job.repository.baseSha,
          controller.signal,
        );
        observedChangedFiles = changedFiles;
        scan = await scanChangedFiles(job, workspace, changedFiles);
        commitSha = await this.dependencies.workspace.commit(
          workspace,
          `${commitMessage(job)} (repair ${ciRepairAttempt})`,
          controller.signal,
        );
        changedFiles = await this.dependencies.workspace.changedFiles(
          workspace,
          job.repository.baseSha,
          controller.signal,
        );
        observedChangedFiles = changedFiles;
        scan = await scanChangedFiles(job, workspace, changedFiles);
        await this.dependencies.workspace.assertImmutableCommit(workspace, commitSha, controller.signal);
        await this.dependencies.store.artifact(job, this.workerId, {
          type: "commit",
          reference: commitSha,
          metadata: { repairAttempt: ciRepairAttempt },
        });
        installationToken = await this.dependencies.tokenProvider.createToken(job, controller.signal);
        await assertExecutionActive();
        await this.dependencies.workspace.assertRemoteBaseSha(
          workspace,
          job.repository,
          installationToken.token,
          controller.signal,
        );
        await this.dependencies.workspace.push(workspace, installationToken.token, commitSha, controller.signal);
        await assertExecutionActive();
        await this.dependencies.workspace.assertRemoteBaseSha(
          workspace,
          job.repository,
          installationToken.token,
          controller.signal,
        );
        pullRequest = await this.dependencies.publisher.createOrRecoverDraft(
          job,
          workspace.branch,
          commitSha,
          installationToken.token,
          controller.signal,
        );
        await this.dependencies.store.artifact(job, this.workerId, {
          type: "pull_request_head",
          reference: commitSha,
          externalNumber: pullRequest.number,
          metadata: { pullRequestUrl: pullRequest.url, repairAttempt: ciRepairAttempt },
        });
        await event({
          kind: "pull_request_updated",
          message: "The bounded repair commit updated the existing draft pull request.",
          details: { pullRequestNumber: pullRequest.number, commitSha },
        });
      }

      const result: WorkerResult = Object.freeze({
        branch: workspace.branch,
        commitSha,
        pullRequestNumber: pullRequest.number,
        pullRequestUrl: pullRequest.url,
        threadId: codexResult.threadId,
        summary: codexResult.summary,
        usage: codexResult.usage,
        checks: ci.checks,
        changedFiles: scan.changedFiles,
        validation,
      });
      await assertExecutionActive();
      await this.dependencies.workspace.assertRemoteBaseSha(
        workspace,
        job.repository,
        installationToken.token,
        controller.signal,
      );
      await this.dependencies.publisher.verifyExistingDraft(
        job,
        pullRequest.number,
        pullRequest.url,
        commitSha,
        installationToken.token,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      await this.dependencies.store.complete(job, this.workerId, result);
    } catch (error) {
      if (activeCodexSession) {
        observedUsage = activeCodexSession.usage;
        observedProviderRunReference = activeCodexSession.threadId ?? observedProviderRunReference;
      }
      const cancelled = ownerCancellation || error instanceof WorkerCancellationError;
      const actualError = deadlineExceeded
        ? new WorkerDeadlineError()
        : heartbeatFailure ?? error;
      if (observedChangedFiles.length === 0 && preparedWorkspace) {
        try {
          const recoveredChangedFiles = await this.dependencies.workspace.changedFiles(
            preparedWorkspace,
            job.repository.baseSha,
            new AbortController().signal,
          );
          if (Array.isArray(recoveredChangedFiles)) observedChangedFiles = recoveredChangedFiles;
        } catch {
          // Preserve the original failure; changed-file recovery is best-effort evidence only.
        }
      }
      const message = cancelled
        ? "The run was cancelled or exceeded its bounded execution window."
        : safeErrorMessage(actualError);
      if (cancelled) {
        await this.dependencies.store.cancel(job, this.workerId, message, observedUsage);
      } else {
        // The truth must outlive its recording: when writing the failure to
        // the database also fails, the process log is the only witness left.
        // Two live attempts on 2026-08-16 died with both errors invisible.
        console.error(
          `Run ${job.runId} failed (${failureCode(actualError)}): ${message}`,
        );
        try {
          await this.dependencies.store.fail(job, this.workerId, {
            code: failureCode(actualError),
            message,
            retryable: retryable(actualError),
            providerRunReference: observedProviderRunReference,
            usage: observedUsage,
            checks: observedChecks,
            changedFiles: observedChangedFiles,
          });
        } catch (recordingError) {
          throw new Error(
            `Recording the run failure failed: ${safeErrorMessage(recordingError)}. `
            + `Original failure (${failureCode(actualError)}): ${message}`,
          );
        }
      }
    } finally {
      clearTimeout(durationTimer);
      clearInterval(heartbeatTimer);
    }
  }

  private async validateWithEvents(
    job: WorkerJob,
    workspace: PreparedWorkspace,
    signal: AbortSignal,
    event: EventWriter,
    validationRound: number,
  ) {
    await event({ kind: "validation_started", message: "Deterministic lint, typecheck, test, and build validation started." });
    const results = await this.dependencies.validator.run(workspace, signal);
    for (const result of results) {
      await this.dependencies.store.validation(job, this.workerId, validationRound, result);
    }
    await event({
      kind: "validation_completed",
      message: validationPassed(results) ? "Deterministic validation passed." : "Deterministic validation failed.",
      details: {
        passed: validationPassed(results),
        failedCount: results.filter((result) => result.status === "failed").length,
      },
    });
    return results;
  }
}
