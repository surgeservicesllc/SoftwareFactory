import "server-only";

import { z } from "zod";

import { githubWebUrlSchema } from "@/lib/github/schemas";

const MAX_DETAIL_ITEMS = 200;

const idSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable();
const nameSchema = z.string().min(1).max(240);
const summarySchema = z.string().max(4_000);
const nullableSummarySchema = summarySchema.nullable();
const branchSchema = z.string().min(1).max(255);
const shaSchema = z.string().regex(/^[0-9a-f]{40}$/i);
const riskSchema = z.enum(["green", "yellow", "red"]);
const runStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
const taskStatusSchema = z.enum([
  "backlog",
  "awaiting_approval",
  "queued",
  "in_progress",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);
const agentStatusSchema = z.enum(["inactive", "idle", "busy", "paused", "error"]);
const agentRoleSchema = z.enum([
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
const reportTypeSchema = z.enum(["daily_ceo", "security", "quality", "release", "incident", "custom"]);
const reportStatusSchema = z.enum(["draft", "published", "archived"]);
const pullRequestStatusSchema = z.enum(["draft", "open", "approved", "merged", "closed"]);
const githubUrlSchema = z.string().max(2_000).pipe(githubWebUrlSchema);

type BoundedJson = string | number | boolean | null | BoundedJson[] | { [key: string]: BoundedJson };

const boundedJsonKeySchema = z.string().min(1).max(120);
const boundedJsonValueSchema: z.ZodType<BoundedJson> = z.lazy(() => z.union([
  z.string().max(4_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(boundedJsonValueSchema).max(MAX_DETAIL_ITEMS),
  z.record(boundedJsonKeySchema, boundedJsonValueSchema).superRefine((value, context) => {
    if (Object.keys(value).length > 100) {
      context.addIssue({ code: "custom", message: "Detail object exceeds the field limit." });
    }
  }),
]));

const boundedJsonObjectSchema = z.record(boundedJsonKeySchema, boundedJsonValueSchema)
  .superRefine((value, context) => {
    if (Object.keys(value).length > 100) {
      context.addIssue({ code: "custom", message: "Detail object exceeds the field limit." });
    }
  });

const projectReferenceSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(160),
}).strict();

const agentReferenceSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
}).strict();

const taskReferenceSchema = z.object({
  id: idSchema,
  title: nameSchema,
}).strict();

const pullRequestReferenceSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1).max(300),
  url: githubUrlSchema,
  status: pullRequestStatusSchema,
  draft: z.boolean(),
}).strict();

const runCheckSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(300),
  status: z.string().min(1).max(40),
  conclusion: z.string().max(80).nullable(),
  url: githubUrlSchema.nullable(),
}).strict();

const runChecksSchema = z.array(runCheckSchema).max(MAX_DETAIL_ITEMS);

