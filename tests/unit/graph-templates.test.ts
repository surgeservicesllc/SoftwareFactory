// @vitest-environment node

import { describe, expect, it } from "vitest";

import { budgetForTemplate } from "@/lib/graph/templates";
import { compileGraph } from "@/lib/graph/compiler";
import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { validateNodeOutput } from "@/lib/graph/contracts";
import {
  cloneTemplate,
  findTemplate,
  GRAPH_TEMPLATES,
  reviseTemplate,
  templateNodeContracts,
  templatesByCategory,
} from "@/lib/graph/templates";

describe("the template catalogue", () => {
  it("declares every template the roadmap names", () => {
    const keys = GRAPH_TEMPLATES.map((template) => template.key);

    for (const expected of [
      "production_readiness",
      "security_audit",
      "rls_audit",
      "bug_sweep",
      "test_coverage",
      "refactor_sweep",
      "dependency_audit",
      "performance_audit",
      "mobile_audit",
      "code_review",
      "feature_build",
      "incident_investigation",
      "seo_aeo_audit",
    ]) {
      expect(keys, expected).toContain(expected);
    }
  });

  it("gives every template a unique key", () => {
    const keys = GRAPH_TEMPLATES.map((template) => template.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("finds templates by key and by category", () => {
    expect(findTemplate("rls_audit")?.name).toBe("RLS Audit");
    expect(findTemplate("nope")).toBeNull();
    expect(templatesByCategory("BUILD").map((t) => t.key)).toEqual(["full_lifecycle", "agentic_sdlc", "feature_build"]);
  });
});

describe("templates compile", () => {
  it.each(GRAPH_TEMPLATES.map((template) => [template.key, template] as const))(
    "%s compiles into an executable graph",
    (_key, template) => {
      const result = compileGraph({
        goal: template.summary,
        nodes: templateNodeContracts(template),
        proposedEdges: template.proposedEdges,
        risk: template.risk,
        discovery: template.discovery,
        resolvedWriteConflicts: template.resolvedWriteConflicts,
      });

      // A template that cannot compile is worse than no template: it fails at
      // the moment someone tries to use it, having already looked official.
      if (!result.ok) {
        throw new Error(
          `${template.key} failed to compile: ${result.errors.map((e) => e.detail).join("; ")}`,
        );
      }
      expect(result.graph.nodes.length).toBe(template.nodes.length);
    },
  );

  it("lets a wide audit run its inspectors in parallel", () => {
    const template = findTemplate("security_audit")!;
    const result = compileGraph({
      goal: template.summary,
      nodes: templateNodeContracts(template),
      proposedEdges: template.proposedEdges,
      risk: template.risk,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Five independent inspectors; the reduce step is the only thing that waits.
    expect(result.graph.maxParallelism).toBe(5);
    expect(result.graph.topology).toBe("DIAMOND");
  });

  it("does not let a template's node count force a graph", () => {
    // The bias survives templating: a template is a proposal, and the compiler
    // still gets to say a scheduler is not worth it.
    const template = findTemplate("incident_investigation")!;
    const result = compileGraph({
      goal: template.summary,
      nodes: templateNodeContracts(template),
      proposedEdges: template.proposedEdges,
      risk: template.risk,
      discovery: template.discovery,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.topology).toBe("DISCOVERY_GRAPH");
  });

  it("gives the feature build its parallel implementation branches", () => {
    const template = findTemplate("feature_build")!;
    const result = compileGraph({
      goal: template.summary,
      nodes: templateNodeContracts(template),
      proposedEdges: template.proposedEdges,
      risk: template.risk,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.maxParallelism).toBe(3);
  });
});

describe("template contracts", () => {
  it("makes Full Lifecycle v2 observe the external build lineage and require human merge/release gates", () => {
    const template = findTemplate("full_lifecycle")!;
    const byKey = new Map(template.nodes.map((node) => [node.nodeId, node]));

    expect(template.version).toBe(2);
    expect(byKey.get("implement")?.executor).toBe("ANCHOR");
    expect(byKey.get("implement")?.gate).toBeUndefined();
    expect(byKey.get("review")?.executor).toBe("ANCHOR");
    expect(byKey.get("review")?.gate).toBeUndefined();
    expect(byKey.get("test")).toMatchObject({
      executor: "ANCHOR",
      gate: "HUMAN",
      timeoutMs: 480_000,
    });
    expect(byKey.get("deploy")).toMatchObject({
      executor: "ANCHOR",
      gate: "HUMAN",
      timeoutMs: 480_000,
    });
    expect(byKey.get("monitor")).toMatchObject({ executor: "ANCHOR", timeoutMs: 480_000 });
    expect(byKey.get("implement")?.writes ?? []).toEqual([]);
  });

  it("requires structured findings from an inspector, not prose", () => {
    const template = findTemplate("rls_audit")!;
    const contracts = templateNodeContracts(template);
    const inspector = contracts.find((node) => node.nodeId === "coverage")!;

    const prose = validateNodeOutput(inspector, "I checked the tables and they look fine.");
    expect(prose.valid).toBe(false);
    if (prose.valid) return;
    expect(prose.code).toBe("PROSE_WHERE_STRUCTURE_REQUIRED");

    const structured = validateNodeOutput(inspector, {
      findings: [
        {
          title: "public.graph_runs has RLS but not FORCE RLS",
          severity: "HIGH",
          location: "supabase/migrations",
          evidence: "relforcerowsecurity = false",
        },
      ],
    });
    expect(structured.valid).toBe(true);
  });

  it("routes extraction to the economy tier and synthesis to the strongest", () => {
    const contracts = templateNodeContracts(findTemplate("code_review")!);
    const compiled = compileGraph({
      goal: "review",
      nodes: contracts,
      proposedEdges: findTemplate("code_review")!.proposedEdges,
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const byKey = new Map(compiled.graph.nodes.map((node) => [node.nodeKey, node]));
    // The reduce step is deterministic, so it should not call a model at all.
    expect(byKey.get("reduce")?.modelTier).toBe("NONE");
    expect(byKey.get("synthesis")?.modelTier).toBe("STRONG");
  });
});

describe("cloning and versioning", () => {
  it("starts a clone at version 1 under its own key", () => {
    const original = findTemplate("bug_sweep")!;
    const copy = cloneTemplate(original, { key: "bug_sweep_mobile" });

    expect(copy.key).toBe("bug_sweep_mobile");
    expect(copy.version).toBe(1);
    expect(copy.nodes).toEqual(original.nodes);
    // The original is untouched: a run that used it must still be readable.
    expect(original.key).toBe("bug_sweep");
  });

  it("advances the version on every revision, including a cosmetic one", () => {
    const original = findTemplate("bug_sweep")!;
    const revised = reviseTemplate(original, { summary: "Reworded." });

    expect(revised.version).toBe(original.version + 1);
    expect(revised.key).toBe(original.key);

    // Two node sets sharing a version would make a run's record a lie, so even
    // a summary-only edit moves it.
    const again = reviseTemplate(revised, { summary: "Reworded again." });
    expect(again.version).toBe(original.version + 2);
  });

  it("does not let a revision change the key out from under a recorded run", () => {
    const original = findTemplate("bug_sweep")!;
    const revised = reviseTemplate(original, {
      name: "Something else",
    } as Partial<typeof original>);

    expect(revised.key).toBe("bug_sweep");
  });
});

/**
 * A gate nobody can ever decide.
 *
 * Both deciders refuse an AUTOMATIC gate holding zero anchors — the worker's
 * `decide_automatic_gate_as_worker` and a person's `decide_node_gate` alike —
 * because generated output is not a completed task. `anchorsFor` only counts
 * an ANCHOR node's output, so an AUTOMATIC gate anywhere else can never be
 * approved by anyone: the run halts there permanently and the queue reports it
 * waiting for a decision no one is able to give.
 *
 * Found live: production graph 91959362 sits stranded exactly so, its PRD node
 * VERIFYING behind an AUTOMATIC gate with an anchor count of zero. The shipped
 * `open_source_scout` template carried the same shape on its terminal decision
 * node, which meant every run of it was destined to strand.
 */
describe("automatic gates can actually be decided", () => {
  it.each(GRAPH_TEMPLATES.map((template) => [template.key, template] as const))(
    "%s puts no AUTOMATIC gate where anchors cannot arrive",
    (_key, template) => {
      const offenders = template.nodes
        .filter((node) => node.gate === "AUTOMATIC" && node.executor !== "ANCHOR")
        .map((node) => `${node.nodeId} (${node.executor})`);

      expect(offenders, "an AUTOMATIC gate off an ANCHOR node can never be approved").toEqual([]);
    },
  );

  it("refuses to compile a plan that gates a model node automatically", () => {
    const scout = findTemplate("open_source_scout")!;
    const impossible = {
      ...scout,
      nodes: scout.nodes.map((node) =>
        node.nodeId === "decide" ? { ...node, gate: "AUTOMATIC" as const } : node,
      ),
    };

    const built = buildLaunchPlan(impossible, budgetForTemplate(impossible, DEFAULT_GRAPH_BUDGET));

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.join(" ")).toMatch(/decide[\s\S]*AUTOMATIC gate[\s\S]*MODEL/);
  });

  it("still compiles every shipped template", () => {
    for (const template of GRAPH_TEMPLATES) {
      const built = buildLaunchPlan(template, budgetForTemplate(template, DEFAULT_GRAPH_BUDGET));
      expect(built.ok, `${template.key} must compile: ${built.ok ? "" : built.errors.join("; ")}`).toBe(true);
    }
  });
});
