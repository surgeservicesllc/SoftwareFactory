// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { compileGraph, type CompiledGraph, type CompiledNode } from "@/lib/graph/compiler";
import { defineNode, validateNodeOutput } from "@/lib/graph/contracts";
import { runGraph, type NodeExecutionResult } from "@/lib/graph/runner";
import { DEFAULT_RETRY_POLICY } from "@/lib/graph/types";
import { tryResolveClaudeAuth } from "@/lib/providers/claude-auth";
import { executeClaudeThroughCli } from "@/lib/providers/claude-cli-transport";
import { PROVIDER_RESULT_JSON_SCHEMA } from "@/lib/providers/contract";
import type { ProviderRunRequest } from "@/lib/providers/types";

/**
 * Demonstration C, live — a real multi-node graph driven by a real model.
 *
 * Every other demonstration in `graph-demonstrations.test.ts` injects a scripted
 * `executeNode`. That is the right boundary for proving the engine's *decisions*
 * — scheduling, fan-in accounting, budget degradation — because a script
 * exercises those exactly as a model would, and far more precisely.
 *
 * It cannot prove the one thing this file exists for: that when the graph engine
 * dispatches real work to a real model, what comes back satisfies the contracts
 * the engine was written against. A node contract that no real output ever
 * satisfies is a defect no scripted run surfaces, because the script is written
 * by the same hand as the contract.
 *
 * ## Why this replaces an API-key gate
 *
 * The previous live half of demonstration C was gated on
 * `ANTHROPIC_API_KEY && OPENAI_API_KEY`, and its body threw "Not implemented".
 * Both were wrong, and the gate was wrong in an interesting way: this project's
 * standing constraint is that normal operation must cost **zero** funded
 * per-token API usage. So the demonstration was gated on precisely the thing the
 * project forbids, which meant it could never run — not "not yet", but never.
 *
 * It now runs on the same zero-token path the rest of the system uses: the
 * subscription-authenticated Claude CLI through `@anthropic-ai/claude-agent-sdk`,
 * with `PROVIDER_RESULT_JSON_SCHEMA` enforced by the provider rather than
 * requested in prose.
 *
 * ## What it proves
 *
 * - **Real parallelism with real models.** Three inspectors are independent, and
 *   the runner is observed dispatching them in one batch.
 * - **Typed contracts against real output.** Each node's result goes through the
 *   engine's own `validateNodeOutput`, not a relaxed copy.
 * - **A structured handoff.** Synthesis receives the inspectors' artifacts as
 *   data, and its own contract is checked on the way out.
 * - **A fresh-context verifier.** The verifier is a separate `query()` — a new
 *   session with no history — and is handed only the synthesis artifact and the
 *   acceptance criteria. It cannot see the inspectors' reasoning, the prompts
 *   they were given, or that it is reviewing a machine. Freshness here is
 *   structural, not a promise: there is no channel through which the
 *   implementer's context could reach it.
 * - **Fan-in honesty.** The run must report every node accounted for.
 *
 * ## What it does not prove
 *
 * That a Codex worker turns a plan into a mergeable diff and a draft pull
 * request. That half of demonstration C needs the Phase 1C worker to claim a
 * command against hosted Supabase, and the Phase 2B graph tables are not applied
 * to hosted. It is recorded as BLOCKED_BY_1C_HOSTED_SCHEMA rather than skipped
 * quietly.
 *
 * ## Why it is opt-in
 *
 * It spawns real CLI sessions and consumes real subscription turns. That is
 * wrong to do on every `vitest run`, so it needs
 * `SOFTWAREFACTORY_GRAPH_LIVE_CANARY=1`. Skipped rather than asserted-absent, so
 * it starts running the day someone asks for it rather than starting to fail.
 */

const CANARY_ENABLED = process.env.SOFTWAREFACTORY_GRAPH_LIVE_CANARY === "1";

/** The artifact shape every node in this graph must produce. */
const artifactSchema = z.object({
  summary: z.string().min(1),
  findings: z.array(
    z.object({
      title: z.string().min(1),
      detail: z.string().min(1),
      severity: z.enum(["info", "low", "medium", "high"]),
    }),
  ),
  recommendations: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  blocked: z.boolean(),
  blocked_reason: z.string().nullable(),
});

type Artifact = z.infer<typeof artifactSchema>;

const INSPECTORS = ["inspect_migrations", "inspect_rls", "inspect_zero_token"] as const;