export const runDetailSchema = z.object({
  id: idSchema,
  status: runStatusSchema,
  project: projectReferenceSchema,
  task: taskReferenceSchema,
  command: z.object({
    id: idSchema,
    prompt: z.string().min(1).max(4_000),
  }).strict(),
  agent: agentReferenceSchema.extend({ role: agentRoleSchema }).strict(),
  provider: z.string().min(1).max(80).nullable(),
  model: z.string().min(1).max(120).nullable(),
  risk: riskSchema,
  providerRunReference: z.string().min(1).max(2_000).nullable(),
  baseBranch: branchSchema.nullable(),
  baseSha: shaSchema.nullable(),
  headBranch: branchSchema.nullable(),
  headSha: shaSchema.nullable(),
  attempt: z.number().int().min(0).max(10),
  maxAttempts: z.number().int().min(1).max(3),
  startedAt: nullableTimestampSchema,
  completedAt: nullableTimestampSchema,
  createdAt: timestampSchema,
  durationMs: z.number().int().min(0).max(604_800_000).nullable(),
  cancellationRequestedAt: nullableTimestampSchema,
  cancellable: z.boolean(),
  retryable: z.boolean(),
  summary: nullableSummarySchema,
  blocker: z.string().min(1).max(1_000).nullable(),
  errorMessage: z.string().max(1_000).nullable(),
  timeline: z.array(z.object({
    id: idSchema,
    stage: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    message: z.string().min(1).max(1_000),
    details: boundedJsonObjectSchema,
    occurredAt: timestampSchema,
  }).strict()).max(MAX_DETAIL_ITEMS),
  changedFiles: z.array(z.string().min(1).max(1_024)).max(MAX_DETAIL_ITEMS),
  files: z.array(z.object({
    path: z.string().min(1).max(2_000),
    status: z.string().max(80).nullable(),
    additions: z.string().regex(/^\d{1,10}$/).nullable(),
    deletions: z.string().regex(/^\d{1,10}$/).nullable(),
  }).strict()).max(MAX_DETAIL_ITEMS),
  commits: z.array(z.object({
    sha: shaSchema,
    message: z.string().max(1_000).nullable(),
    url: githubUrlSchema.nullable(),
  }).strict()).max(MAX_DETAIL_ITEMS),
  validations: z.array(z.object({
    id: idSchema,
    round: z.number().int().min(0).max(3),
    name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/),
    command: z.string().min(1).max(500),
    status: z.enum(["passed", "failed", "skipped"]),
    summary: z.string().max(4_000),
    durationMs: z.number().int().min(0).max(3_600_000),
    createdAt: timestampSchema,
  }).strict()).max(MAX_DETAIL_ITEMS),
  pullRequest: z.object({
    number: z.number().int().positive(),
    title: z.string().min(1).max(300),
    state: pullRequestStatusSchema,
    draft: z.boolean(),
    url: githubUrlSchema,
  }).strict().nullable(),
  checks: runChecksSchema,
  ci: z.object({ checks: runChecksSchema }).strict(),
}).strict();

const taskDependencySchema = z.object({
  id: idSchema,
  title: nameSchema,
  status: taskStatusSchema,
}).strict();

export const taskDetailSchema = z.object({
  id: idSchema,
  title: nameSchema,
  description: z.string().max(12_000).nullable(),
  status: taskStatusSchema,
  risk: riskSchema,
  requiresOwnerApproval: z.boolean(),
  priority: z.number().int().min(0).max(100),
  createdAt: timestampSchema,
  project: projectReferenceSchema,
  agent: agentReferenceSchema.nullable(),
  command: z.object({
    id: idSchema,
    prompt: z.string().min(1).max(4_000),
  }).strict().nullable(),
  acceptanceCriteria: z.array(z.string().min(1).max(1_000)).max(MAX_DETAIL_ITEMS),
  blocker: z.string().min(1).max(1_000).nullable(),
  resultSummary: nullableSummarySchema,
  dependencies: z.array(taskDependencySchema).max(MAX_DETAIL_ITEMS),
  dependents: z.array(taskDependencySchema).max(MAX_DETAIL_ITEMS),
  runs: z.array(z.object({
    id: idSchema,
    status: runStatusSchema,
    createdAt: timestampSchema,
    branch: branchSchema.nullable(),
    agent: agentReferenceSchema,
    pullRequest: z.object({
      number: z.number().int().positive(),
      url: githubUrlSchema,
      status: pullRequestStatusSchema,
      draft: z.boolean(),
    }).strict().nullable(),
  }).strict()).max(MAX_DETAIL_ITEMS),
  pullRequests: z.array(pullRequestReferenceSchema).max(MAX_DETAIL_ITEMS),
}).strict();

const agentRunReferenceSchema = z.object({
  id: idSchema,
  title: nameSchema,
  status: runStatusSchema,
}).strict();

