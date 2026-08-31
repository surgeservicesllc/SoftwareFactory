import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { expect, test } from "@playwright/test";
import { z } from "zod";

/**
 * Production acceptance for the Grok record-only boundary.
 *
 * This test creates one durable plan and deliberately stops there. It never
 * invokes a session control, worker, provider, merge, or deployment endpoint.
 * The paired manual workflow independently reads the immutable Supabase rows
 * after this browser pass and proves the planner-v3 roster/route plus the
 * absence of graph, node, agent, and provider execution.
 */

const PRODUCTION_ORIGIN = "https://www.theagoras.com";
const FAKE_JOURNEY_ACCOUNT = "jordan.seeker.prod1@example.org";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GOAL = /^Build a harmless documentation-only record-only acceptance plan for run [0-9]+ at commit [0-9a-f]{12}\. Planning only; leave the repository unchanged\.$/;

const sessionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  projectName: z.string().min(1).max(160),
  goal: z.string().min(1).max(4_000),
  status: z.string().min(1),
  graphId: z.string().uuid(),
  graphRunId: z.null(),
  allowedActions: z.array(z.string()),
}).passthrough();

const detailSchema = z.object({
  session: sessionSchema,
  messages: z.array(z.object({
    id: z.string().uuid(),
    role: z.enum(["user", "assistant", "system", "tool"]),
    content: z.string(),
  }).passthrough()).min(2),
  tasks: z.array(z.object({
    id: z.string().uuid(),
    taskKey: z.string().min(1),
    title: z.string().min(1),
    status: z.string().min(1),
    dependsOn: z.array(z.string()),
  }).passthrough()).min(1),
  events: z.array(z.object({
    id: z.string().uuid(),
    type: z.string().min(1),
    detail: z.string().min(1),
  }).passthrough()).min(1),
  artifacts: z.array(z.unknown()),
  runEvidence: z.null().optional(),
}).passthrough();