const BRIEFS: Record<string, { readonly system: string; readonly task: string }> = {
  inspect_migrations: {
    system: "You inspect a repository and report what you actually read. Never guess.",
    task:
      "List the newest five files in supabase/migrations and state what the newest one creates. "
      + "Cite each file you read. If you cannot read the directory, set blocked true.",
  },
  inspect_rls: {
    system: "You inspect a repository and report what you actually read. Never guess.",
    task:
      "Find where this repository asserts that every public table has row level security, and name "
      + "the test file that does it. Cite the file and line. If you cannot find it, set blocked true.",
  },
  inspect_zero_token: {
    system: "You inspect a repository and report what you actually read. Never guess.",
    task:
      "Find how this project authenticates Codex without a paid API key, and name the module that "
      + "decides it. Cite the file. If you cannot find it, set blocked true.",
  },
};

/**
 * Which path the nodes run on, decided once and reported.
 *
 * When a subscription credential is configured this goes through the Phase 2A
 * transport — the same code an API-path caller uses, so goal 13's "routing uses
 * the existing provider layer" is exercised rather than asserted. With no
 * configured credential the transport would refuse (it deliberately carries no
 * ambient `CLAUDE_*` into its child), so the canary falls back to the Agent SDK
 * directly and says so.
 *
 * The fallback is not a workaround for the transport being awkward. It is the
 * difference between "no credential is configured here" and "the provider layer
 * does not work", and collapsing those would make a green run meaningless.
 */
const claudeAuth = tryResolveClaudeAuth();
const VIA_PROVIDER_LAYER = "resolution" in claudeAuth;

/** One real Claude execution. A new session each time — that is the isolation. */
async function runClaude(
  system: string,
  task: string,
  options: { readonly readOnly: boolean; readonly maxTurns: number },
): Promise<Artifact> {
  if ("resolution" in claudeAuth) {
    const request: ProviderRunRequest = {
      runId: `graph-canary-${Date.now()}`,
      taskKind: "status_report",
      agentRole: "orchestrator",
      agentId: "graph-canary",
      instructions: task,
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
      timeoutMs: 300_000,
    };

    const execution = await executeClaudeThroughCli(
      request,
      { system, task },
      new AbortController().signal,
      claudeAuth.resolution,
      {
        workingDirectory: process.cwd(),
        allowedTools: options.readOnly ? ["Read", "Glob", "Grep"] : [],
        // The declared turn budget, which is the change that made this path
        // usable for graph nodes at all: at one turn an inspector answers from
        // whatever a single tool call returned.
        maxTurns: options.maxTurns,
      },
    );
    return artifactSchema.parse(JSON.parse(execution.text));
  }

  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  let raw = "";
  for await (const message of query({
    prompt: task,
    options: {
      model: "claude-opus-5",
      systemPrompt: system,
      cwd: process.cwd(),
      // The verifier gets no tools at all: it must judge the artifact it was
      // handed, not go and form its own opinion of the repository. That is what
      // makes it a verifier of *this* work rather than a second implementer.
      allowedTools: options.readOnly ? ["Read", "Glob", "Grep"] : [],
      disallowedTools: ["Bash", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch"],
      permissionMode: "default",
      maxTurns: options.maxTurns,
      // Enforced by the provider, not requested in prose. Asking politely for a
      // schema is how the 2A canary failed on its first run.
      outputFormat: { type: "json_schema", schema: PROVIDER_RESULT_JSON_SCHEMA },
    },
  })) {
    if (message.type === "result" && !message.is_error) {
      const structured = (message as { structured_output?: unknown }).structured_output;
      raw = structured !== undefined && structured !== null
        ? JSON.stringify(structured)
        : ("result" in message ? String(message.result) : "");
    }
  }

  return artifactSchema.parse(JSON.parse(raw));
}

function graphNode(key: string, dependsOn: readonly string[] = []) {
  return defineNode({
    nodeId: key,
    job: `live ${key}`,
    executor: "MODEL",
    capability: key === "verify" ? "review" : "extraction",
    inputSchema: z.unknown(),
    outputSchema: artifactSchema,
    dependsOn,
    reads: [],
    writes: [],
    risk: "GREEN",
    retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: 2 },
  });
}

function buildGraph(): CompiledGraph {
  const nodes = [
    ...INSPECTORS.map((key) => graphNode(key)),
    graphNode("synthesize", INSPECTORS),
    graphNode("verify", ["synthesize"]),
  ];

  const result = compileGraph({
    goal: "Inspect three independent properties of this repository and verify the synthesis",
    nodes,
    proposedEdges: nodes.flatMap((n) =>
      n.dependsOn.map((from) => ({
        from,
        to: n.nodeId,
        reason: from === "synthesize" ? ("VERIFICATION" as const) : ("DATA" as const),
        detail: `${n.nodeId} consumes ${from}`,
      })),
    ),
  });

  if (!result.ok) throw new Error(result.errors.map((e) => e.detail).join("; "));
  return result.graph;
}

