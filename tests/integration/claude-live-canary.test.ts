// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PROVIDER_RESULT_JSON_SCHEMA,
  buildSystemPrompt,
  buildTaskPrompt,
  parseProviderResult,
} from "@/lib/providers/contract";
import type { ProviderRunRequest } from "@/lib/providers/types";

/**
 * The live Claude canary.
 *
 * Every other test in this repository proves a contract against a stub. This one
 * exists because a stub cannot answer the question that actually matters: does
 * *Claude* — the real model, reached the real way — return something that
 * satisfies the schema SoftwareFactory stores? A prompt that elicits prose
 * instead of JSON, or JSON that misses a required field, is a defect that no
 * amount of adapter testing surfaces, because the adapter is not the part that
 * is wrong.
 *
 * ## What this proves, and what it does not
 *
 * It runs the repository's own `buildSystemPrompt` and `buildTaskPrompt` against
 * a real Claude execution, and validates the answer with the repository's own
 * `parseProviderResult`. So it proves the prompt/schema contract end to end:
 * real model, real round trip, schema-valid structured output, zero API tokens.
 *
 * It does **not** prove the credential plumbing in
 * `lib/providers/claude-cli-transport.ts`. That path builds an isolated child
 * environment carrying no ambient `CLAUDE_*`, precisely so a run cannot succeed
 * on credentials the machine happened to have lying around — and this canary has
 * no configured credential to give it, only the ambient one. Reaching into the
 * host's credential store to manufacture a green result here would defeat the
 * isolation that makes the transport worth having, so it is not done.
 *
 * Closing that last gap needs one owner action and nothing else:
 * set `SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`. The
 * transport's own behaviour — refusal without a credential, refusal of an API key
 * in the subscription slot, isolation of the child environment, redaction — is
 * covered exhaustively in `tests/unit/claude-auth.test.ts` and
 * `tests/unit/claude-cli-transport.test.ts`.
 *
 * ## Why it is opt-in
 *
 * It spawns a real CLI and consumes a real subscription turn, which is wrong to
 * do on every `vitest run`. `SOFTWAREFACTORY_CLAUDE_LIVE_CANARY=1` turns it on.
 * It is skipped rather than asserted-absent, because asserting that Claude is
 * unreachable would be a test that fails the day the system starts working.
 */

const CANARY_ENABLED = process.env.SOFTWAREFACTORY_CLAUDE_LIVE_CANARY === "1";

const CANARY_REQUEST: ProviderRunRequest = {
  runId: "canary-0001",
  taskKind: "status_report",
  agentRole: "orchestrator",
  agentId: "canary",
  instructions:
    "Inspect the repository README and project metadata, and report the project's name and its "
    + "purpose. Cite the specific files you read as evidence, and state your confidence.",
  context: {
    projectName: "SoftwareFactory",
    repositoryFullName: "surgeservicesllc/SoftwareFactory",
    defaultBranch: "main",
    riskLevel: "GREEN",
    priorArtifacts: [],
    memoryExcerpts: [],
  },
  model: "claude-opus-5",
  maxOutputTokens: 4_000,
  timeoutMs: 180_000,
};

async function runRealClaude(system: string, task: string): Promise<string> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  let text = "";
  for await (const message of query({
    prompt: task,
    options: {
      model: CANARY_REQUEST.model,
      systemPrompt: system,
      cwd: process.cwd(),
      // The canary task is an inspection, so it needs to read. It must not be
      // able to change anything it reads.
      allowedTools: ["Read", "Glob", "Grep"],
      disallowedTools: ["Bash", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch"],
      permissionMode: "default",
      maxTurns: 6,
      // The same enforcement the transport uses. Without it the model answers
      // in a schema of its own invention -- which is how this canary earned
      // its place on its very first run.
      outputFormat: { type: "json_schema", schema: PROVIDER_RESULT_JSON_SCHEMA },
    },
  })) {
    if (message.type === "result" && !message.is_error) {
      const structured = (message as { structured_output?: unknown }).structured_output;
      text = structured !== undefined && structured !== null
        ? JSON.stringify(structured)
        : ("result" in message ? message.result : "");
    }
  }
  return text;
}

describe.skipIf(!CANARY_ENABLED)("live Claude canary", () => {
  it("returns a schema-valid structured artifact from a real execution", async () => {
    const system = buildSystemPrompt(CANARY_REQUEST);
    const task = buildTaskPrompt(CANARY_REQUEST);

    const raw = await runRealClaude(system, task);
    expect(raw.trim().length, "Claude returned nothing").toBeGreaterThan(0);

    // The repository's own validator, not a relaxed copy of it. If this throws,
    // the prompt contract is wrong and the adapter would have stored nothing.
    const result = parseProviderResult(raw, "anthropic");

    expect(result.summary.length).toBeGreaterThan(0);
    expect(["low", "medium", "high"]).toContain(result.confidence);
    expect(result.blocked).toBe(false);

    // The canary asks for evidence, so an artifact with no findings has not
    // answered the question it was given.
    expect(result.findings.length).toBeGreaterThan(0);

    // It was asked to identify this project. A run that read nothing would
    // still produce valid JSON, so check that it actually looked.
    const haystack = [
      result.summary,
      ...result.findings.map((finding) => `${finding.title} ${finding.detail}`),
    ]
      .join(" ")
      .toLowerCase();
    expect(haystack).toContain("softwarefactory");
  }, 300_000);
});
