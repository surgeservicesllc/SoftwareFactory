// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { NodeExecutionResult } from "@/lib/graph/runner";
import {
  compileClaimedGraph,
  parseClaimedGraph,
  runClaimedGraph,
  type ClaimedGraph,
  type GraphRunStore,
  type NodeInputs,
} from "@/lib/worker/graph-run";

const graphRunId = "10000000-0000-4000-8000-000000000001";
const graphId = "20000000-0000-4000-8000-000000000001";
const organizationId = "30000000-0000-4000-8000-000000000001";
const projectId = "40000000-0000-4000-8000-000000000001";

const FACTS_SCHEMA = {
  type: "object",
  properties: {
    facts: { type: "array", items: { type: "string" } },
  },
  required: ["facts"],
  additionalProperties: false,
} as const;

const NUMBER_FACTS_SCHEMA = {
  type: "object",
  properties: {
    facts: { type: "array", items: { type: "number" } },
  },
  required: ["facts"],
  additionalProperties: false,
} as const;

function inboundSchema(
  dependencies: readonly string[],
  outputs: Readonly<Record<string, unknown>> = Object.fromEntries(
    dependencies.map((dependency) => [dependency, FACTS_SCHEMA]),
  ),
) {
  return {
    type: "object",
    properties: {
      outputs: {
        type: "object",
        properties: outputs,
        additionalProperties: false,
      },
      missing: {
        type: "array",
        items: { type: "string", enum: dependencies },
        maxItems: dependencies.length,
      },
    },
    required: ["outputs", "missing"],
    additionalProperties: false,
  } as const;
}

function node(
  key: string,
  nodeRunId: string,
  dependsOn: readonly string[] = [],
  outputSchema: unknown = FACTS_SCHEMA,
  inputSchema: unknown = inboundSchema(dependsOn),
) {
  return {
    node_run_id: nodeRunId,
    node_id: nodeRunId,
    node_key: key,
    job: `Produce ${key}`,
    executor: "MODEL",
    capability: "extraction",
    model_tier: "STANDARD",
    risk_level: "GREEN",
    timeout_ms: 1_000,
    max_attempts: 1,
    allow_provider_fallback: false,
    tolerates_partial_inputs: false,
    lifecycle_stage: null,
    gate_kind: null,
    gate_state: null,
    input_schema: dependsOn.length === 0 ? { type: "string" } : inputSchema,
    output_schema: outputSchema,
    reads: [],
    writes: [],
    acceptance_criteria: null,
  };
}

function admission(provider: "anthropic" | "openai" = "anthropic") {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    lane: provider === "anthropic" ? "graph_model" : "phase1c",
    provider,
    model: provider === "anthropic" ? "claude-sonnet-5" : "gpt-5.3-codex",
    credential_purpose: provider === "anthropic" ? "claude_2" : "codex_2",
    credential_ref: provider === "anthropic"
      ? "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_2"
      : "SOFTWAREFACTORY_CODEX_AUTH_JSON_2",
    provider_credential_id: "70000000-0000-4000-8000-000000000002",
    provider_credential_rotated_at: "2026-08-31T12:00:00.000Z",
    ai_account_id: "70000000-0000-4000-8000-000000000003",
    admission_sha256: "b".repeat(64),
  };
}

function claim(
  outputSchema: unknown = FACTS_SCHEMA,
  overrides: Readonly<Record<string, unknown>> = {},
): ClaimedGraph {
  const raw = {
    graph_run_id: graphRunId,
    graph_id: graphId,
    organization_id: organizationId,
    project_id: projectId,
    project_name: "Repository Project",
    goal: "Prove durable node contracts",
    topology: "SEQUENTIAL",
    risk_level: "GREEN",
    project_repository: "owner/repository",
    project_default_branch: "develop",
    grok_admission_required: false,
    required_check_names: ["CI"],
    required_checks_sha256: "a".repeat(64),
    is_lifecycle: false,
    budget: {
      max_nodes: 10,
      max_concurrent_nodes: 2,
      max_duration_ms: 60_000,
      max_retries: 4,
      max_discovery_rounds: 5,
    },
    nodes: [
      node("producer", "50000000-0000-4000-8000-000000000001", [], outputSchema),
      node("consumer", "50000000-0000-4000-8000-000000000002", ["producer"]),
    ],
    edges: [{
      from_node_key: "producer",
      to_node_key: "consumer",
      reason: "DATA",
      detail: "The consumer needs the producer's facts.",
    }],
    ...overrides,
  };
  const parsed = parseClaimedGraph(raw);
  if (!parsed.ok) throw new Error(parsed.detail);
  return parsed.graph;
}

