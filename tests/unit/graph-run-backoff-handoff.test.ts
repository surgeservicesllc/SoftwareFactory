// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { compileGraph } from "@/lib/graph/compiler";
import { defineNode } from "@/lib/graph/contracts";
import { DEFAULT_RETRY_POLICY } from "@/lib/graph/types";
import { runClaimedGraph, type GraphRunStore } from "@/lib/worker/graph-run";
import type { SdlcStage } from "@/lib/sdlc/lifecycle";
import { STAGE_ARTIFACT_VERSION } from "@/lib/sdlc/artifacts";
import { z } from "zod";

/**
 * The two things the worker learned: to wait before retrying, and to write down
 * what one stage handed the next.
 *
 * Both are driven through `runClaimedGraph` with an injected clock and an
 * injected store, so the schedule is asserted rather than slept through and the
 * writes are observed rather than inferred.
 */

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";

function claimFor(nodes: {
  key: string;
  stage: SdlcStage | null;
  dependsOn?: string[];
  maxAttempts?: number;
}[]) {
  const edges = nodes.flatMap((node) =>
    (node.dependsOn ?? []).map((from) => ({
      from_node_key: from,
      to_node_key: node.key,
      reason: "DATA",
      detail: "d",
    })),
  );
  return {
    graph_id: "22222222-2222-4222-8222-222222222222",
    graph_run_id: "33333333-3333-4333-8333-333333333333",
    organization_id: ORGANIZATION,
    project_id: "44444444-4444-4444-8444-444444444444",
    goal: "Ship it",
    topology: "DAG",
    risk_level: "green",
    is_lifecycle: true,
    iteration: 1,
    max_iterations: 3,
    budget: {
      max_nodes: 50,
      max_concurrent_nodes: 8,
      max_duration_ms: 3_600_000,
      max_retries: 10,
      max_discovery_rounds: 5,
    },
    nodes: nodes.map((node, index) => ({
      node_run_id: `55555555-5555-4555-8555-00000000000${index}`,
      node_id: `66666666-6666-4666-8666-00000000000${index}`,
      node_key: node.key,
      job: `Do ${node.key}`,
      executor: "MODEL" as const,
      capability: "planning",
      model_tier: "STANDARD",
      risk_level: "green",
      timeout_ms: 60_000,
      max_attempts: node.maxAttempts ?? 2,
      allow_provider_fallback: true,
      tolerates_partial_inputs: false,
      lifecycle_stage: node.stage,
      gate_kind: null,
      gate_state: null,
      reads: [],
      writes: [],
    })),
    edges,
  };
}

function compiledFor(nodes: { key: string; dependsOn?: string[]; maxAttempts?: number }[]) {
  const result = compileGraph({
    goal: "Ship it",
    nodes: nodes.map((node) =>
      defineNode({
        nodeId: node.key,
        job: `Do ${node.key}`,
        executor: "MODEL",
        capability: "planning",
        inputSchema: z.unknown(),
        outputSchema: z.unknown(),
        dependsOn: node.dependsOn ?? [],
        // The contract carries a retry *policy*; a bare maxAttempts is quietly
        // ignored, which is how this test first asserted three attempts and
        // observed two.
        retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: node.maxAttempts ?? 2 },
        reads: [],
        writes: [],
        risk: "GREEN",
      }),
    ),
    proposedEdges: nodes.flatMap((node) =>
      (node.dependsOn ?? []).map((from) => ({
        from,
        to: node.key,
        reason: "DATA" as const,
        detail: "d",
      })),
    ),
    risk: "GREEN",
  });
  if (!result.ok) throw new Error(result.errors.map((e) => e.detail).join("; "));
  return result.graph;
}

function storeSpy(): GraphRunStore & {
  states: {
    nodeRunId: string;
    state: string;
    detail: string | null;
    confidence: number | null;
  }[];
  handoffs: Parameters<NonNullable<GraphRunStore["recordHandoff"]>>[0][];
} {
  const states: {
    nodeRunId: string;
    state: string;
    detail: string | null;
    confidence: number | null;
  }[] = [];
  const handoffs: Parameters<NonNullable<GraphRunStore["recordHandoff"]>>[0][] = [];
  return {
    states,
    handoffs,
    recordNodeState: async (nodeRunId, state, detail, execution) => {
      states.push({
        nodeRunId,
        state,
        detail: detail ?? null,
        confidence: execution?.confidence ?? null,
      });
    },
    recordArtifact: async () => {},
    recordHandoff: async (input) => {
      handoffs.push(input);
    },
    completeRun: async () => {},
  };
}

