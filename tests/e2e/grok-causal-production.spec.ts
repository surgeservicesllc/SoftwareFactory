import { Buffer } from "node:buffer";

import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

import {
  assertExactProductionOrigin,
  exactSha,
  exactUuid,
  grokCausalDetailSchema,
  grokCausalWakeEvidenceSchema,
  readStartEvidence,
  requiredEnvironment,
  sha256,
  writeEvidence,
} from "../support/grok-causal-production";

const createSchema = grokCausalDetailSchema.extend({
  workerWoken: z.literal(false),
  executionStarted: z.literal(false),
  execution: z.object({
    state: z.literal("paused"),
    bridge: z.string().min(1),
    message: z.string().min(1),
  }).strict(),
});

const controlSchema = grokCausalDetailSchema.extend({
  control: z.object({
    intentId: exactUuid,
    action: z.literal("resume"),
    state: z.literal("applied"),
    wakeIntentId: exactUuid,
    controlRevision: z.number().int().positive(),
  }).strict(),
  replayed: z.literal(false),
  dispatchAccepted: z.literal(true),
  workerAcknowledged: z.literal(false),
  workerWoken: z.literal(false),
  note: z.string().min(1),
});

function safeFailure(body: unknown): string {
  const parsed = z.object({
    error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
    sessionId: exactUuid.optional(),
  }).passthrough().safeParse(body);
  if (!parsed.success) return "The server returned an unrecognized bounded error.";
  const code = parsed.data.error?.code ?? "unknown_error";
  const message = parsed.data.error?.message ?? "No safe error message was returned.";
  return `${code}: ${message}`;
}

async function signIn(page: Page) {
  const email = requiredEnvironment("GROK_CAUSAL_E2E_EMAIL");
  const password = requiredEnvironment("GROK_CAUSAL_E2E_PASSWORD");
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/(solutions|decision)(\/|$)/, { timeout: 60_000 });
}

test.use({
  viewport: { width: 1440, height: 900 },
  trace: "off",
  screenshot: "off",
  video: "off",
});

