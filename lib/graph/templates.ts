import { z } from "zod";

import { defineNode, type NodeCapability, type NodeContract } from "@/lib/graph/contracts";
import type { ProposedEdge } from "@/lib/graph/dependencies";
import { DEFAULT_GRAPH_BUDGET, type GraphBudget } from "@/lib/graph/budgets";
import type { GateKind, SdlcStage } from "@/lib/sdlc/lifecycle";
import type { ResourceRef, RiskLevel } from "@/lib/graph/types";

/**
 * Graph templates.
 *
 * A template is a *starting plan*, not a guarantee. It declares the nodes a
 * recurring job usually needs and the dependencies it believes exist; the
 * compiler then applies the same scrutiny it applies to a planner's output —
 * fake edges are still removed, write conflicts are still detected, and the
 * topology is still chosen on evidence. A template that names twelve nodes can
 * legitimately compile down to `SINGLE_AGENT`, and that is a success rather than
 * a bug.
 *
 * The reason templates exist is economy: the planning call that produces this
 * node set costs money and time on every run, and for recurring work — an RLS
 * audit, a dependency sweep — the answer is the same each time. Skipping the
 * planner for known-shaped work is the cheapest possible improvement.
 *
 * Templates are versioned and cloned rather than edited in place, because a run
 * has to be reproducible from the template version it used. Editing a template
 * under a completed run would make its evidence unreadable.
 */