const REQUIREMENT_PACKAGE = {
  version: STAGE_ARTIFACT_VERSION,
  stage: "REQUIREMENT" as const,
  objective: "Let a person start a run by describing what they want.",
  scope: { included: ["the intake"], excluded: [] },
  constraints: [],
  acceptanceCriteria: [{ id: "AC-1", statement: "One sentence starts a run.", verifiedBy: "e2e" }],
  assumptions: [],
  integrations: [],
  dependencies: [],
  risks: [],
  successMetrics: [],
  priorities: [],
};

describe("a retried node", () => {
  it("waits before the second attempt and not before the first", async () => {
    const slept: number[] = [];
    const store = storeSpy();
    const nodes = [{ key: "solo", stage: null, maxAttempts: 3 }];

    let attempts = 0;
    await runClaimedGraph(
      claimFor(nodes),
      compiledFor([{ key: "solo", maxAttempts: 3 }]),
      store,
      async () => {
        attempts += 1;
        return attempts < 3
          ? { status: "FAILED", error: "rate limited", retryable: true }
          : { status: "SUCCEEDED", output: {} };
      },
      {
        sleep: async (ms) => { slept.push(ms); },
        backoff: { baseMs: 2_000, capMs: 30_000, jitter: 0 },
        random: () => 0,
      },
    );

    expect(attempts).toBe(3);
    // Attempt 1 runs immediately; 2 waits the base delay; 3 waits double.
    expect(slept).toEqual([2_000, 4_000]);
  });

  it("says in the transition why it is pausing, so a wait is not mistaken for a hang", async () => {
    const store = storeSpy();
    let attempts = 0;
    await runClaimedGraph(
      claimFor([{ key: "solo", stage: null, maxAttempts: 2 }]),
      compiledFor([{ key: "solo", maxAttempts: 2 }]),
      store,
      async () => {
        attempts += 1;
        return attempts < 2
          ? { status: "FAILED", error: "rate limited", retryable: true }
          : { status: "SUCCEEDED", output: {} };
      },
      { sleep: async () => {}, backoff: { baseMs: 2_000, capMs: 30_000, jitter: 0 } },
    );

    const running = store.states.filter((entry) => entry.state === "RUNNING");
    expect(running).toHaveLength(2);
    expect(running[0].detail).toBeNull();
    expect(running[1].detail).toBe("Attempt 2 of 2, after 2000ms of backoff.");
  });

  it("does not wait at all when the first attempt succeeds", async () => {
    const slept: number[] = [];
    await runClaimedGraph(
      claimFor([{ key: "solo", stage: null }]),
      compiledFor([{ key: "solo" }]),
      storeSpy(),
      async () => ({ status: "SUCCEEDED", output: {} }),
      { sleep: async (ms) => { slept.push(ms); } },
    );
    expect(slept).toEqual([]);
  });
});

