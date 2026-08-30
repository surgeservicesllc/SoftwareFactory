/**
 * The factory's eleven specialists, bound to the engine's real vocabulary.
 *
 * These are not new executors: every node is still run by the graph engine's
 * workers, with the executor, provider and model the run feed reports. What
 * this module adds is the factory's role system — which specialist owns a
 * node — derived ONLY from facts the engine already records: the node's
 * `capability` (lib/graph/contracts.ts NODE_CAPABILITIES), its
 * `lifecycle_stage`, and, for the engineering bench, the words in the node's
 * own key. A surface that shows a specialist name must show it beside the
 * real executor evidence, never instead of it.
 *
 * Bounded context is a property of the engine, restated here per specialist:
 * a node receives the graph goal plus its dependencies' outputs (fan-in),
 * and must produce output satisfying its capability's contract
 * (lib/graph/contracts.ts; typed stage packages in stage-packages.ts).
 * Nothing here widens that.
 */

export type Specialist = Readonly<{
  key: string;
  name: string;
  /** What this specialist is for, in the person's terms. */
  mission: string;
  /** The engine capabilities this specialist owns (exact strings). */
  capabilities: readonly string[];
  /** Stage defaults: nodes in these stages without a better match land here. */
  stages: readonly string[];
  /** The bounded context the node actually receives. */
  receives: string;
  /** The structured output the node's contract actually demands. */
  produces: string;
}>;

export const SPECIALISTS: readonly Specialist[] = [
  {
    key: "research",
    name: "Research",
    mission: "Finds what already exists before anything is built, and scores it.",
    capabilities: ["discovery", "evaluation", "extraction"],
    stages: ["DISCOVERY", "EVALUATION"],
    receives: "The graph goal and any upstream extraction output.",
    produces: "Typed discovery/evaluation stage packages: scout reports, sources, a scored rubric.",
  },
  {
    key: "product",
    name: "Product / Requirements",
    mission: "Turns intent into requirements and picks the path (use, connect, adapt, fork, build).",
    capabilities: ["planning", "decision"],
    stages: ["GOAL", "PRD", "DECISION"],
    receives: "The goal verbatim plus discovery/evaluation packages from upstream nodes.",
    produces: "The PRD/decision stage packages: requirements, acceptance shape, the chosen path with reasons.",
  },
  {
    key: "architecture",
    name: "Architecture",
    mission: "Designs how the chosen path is built inside the existing system.",
    capabilities: ["architecture"],
    stages: ["ARCHITECTURE"],
    receives: "The decision package and the project's bound repository identity.",
    produces: "The architecture stage package the implementation nodes depend on.",
  },
  {
    key: "frontend",
    name: "Frontend",
    mission: "Builds the interface work of implementation steps.",
    capabilities: ["implementation"],
    stages: [],
    receives: "The architecture package and its dependency outputs, per node.",
    produces: "Implementation output satisfying the node's contract.",
  },
  {
    key: "backend",
    name: "Backend",
    mission: "Builds the server and API work of implementation steps.",
    capabilities: ["implementation"],
    stages: ["IMPLEMENTATION"],
    receives: "The architecture package and its dependency outputs, per node.",
    produces: "Implementation output satisfying the node's contract.",
  },
  {
    key: "database",
    name: "Database",
    mission: "Builds the schema and migration work of implementation steps.",
    capabilities: ["implementation"],
    stages: [],
    receives: "The architecture package and its dependency outputs, per node.",
    produces: "Implementation output satisfying the node's contract.",
  },
  {
    key: "security",
    name: "Security",
    mission: "Reviews work through the security lens, independently of the author.",
    capabilities: ["security_review"],
    stages: [],
    receives: "The subject node's output, bounded to what it produced.",
    produces: "A security verdict with evidence — an opinion without evidence does not count.",
  },
  {
    key: "integration",
    name: "Integration",
    mission: "Joins parallel branches into one coherent result at fan-in points.",
    capabilities: ["synthesis"],
    stages: [],
    receives: "Every dependency branch's output at the join.",
    produces: "The synthesized package downstream nodes consume.",
  },
  {
    key: "qa",
    name: "Testing / QA",
    mission: "Verifies the work independently. An agent saying done is not done.",
    capabilities: ["qa"],
    stages: ["TEST"],
    receives: "The subject work plus the acceptance shape from the PRD package.",
    produces: "Verification verdicts with evidence, recorded in graph_verifications.",
  },
  {
    key: "code_review",
    name: "Code Review",
    mission: "Reads the change as a reviewer before it can proceed.",
    capabilities: ["review"],
    stages: ["REVIEW"],
    receives: "The subject node's output, bounded to what it produced.",
    produces: "A review verdict with evidence; open questions stop the gate.",
  },
  {
    key: "deployment",
    name: "Deployment",
    mission: "Carries verified work to the deployment and monitoring gates — always behind owner approval.",
    capabilities: ["reporting"],
    stages: ["DEPLOYMENT", "MONITORING"],
    receives: "The verified result and the exact deployment evidence to bind.",
    produces: "The deployment/monitoring reports; RED actions stay owner-approved by policy.",
  },
] as const;

const byCapability = new Map<string, Specialist>();
for (const specialist of SPECIALISTS) {
  for (const capability of specialist.capabilities) {
    // First declaration wins where two share a capability (the engineering
    // bench); the key-word pass below is what tells the bench apart.
    if (!byCapability.has(capability)) byCapability.set(capability, specialist);
  }
}

const byStage = new Map<string, Specialist>();
for (const specialist of SPECIALISTS) {
  for (const stage of specialist.stages) {
    if (!byStage.has(stage)) byStage.set(stage, specialist);
  }
}

const bench = {
  frontend: SPECIALISTS.find((s) => s.key === "frontend")!,
  backend: SPECIALISTS.find((s) => s.key === "backend")!,
  database: SPECIALISTS.find((s) => s.key === "database")!,
};

/**
 * The specialist a node belongs to, from what the engine recorded about it.
 *
 * Precedence: an implementation node is told apart by the words in its own
 * key (the template author's name for the step — visible on every surface);
 * then the exact capability; then the stage default. A node nothing matches
 * returns null, and the caller shows the executor alone rather than a guessed
 * role.
 */
export function specialistForNode(node: Readonly<{
  capability?: string | null;
  lifecycle_stage?: string | null;
  node_key?: string | null;
}>): Specialist | null {
  const key = (node.node_key ?? "").toLowerCase();
  if (node.capability === "implementation") {
    if (/\b(ui|front|frontend|component|page|screen|view)\b/.test(key)) return bench.frontend;
    if (/\b(db|database|schema|migration|sql|data-model)\b/.test(key)) return bench.database;
    return bench.backend;
  }
  if (node.capability != null) {
    const matched = byCapability.get(node.capability);
    if (matched !== undefined) return matched;
  }
  if (node.lifecycle_stage != null) {
    const matched = byStage.get(node.lifecycle_stage);
    if (matched !== undefined) return matched;
  }
  return null;
}
