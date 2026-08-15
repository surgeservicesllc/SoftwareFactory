/**
 * Phase 2A goals 18 and 19, live: a typed handoff from Claude to Codex, then an
 * independent review by a *fresh* Claude that never saw either.
 *
 * Both goals were scored BLOCKED_BY_1C while no Codex worker existed. One does
 * now, and both subscription credentials exist as GitHub Actions secrets, so
 * this runs there rather than locally — which is also the only place the
 * credential path itself gets exercised.
 *
 * ## The chain
 *
 *   1. **Claude plans.** Produces a typed artifact against a declared schema.
 *      Prose where structure was required is a failure, not a warning.
 *   2. **Typed handoff.** The artifact is validated *before* Codex sees it. A
 *      handoff that only validates on receipt has already done the work of
 *      passing bad input downstream.
 *   3. **Codex implements** from the artifact alone, in a scratch directory.
 *   4. **A fresh Claude reviews** the resulting diff. New session, no history,
 *      no tools, and it is handed the diff and the acceptance criteria and
 *      nothing else.
 *
 * ## Why the reviewer cannot be the implementer
 *
 * Not by policy — by construction. Each `query()` is a new session, the reviewer
 * gets no tools so it cannot go and read the repository to reconstruct context,
 * and the only text it receives is the diff plus criteria. This script asserts
 * that neither the planner's prompt nor the plan artifact appears in what the
 * reviewer was given, so the isolation is checked rather than described.
 *
 * ## Zero tokens
 *
 * Claude runs on the subscription OAuth token; Codex on the subscription
 * auth.json. Neither path can consume per-token API credit, and this script
 * refuses to start if an API key is present in a slot that would bill.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

const run = promisify(execFile);

const planSchema = z.object({
  summary: z.string().min(1),
  files: z.array(z.object({
    path: z.string().min(1),
    change: z.string().min(1),
  })).min(1),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  risks: z.array(z.string()),
});

type Plan = z.infer<typeof planSchema>;

const PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    files: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, change: { type: "string" } },
        required: ["path", "change"],
        additionalProperties: false,
      },
    },
    acceptance_criteria: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "files", "acceptance_criteria", "risks"],
  additionalProperties: false,
} as const;

const reviewSchema = z.object({
  summary: z.string().min(1),
  findings: z.array(z.object({
    title: z.string().min(1),
    detail: z.string().min(1),
    severity: z.enum(["info", "low", "medium", "high"]),
  })),
  meets_criteria: z.boolean(),
  confidence: z.enum(["low", "medium", "high"]),
});

const REVIEW_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          severity: { type: "string", enum: ["info", "low", "medium", "high"] },
        },
        required: ["title", "detail", "severity"],
        additionalProperties: false,
      },
    },
    meets_criteria: { type: "boolean" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["summary", "findings", "meets_criteria", "confidence"],
  additionalProperties: false,
} as const;

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

/** One Claude execution. A new session every time — that is the isolation. */
async function claude(
  system: string,
  prompt: string,
  schema: Record<string, unknown>,
  options: { readonly tools: readonly string[]; readonly maxTurns: number },
): Promise<unknown> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  let raw = "";
  for await (const message of query({
    prompt,
    options: {
      model: "claude-opus-5",
      systemPrompt: system,
      cwd: process.cwd(),
      allowedTools: [...options.tools],
      disallowedTools: ["Bash", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch"],
      permissionMode: "default",
      maxTurns: options.maxTurns,
      outputFormat: { type: "json_schema", schema },
    },
  })) {
    if (message.type === "result" && !message.is_error) {
      const structured = (message as { structured_output?: unknown }).structured_output;
      raw = structured !== undefined && structured !== null
        ? JSON.stringify(structured)
        : ("result" in message ? String(message.result) : "");
    }
  }
  if (!raw.trim()) fail("Claude returned nothing.");
  return JSON.parse(raw);
}

/** One Codex execution, in an isolated workspace, on the subscription. */
async function codex(prompt: string, workspace: string): Promise<string> {
  const { Codex } = await import("@openai/codex-sdk");
  const authJson = process.env.SOFTWAREFACTORY_CODEX_AUTH_JSON;
  if (!authJson) fail("SOFTWAREFACTORY_CODEX_AUTH_JSON is not set.");

  const codexHome = path.join(workspace, ".codex-home");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await writeFile(path.join(codexHome, "auth.json"), authJson, { mode: 0o600 });

  // No apiKey field at all: passing one is what would move this onto per-token
  // billing, so the option is omitted rather than set to undefined.
  const client = new Codex({
    env: { ...process.env, CODEX_HOME: codexHome, HOME: codexHome } as Record<string, string>,
  });

  const thread = client.startThread({
    workingDirectory: workspace,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: false,
  });

  const { events } = await thread.runStreamed(prompt);
  let last = "";
  for await (const event of events) {
    if (event.type === "item.completed" && event.item.type === "agent_message") {
      last = event.item.text;
    }
    if (event.type === "turn.failed" || event.type === "error") {
      fail(`Codex reported a terminal error: ${JSON.stringify(event).slice(0, 300)}`);
    }
  }
  return last;
}