export const TEMPLATE_CATEGORIES = ["AUDIT", "BUILD", "REVIEW", "INVESTIGATION"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export type TemplateNode = {
  readonly nodeId: string;
  readonly job: string;
  readonly capability: NodeCapability;
  readonly executor: NodeContract["executor"];
  readonly dependsOn?: readonly string[];
  readonly reads?: readonly ResourceRef[];
  readonly writes?: readonly ResourceRef[];
  /** Structured output is the default; a node opts into prose explicitly. */
  readonly prose?: boolean;
  /** Override the capability-derived fan-in tolerance (see below). */
  readonly toleratesPartialInputs?: boolean;
  /** Where in the Agentic SDLC this node sits. Absent on a non-lifecycle template. */
  readonly lifecycleStage?: SdlcStage;
  /** The gate the node waits at once its work is done. Absent means it does not wait. */
  readonly gate?: GateKind;
};

export type GraphTemplate = {
  readonly key: string;
  readonly name: string;
  readonly category: TemplateCategory;
  readonly summary: string;
  readonly version: number;
  readonly risk: RiskLevel;
  readonly discovery?: boolean;
  readonly nodes: readonly TemplateNode[];
  readonly proposedEdges: readonly ProposedEdge[];
  /**
   * Resources the template knows two nodes will both write, and has arranged to
   * serialize. Declaring it here is what stops compilation failing on a conflict
   * the template author already thought about.
   */
  readonly resolvedWriteConflicts?: readonly string[];
  /**
   * Edges that point backwards through the lifecycle.
   *
   * Deliberately not part of `proposedEdges`: the compiler rejects every cycle,
   * and it is right to. A feedback edge is not a dependency — no node ever
   * waits on one — it is the record of where a stage reports its result back
   * to, read between iterations rather than during one. Keeping the two lists
   * apart is what lets a lifecycle loop without the DAG becoming a lie.
   */
  readonly feedbackEdges?: readonly ProposedEdge[];
  /**
   * What this template needs beyond the default budget.
   *
   * One default suited every template while they were all shallow. A lifecycle
   * is not: nine sequential stages at the measured eight-minute model envelope
   * need far longer than a five-stage build, and the honest fix is a per-template
   * number rather than either widening the ceiling for every graph or shrinking
   * an envelope that a live drain established.
   */
  readonly budget?: Partial<GraphBudget>;
};

/** The budget a template runs under: the default, with its own overrides. */
export function budgetForTemplate(
  template: Pick<GraphTemplate, "budget">,
  base: GraphBudget = DEFAULT_GRAPH_BUDGET,
): GraphBudget {
  return { ...base, ...template.budget };
}

const findingsSchema = z.object({
  findings: z.array(
    z.object({
      title: z.string(),
      severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      location: z.string(),
      evidence: z.string(),
    }),
  ),
});

const reportSchema = z.object({
  summary: z.string(),
  findings: z.array(z.object({ title: z.string(), severity: z.string() })),
  recommendation: z.string(),
});

const planSchema = z.object({
  steps: z.array(z.object({ description: z.string(), rationale: z.string() })),
});

/**
 * Which schema a capability's output must satisfy.
 *
 * Extraction and review nodes produce findings that a reduce step consumes, so
 * prose from them is a contract violation rather than a style preference.
 */
function schemaFor(node: TemplateNode): z.ZodTypeAny {
  if (node.prose) return z.string();
  switch (node.capability) {
    case "planning":
    case "architecture":
      return planSchema;
    case "synthesis":
    case "reporting":
      return reportSchema;
    default:
      return findingsSchema;
  }
}

/**
 * Capabilities that aggregate other nodes' outputs. Their fan-ins tolerate
 * missing or failed inputs by default (§14): a reduce of nineteen findings
 * sets, or a synthesis of two surviving reviews, stated as partial, beats
 * losing the surviving work to the one branch that failed. Implementation,
 * QA, and review nodes keep the strict rule — they genuinely need their
 * inputs. A single-dependency node behaves identically either way, since a
 * tolerant fan-in still requires at least one completed input.
 */
const AGGREGATING_CAPABILITIES: ReadonlySet<NodeCapability> = new Set([
  "extraction",
  "synthesis",
  "reporting",
]);

/** Turn a template's declarative nodes into full contracts the compiler accepts. */
export function templateNodeContracts(template: GraphTemplate): readonly NodeContract[] {
  return template.nodes.map((node) =>
    defineNode({
      nodeId: node.nodeId,
      job: node.job,
      executor: node.executor,
      capability: node.capability,
      // A node's input is whatever its dependencies handed it. An entry node
      // receives the goal, which is legitimately a string.
      inputSchema: (node.dependsOn ?? []).length === 0 ? z.string() : z.unknown(),
      outputSchema: schemaFor(node),
      dependsOn: node.dependsOn ?? [],
      reads: node.reads ?? [],
      writes: node.writes ?? [],
      risk: template.risk,
      toleratesPartialInputs:
        node.toleratesPartialInputs
        ?? (AGGREGATING_CAPABILITIES.has(node.capability) && (node.dependsOn ?? []).length > 0),
      // A MODEL inspector must actually read the repository before it may
      // answer; the first live drain measured 8 turns and 3 minutes as too
      // small an envelope. Deterministic and anchor nodes keep the tight
      // default — code either finishes fast or is wrong.
      ...(node.executor === "MODEL" ? { timeoutMs: 480_000 } : {}),
    }),
  );
}

/** The stage and gate a template gave a node, if any. Read when rendering a plan. */
export function templateStageFor(
  template: GraphTemplate,
  nodeKey: string,
): { stage: SdlcStage | null; gate: GateKind | null } {
  const node = template.nodes.find((candidate) => candidate.nodeId === nodeKey);
  return { stage: node?.lifecycleStage ?? null, gate: node?.gate ?? null };
}

const file = (id: string): ResourceRef => ({ kind: "file", id });

/**
 * A wide audit: many independent inspectors converging on one report.
 *
 * The inspectors declare no dependencies on each other because they genuinely
 * have none — this is the shape the fake-edge test exists to protect. Only the
 * reduce step waits.
 */
/** Exported so custom (database-stored) templates build through the exact
 * same shape as the built-ins — one builder, no divergence. */
export function auditTemplate(input: {
  key: string;
  name: string;
  summary: string;
  areas: readonly { id: string; job: string }[];
  capability?: NodeCapability;
  category?: TemplateCategory;
}): GraphTemplate {
  const capability = input.capability ?? "review";
  const inspectors: TemplateNode[] = input.areas.map((area) => ({
    nodeId: area.id,
    job: area.job,
    capability,
    executor: "MODEL",
  }));

  return {
    key: input.key,
    name: input.name,
    category: input.category ?? "AUDIT",
    summary: input.summary,
    version: 1,
    risk: "GREEN",
    nodes: [
      ...inspectors,
      {
        nodeId: "reduce",
        job: "Deduplicate and rank the findings from every inspector.",
        capability: "extraction",
        executor: "DETERMINISTIC",
        dependsOn: inspectors.map((node) => node.nodeId),
      },
      {
        nodeId: "report",
        job: `Write the ${input.name.toLowerCase()} report from the reduced findings.`,
        capability: "reporting",
        executor: "MODEL",
        dependsOn: ["reduce"],
      },
    ],
    proposedEdges: [
      ...inspectors.map((node) => ({
        from: node.nodeId,
        to: "reduce",
        reason: "DATA" as const,
        detail: `The reduce step consumes ${node.nodeId}'s findings.`,
      })),
      {
        from: "reduce",
        to: "report",
        reason: "DATA" as const,
        detail: "The report is written from the reduced finding set.",
      },
    ],
  };
}

export const GRAPH_TEMPLATES: readonly GraphTemplate[] = Object.freeze([
  {
    key: "agentic_sdlc",
    name: "Agentic SDLC",
    category: "BUILD",
    summary:
      "The full lifecycle: state the goal, write the requirements, design it, build it in parallel where the files genuinely differ, review it with a reader who never saw the reasoning, prove it with evidence, deploy behind an owner's decision, then watch it and report back.",
    version: 1,
    risk: "YELLOW",
    /*
     * Nine sequential stages at eight minutes an attempt, attempted twice, is
     * 144 minutes of worst case — and the estimator applies the slowest node to
     * every level, so this is deliberately pessimistic rather than expected.
     * Two things it must not be answered with: shrinking the model envelope,
     * which a live drain measured at eight minutes for a reason, or widening
     * the default for every graph that does not need it.
     */
    budget: { maxDurationMs: 150 * 60_000 },
    nodes: [
      {
        nodeId: "goal",
        job: "State the goal as acceptance criteria that can be checked rather than admired.",
        capability: "planning",
        executor: "MODEL",
        lifecycleStage: "GOAL",
      },
      {
        nodeId: "prd",
        job: "Write the requirements: scope, non-goals, and the behaviour each acceptance criterion implies.",
        capability: "planning",
        executor: "MODEL",
        dependsOn: ["goal"],
        lifecycleStage: "PRD",
        gate: "AUTOMATIC",
      },
      {
        nodeId: "architecture",
        job: "Design the change: components, boundaries, and the decisions a reviewer would want recorded.",
        capability: "architecture",
        executor: "MODEL",
        dependsOn: ["prd"],
        lifecycleStage: "ARCHITECTURE",
        gate: "HUMAN",
      },
      {
        nodeId: "implement_server",
        job: "Implement the server side the architecture named: routes, validation, and the database boundary.",
        capability: "implementation",
        executor: "MODEL",
        dependsOn: ["architecture"],
        writes: [file("app/api"), file("lib")],
        lifecycleStage: "IMPLEMENTATION",
      },
      {
        nodeId: "implement_client",
        job: "Implement the interface the architecture named.",
        capability: "implementation",
        executor: "MODEL",
        dependsOn: ["architecture"],
        writes: [file("components")],
        lifecycleStage: "IMPLEMENTATION",
      },
      {
        nodeId: "implement_tests",
        job: "Write the tests for the behaviour the requirements describe, including its failure states.",
        capability: "qa",
        executor: "MODEL",
        dependsOn: ["architecture"],
        writes: [file("tests")],
        lifecycleStage: "IMPLEMENTATION",
      },
      {
        nodeId: "integrate",
        job: "Integrate the three branches and resolve what they share.",
        capability: "implementation",
        executor: "DETERMINISTIC",
        dependsOn: ["implement_server", "implement_client", "implement_tests"],
        lifecycleStage: "IMPLEMENTATION",
      },
      {
        nodeId: "review",
        job: "Review the integrated change without the implementation transcript.",
        capability: "review",
        executor: "MODEL",
        dependsOn: ["integrate"],
        lifecycleStage: "REVIEW",
        gate: "AUTOMATIC",
      },
      {
        nodeId: "security_review",
        job: "Read the change for authorization, tenancy, secret handling and row security.",
        capability: "security_review",
        executor: "MODEL",
        dependsOn: ["integrate"],
        lifecycleStage: "REVIEW",
      },
      {
        nodeId: "test",
        job: "Run lint, typecheck, tests and build, and record the results as evidence rather than describing them.",
        capability: "qa",
        executor: "ANCHOR",
        dependsOn: ["review", "security_review"],
        lifecycleStage: "TEST",
        gate: "AUTOMATIC",
      },
      {
        nodeId: "deploy",
        job: "Deploy the verified change and record what the deployment API reported.",
        capability: "implementation",
        executor: "ANCHOR",
        dependsOn: ["test"],
        lifecycleStage: "DEPLOYMENT",
        gate: "HUMAN",
      },
      {
        nodeId: "monitor",
        job: "Observe the running system and report whether it met the acceptance criteria the goal stated.",
        capability: "synthesis",
        executor: "ANCHOR",
        dependsOn: ["deploy"],
        lifecycleStage: "MONITORING",
      },
    ],
    proposedEdges: [
      { from: "goal", to: "prd", reason: "DATA", detail: "The requirements are written from the acceptance criteria." },
      { from: "prd", to: "architecture", reason: "DATA", detail: "The design answers the requirements." },
      { from: "architecture", to: "implement_server", reason: "DATA", detail: "The design names the server work." },
      { from: "architecture", to: "implement_client", reason: "DATA", detail: "The design names the interface work." },
      { from: "architecture", to: "implement_tests", reason: "DATA", detail: "The design names the behaviour to test." },
      { from: "implement_server", to: "integrate", reason: "DATA", detail: "Integration consumes the branch." },
      { from: "implement_client", to: "integrate", reason: "DATA", detail: "Integration consumes the branch." },
      { from: "implement_tests", to: "integrate", reason: "DATA", detail: "Integration consumes the branch." },
      { from: "integrate", to: "review", reason: "RESOURCE_READ_AFTER_WRITE", detail: "Review reads the integrated tree." },
      { from: "integrate", to: "security_review", reason: "RESOURCE_READ_AFTER_WRITE", detail: "The security read is of the integrated tree." },
      { from: "review", to: "test", reason: "VERIFICATION", detail: "Tests run against a reviewed change." },
      { from: "security_review", to: "test", reason: "VERIFICATION", detail: "Tests run against a change the security read cleared." },
      { from: "test", to: "deploy", reason: "VERIFICATION", detail: "Only a change with test evidence is deployed." },
      { from: "deploy", to: "monitor", reason: "RESOURCE_READ_AFTER_WRITE", detail: "Monitoring observes what was deployed." },
    ],
    feedbackEdges: [
      { from: "monitor", to: "goal", reason: "DATA", detail: "What the running system reported becomes the next goal." },
      { from: "test", to: "implement_server", reason: "VERIFICATION", detail: "A failed test returns the work to implementation." },
      { from: "review", to: "implement_server", reason: "VERIFICATION", detail: "A rejected review returns the work to implementation." },
      { from: "architecture", to: "prd", reason: "POLICY", detail: "A rejected design returns the work to the requirements." },
    ],
  },
  auditTemplate({
    key: "production_readiness",
    name: "Production Readiness",
    summary:
      "Checks the things that break on the first real day: configuration, migrations, error handling, observability and rollback.",
    areas: [
      { id: "config", job: "Check configuration and environment handling for missing or unsafe defaults." },
      { id: "migrations", job: "Check migrations apply cleanly, in order, and are recorded." },
      { id: "errors", job: "Check error handling, timeouts and retries on every external call." },
      { id: "observability", job: "Check that a failure would be visible: logs, metrics, alerts." },
      { id: "rollback", job: "Check the rollback path exists and has been exercised." },
    ],
  }),
  auditTemplate({
    key: "security_audit",
    name: "Security Audit",
    summary:
      "Authentication, authorization, secret handling, input validation and dependency exposure.",
    areas: [
      { id: "authn", job: "Review authentication: session handling, confirmation, and account recovery." },
      { id: "authz", job: "Review authorization: every privileged path checks the caller." },
      { id: "secrets", job: "Look for credentials in browser code, logs, fixtures or database rows." },
      { id: "input", job: "Review input validation and injection surfaces." },
      { id: "deps", job: "Review dependencies for known vulnerable versions." },
    ],
    capability: "security_review",
  }),
  auditTemplate({
    key: "rls_audit",
    name: "RLS Audit",
    summary:
      "Every exposed table has RLS and FORCE RLS, an ownership predicate, and no write grant to a browser role.",
    areas: [
      { id: "coverage", job: "Find any public table without RLS and FORCE RLS enabled." },
      { id: "predicates", job: "Check each policy scopes rows by tenant ownership rather than by role alone." },
      { id: "grants", job: "Check anon and authenticated hold no INSERT, UPDATE or DELETE grant." },
      { id: "definers", job: "Check every SECURITY DEFINER function re-validates its caller." },
    ],
    capability: "security_review",
  }),
  auditTemplate({
    key: "database_migration",
    name: "Database Migration",
    summary:
      "A schema change as an operation: forward-only, replay-safe, RLS intact, recorded in the ledger, with the read paths it feeds verified.",
    areas: [
      { id: "forward", job: "Check the migration is forward-only and replay-safe: if-not-exists guards, no down path, no renumbering of applied history." },
      { id: "rls", job: "Check every new or altered table keeps RLS and FORCE RLS with tenant-scoped policies and no browser write grants." },
      { id: "grants", job: "Check function and table grants: security definers re-validate their caller, and anon gains nothing." },
      { id: "consumers", job: "Check the API routes and views reading the changed schema still return their contract." },
      { id: "ledger", job: "Check the change is recorded end to end: tail pins, apply allowlists, and runbook counts move together." },
    ],
  }),
  auditTemplate({
    key: "bug_sweep",
    name: "Bug Sweep",
    summary: "Looks for defects by class rather than by file, so the same mistake is found everywhere it was made.",
    areas: [
      { id: "boundaries", job: "Off-by-one, empty-collection and boundary handling." },
      { id: "async", job: "Unawaited promises, races, and unhandled rejections." },
      { id: "nullability", job: "Values treated as present that the type says may be absent." },
      { id: "state", job: "State transitions that can be entered twice or left incomplete." },
    ],
  }),
  auditTemplate({
    key: "test_coverage",
    name: "Test Coverage",
    summary: "Finds behaviour with no test, and tests that would pass against a broken implementation.",
    areas: [
      { id: "untested", job: "Find exported behaviour with no corresponding test." },
      { id: "shallow", job: "Find tests that assert a call happened rather than that it did the right thing." },
      { id: "adverse", job: "Find missing error, empty and authorization cases." },
    ],
    capability: "qa",
  }),
  auditTemplate({
    key: "refactor_sweep",
    name: "Refactor Sweep",
    summary: "Duplication, dead code, and abstractions that have stopped paying for themselves.",
    areas: [
      { id: "duplication", job: "Find logic duplicated across modules." },
      { id: "dead", job: "Find unreachable or unreferenced code." },
      { id: "abstractions", job: "Find indirection with a single caller." },
    ],
  }),
  auditTemplate({
    key: "dependency_audit",
    name: "Dependency Audit",
    summary: "Version drift, unused packages, duplicate transitive versions and licence exposure.",
    areas: [
      { id: "vulnerable", job: "Find dependencies on versions with known advisories." },
      { id: "unused", job: "Find declared dependencies nothing imports." },
      { id: "duplicates", job: "Find multiple versions of one package in the tree." },
      { id: "licences", job: "Find licences incompatible with distribution." },
    ],
  }),
  auditTemplate({
    key: "performance_audit",
    name: "Performance Audit",
    summary: "Query patterns, payload sizes, render cost and caching.",
    areas: [
      { id: "queries", job: "Find N+1 queries and missing indexes on filtered columns." },
      { id: "payloads", job: "Find responses returning more data than the caller uses." },
      { id: "render", job: "Find client components that could be server components." },
      { id: "caching", job: "Find repeated work that is not cached and safely could be." },
    ],
  }),
  auditTemplate({
    key: "mobile_audit",
    name: "Mobile Audit",
    summary: "Layout, tap targets, and content that only works with a mouse and a wide viewport.",
    areas: [
      { id: "layout", job: "Find layouts that overflow or collapse below tablet width." },
      { id: "targets", job: "Find tap targets below the minimum comfortable size." },
      { id: "interaction", job: "Find hover-only affordances with no touch equivalent." },
    ],
  }),
  auditTemplate({
    key: "seo_aeo_audit",
    name: "SEO and AEO Audit",
    summary: "Metadata, structured data, crawlability, and whether an answer engine can quote the page.",
    areas: [
      { id: "metadata", job: "Check titles, descriptions and canonical URLs per route." },
      { id: "structured", job: "Check structured data is present and valid." },
      { id: "crawl", job: "Check robots, sitemap and indexability of public routes." },
      { id: "answerable", job: "Check pages state their claims in extractable, quotable form." },
    ],
    capability: "reporting",
  }),
  {
    key: "code_review",
    name: "Code Review",
    summary:
      "Three independent reviewers with different briefs, reduced and then synthesized. Independence is the point: one reviewer with three instructions produces one opinion.",
    category: "REVIEW",
    version: 1,
    risk: "GREEN",
    nodes: [
      { nodeId: "correctness", job: "Review for correctness defects.", capability: "review", executor: "MODEL" },
      { nodeId: "security", job: "Review for security defects.", capability: "security_review", executor: "MODEL" },
      { nodeId: "quality", job: "Review for simplification and reuse.", capability: "review", executor: "MODEL" },
      {
        nodeId: "reduce",
        job: "Deduplicate findings across the three reviews.",
        capability: "extraction",
        executor: "DETERMINISTIC",
        dependsOn: ["correctness", "security", "quality"],
      },
      {
        nodeId: "synthesis",
        job: "Rank what matters and state what to change.",
        capability: "synthesis",
        executor: "MODEL",
        dependsOn: ["reduce"],
      },
    ],
    proposedEdges: [
      { from: "correctness", to: "reduce", reason: "DATA", detail: "Reduce consumes correctness findings." },
      { from: "security", to: "reduce", reason: "DATA", detail: "Reduce consumes security findings." },
      { from: "quality", to: "reduce", reason: "DATA", detail: "Reduce consumes quality findings." },
      { from: "reduce", to: "synthesis", reason: "DATA", detail: "Synthesis reads the reduced set." },
    ],
  },
  {
    key: "feature_build",
    name: "Feature Build",
    summary:
      "Plan, build in parallel where the files genuinely differ, integrate, then review with a verifier that never saw the implementation reasoning.",
    category: "BUILD",
    version: 1,
    risk: "YELLOW",
    nodes: [
      { nodeId: "plan", job: "Decompose the feature into independent units of work.", capability: "planning", executor: "MODEL" },
      {
        nodeId: "implement_api",
        job: "Implement the server route and its validation.",
        capability: "implementation",
        executor: "MODEL",
        dependsOn: ["plan"],
        writes: [file("app/api")],
      },
      {
        nodeId: "implement_ui",
        job: "Implement the interface.",
        capability: "implementation",
        executor: "MODEL",
        dependsOn: ["plan"],
        writes: [file("components")],
      },
      {
        nodeId: "implement_tests",
        job: "Write the tests for the described behaviour.",
        capability: "qa",
        executor: "MODEL",
        dependsOn: ["plan"],
        writes: [file("tests")],
      },
      {
        nodeId: "integrate",
        job: "Integrate the branches and resolve what they share.",
        capability: "implementation",
        executor: "DETERMINISTIC",
        dependsOn: ["implement_api", "implement_ui", "implement_tests"],
      },
      {
        nodeId: "verify",
        job: "Run the tests and record the result as evidence.",
        capability: "qa",
        executor: "ANCHOR",
        dependsOn: ["integrate"],
      },
      {
        nodeId: "review",
        job: "Review the integrated change without the implementation transcript.",
        capability: "review",
        executor: "MODEL",
        dependsOn: ["verify"],
      },
    ],
    proposedEdges: [
      { from: "plan", to: "implement_api", reason: "DATA", detail: "The plan names the unit of work." },
      { from: "plan", to: "implement_ui", reason: "DATA", detail: "The plan names the unit of work." },
      { from: "plan", to: "implement_tests", reason: "DATA", detail: "The plan names the behaviour to test." },
      { from: "implement_api", to: "integrate", reason: "DATA", detail: "Integration consumes the branch." },
      { from: "implement_ui", to: "integrate", reason: "DATA", detail: "Integration consumes the branch." },
      { from: "implement_tests", to: "integrate", reason: "DATA", detail: "Integration consumes the branch." },
      { from: "integrate", to: "verify", reason: "RESOURCE_READ_AFTER_WRITE", detail: "Tests run against the integrated tree." },
      { from: "verify", to: "review", reason: "VERIFICATION", detail: "Review reads the verified result." },
    ],
  },
  {
    key: "incident_investigation",
    name: "Incident Investigation",
    summary:
      "An open-ended search: rounds continue until a round finds nothing new, rather than until a fixed node count is exhausted.",
    category: "INVESTIGATION",
    version: 1,
    risk: "YELLOW",
    discovery: true,
    nodes: [
      { nodeId: "triage", job: "Establish what is failing and when it started.", capability: "review", executor: "MODEL" },
      {
        nodeId: "logs",
        job: "Search logs and events around the onset.",
        capability: "extraction",
        executor: "MODEL",
        dependsOn: ["triage"],
      },
      {
        nodeId: "changes",
        job: "Identify changes deployed near the onset.",
        capability: "extraction",
        executor: "MODEL",
        dependsOn: ["triage"],
      },
      {
        nodeId: "reproduce",
        job: "Attempt a reproduction and record the observation.",
        capability: "qa",
        executor: "ANCHOR",
        dependsOn: ["triage"],
      },
      {
        nodeId: "cause",
        job: "State the cause, cite the evidence, and say what would disprove it.",
        capability: "synthesis",
        executor: "MODEL",
        dependsOn: ["logs", "changes", "reproduce"],
      },
    ],
    proposedEdges: [
      { from: "triage", to: "logs", reason: "DATA", detail: "Triage bounds the search window." },
      { from: "triage", to: "changes", reason: "DATA", detail: "Triage bounds the search window." },
      { from: "triage", to: "reproduce", reason: "DATA", detail: "Triage states what to reproduce." },
      { from: "logs", to: "cause", reason: "DATA", detail: "The cause cites log evidence." },
      { from: "changes", to: "cause", reason: "DATA", detail: "The cause cites the change set." },
      { from: "reproduce", to: "cause", reason: "VERIFICATION", detail: "A reproduction confirms or refutes the cause." },
    ],
  },
  {
    // The Job Seeker's seven-agent orchestration, expressed as the graph the
    // engine actually runs: Job Hunter and Research fan out in parallel,
    // Qualification reads the hunt, Resume and Application draft from the
    // qualified set, QA verifies both with a fresh context (a verification
    // lens records its verdict), and Follow-Up drafts outreach last. Every
    // node is MODEL or DETERMINISTIC, so the read-only analysis worker can
    // claim it; nothing here submits anything — the application tables'
    // approval gate stays the only path to APPLIED.
    key: "job_search_pipeline",
    name: "Job Search Pipeline",
    summary:
      "The Job Seeker's agent team over one qualified role: hunt and research in parallel, qualify against the recorded profile, draft documents from verified facts, QA them with a fresh context, and prepare follow-up outreach for human review.",
    category: "REVIEW",
    version: 1,
    risk: "GREEN",
    nodes: [
      {
        nodeId: "job_hunter",
        job: "From the recorded job description, extract the requirements, skills, keywords, technologies, and expectations, exactly as stated.",
        capability: "extraction",
        executor: "MODEL",
      },
      {
        nodeId: "research",
        job: "From the recorded posting and public statements inside the provided context only, summarize the company, team, and role; never assert facts the context does not contain.",
        capability: "extraction",
        executor: "MODEL",
      },
      {
        nodeId: "qualification",
        job: "Compare the extracted requirements against the recorded career profile; state matches, gaps, and the honest strength of each, citing profile facts.",
        capability: "review",
        executor: "MODEL",
        dependsOn: ["job_hunter"],
      },
      {
        nodeId: "resume_draft",
        job: "Draft resume tailoring notes using ONLY facts present in the career profile; flag any posting requirement the profile cannot support instead of covering it.",
        capability: "synthesis",
        executor: "MODEL",
        dependsOn: ["qualification", "research"],
        toleratesPartialInputs: true,
      },
      {
        nodeId: "application_answers",
        job: "Draft application-question responses using ONLY facts present in the career profile, marking every question the profile cannot answer.",
        capability: "synthesis",
        executor: "MODEL",
        dependsOn: ["qualification", "research"],
        toleratesPartialInputs: true,
      },
      {
        nodeId: "qa",
        job: "Verify the drafts against the career profile: every claim must trace to a recorded fact; report any statement that does not, any unmet requirement presented as met, and any missing answer.",
        capability: "qa",
        executor: "MODEL",
        dependsOn: ["resume_draft", "application_answers"],
      },
      {
        nodeId: "follow_up",
        job: "Draft personalized outreach for human review from the research summary and the QA-verified drafts; never imply anything was sent.",
        capability: "synthesis",
        executor: "MODEL",
        dependsOn: ["qa", "research"],
        toleratesPartialInputs: true,
      },
    ],
    proposedEdges: [
      { from: "job_hunter", to: "qualification", reason: "DATA", detail: "Qualification compares the extracted requirements." },
      { from: "qualification", to: "resume_draft", reason: "DATA", detail: "Tailoring follows the stated matches and gaps." },
      { from: "research", to: "resume_draft", reason: "DATA", detail: "Company context shapes emphasis, never content." },
      { from: "qualification", to: "application_answers", reason: "DATA", detail: "Answers follow the stated matches and gaps." },
      { from: "research", to: "application_answers", reason: "DATA", detail: "Company context shapes emphasis, never content." },
      { from: "resume_draft", to: "qa", reason: "VERIFICATION", detail: "QA verifies every claim against the profile." },
      { from: "application_answers", to: "qa", reason: "VERIFICATION", detail: "QA verifies every claim against the profile." },
      { from: "qa", to: "follow_up", reason: "DATA", detail: "Outreach cites only QA-verified drafts." },
      { from: "research", to: "follow_up", reason: "DATA", detail: "Outreach personalization uses the research summary." },
    ],
  },
]);

export function findTemplate(key: string): GraphTemplate | null {
  return GRAPH_TEMPLATES.find((template) => template.key === key) ?? null;
}

export function templatesByCategory(category: TemplateCategory): readonly GraphTemplate[] {
  return GRAPH_TEMPLATES.filter((template) => template.category === category);
}

/**
 * Clone a template for editing.
 *
 * Cloning rather than mutating is what keeps a completed run readable: its
 * evidence refers to a template key and version, and both must still mean what
 * they meant when it ran. A clone starts at version 1 under its own key.
 */
export function cloneTemplate(
  template: GraphTemplate,
  overrides: { key: string; name?: string; summary?: string },
): GraphTemplate {
  return {
    ...template,
    key: overrides.key,
    name: overrides.name ?? `${template.name} (copy)`,
    summary: overrides.summary ?? template.summary,
    version: 1,
  };
}

/**
 * Save an edit as a new version of the same template.
 *
 * The version always advances, even when the edit looks cosmetic: a run records
 * the version it used, and two different node sets sharing a version number
 * would make that record a lie.
 */
export function reviseTemplate(
  template: GraphTemplate,
  changes: Partial<Omit<GraphTemplate, "key" | "version">>,
): GraphTemplate {
  return { ...template, ...changes, key: template.key, version: template.version + 1 };
}
