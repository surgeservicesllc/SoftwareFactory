import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { z } from "zod";

export const GROK_CAUSAL_PRODUCTION_ORIGIN = "https://www.theagoras.com";
export const GROK_CAUSAL_SUPABASE_PROJECT = "qpuofpmagrmyamahqwxw";
export const GROK_CAUSAL_START_CONFIRM = "start-causal-grok-docs-pr";
export const GROK_CAUSAL_FINISH_CONFIRM = "finish-causal-grok-release";
export const GROK_CAUSAL_REQUIRED_CHECKS = Object.freeze([
  "Lint, typecheck, test, and build",
  "Browser and accessibility tests 1/3",
  "Browser and accessibility tests 2/3",
  "Browser and accessibility tests 3/3",
] as const);

export const exactUuid = z.string().uuid();
export const exactSha = z.string().regex(/^[0-9a-f]{40}$/);
export const exactSha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const grokCausalWakeEvidenceSchema = z.object({
  wakeIntentId: exactUuid,
  controlRevision: z.number().int().positive(),
  dispatchAccepted: z.boolean(),
  dispatchRecordedAt: z.string().datetime({ offset: true }).nullable(),
  workerAcknowledged: z.boolean(),
  workerWoken: z.boolean(),
  acknowledgedAt: z.string().datetime({ offset: true }).nullable(),
  workerId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/).nullable(),
  protocolVersion: z.number().int().positive().nullable(),
  capabilityVersion: z.number().int().positive().nullable(),
}).strict();

export const grokCausalSessionSchema = z.object({
  id: exactUuid,
  projectId: exactUuid,
  projectName: z.string().min(1).max(160),
  goal: z.string().min(1).max(4_000),
  status: z.string().min(1),
  graphId: exactUuid,
  graphRunId: exactUuid.nullable(),
  allowedActions: z.array(z.string()),
}).passthrough();

export const grokCausalDetailSchema = z.object({
  session: grokCausalSessionSchema,
  messages: z.array(z.object({
    id: exactUuid,
    role: z.enum(["user", "assistant", "system", "tool"]),
    content: z.string(),
  }).passthrough()).min(2),
  contextEnvelopes: z.array(z.object({
    id: exactUuid,
    messageId: exactUuid,
    itemCount: z.number().int().positive(),
    totalBytes: z.number().int().positive(),
    inputSha256: exactSha256,
    replanRequired: z.boolean(),
    items: z.array(z.object({
      id: exactUuid,
      kind: z.string(),
      label: z.string(),
      state: z.string(),
      byteSize: z.number().int().nonnegative(),
    }).passthrough()).min(1),
  }).passthrough()).min(1),
  tasks: z.array(z.object({
    id: exactUuid,
    taskKey: z.string().min(1),
    title: z.string().min(1),
    status: z.string().min(1),
    provider: z.enum(["anthropic", "openai"]).nullable().optional(),
    model: z.string().nullable().optional(),
  }).passthrough()).min(1),
  events: z.array(z.object({
    id: exactUuid,
    type: z.string().min(1),
    detail: z.string().min(1),
  }).passthrough()).min(1),
  artifacts: z.array(z.unknown()),
  runEvidence: z.object({
    state: z.string().min(1),
    progress: z.object({ completed: z.number(), total: z.number(), percent: z.number() }),
    events: z.array(z.unknown()),
    phase1c: z.object({
      bridgeId: exactUuid,
      state: z.string().min(1),
      originGraphRunId: exactUuid,
      commandId: exactUuid.nullable(),
      taskId: exactUuid.nullable(),
      agentRunId: exactUuid.nullable(),
      headSha: exactSha.nullable(),
      pullRequestId: exactUuid.nullable(),
      mergeCommitSha: exactSha.nullable(),
      deploymentId: exactUuid.nullable(),
      monitorObservationId: exactUuid.nullable(),
      deploymentValidationId: exactUuid.nullable(),
    }).passthrough().nullable(),
  }).passthrough().nullable().optional(),
  wakeEvidence: grokCausalWakeEvidenceSchema.nullable().optional(),
}).passthrough();

const checkEvidenceSchema = z.object({
  id: z.number().int().positive(),
  name: z.enum(GROK_CAUSAL_REQUIRED_CHECKS),
  conclusion: z.literal("success"),
  url: z.string().url().max(1_000),
}).strict();

