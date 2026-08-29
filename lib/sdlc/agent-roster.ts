import type { NodeCapability } from "@/lib/graph/contracts";
import type { ResourceKind, RiskLevel } from "@/lib/graph/types";
import type { SdlcStage } from "@/lib/sdlc/lifecycle";

/**
 * The eleven agent roles, and what each one is actually allowed to do.
 *
 * A role and a capability are not the same thing, and conflating them is what
 * this module exists to stop. A **capability** is the kind of thinking a node
 * needs — it picks a model tier and a provider task kind. A **role** is a job
 * on a team: a name a person recognises, a bounded slice of context, and a
 * privilege posture.
 *
 * The distinction earns its keep at Frontend, Backend and Integration. All
 * three are the same capability — `implementation`, same tier, same task kind
 * — because writing a React component, a route handler and a third-party
 * client are the same kind of reasoning. What differs is what they may touch.
 * Giving them separate *capabilities* would have been a label that changed no
 * behaviour; giving them separate *roles* over one capability is the
 * difference that is real.
 *
 * Only `database` and `deployment` earned capabilities of their own, because
 * only they behave differently: schema work runs on a stronger tier, and a
 * release asks a provider for a verdict rather than a proposal.
 *
 * `reads` and `writes` are the bounded context. They are deliberately narrow:
 * the Frontend agent cannot write a migration, the Research agent cannot write
 * anything at all, and neither restriction depends on the model choosing to
 * respect a sentence in a prompt.
 *
 * Everything here is data — no clock, no credential, no network — so the whole
 * roster is testable without either.
 */

export const AGENT_ROLE_IDS = [
  "research",
  "product",
  "architecture",
  "frontend",
  "backend",
  "database",
  "security",
  "integration",
  "qa",
  "code_review",
  "deployment",
] as const;
export type AgentRoleId = (typeof AGENT_ROLE_IDS)[number];

export type AgentRole = Readonly<{
  id: AgentRoleId;
  label: string;
  /** One line a nontechnical user can read and understand. */
  summary: string;
  /** The kind of thinking this role does, which sets its tier and task kind. */
  capability: NodeCapability;
  /** The lifecycle stage this role principally serves. */
  stage: SdlcStage;
  /** Bounded context: the resource kinds this role may read. */
  reads: readonly ResourceKind[];
  /** Bounded context: the resource kinds this role may write. Empty means read-only. */
  writes: readonly ResourceKind[];
  /** Risk a node carries by default when this role performs it. */
  defaultRisk: RiskLevel;
  /**
   * Whether this role's work needs a human decision before it takes effect,
   * regardless of autonomy mode. These are the approvals the platform will not
   * let an autonomy setting bypass.
   */
  requiresApproval: boolean;
  /** The bot privilege preset this role aligns with, where one exists. */
  presetId: string | null;
}>;

function role(
  id: AgentRoleId,
  label: string,
  summary: string,
  capability: NodeCapability,
  stage: SdlcStage,
  reads: readonly ResourceKind[],
  writes: readonly ResourceKind[],
  defaultRisk: RiskLevel,
  requiresApproval: boolean,
  presetId: string | null,
): AgentRole {
  return Object.freeze({
    id,
    label,
    summary,
    capability,
    stage,
    reads: Object.freeze([...reads]),
    writes: Object.freeze([...writes]),
    defaultRisk,
    requiresApproval,
    presetId,
  });
}

