import { z } from "zod";

import { githubWebUrlSchema } from "@/lib/github/schemas";

export const workerRiskSchema = z.enum(["green", "yellow", "red"]);
export type WorkerRisk = z.infer<typeof workerRiskSchema>;

export const logicalAgentRoleSchema = z.enum([
  "orchestrator",
  "product",
  "architect",
  "frontend",
  "backend",
  "database",
  "qa",
  "security",
  "performance",
  "release",
  "ceo_reporter",
  "custom",
]);
export type LogicalAgentRole = z.infer<typeof logicalAgentRoleSchema>;

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/i);
const repositoryPartSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/);
const zeroUsage = {
  turns: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
} as const;

export const workerUsageSchema = z.object({
  turns: z.number().int().min(0).default(0),
  inputTokens: z.number().int().min(0).default(0),
  cachedInputTokens: z.number().int().min(0).default(0),
  outputTokens: z.number().int().min(0).default(0),
  reasoningOutputTokens: z.number().int().min(0).default(0),
}).strict();

export type WorkerUsage = z.infer<typeof workerUsageSchema>;

export const workerJobSchema = z.object({
  runId: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  commandId: z.string().uuid(),
  taskId: z.string().uuid(),
  agentId: z.string().uuid(),
  connectionId: z.string().uuid(),
  repositoryDatabaseId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(12_000),
  commandType: z.string().trim().min(1).max(80),
  plan: z.record(z.string(), z.unknown()).default({}),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  agentRole: logicalAgentRoleSchema,
  provider: z.literal("openai"),
  model: z.string().trim().min(1).max(120),
  risk: workerRiskSchema,
  repository: z.object({
    appId: z.number().int().positive(),
    installationId: z.number().int().positive(),
    repositoryId: z.number().int().positive(),
    owner: repositoryPartSchema,
    name: repositoryPartSchema,
    baseBranch: z.string().trim().min(1).max(255),
    baseSha: shaSchema,
  }).strict(),
  worker: z.object({
    leaseToken: z.string().uuid(),
    leaseExpiresAt: z.string().datetime({ offset: true }),
  }).strict(),
  budget: z.object({
    // The persisted plan is always 60s..60m. A recovery claim receives only
    // the remaining slice of that durable total-run budget.
    maximumDurationMs: z.number().int().min(1).max(3_600_000),
    maximumTurns: z.number().int().min(1).max(8),
    maximumInputTokens: z.number().int().min(1).max(2_000_000),
    maximumOutputTokens: z.number().int().min(1).max(500_000),
    maximumRepairAttempts: z.number().int().min(0).max(3),
    ciTimeoutMs: z.number().int().min(30_000).max(1_800_000),
  }).strict(),
  ownerApproval: z.object({
    approvalId: z.string().uuid(),
    expiresAt: z.string().datetime({ offset: true }),
    approvedPaths: z.array(z.string().trim().min(1).max(1_024)).max(200).default([]),
  }).strict().nullable().default(null),
  attempt: z.number().int().min(1).max(10),
  cancellationRequested: z.boolean().default(false),
  priorUsage: workerUsageSchema.default(zeroUsage),
  recovery: z.object({
    branch: z.string().regex(/^factory\/[a-f0-9-]{36}-[a-z0-9][a-z0-9-]{0,39}$/),
    commitSha: shaSchema,
    pullRequestNumber: z.number().int().positive().nullable(),
    pullRequestUrl: githubWebUrlSchema.nullable(),
    providerRunReference: z.string().trim().min(1).max(255).nullable(),
    usage: workerUsageSchema,
  }).strict().refine(
    (value) => (value.pullRequestNumber === null) === (value.pullRequestUrl === null),
    { message: "Recovery pull request evidence must be complete or absent." },
  ).nullable().default(null),
}).strict();

export type WorkerJob = z.infer<typeof workerJobSchema>;

export type WorkerEventKind =
  | "claimed"
  | "workspace_preparing"
  | "workspace_ready"
  | "agent_started"
  | "agent_event"
  | "agent_completed"
  | "validation_started"
  | "validation_completed"
  | "policy_scan_started"
  | "policy_scan_completed"
  | "commit_created"
  | "branch_pushed"
  | "pull_request_created"
  | "pull_request_updated"
  | "ci_started"
  | "ci_completed"
  | "repair_started"
  | "cancelled"
  | "failed"
  | "completed";

export type WorkerEvent = Readonly<{
  kind: WorkerEventKind;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}>;

export type WorkerResult = Readonly<{
  branch: string;
  commitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  threadId: string | null;
  summary: string;
  usage: WorkerUsage;
  checks: readonly CheckResult[];
  changedFiles: readonly string[];
  validation: readonly ValidationResult[];
}>;

export type ValidationResult = Readonly<{
  name: string;
  command: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  output: string;
}>;

export type CheckResult = Readonly<{
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string | null;
}>;

export interface WorkerStore {
  claim(workerId: string): Promise<WorkerJob | null>;
  heartbeat(job: WorkerJob, workerId: string): Promise<{ cancelRequested: boolean }>;
  event(job: WorkerJob, workerId: string, event: WorkerEvent): Promise<void>;
  validation(
    job: WorkerJob,
    workerId: string,
    validationRound: number,
    result: ValidationResult,
  ): Promise<void>;
  artifact(
    job: WorkerJob,
    workerId: string,
    artifact: {
      type: "branch" | "commit" | "pull_request" | "pull_request_head";
      reference: string;
      externalNumber?: number | null;
      metadata?: Record<string, string | number | boolean | null>;
    },
  ): Promise<void>;
  complete(job: WorkerJob, workerId: string, result: WorkerResult): Promise<void>;
  fail(
    job: WorkerJob,
    workerId: string,
    failure: {
      code: string;
      message: string;
      retryable: boolean;
      providerRunReference?: string | null;
      usage?: WorkerUsage;
      checks?: readonly CheckResult[];
      changedFiles?: readonly string[];
    },
  ): Promise<void>;
  cancel(job: WorkerJob, workerId: string, reason: string, usage?: WorkerUsage): Promise<void>;
}

export interface InstallationTokenProvider {
  createToken(job: WorkerJob, signal?: AbortSignal): Promise<{ token: string; expiresAt: string }>;
}