export const agentDetailSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
  role: agentRoleSchema,
  description: z.string().max(1_000).nullable(),
  status: agentStatusSchema,
  provider: z.string().min(1).max(80).nullable(),
  model: z.string().min(1).max(120).nullable(),
  lastRunAt: nullableTimestampSchema,
  currentAssignment: z.string().max(4_000).nullable(),
  providerConnectionStatus: z.enum(["connected", "not_connected"]).nullable(),
  project: projectReferenceSchema.nullable(),
  capabilities: z.array(z.string().min(1).max(240)).max(MAX_DETAIL_ITEMS),
  responsibilities: z.array(z.string().min(1).max(240)).max(MAX_DETAIL_ITEMS),
  currentRuns: z.array(agentRunReferenceSchema.extend({
    project: projectReferenceSchema,
  }).strict()).max(MAX_DETAIL_ITEMS),
  recentRuns: z.array(agentRunReferenceSchema.extend({
    startedAt: nullableTimestampSchema,
    completedAt: nullableTimestampSchema,
  }).strict()).max(20),
  runCounts: z.object({
    queued: z.number().int().nonnegative().max(1_000_000),
    running: z.number().int().nonnegative().max(1_000_000),
    succeeded: z.number().int().nonnegative().max(1_000_000),
    failed: z.number().int().nonnegative().max(1_000_000),
  }).strict(),
}).strict();

const reportSectionSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  title: nameSchema,
  body: z.string().max(12_000).nullable().optional(),
  items: z.array(z.string().min(1).max(1_000)).max(MAX_DETAIL_ITEMS).optional(),
}).strict();

const reportFindingSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  title: nameSchema,
  summary: summarySchema.nullable().optional(),
  severity: z.string().min(1).max(80).nullable().optional(),
  status: z.string().min(1).max(80).nullable().optional(),
}).strict();

const reportDecisionSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  title: nameSchema,
  status: z.string().min(1).max(80).nullable().optional(),
  ownerAction: z.string().max(4_000).nullable().optional(),
}).strict();

const reportValidationSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/),
  status: z.enum(["passed", "failed", "skipped"]),
  durationMs: z.number().int().min(0).max(3_600_000),
  attempt: z.number().int().min(1).max(10),
  round: z.number().int().min(0).max(3),
}).strict();

const reportSecuritySchema = z.object({
  risk: riskSchema,
  errorCode: z.string().min(1).max(120).nullable(),
  blocker: z.string().min(1).max(1_000).nullable(),
}).strict();

export const reportDetailSchema = z.object({
  id: idSchema,
  type: reportTypeSchema,
  status: reportStatusSchema,
  title: nameSchema,
  summary: z.string().max(1_000).nullable(),
  periodStart: nullableTimestampSchema,
  periodEnd: nullableTimestampSchema,
  publishedAt: nullableTimestampSchema,
  createdAt: timestampSchema,
  evidenceGeneratedAt: timestampSchema,
  project: projectReferenceSchema.nullable(),
  generatedBy: agentReferenceSchema.nullable(),
  sections: z.array(reportSectionSchema).max(MAX_DETAIL_ITEMS),
  findings: z.array(reportFindingSchema).max(MAX_DETAIL_ITEMS),
  decisions: z.array(reportDecisionSchema).max(MAX_DETAIL_ITEMS),
  runs: z.array(agentRunReferenceSchema).max(MAX_DETAIL_ITEMS),
  pullRequests: z.array(pullRequestReferenceSchema).max(MAX_DETAIL_ITEMS),
  changedFiles: z.array(z.string().min(1).max(1_024)).max(100),
  checks: z.array(runCheckSchema).max(100),
  validations: z.array(reportValidationSchema).max(100),
  security: reportSecuritySchema.nullable(),
}).strict();

export type RunDetail = z.infer<typeof runDetailSchema>;
export type TaskDetail = z.infer<typeof taskDetailSchema>;
export type AgentDetail = z.infer<typeof agentDetailSchema>;
export type ReportDetail = z.infer<typeof reportDetailSchema>;