export const grokCausalStartEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  phase: z.literal("start"),
  workflowRunId: z.string().regex(/^[1-9][0-9]*$/),
  releaseSha: exactSha,
  productionOrigin: z.literal(GROK_CAUSAL_PRODUCTION_ORIGIN),
  supabaseProjectRef: z.literal(GROK_CAUSAL_SUPABASE_PROJECT),
  projectId: exactUuid,
  projectName: z.string().min(1).max(160),
  repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/),
  defaultBranch: z.string().min(1).max(255),
  goalSha256: exactSha256,
  contextSha256: exactSha256,
  sessionId: exactUuid,
  graphId: exactUuid,
  returnPath: z.string().startsWith("/solutions/factory/grok?").max(1_000),
  initialGraphRunId: exactUuid,
  draftGraphRunId: exactUuid,
  graphRunIds: z.array(exactUuid).min(2).max(10),
  wake: z.object({
    intentId: exactUuid,
    controlRevision: z.number().int().positive(),
    dispatchAttemptId: exactUuid,
    receiptId: exactUuid,
    workerId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/),
    dispatchRecordedAt: z.string().datetime({ offset: true }),
    acknowledgedAt: z.string().datetime({ offset: true }),
    protocolVersion: z.literal(1),
    capabilityVersion: z.literal(1),
  }).strict(),
  claude: z.object({
    completedNodeRunIds: z.array(exactUuid).min(1).max(32),
  }).strict(),
  phase1c: z.object({
    bridgeId: exactUuid,
    commandId: exactUuid,
    taskId: exactUuid,
    agentRunId: exactUuid,
  }).strict(),
  pullRequest: z.object({
    id: exactUuid,
    number: z.number().int().positive(),
    url: z.string().url().max(1_000),
    headBranch: z.string().min(1).max(255),
    baseBranch: z.string().min(1).max(255),
    headSha: exactSha,
  }).strict(),
  checks: z.array(checkEvidenceSchema).length(GROK_CAUSAL_REQUIRED_CHECKS.length),
  recordedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  const names = value.checks.map((check) => check.name).sort();
  const required = [...GROK_CAUSAL_REQUIRED_CHECKS].sort();
  if (JSON.stringify(names) !== JSON.stringify(required)) {
    context.addIssue({ code: "custom", message: "The start evidence must contain each exact required check once." });
  }
  if (
    new Set(value.graphRunIds).size !== value.graphRunIds.length
    || value.graphRunIds[0] !== value.initialGraphRunId
    || value.graphRunIds.at(-1) !== value.draftGraphRunId
  ) {
    context.addIssue({ code: "custom", message: "The ordered start graph-run chain is invalid." });
  }
  const returnUrl = new URL(value.returnPath, GROK_CAUSAL_PRODUCTION_ORIGIN);
  if (
    returnUrl.origin !== GROK_CAUSAL_PRODUCTION_ORIGIN
    || returnUrl.pathname !== "/solutions/factory/grok"
    || returnUrl.hash
    || returnUrl.searchParams.size !== 3
    || returnUrl.searchParams.get("projectId") !== value.projectId
    || returnUrl.searchParams.get("sessionId") !== value.sessionId
    || returnUrl.searchParams.get("graphId") !== value.graphId
  ) {
    context.addIssue({ code: "custom", message: "The start return path does not name its exact session." });
  }
  const pullUrl = new URL(value.pullRequest.url);
  if (
    pullUrl.origin !== "https://github.com"
    || pullUrl.username || pullUrl.password || pullUrl.search || pullUrl.hash
    || pullUrl.pathname !== `/${value.repository}/pull/${value.pullRequest.number}`
  ) {
    context.addIssue({ code: "custom", message: "The start pull-request URL is not exact." });
  }
  for (const check of value.checks) {
    const checkUrl = new URL(check.url);
    if (
      checkUrl.origin !== "https://github.com"
      || checkUrl.username || checkUrl.password || checkUrl.search || checkUrl.hash
      || !checkUrl.pathname.startsWith(`/${value.repository}/actions/runs/`)
    ) {
      context.addIssue({ code: "custom", message: "A start check URL is not bounded to the exact repository." });
    }
  }
});