const createSchema = detailSchema.extend({
  workerWoken: z.literal(false),
  executionStarted: z.literal(false),
  execution: z.object({
    state: z.string().min(1),
    bridge: z.literal("full_lifecycle_v3"),
    message: z.string().min(1),
  }).strict(),
});

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the guarded production acceptance.`);
  return value;
}

function safeFailure(body: unknown): string {
  const parsed = z.object({
    error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
    sessionId: z.string().uuid().optional(),
  }).passthrough().safeParse(body);
  if (!parsed.success) return "The server returned an unrecognized bounded error.";
  const code = parsed.data.error?.code ?? "unknown_error";
  const message = parsed.data.error?.message ?? "No safe error message was returned.";
  const session = parsed.data.sessionId ? ` Durable blocked session: ${parsed.data.sessionId}.` : "";
  return `${code}: ${message}${session}`;
}

function writeEvidence(input: Readonly<{
  sessionId: string;
  graphId: string;
  projectId: string;
  goal: string;
  releaseSha: string;
  returnPath: string;
}>) {
  const requested = required("GROK_RECORD_ONLY_EVIDENCE_PATH");
  const testResultsRoot = resolve(process.cwd(), "test-results");
  const output = resolve(process.cwd(), requested);
  const rel = relative(testResultsRoot, output);
  if (rel === "" || rel === "." || rel.startsWith(`..${sep}`) || rel === ".." || resolve(output) === testResultsRoot) {
    throw new Error("GROK_RECORD_ONLY_EVIDENCE_PATH must name a file beneath test-results/.");
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({
    schemaVersion: 1,
    account: FAKE_JOURNEY_ACCOUNT,
    ...input,
    workerWoken: false,
    executionStarted: false,
    recordedAt: new Date().toISOString(),
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

test.use({
  viewport: { width: 1440, height: 900 },
  trace: "off",
  screenshot: "off",
  video: "off",
});

test.describe("Grok record-only production acceptance", () => {
  test.skip(
    process.env.GROK_RECORD_ONLY_E2E !== "1",
    "manual production lane only (GROK_RECORD_ONLY_E2E=1)",
  );
  test.describe.configure({ mode: "serial" });

  test("creates, returns to, and reloads one durable plan without execution", async ({ page }) => {
    test.setTimeout(180_000);

    const target = new URL(required("PLAYWRIGHT_BASE_URL"));
    if (target.origin !== PRODUCTION_ORIGIN || target.pathname !== "/" || target.search || target.hash) {
      throw new Error(`PLAYWRIGHT_BASE_URL must be exactly ${PRODUCTION_ORIGIN}.`);
    }
    const password = required("GROK_RECORD_ONLY_E2E_PASSWORD");
    const projectId = required("GROK_RECORD_ONLY_E2E_PROJECT_ID");
    const projectName = required("GROK_RECORD_ONLY_E2E_PROJECT_NAME");
    const goal = required("GROK_RECORD_ONLY_E2E_GOAL");
    const releaseSha = required("GROK_RECORD_ONLY_E2E_RELEASE_SHA");
    if (!UUID.test(projectId)) throw new Error("GROK_RECORD_ONLY_E2E_PROJECT_ID must be one exact UUID.");
    if (projectName.length > 160) throw new Error("GROK_RECORD_ONLY_E2E_PROJECT_NAME is outside the product bound.");
    if (!GOAL.test(goal)) throw new Error("GROK_RECORD_ONLY_E2E_GOAL is not the fixed harmless BUILD-goal shape.");
    if (!/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error("GROK_RECORD_ONLY_E2E_RELEASE_SHA must be an exact lowercase SHA.");

    await page.goto("/auth/sign-in");
    await page.getByLabel("Email").fill(FAKE_JOURNEY_ACCOUNT);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL(/\/(solutions|decision)(\/|$)/, { timeout: 60_000 });

    let createPosts = 0;
    const unexpectedMutations: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== PRODUCTION_ORIGIN || !url.pathname.startsWith("/api/")) return;
      if (["GET", "HEAD", "OPTIONS"].includes(request.method())) return;
      if (request.method() === "POST" && url.pathname === "/api/grok/sessions") {
        createPosts += 1;
        return;
      }
      unexpectedMutations.push(`${request.method()} ${url.pathname}`);
    });

    await page.goto(`/solutions/factory/grok?projectId=${encodeURIComponent(projectId)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Grok Bot" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[aria-label="Loading Grok Bot"]')).toHaveCount(0, {
      timeout: 60_000,
    });

    const project = page.getByLabel("Project");
    const exactOption = project.locator(`option[value="${projectId}"]`);
    await expect(exactOption, "the named fake account must own the exact configured project")
      .toHaveText(projectName);
    await project.selectOption({ value: projectId });
    await expect(project).toHaveValue(projectId);
    await expect(project.locator("option:checked")).toHaveText(projectName);

    await page.getByRole("button", { name: "Start a new goal" }).click();
    const createResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "POST" && url.pathname === "/api/grok/sessions";
    }, { timeout: 90_000 });
    await page.getByLabel("Tell Grok Bot what you want done").fill(goal);
    await page.getByRole("button", { name: "Start goal" }).click();

    const createResponse = await createResponsePromise;
    const rawCreate: unknown = await createResponse.json();
    if (createResponse.status() !== 202) {
      throw new Error(`Grok record-only creation was refused (${createResponse.status()}): ${safeFailure(rawCreate)}`);
    }
    const created = createSchema.parse(rawCreate);
    expect(created.session).toMatchObject({
      projectId,
      projectName,
      goal,
      status: "paused",
      graphRunId: null,
    });
    expect(created.runEvidence ?? null).toBeNull();
    expect(created.execution.state).toBe("paused");
    expect(created.execution.message).toMatch(/did not dispatch a worker/i);
    expect(created.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(created.messages.find((message) => message.role === "user")?.content).toBe(goal);
    expect(created.messages.find((message) => message.role === "assistant")?.content)
      .toMatch(/^I recorded a deterministic build plan with \d+ tasks across \d+ dependency-safe layers\. Execution has not started\.$/);
    expect(created.tasks.length).toBeGreaterThan(0);
    expect(new Set(created.tasks.map((task) => task.taskKey)).size).toBe(created.tasks.length);
    expect(created.tasks.every((task) => task.status === "planned")).toBe(true);
    const eventTypes = new Set(created.events.map((event) => event.type));
    for (const requiredEvent of ["roster.admitted", "session.planned", "graph.planned"]) {
      expect(eventTypes, `missing durable ${requiredEvent} evidence`).toContain(requiredEvent);
    }
    expect(created.events.find((event) => event.type === "roster.admitted")?.detail)
      .toMatch(/specialist roster was admitted without starting execution/i);
    expect(created.events.find((event) => event.type === "graph.planned")?.detail)
      .toMatch(/recorded and paused before execution/i);

    const createdUrl = new URL(page.url());
    expect(createdUrl.origin).toBe(PRODUCTION_ORIGIN);
    expect(createdUrl.pathname).toBe("/solutions/factory/grok");
    expect([...createdUrl.searchParams.keys()].sort()).toEqual(["graphId", "projectId", "sessionId"]);
    expect(createdUrl.searchParams.get("projectId")).toBe(projectId);
    expect(createdUrl.searchParams.get("sessionId")).toBe(created.session.id);
    expect(createdUrl.searchParams.get("graphId")).toBe(created.session.graphId);
    expect(createdUrl.searchParams.has("graphRunId")).toBe(false);
    const returnPath = `${createdUrl.pathname}${createdUrl.search}`;

    await page.goto("/solutions/factory/grok");
    await page.goto(returnPath);
    const reloadResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET"
        && url.pathname === `/api/grok/sessions/${created.session.id}`;
    }, { timeout: 60_000 });
    await page.reload();
    const reloadResponse = await reloadResponsePromise;
    expect(reloadResponse.status()).toBe(200);
    const reloaded = detailSchema.parse(await reloadResponse.json());
    expect(reloaded.session).toEqual(created.session);
    expect(reloaded.messages).toEqual(created.messages);
    expect(reloaded.tasks).toEqual(created.tasks);
    expect(reloaded.runEvidence ?? null).toBeNull();
    expect(new Set(reloaded.events.map((event) => event.type))).toEqual(eventTypes);

    const conversation = page.getByRole("log", { name: "Recorded session messages" });
    await expect(conversation.getByRole("article", { name: "You message" })).toContainText(goal);
    await expect(conversation.getByRole("article", { name: "Chief of Staff message" }))
      .toContainText("Execution has not started.");
    await expect(page.getByText("Durable session · graph recorded; no run evidence yet")).toBeVisible();
    const inspector = page.getByRole("complementary", { name: "Session inspector" });
    await inspector.getByRole("tab", { name: "Plan" }).click();
    await expect.poll(() => inspector.getByRole("listitem").count()).toBe(created.tasks.length);
    await inspector.getByRole("tab", { name: "Progress" }).click();
    await expect(inspector.getByText("roster.admitted", { exact: true })).toBeVisible();
    await expect(inspector.getByText("graph.planned", { exact: true })).toBeVisible();

    expect(createPosts).toBe(1);
    expect(unexpectedMutations).toEqual([]);
    writeEvidence({
      sessionId: created.session.id,
      graphId: created.session.graphId,
      projectId,
      goal,
      releaseSha,
      returnPath,
    });
  });
});