describe("a stage handoff", () => {
  const lifecycle = [
    { key: "requirement", stage: "REQUIREMENT" as SdlcStage },
    { key: "discover_a", stage: "DISCOVER" as SdlcStage, dependsOn: ["requirement"] },
    { key: "discover_b", stage: "DISCOVER" as SdlcStage, dependsOn: ["requirement"] },
    { key: "shortlist", stage: "DISCOVER" as SdlcStage, dependsOn: ["discover_a", "discover_b"] },
  ];
  const compiledLifecycle = [
    { key: "requirement" },
    { key: "discover_a", dependsOn: ["requirement"] },
    { key: "discover_b", dependsOn: ["requirement"] },
    { key: "shortlist", dependsOn: ["discover_a", "discover_b"] },
  ];

  async function run(output: unknown) {
    const store = storeSpy();
    await runClaimedGraph(
      claimFor(lifecycle),
      compiledFor(compiledLifecycle),
      store,
      async (node) => ({
        status: "SUCCEEDED",
        output: node.nodeKey === "requirement" ? output : {},
      }),
      { sleep: async () => {} },
    );
    return store;
  }

  it("is recorded for every edge that leaves the stage", async () => {
    const store = await run(REQUIREMENT_PACKAGE);
    const fromRequirement = store.handoffs.filter(
      (handoff) => handoff.fromNodeRunId === "55555555-5555-4555-8555-000000000000",
    );
    expect(fromRequirement).toHaveLength(2);
    expect(fromRequirement.map((handoff) => handoff.toNodeId).sort()).toEqual([
      "66666666-6666-4666-8666-000000000001",
      "66666666-6666-4666-8666-000000000002",
    ]);
  });

  it("is not recorded for an edge inside one stage", async () => {
    // discover_a and discover_b both feed the shortlist, and all three are
    // DISCOVER. Recording those would bury the boundary that matters under the
    // ones that do not.
    const store = await run(REQUIREMENT_PACKAGE);
    const intoShortlist = store.handoffs.filter(
      (handoff) => handoff.toNodeId === "66666666-6666-4666-8666-000000000003",
    );
    expect(intoShortlist).toEqual([]);
  });

  it("says the payload satisfied the contract when it did", async () => {
    const store = await run(REQUIREMENT_PACKAGE);
    expect(store.handoffs[0].contractValid).toBe(true);
    expect(store.handoffs[0].validationIssues).toEqual([]);
    expect(store.handoffs[0].payload).toEqual(REQUIREMENT_PACKAGE);
  });

  it("records an unreadable handoff as invalid, with reasons, rather than skipping it", async () => {
    // The state this repository is actually in: nothing is connected, so no
    // stage produces a package that satisfies its schema. "This stage handed
    // the next one something it cannot read" is the finding — an omission
    // would say nothing happened.
    const store = await run({ notAPackage: true });
    expect(store.handoffs).toHaveLength(2);
    expect(store.handoffs[0].contractValid).toBe(false);
    expect(store.handoffs[0].validationIssues.join(" ")).toContain("version");
  });

  it("names the receiving stage and job as the next action", async () => {
    const store = await run(REQUIREMENT_PACKAGE);
    expect(store.handoffs[0].nextAction).toBe("Discover: Do discover_a");
  });

  it("writes nothing for a graph whose nodes carry no stage", async () => {
    const store = storeSpy();
    await runClaimedGraph(
      claimFor([{ key: "a", stage: null }, { key: "b", stage: null, dependsOn: ["a"] }]),
      compiledFor([{ key: "a" }, { key: "b", dependsOn: ["a"] }]),
      store,
      async () => ({ status: "SUCCEEDED", output: {} }),
      { sleep: async () => {} },
    );
    expect(store.handoffs).toEqual([]);
  });

  it("runs against a store that has never heard of handoffs", async () => {
    // The optional-capability rule the store contract follows everywhere: an
    // older store satisfies the contract rather than failing a run over
    // something it never had.
    const legacy: GraphRunStore = {
      recordNodeState: async () => {},
      recordArtifact: async () => {},
      completeRun: async () => {},
    };
    const summary = await runClaimedGraph(
      claimFor(lifecycle),
      compiledFor(compiledLifecycle),
      legacy,
      async () => ({ status: "SUCCEEDED", output: REQUIREMENT_PACKAGE }),
      { sleep: async () => {} },
    );
    expect(summary.nodesSucceeded).toBe(4);
  });
});