test.describe("Grok two-phase causal production acceptance", () => {
  test.skip(
    process.env.GROK_CAUSAL_E2E !== "1",
    "manual causal production lane only (GROK_CAUSAL_E2E=1)",
  );
  test.describe.configure({ mode: "serial" });

  test("starts one exact docs-only run and waits for a durable worker receipt", async ({ page }) => {
    test.skip(process.env.GROK_CAUSAL_E2E_PHASE !== "start", "start phase only");
    test.setTimeout(480_000);

    assertExactProductionOrigin(requiredEnvironment("PLAYWRIGHT_BASE_URL"));
    const workflowRunId = requiredEnvironment("GROK_CAUSAL_E2E_WORKFLOW_RUN_ID");
    const releaseSha = exactSha.parse(requiredEnvironment("GROK_CAUSAL_E2E_RELEASE_SHA"));
    const projectId = exactUuid.parse(requiredEnvironment("GROK_CAUSAL_E2E_PROJECT_ID"));
    const projectName = requiredEnvironment("GROK_CAUSAL_E2E_PROJECT_NAME");
    const repository = requiredEnvironment("GROK_CAUSAL_E2E_REPOSITORY");
    const defaultBranch = requiredEnvironment("GROK_CAUSAL_E2E_DEFAULT_BRANCH");
    const suffix = `${workflowRunId}-${releaseSha.slice(0, 12)}`;
    const goal = `Create only docs/grok-causal-acceptance/${suffix}.md with a short harmless note that this is bounded Grok causal acceptance ${suffix}. Do not modify any existing file, code, workflow, migration, policy, auth, RLS, secret, automation, deployment, or configuration.`;
    const context = `Acceptance marker ${suffix}. The only permitted repository change is the new Markdown file named in the goal. No existing file may change.`;

    await signIn(page);
    let createPosts = 0;
    let resumePosts = 0;
    const unexpectedMutations: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== "https://www.theagoras.com" || !url.pathname.startsWith("/api/")) return;
      if (["GET", "HEAD", "OPTIONS"].includes(request.method())) return;
      if (request.method() === "POST" && url.pathname === "/api/grok/sessions") {
        createPosts += 1;
        return;
      }
      if (request.method() === "POST" && /\/api\/grok\/sessions\/[0-9a-f-]+\/control$/i.test(url.pathname)) {
        resumePosts += 1;
        return;
      }
      unexpectedMutations.push(`${request.method()} ${url.pathname}`);
    });

    await page.goto(`/solutions/factory/grok?projectId=${encodeURIComponent(projectId)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Grok Bot" })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[aria-label="Loading Grok Bot"]')).toHaveCount(0, { timeout: 60_000 });
    const project = page.getByLabel("Project");
    await expect(project.locator(`option[value="${projectId}"]`)).toHaveText(projectName);
    await project.selectOption(projectId);
    await page.getByRole("button", { name: "Start a new goal" }).click();
    await page.getByLabel("Attach a bounded text file").locator("input[type=file]").setInputFiles({
      name: `grok-causal-${suffix}.md`,
      mimeType: "text/markdown",
      buffer: Buffer.from(`${context}\n`, "utf8"),
    });

    const createResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/grok/sessions"
    ), { timeout: 120_000 });
    await page.getByLabel("Tell Grok Bot what you want done").fill(goal);
    await page.getByRole("button", { name: "Start goal" }).click();
    const createResponse = await createResponsePromise;
    const rawCreate: unknown = await createResponse.json();
    if (createResponse.status() !== 202) {
      throw new Error(`Grok causal creation was refused (${createResponse.status()}): ${safeFailure(rawCreate)}`);
    }
    const created = createSchema.parse(rawCreate);
    expect(created.session).toMatchObject({ projectId, projectName, goal, status: "paused" });
    expect(created.session.graphRunId).toBeNull();
    expect(created.runEvidence ?? null).toBeNull();
    expect(created.contextEnvelopes).toHaveLength(1);
    expect(created.contextEnvelopes[0]).toMatchObject({ itemCount: 3, replanRequired: false });
    expect(created.contextEnvelopes[0].items.some((item) => item.kind === "file" && item.state === "captured")).toBe(true);
    const eventTypes = new Set(created.events.map((event) => event.type));
    for (const event of ["roster.admitted", "session.planned", "graph.planned"]) expect(eventTypes).toContain(event);
    expect(created.tasks.length).toBeGreaterThan(0);

    const createdUrl = new URL(page.url());
    expect(createdUrl.origin).toBe("https://www.theagoras.com");
    expect(createdUrl.pathname).toBe("/solutions/factory/grok");
    expect(createdUrl.hash).toBe("");
    expect(createdUrl.searchParams.size).toBe(3);
    expect(createdUrl.searchParams.get("projectId")).toBe(projectId);
    expect(createdUrl.searchParams.get("sessionId")).toBe(created.session.id);
    expect(createdUrl.searchParams.get("graphId")).toBe(created.session.graphId);
    const returnPath = `${createdUrl.pathname}${createdUrl.search}`;

    const controlResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/grok/sessions/${created.session.id}/control`
    ), { timeout: 90_000 });
    await page.getByRole("button", { name: "resume session" }).click();
    const controlResponse = await controlResponsePromise;
    const rawControl: unknown = await controlResponse.json();
    if (controlResponse.status() !== 200) {
      throw new Error(`Grok causal resume was refused (${controlResponse.status()}): ${safeFailure(rawControl)}`);
    }
    const controlled = controlSchema.parse(rawControl);
    expect(controlled.replayed).toBe(false);
    expect(controlled.dispatchAccepted).toBe(true);
    expect(controlled.workerWoken).toBe(false);

    let acknowledgedWake: z.infer<typeof grokCausalWakeEvidenceSchema> | null = null;
    let wakeGraphRunId: string | null = null;
    await expect.poll(async () => {
      const response = await page.request.get(`/api/grok/sessions/${created.session.id}`);
      if (response.status() !== 200) return false;
      const detail = grokCausalDetailSchema.parse(await response.json());
      if (
        detail.session.graphRunId !== null
        &&
        detail.wakeEvidence?.wakeIntentId === controlled.control.wakeIntentId
        && detail.wakeEvidence.controlRevision === controlled.control.controlRevision
        && detail.wakeEvidence.dispatchAccepted
        && detail.wakeEvidence.workerAcknowledged
        && detail.wakeEvidence.workerWoken
      ) {
        acknowledgedWake = detail.wakeEvidence;
        wakeGraphRunId = exactUuid.parse(detail.session.graphRunId);
        return true;
      }
      return false;
    }, { timeout: 300_000, intervals: [2_000, 3_000, 5_000, 10_000] }).toBe(true);
    const wake = acknowledgedWake!;
    expect(wake.protocolVersion).toBe(1);
    expect(wake.capabilityVersion).toBe(1);
    expect(wake.workerId).toBeTruthy();
    expect(wake.dispatchRecordedAt).toBeTruthy();
    expect(wake.acknowledgedAt).toBeTruthy();

    expect(createPosts).toBe(1);
    expect(resumePosts).toBe(1);
    expect(unexpectedMutations).toEqual([]);
    writeEvidence(requiredEnvironment("GROK_CAUSAL_BROWSER_EVIDENCE_PATH"), {
      schemaVersion: 1,
      phase: "start-browser",
      workflowRunId,
      releaseSha,
      projectId,
      projectName,
      repository,
      defaultBranch,
      goalSha256: sha256(goal),
      contextSha256: created.contextEnvelopes[0].inputSha256,
      sessionId: created.session.id,
      graphId: created.session.graphId,
      wakeGraphRunId,
      wakeIntentId: controlled.control.wakeIntentId,
      controlRevision: controlled.control.controlRevision,
      workerId: wake.workerId,
      dispatchRecordedAt: wake.dispatchRecordedAt,
      acknowledgedAt: wake.acknowledgedAt,
      protocolVersion: wake.protocolVersion,
      capabilityVersion: wake.capabilityVersion,
      returnPath,
      recordedAt: new Date().toISOString(),
    });
  });

  test("finishes by reading the exact accepted session without a mutation", async ({ page }) => {
    test.skip(process.env.GROK_CAUSAL_E2E_PHASE !== "finish", "finish phase only");
    test.setTimeout(240_000);

    assertExactProductionOrigin(requiredEnvironment("PLAYWRIGHT_BASE_URL"));
    const releaseSha = exactSha.parse(requiredEnvironment("GROK_CAUSAL_E2E_RELEASE_SHA"));
    const terminalGraphRunId = exactUuid.parse(requiredEnvironment("GROK_CAUSAL_E2E_TERMINAL_GRAPH_RUN_ID"));
    const startEvidence = readStartEvidence(requiredEnvironment("GROK_CAUSAL_START_EVIDENCE_PATH"));
    expect(releaseSha).toBe(requiredEnvironment("GROK_CAUSAL_E2E_MERGE_SHA"));
    await signIn(page);
    const unexpectedMutations: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== "https://www.theagoras.com" || !url.pathname.startsWith("/api/")) return;
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        unexpectedMutations.push(`${request.method()} ${url.pathname}`);
      }
    });

    const responsePromise = page.waitForResponse((response) => (
      response.request().method() === "GET"
      && new URL(response.url()).pathname === `/api/grok/sessions/${startEvidence.sessionId}`
    ), { timeout: 60_000 });
    await page.goto(startEvidence.returnPath);
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const detail = grokCausalDetailSchema.parse(await response.json());
    expect(detail.session).toMatchObject({
      id: startEvidence.sessionId,
      projectId: startEvidence.projectId,
      graphId: startEvidence.graphId,
      graphRunId: terminalGraphRunId,
    });
    expect(detail.wakeEvidence).toMatchObject({
      wakeIntentId: startEvidence.wake.intentId,
      controlRevision: startEvidence.wake.controlRevision,
      dispatchAccepted: true,
      workerAcknowledged: true,
      workerWoken: true,
    });
    expect(detail.runEvidence?.state).toBe("COMPLETED");
    expect(detail.runEvidence?.phase1c).toMatchObject({
      bridgeId: startEvidence.phase1c.bridgeId,
      state: "VALIDATED",
      originGraphRunId: startEvidence.initialGraphRunId,
      commandId: startEvidence.phase1c.commandId,
      taskId: startEvidence.phase1c.taskId,
      agentRunId: startEvidence.phase1c.agentRunId,
      headSha: startEvidence.pullRequest.headSha,
      mergeCommitSha: releaseSha,
    });
    expect(detail.runEvidence?.phase1c?.deploymentId).toBeTruthy();
    expect(detail.runEvidence?.phase1c?.monitorObservationId).toBeTruthy();
    expect(detail.runEvidence?.phase1c?.deploymentValidationId).toBeTruthy();
    expect(detail.artifacts.length).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { level: 1, name: "Grok Bot" })).toBeVisible();
    const inspector = page.getByRole("complementary", { name: "Session inspector" });
    await inspector.getByRole("tab", { name: "Deployment" }).click();
    await expect(inspector.getByText("Production health")).toBeVisible();
    await expect(inspector.getByText("healthy", { exact: true })).toBeVisible();
    expect(unexpectedMutations).toEqual([]);

    writeEvidence(requiredEnvironment("GROK_CAUSAL_BROWSER_EVIDENCE_PATH"), {
      schemaVersion: 1,
      phase: "finish-browser",
      releaseSha,
      sessionId: startEvidence.sessionId,
      graphId: startEvidence.graphId,
      initialGraphRunId: startEvidence.initialGraphRunId,
      terminalGraphRunId,
      bridgeId: startEvidence.phase1c.bridgeId,
      deploymentId: detail.runEvidence?.phase1c?.deploymentId,
      monitorObservationId: detail.runEvidence?.phase1c?.monitorObservationId,
      deploymentValidationId: detail.runEvidence?.phase1c?.deploymentValidationId,
      unexpectedMutations: unexpectedMutations.length,
      verifiedAt: new Date().toISOString(),
    });
  });
});