function store() {
  const states: Array<{ nodeRunId: string; state: string; detail?: string | null }> = [];
  const artifacts: Array<{ nodeRunId?: string | null; payload: unknown }> = [];
  const completions: string[] = [];
  const implementation: GraphRunStore = {
    async recordNodeState(nodeRunId, state, detail) {
      states.push({ nodeRunId, state, detail });
    },
    async recordArtifact(_runId, _kind, payload, nodeRunId) {
      artifacts.push({ nodeRunId, payload });
    },
    async completeRun(_runId, state) {
      completions.push(state);
    },
  };
  return { implementation, states, artifacts, completions };
}

function compile(input: ClaimedGraph) {
  const compiled = compileClaimedGraph(input);
  if (!compiled.ok) throw new Error(compiled.detail);
  return compiled.graph;
}

describe("claimed graph output contracts", () => {
  it("keeps an ordinary non-Grok protocol-v3 claim parseable without admissions", () => {
    const ordinary = claim();
    expect(ordinary.grok_admission_required).toBe(false);
    const { grok_admission_required: _omitted, ...missingLaunchIdentity } = ordinary;
    expect(parseClaimedGraph(missingLaunchIdentity).ok).toBe(false);
  });

  it("refuses a Grok claim when a MODEL admission is missing or uses the other provider", () => {
    expect(() => claim(FACTS_SCHEMA, { grok_admission_required: true })).toThrow(
      /exact Anthropic admission/i,
    );
    expect(() => claim(FACTS_SCHEMA, {
      grok_admission_required: true,
      nodes: [
        { ...node("producer", "50000000-0000-4000-8000-000000000001"), execution_admission: admission("openai") },
      ],
      edges: [],
    })).toThrow(/exact Anthropic admission/i);
  });

  it("refuses provider admission metadata injected into a non-Grok claim", () => {
    expect(() => claim(FACTS_SCHEMA, {
      nodes: [
        { ...node("producer", "50000000-0000-4000-8000-000000000001"), execution_admission: admission() },
      ],
      edges: [],
    })).toThrow(/non-Grok claim cannot inject/i);
  });

  it("parses the complete graph-scoped Phase 1C bridge projection", () => {
    const parsed = claim(FACTS_SCHEMA, {
      template_key: "full_lifecycle",
      template_version: 2,
      base_branch: "main",
      base_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      phase1c_state: "PULL_REQUEST_RECORDED",
      phase1c_head_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      pull_request_number: 309,
      pull_request_url: "https://github.com/owner/repository/pull/309",
      validation_evidence: {
        agent_run_id: "60000000-0000-4000-8000-000000000001",
        head_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        validation_round: 2,
        validations: [{ name: "diff-check", status: "passed", duration_ms: 42 }],
      },
      merge_commit_sha: null,
      deployment_id: null,
      deployment_url: null,
    });

    expect(parsed).toMatchObject({
      template_key: "full_lifecycle",
      template_version: 2,
      base_branch: "main",
      base_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      phase1c_state: "PULL_REQUEST_RECORDED",
      phase1c_head_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      pull_request_number: 309,
      validation_evidence: expect.objectContaining({
        agent_run_id: "60000000-0000-4000-8000-000000000001",
        validation_round: 2,
      }),
    });
  });

  it("rejects malformed bridge evidence instead of downgrading it to absent", () => {
    const raw = {
      graph_run_id: graphRunId,
      graph_id: graphId,
      organization_id: organizationId,
      project_id: projectId,
      project_name: "Repository Project",
      goal: "Prove durable node contracts",
      topology: "SEQUENTIAL",
      risk_level: "GREEN",
      project_repository: "owner/repository",
      project_default_branch: "develop",
      grok_admission_required: false,
      required_check_names: ["CI"],
      required_checks_sha256: "a".repeat(64),
      is_lifecycle: true,
      budget: {
        max_nodes: 10,
        max_concurrent_nodes: 2,
        max_duration_ms: 60_000,
        max_retries: 4,
        max_discovery_rounds: 5,
      },
      nodes: [node("producer", "50000000-0000-4000-8000-000000000001")],
      edges: [],
      template_key: "full_lifecycle",
      template_version: 2,
      phase1c_state: "PULL_REQUEST_RECORDED",
      phase1c_head_sha: "not-a-sha",
      validation_evidence: {
        agent_run_id: "not-a-run",
        head_sha: "not-a-sha",
        validation_round: 99,
        validations: new Array(51).fill({ name: "diff-check", status: "passed", duration_ms: 1 }),
      },
    };

    const parsed = parseClaimedGraph(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.detail).toMatch(/must match pattern|invalid uuid|too big/i);
  });

  it("refuses a legacy unconstrained output contract before execution", () => {
    const result = compileClaimedGraph(claim({}));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("producer's output contract is unconstrained");
  });

  it("refuses a legacy unconstrained non-root input contract before execution", () => {
    const result = compileClaimedGraph(claim(FACTS_SCHEMA, {
      nodes: [
        node("producer", "50000000-0000-4000-8000-000000000001"),
        node("consumer", "50000000-0000-4000-8000-000000000002", ["producer"], FACTS_SCHEMA, {}),
      ],
    }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain("consumer's input contract is unconstrained");
  });

  it("does not execute a non-root node when its inbound envelope violates the input contract", async () => {
    const input = claim(FACTS_SCHEMA, {
      nodes: [
        node("producer", "50000000-0000-4000-8000-000000000001"),
        node(
          "consumer",
          "50000000-0000-4000-8000-000000000002",
          ["producer"],
          FACTS_SCHEMA,
          inboundSchema(["producer"], { producer: NUMBER_FACTS_SCHEMA }),
        ),
      ],
    });
    const persistence = store();
    const executed: string[] = [];

    const result = await runClaimedGraph(
      input,
      compile(input),
      persistence.implementation,
      async (target): Promise<NodeExecutionResult> => {
        executed.push(target.nodeKey);
        return { status: "SUCCEEDED", output: { facts: ["stored"] } };
      },
    );

    expect(executed).toEqual(["producer"]);
    expect(persistence.artifacts.map((artifact) => artifact.payload)).toEqual([
      { facts: ["stored"] },
    ]);
    expect(persistence.states).toContainEqual(expect.objectContaining({
      state: "FAILED",
      detail: expect.stringContaining("input contract"),
    }));
    expect(result.finalState).toBe("PARTIAL");
  });

  it.each([
    ["prose", "I found several things."],
    ["a generic provider report", {
      summary: "Looked fine.",
      findings: [],
      recommendations: [],
      confidence: "high",
      blocked: false,
      blocked_reason: null,
    }],
  ])("does not persist or advance %s that violates the stored schema", async (_label, invalid) => {
    const input = claim();
    const persistence = store();
    const executed: string[] = [];

    const result = await runClaimedGraph(
      input,
      compile(input),
      persistence.implementation,
      async (target): Promise<NodeExecutionResult> => {
        executed.push(target.nodeKey);
        return { status: "SUCCEEDED", output: invalid };
      },
    );

    expect(executed).toEqual(["producer"]);
    expect(persistence.artifacts).toEqual([]);
    expect(
      persistence.states.some((entry) =>
        entry.state === "FAILED" && entry.detail?.includes("contract")),
    ).toBe(true);
    expect(result.finalState).toBe("FAILED");
  });

  it("normalizes and persists valid output before handing it downstream", async () => {
    const input = claim();
    const persistence = store();
    const consumer = vi.fn(
      async (_attempt: number, inputs: NodeInputs): Promise<NodeExecutionResult> => ({
        status: "SUCCEEDED",
        output: { facts: [...(inputs.outputs.producer as { facts: string[] }).facts, "consumed"] },
      }),
    );

    const result = await runClaimedGraph(
      input,
      compile(input),
      persistence.implementation,
      async (target, attempt, inputs): Promise<NodeExecutionResult> => {
        if (target.nodeKey === "producer") {
          return { status: "SUCCEEDED", output: { facts: ["stored"] } };
        }
        return consumer(attempt, inputs);
      },
    );

    expect(consumer).toHaveBeenCalledTimes(1);
    expect(persistence.artifacts.map((artifact) => artifact.payload)).toEqual([
      { facts: ["stored"] },
      { facts: ["stored", "consumed"] },
    ]);
    expect(result.finalState).toBe("COMPLETED");
    expect(persistence.completions).toEqual(["COMPLETED"]);
  });
});
