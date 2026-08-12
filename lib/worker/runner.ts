import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { GitHubApiError } from "@/lib/github/client";
import {
  createGitHubBranch,
  createGitHubDraftPullRequest,
  listGitHubCheckRuns,
  updateGitHubFileOnBranch,
} from "@/lib/github/repository";
import { requireWorkerProvider } from "@/lib/providers/registry";
import {
  ProviderError,
  type WorkerRunHandle,
  type WorkerRunResult,
} from "@/lib/providers/types";
import type { RiskLevel } from "@/lib/risk";
import { reviewProposedDiff } from "@/lib/worker/diff-review";
import {
  WorkerRepositoryError,
  createRunInstallationToken,
  deriveSearchTerms,
  loadRepositoryMemory,
  loadTaskFiles,
  readBaseSha,
  resolveRunRepository,
  type ResolvedRepository,
} from "@/lib/worker/repository";

/**
 * The durable run state machine.
 *
 * Every step is short, idempotent, and persists its outcome before returning.
 * A tick advances a leased run until it either finishes, needs to wait for an
 * external system, or fails. Nothing is held in process memory, so a crashed
 * tick, an expired lease, a closed browser, or a server restart costs at most
 * one step.
 *
 * Validation is not simulated here. Lint, typecheck, tests, and build are run by
 * the target repository's own CI on the draft pull request, and the repair loop
 * consumes those real results.
 */

export const RUN_STEPS = [
  "resolve_repository",
  "load_context",
  "request_provider",
  "await_provider",
  "review_diff",
  "apply_changes",
  "open_pull_request",
  "observe_ci",
  "complete",
] as const;

export type RunStep = (typeof RUN_STEPS)[number];

export type RunFailureKind =
  | "provider_outage"
  | "provider_rate_limit"
  | "provider_invalid_output"
  | "github_error"
  | "github_rate_limit"
  | "repository_conflict"
  | "authorization"
  | "invalid_command"
  | "worker_timeout"
  | "test_failure"
  | "ci_failure"
  | "validation_failed"
  | "protected_resource"
  | "secret_detected"
  | "cancelled"
  | "internal";

export type StepOutcome =
  | { readonly kind: "continue"; readonly step: RunStep }
  | { readonly kind: "wait"; readonly step: RunStep; readonly retryAfterSeconds: number }
  | { readonly kind: "done" }
  | { readonly kind: "awaiting_review"; readonly reason: string }
  | { readonly kind: "failed"; readonly failureKind: RunFailureKind; readonly message: string };

export type RunRow = {
  id: string;
  organization_id: string;
  project_id: string;
  task_id: string;
  agent_id: string;
  status: string;
  step: string | null;
  provider: string | null;
  model: string | null;
  attempt: number;
  max_attempts: number;
  repair_attempts: number;
  ci_repair_attempts: number;
  provider_run_reference: string | null;
  cancel_requested_at: string | null;
  input: Record<string, unknown>;
  lease_owner: string | null;
};

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  risk_level: "green" | "yellow" | "red";
  input: Record<string, unknown>;
};

export type RunnerDependencies = {
  readonly client: SupabaseClient;
  readonly workerId: string;
  readonly now: () => Date;
};

const CODE_CHANGING_WORK_TYPES = new Set(["code_change", "test_repair"]);
const PROTECTED_PATH_GUIDANCE = [
  "AI/**", "policies/**", "supabase/**", ".github/**", "app/api/**",
  "lib/github/**", "lib/server/**", "lib/supabase/**", "app/auth/**",
  ".env*", "AGENTS.md", "CLAUDE.md", "CODEOWNERS", "vercel.json", "proxy.ts",
  "any path naming auth, session, secret, credential, key, webhook, deploy, release, rollback, dns, or billing",
];
const MAX_OUTPUT_TOKENS = 32_000;
const PROVIDER_POLL_SECONDS = 20;
const CI_POLL_SECONDS = 45;

function riskLevel(value: TaskRow["risk_level"]): RiskLevel {
  return value.toUpperCase() as RiskLevel;
}

function workTypeOf(run: RunRow, task: TaskRow): string {
  return (
    (typeof run.input?.workType === "string" ? run.input.workType : null)
    ?? (typeof task.input?.workType === "string" ? task.input.workType : null)
    ?? "code_change"
  );
}

export function branchSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "work";
}