export type GrokCausalStartEvidence = z.infer<typeof grokCausalStartEvidenceSchema>;

export const grokCausalFinishEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  phase: z.literal("finish"),
  workflowRunId: z.string().regex(/^[1-9][0-9]*$/),
  startWorkflowRunId: z.string().regex(/^[1-9][0-9]*$/),
  startEvidenceSha256: exactSha256,
  startReleaseSha: exactSha,
  releaseSha: exactSha,
  productionOrigin: z.literal(GROK_CAUSAL_PRODUCTION_ORIGIN),
  supabaseProjectRef: z.literal(GROK_CAUSAL_SUPABASE_PROJECT),
  projectId: exactUuid,
  repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/),
  defaultBranch: z.string().min(1).max(255),
  sessionId: exactUuid,
  graphId: exactUuid,
  initialGraphRunId: exactUuid,
  draftGraphRunId: exactUuid,
  terminalGraphRunId: exactUuid,
  graphRunIds: z.array(exactUuid).min(2).max(10),
  wakeReceiptId: exactUuid,
  bridgeId: exactUuid,
  agentRunId: exactUuid,
  pullRequest: z.object({
    id: exactUuid,
    number: z.number().int().positive(),
    headSha: exactSha,
    mergeCommitSha: exactSha,
  }).strict(),
  deployment: z.object({
    id: exactUuid,
    externalId: z.number().int().positive(),
    url: z.string().regex(
      /^https:\/\/softwarefactory-[a-z0-9]+-surgeservices-projects\.vercel\.app\/?$/,
    ),
    monitorObservationId: exactUuid,
    validationId: exactUuid,
    terminalArtifactId: exactUuid,
  }).strict(),
  checks: z.array(checkEvidenceSchema).length(GROK_CAUSAL_REQUIRED_CHECKS.length),
  recordedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.releaseSha === value.startReleaseSha) {
    context.addIssue({ code: "custom", message: "The release SHA must advance beyond the start SHA." });
  }
  const names = value.checks.map((check) => check.name).sort();
  const required = [...GROK_CAUSAL_REQUIRED_CHECKS].sort();
  if (JSON.stringify(names) !== JSON.stringify(required)) {
    context.addIssue({ code: "custom", message: "The finish evidence must contain each exact required check once." });
  }
  if (
    new Set(value.graphRunIds).size !== value.graphRunIds.length
    || value.graphRunIds[0] !== value.initialGraphRunId
    || !value.graphRunIds.includes(value.draftGraphRunId)
    || value.graphRunIds.at(-1) !== value.terminalGraphRunId
  ) {
    context.addIssue({ code: "custom", message: "The ordered terminal graph-run chain is invalid." });
  }
  for (const check of value.checks) {
    const checkUrl = new URL(check.url);
    if (
      checkUrl.origin !== "https://github.com"
      || checkUrl.username || checkUrl.password || checkUrl.search || checkUrl.hash
      || !checkUrl.pathname.startsWith(`/${value.repository}/actions/runs/`)
    ) {
      context.addIssue({ code: "custom", message: "A finish check URL is not bounded to the exact repository." });
    }
  }
});

export type GrokCausalFinishEvidence = z.infer<typeof grokCausalFinishEvidenceSchema>;

export function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the guarded causal production acceptance.`);
  return value;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function assertExactProductionOrigin(value: string): void {
  const target = new URL(value);
  if (
    target.origin !== GROK_CAUSAL_PRODUCTION_ORIGIN
    || target.pathname !== "/"
    || target.search
    || target.hash
  ) throw new Error(`PLAYWRIGHT_BASE_URL must be exactly ${GROK_CAUSAL_PRODUCTION_ORIGIN}.`);
}

export function readStartEvidence(path: string): GrokCausalStartEvidence {
  return grokCausalStartEvidenceSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeEvidence(path: string, value: unknown): void {
  const testResultsRoot = resolve(process.cwd(), "test-results");
  const output = resolve(process.cwd(), path);
  const rel = relative(testResultsRoot, output);
  if (
    rel === ""
    || rel === "."
    || rel === ".."
    || rel.startsWith(`..${sep}`)
    || output === testResultsRoot
  ) throw new Error("The evidence path must name one file beneath test-results/.");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