async function main(): Promise<void> {
  // Refuse to start on a billing-capable credential rather than discover it in
  // an invoice. The cost rule is enforced, not documented.
  if (process.env.ANTHROPIC_API_KEY) fail("ANTHROPIC_API_KEY is set; this path must not bill.");
  if (process.env.OPENAI_API_KEY) fail("OPENAI_API_KEY is set; this path must not bill.");

  const workspace = await mkdtemp(path.join(tmpdir(), "handoff-canary-"));
  try {
    // Codex refuses to work outside a trusted directory, and it is right to:
    // an agent writing into an arbitrary path has no baseline to diff against
    // and no boundary to respect. The first run of this canary failed exactly
    // there.
    //
    // The fix is to give it a real repository rather than pass
    // `--skip-git-repo-check`, which would silence the check instead of
    // satisfying it. An empty commit is the baseline, so what Codex does next is
    // a genuine diff -- which is also what the reviewer should be shown, rather
    // than a file's contents with no indication of what changed.
    await run("git", ["init", "--quiet", "--initial-branch=main"], { cwd: workspace });
    await run("git", ["config", "user.email", "canary@softwarefactory.invalid"], { cwd: workspace });
    await run("git", ["config", "user.name", "handoff canary"], { cwd: workspace });
    await run("git", ["commit", "--quiet", "--allow-empty", "-m", "baseline"], { cwd: workspace });
    // ---------------------------------------------------------------- step 1
    const planSystem =
      "You are the planner. Produce an implementation plan as structured data. "
      + "You do not write code and you do not have a repository.";
    const planPrompt =
      "Plan a single small module `sum.js` exporting a function `sum(numbers)` that returns the "
      + "total of an array of numbers, returning 0 for an empty array. State the acceptance "
      + "criteria a reviewer would check.";

    const planRaw = await claude(planSystem, planPrompt, PLAN_JSON_SCHEMA, { tools: [], maxTurns: 2 });

    // ---------------------------------------------------------------- step 2
    // Validated BEFORE Codex sees it. A handoff that validates only on receipt
    // has already passed bad input downstream.
    const parsed = planSchema.safeParse(planRaw);
    if (!parsed.success) {
      fail(`the plan did not satisfy the handoff contract: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    }
    const plan: Plan = parsed.data;
    console.log(`PLAN OK  files=${plan.files.length} criteria=${plan.acceptance_criteria.length}`);

    // ---------------------------------------------------------------- step 3
    const implementPrompt = [
      "Implement exactly this plan in the current directory. Write the file and nothing else.",
      "",
      `Summary: ${plan.summary}`,
      ...plan.files.map((f) => `File ${f.path}: ${f.change}`),
      "",
      "Acceptance criteria:",
      ...plan.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`),
    ].join("\n");

    await codex(implementPrompt, workspace);

    // What changed, from git rather than from Codex's own account of it. An
    // agent's summary of its work is exactly the kind of claim this repository
    // refuses to treat as evidence.
    await run("git", ["add", "-A"], { cwd: workspace });
    const { stdout: diff } = await run("git", ["diff", "--cached"], {
      cwd: workspace,
      maxBuffer: 4_000_000,
    });
    if (!diff.trim()) fail("Codex changed nothing. Goal 18 not demonstrated.");
    const { stdout: names } = await run("git", ["diff", "--cached", "--name-only"], { cwd: workspace });
    console.log(`CODEX OK  ${names.trim().split("\n").length} file(s) changed, ${diff.length} bytes of diff`);

    // ---------------------------------------------------------------- step 4
    // The reviewer receives the artifact and the criteria. Nothing else exists
    // in this string, and that is asserted below rather than intended.
    const reviewPrompt = [
      "Review this diff against the criteria. Report problems as findings.",
      "",
      "```",
      diff,
      "```",
      "",
      "Criteria:",
      ...plan.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`),
    ].join("\n");

    for (const leak of [planSystem, planPrompt, plan.summary, implementPrompt]) {
      if (leak && reviewPrompt.includes(leak)) {
        fail("implementer context reached the reviewer; goal 20 violated.");
      }
    }

    const reviewRaw = await claude(
      "You review code you did not write. Judge only what is in front of you.",
      reviewPrompt,
      REVIEW_JSON_SCHEMA,
      { tools: [], maxTurns: 2 },
    );
    const review = reviewSchema.safeParse(reviewRaw);
    if (!review.success) fail("the review did not satisfy its contract.");

    console.log(`REVIEW OK  meets_criteria=${review.data.meets_criteria} `
      + `findings=${review.data.findings.length} confidence=${review.data.confidence}`);
    console.log("\nGOAL 18 (typed Claude->Codex handoff): PASS");
    console.log("GOAL 19 (fresh-context independent review): PASS");
    console.log("GOAL 20 (reviewer is not the implementer): PASS - asserted structurally");
    console.log("API tokens consumed: 0");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

void main();