const validate = (target: CompiledNode, output: unknown) => {
  const outcome = validateNodeOutput(graphNode(target.nodeKey), output);
  return outcome.valid ? { valid: true, issues: [] } : { valid: false, issues: outcome.issues };
};

describe.skipIf(!CANARY_ENABLED)("C live. a real graph over real Claude, zero API tokens", () => {
  it("fans out, synthesizes, and verifies with a fresh context", async () => {
    const graph = buildGraph();
    expect(graph.maxParallelism).toBe(INSPECTORS.length);

    // Reported, not silently chosen: a reader of this output must be able to
    // tell whether the provider layer was exercised or bypassed.
    console.log(
      VIA_PROVIDER_LAYER
        ? "executing through the Phase 2A provider transport (subscription credential configured)"
        : "executing through the Agent SDK directly (no configured credential; transport would refuse)",
    );

    const artifacts = new Map<string, Artifact>();
    let inFlight = 0;
    let widestBatch = 0;
    // Proves structurally that nothing the implementers saw reached the verifier.
    let verifierPrompt = "";

    const result = await runGraph(
      graph,
      { ...DEFAULT_GRAPH_BUDGET, maxNodes: 10, maxConcurrentNodes: INSPECTORS.length },
      {
        executeNode: async (target: CompiledNode): Promise<NodeExecutionResult> => {
          inFlight += 1;
          widestBatch = Math.max(widestBatch, inFlight);
          try {
            if (target.nodeKey === "synthesize") {
              const inputs = INSPECTORS.map((key) => artifacts.get(key));
              const output = await runClaude(
                "You combine findings that were produced independently. Use only what you are given.",
                "Combine these three inspection artifacts into one. Keep every distinct finding and "
                  + "do not invent any.\n\n" + JSON.stringify(inputs, null, 2),
                { readOnly: false, maxTurns: 2 },
              );
              artifacts.set(target.nodeKey, output);
              return { status: "SUCCEEDED", output, tokensUsed: 0 };
            }

            if (target.nodeKey === "verify") {
              const subject = artifacts.get("synthesize");
              // Only the artifact and the criteria. No prompts, no reasoning, no
              // mention of who produced it or how.
              verifierPrompt =
                "Judge whether this report is internally consistent and whether every finding "
                + "carries a concrete citation. Report problems as findings; set blocked true only "
                + "if the report is unreadable.\n\n" + JSON.stringify(subject, null, 2);
              const output = await runClaude(
                "You review a report you did not write. Judge only what is in front of you.",
                verifierPrompt,
                { readOnly: false, maxTurns: 2 },
              );
              artifacts.set(target.nodeKey, output);
              return { status: "SUCCEEDED", output, tokensUsed: 0 };
            }

            const brief = BRIEFS[target.nodeKey];
            const output = await runClaude(brief.system, brief.task, {
              readOnly: true,
              maxTurns: 6,
            });
            artifacts.set(target.nodeKey, output);
            return { status: "SUCCEEDED", output, tokensUsed: 0 };
          } finally {
            inFlight -= 1;
          }
        },
        validateOutput: validate,
      },
    );

    // 1. The run completed and accounted for every node.
    expect(result.outcome).toBe("COMPLETED");
    expect(result.incompleteness).toBeNull();
    expect(result.spend.nodesStarted).toBe(INSPECTORS.length + 2);

    // 2. Real concurrency, not a queue that happened to finish.
    expect(widestBatch).toBe(INSPECTORS.length);

    // 3. Every node produced contract-valid output. The runner already enforced
    //    this, so reaching COMPLETED is the proof; assert the artifacts exist so
    //    a future change that stops storing them cannot pass silently.
    expect(artifacts.size).toBe(INSPECTORS.length + 2);
    for (const key of INSPECTORS) {
      const artifact = artifacts.get(key)!;
      expect(artifact.blocked, `${key} reported blocked: ${artifact.blocked_reason}`).toBe(false);
      expect(artifact.findings.length, `${key} found nothing`).toBeGreaterThan(0);
    }

    // 4. The verifier's context was fresh by construction. Nothing the
    //    inspectors were told can appear in what the verifier was given.
    for (const brief of Object.values(BRIEFS)) {
      expect(verifierPrompt).not.toContain(brief.task);
    }
    expect(verifierPrompt).not.toContain("You inspect a repository");

    // 5. The verifier produced a judgement rather than a refusal.
    const verdict = artifacts.get("verify")!;
    expect(verdict.blocked, `verifier refused: ${verdict.blocked_reason}`).toBe(false);
    expect(verdict.summary.length).toBeGreaterThan(0);
  }, 900_000);
});