describe("the orchestrator's verdict on a finished run", () => {
  it("is reported for every run, and refuses to call an unevidenced stage done", async () => {
    /*
     * The rule this whole module exists to enforce, finally applied: a
     * lifecycle is not done because its nodes finished. TEST and DISCOVER
     * require an observation, and a MODEL node's output is a claim however
     * confident — `anchorsFor` counts only what an ANCHOR recorded, so a run of
     * MODEL nodes cannot satisfy them.
     */
    const store = storeSpy();
    const summary = await runClaimedGraph(
      claimFor([
        { key: "requirement", stage: "REQUIREMENT" as SdlcStage },
        { key: "discover_a", stage: "DISCOVER" as SdlcStage, dependsOn: ["requirement"] },
      ]),
      compiledFor([{ key: "requirement" }, { key: "discover_a", dependsOn: ["requirement"] }]),
      store,
      async () => ({ status: "SUCCEEDED", output: REQUIREMENT_PACKAGE }),
      { sleep: async () => {} },
    );

    expect(summary.orchestration.acceptance.met).toBe(false);
    expect(summary.orchestration.acceptance.unmet.join(" "))
      .toContain("DISCOVER requires anchored evidence");
    // REQUIREMENT declares an automatic gate that this graph never opened, so
    // it is unmet for a second, different reason — and both are named.
    expect(summary.orchestration.acceptance.unmet.join(" "))
      .toContain("REQUIREMENT has a automatic gate that was never opened");
  });

  it("answers for a graph with no stages at all rather than going silent", async () => {
    // Most graphs are audits with no lifecycle. A vacuous acceptance report is
    // a true statement about them, not an absence.
    const summary = await runClaimedGraph(
      claimFor([{ key: "authn", stage: null }, { key: "reduce", stage: null, dependsOn: ["authn"] }]),
      compiledFor([{ key: "authn" }, { key: "reduce", dependsOn: ["authn"] }]),
      storeSpy(),
      async () => ({ status: "SUCCEEDED", output: {} }),
      { sleep: async () => {} },
    );
    expect(summary.orchestration.action).toBe("COMPLETE");
    expect(summary.orchestration.acceptance).toEqual({ met: true, satisfied: [], unmet: [] });
  });

  it("sends a failure back to the stage where the mistake was made", async () => {
    const summary = await runClaimedGraph(
      claimFor([
        { key: "review", stage: "REVIEW" as SdlcStage, maxAttempts: 1 },
      ]),
      compiledFor([{ key: "review", maxAttempts: 1 }]),
      storeSpy(),
      async () => ({ status: "FAILED", error: "the change does not match", retryable: false }),
      { sleep: async () => {} },
    );
    expect(summary.orchestration.action).toBe("REPAIR");
    // Not REVIEW: re-reviewing a wrong change reproduces the finding.
    expect(summary.orchestration.repairs[0]).toMatchObject({ returnsTo: "BUILD" });
  });

  it("writes its verdict into the run's closing sentence", async () => {
    const closings: (string | null)[] = [];
    const store: GraphRunStore = {
      recordNodeState: async () => {},
      recordArtifact: async () => {},
      completeRun: async (_id, _state, _partial, detail) => { closings.push(detail ?? null); },
    };
    await runClaimedGraph(
      claimFor([{ key: "monitor", stage: "MONITOR" as SdlcStage }]),
      compiledFor([{ key: "monitor" }]),
      store,
      async () => ({ status: "SUCCEEDED", output: {} }),
      { sleep: async () => {} },
    );
    // MONITOR needs an observation and a MODEL node cannot give one, so the
    // lifecycle iterates rather than completing — and the run says so.
    expect(closings[0]).toContain("ITERATE");
    expect(closings[0]).toContain("MONITOR requires anchored evidence");
  });
});

describe("the default clock", () => {
  it("is a real one, so a caller that injects nothing still waits", async () => {
    // Guards against the delay quietly becoming a no-op if the default is ever
    // changed to something inert for convenience.
    const timeout = vi.spyOn(globalThis, "setTimeout");
    let attempts = 0;
    await runClaimedGraph(
      claimFor([{ key: "solo", stage: null, maxAttempts: 2 }]),
      compiledFor([{ key: "solo", maxAttempts: 2 }]),
      storeSpy(),
      async () => {
        attempts += 1;
        return attempts < 2
          ? { status: "FAILED", error: "rate limited", retryable: true }
          : { status: "SUCCEEDED", output: {} };
      },
      { backoff: { baseMs: 1, capMs: 1, jitter: 0 } },
    );
    expect(timeout).toHaveBeenCalled();
    timeout.mockRestore();
  });
});

describe("the confidence a node reports", () => {
  it("reaches the transition that carries the node's output", async () => {
    const store = storeSpy();
    await runClaimedGraph(
      claimFor([{ key: "solo", stage: null }]),
      compiledFor([{ key: "solo" }]),
      store,
      async () => ({ status: "SUCCEEDED", output: {}, confidence: 0.75 }),
    );

    const completed = store.states.filter((entry) => entry.state === "COMPLETED");
    expect(completed).toHaveLength(1);
    expect(completed[0]?.confidence).toBe(0.75);
  });

  it("is absent when the executor reported none", async () => {
    /*
     * Every DETERMINISTIC and ANCHOR node is in this case, and so is every node
     * of every run until a provider is connected. Sending a default here would
     * put a number nothing produced into a column a reader takes as reported —
     * which is worse than the null it replaces, because null is legible as
     * "none" and 0.5 is not.
     */
    const store = storeSpy();
    await runClaimedGraph(
      claimFor([{ key: "solo", stage: null }]),
      compiledFor([{ key: "solo" }]),
      store,
      async () => ({ status: "SUCCEEDED", output: {} }),
    );

    const completed = store.states.filter((entry) => entry.state === "COMPLETED");
    expect(completed).toHaveLength(1);
    expect(completed[0]?.confidence).toBeNull();
  });

  it("is not sent on a RUNNING transition, which has no output behind it", async () => {
    const store = storeSpy();
    await runClaimedGraph(
      claimFor([{ key: "solo", stage: null }]),
      compiledFor([{ key: "solo" }]),
      store,
      async () => ({ status: "SUCCEEDED", output: {}, confidence: 0.25 }),
    );

    for (const entry of store.states.filter((state) => state.state === "RUNNING")) {
      expect(entry.confidence).toBeNull();
    }
  });
});