export const AGENT_ROLES: readonly AgentRole[] = Object.freeze([
  role(
    "research",
    "Research",
    "Finds what already exists — libraries, prior art, and how others solved this.",
    "discovery",
    "DISCOVERY",
    ["external_service", "api"],
    [],
    "GREEN",
    false,
    "research",
  ),
  role(
    "product",
    "Product",
    "Turns what you asked for into requirements and acceptance criteria.",
    "planning",
    "PRD",
    ["file", "directory"],
    ["file"],
    "GREEN",
    false,
    null,
  ),
  role(
    "architecture",
    "Architecture",
    "Decides how the pieces fit together before anything is built.",
    "architecture",
    "ARCHITECTURE",
    ["file", "directory", "database_table"],
    ["file"],
    "GREEN",
    false,
    null,
  ),
  /*
   * Frontend, backend and integration share `implementation` and differ only
   * in what they may touch. None can reach a migration; that is the database
   * role's ground, and the separation is what lets them run in parallel
   * without one silently reshaping the schema underneath another.
   */
  role(
    "frontend",
    "Frontend",
    "Builds the screens and interactions people actually see.",
    "implementation",
    "IMPLEMENTATION",
    ["file", "directory", "api"],
    ["file"],
    "GREEN",
    false,
    "developer",
  ),
  role(
    "backend",
    "Backend",
    "Builds the routes, rules and server logic behind the screens.",
    "implementation",
    "IMPLEMENTATION",
    ["file", "directory", "api", "database_table"],
    ["file"],
    "GREEN",
    false,
    "developer",
  ),
  /*
   * YELLOW and approval-bound. A migration is the one build-side change a
   * retry cannot undo: dropping a grant, loosening RLS or rewriting data
   * leaves no earlier state to return to.
   */
  role(
    "database",
    "Database",
    "Changes the schema, and keeps every table's access rules intact.",
    "database",
    "IMPLEMENTATION",
    ["file", "directory", "migration", "database_table"],
    ["file", "migration", "database_table"],
    "YELLOW",
    true,
    null,
  ),
  role(
    "security",
    "Security",
    "Looks for vulnerabilities, exposed secrets and unsafe patterns. Reads only.",
    "security_review",
    "REVIEW",
    ["file", "directory", "migration", "database_table", "external_service"],
    [],
    "GREEN",
    false,
    "security",
  ),
  role(
    "integration",
    "Integration",
    "Connects third-party services and handles what happens when they fail.",
    "implementation",
    "IMPLEMENTATION",
    ["file", "directory", "external_service", "api", "rate_limit"],
    ["file"],
    "YELLOW",
    false,
    "developer",
  ),
  role(
    "qa",
    "Testing and QA",
    "Independently checks the work against the acceptance criteria.",
    "qa",
    "TEST",
    ["file", "directory", "api"],
    ["file"],
    "GREEN",
    false,
    "tester",
  ),
  role(
    "code_review",
    "Code Review",
    "Reads the changes and says what should not ship. Writes no code.",
    "review",
    "REVIEW",
    ["file", "directory", "migration"],
    [],
    "GREEN",
    false,
    "reviewer",
  ),
  /*
   * RED and approval-bound, always. This is the role that changes what is
   * running in front of users, and AGENTS.md is explicit that an autonomy
   * setting does not get to waive it.
   */
  role(
    "deployment",
    "Deployment",
    "Releases the finished work, once the checks that guard it have passed.",
    "deployment",
    "DEPLOYMENT",
    ["file", "deployment_environment", "api"],
    ["deployment_environment"],
    "RED",
    true,
    "devops",
  ),
]);

const BY_ID: ReadonlyMap<AgentRoleId, AgentRole> = new Map(
  AGENT_ROLES.map((entry) => [entry.id, entry]),
);

export function findAgentRole(id: string | null | undefined): AgentRole | null {
  if (!id) return null;
  return BY_ID.get(id as AgentRoleId) ?? null;
}

/**
 * Every role that exercises a capability.
 *
 * Returns a list rather than one role because `implementation` genuinely has
 * three: frontend, backend and integration. A caller that wants one specific
 * agent has to say which — the alternative is picking arbitrarily and handing
 * a component task to whoever happened to be first in the array.
 */
export function rolesForCapability(capability: NodeCapability): readonly AgentRole[] {
  return AGENT_ROLES.filter((entry) => entry.capability === capability);
}

export function rolesForStage(stage: SdlcStage): readonly AgentRole[] {
  return AGENT_ROLES.filter((entry) => entry.stage === stage);
}

/** The roles whose work a human must approve, whatever the autonomy mode. */
export function approvalBoundRoles(): readonly AgentRole[] {
  return AGENT_ROLES.filter((entry) => entry.requiresApproval);
}

/**
 * Whether a role may write a resource kind.
 *
 * The check a caller should make before scheduling work, so an out-of-bounds
 * write is refused at assignment time rather than discovered in a diff.
 */
export function roleMayWrite(role: AgentRole, kind: ResourceKind): boolean {
  return role.writes.includes(kind);
}