export function workingBranchName(runId: string, title: string): string {
  return `factory/${runId}-${branchSlug(title)}`;
}

export function buildPullRequestBody(input: {
  runId: string;
  commandPrompt: string | null;
  taskTitle: string;
  summary: string;
  risk: RiskLevel;
  acceptanceCriteria: string | null;
  changedPaths: readonly string[];
  warnings: readonly string[];
  securityFindings: readonly string[];
  baseBranch: string;
  workingBranch: string;
}): string {
  return [
    "## SoftwareFactory run",
    "",
    `- Run ID: \`${input.runId}\``,
    `- Task: ${input.taskTitle}`,
    input.commandPrompt ? `- Owner command: ${input.commandPrompt}` : null,
    `- Risk: **${input.risk}**`,
    `- Branch: \`${input.workingBranch}\` → \`${input.baseBranch}\``,
    "",
    "## Summary",
    "",
    input.summary,
    "",
    "## Acceptance criteria",
    "",
    input.acceptanceCriteria ?? "_None recorded._",
    "",
    "## Changed files",
    "",
    ...(input.changedPaths.length > 0
      ? input.changedPaths.map((path) => `- \`${path}\``)
      : ["_No files changed._"]),
    "",
    "## Validation",
    "",
    "SoftwareFactory does not run this repository's test suite itself. Lint, typecheck, tests, and build are executed by this repository's own CI on this pull request; read the checks below for the real result.",
    ...(input.warnings.length > 0
      ? ["", "## Warnings", "", ...input.warnings.map((warning) => `- ${warning}`)]
      : []),
    ...(input.securityFindings.length > 0
      ? ["", "## Security findings", "", ...input.securityFindings.map((finding) => `- ${finding}`)]
      : []),
    "",
    "## Limitations and rollback",
    "",
    "- This pull request is a **draft**. SoftwareFactory did not approve, merge, or deploy it.",
    "- Rollback is closing this pull request and deleting its branch; the default branch was never written to.",
    "- A machine-authored change is a proposal. Review it before merging.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function classifyThrown(error: unknown): { failureKind: RunFailureKind; message: string } {
  if (error instanceof ProviderError) {
    const map: Record<ProviderError["code"], RunFailureKind> = {
      provider_not_configured: "authorization",
      provider_outage: "provider_outage",
      provider_rate_limit: "provider_rate_limit",
      provider_invalid_output: "provider_invalid_output",
      provider_rejected: "provider_invalid_output",
      provider_cancelled: "cancelled",
    };
    return { failureKind: map[error.code], message: error.message };
  }
  if (error instanceof WorkerRepositoryError) {
    return { failureKind: "repository_conflict", message: error.message };
  }
  if (error instanceof GitHubApiError) {
    if (error.status === 403 || error.status === 401) {
      return { failureKind: "authorization", message: error.message };
    }
    if (error.status === 429) {
      return { failureKind: "github_rate_limit", message: error.message };
    }
    if (error.status === 409) {
      return { failureKind: "repository_conflict", message: error.message };
    }
    return { failureKind: "github_error", message: error.message };
  }
  return {
    failureKind: "internal",
    message: error instanceof Error ? error.message.slice(0, 300) : "The run step failed.",
  };
}

/** Per-run scratch state. Rebuilt from the database on every tick. */
type RunScratch = {
  resolved?: ResolvedRepository;
  token?: string;
  baseSha?: string;
  handle?: WorkerRunHandle;
  result?: WorkerRunResult;
  knownFileShas?: Map<string, string>;
  workingBranch?: string;
  headSha?: string;
  changedPaths?: string[];
  pullRequestNumber?: number;
};

export class RunExecutor {
  private readonly scratch: RunScratch = {};

  constructor(
    private readonly dependencies: RunnerDependencies,
    private readonly run: RunRow,
    private readonly task: TaskRow,
  ) {}

  private get client() {
    return this.dependencies.client;
  }

  private async event(
    eventType: string,
    message: string,
    metadata: Record<string, unknown> = {},
  ) {
    const { error } = await this.client.rpc("record_run_event", {
      p_run_id: this.run.id,
      p_event_type: eventType,
      p_message: message,
      p_metadata: metadata,
    });
    if (error) throw error;
  }

  private async heartbeat(step: RunStep) {
    const { error } = await this.client.rpc("heartbeat_agent_run", {
      p_run_id: this.run.id,
      p_worker_id: this.dependencies.workerId,
      p_step: step,
      p_lease_seconds: 300,
    });
    if (error) throw error;
  }

  private async cancellationRequested(): Promise<boolean> {
    const { data, error } = await this.client
      .from("agent_runs")
      .select("cancel_requested_at,status")
      .eq("id", this.run.id)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data?.cancel_requested_at) || data?.status === "cancelling";
  }

  private async ensureRepository() {
    if (!this.scratch.resolved) {
      this.scratch.resolved = await resolveRunRepository(
        this.client,
        this.run.organization_id,
        this.run.project_id,
      );
    }
    if (!this.scratch.token) {
      this.scratch.token = await createRunInstallationToken(this.scratch.resolved, {
        contents: "write",
        pull_requests: "write",
        checks: "read",
      });
    }
    return { resolved: this.scratch.resolved, token: this.scratch.token };
  }

  private async stepResolveRepository(): Promise<StepOutcome> {
    const { resolved, token } = await this.ensureRepository();
    const baseSha = await readBaseSha(token, resolved);
    this.scratch.baseSha = baseSha;

    await this.event(
      "repository.resolved",
      `Resolved ${resolved.fullName} at ${resolved.defaultBranch}.`,
      { repository: resolved.fullName, baseBranch: resolved.defaultBranch, baseSha },
    );
    return { kind: "continue", step: "load_context" };
  }

  private async stepLoadContext(): Promise<StepOutcome> {
    const { resolved, token } = await this.ensureRepository();
    const baseSha = this.scratch.baseSha ?? (await readBaseSha(token, resolved));
    this.scratch.baseSha = baseSha;

    const memory = await loadRepositoryMemory(token, resolved, resolved.defaultBranch);
    const terms = deriveSearchTerms(`${this.task.title} ${this.task.description ?? ""}`);
    const files = await loadTaskFiles(token, resolved, baseSha, terms);

    const knownFileShas = new Map<string, string>();
    for (const file of [...memory, ...files]) {
      if (file.sha) knownFileShas.set(file.path.toLowerCase(), file.sha);
    }
    this.scratch.knownFileShas = knownFileShas;

    await this.event(
      "repository_memory.loaded",
      `Loaded ${memory.length} memory file(s) and ${files.length} task file(s).`,
      { memoryFiles: memory.length, taskFiles: files.length, searchTerms: terms },
    );

    // Context is re-derived on the next step rather than carried across ticks,
    // so a lost lease never leaves a half-built prompt behind.
    this.scratch.result = undefined;
    return { kind: "continue", step: "request_provider" };
  }

  private async stepRequestProvider(): Promise<StepOutcome> {
    const providerKey = this.run.provider;
    const model = this.run.model;
    if (!providerKey || !model) {
      return {
        kind: "failed",
        failureKind: "invalid_command",
        message: "The run has no provider or model assigned.",
      };
    }

    const provider = requireWorkerProvider(providerKey);
    if (!provider.isConfigured()) {
      return {
        kind: "failed",
        failureKind: "authorization",
        message: `${provider.label} is Not Connected. ${
          provider.describeConfiguration().ownerAction ?? ""
        }`.trim(),
      };
    }

    const { resolved, token } = await this.ensureRepository();
    const baseSha = this.scratch.baseSha ?? (await readBaseSha(token, resolved));
    const memory = await loadRepositoryMemory(token, resolved, resolved.defaultBranch);
    const terms = deriveSearchTerms(`${this.task.title} ${this.task.description ?? ""}`);
    const files = await loadTaskFiles(token, resolved, baseSha, terms);

    const knownFileShas = new Map<string, string>();
    for (const file of [...memory, ...files]) {
      if (file.sha) knownFileShas.set(file.path.toLowerCase(), file.sha);
    }
    this.scratch.knownFileShas = knownFileShas;

    const priorFailure = await this.readPriorFailure();
    const handle = await provider.createRun({
      runId: this.run.id,
      objective: `${this.task.title}\n\n${this.task.description ?? ""}`.trim(),
      acceptanceCriteria: this.task.acceptance_criteria,
      workType: workTypeOf(this.run, this.task),
      repository: resolved.fullName,
      baseBranch: resolved.defaultBranch,
      baseSha,
      model,
      protectedPathGuidance: PROTECTED_PATH_GUIDANCE,
      memory,
      files,
      priorFailure,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });

    this.scratch.handle = handle;
    const { error } = await this.client
      .from("agent_runs")
      .update({ provider_run_reference: handle.externalRunId })
      .eq("id", this.run.id)
      .eq("lease_owner", this.dependencies.workerId);
    if (error) throw error;

    await this.event("provider.requested", `${provider.label} run requested.`, {
      provider: provider.key,
      model,
    });
    return { kind: "wait", step: "await_provider", retryAfterSeconds: PROVIDER_POLL_SECONDS };
  }

  private async readPriorFailure() {
    if (this.run.repair_attempts === 0 && this.run.ci_repair_attempts === 0) return null;

    const { data, error } = await this.client
      .from("run_events")
      .select("event_type,message,metadata")
      .eq("agent_run_id", this.run.id)
      .in("event_type", ["ci.failed", "test.failed"])
      .order("sequence", { ascending: false })
      .limit(1);
    if (error) throw error;

    const latest = data?.[0];
    if (!latest) return null;

    const details = Array.isArray((latest.metadata as { failedChecks?: unknown })?.failedChecks)
      ? ((latest.metadata as { failedChecks: unknown[] }).failedChecks
          .filter((value): value is string => typeof value === "string")
          .slice(0, 20))
      : [];

    return {
      kind: latest.event_type === "ci.failed" ? ("ci" as const) : ("test" as const),
      summary: latest.message,
      details,
    };
  }

  private handle(): WorkerRunHandle {
    if (this.scratch.handle) return this.scratch.handle;
    if (!this.run.provider_run_reference || !this.run.provider || !this.run.model) {
      throw new ProviderError(
        "provider_invalid_output",
        "The run has no provider reference to poll.",
      );
    }
    return {
      providerKey: this.run.provider,
      externalRunId: this.run.provider_run_reference,
      model: this.run.model,
    };
  }

  private async stepAwaitProvider(): Promise<StepOutcome> {
    const provider = requireWorkerProvider(this.run.provider ?? "");
    const handle = this.handle();
    const snapshot = await provider.getRun(handle);

    if (snapshot.status === "queued" || snapshot.status === "running") {
      return { kind: "wait", step: "await_provider", retryAfterSeconds: PROVIDER_POLL_SECONDS };
    }
    if (snapshot.status === "cancelled") {
      return { kind: "failed", failureKind: "cancelled", message: "The provider run was cancelled." };
    }
    if (snapshot.status === "failed") {
      return {
        kind: "failed",
        failureKind: "provider_outage",
        message: snapshot.errorMessage ?? "The provider run failed.",
      };
    }

    this.scratch.result = await provider.getResult(handle);
    await this.event("provider.completed", "The provider returned a structured result.", {
      changeCount: this.scratch.result.changes.length,
      warningCount: this.scratch.result.warnings.length,
    });
    return { kind: "continue", step: "review_diff" };
  }

  private async stepReviewDiff(): Promise<StepOutcome> {
    if (!this.scratch.result) {
      // The result is not carried across ticks; re-read it from the provider.
      const provider = requireWorkerProvider(this.run.provider ?? "");
      this.scratch.result = await provider.getResult(this.handle());
    }
    const result = this.scratch.result;
    const expectsChanges = CODE_CHANGING_WORK_TYPES.has(workTypeOf(this.run, this.task));

    if (!this.scratch.knownFileShas) {
      const { resolved, token } = await this.ensureRepository();
      const baseSha = this.scratch.baseSha ?? (await readBaseSha(token, resolved));
      const memory = await loadRepositoryMemory(token, resolved, resolved.defaultBranch);
      const terms = deriveSearchTerms(`${this.task.title} ${this.task.description ?? ""}`);
      const files = await loadTaskFiles(token, resolved, baseSha, terms);
      const map = new Map<string, string>();
      for (const file of [...memory, ...files]) {
        if (file.sha) map.set(file.path.toLowerCase(), file.sha);
      }
      this.scratch.knownFileShas = map;
    }

    const review = reviewProposedDiff({
      changes: result.changes,
      knownFileShas: this.scratch.knownFileShas,
      expectedPaths: [],
      declaredRisk: riskLevel(this.task.risk_level),
      providerRiskFactors: result.riskFactors,
      providerBlockers: result.blockers,
      expectsChanges,
    });

    await this.event(
      "diff.reviewed",
      `Reviewed ${result.changes.length} proposed file change(s).`,
      {
        approved: review.approved,
        recalculatedRisk: review.recalculatedRisk,
        blockers: review.findings.map((finding) => finding.blocker).slice(0, 10),
      },
    );

    if (review.secretFindings.length > 0) {
      await this.event(
        "secret_scan.blocked",
        `Blocked: ${review.secretFindings.length} likely secret(s) in the proposed content.`,
        { paths: [...new Set(review.secretFindings.map((finding) => finding.path))].slice(0, 10) },
      );
      return {
        kind: "failed",
        failureKind: "secret_detected",
        message: "The proposed change contained likely secret material and was blocked before any commit.",
      };
    }
    await this.event("secret_scan.passed", "No likely secret material was found.", {});

    if (!review.approved) {
      const protectedFinding = review.findings.find(
        (finding) => finding.blocker === "protected_resource",
      );
      const detail = review.findings.map((finding) => finding.detail).slice(0, 3).join(" ");
      await this.event("validation.blocked", `Blocked before commit: ${detail}`.slice(0, 500), {
        findings: review.findings.map((finding) => finding.blocker),
      });
      return {
        kind: "failed",
        failureKind: protectedFinding ? "protected_resource" : "validation_failed",
        message: detail || "The proposed change did not pass diff review.",
      };
    }

    if (result.changes.length === 0) {
      // Investigation and review work legitimately ends without a pull request.
      await this.recordResult(result, review.recalculatedRisk, "skipped");
      return { kind: "continue", step: "complete" };
    }

    return { kind: "continue", step: "apply_changes" };
  }

  private async stepApplyChanges(): Promise<StepOutcome> {
    const result = this.scratch.result;
    if (!result) {
      return {
        kind: "failed",
        failureKind: "internal",
        message: "The provider result was lost before the commit step.",
      };
    }

    const { resolved, token } = await this.ensureRepository();
    const baseSha = this.scratch.baseSha ?? (await readBaseSha(token, resolved));
    const workingBranch = workingBranchName(this.run.id, this.task.title);

    try {
      await createGitHubBranch(token, resolved.owner, resolved.repository, workingBranch, baseSha);
    } catch (error) {
      // A retried step may find the branch already created. That is safe.
      if (!(error instanceof GitHubApiError) || error.status !== 422) throw error;
    }
    this.scratch.workingBranch = workingBranch;

    const { error: workspaceError } = await this.client.rpc("record_run_workspace", {
      p_run_id: this.run.id,
      p_worker_id: this.dependencies.workerId,
      p_repository: resolved.fullName,
      p_external_repository_id: resolved.externalRepositoryId,
      p_base_branch: resolved.defaultBranch,
      p_base_sha: baseSha,
      p_working_branch: workingBranch,
      p_provider: this.run.provider,
      p_model: this.run.model,
    });
    if (workspaceError) throw workspaceError;

    await this.event("workspace.created", `Isolated branch ${workingBranch} created.`, {
      branch: workingBranch,
      baseSha,
    });

    const changedPaths: string[] = [];
    let headSha = baseSha;
    for (const change of result.changes) {
      const commit = await updateGitHubFileOnBranch(token, {
        branch: workingBranch,
        content: change.content,
        expectedBlobSha: change.action === "update" ? change.expectedSha : null,
        message: `${change.summary}\n\nSoftwareFactory run ${this.run.id}`.slice(0, 2000),
        owner: resolved.owner,
        path: change.path,
        repository: resolved.repository,
      });
      headSha = commit.commit.sha;
      changedPaths.push(change.path);
      await this.event("commit.created", `Committed ${change.path}.`, {
        path: change.path,
        sha: commit.commit.sha,
      });
    }

    this.scratch.headSha = headSha;
    this.scratch.changedPaths = changedPaths;
    await this.event("branch.pushed", `Pushed ${changedPaths.length} commit(s) to ${workingBranch}.`, {
      branch: workingBranch,
      headSha,
    });

    return { kind: "continue", step: "open_pull_request" };
  }

  private async stepOpenPullRequest(): Promise<StepOutcome> {
    const result = this.scratch.result;
    const workingBranch = this.scratch.workingBranch;
    if (!result || !workingBranch) {
      return {
        kind: "failed",
        failureKind: "internal",
        message: "The workspace state was lost before opening a pull request.",
      };
    }

    const { resolved, token } = await this.ensureRepository();
    const commandPrompt = await this.readCommandPrompt();

    const pullRequest = await createGitHubDraftPullRequest(token, {
      baseBranch: resolved.defaultBranch,
      body: buildPullRequestBody({
        runId: this.run.id,
        commandPrompt,
        taskTitle: this.task.title,
        summary: result.summary,
        risk: riskLevel(this.task.risk_level),
        acceptanceCriteria: this.task.acceptance_criteria,
        changedPaths: this.scratch.changedPaths ?? [],
        warnings: result.warnings,
        securityFindings: result.securityFindings,
        baseBranch: resolved.defaultBranch,
        workingBranch,
      }),
      headBranch: workingBranch,
      owner: resolved.owner,
      repository: resolved.repository,
      title: this.task.title.slice(0, 256),
    });

    const { error } = await this.client.rpc("record_run_pull_request", {
      p_run_id: this.run.id,
      p_worker_id: this.dependencies.workerId,
      p_repository: resolved.fullName,
      p_external_number: pullRequest.number,
      p_title: pullRequest.title,
      p_url: pullRequest.html_url,
      p_head_branch: workingBranch,
      p_base_branch: resolved.defaultBranch,
      p_risk: this.task.risk_level,
    });
    if (error) throw error;

    this.scratch.pullRequestNumber = pullRequest.number;
    await this.event("pr.created", `Draft pull request #${pullRequest.number} opened.`, {
      number: pullRequest.number,
      url: pullRequest.html_url,
      draft: true,
    });

    return { kind: "wait", step: "observe_ci", retryAfterSeconds: CI_POLL_SECONDS };
  }

  private async readCommandPrompt(): Promise<string | null> {
    const commandId = typeof this.run.input?.commandId === "string" ? this.run.input.commandId : null;
    if (!commandId) return null;

    const { data, error } = await this.client
      .from("commands")
      .select("prompt")
      .eq("id", commandId)
      .maybeSingle();
    if (error) return null;
    return data?.prompt ?? null;
  }

  private async stepObserveCi(): Promise<StepOutcome> {
    const { resolved, token } = await this.ensureRepository();
    const headSha = this.scratch.headSha ?? (await this.readWorkspaceHeadSha());
    if (!headSha) {
      return {
        kind: "failed",
        failureKind: "internal",
        message: "No head commit is recorded for this run.",
      };
    }

    const checks = await listGitHubCheckRuns(token, resolved.owner, resolved.repository, headSha);
    if (checks.length === 0) {
      // A repository with no CI cannot produce validation evidence. Say so
      // rather than treating silence as a pass.
      await this.event("ci.started", "No CI check runs are configured for this commit.", {});
      return {
        kind: "awaiting_review",
        reason: "This repository reported no CI checks, so no automated validation evidence exists.",
      };
    }

    const pending = checks.filter((check) => check.status !== "completed");
    if (pending.length > 0) {
      await this.heartbeat("observe_ci");
      return { kind: "wait", step: "observe_ci", retryAfterSeconds: CI_POLL_SECONDS };
    }

    const failed = checks.filter(
      (check) => check.conclusion !== "success" && check.conclusion !== "neutral" && check.conclusion !== "skipped",
    );

    if (failed.length === 0) {
      await this.event("ci.passed", `All ${checks.length} CI check(s) passed.`, {
        checks: checks.map((check) => check.name).slice(0, 20),
      });
      return { kind: "continue", step: "complete" };
    }

    await this.event("ci.failed", `${failed.length} CI check(s) failed.`, {
      failedChecks: failed.map((check) => `${check.name}: ${check.conclusion ?? "failed"}`).slice(0, 20),
    });

    const limit = await this.readCiRepairLimit();
    if (this.run.ci_repair_attempts >= limit) {
      return {
        kind: "failed",
        failureKind: "ci_failure",
        message: `CI failed and the configured repair limit of ${limit} attempt(s) is exhausted.`,
      };
    }

    const { error } = await this.client
      .from("agent_runs")
      .update({ ci_repair_attempts: this.run.ci_repair_attempts + 1 })
      .eq("id", this.run.id)
      .eq("lease_owner", this.dependencies.workerId);
    if (error) throw error;

    await this.event("repair.started", "Sending the real CI failure back to the worker.", {
      attempt: this.run.ci_repair_attempts + 1,
      limit,
    });
    this.run.ci_repair_attempts += 1;
    this.scratch.result = undefined;
    this.scratch.handle = undefined;
    return { kind: "continue", step: "request_provider" };
  }

  private async readWorkspaceHeadSha(): Promise<string | null> {
    const { data } = await this.client
      .from("run_workspaces")
      .select("base_sha")
      .eq("agent_run_id", this.run.id)
      .maybeSingle();
    return data?.base_sha ?? null;
  }

  private async readCiRepairLimit(): Promise<number> {
    const { data } = await this.client
      .from("organization_settings")
      .select("max_ci_repair_attempts")
      .eq("organization_id", this.run.organization_id)
      .maybeSingle();
    return data?.max_ci_repair_attempts ?? 1;
  }

  private async recordResult(
    result: WorkerRunResult,
    risk: RiskLevel,
    testsOutcome: "passed" | "failed" | "not_run" | "skipped",
  ) {
    const { error } = await this.client.rpc("record_run_result", {
      p_run_id: this.run.id,
      p_worker_id: this.dependencies.workerId,
      p_result: {
        summary: result.summary,
        filesChanged: result.changes.length,
        commits: this.scratch.changedPaths?.length ?? 0,
        testsOutcome,
        lintOutcome: testsOutcome,
        typecheckOutcome: testsOutcome,
        buildOutcome: testsOutcome,
        riskLevel: risk.toLowerCase(),
        changedFiles: result.changes.map((change) => ({
          path: change.path,
          action: change.action,
          summary: change.summary,
        })),
        warnings: result.warnings,
        blockers: result.blockers,
        securityFindings: result.securityFindings,
        nextRecommendation: result.nextRecommendation,
      },
    });
    if (error) throw error;
  }

  private async stepComplete(): Promise<StepOutcome> {
    if (this.scratch.result) {
      await this.recordResult(
        this.scratch.result,
        riskLevel(this.task.risk_level),
        this.scratch.pullRequestNumber ? "passed" : "skipped",
      );
    }
    await this.event("run.completed", "The run finished and its evidence is recorded.", {
      pullRequest: this.scratch.pullRequestNumber ?? null,
    });
    return { kind: "done" };
  }

  private async execute(step: RunStep): Promise<StepOutcome> {
    switch (step) {
      case "resolve_repository":
        return this.stepResolveRepository();
      case "load_context":
        return this.stepLoadContext();
      case "request_provider":
        return this.stepRequestProvider();
      case "await_provider":
        return this.stepAwaitProvider();
      case "review_diff":
        return this.stepReviewDiff();
      case "apply_changes":
        return this.stepApplyChanges();
      case "open_pull_request":
        return this.stepOpenPullRequest();
      case "observe_ci":
        return this.stepObserveCi();
      case "complete":
        return this.stepComplete();
      default:
        return { kind: "failed", failureKind: "internal", message: `Unknown step "${step}".` };
    }
  }

  /**
   * Advances the run until it waits, finishes, or fails. `maxSteps` bounds the
   * work one tick performs so a single run cannot monopolize the request.
   */
  async advance(maxSteps = 4): Promise<StepOutcome> {
    let step = (RUN_STEPS as readonly string[]).includes(this.run.step ?? "")
      ? (this.run.step as RunStep)
      : "resolve_repository";
    let outcome: StepOutcome = { kind: "continue", step };

    for (let index = 0; index < maxSteps; index += 1) {
      if (await this.cancellationRequested()) {
        await this.event("run.cancelled", "Cancellation was observed before the next step.", { step });
        return { kind: "failed", failureKind: "cancelled", message: "The run was cancelled." };
      }

      await this.heartbeat(step);
      try {
        outcome = await this.execute(step);
      } catch (error) {
        const classified = classifyThrown(error);
        await this.event("run.failed", classified.message.slice(0, 500), { step });
        return { kind: "failed", ...classified };
      }

      if (outcome.kind !== "continue") return outcome;
      step = outcome.step;
      await this.persistStep(step);
    }

    return { kind: "wait", step, retryAfterSeconds: 30 };
  }

  private async persistStep(step: RunStep) {
    const { error } = await this.client
      .from("agent_runs")
      .update({ step })
      .eq("id", this.run.id)
      .eq("lease_owner", this.dependencies.workerId);
    if (error) throw error;
  }
}
